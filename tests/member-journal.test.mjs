import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import sharp from 'sharp';
import {loadPGliteForSchemaChecks} from '../scripts/check-support-schema.mjs';
const source=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
async function load(path,deps={}){const code=ts.transpileModule(await source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const mod={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,`Unexpected dependency: ${name}`);return deps[name];},mod,mod.exports);return mod.exports;}
const model=await load('src/lib/membership/journal-model.ts');
const policy=await load('src/lib/membership/access-policy.ts');
const storage=await load('src/lib/membership/journal-storage.ts',{'server-only':{},'@supabase/supabase-js':{},sharp,'./journal-model':model});
const draft=(changes={})=>({id:randomUUID(),kind:'text',title:'A small beginning',body:'Something worth keeping.',mediaIds:[],...changes});

test('journal validates required content, attachment counts, unique media, and bounded input',async()=>{
  assert.equal(model.validateJournalInput(draft({body:'  hello  '})).body,'hello');
  for(const change of [{body:' '},{body:'a'.repeat(20001)},{title:'t'.repeat(161)},{id:'not-an-id'},{kind:'images',mediaIds:[]},{kind:'text',mediaIds:[randomUUID()]},{memberId:randomUUID()}])assert.throws(()=>model.validateJournalInput(draft(change)),model.JournalError);
  const id=randomUUID();assert.throws(()=>model.validateJournalInput(draft({kind:'images',mediaIds:[id,id]})),model.JournalError);
  assert.throws(()=>model.journalFilePolicy('image/svg+xml',100),model.JournalError);
  assert.throws(()=>model.journalFilePolicy('video/mp4',50*1024*1024+1),model.JournalError);
  const request=new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(draft())});
  assert.equal((await model.readJournalJson(request)).body,'Something worth keeping.');
  const oversized=new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(97000)});
  await assert.rejects(()=>model.readJournalJson(oversized),error=>error.status===413);
});
test('media validation uses bytes, normalizes images, and rejects fake video containers',async()=>{
  const png=await sharp({create:{width:12,height:8,channels:3,background:'#ffca2c'}}).png().toBuffer();
  const result=await storage.validateJournalMedia(png,'image/png');assert.equal(result.mimeType,'image/webp');const metadata=await sharp(result.data).metadata();assert.equal(metadata.width,12);assert.equal(metadata.exif,undefined);
  await assert.rejects(()=>storage.validateJournalMedia(png,'image/jpeg'));
  await assert.rejects(()=>storage.validateJournalMedia(Buffer.from('<html>not a video</html>'),'video/mp4'));
  await assert.rejects(()=>storage.validateJournalMedia(Buffer.alloc(100),'video/webm'));
});
function sqlAdapter(db){
  const sql=(strings,...values)=>{
    if(!strings.raw)return{list:strings};
    const parameters=[];let query=strings[0];
    values.forEach((value,index)=>{if(value&&value.list){query+='('+value.list.map(item=>{parameters.push(item);return`$${parameters.length}`;}).join(',')+')';}else{parameters.push(value);query+=`$${parameters.length}`;}query+=strings[index+1];});
    return db.query(query,parameters).then(result=>result.rows);
  };
  sql.begin=fn=>db.transaction(tx=>fn(sqlAdapter(tx)));
  return sql;
}
async function fixture(){
  const PGlite=await loadPGliteForSchemaChecks();const pg=new PGlite();
  await pg.exec('create role anon;create role authenticated;create table ruined_members(id uuid primary key);');
  await pg.exec(await source('db/migrations/20260916230000_member_journal.sql'));
  const owner=randomUUID(),other=randomUUID();await pg.query('insert into ruined_members values($1),($2)',[owner,other]);
  const blobs=new Map(),signed=[];const store={
    createSignedUploadUrl:async path=>({data:{signedUrl:`https://storage.example.test/upload/${path}`},error:null}),
    download:async path=>blobs.has(path)?{data:blobs.get(path),error:null}:{data:null,error:new Error('missing')},
    upload:async(path,data,options)=>{blobs.set(path,new Blob([data],{type:options.contentType}));return{error:null};},
    remove:async paths=>{paths.forEach(path=>blobs.delete(path));return{error:null};},
    createSignedUrl:async path=>{signed.push(path);return{data:{signedUrl:`https://storage.example.test/private/${path}`},error:null};},
  };
  const identity=id=>({memberId:id,cancellationEffectiveAt:null,accountState:'active',billingState:'active',programState:'active',foundationsState:'completed',administrativeOnboardingState:'completed',standingState:'active'});
  const repository=await load('src/lib/membership/journal-repository.ts',{'server-only':{},'node:crypto':{randomUUID},'@/lib/database/server':{getApplicationDatabase:()=>sqlAdapter(pg)},'@/lib/membership/repository':{getMemberIdentity:async auth=>auth==='owner'?identity(owner):auth==='other'?identity(other):null},'@/lib/membership/access-policy':policy,'./journal-model':model,'./journal-storage':{journalStore:()=>store,journalStorageConfigured:()=>true,validateJournalMedia:storage.validateJournalMedia}});
  return{pg,owner,other,blobs,signed,repository};
}
test('owner-scoped journal saves idempotently, keeps other records private, and filters saved entries',async()=>{
  const f=await fixture();try{
    const input=draft();const entry=await f.repository.createJournalEntry('owner',input);assert.equal(entry.body,input.body);
    assert.equal((await f.repository.createJournalEntry('owner',input)).id,entry.id);
    assert.equal((await f.repository.getJournal('owner')).entries.length,1);
    assert.equal((await f.repository.getJournal('other')).entries.length,0);
    await assert.rejects(()=>f.repository.saveJournalEntry('other',entry.id,true),error=>error.status===404);
    await assert.rejects(()=>f.repository.getJournal('unknown'),error=>error.status===403);
    assert.equal((await f.repository.getJournal('owner',null,true)).entries.length,0);
    await f.repository.saveJournalEntry('owner',entry.id,true);assert.equal((await f.repository.getJournal('owner',null,true)).entries.length,1);
    const security=await f.pg.query("select relrowsecurity from pg_class where relname in ('member_journal_entries','member_journal_media')");assert.ok(security.rows.every(row=>row.relrowsecurity));
    const grants=await f.pg.query("select has_table_privilege('anon','member_journal_entries','select') as allowed");assert.equal(grants.rows[0].allowed,false);
  }finally{await f.pg.close();}
});
test('media attachment checks ownership, validates upload, and never serves the signed-upload object',async()=>{
  const f=await fixture();try{
    const png=await sharp({create:{width:20,height:16,channels:3,background:'#3b5d4f'}}).png().toBuffer();
    const upload=await f.repository.prepareJournalUpload('owner',{mimeType:'image/png',size:png.length});
    const [reserved]=(await f.pg.query('select * from member_journal_media where id=$1',[upload.id])).rows;
    f.blobs.set(reserved.storage_path,new Blob([png],{type:'image/png'}));
    await assert.rejects(()=>f.repository.createJournalEntry('other',draft({kind:'images',mediaIds:[upload.id]})),error=>error.status===400);
    await assert.rejects(()=>f.repository.journalMediaUrl('owner',upload.id),error=>error.status===404);
    const input=draft({kind:'images',body:'A photo',mediaIds:[upload.id]});const entry=await f.repository.createJournalEntry('owner',input);
    assert.equal(entry.media[0].mimeType,'image/webp');assert.match(entry.media[0].url,/^\/api\/my\/journal\/media\//);
    assert.equal(f.blobs.has(reserved.storage_path),false);
    await assert.rejects(()=>f.repository.journalMediaUrl('other',upload.id),error=>error.status===404);assert.equal(f.signed.length,0);
    const url=await f.repository.journalMediaUrl('owner',upload.id);assert.match(url,/\/verified\//);assert.doesNotMatch(url,/pending/);
    assert.equal((await f.repository.createJournalEntry('owner',input)).id,entry.id);
    await assert.rejects(()=>f.repository.createJournalEntry('owner',draft({kind:'images',mediaIds:[upload.id]})),error=>error.status===400);
  }finally{await f.pg.close();}
});
test('journal pagination has no gaps and cannot use another member cursor',async()=>{
  const f=await fixture();try{
    for(let index=0;index<33;index++)await f.repository.createJournalEntry('owner',draft({title:`Entry ${index}`}));
    const first=await f.repository.getJournal('owner');assert.equal(first.entries.length,30);assert.equal(first.hasMore,true);
    const second=await f.repository.getJournal('owner',first.entries.at(-1).id);assert.equal(second.entries.length,3);assert.equal(second.hasMore,false);assert.equal(new Set([...first.entries,...second.entries].map(e=>e.id)).size,33);
    assert.equal((await f.repository.getJournal('other',first.entries.at(-1).id)).entries.length,0);
  }finally{await f.pg.close();}
});
test('expired unfinished uploads are removed without touching published entries',async()=>{
 const f=await fixture();try{
  const upload=await f.repository.prepareJournalUpload('owner',{mimeType:'video/mp4',size:24});
  const [row]=(await f.pg.query("update member_journal_media set created_at=now()-interval '2 days' where id=$1 returning *",[upload.id])).rows;
  f.blobs.set(row.storage_path,new Blob(['unfinished']));
  await assert.rejects(()=>f.repository.createJournalEntry('owner',draft({kind:'video',mediaIds:[upload.id]})),error=>error.status===400);
  await f.repository.prepareJournalUpload('owner',{mimeType:'video/mp4',size:24});
  assert.equal(f.blobs.has(row.storage_path),false);
  assert.equal((await f.pg.query('select id from member_journal_media where id=$1',[upload.id])).rows.length,0);
 }finally{await f.pg.close();}
});
test('journal mutations reject untrusted origins, disconnected mode, and signed-out viewers',async()=>{
 let trusted=false,mode='connected',viewer={authUserId:'owner'};
 const guard=await load('src/lib/membership/journal-request.ts',{'server-only':{},'next/server':{NextResponse:Response},'@/lib/auth/request':{isTrustedPlatformOrigin:()=>trusted},'@/lib/auth/session':{getCurrentPlatformViewer:async()=>viewer},'@/lib/platform/config':{getPlatformConfiguration:()=>({mode})},'./journal-model':model});
 const request=new Request('https://members.example.test/api/my/journal',{method:'POST'});
 await assert.rejects(()=>guard.journalViewer(request,true),error=>error.status===403);
 trusted=true;mode='preview';await assert.rejects(()=>guard.journalViewer(request,true),error=>error.status===503);
 mode='connected';viewer=null;await assert.rejects(()=>guard.journalViewer(request,true),error=>error.status===401);
 viewer={authUserId:'owner'};assert.equal(await guard.journalViewer(request,true),'owner');
 const failure=guard.journalFailure(new model.JournalError(404,'Not found'));assert.equal(failure.status,404);assert.equal(failure.headers.get('cache-control'),'private, no-store');
});
