import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { getMemberIdentity, requireLockedMemberWriteAccess, MembershipAccessDeniedError } from "@/lib/membership/repository";
import type { MemberIdentity } from "./model";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { JournalError, journalFilePolicy, validateJournalInput, validateJournalVersion, type JournalCreateInput, type JournalEditInput, type JournalEntry, type JournalSnapshot, type JournalListOptions, JOURNAL_UUID } from "./journal-model";
import { journalStore, journalStorageConfigured, validateJournalMedia } from "./journal-storage";

type Sql = ReturnType<typeof getApplicationDatabase> | postgres.TransactionSql;
type EntryRow = { id:string; kind:JournalEntry["kind"]; title:string|null; body:string|null; created_at:Date|string; saved:boolean; event_year:number|null; event_month:number|null; event_day:number|null; include_on_timeline:boolean; current_version:number; deleted_at:Date|null; timeline_position:number|null };
type MediaRow = { id:string; entry_id:string|null; storage_path:string; mime_type:string; byte_size:number|string; verified_at:Date|null; state:string; created_at:Date|string; removed_at:Date|null };
export async function journalOwner(authUserId:string, write=false) {
  const identity=await getMemberIdentity(authUserId);
  if (!identity) throw new JournalError(403,"Member access is required.");
  const access=deriveMemberAccessPolicy(identity,identity.cancellationEffectiveAt);
  if (!memberCan(access,write ? "profile.write" : "profile.read")) throw new JournalError(403,"Your account cannot access this journal.");
  return {id:identity.memberId,writable:memberCan(access,"profile.write"),identity};
}
async function lockJournal(tx:postgres.TransactionSql, identity:MemberIdentity) {
  await tx`select pg_advisory_xact_lock(hashtext(${identity.memberId}), 45)`;
  try { await requireLockedMemberWriteAccess(tx,identity,"profile.write"); }
  catch(error) { if(error instanceof MembershipAccessDeniedError) throw new JournalError(403,"Your account cannot change this journal."); throw error; }
  await tx`select set_config('app.journal_actor_auth_user_id',${identity.authUserId},true)`;
}
async function entriesWithMedia(memberId:string, rows:EntryRow[], sql:Sql=getApplicationDatabase()):Promise<JournalEntry[]> {
  if (!rows.length) return [];
  const media=await sql<MediaRow[]>`select id,entry_id,mime_type,byte_size from member_journal_media where member_id=${memberId}::uuid and entry_id in ${sql(rows.map(row=>row.id))} and state='ready' and removed_at is null order by position,id`;
  return rows.map(row=>({id:row.id,kind:row.kind,title:row.title,body:row.body,createdAt:new Date(row.created_at).toISOString(),saved:row.saved,
    eventYear:row.event_year,eventMonth:row.event_month,eventDay:row.event_day,includeOnTimeline:row.include_on_timeline,version:String(row.current_version),
    media:media.filter(item=>item.entry_id===row.id).map(item=>({id:item.id,mimeType:item.mime_type,size:Number(item.byte_size),url:`/api/my/journal/media/${item.id}`}))}));
}
export async function getJournalEntry(authUserId:string,id:string):Promise<JournalEntry> {
  if(!JOURNAL_UUID.test(id)) throw new JournalError(404,"Entry not found.");
  const owner=await journalOwner(authUserId); const sql=getApplicationDatabase();
  const rows=await sql<EntryRow[]>`select * from member_journal_entries where id=${id}::uuid and member_id=${owner.id}::uuid and deleted_at is null`;
  if(!rows.length) throw new JournalError(404,"Entry not found.");
  return (await entriesWithMedia(owner.id,rows))[0]!;
}
export async function getJournal(authUserId:string, cursor:string|null=null, saved=false, options:JournalListOptions={}):Promise<JournalSnapshot> {
  const owner=await journalOwner(authUserId); const sql=getApplicationDatabase();
  if(cursor && !JOURNAL_UUID.test(cursor)) throw new JournalError(400,"Invalid journal page.");
  const timeline=options.view==="timeline", search=options.search?.trim() ?? "", year=options.year ?? null;
  if(search.length>200 || (year!==null && (!Number.isInteger(year) || year<1900 || year>2200))) throw new JournalError(400,"Choose a valid journal search or year.");
  const oldest=options.order==="oldest";
  // Cursor position is derived from the same filtered owner-only result. A
  // foreign or deleted cursor can never reveal another member's content.
  const rows=await sql<EntryRow[]>`with filtered as (
    select * from member_journal_entries where member_id=${owner.id}::uuid and deleted_at is null
      and (${!saved} or saved) and (${!timeline} or include_on_timeline)
      and (${year===null} or event_year=${year}::integer)
      and (${!search} or strpos(lower(coalesce(title,'') || ' ' || coalesce(body,'')),lower(${search}))>0)
  ), ordered as (
    select *,row_number() over (order by
      case when ${timeline && oldest} then event_year end asc,
      case when ${timeline && !oldest} then event_year end desc,
      case when ${timeline} then (event_month is null)::integer end asc,
      case when ${timeline && oldest} then event_month end asc,
      case when ${timeline && !oldest} then event_month end desc,
      case when ${timeline} then (event_day is null)::integer end asc,
      case when ${timeline && oldest} then event_day end asc,
      case when ${timeline && !oldest} then event_day end desc,
      case when ${timeline} then timeline_position end asc,
      case when ${!timeline && oldest} then created_at end asc,
      case when ${!timeline && !oldest} then created_at end desc,id asc) as ordinal from filtered
  ) select * from ordered where (${cursor===null} or ordinal>(select ordinal from ordered where id=${cursor}::uuid)) order by ordinal limit 31`;
  const [summary]=await sql<{total:number;years:number[]}[]>`select
    count(*) filter(where (${year===null} or event_year=${year}::integer))::integer as total,
    coalesce(array_agg(distinct event_year order by event_year desc) filter(where event_year is not null),'{}'::integer[]) as years
    from member_journal_entries where member_id=${owner.id}::uuid and deleted_at is null
      and (${!saved} or saved) and (${!timeline} or include_on_timeline)
      and (${!search} or strpos(lower(coalesce(title,'') || ' ' || coalesce(body,'')),lower(${search}))>0)`;
  const page=rows.slice(0,30);
  return {entries:await entriesWithMedia(owner.id,page),hasMore:rows.length>30,nextCursor:rows.length>30 ? page.at(-1)!.id : null,
    total:summary?.total ?? 0,years:summary?.years ?? [],writable:owner.writable,mediaReady:journalStorageConfigured()};
}
export async function exportJournalTimeline(authUserId:string):Promise<JournalEntry[]> {
  const owner=await journalOwner(authUserId); const sql=getApplicationDatabase();
  const rows=await sql<EntryRow[]>`select * from member_journal_entries where member_id=${owner.id}::uuid and deleted_at is null and include_on_timeline
    order by event_year,coalesce(event_month,13),coalesce(event_day,32),timeline_position,created_at,id`;
  return entriesWithMedia(owner.id,rows);
}
export async function prepareJournalUpload(authUserId:string, value:unknown) {
  if (!value || typeof value!=="object") throw new JournalError(400,"Choose a file.");
  const input=value as Record<string,unknown>;
  if (Object.keys(input).some(key=>!["mimeType","size"].includes(key)) || typeof input.mimeType!=="string" || typeof input.size!=="number") throw new JournalError(400,"Choose a file.");
  journalFilePolicy(input.mimeType,input.size);
  const owner=await journalOwner(authUserId,true);const sql=getApplicationDatabase();const id=randomUUID(); const path=`${owner.id}/pending/${id}`;
  // Serialize quota checks per member so concurrent requests cannot over-reserve.
  await sql.begin(async tx=>{
    await lockJournal(tx, owner.identity);
  const expired=await tx<MediaRow[]>`select * from member_journal_media where member_id=${owner.id}::uuid and state='pending' and created_at<now()-interval '24 hours' limit 100`;
  if(expired.length){
    const removed=await journalStore().remove(expired.map(file=>file.storage_path));
    if(!removed.error) await tx`delete from member_journal_media where member_id=${owner.id}::uuid and state='pending' and id in ${tx(expired.map(file=>file.id))} and created_at<now()-interval '24 hours'`;
  }

    const [usage]=await tx<{count:number;bytes:string}[]>`select count(*) filter(where created_at>now()-interval '1 day')::int as count,coalesce(sum(case when verified_at is null then 52428800 else byte_size end),0)::text as bytes from member_journal_media where member_id=${owner.id}::uuid`;
    if(usage.count>=100 || Number(usage.bytes)+52428800>1024*1024*1024) throw new JournalError(429,"Your media upload allowance is full. Please contact support.");
    await tx`insert into member_journal_media(id,member_id,storage_path,mime_type,byte_size) values(${id}::uuid,${owner.id}::uuid,${path},${String(input.mimeType)},${Number(input.size)})`;
  });
  try {
    const {data,error}=await journalStore().createSignedUploadUrl(path,{upsert:false});
    if(error || !data) throw new JournalError(503,"Media uploads are temporarily unavailable.");
    return {id,signedUrl:data.signedUrl};
  } catch(error) {await sql`delete from member_journal_media where id=${id}::uuid and member_id=${owner.id}::uuid and state='pending'`;throw error;}
}
async function verifyUpload(memberId:string,id:string,kind:string) {
  const sql=getApplicationDatabase();
  const [media]=await sql<MediaRow[]>`select * from member_journal_media where id=${id}::uuid and member_id=${memberId}::uuid`;
  if(!media || media.state!=="pending" || new Date(media.created_at).getTime()<Date.now()-86_400_000 || journalFilePolicy(media.mime_type,Number(media.byte_size))!==kind) throw new JournalError(400,"One of these uploads is unavailable. Choose the file again.");
  if(media.verified_at) return;
  const store=journalStore();const {data,error}=await store.download(media.storage_path);
  if(error || !data) throw new JournalError(400,"An upload has not finished. Please try again.");
  if(data.size!==Number(media.byte_size)) throw new JournalError(400,"The uploaded file does not match its size.");
  const verified=await validateJournalMedia(Buffer.from(await data.arrayBuffer()),media.mime_type);
  // Signed upload tokens never address the verified object, preventing later replacement.
  const path=`${memberId}/verified/${randomUUID()}.${verified.extension}`;
  const result=await store.upload(path,verified.data,{contentType:verified.mimeType,cacheControl:"0",upsert:false});
  if(result.error) throw new JournalError(503,"The media could not be saved. Please try again.");
  const changed=await sql`update member_journal_media set storage_path=${path},mime_type=${verified.mimeType},byte_size=${verified.data.length},verified_at=now() where id=${id}::uuid and member_id=${memberId}::uuid and state='pending' and verified_at is null returning id`;
  // Removal failure leaves only a private, unreferenced object; it must not turn a saved entry into an error.
  await store.remove([changed.length ? media.storage_path : path]).catch(()=>undefined);
}

