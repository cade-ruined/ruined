import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { getMemberIdentity, requireLockedMemberWriteAccess, MembershipAccessDeniedError } from "@/lib/membership/repository";
import type { MemberIdentity } from "./model";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { JournalError, journalFilePolicy, validateJournalInput, validateJournalDraftInput, validateJournalVersion, type JournalDraftEntry, type JournalDraftSnapshot, type JournalCreateInput, type JournalEditInput, type JournalEntry, type JournalSnapshot, type JournalListOptions, type TimelineReflection, JOURNAL_UUID } from "./journal-model";
import { getOwnMemberProfilePublicScope } from "./public-card-repository";
import { journalStore, journalStorageConfigured, validateJournalMedia } from "./journal-storage";

type Sql = ReturnType<typeof getApplicationDatabase> | postgres.TransactionSql;
type EntryRow = { visibility:"private"|"public"; id:string; kind:JournalEntry["kind"]; title:string|null; body:string|null; created_at:Date|string; saved:boolean; event_year:number|null; event_month:number|null; event_day:number|null; include_on_timeline:boolean; current_version:number; deleted_at:Date|null; timeline_position:number|null; timeline_reflection?:TimelineReflection|null; foundations_meaning?:string|null; foundations_belief?:string|null; foundations_present_impact?:string|null; foundations_perspective?:string|null };
type DraftRow = Omit<EntryRow,"visibility"|"saved"|"include_on_timeline"|"timeline_position"> & { updated_at:Date|string; completed_at:Date|string|null };
type MediaRow = { id:string; draft_id?:string|null; entry_id:string|null; storage_path:string; mime_type:string; byte_size:number|string; verified_at:Date|null; state:string; created_at:Date|string; removed_at:Date|null };
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
function legacyTimelineReflection(row:EntryRow):TimelineReflection|undefined {
  if(row.visibility!=="private" || !row.include_on_timeline) return undefined;
  const reflection={meaning:row.foundations_meaning??null,belief:row.foundations_belief??null,presentImpact:row.foundations_present_impact??null,perspective:row.foundations_perspective??null};
  return Object.values(reflection).some(value=>value?.trim()) ? reflection : undefined;
}
async function entriesWithMedia(memberId:string, rows:EntryRow[], sql:Sql=getApplicationDatabase()):Promise<JournalEntry[]> {
  if (!rows.length) return [];
  const media=await sql<MediaRow[]>`select id,entry_id,mime_type,byte_size from member_journal_media where member_id=${memberId}::uuid and entry_id in ${sql(rows.map(row=>row.id))} and state='ready' and removed_at is null order by position,id`;
  return rows.map(row=>({id:row.id,kind:row.kind,title:row.title,body:row.body,createdAt:new Date(row.created_at).toISOString(),saved:row.saved,
    eventYear:row.event_year,eventMonth:row.event_month,eventDay:row.event_day,includeOnTimeline:row.include_on_timeline,version:String(row.current_version),visibility:row.visibility,
    ...(row.timeline_reflection ? {timelineReflection:row.timeline_reflection} : {}),
    ...(legacyTimelineReflection(row) ? {legacyTimelineReflection:legacyTimelineReflection(row)} : {}),
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
  const collection=options.collection ?? null;
  if(collection!==null && collection!=="private" && collection!=="public") throw new JournalError(400,"Choose a valid journal collection.");
  const oldest=options.order==="oldest";
  // Cursor position is derived from the same filtered owner-only result. A
  // foreign or deleted cursor can never reveal another member's content.
  const rows=await sql<EntryRow[]>`with dated as (
    select *,coalesce(event_year,case when visibility='public' and include_on_timeline then extract(year from created_at at time zone 'UTC')::integer end) as timeline_year,
      case when event_year is null then extract(month from created_at at time zone 'UTC')::integer else event_month end as timeline_month,
      case when event_year is null then extract(day from created_at at time zone 'UTC')::integer else event_day end as timeline_day
    from member_journal_entries where member_id=${owner.id}::uuid and deleted_at is null
  ), filtered as (
    select * from dated where (${!saved} or saved) and (${!timeline && collection!=="public"} or include_on_timeline)
      and (${collection===null} or (${collection==="private"} and not (visibility='public' and include_on_timeline)) or (${collection==="public"} and visibility='public'))
      and (${year===null} or timeline_year=${year}::integer)
      and (${!search} or strpos(lower(coalesce(title,'') || ' ' || coalesce(body,'')),lower(${search}))>0)
  ), ordered as (
    select *,row_number() over (order by
      case when ${timeline && oldest} then timeline_year end asc,
      case when ${timeline && !oldest} then timeline_year end desc,
      case when ${timeline} then (timeline_month is null)::integer end asc,
      case when ${timeline && oldest} then timeline_month end asc,
      case when ${timeline && !oldest} then timeline_month end desc,
      case when ${timeline} then (timeline_day is null)::integer end asc,
      case when ${timeline && oldest} then timeline_day end asc,
      case when ${timeline && !oldest} then timeline_day end desc,
      case when ${timeline} then timeline_position end asc,
      case when ${!timeline && oldest} then created_at end asc,
      case when ${!timeline && !oldest} then created_at end desc,id asc) as ordinal from filtered
  ) select * from ordered where (${cursor===null} or ordinal>(select ordinal from ordered where id=${cursor}::uuid)) order by ordinal limit 31`;
  const [summary]=await sql<{total:number;years:number[]}[]>`with dated as (
    select *,coalesce(event_year,case when visibility='public' and include_on_timeline then extract(year from created_at at time zone 'UTC')::integer end) as timeline_year
    from member_journal_entries where member_id=${owner.id}::uuid and deleted_at is null
  ) select
    count(*) filter(where (${year===null} or timeline_year=${year}::integer))::integer as total,
    coalesce(array_agg(distinct timeline_year order by timeline_year desc) filter(where timeline_year is not null),'{}'::integer[]) as years
    from dated where (${!saved} or saved) and (${!timeline && collection!=="public"} or include_on_timeline)
      and (${collection===null} or (${collection==="private"} and not (visibility='public' and include_on_timeline)) or (${collection==="public"} and visibility='public'))
      and (${!search} or strpos(lower(coalesce(title,'') || ' ' || coalesce(body,'')),lower(${search}))>0)`;
  const page=rows.slice(0,30);
  return {entries:await entriesWithMedia(owner.id,page),hasMore:rows.length>30,nextCursor:rows.length>30 ? page.at(-1)!.id : null,
    total:summary?.total ?? 0,years:summary?.years ?? [],writable:owner.writable,mediaReady:journalStorageConfigured(),
    publicUrl: await ownPublicJournalUrl(owner.id)};
}
export async function exportJournalTimeline(authUserId:string, collection?:"private"|"public"):Promise<JournalEntry[]> {
  const owner=await journalOwner(authUserId); const sql=getApplicationDatabase();
  const rows=await sql<EntryRow[]>`select * from member_journal_entries where member_id=${owner.id}::uuid and deleted_at is null and include_on_timeline
      and (${collection===undefined} or visibility=${collection??null})
    order by coalesce(event_year,extract(year from created_at at time zone 'UTC')::integer),
      coalesce(event_month,case when event_year is null then extract(month from created_at at time zone 'UTC')::integer else 13 end),
      coalesce(event_day,case when event_year is null then extract(day from created_at at time zone 'UTC')::integer else 32 end),timeline_position,created_at,id`;
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

async function prepareEntryMedia(memberId:string, input:JournalCreateInput, fromDraft=false) {
  const sql=getApplicationDatabase();
  for(const id of input.mediaIds) {
    const [file]=await sql<MediaRow[]>`select * from member_journal_media where id=${id}::uuid and member_id=${memberId}::uuid`;
    if(file?.state==="ready" && (fromDraft ? file.draft_id===input.id : file.entry_id===input.id) && journalFilePolicy(file.mime_type,Number(file.byte_size))===input.kind) continue;
    await verifyUpload(memberId,id,input.kind);
  }
}
async function ownPublicJournalUrl(memberId:string, sql:Sql=getApplicationDatabase()) {
  const scope=await getOwnMemberProfilePublicScope(memberId,sql);
  return scope ? `/profile/${scope.token}` : null;
}
async function requireJournalPublication(memberId:string, input:JournalCreateInput, tx:postgres.TransactionSql) {
  if(input.visibility!=="public") return;
  // Publication depends on current member eligibility, never card sharing controls.
  if(!await ownPublicJournalUrl(memberId,tx)) throw new JournalError(403,"Your profile is not available for public Timeline posts.");
}
function sameTimelineReflection(left:TimelineReflection|null|undefined,right:TimelineReflection|null) {
  if(!left || !right) return (left??null)===right;
  return (["meaning","belief","presentImpact","perspective"] as const).every(field=>left[field]===right[field]);
}
function inputMatches(entry:JournalEntry,input:JournalCreateInput) {
  return entry.kind===input.kind && entry.title===(input.title||null) && entry.body===(input.body||null)
    && entry.eventYear===(input.eventYear??null) && entry.eventMonth===(input.eventMonth??null) && entry.eventDay===(input.eventDay??null)
    && entry.includeOnTimeline===(input.includeOnTimeline===true)
    && (input.visibility===undefined || entry.visibility===input.visibility)
    && (input.timelineReflection===undefined || sameTimelineReflection(entry.timelineReflection,input.timelineReflection))
    && entry.media.map(file=>file.id).join(",")===input.mediaIds.join(",");
}
async function applyMedia(tx:postgres.TransactionSql, memberId:string,input:JournalCreateInput, fromDraft=false) {
  const files=await tx<MediaRow[]>`select * from member_journal_media where member_id=${memberId}::uuid and entry_id=${input.id}::uuid and state='ready' for update`;
  for(const file of files) if(!input.mediaIds.includes(file.id) && file.removed_at===null) {
    await tx`update member_journal_media set removed_at=statement_timestamp() where id=${file.id}::uuid and member_id=${memberId}::uuid`;
  }
  for(const [position,id] of input.mediaIds.entries()) {
    const [file]=await tx<MediaRow[]>`select * from member_journal_media where id=${id}::uuid and member_id=${memberId}::uuid for update`;
    if(!file || !file.verified_at || (file.state!=="pending" && !(file.state==="ready" && (fromDraft ? file.draft_id===input.id : file.entry_id===input.id)))
      || journalFilePolicy(file.mime_type,Number(file.byte_size))!==input.kind) throw new JournalError(400,"An upload is no longer available.");
    await tx`update member_journal_media set entry_id=${input.id}::uuid,draft_id=null,state='ready',position=${position},removed_at=null
      where id=${id}::uuid and member_id=${memberId}::uuid`;
  }
}
async function savedEntry(tx:Sql,memberId:string,id:string) {
  const rows=await tx<EntryRow[]>`select * from member_journal_entries where id=${id}::uuid and member_id=${memberId}::uuid`;
  return (await entriesWithMedia(memberId,rows,tx))[0]!;
}
async function insertJournalEntry(tx:postgres.TransactionSql,memberId:string,actor:string,input:JournalCreateInput) {
    await tx`insert into member_journal_entries(id,member_id,kind,title,body,event_year,event_month,event_day,include_on_timeline,timeline_position,updated_by_auth_user_id,visibility,timeline_reflection)
      select ${input.id}::uuid,${memberId}::uuid,${input.kind},${input.title||null},${input.body||null},${input.eventYear??null},${input.eventMonth??null},${input.eventDay??null},${input.includeOnTimeline===true},
        case when ${input.includeOnTimeline===true} then coalesce(max(timeline_position),0)+1 else null end,${actor}::uuid,${input.visibility??"private"},${input.timelineReflection ? tx.json(input.timelineReflection) : null}::jsonb
      from member_journal_entries where member_id=${memberId}::uuid`;
}
export async function createJournalEntry(authUserId:string,value:JournalCreateInput):Promise<JournalEntry> {
  const normalized=validateJournalInput(value), input={...normalized,visibility:normalized.visibility??"private" as const}, owner=await journalOwner(authUserId,true), sql=getApplicationDatabase();
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
    const drafts=await tx`select id from member_journal_drafts where id=${input.id}::uuid`;
    if(drafts.length) throw new JournalError(409,"Open this draft to finish it, or start a new entry.");
    await requireJournalPublication(owner.id,input,tx);
    await insertJournalEntry(tx,owner.id,authUserId,input);
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
    if(row.visibility!=="public" && input.visibility==="public" && row.timeline_reflection && input.timelineReflection===undefined) {
      throw new JournalError(409,"Open this Timeline story and review all of its answers before publishing.");
    }
    if(row.visibility==="public" && input.visibility===undefined) throw new JournalError(409,"This entry is public. Open the current Journal editor to review its sharing choice before saving.");
    if(String(row.current_version)!==expectedVersion) throw new JournalError(409,"This entry changed in another window. Your draft is still here. Load the latest entry before saving.");
    await requireJournalPublication(owner.id,input,tx);
    const nextReflection=input.timelineReflection===undefined ? row.timeline_reflection??null : input.timelineReflection;
    if(nextReflection && (!input.eventYear || !input.title.trim())) throw new JournalError(400,"Add a year and title to this Timeline story.");
    await tx`update member_journal_entries set visibility=${input.visibility??row.visibility},kind=${input.kind},title=${input.title||null},body=${input.body||null},timeline_reflection=${nextReflection ? tx.json(nextReflection) : null}::jsonb,
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
  const [row]=await sql<{storage_path:string}[]>`select m.storage_path from member_journal_media m
    left join member_journal_entries e on e.id=m.entry_id and e.member_id=m.member_id
    left join member_journal_drafts d on d.id=m.draft_id and d.member_id=m.member_id
    where m.id=${id}::uuid and m.member_id=${owner.id}::uuid and m.state='ready' and m.removed_at is null
      and ((e.id is not null and e.deleted_at is null) or (d.id is not null and d.deleted_at is null and d.completed_at is null))`;
  if(!row) throw new JournalError(404,"Media not found.");
  const {data,error}=await journalStore().createSignedUrl(row.storage_path,3600);
  if(error || !data) throw new JournalError(503,"This media is temporarily unavailable.");
  return data.signedUrl;
}

async function draftsWithMedia(memberId:string,rows:DraftRow[],sql:Sql=getApplicationDatabase()):Promise<JournalDraftEntry[]> {
  if(!rows.length) return [];
  const media=await sql<MediaRow[]>`select id,draft_id,mime_type,byte_size from member_journal_media where member_id=${memberId}::uuid
    and draft_id in ${sql(rows.map(row=>row.id))} and state='ready' and removed_at is null order by position,id`;
  return rows.map(row=>({id:row.id,kind:row.kind,title:row.title,body:row.body,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString(),
    saved:false,eventYear:row.event_year,eventMonth:row.event_month,eventDay:row.event_day,includeOnTimeline:false,visibility:'private',version:String(row.current_version),
    ...(row.timeline_reflection ? {timelineReflection:row.timeline_reflection} : {}),
    media:media.filter(file=>file.draft_id===row.id).map(file=>({id:file.id,mimeType:file.mime_type,size:Number(file.byte_size),url:`/api/my/journal/media/${file.id}`}))}));
}
async function savedDraft(tx:Sql,memberId:string,id:string) {
  const rows=await tx<DraftRow[]>`select * from member_journal_drafts where id=${id}::uuid and member_id=${memberId}::uuid`;
  return (await draftsWithMedia(memberId,rows,tx))[0]!;
}
export async function getJournalDraft(authUserId:string,id:string):Promise<JournalDraftEntry> {
  if(!JOURNAL_UUID.test(id)) throw new JournalError(404,"Draft not found.");
  const owner=await journalOwner(authUserId),sql=getApplicationDatabase();
  const rows=await sql<DraftRow[]>`select * from member_journal_drafts where member_id=${owner.id}::uuid and id=${id}::uuid and deleted_at is null and completed_at is null`;
  if(!rows.length) throw new JournalError(404,"Draft not found.");
  return (await draftsWithMedia(owner.id,rows,sql))[0]!;
}
export async function getJournalDrafts(authUserId:string,cursor:string|null=null):Promise<JournalDraftSnapshot> {
  if(cursor && !JOURNAL_UUID.test(cursor)) throw new JournalError(400,"Invalid drafts page.");
  const owner=await journalOwner(authUserId),sql=getApplicationDatabase();
  const rows=await sql<DraftRow[]>`with ordered as (
    select *,row_number() over(order by updated_at desc,id) as ordinal from member_journal_drafts
    where member_id=${owner.id}::uuid and deleted_at is null and completed_at is null
  ) select * from ordered where (${cursor===null} or ordinal>(select ordinal from ordered where id=${cursor}::uuid)) order by ordinal limit 31`;
  const [summary]=await sql<{total:number}[]>`select count(*)::integer as total from member_journal_drafts where member_id=${owner.id}::uuid and deleted_at is null and completed_at is null`;
  const page=rows.slice(0,30);
  return {entries:await draftsWithMedia(owner.id,page,sql),total:summary?.total??0,hasMore:rows.length>30,nextCursor:rows.length>30?page.at(-1)!.id:null,writable:owner.writable,mediaReady:journalStorageConfigured()};
}
async function applyDraftMedia(tx:postgres.TransactionSql,memberId:string,input:JournalCreateInput) {
  await tx`update member_journal_media set removed_at=statement_timestamp() where member_id=${memberId}::uuid and draft_id=${input.id}::uuid and state='ready' and removed_at is null`;
  for(const [position,id] of input.mediaIds.entries()) {
    const [file]=await tx<MediaRow[]>`select * from member_journal_media where id=${id}::uuid and member_id=${memberId}::uuid for update`;
    if(!file || !file.verified_at || (file.state!=="pending" && !(file.state==="ready" && file.draft_id===input.id))
      || journalFilePolicy(file.mime_type,Number(file.byte_size))!==input.kind) throw new JournalError(400,"An upload is no longer available.");
    await tx`update member_journal_media set draft_id=${input.id}::uuid,entry_id=null,state='ready',position=${position},removed_at=null where id=${id}::uuid and member_id=${memberId}::uuid`;
  }
}
export async function createJournalDraft(authUserId:string,value:JournalCreateInput):Promise<JournalDraftEntry> {
  const input=validateJournalDraftInput(value),owner=await journalOwner(authUserId,true),sql=getApplicationDatabase();
  await prepareEntryMedia(owner.id,input,true);
  return sql.begin(async tx=>{
    await lockJournal(tx,owner.identity);
    const [current]=await tx<DraftRow[]>`select * from member_journal_drafts where id=${input.id}::uuid and member_id=${owner.id}::uuid for update`;
    if(current) {
      const draft=await savedDraft(tx,owner.id,input.id);
      if(!current.deleted_at && !current.completed_at && inputMatches(draft,input)) return draft;
      throw new JournalError(409,"This draft has already changed. Open the latest draft before saving.");
    }
    const existing=await tx`select id from member_journal_entries where id=${input.id}::uuid`;
    if(existing.length) throw new JournalError(409,"This entry has already been saved. Start a new draft.");
    const [count]=await tx<{total:number}[]>`select count(*)::integer as total from member_journal_drafts where member_id=${owner.id}::uuid and deleted_at is null and completed_at is null`;
    if(count.total>=500) throw new JournalError(429,"You have 500 drafts. Finish or delete a draft before starting another.");
    await tx`insert into member_journal_drafts(id,member_id,kind,title,body,event_year,event_month,event_day,timeline_reflection)
      values(${input.id}::uuid,${owner.id}::uuid,${input.kind},${input.title||null},${input.body||null},${input.eventYear??null},${input.eventMonth??null},${input.eventDay??null},${input.timelineReflection?tx.json(input.timelineReflection):null}::jsonb)`;
    await applyDraftMedia(tx,owner.id,input);
    return savedDraft(tx,owner.id,input.id);
  });
}
export async function editJournalDraft(authUserId:string,id:string,value:JournalEditInput):Promise<JournalDraftEntry> {
  const expectedVersion=validateJournalVersion(value.expectedVersion),{expectedVersion:version,...fields}=value;void version;
  const input=validateJournalDraftInput({...fields,id}),owner=await journalOwner(authUserId,true),sql=getApplicationDatabase();
  await getJournalDraft(authUserId,id);
  await prepareEntryMedia(owner.id,input,true);
  return sql.begin(async tx=>{
    await lockJournal(tx,owner.identity);
    const [row]=await tx<DraftRow[]>`select * from member_journal_drafts where id=${id}::uuid and member_id=${owner.id}::uuid and deleted_at is null and completed_at is null for update`;
    if(!row) throw new JournalError(404,"Draft not found.");
    const current=await savedDraft(tx,owner.id,id);
    if(inputMatches(current,input)) return current;
    if(String(row.current_version)!==expectedVersion) throw new JournalError(409,"This draft changed in another window. Your words are still here. Open the latest draft before saving.");
    const reflection=input.timelineReflection===undefined?row.timeline_reflection??null:input.timelineReflection;
    await tx`update member_journal_drafts set kind=${input.kind},title=${input.title||null},body=${input.body||null},event_year=${input.eventYear??null},event_month=${input.eventMonth??null},event_day=${input.eventDay??null},
      timeline_reflection=${reflection?tx.json(reflection):null}::jsonb where id=${id}::uuid and member_id=${owner.id}::uuid`;
    await applyDraftMedia(tx,owner.id,input);
    return savedDraft(tx,owner.id,id);
  });
}
export async function completeJournalDraft(authUserId:string,id:string,value:JournalEditInput):Promise<JournalEntry> {
  const expectedVersion=validateJournalVersion(value.expectedVersion),{expectedVersion:version,...fields}=value;void version;
  const normalized=validateJournalInput({...fields,id}),input={...normalized,visibility:normalized.visibility??"private" as const},owner=await journalOwner(authUserId,true),sql=getApplicationDatabase();
  const [prior]=await sql<DraftRow[]>`select * from member_journal_drafts where id=${id}::uuid and member_id=${owner.id}::uuid and deleted_at is null`;
  if(!prior) throw new JournalError(404,"Draft not found.");
  if(!prior.completed_at) {
    try { await prepareEntryMedia(owner.id,input,true); }
    catch(error) {
      // Another identical completion can move attachments while this request
      // is verifying them. Let the locked idempotency check decide the result.
      const [latest]=await sql<DraftRow[]>`select * from member_journal_drafts where id=${id}::uuid and member_id=${owner.id}::uuid and deleted_at is null`;
      if(!latest?.completed_at) throw error;
    }
  }
  return sql.begin(async tx=>{
    await lockJournal(tx,owner.identity);
    const [row]=await tx<DraftRow[]>`select * from member_journal_drafts where id=${id}::uuid and member_id=${owner.id}::uuid and deleted_at is null for update`;
    if(!row) throw new JournalError(404,"Draft not found.");
    if(row.completed_at) {
      const [finished]=await tx<EntryRow[]>`select * from member_journal_entries where id=${id}::uuid and member_id=${owner.id}::uuid and deleted_at is null`;
      if(finished) {const entry=await savedEntry(tx,owner.id,id);if(inputMatches(entry,input)) return entry;}
      throw new JournalError(409,"This draft has already been finished. Open the saved entry.");
    }
    if(String(row.current_version)!==expectedVersion) throw new JournalError(409,"This draft changed in another window. Open the latest draft before finishing.");
    // Never implicitly discard reviewed reflection answers from an older client.
    if(row.timeline_reflection && input.timelineReflection===undefined) throw new JournalError(409,"Review this draft's reflection answers before finishing.");
    await requireJournalPublication(owner.id,input,tx);
    await insertJournalEntry(tx,owner.id,authUserId,input);
    await applyMedia(tx,owner.id,input,true);
    await tx`update member_journal_media set removed_at=statement_timestamp() where member_id=${owner.id}::uuid and draft_id=${id}::uuid and removed_at is null`;
    await tx`update member_journal_drafts set completed_at=statement_timestamp() where id=${id}::uuid and member_id=${owner.id}::uuid`;
    return savedEntry(tx,owner.id,id);
  });
}
export async function deleteJournalDraft(authUserId:string,id:string,expectedVersion:string) {
  validateJournalVersion(expectedVersion);
  if(!JOURNAL_UUID.test(id)) throw new JournalError(404,"Draft not found.");
  const owner=await journalOwner(authUserId,true);
  await getApplicationDatabase().begin(async tx=>{
    await lockJournal(tx,owner.identity);
    const [row]=await tx<DraftRow[]>`select * from member_journal_drafts where id=${id}::uuid and member_id=${owner.id}::uuid for update`;
    if(!row || row.completed_at) throw new JournalError(404,"Draft not found.");
    if(row.deleted_at) return;
    if(String(row.current_version)!==expectedVersion) throw new JournalError(409,"This draft changed. Open the latest draft before deleting it.");
    await tx`update member_journal_drafts set deleted_at=statement_timestamp() where id=${id}::uuid and member_id=${owner.id}::uuid`;
  });
}
