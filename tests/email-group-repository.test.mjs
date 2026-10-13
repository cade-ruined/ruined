import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loader, read, id } from './helpers/member-sms-fixture.mjs';
import { installOperatorFundingFunctions } from './helpers/operator-funding-fixture.mjs';
import { installPaidReservationFunction, seedPaidReservationFixture } from './helpers/paid-reservation-fixture.mjs';

function bridge(engine) {
  class Query {
    constructor(strings,values) { this.strings=strings; this.values=values; }
    compile(params) { let result=this.strings[0]; this.values.forEach((v,i)=>{ if(v instanceof Query) result+=v.compile(params); else {params.push(v instanceof Date?v.toISOString():v);result+='$'+params.length;}result+=this.strings[i+1];});return result; }
    then(resolve,reject) { const params=[];return engine.query(this.compile(params),params).then(r=>r.rows).then(resolve,reject); }
  }
  const sql=(strings,...values)=>new Query(strings,values);sql.json=JSON.stringify;sql.begin=run=>engine.transaction(tx=>run(bridge(tx)));return sql;
}
async function fixture(t) {
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key,status text);
    create table ruined_members(id uuid primary key,person_id uuid,email_normalized text,deleted_at timestamptz);
    create table person_profiles(person_id uuid primary key,display_name text);
    create table person_private_profiles(person_id uuid primary key,legal_name text);
    create table person_email_addresses(id uuid primary key default gen_random_uuid(),person_id uuid,email_normalized text,retired_at timestamptz,verification_state text);
    create table platform_users(auth_user_id uuid primary key,person_id uuid,member_id uuid,email_normalized text,status text);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz,id uuid default gen_random_uuid());
    create table member_lifecycle(member_id uuid primary key,account_state text,administrative_onboarding_state text,program_state text,standing_state text,cancellation_effective_at timestamptz,billing_state text);
    create table member_onboardings(member_id uuid primary key,profile_completed_at timestamptz,state text);
    create table member_consents(id bigint generated always as identity,member_id uuid,consent_type text,policy_version text,decision text,source text,actor_auth_user_id uuid,evidence jsonb);
    create table communication_contacts(id uuid primary key default gen_random_uuid(),email_normalized text unique,person_id uuid,delivery_state text default 'active');
    create table communication_subscriptions(id uuid primary key default gen_random_uuid(),contact_id uuid,channel text,topic text,status text,confirmed_at timestamptz);
    create table community_event_registrations(email_normalized text,registrant_name text,event_key text,status text);
    create table community_event_listings(event_key text,title text,starts_at timestamptz);
    create table membership_waitlist(email_normalized text,name text,joined_waitlist_at timestamptz);
    create table operator_audit_events(actor_auth_user_id uuid,action text,subject_type text,subject_id text,metadata jsonb);
    create table stripe_webhook_events(object_id text,event_type text,livemode boolean,status text);
    create table experiences(id uuid,title text,starts_at timestamptz,ends_at timestamptz,timezone text,status text,cancelled_at timestamptz,visibility text,registration_mode text,kind text);
    create function private.ruined_member_registration_ready(uuid) returns boolean language sql as 'select true';`);
  await installOperatorFundingFunctions(db);await installPaidReservationFunction(db);
  await db.exec(`alter table membership_commercial_reservations add column billing_plan text default 'monthly';`);
  const sql=bridge(db),actor=id(1),calls=new Map();let serial=100;
  await db.query("insert into platform_users(auth_user_id,status) values($1,'active')",[actor]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug,revoked_at) values($1,'ops_admin',null)",[actor]);
  const session={viewer:{authUserId:actor}};
  const load=loader({}, {'@/lib/database/server':{getApplicationDatabase:()=>sql},
    '@/lib/auth/session':{getCurrentPlatformViewer:async()=>session.viewer},
    '@/lib/platform/ops-operating-repository':{OpsOperatingRepositoryError:class extends Error{}},
    '@/lib/communications/admin-email-ai':{AdminEmailAIError:class extends Error{}},
    './member-email-cadence-repository':{readCadenceEvent:async(_tx,key)=>calls.get(key)?.event??null,readCadenceRecipients:async(_tx,event,track)=>{assert.equal(track,'members');return calls.get(event.id).members;}}});
  const repo=load('src/lib/communications/email-group-repository.ts'),model=load('src/lib/communications/email-group-model.ts');
  const schedules=load('src/lib/membership/foundations-schedule.ts');
  async function member() {
    const m={memberId:id(serial++),personId:id(serial++),auth:id(serial++),email:`person-${serial}@example.test`,name:'Avery Example'};
    await db.query("insert into people values($1,'active')",[m.personId]);
    await db.query('insert into ruined_members values($1,$2,$3,null)',[m.memberId,m.personId,m.email]);
    await db.query('insert into person_profiles values($1,$2)',[m.personId,m.name]);
    await db.query("insert into person_email_addresses(person_id,email_normalized,verification_state) values($1,$2,'verified')",[m.personId,m.email]);
    await db.query("insert into platform_users values($1,$2,$3,$4,'active')",[m.auth,m.personId,m.memberId,m.email]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug,revoked_at) values($1,'member',null)",[m.auth]);
    await db.query("insert into member_lifecycle values($1,'active','completed','onboarding','active',null,'pending')",[m.memberId]);
    await db.query("insert into member_onboardings values($1,now(),'completed')",[m.memberId]);
    return m;
  }
  async function contact(email,subscribed=false) {
    const rows=await db.query('insert into communication_contacts(email_normalized) values($1) returning id',[email]);
    if(subscribed)await db.query("insert into communication_subscriptions(contact_id,channel,topic,status,confirmed_at) values($1,'email','about','subscribed',now())",[rows.rows[0].id]);
    return {email,name:''};
  }
  async function consent(m,options={}) {
    const evidence={context:'member_communication_preferences_v1',purpose:'membership_updates',channel:'email',destination:m.email,requested:true,marketingConsent:false,...options.evidence};
    await db.query("insert into member_consents(member_id,consent_type,policy_version,decision,source,actor_auth_user_id,evidence) values($1,'communications','membership-reminders-v2',$2,$3,$4,$5)",[m.memberId,options.decision??'accepted',options.source??'member',m.auth,JSON.stringify(evidence)]);
  }
  // Seed the actual provider-settled payment proof before adding group-specific access columns.
  const paid=await member(),reservation=id(serial++);
  await seedPaidReservationFixture(db,{member:paid.memberId,person:paid.personId,reservation,contract:id(serial++)});
  await db.exec(`alter table member_registration_access add column registered_at timestamptz,add column profile_activated_at timestamptz,add column completion_basis text,add column payment_reservation_id uuid;`);
  await db.query("update member_registration_access set registered_at=now(),completion_basis='paid_membership',payment_reservation_id=$1 where member_id=$2",[reservation,paid.memberId]);
  const schedule=schedules.foundationsBillingScheduleForMonth('2026-11','monthly');
  await db.query('update membership_commercial_reservations set billing_schedule=$1 where id=$2',[JSON.stringify(schedule),reservation]);
  await db.query('update stripe_checkout_attempts set billing_schedule=$1 where commercial_reservation_id=$2',[JSON.stringify(schedule),reservation]);
  await db.query('update stripe_membership_commitments set terms_snapshot=$1',[JSON.stringify({billingSchedule:schedule})]);
  await db.exec(read('db/migrations/20261013200000_admin_email_groups.sql'));
  return {db,sql,actor,repo,model,load,calls,member,contact,consent,paid,reservation,schedule,session};
}
const manual=(name,members)=>({name,description:'Selected local contacts',mode:'manual',members});
const rule=(name,selection)=>({name,description:'A current audience',mode:'rule',rule:selection});
const status=number=>error=>error.status===number;

test('email groups use current local identities and separate permission from selection',async t=>{
  const f=await fixture(t),{repo,actor,db}=f;
  await t.test('only active administrators can read, preview, save or search',async()=>{
    const outsider=await f.member();
    for(const run of [()=>repo.listEmailGroups(outsider.auth),()=>repo.previewEmailGroup(outsider.auth,manual('No',[])),()=>repo.saveEmailGroup(outsider.auth,manual('No',[])),()=>repo.searchEmailGroupPeople(outsider.auth,'')]) await assert.rejects(run(),status(403));
    assert.equal((await db.query('select count(*)::int count from private.admin_email_groups')).rows[0].count,0);
  });
  await t.test('manual saves canonical names/references and never creates subscriptions or consent',async()=>{
    const m=await f.member();const result=await repo.saveEmailGroup(actor,manual('Selected members',[{email:m.email.toUpperCase(),name:'Untrusted display'}]));
    assert.deepEqual(result.members,[{email:m.email,name:m.name,memberId:m.memberId,personId:m.personId}]);
    assert.equal(result.group.memberCount,1);
    assert.equal((await db.query('select count(*)::int count from communication_subscriptions')).rows[0].count,0);
    assert.equal((await db.query('select count(*)::int count from member_consents')).rows[0].count,0);
    assert.equal(await repo.checkEmailGroupRecipientPermission(m.email,'general_updates'),false);
    assert.equal(await repo.checkEmailGroupRecipientPermission(m.email,'membership_updates'),false);
    await assert.rejects(repo.saveEmailGroup(actor,manual('Unknown',[{email:'unknown@example.test',name:''}])),status(409));
    await assert.rejects(repo.saveEmailGroup(actor,manual('Forged',[{email:m.email,name:'',memberId:id(9999)}])),status(409));
    const audit=(await db.query('select metadata from operator_audit_events')).rows[0].metadata;
    assert.equal(JSON.stringify(audit).includes(m.email),false);
  });
  await t.test('revisions protect edits, archive, restore and worker reads',async()=>{
    let result=await repo.saveEmailGroup(actor,manual('Revision group',[]));const original=result.group;
    result=await repo.saveEmailGroup(actor,{...manual('Revision group edited',[]),id:original.id,revision:original.revision});
    await assert.rejects(repo.saveEmailGroup(actor,{...manual('stale',[]),id:original.id,revision:original.revision}),status(409));
    await assert.rejects(f.sql.begin(tx=>repo.requireEmailGroupRevision(tx,original.id,original.revision)),status(409));
    const archived=await repo.archiveEmailGroup(actor,result.group.id,result.group.revision,true);
    await assert.rejects(repo.resolveEmailGroup(actor,original.id),status(409));
    assert.ok(!(await repo.listEmailGroups(actor)).some(group=>group.id===original.id));
    assert.ok((await repo.listEmailGroups(actor,{includeArchived:true})).some(group=>group.id===original.id));
    const restored=await repo.archiveEmailGroup(actor,original.id,archived.group.revision,false);
    assert.equal(restored.group.archivedAt,null);
    await assert.rejects(repo.saveEmailGroup(actor,manual('REVISION GROUP EDITED',[])),status(409));
    await f.sql.begin(tx=>repo.requireEmailGroupRevision(tx,original.id,restored.group.revision));
  });
  await t.test('saved identities do not silently follow reassigned addresses',async()=>{
    const first=await f.member(),second=await f.member();
    const group=await repo.saveEmailGroup(actor,manual('Pinned identity',[{email:first.email,name:first.name,memberId:first.memberId,personId:first.personId}]));
    await db.query('update ruined_members set email_normalized=$1 where id=$2',['changed@example.test',first.memberId]);
    await db.query('update person_email_addresses set email_normalized=$1 where person_id=$2',['changed@example.test',first.personId]);
    await db.query('update ruined_members set email_normalized=$1 where id=$2',[first.email,second.memberId]);
    await db.query('update person_email_addresses set email_normalized=$1 where person_id=$2',[first.email,second.personId]);
    assert.deepEqual((await repo.resolveEmailGroup(actor,group.group.id)).members,[]);
    await f.contact(first.email,true);
    assert.equal(await f.sql.begin(tx=>repo.checkEmailGroupRecipientPermissionInTransaction(tx,first.email,'general_updates',{expectedIdentity:first})),false);
    assert.equal(await f.sql.begin(tx=>repo.checkEmailGroupRecipientPermissionInTransaction(tx,first.email,'general_updates',{expectedIdentity:second})),true);
    await db.query('delete from ruined_members where id=$1',[first.memberId]);
    assert.equal((await db.query('select count(*)::int count from private.admin_email_group_entries where group_id=$1',[group.group.id])).rows[0].count,0);
  });
  await t.test('general audience requires confirmed subscription and current nonretired identity',async()=>{
    const yes=await f.contact('yes-general@example.test',true),no=await f.contact('no-general@example.test');
    const result=await repo.previewEmailGroup(actor,rule('General',{kind:'general_subscribers'}));
    assert.ok(result.members.some(m=>m.email===yes.email));assert.ok(!result.members.some(m=>m.email===no.email));
    assert.equal(await repo.checkEmailGroupRecipientPermission(yes.email,'general_updates'),true);
    assert.equal(await repo.checkEmailGroupRecipientPermission(no.email,'general_updates'),false);
    await db.query("update communication_contacts set delivery_state='suppressed' where email_normalized=$1",[yes.email]);
    assert.equal(await repo.checkEmailGroupRecipientPermission(yes.email,'general_updates'),false);
    const m=await f.member();await f.contact(m.email,true);
    await db.query('update ruined_members set deleted_at=now() where id=$1',[m.memberId]);
    assert.equal(await repo.checkEmailGroupRecipientPermission(m.email,'general_updates'),false);
    assert.equal((await repo.searchEmailGroupPeople(actor,m.email)).members.length,0);
  });
  await t.test('paid registration and current funding are required independently of manual selection',async()=>{
    const paid=f.paid;await f.consent(paid);
    assert.equal(await repo.checkEmailGroupRecipientPermission(paid.email,'membership_updates'),true);
    assert.equal(await f.sql.begin(tx=>repo.checkEmailGroupRecipientPermissionInTransaction(tx,paid.email,'membership_updates')),true);
    const waiting=await repo.previewEmailGroup(actor,rule('Waiting',{kind:'registered_members',state:'waiting'}));
    assert.ok(waiting.members.some(m=>m.email===paid.email));
    const incomplete=await f.member();await f.consent(incomplete);
    await repo.saveEmailGroup(actor,manual('Unfunded manual selection',[{email:incomplete.email,name:''}]));
    assert.equal(await repo.checkEmailGroupRecipientPermission(incomplete.email,'membership_updates'),false);
    await db.exec("update stripe_membership_prepaid_proofs set refund_state='refunded',amount_refunded=34900");
    assert.equal(await repo.checkEmailGroupRecipientPermission(paid.email,'membership_updates'),false);
    assert.ok(!(await repo.previewEmailGroup(actor,rule('Current funded',{kind:'registered_members',state:'all'}))).members.some(m=>m.email===paid.email));
    await db.exec("update stripe_membership_prepaid_proofs set refund_state='none',amount_refunded=0");
  });
  await t.test('cohort is derived from the complete accepted paid schedule, not signup dates',async()=>{
    const result=await repo.previewEmailGroup(actor,rule('November',{kind:'foundations_cohort',cohortMonth:'2026-11'}));
    assert.deepEqual(result.members.map(m=>m.email),[f.paid.email]);
    assert.equal((await repo.previewEmailGroup(actor,rule('December',{kind:'foundations_cohort',cohortMonth:'2026-12'}))).members.length,0);
    await db.query("update membership_commercial_reservations set billing_schedule=jsonb_set(billing_schedule,'{callStartsAt,0}','\"2026-11-06T22:00:00.000Z\"') where id=$1",[f.reservation]);
    assert.equal((await repo.previewEmailGroup(actor,rule('Tampered calendar',{kind:'foundations_cohort',cohortMonth:'2026-11'}))).members.length,0);
    await db.query('update membership_commercial_reservations set billing_schedule=$1 where id=$2',[JSON.stringify(f.schedule),f.reservation]);
  });
  await t.test('latest withdrawal and current destination win over earlier member or operator approval',async()=>{
    const m=f.paid;
    await f.consent(m,{source:'ops',evidence:{action:'operator_email_preference_enabled',operatorApproved:true,memberAffirmed:false,approvalReference:'explicit-fixture-approval'}});
    assert.equal(await repo.checkEmailGroupRecipientPermission(m.email,'membership_updates'),true);
    await f.consent(m,{decision:'withdrawn',evidence:{requested:false}});
    assert.equal(await repo.checkEmailGroupRecipientPermission(m.email,'membership_updates'),false);
    await f.consent(m,{evidence:{destination:'old-address@example.test'}});
    assert.equal(await repo.checkEmailGroupRecipientPermission(m.email,'membership_updates'),false);
    await f.consent(m,{source:'ops',evidence:{action:'operator_email_preference_enabled',operatorApproved:true,memberAffirmed:false,approvalReference:''}});
    assert.equal(await repo.checkEmailGroupRecipientPermission(m.email,'membership_updates'),false);
  });
  await t.test('event registration does not imply email permission and call audience uses canonical eligibility',async()=>{
    await db.exec("insert into community_event_listings values('fixture-event','Fixture Event',now())");
    await db.exec("insert into community_event_registrations values('event-one@example.test','One','fixture-event','registered'),('event-two@example.test','Two','fixture-event','cancelled')");
    const group=await repo.previewEmailGroup(actor,rule('Event',{kind:'event_registrants',eventKey:'fixture-event'}));
    assert.deepEqual(group.members.map(m=>m.email),['event-one@example.test']);
    assert.equal(await repo.checkEmailGroupRecipientPermission('event-one@example.test','general_updates'),false);
    await assert.rejects(repo.previewEmailGroup(actor,rule('Missing event',{kind:'event_registrants',eventKey:'absent'})),status(400));
    const callId=id(555),m=await f.member(),excluded=await f.member();
    f.calls.set(callId,{event:{id:callId},members:[{email:m.email,eligible:true},{email:excluded.email,eligible:false}]});
    assert.deepEqual((await repo.previewEmailGroup(actor,rule('Call',{kind:'call_audience',callEventId:callId}))).members.map(m=>m.email),[m.email]);
    f.calls.delete(callId);
    await assert.rejects(repo.previewEmailGroup(actor,rule('Gone',{kind:'call_audience',callEventId:callId})),status(400));
  });
  await t.test('search is bounded honestly and oversized rules remain manageable but cannot resolve',async()=>{
    await db.exec("insert into communication_contacts(email_normalized) select 'bulk-'||value||'@example.test' from generate_series(1,1001) value");
    const search=await repo.searchEmailGroupPeople(actor,'bulk-');assert.equal(search.members.length,50);assert.equal(search.hasMore,true);
    await db.exec("insert into communication_subscriptions(contact_id,channel,topic,status,confirmed_at) select id,'email','about','subscribed',now() from communication_contacts where email_normalized like 'bulk-%'");
    await assert.rejects(repo.previewEmailGroup(actor,rule('Too many',{kind:'general_subscribers'})),/exceeds 1000/);
    const saved=(await db.query("insert into private.admin_email_groups(name,mode,rule,created_by,updated_by) values('Existing grown group','rule','{\"kind\":\"general_subscribers\"}',$1,$1) returning id",[actor])).rows[0];
    const summary=(await repo.listEmailGroups(actor)).find(g=>g.id===saved.id);
    assert.equal(summary.memberCount,null);assert.match(summary.issue,/1000/);
    assert.match((await repo.getEmailGroup(actor,saved.id)).group.issue,/1000/);
    await assert.rejects(repo.resolveEmailGroup(actor,saved.id),/1000/);
    assert.ok((await repo.archiveEmailGroup(actor,saved.id,1,true)).group.archivedAt);
  });
  await t.test('API guards JSON mutations and bounds actual bytes while allowing complete 1000-contact selections',async()=>{
    const api=f.load('app/api/ops/emails/groups/route.ts');
    const request=(body,headers={})=>new Request('https://members.example.test/api/ops/emails/groups',{method:'POST',headers:{origin:'https://members.example.test','content-type':'application/json',...headers},body});
    assert.equal((await api.POST(request('{}',{origin:'https://attacker.example.test'}))).status,403);
    assert.equal((await api.POST(request('{}',{'content-type':'text/plain'}))).status,415);
    f.session.viewer=null;assert.equal((await api.GET(new Request('https://members.example.test/api/ops/emails/groups'))).status,401);
    f.session.viewer={authUserId:actor};
    assert.equal((await api.POST(request('{'))).status,400);
    assert.equal((await api.POST(request(JSON.stringify({action:'unknown'})))).status,400);
    const body=JSON.stringify({action:'preview',group:manual('All selected',Array.from({length:1000},(_,index)=>({email:`bulk-${index+1}@example.test`,name:'A'.repeat(100)})))});
    assert.ok(Buffer.byteLength(body)>64000);
    const response=await api.POST(request(body));assert.equal(response.status,200);assert.equal((await response.json()).group.memberCount,1000);
    let cancelled=false;
    const oversized=new Request('https://members.example.test/api/ops/emails/groups',{method:'POST',headers:{origin:'https://members.example.test','content-type':'application/json'},duplex:'half',body:new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(400000));},cancel(){cancelled=true;}})});
    assert.equal((await api.POST(oversized)).status,413);assert.equal(cancelled,true);
    assert.equal((await db.query("select count(*)::int count from private.admin_email_groups where name='All selected'")).rows[0].count,0,'preview stays read-only');
    const saved=await api.POST(request(body.replace('"action":"preview"','"action":"save"')));assert.equal(saved.status,200);
    const savedDetail=await saved.json();assert.equal(savedDetail.group.memberCount,1000);
    assert.equal((await db.query('select count(*)::int count from private.admin_email_group_entries where group_id=$1',[savedDetail.group.id])).rows[0].count,1000);
  });
  await t.test('private group tables have RLS and no anonymous or authenticated grants',async()=>{
    const rows=(await db.query("select relname,relrowsecurity from pg_class where oid in ('private.admin_email_groups'::regclass,'private.admin_email_group_entries'::regclass)")).rows;
    assert.equal(rows.length,2);assert.ok(rows.every(r=>r.relrowsecurity));
    for(const role of ['anon','authenticated'])for(const table of ['private.admin_email_groups','private.admin_email_group_entries']){
      const privileges=(await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as allowed",[role,table])).rows[0];assert.equal(privileges.allowed,false);
    }
  });
});

test('group model rejects unsupported rules, duplicate destinations and oversized manual lists',()=>{
  const model=loader()('src/lib/communications/email-group-model.ts');
  for(const input of [manual('Duplicate',[{email:'a@example.test'},{email:'A@example.test'}]),manual('Too large',Array.from({length:1001},(_,i)=>({email:`a${i}@example.test`}))),rule('SQL',{kind:'custom_sql',sql:'select *'}),rule('Invalid cohort',{kind:'foundations_cohort',cohortMonth:'2026-13'})]) assert.throws(()=>model.normalizeEmailGroupInput(input),status(400));
});