async function prepareEntryMedia(memberId:string, input:JournalCreateInput) {
  const sql=getApplicationDatabase();
  for(const id of input.mediaIds) {
    const [file]=await sql<MediaRow[]>`select * from member_journal_media where id=${id}::uuid and member_id=${memberId}::uuid`;
    if(file?.state==="ready" && file.entry_id===input.id && journalFilePolicy(file.mime_type,Number(file.byte_size))===input.kind) continue;
    await verifyUpload(memberId,id,input.kind);
  }
}
function inputMatches(entry:JournalEntry,input:JournalCreateInput) {
  return entry.kind===input.kind && entry.title===(input.title||null) && entry.body===(input.body||null)
    && entry.eventYear===(input.eventYear??null) && entry.eventMonth===(input.eventMonth??null) && entry.eventDay===(input.eventDay??null)
    && entry.includeOnTimeline===(input.includeOnTimeline===true)
    && entry.media.map(file=>file.id).join(",")===input.mediaIds.join(",");
}
async function applyMedia(tx:postgres.TransactionSql, memberId:string,input:JournalCreateInput) {
  const files=await tx<MediaRow[]>`select * from member_journal_media where member_id=${memberId}::uuid and entry_id=${input.id}::uuid and state='ready' for update`;
  for(const file of files) if(!input.mediaIds.includes(file.id) && file.removed_at===null) {
    await tx`update member_journal_media set removed_at=statement_timestamp() where id=${file.id}::uuid and member_id=${memberId}::uuid`;
  }
  for(const [position,id] of input.mediaIds.entries()) {
    const [file]=await tx<MediaRow[]>`select * from member_journal_media where id=${id}::uuid and member_id=${memberId}::uuid for update`;
    if(!file || !file.verified_at || (file.state!=="pending" && !(file.state==="ready" && file.entry_id===input.id))
      || journalFilePolicy(file.mime_type,Number(file.byte_size))!==input.kind) throw new JournalError(400,"An upload is no longer available.");
    await tx`update member_journal_media set entry_id=${input.id}::uuid,state='ready',position=${position},removed_at=null
      where id=${id}::uuid and member_id=${memberId}::uuid`;
  }
}
async function savedEntry(tx:Sql,memberId:string,id:string) {
  const rows=await tx<EntryRow[]>`select * from member_journal_entries where id=${id}::uuid and member_id=${memberId}::uuid`;
  return (await entriesWithMedia(memberId,rows,tx))[0]!;
}
export async function createJournalEntry(authUserId:string,value:JournalCreateInput):Promise<JournalEntry> {
  const input=validateJournalInput(value), owner=await journalOwner(authUserId,true), sql=getApplicationDatabase();
  // A retry may reference files already attached by the committed first try.
  const existing=await sql<EntryRow[]>`select * from member_journal_entries where id=${input.id}::uuid and member_id=${owner.id}::uuid`;
  if(!existing.length) await prepareEntryMedia(owner.id,input);
  return sql.begin(async tx=>{
    await lockJournal(tx,owner.identity);
    const [current]=await tx<EntryRow[]>`select * from member_journal_entries where id=${input.id}::uuid and member_id=${owner.id}::uuid for update`;
    if(current) {
      const entry=await savedEntry(tx,owner.id,input.id);
      if(!current.deleted_at && inputMatches(entry,input)) return entry;
      throw new JournalError(409,"This entry has already changed. Load the latest version before saving.");
    }
    await tx`insert into member_journal_entries(id,member_id,kind,title,body,event_year,event_month,event_day,include_on_timeline,timeline_position,updated_by_auth_user_id)
      select ${input.id}::uuid,${owner.id}::uuid,${input.kind},${input.title||null},${input.body||null},${input.eventYear??null},${input.eventMonth??null},${input.eventDay??null},${input.includeOnTimeline===true},
        case when ${input.includeOnTimeline===true} then coalesce(max(timeline_position),0)+1 else null end,${authUserId}::uuid
      from member_journal_entries where member_id=${owner.id}::uuid`;
    await applyMedia(tx,owner.id,input);
    return savedEntry(tx,owner.id,input.id);
  });
}
export async function editJournalEntry(authUserId:string,id:string,value:JournalEditInput):Promise<JournalEntry> {
  const expectedVersion=validateJournalVersion(value.expectedVersion);
  const {expectedVersion: version,...fields}=value; void version;
  const input=validateJournalInput({...fields,id}), owner=await journalOwner(authUserId,true), sql=getApplicationDatabase();
  const [current]=await sql<EntryRow[]>`select * from member_journal_entries where id=${id}::uuid and member_id=${owner.id}::uuid and deleted_at is null`;
  if(!current) throw new JournalError(404,"Entry not found.");
  await prepareEntryMedia(owner.id,input);
  return sql.begin(async tx=>{
    await lockJournal(tx,owner.identity);
    const [row]=await tx<EntryRow[]>`select * from member_journal_entries where id=${id}::uuid and member_id=${owner.id}::uuid and deleted_at is null for update`;
    if(!row) throw new JournalError(404,"Entry not found.");
    const entry=await savedEntry(tx,owner.id,id);
    if(inputMatches(entry,input)) return entry;
    if(String(row.current_version)!==expectedVersion) throw new JournalError(409,"This entry changed in another window. Your draft is still here. Load the latest entry before saving.");
    await tx`update member_journal_entries set kind=${input.kind},title=${input.title||null},body=${input.body||null},
      event_year=${input.eventYear??null},event_month=${input.eventMonth??null},event_day=${input.eventDay??null},include_on_timeline=${input.includeOnTimeline===true},
      timeline_position=case when ${input.includeOnTimeline===true} and timeline_position is null
        then (select coalesce(max(other.timeline_position),0)+1 from member_journal_entries other where other.member_id=${owner.id}::uuid) else timeline_position end,
      updated_by_auth_user_id=${authUserId}::uuid where id=${id}::uuid and member_id=${owner.id}::uuid`;
    await applyMedia(tx,owner.id,input);
    return savedEntry(tx,owner.id,id);
  });
}
export async function saveJournalEntry(authUserId:string,id:string,saved:boolean) {
  if(!JOURNAL_UUID.test(id)) throw new JournalError(404,"Entry not found.");
  const owner=await journalOwner(authUserId,true);const sql=getApplicationDatabase();
  return sql.begin(async tx=>{
    await lockJournal(tx,owner.identity);
    const rows=await tx<EntryRow[]>`update member_journal_entries set saved=${saved},updated_by_auth_user_id=${authUserId}::uuid
      where id=${id}::uuid and member_id=${owner.id}::uuid and deleted_at is null returning *`;
    if(!rows.length) throw new JournalError(404,"Entry not found.");
    return (await entriesWithMedia(owner.id,rows,tx))[0]!;
  });
}
export async function deleteJournalEntry(authUserId:string,id:string,expectedVersion:string) {
  validateJournalVersion(expectedVersion);
  if(!JOURNAL_UUID.test(id)) throw new JournalError(404,"Entry not found.");
  const owner=await journalOwner(authUserId,true);
  await getApplicationDatabase().begin(async tx=>{
    await lockJournal(tx,owner.identity);
    const [row]=await tx<EntryRow[]>`select * from member_journal_entries where id=${id}::uuid and member_id=${owner.id}::uuid for update`;
    if(!row) throw new JournalError(404,"Entry not found.");
    if(row.deleted_at) return;
    if(String(row.current_version)!==expectedVersion) throw new JournalError(409,"This entry changed. Load the latest entry before deleting it.");
    await tx`update member_journal_entries set deleted_at=statement_timestamp(),updated_by_auth_user_id=${authUserId}::uuid where id=${id}::uuid and member_id=${owner.id}::uuid`;
  });
}
export async function journalMediaUrl(authUserId:string,id:string) {
  if(!JOURNAL_UUID.test(id)) throw new JournalError(404,"Media not found.");
  const owner=await journalOwner(authUserId);const sql=getApplicationDatabase();
  const [row]=await sql<{storage_path:string}[]>`select m.storage_path from member_journal_media m join member_journal_entries e on e.id=m.entry_id and e.member_id=m.member_id where m.id=${id}::uuid and m.member_id=${owner.id}::uuid and m.state='ready' and m.removed_at is null and e.deleted_at is null`;
  if(!row) throw new JournalError(404,"Media not found.");
  const {data,error}=await journalStore().createSignedUrl(row.storage_path,3600);
  if(error || !data) throw new JournalError(503,"This media is temporarily unavailable.");
  return data.signedUrl;
}
