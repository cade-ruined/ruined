import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import sharp from 'sharp';
import {timelineFixture,timelineIds} from './helpers/canonical-journal-fixture.mjs';
const source=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
async function load(path,deps={}){const code=ts.transpileModule(await source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const mod={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,`Unexpected dependency: ${name}`);return deps[name];},mod,mod.exports);return mod.exports;}
const model=await load('src/lib/membership/journal-model.ts');
const policy=await load('src/lib/membership/access-policy.ts');
const draft=(changes={})=>({id:randomUUID(),kind:'text',title:'',body:'Unfinished private words.',mediaIds:[],eventYear:null,eventMonth:null,eventDay:null,visibility:'private',includeOnTimeline:false,...changes});
const edit=(input,version='1')=>{const {id,...fields}=input;void id;return {...fields,expectedVersion:version};};
async function fixture(t) {
  const base=await timelineFixture(t), blobs=new Map(), signed=[];
  const storage=await load('src/lib/membership/journal-storage.ts',{'server-only':{},'@supabase/supabase-js':{},sharp,'./journal-model':model});
  const store={createSignedUploadUrl:async path=>({data:{signedUrl:`https://storage.test/${path}`}}),download:async path=>({data:blobs.get(path)}),
    upload:async(path,data,options)=>{blobs.set(path,new Blob([data],{type:options.contentType}));return {};},remove:async paths=>{paths.forEach(path=>blobs.delete(path));return {};},
    createSignedUrl:async path=>{signed.push(path);return {data:{signedUrl:`https://storage.test/${path}`}};}};
  let publicScope=null;
  const repo=await load('src/lib/membership/journal-repository.ts',{'server-only':{},'node:crypto':{randomUUID},'@/lib/database/server':{getApplicationDatabase:()=>base.sql},
    '@/lib/membership/repository':base.repository,'@/lib/membership/access-policy':policy,'./journal-model':model,
    './public-card-repository':{getOwnMemberProfilePublicScope:async()=>publicScope},'./journal-storage':{...storage,journalStore:()=>store,journalStorageConfigured:()=>true}});
  const upload=async()=>{const png=await sharp({create:{width:8,height:8,channels:3,background:'#ffca2c'}}).png().toBuffer();const reserved=await repo.prepareJournalUpload(timelineIds.auth,{mimeType:'image/png',size:png.length});const [row]=(await base.db.query('select storage_path from member_journal_media where id=$1',[reserved.id])).rows;blobs.set(row.storage_path,new Blob([png],{type:'image/png'}));return reserved.id;};
  return {...base,repo,blobs,signed,upload,allowPublic(){publicScope={token:'test-profile'};}};
}
test('draft input accepts incomplete entries but forces privacy and retains input bounds',()=>{
  for(const kind of ['text','images','video']) {const input=model.validateJournalDraftInput(draft({kind,body:'',visibility:'public',includeOnTimeline:true}));assert.equal(input.visibility,'private');assert.equal(input.includeOnTimeline,false);}
  const reflection={meaning:'Unfinished',belief:null,presentImpact:null,perspective:null};assert.deepEqual(model.validateJournalDraftInput(draft({timelineReflection:reflection})).timelineReflection,reflection);
  for(const changes of [{body:'x'.repeat(20001)},{title:'x'.repeat(201)},{eventYear:2026,eventMonth:2,eventDay:29},{kind:'images',mediaIds:Array.from({length:9},()=>randomUUID())},{kind:'text',mediaIds:[randomUUID()]},{memberId:randomUUID()}]) assert.throws(()=>model.validateJournalDraftInput(draft(changes)),model.JournalError);
  assert.throws(()=>model.validateJournalInput(draft({body:''})),model.JournalError);
});
test('multiple drafts survive reload separately, are private, and never create entry or badge evidence',async t=>{
  const f=await fixture(t),one=draft(),two=draft({body:'A second unfinished thought.'});
  const first=await f.repo.createJournalDraft(timelineIds.auth,one);await f.repo.createJournalDraft(timelineIds.auth,two);
  assert.equal((await f.repo.createJournalDraft(timelineIds.auth,one)).version,first.version);
  const listed=await f.repo.getJournalDrafts(timelineIds.auth);assert.equal(listed.entries.length,2);assert.equal(listed.total,2);
  assert.ok(listed.entries.every(entry=>entry.visibility==='private'&&!entry.includeOnTimeline&&!entry.saved&&entry.updatedAt));
  assert.equal((await f.repo.getJournalDraft(timelineIds.auth,first.id)).body,one.body);
  assert.equal((await f.repo.getJournal(timelineIds.auth)).total,0);
  assert.equal((await f.repo.getJournal(timelineIds.auth,null,true)).total,0);
  assert.equal((await f.repo.getJournal(timelineIds.auth,null,false,{collection:'public'})).total,0);
  assert.equal((await f.repo.exportJournalTimeline(timelineIds.auth)).length,0);
  assert.equal((await f.db.query('select count(*)::integer as count from member_journal_entry_versions')).rows[0].count,0);
  await assert.rejects(()=>f.repo.getJournalEntry(timelineIds.auth,first.id),error=>error.status===404);
  assert.equal((await f.repo.getJournalDrafts(timelineIds.otherAuth)).total,0);
  for(const operation of [()=>f.repo.getJournalDraft(timelineIds.otherAuth,first.id),()=>f.repo.editJournalDraft(timelineIds.otherAuth,first.id,edit(one)),()=>f.repo.deleteJournalDraft(timelineIds.otherAuth,first.id,'1'),()=>f.repo.completeJournalDraft(timelineIds.otherAuth,first.id,edit(one))]) await assert.rejects(operation,error=>error.status===404);
  const grants=(await f.db.query("select has_table_privilege('anon','member_journal_drafts','select') as anon,has_table_privilege('authenticated','member_journal_drafts','select') as authenticated,has_table_privilege('service_role','member_journal_drafts','select,insert,update,delete') as service,relrowsecurity from pg_class where relname='member_journal_drafts' ")).rows[0];
  assert.deepEqual(grants,{anon:false,authenticated:false,service:true,relrowsecurity:true});
});
test('draft versions protect edits/deletes and completion promotes the same UUID exactly once',async t=>{
  const f=await fixture(t),input=draft();const initial=await f.repo.createJournalDraft(timelineIds.auth,input);
  const changed={...input,body:'A revised unfinished thought.'};const second=await f.repo.editJournalDraft(timelineIds.auth,input.id,edit(changed,initial.version));
  assert.equal(second.version,'2');assert.equal((await f.repo.editJournalDraft(timelineIds.auth,input.id,edit(changed,'1'))).version,'2','identical retries are harmless');
  await assert.rejects(()=>f.repo.editJournalDraft(timelineIds.auth,input.id,edit({...input,body:'Stale override.'},'1')),error=>error.status===409);
  await assert.rejects(()=>f.repo.deleteJournalDraft(timelineIds.auth,input.id,'1'),error=>error.status===409);
  await assert.rejects(()=>f.repo.completeJournalDraft(timelineIds.auth,input.id,edit(changed,'1')),error=>error.status===409);
  await assert.rejects(()=>f.repo.createJournalEntry(timelineIds.auth,changed),error=>error.status===409);
  const final=await f.repo.completeJournalDraft(timelineIds.auth,input.id,edit(changed,'2'));
  assert.equal(final.id,input.id);assert.equal(final.body,changed.body);assert.equal(final.visibility,'private');
  assert.equal((await f.repo.getJournalDrafts(timelineIds.auth)).total,0);assert.equal((await f.repo.getJournal(timelineIds.auth)).total,1);
  assert.equal((await f.repo.completeJournalDraft(timelineIds.auth,input.id,edit(changed,'2'))).version,final.version);
  assert.equal((await f.db.query('select count(*)::integer as count from member_journal_entries')).rows[0].count,1);
  assert.equal((await f.db.query('select count(*)::integer as count from member_journal_entry_versions')).rows[0].count,1);
  await assert.rejects(()=>f.repo.getJournalDraft(timelineIds.auth,input.id),error=>error.status===404);
  await assert.rejects(()=>f.repo.createJournalDraft(timelineIds.auth,changed),error=>error.status===409);
  await assert.rejects(()=>f.repo.completeJournalDraft(timelineIds.auth,input.id,edit({...changed,body:'Different retry.'},'2')),error=>error.status===409);
});
test('saved draft media stays private after upload expiry and moves with completion without reupload',async t=>{
  const f=await fixture(t),mediaId=await f.upload(),input=draft({kind:'images',mediaIds:[mediaId]});
  const first=await f.repo.createJournalDraft(timelineIds.auth,input);assert.equal(first.media.length,1);
  await f.db.query("update member_journal_media set created_at=now()-interval '3 days' where id=$1",[mediaId]);
  await f.repo.prepareJournalUpload(timelineIds.auth,{mimeType:'image/png',size:100});
  assert.match(await f.repo.journalMediaUrl(timelineIds.auth,mediaId),/verified/);
  await assert.rejects(()=>f.repo.journalMediaUrl(timelineIds.otherAuth,mediaId),error=>error.status===404);
  await assert.rejects(()=>f.repo.createJournalDraft(timelineIds.auth,draft({kind:'images',mediaIds:[mediaId]})),error=>error.status===400);
  await assert.rejects(()=>f.repo.createJournalEntry(timelineIds.auth,draft({kind:'images',mediaIds:[mediaId]})),error=>error.status===400);
  const final=await f.repo.completeJournalDraft(timelineIds.auth,input.id,edit(input,first.version));assert.equal(final.media[0].id,mediaId);
  const row=(await f.db.query('select draft_id,entry_id,state from member_journal_media where id=$1',[mediaId])).rows[0];assert.deepEqual(row,{draft_id:null,entry_id:input.id,state:'ready'});
  assert.equal((await f.repo.completeJournalDraft(timelineIds.auth,input.id,edit(input,first.version))).id,input.id);
  assert.match(await f.repo.journalMediaUrl(timelineIds.auth,mediaId),/verified/);
});
test('draft discard is versioned and removes owner media access; deleted account erases drafts',async t=>{
  const f=await fixture(t),mediaId=await f.upload(),input=draft({kind:'images',mediaIds:[mediaId]});const first=await f.repo.createJournalDraft(timelineIds.auth,input);
  await f.repo.deleteJournalDraft(timelineIds.auth,first.id,first.version);await f.repo.deleteJournalDraft(timelineIds.auth,first.id,first.version);
  assert.equal((await f.repo.getJournalDrafts(timelineIds.auth)).total,0);
  await assert.rejects(()=>f.repo.journalMediaUrl(timelineIds.auth,mediaId),error=>error.status===404);
  await assert.rejects(()=>f.repo.createJournalDraft(timelineIds.auth,input),error=>error.status===409);
  await f.repo.createJournalDraft(timelineIds.auth,draft());
  await f.db.query('update ruined_members set deleted_at=now() where id=$1',[timelineIds.member]);
  assert.equal((await f.db.query('select count(*)::integer as count from member_journal_drafts')).rows[0].count,0);
  assert.equal((await f.db.query('select count(*)::integer as count from member_journal_media where draft_id is not null')).rows[0].count,0);
});
test('explicit publication is checked only on completion and cannot leak a saved draft',async t=>{
  const f=await fixture(t),input=draft({visibility:'public',includeOnTimeline:true});const saved=await f.repo.createJournalDraft(timelineIds.auth,input);
  assert.equal(saved.visibility,'private');assert.equal(saved.includeOnTimeline,false);
  await assert.rejects(()=>f.repo.completeJournalDraft(timelineIds.auth,input.id,edit(input,saved.version)),error=>error.status===403);
  assert.equal((await f.repo.getJournalDrafts(timelineIds.auth)).total,1);assert.equal((await f.repo.getJournal(timelineIds.auth)).total,0);
  f.allowPublic();const final=await f.repo.completeJournalDraft(timelineIds.auth,input.id,edit(input,saved.version));assert.equal(final.visibility,'public');assert.equal(final.includeOnTimeline,true);
});
test('draft pagination stays owner scoped without skipping older drafts',async t=>{
  const f=await fixture(t);for(let i=0;i<32;i++)await f.repo.createJournalDraft(timelineIds.auth,draft({body:`Draft ${i}`}));
  const first=await f.repo.getJournalDrafts(timelineIds.auth);assert.equal(first.entries.length,30);assert.equal(first.hasMore,true);assert.equal(first.total,32);
  const last=await f.repo.getJournalDrafts(timelineIds.auth,first.nextCursor);assert.equal(last.entries.length,2);assert.equal(last.hasMore,false);assert.equal(new Set([...first.entries,...last.entries].map(e=>e.id)).size,32);
  assert.equal((await f.repo.getJournalDrafts(timelineIds.otherAuth,first.nextCursor)).entries.length,0);
});

