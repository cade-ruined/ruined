import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {applicationSourceLoader} from '../scripts/lib/application-source-loader.mjs';
import {buildCalendarPublicationPlan} from '../scripts/lib/calendar-publication-plan.mjs';
import {sqlFor} from './helpers/member-sms-fixture.mjs';
const load=applicationSourceLoader();
const {foundationsBillingScheduleForMonth}=load('src/lib/membership/foundations-schedule.ts');
const {RUINED_CALENDAR_CLOSURES}=load('src/lib/membership/calendar-closures.ts');
const circles=[{id:'e140cf3c-dd56-4164-b7e4-6c97fbd39d3e',name:'Founders Circle',status:'active'}];
const plan=buildCalendarPublicationPlan(circles,foundationsBillingScheduleForMonth,RUINED_CALENDAR_CLOSURES);

test('approved 2027 plan has exact monthly audiences, holiday exceptions, no BYOB or 2026 calls',()=>{
  assert.equal(plan.calls.length,120);assert.deepEqual(plan.byob,[]);
  assert.equal(plan.calls.filter(call=>call.draft.kind==='academy_session').length,48);
  assert.equal(plan.calls.filter(call=>call.draft.kind==='weekly_call').length,48);
  assert.equal(plan.calls.filter(call=>call.draft.kind==='circle_meeting').length,24);
  const local=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',hour:'numeric',minute:'numeric',hourCycle:'h23'});
  for(const call of plan.calls){
    assert.match(call.draft.startsAt,/^2027-/);assert.equal(local.format(new Date(call.draft.startsAt)),'15:00');
    assert.equal(Date.parse(call.draft.endsAt)-Date.parse(call.draft.startsAt),90*60000);
    if(call.draft.kind==='academy_session'){assert.equal(call.draft.visibility,'invite_only');assert.equal(call.draft.registrationMode,'internal');assert.equal(call.draft.emailCadence.cohortMonth,call.draft.startsAt.slice(0,7));}
    if(call.draft.kind==='circle_meeting'){assert.equal(call.draft.visibility,'circle');assert.equal(call.draft.circleId,circles[0].id);}
    if(call.draft.kind==='weekly_call')assert.equal(call.draft.visibility,'all_members');
  }
  const days=(month,kind)=>plan.calls.filter(call=>call.draft.startsAt.startsWith(month)&&call.draft.kind===kind).map(call=>Number(call.draft.startsAt.slice(8,10)));
  assert.deepEqual(days('2027-11','academy_session'),[4,11,18,29]);
  assert.deepEqual(days('2027-11','circle_meeting'),[10,17]);
  assert.deepEqual(days('2027-12','academy_session'),[2,9,16,30]);
  assert.deepEqual(days('2027-12','weekly_call'),[1,7,14,28]);
  assert.deepEqual(days('2027-12','circle_meeting'),[8,15]);
  assert.deepEqual(buildCalendarPublicationPlan(circles,foundationsBillingScheduleForMonth,RUINED_CALENDAR_CLOSURES),plan);
});

test('draft request IDs recover the same saved event and reject changed content before publishing',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('create role anon;create role authenticated;create role service_role;');
  for(const [,path] of readFileSync(new URL('../scripts/migrate-platform.mjs',import.meta.url),'utf8').matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g))await db.exec(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'));
  const sql=sqlFor(db),actor=randomUUID();
  await db.query("insert into platform_users(auth_user_id,email_normalized,user_type,status) values($1,'calendar-test@example.test','staff','active')",[actor]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')",[actor]);
  const repository=applicationSourceLoader({'@/lib/database/server':{getApplicationDatabase:()=>sql},'@/lib/google/calendar':{
    getGoogleCalendarConfigurationStatus:()=>({ready:false}),createGoogleCalendarEvent:()=>assert.fail('Draft creation cannot send invitations'),
  }} )('src/lib/platform/ops-experience-repository.ts');
  const call=plan.calls.find(call=>call.draft.kind==='academy_session');
  const input={actorAuthUserId:actor,requestId:call.requestId,draft:call.draft};
  const first=await repository.createOpsExperience(input);
  assert.deepEqual(await repository.createOpsExperience(input),first);
  await assert.rejects(repository.createOpsExperience({...input,draft:{...call.draft,title:'Changed title'}}),/different event/);
  const rows=(await db.query('select id,status from experiences')).rows;
  assert.deepEqual(rows,[{id:first.experienceId,status:'draft'}]);
  const binding=(await db.query('select kind,cohort_month from private.member_email_cadence_event_bindings where experience_id=$1',[first.experienceId])).rows[0];
  assert.deepEqual(binding,{kind:'foundations_01',cohort_month:'2027-01'});
  assert.equal((await db.query('select count(*)::int n from experience_calendar_links')).rows[0].n,0);
});
