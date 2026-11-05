import assert from 'node:assert/strict';
import test from 'node:test';
import * as crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { practiceFixture, ids } from './helpers/practice-fixture.mjs';
const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
async function load(file, deps={}) {
 const code=ts.transpileModule(await read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const loaded={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,'Unexpected import '+name);return deps[name];},loaded,loaded.exports);return loaded.exports;
}
class AdminEmailError extends Error {constructor(status,message){super(message);this.status=status;}}
class CadenceDeliveryError extends Error {constructor(code,terminal=false){super(code);this.code=code;this.terminal=terminal;}}
const model=await load('src/lib/practice/release-model.ts');
const email=await load('src/lib/practice/release-email.ts',{'./release-model':model});
async function fixture(t) {
 const f=await practiceFixture(t);await f.db.exec(await read('db/migrations/20261104190000_member_practice_release_emails.sql'));
 await f.db.exec("create table if not exists operator_audit_events(actor_auth_user_id uuid,action text,subject_type text,subject_id text,metadata jsonb)");
 await f.db.exec("create or replace function private.ruined_member_profile_released(target_member_id uuid) returns boolean language sql as 'select true'");
 await f.db.query("update private.member_practice_release_events set release_at=clock_timestamp()+interval '1 day' where course='time'");
 await f.db.query("update member_practice_releases set release_at=(select release_at from private.member_practice_release_events where course='time') where course='time'");
 const oldFrom=process.env.RESEND_FROM_EMAIL;process.env.RESEND_FROM_EMAIL='Ruined <hello@example.test>';t.after(()=>{if(oldFrom===undefined)delete process.env.RESEND_FROM_EMAIL;else process.env.RESEND_FROM_EMAIL=oldFrom;});
 const state={admin:true,permission:true,providerAllowed:true,ready:true,launched:true,failSend:false,withdrawAfterPrepare:false,reads:0};
 const members=[{id:ids.member,name:'Member',email:'member@example.test',consentId:'1',eligible:true,enrolledAt:'2020-01-01T00:00:00Z',registeredAt:'2020-01-01T00:00:00Z'},
  {id:ids.otherMember,name:'Other',email:'other@example.test',consentId:'2',eligible:false,enrolledAt:'2020-01-01T00:00:00Z',registeredAt:'2020-01-01T00:00:00Z'}];
 const sends=[],providerChecks=[];
 const requireActor=async()=>{if(!state.admin)throw new AdminEmailError(403,'Admin required');};
 const lifecycle={readLifecycleMembers:async(_tx,memberId,lock)=>{if(lock){state.reads++;if(state.withdrawAfterPrepare&&state.reads>=2)state.permission=false;}return members.filter(m=>!memberId||m.id===memberId).map(m=>({...m,eligible:m.eligible&&state.permission}));}};
 const delivery={getMemberEmailCadenceDeliveryConfiguration:()=>({enabled:state.ready,ready:state.ready,activatedAt:'2020-01-01T00:00:00Z'}),assertCadencePayload:(p,to)=>{assert.equal(p.to,to);assert.ok(p.from);},sendCadencePayload:async(p,id)=>{sends.push({payload:structuredClone(p),id});if(state.failSend){state.failSend=false;throw new CadenceDeliveryError('provider_timeout');}return 'provider-123';}};
 const provider={reviewCadenceProviderRecipients:async values=>values.map(v=>({...v,eligible:v.eligible&&state.providerAllowed})),assertCadenceRecipientDeliverable:async address=>{providerChecks.push(address);if(!state.providerAllowed)throw new CadenceDeliveryError('recipient_suppressed',true);}};
 const repository=await load('src/lib/practice/release-repository.ts',{'server-only':{},'node:crypto':crypto,'@/lib/database/server':{getApplicationDatabase:()=>f.sql},'@/lib/foundations/availability':{isFoundationsLaunched:()=>state.launched},'@/lib/communications/admin-email-model':{AdminEmailError},'@/lib/communications/admin-email-repository':{requireAdminEmailActor:requireActor},'@/lib/communications/member-email-cadence-delivery':delivery,'@/lib/communications/member-email-cadence-provider':provider,'@/lib/communications/member-lifecycle-email-repository':lifecycle,'./release-model':model,'./release-email':email});
 const worker=await load('src/lib/practice/release-worker.ts',{'server-only':{},'node:crypto':crypto,'@/lib/database/server':{getApplicationDatabase:()=>f.sql},'@/lib/foundations/availability':{isFoundationsLaunched:()=>state.launched},'@/lib/communications/admin-email-repository':{requireAdminEmailActor:requireActor},'@/lib/communications/member-email-cadence-delivery':delivery,'@/lib/communications/member-email-cadence-provider':provider,'@/lib/communications/member-email-cadence-repository':{CadenceDeliveryError},'./release-email':email,'./release-repository':repository,'./release-model':model});
 const release=async course=>{const review=await repository.reviewPracticeRelease(ids.auth,course);await repository.releasePracticeAssignment(ids.auth,review.token);return review;};
 const rows=async()=> (await f.db.query('select * from private.member_practice_release_deliveries order by id')).rows;
 return {...f,repository,worker,state,sends,providerChecks,release,rows};
}