test('concurrent completion is idempotent and every draft mutation rechecks write access under lock',async t=>{
 const f=await fixture(t),input=draft();const initial=await f.repo.createJournalDraft(timelineIds.auth,input);
 const results=await Promise.all([f.repo.completeJournalDraft(timelineIds.auth,input.id,edit(input,initial.version)),f.repo.completeJournalDraft(timelineIds.auth,input.id,edit(input,initial.version))]);
 assert.deepEqual(results[0],results[1]);assert.equal((await f.repo.getJournal(timelineIds.auth)).total,1);
 const pending=draft(),saved=await f.repo.createJournalDraft(timelineIds.auth,pending);
 for(const mutate of [()=>f.repo.createJournalDraft(timelineIds.auth,draft()),()=>f.repo.editJournalDraft(timelineIds.auth,pending.id,edit({...pending,body:'Changed'},saved.version)),()=>f.repo.completeJournalDraft(timelineIds.auth,pending.id,edit(pending,saved.version)),()=>f.repo.deleteJournalDraft(timelineIds.auth,pending.id,saved.version)]) {
  f.beforeNextTransaction(()=>f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1",[timelineIds.member]));
  await assert.rejects(mutate,error=>error.status===403);
  await f.db.query("update member_lifecycle set account_state='active' where member_id=$1",[timelineIds.member]);
 }
 assert.deepEqual(await f.repo.getJournalDraft(timelineIds.auth,pending.id),saved);
});

test('failed media transfer rolls completion back without losing the draft or creating a partial entry',async t=>{
 const f=await fixture(t),mediaId=await f.upload(),input=draft({kind:'images',mediaIds:[mediaId]});const saved=await f.repo.createJournalDraft(timelineIds.auth,input);
 f.beforeNextTransaction(()=>f.db.query('update member_journal_media set verified_at=null where id=$1',[mediaId]));
 await assert.rejects(()=>f.repo.completeJournalDraft(timelineIds.auth,input.id,edit(input,saved.version)),error=>error.status===400);
 assert.equal((await f.repo.getJournalDrafts(timelineIds.auth)).total,1);assert.equal((await f.repo.getJournal(timelineIds.auth)).total,0);
 assert.equal((await f.repo.getJournalDraft(timelineIds.auth,input.id)).version,saved.version);
 assert.equal((await f.db.query('select count(*)::integer as count from member_journal_entry_versions')).rows[0].count,0);
});
