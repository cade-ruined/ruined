import "server-only";
import { randomUUID } from "node:crypto";
import { getApplicationDatabase } from "@/lib/database/server";
import { getMemberIdentity } from "@/lib/membership/repository";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { JournalError, journalFilePolicy, type JournalCreateInput, type JournalEntry, type JournalSnapshot, JOURNAL_UUID } from "./journal-model";
import { journalStore, journalStorageConfigured, validateJournalMedia } from "./journal-storage";

type EntryRow = {id:string;kind:JournalEntry["kind"];title:string|null;body:string|null;created_at:Date|string;saved:boolean};
type MediaRow = {id:string;entry_id:string|null;storage_path:string;mime_type:string;byte_size:number|string;verified_at:Date|null;state:string;created_at:Date|string};
export async function journalOwner(authUserId:string, write=false) {
  const identity=await getMemberIdentity(authUserId);
  if (!identity) throw new JournalError(403,"Member access is required.");
  const access=deriveMemberAccessPolicy(identity,identity.cancellationEffectiveAt);
  if (!memberCan(access,write ? "profile.write" : "profile.read")) throw new JournalError(403,"Your account cannot access this journal.");
  return {id:identity.memberId,writable:memberCan(access,"profile.write")};
}
async function entriesWithMedia(memberId:string, rows:EntryRow[]):Promise<JournalEntry[]> {
  if (!rows.length) return [];
  const sql=getApplicationDatabase();
  const media=await sql<MediaRow[]>`select id,entry_id,mime_type,byte_size from member_journal_media where member_id=${memberId}::uuid and entry_id in ${sql(rows.map(row=>row.id))} and state='ready' order by position`;
  return rows.map(row=>({id:row.id,kind:row.kind,title:row.title,body:row.body,createdAt:new Date(row.created_at).toISOString(),saved:row.saved,media:media.filter(item=>item.entry_id===row.id).map(item=>({id:item.id,mimeType:item.mime_type,size:Number(item.byte_size),url:`/api/my/journal/media/${item.id}`}))}));
}
export async function getJournal(authUserId:string, cursor:string|null=null, saved=false):Promise<JournalSnapshot> {
  const owner=await journalOwner(authUserId); const sql=getApplicationDatabase();
  if (cursor && !JOURNAL_UUID.test(cursor)) throw new JournalError(400,"Invalid journal page.");
  const rows=await sql<EntryRow[]>`select id,kind,title,body,created_at,saved from member_journal_entries
    where member_id=${owner.id}::uuid and deleted_at is null and (${!saved} or saved=true)
    and (${cursor===null} or (created_at,id)<(select created_at,id from member_journal_entries where id=${cursor}::uuid and member_id=${owner.id}::uuid))
    order by created_at desc,id desc limit 31`;
  return {entries:await entriesWithMedia(owner.id,rows.slice(0,30)),hasMore:rows.length>30,writable:owner.writable,mediaReady:journalStorageConfigured()};
}
export async function prepareJournalUpload(authUserId:string, value:unknown) {
  if (!value || typeof value!=="object") throw new JournalError(400,"Choose a file.");
  const input=value as Record<string,unknown>;
  if (Object.keys(input).some(key=>!["mimeType","size"].includes(key)) || typeof input.mimeType!=="string" || typeof input.size!=="number") throw new JournalError(400,"Choose a file.");
  journalFilePolicy(input.mimeType,input.size);
  const owner=await journalOwner(authUserId,true);const sql=getApplicationDatabase();const id=randomUUID(); const path=`${owner.id}/pending/${id}`;
  // Serialize quota checks per member so concurrent requests cannot over-reserve.
  await sql.begin(async tx=>{
    await tx`select id from ruined_members where id=${owner.id}::uuid for update`;
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
export async function createJournalEntry(authUserId:string,input:JournalCreateInput):Promise<JournalEntry> {
  const owner=await journalOwner(authUserId,true);const sql=getApplicationDatabase();
  const existing=await sql<EntryRow[]>`select * from member_journal_entries where id=${input.id}::uuid and member_id=${owner.id}::uuid and deleted_at is null`;
  if(existing.length) return (await entriesWithMedia(owner.id,existing))[0];
  for(const id of input.mediaIds) await verifyUpload(owner.id,id,input.kind);
  const row=await sql.begin(async tx=>{
    await tx`select id from ruined_members where id=${owner.id}::uuid for update`;
    const repeated=await tx<EntryRow[]>`select * from member_journal_entries where id=${input.id}::uuid and member_id=${owner.id}::uuid and deleted_at is null`;
    if(repeated.length) return repeated[0];
    for(const id of input.mediaIds){
      const [file]=await tx<MediaRow[]>`select * from member_journal_media where id=${id}::uuid and member_id=${owner.id}::uuid for update`;
      if(!file || file.state!=="pending" || !file.verified_at || journalFilePolicy(file.mime_type,Number(file.byte_size))!==input.kind) throw new JournalError(400,"An upload is no longer available.");
    }
    const [entry]=await tx<EntryRow[]>`insert into member_journal_entries(id,member_id,kind,title,body) values(${input.id}::uuid,${owner.id}::uuid,${input.kind},${input.title||null},${input.body||null}) returning *`;
    for(const [position,id] of input.mediaIds.entries()) await tx`update member_journal_media set entry_id=${input.id}::uuid,state='ready',position=${position} where id=${id}::uuid and member_id=${owner.id}::uuid`;
    return entry;
  });
  return (await entriesWithMedia(owner.id,[row]))[0];
}
export async function saveJournalEntry(authUserId:string,id:string,saved:boolean) {
  if(!JOURNAL_UUID.test(id)) throw new JournalError(404,"Entry not found.");
  const owner=await journalOwner(authUserId,true);const sql=getApplicationDatabase();
  const rows=await sql<EntryRow[]>`update member_journal_entries set saved=${saved},updated_at=now() where id=${id}::uuid and member_id=${owner.id}::uuid and deleted_at is null returning *`;
  if(!rows.length) throw new JournalError(404,"Entry not found.");
  return (await entriesWithMedia(owner.id,rows))[0];
}
export async function journalMediaUrl(authUserId:string,id:string) {
  if(!JOURNAL_UUID.test(id)) throw new JournalError(404,"Media not found.");
  const owner=await journalOwner(authUserId);const sql=getApplicationDatabase();
  const [row]=await sql<{storage_path:string}[]>`select m.storage_path from member_journal_media m join member_journal_entries e on e.id=m.entry_id and e.member_id=m.member_id where m.id=${id}::uuid and m.member_id=${owner.id}::uuid and m.state='ready' and e.deleted_at is null`;
  if(!row) throw new JournalError(404,"Media not found.");
  const {data,error}=await journalStore().createSignedUrl(row.storage_path,3600);
  if(error || !data) throw new JournalError(503,"This media is temporarily unavailable.");
  return data.signedUrl;
}