test('recap copy is escaped, points to The Work, and uses only the course badge image',()=>{
 for(const course of ['f1','f4','time']){
  const p=email.renderPracticeRecap(course,'<private name>','member@example.test','Ruined <hello@example.test>');
  assert.match(p.html,/&lt;private name&gt;/);assert.doesNotMatch(p.html,/<private name>/);assert.match(p.text,new RegExp('/my/practice\\?course='+course));
  const images=[...p.html.matchAll(/<img\b[^>]*src="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(images,course==='time'?[]:[`https://members.theruinedproject.com/membership/badges/foundations-${course}-v2.png`]);
  if(course!=='time'){
   const image=p.html.match(/<img\b[^>]*>/)[0];
   assert.match(image,/width="112"/);assert.match(image,/height:auto/);assert.doesNotMatch(image,/\sheight="/);
  }
 }
 assert.equal(model.isPracticeReleaseCourse('f2'),false);assert.equal(model.isPracticeReleaseCourse('f3'),false);
 assert.equal(model.practiceDeliveryMustStop(6,null),true);assert.equal(model.practiceDeliveryMustStop(2,new Date(Date.now()-24*60*60_000)),true);
});

test('installing release automation never announces F1/F4 or sends TIME early',async t=>{
 const f=await fixture(t);const overview=await f.repository.getPracticeReleaseOverview(ids.auth);
 assert.equal(overview.items.find(x=>x.course==='f1').releaseAt,null);assert.equal(overview.items.find(x=>x.course==='f4').releaseAt,null);
 const result=await f.worker.processPracticeReleaseEmailBatch();assert.equal(result.sent,0);assert.equal(result.queued,0);assert.equal((await f.rows()).length,0);assert.equal(f.sends.length,0);
 await assert.rejects(f.repository.reviewPracticeRelease(ids.auth,'f2'),e=>e.status===400);
 f.state.admin=false;await assert.rejects(f.repository.getPracticeReleaseOverview(ids.auth),e=>e.status===403);
});

test('explicit reviewed release is atomic and idempotent; opted-out members are not queued',async t=>{
 const f=await fixture(t);const review=await f.release('f1');assert.equal(review.eligible,1);assert.equal(review.excluded,1);assert.equal((await f.rows()).length,1);
 await f.repository.releasePracticeAssignment(ids.auth,review.token);assert.equal((await f.rows()).length,1);assert.equal(f.sends.length,0);
 const result=await f.worker.processPracticeReleaseEmailBatch();assert.equal(result.sent,1);assert.equal(f.sends.length,1);assert.equal((await f.rows())[0].status,'sent');
 await f.worker.processPracticeReleaseEmailBatch();assert.equal(f.sends.length,1);
});

test('audience/permission change invalidates review and final dispatch checks permission again',async t=>{
 const f=await fixture(t),review=await f.repository.reviewPracticeRelease(ids.auth,'f4');f.state.permission=false;
 await assert.rejects(f.repository.releasePracticeAssignment(ids.auth,review.token),e=>e.status===409);assert.equal((await f.rows()).length,0);
 f.state.permission=true;await f.release('f4');f.state.withdrawAfterPrepare=true;await f.worker.processPracticeReleaseEmailBatch();assert.equal(f.sends.length,0);assert.equal((await f.rows())[0].status,'manual_review');
});

test('acknowledgment loss replays exact frozen bytes with the same delivery id and no extra recipients',async t=>{
 const f=await fixture(t);await f.release('f1');f.state.failSend=true;await f.worker.processPracticeReleaseEmailBatch();
 const [first]=await f.rows();assert.equal(first.status,'failed');assert.ok(first.first_attempt_at);assert.equal(typeof first.payload,'object');
 await f.db.query("update private.member_practice_release_deliveries set available_at=clock_timestamp()-interval '1 second'");
 await f.worker.processPracticeReleaseEmailBatch();assert.equal(f.sends.length,2);assert.deepEqual(f.sends[0],f.sends[1]);assert.equal((await f.rows())[0].status,'sent');
});

test('provider suppression before sending cancels without dispatch and erased members cannot be requeued',async t=>{
 const f=await fixture(t);await f.release('f1');f.state.providerAllowed=false;await f.worker.processPracticeReleaseEmailBatch();assert.equal(f.sends.length,0);assert.equal((await f.rows())[0].status,'cancelled');
 const releaseId=(await f.rows())[0].release_id;await f.db.query('update ruined_members set deleted_at=clock_timestamp() where id=$1',[ids.member]);assert.equal((await f.rows()).length,0);
 await assert.rejects(f.db.query("insert into private.member_practice_release_deliveries(release_id,member_id,expected_email,expected_consent_id) values($1,$2,'member@example.test',1)",[releaseId,ids.member]));
});

test('scheduled TIME release queues once at due time and anchors expiry to its release date',async t=>{
 const f=await fixture(t);await f.db.query("update private.member_practice_release_events set release_at=clock_timestamp()-interval '1 hour' where course='time'");await f.db.query("update member_practice_releases set release_at=(select release_at from private.member_practice_release_events where course='time') where course='time'");
 assert.equal(await f.repository.enqueueScheduledPracticeReleases(),1);assert.equal(await f.repository.enqueueScheduledPracticeReleases(),0);
 const [row]=await f.rows();const [event]=(await f.db.query("select * from private.member_practice_release_events where course='time'")).rows;
 assert.equal(new Date(row.expires_at).getTime()-new Date(event.release_at).getTime(),7*86400_000);
});

test('a missed scheduled month is marked expired instead of sending a stale recap later',async t=>{
 const f=await fixture(t);await f.db.query("update private.member_practice_release_events set release_at=clock_timestamp()-interval '8 days' where course='time'");
 assert.equal(await f.repository.enqueueScheduledPracticeReleases(),0);assert.equal((await f.rows()).length,0);
 assert.equal((await f.db.query("select source from private.member_practice_release_events where course='time'")).rows[0].source,'expired');
});

test('F2/F3 deck-only release is reviewed, idempotent, and never queues an assignment email',async t=>{
 const f=await fixture(t);
 for(const course of ['f2','f3']){
  const review=await f.repository.reviewPracticeDeckRelease(ids.auth,course);assert.equal(review.kind,'deck');assert.equal(review.eligible,0);
  await assert.rejects(f.repository.releasePracticeAssignment(ids.auth,review.token),e=>e.status===409);
  await f.repository.releasePracticeDeck(ids.auth,review.token);await f.repository.releasePracticeDeck(ids.auth,review.token);
  assert.equal((await f.db.query('select private.ruined_practice_course_released($1) as available',[course])).rows[0].available,true);
 }
 assert.equal((await f.rows()).length,0);assert.equal(f.sends.length,0);
 const counts=(await f.db.query("select count(*)::int as count from operator_audit_events where action='practice.deck_released'")).rows[0].count;assert.equal(counts,2);
});

test('release endpoints require authenticated mutation access and reject unreviewed actions',async()=>{
 let calls=0,allowed=false;
 const opsJson=(data,status=200)=>Response.json(data,{status});
 const route=await load('app/api/ops/practice/route.ts',{
  '@/lib/auth/session':{getCurrentPlatformViewer:async()=>null},
  '@/lib/communications/admin-email-api':{adminEmailErrorResponse:e=>opsJson({error:e.message},e.status||503),readAdminEmailJson:r=>r.json(),requireAdminEmailMutation:async()=>allowed?{viewer:{authUserId:ids.auth}}:{response:opsJson({error:'Denied'},403)}},
  '@/lib/communications/admin-email-model':{AdminEmailError},'@/lib/platform/ops-api':{opsJson},
  '@/lib/practice/release-repository':{getPracticeReleaseOverview:async()=>{calls++;},reviewPracticeRelease:async()=>{calls++;},releasePracticeAssignment:async()=>{calls++;},reviewPracticeDeckRelease:async()=>{calls++;},releasePracticeDeck:async()=>{calls++;}},
 });
 assert.equal((await route.GET()).status,401);
 assert.equal((await route.POST(new Request('https://members.example.test/api/ops/practice',{method:'POST',body:JSON.stringify({action:'release',reviewToken:'x'})}))).status,403);assert.equal(calls,0);
 allowed=true;
 assert.equal((await route.POST(new Request('https://members.example.test/api/ops/practice',{method:'POST',body:JSON.stringify({action:'release',reviewToken:'x',actorAuthUserId:ids.otherAuth})}))).status,400);assert.equal(calls,0);
});
