import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { json, serializeJsonBindings } from "./helpers/postgres-json-bindings.mjs";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
async function load(path,dependencies={}) {
  const output=ts.transpileModule(await read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded={exports:{}};
  new Function("require","module","exports",output)(name=>{assert.ok(name in dependencies,`Unexpected import ${name}`);return dependencies[name];},loaded,loaded.exports);
  return loaded.exports;
}
const model=await load("src/lib/communications/member-lifecycle-email-model.ts");
const access=await load("src/lib/membership/access-policy.ts");
class CadenceDeliveryError extends Error {constructor(code,terminal=false){super(code);this.code=code;this.terminal=terminal;}}

async function fixture(t) {
  const db=new PGlite();t.after(()=>db.close());
  const ids=Object.fromEntries(["member","person","actor","auth","event","circle","enrollment"].map(key=>[key,crypto.randomUUID()]));
  await db.exec(`create role anon;create role authenticated;create schema private;
    create table people(id uuid primary key,status text);
    create table ruined_members(id uuid primary key,person_id uuid,email_normalized text,deleted_at timestamptz,created_at timestamptz);
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,status text,email_normalized text);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text,administrative_onboarding_state text,billing_state text,
      cancellation_effective_at timestamptz,foundations_state text,program_state text,standing_state text);
    create table person_profiles(person_id uuid,display_name text);
    create table person_private_profiles(person_id uuid,birth_date date);
    create table member_registration_access(member_id uuid primary key,registered_at timestamptz,profile_activated_at timestamptz);
    create table person_email_addresses(id uuid primary key default gen_random_uuid(),person_id uuid,email_normalized text,verification_state text,retired_at timestamptz);
    create table communication_contacts(id uuid primary key default gen_random_uuid(),email_normalized text,delivery_state text);
    create table member_consents(id bigint generated always as identity primary key,member_id uuid,consent_type text,decision text,
      evidence jsonb,source text,actor_auth_user_id uuid,accepted_at timestamptz);
    create table experiences(id uuid primary key,starts_at timestamptz,ends_at timestamptz,kind text,circle_id uuid,metadata jsonb,status text,cancelled_at timestamptz);
    create table experience_registrations(experience_id uuid,person_id uuid);
    create table experience_attendance_events(id bigint generated always as identity primary key,experience_id uuid,person_id uuid,member_id uuid,
      event_type text,source text,occurred_at timestamptz);
    create table circles(id uuid primary key,status text,activated_at timestamptz,ends_at timestamptz);
    create table circle_member_assignments(member_id uuid,circle_id uuid,assigned_at timestamptz,ended_at timestamptz);
    create table foundation_enrollments(id uuid primary key,member_id uuid,status text);
    create table member_foundation_requirement_completions(id uuid primary key default gen_random_uuid(),member_id uuid,
      foundation_enrollment_id uuid,requirement_slug text,state text,completed_at timestamptz,supersedes_completion_id uuid);
    create function private.ruined_lock_member_complimentary_funding(uuid) returns boolean language sql as 'select true';
    create function private.ruined_lock_member_operator_funding(uuid) returns boolean language sql as 'select false';
    create function private.ruined_member_has_complimentary_funding(uuid) returns boolean language sql as 'select true';
    create function private.ruined_member_has_operator_funding(uuid) returns boolean language sql as 'select false';
    create function private.ruined_member_profile_released(uuid) returns boolean language sql as 'select true';`);
  await db.query("insert into people values($1,'active')",[ids.person]);
  await db.query("insert into ruined_members values($1,$2,'member@example.test',null,'2020-01-01')",[ids.member,ids.person]);
  await db.query("insert into platform_users values($1,$2,$3,'active','member@example.test'),($4,null,null,'active','admin@example.test')",[ids.auth,ids.member,ids.person,ids.actor]);
  await db.query("insert into platform_role_grants values($1,'member',null),($2,'ops_admin',null)",[ids.auth,ids.actor]);
  await db.query("insert into member_lifecycle values($1,'active','completed','active',null,'completed','active','active')",[ids.member]);
  await db.query("insert into person_profiles values($1,'Alex Member')",[ids.person]);
  await db.query("insert into person_private_profiles values($1,'1990-04-05')",[ids.person]);
  await db.query("insert into person_email_addresses(person_id,email_normalized,verification_state) values($1,'member@example.test','verified')",[ids.person]);
  const now=Date.now();let date=model.denverDate(new Date(now)),due=model.localEmailTime(date);
  if(Date.parse(due)>now){date=new Date(Date.parse(`${date}T12:00:00Z`)-86400000).toISOString().slice(0,10);due=model.localEmailTime(date);}
  const anniversary=new Date(due);anniversary.setUTCFullYear(anniversary.getUTCFullYear()-1);
  await db.query("insert into member_registration_access values($1,$2,'2020-01-01')",[ids.member,anniversary.toISOString()]);
  await db.query("insert into circles values($1,'active','2020-01-01',null)",[ids.circle]);
  await db.query("insert into circle_member_assignments values($1,$2,'2020-01-01',null)",[ids.member,ids.circle]);
  await db.query("insert into foundation_enrollments values($1,$2,'completed')",[ids.enrollment,ids.member]);
  await db.query("insert into member_foundation_requirement_completions(member_id,foundation_enrollment_id,requirement_slug,state,completed_at) values($1,$2,'timeline','completed','2020-01-01')",[ids.member,ids.enrollment]);
  await db.query(`insert into experiences values($1,now()-interval '100 days',now()-interval '100 days'+interval '90 minutes',
    'weekly_call',null,'{"badge_credit":{"track":"membership","stage":"see"}}','completed',null)`,[ids.event]);
  await db.query("insert into experience_attendance_events(experience_id,person_id,member_id,event_type,source,occurred_at) values($1,$2,$3,'attended','ops',now()-interval '99 days')",[ids.event,ids.person,ids.member]);
  const consent=async(decision="accepted")=>db.query(`insert into member_consents(member_id,consent_type,decision,evidence,source,actor_auth_user_id,accepted_at)
    values($1,'communications',$2,$3::jsonb,'member',$4,'2020-01-01')`,[ids.member,decision,JSON.stringify({context:"member_communication_preferences_v1",purpose:"membership_updates",channel:"email",destination:"member@example.test",requested:decision==="accepted",marketingConsent:false}),ids.auth]);
  await consent();
  await db.exec(await read("db/migrations/20261021192000_member_lifecycle_emails.sql"));
  await db.query("update private.member_lifecycle_email_rules set enabled=true,activated_at=$1,approved_by=$2,design='{}'::jsonb where key='anniversary'",[new Date(Date.parse(due)-86400000).toISOString(),ids.actor]);
  const sends=[],responses=[],hooks=[],committed=[],providerErrors=[],providerChecks=[],rendered=[],lockFaults=[];
  function bridge(engine,root=false) {
    class Query {
      constructor(strings,values){this.strings=strings;this.values=serializeJsonBindings(strings,values);}
      compile(params){let source=this.strings[0];this.values.forEach((value,i)=>{if(value instanceof Query)source+=value.compile(params);else{params.push(value instanceof Date?value.toISOString():value);source+="$"+params.length;}source+=this.strings[i+1];});return source;}
      then(resolve,reject){const params=[],source=this.compile(params),fault=lockFaults.findIndex(pattern=>source.includes(pattern));
        if(fault>=0){lockFaults.splice(fault,1);return Promise.reject(Object.assign(new Error("Evidence lock unavailable"),{code:"55P03"})).then(resolve,reject);}
        return engine.query(source,params).then(r=>r.rows).then(resolve,reject);}
    }
    const sql=(strings,...values)=>new Query(strings,values);sql.json=json;
    sql.begin=async action=>{const result=await engine.transaction(tx=>action(bridge(tx)));
      if(root){committed.push((await db.query("select * from private.member_lifecycle_email_deliveries")).rows);const hook=hooks.shift();if(hook)await hook();}
      return result;};return sql;
  }
  const sql=bridge(db,true),configuration={enabled:true,ready:true,activatedAt:"2020-01-01T00:00:00.000Z"};
  const repository=await load("src/lib/communications/member-lifecycle-email-repository.ts",{"server-only":{},"@/lib/membership/access-policy":access});
  const worker=await load("src/lib/communications/member-lifecycle-email-worker.ts",{
    "server-only":{},"node:crypto":crypto,"@/lib/database/server":{getApplicationDatabase:()=>sql},
    "./admin-email-repository":{requireAdminEmailActor:async(tx,actor)=>{
      const rows=await tx`select actor.auth_user_id from platform_users actor join platform_role_grants role on role.auth_user_id=actor.auth_user_id
        where actor.auth_user_id=${actor}::uuid and actor.status='active' and role.role_slug='ops_admin' and role.revoked_at is null`;
      if(!rows.length)throw new Error("Administrator unavailable");
    }},
    "./member-email-cadence-delivery":{getMemberEmailCadenceDeliveryConfiguration:()=>configuration,
      assertCadencePayload:(payload,email)=>{assert.equal(payload.to,email);assert.ok(payload.html);},
      sendCadencePayload:async(payload,id)=>{const saved=committed.at(-1).find(row=>row.id===id);assert.ok(saved.first_attempt_at);assert.deepEqual(saved.payload,payload);
        sends.push({payload,id});const error=responses.shift();if(error)throw error;return "provider-id";}},
    "./member-email-cadence-provider":{assertCadenceRecipientDeliverable:async email=>{providerChecks.push(email);const error=providerErrors.shift();if(error)throw error;}},
    "./member-email-cadence-repository":{CadenceDeliveryError},"./member-lifecycle-email-model":model,
    "./member-lifecycle-email-repository":repository,
    "./member-lifecycle-email-service":{renderLifecycleMessage:(rule,name)=>{rendered.push({rule,name});return {from:"Ruined <connect@example.test>",replyTo:[],subject:"Anniversary",html:`<p>${name}</p>`,text:name};}},
  });
  return {db,ids,sql,repository,worker,sends,responses,hooks,providerErrors,providerChecks,rendered,configuration,consent,due,lockFaults,
    deliveries:async()=>(await db.query("select * from private.member_lifecycle_email_deliveries order by created_at")).rows,
    retry:()=>db.query("update private.member_lifecycle_email_deliveries set available_at=now() where status='failed'")};
}

test("lifecycle migration is inactive, recipient permissions are explicit, and disabled worker does nothing",async t=>{
  const f=await fixture(t);
  assert.equal((await f.db.query("select count(*)::int as n from private.member_lifecycle_email_rules where enabled")).rows[0].n,1,"only the fixture's explicit anniversary approval enabled a rule");
  f.configuration.enabled=false;
  assert.equal((await f.worker.processMemberLifecycleEmailBatch()).queued,0);assert.deepEqual(await f.deliveries(),[]);
  const [member]=await f.repository.readLifecycleMembers(f.sql);assert.equal(member.eligible,true);
  await f.consent("withdrawn");assert.equal((await f.repository.readLifecycleMembers(f.sql))[0].eligible,false);
  f.configuration.enabled=true;assert.equal((await f.worker.processMemberLifecycleEmailBatch()).sent,0);assert.equal(f.sends.length,0);
});

test("lifecycle queue sends one due occurrence with committed immutable payload and does not replay it",async t=>{
  const f=await fixture(t);const result=await f.worker.processMemberLifecycleEmailBatch();
  assert.equal(result.queued,1);assert.equal(result.sent,1);assert.equal(f.sends.length,1);
  const [row]=await f.deliveries();assert.equal(row.status,"sent");assert.equal(row.provider_message_id,"provider-id");
  assert.deepEqual(f.providerChecks,["member@example.test"]);
  assert.equal((await f.worker.processMemberLifecycleEmailBatch()).queued,0);assert.equal(f.sends.length,1);
  await assert.rejects(f.db.query("update private.member_lifecycle_email_deliveries set payload='{}'::jsonb"),/immutable/);
  await assert.rejects(f.db.query("update private.member_lifecycle_email_deliveries set expected_email='elsewhere@example.test'"),/immutable/);
});

test("new lifecycle approval and late member enrollment do not backfill an earlier due occurrence",async t=>{
  const f=await fixture(t);await f.db.query("update private.member_lifecycle_email_rules set activated_at=now()");
  assert.equal((await f.worker.processMemberLifecycleEmailBatch()).queued,0);
  await f.db.query("update private.member_lifecycle_email_rules set activated_at=$1",[new Date(Date.parse(f.due)-86400000).toISOString()]);
  await f.db.query("update member_registration_access set profile_activated_at=now()");
  assert.equal((await f.worker.processMemberLifecycleEmailBatch()).queued,0);assert.equal(f.sends.length,0);
});

test("rule or membership preference changes after enqueue cancel before preparing bytes",async t=>{
  for(const mutate of [async f=>f.consent("withdrawn"),async f=>f.db.query("update private.member_lifecycle_email_rules set revision=revision+1")]) {
    const f=await fixture(t);f.hooks.push(()=>mutate(f));
    const result=await f.worker.processMemberLifecycleEmailBatch();assert.equal(result.cancelled,1);assert.equal(f.sends.length,0);
    assert.equal((await f.deliveries())[0].payload,null);
  }
});

test("withdrawal after durable preparation stops dispatch and preserves uncertainty for review",async t=>{
  const f=await fixture(t);f.hooks.push(async()=>{},()=>f.consent("withdrawn"));
  const result=await f.worker.processMemberLifecycleEmailBatch();assert.equal(result.manualReview,1);assert.equal(f.sends.length,0);
  assert.ok((await f.deliveries())[0].first_attempt_at);
});

test("uncertain lifecycle delivery retries identical frozen bytes and key, not the current member name",async t=>{
  const f=await fixture(t);f.responses.push(new Error("transport response lost"));
  assert.equal((await f.worker.processMemberLifecycleEmailBatch()).failed,1);
  await f.db.query("update person_profiles set display_name='Changed name'");await f.retry();
  assert.equal((await f.worker.processMemberLifecycleEmailBatch()).sent,1);assert.deepEqual(f.sends[0],f.sends[1]);
  assert.equal(f.rendered.length,1);
});

test("provider suppression blocks lifecycle send and revoked approver cannot enqueue",async t=>{
  const f=await fixture(t);f.providerErrors.push(new CadenceDeliveryError("recipient_suppressed",true));
  assert.equal((await f.worker.processMemberLifecycleEmailBatch()).manualReview,1);assert.equal(f.sends.length,0);
  const g=await fixture(t);await g.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1",[g.ids.actor]);
  assert.equal((await g.worker.processMemberLifecycleEmailBatch()).queued,0);assert.equal(g.sends.length,0);
});

test("milestones use first verified attended Membership call, excluding Circle calls, cancelled events and revoked attendance",async t=>{
  const f=await fixture(t);
  const attendance=type=>f.db.query("insert into experience_attendance_events(experience_id,person_id,member_id,event_type,source,occurred_at) values($1,$2,$3,$4,'ops',now())",[f.ids.event,f.ids.person,f.ids.member,type]);
  await attendance("attended");assert.ok((await f.repository.readLifecycleMembers(f.sql))[0].firstMembershipCallAt);
  await attendance("revoked");assert.equal((await f.repository.readLifecycleMembers(f.sql))[0].firstMembershipCallAt,null);
  await attendance("attended");await f.db.query("update experiences set cancelled_at=now()");
  assert.equal((await f.repository.readLifecycleMembers(f.sql))[0].firstMembershipCallAt,null);
  await f.db.query("update experiences set cancelled_at=null,circle_id=$1",[crypto.randomUUID()]);
  assert.equal((await f.repository.readLifecycleMembers(f.sql))[0].firstMembershipCallAt,null);
});

test("account erasure removes lifecycle recipient/content bytes, cancels unsent work and retains delivery evidence",async t=>{
  const f=await fixture(t);await f.worker.processMemberLifecycleEmailBatch();
  const sent=(await f.deliveries())[0];
  await f.db.query(`insert into private.member_lifecycle_email_deliveries(rule_key,rule_revision,member_id,occurrence_key,
    expected_email,expected_consent_id,due_at,expires_at,status,payload,first_attempt_at)
    select rule_key,rule_revision,member_id,occurrence_key||'-pending',expected_email,expected_consent_id,due_at,expires_at,'failed',payload,first_attempt_at
    from private.member_lifecycle_email_deliveries where id=$1`,[sent.id]);
  await f.db.query("update ruined_members set deleted_at=now() where id=$1",[f.ids.member]);
  const rows=await f.deliveries();assert.equal(rows.length,2);
  for(const row of rows){assert.equal(row.expected_email,"");assert.equal(row.payload,null);assert.equal(row.lock_token,null);}
  const delivered=rows.find(row=>row.id===sent.id);assert.equal(delivered.status,"sent");assert.equal(delivered.provider_message_id,sent.provider_message_id);
  assert.deepEqual(delivered.sent_at,sent.sent_at);assert.deepEqual(delivered.first_attempt_at,sent.first_attempt_at);
  assert.equal(rows.find(row=>row.id!==sent.id).status,"cancelled");
  await assert.rejects(f.db.query("update private.member_lifecycle_email_deliveries set expected_email='restore@example.test'"),/deleted member/);
  await assert.rejects(f.db.query("update private.member_lifecycle_email_deliveries set payload='{}'::jsonb"),/deleted member/);
});

test("lifecycle update requires an explicit revision before any database mutation",async()=>{
  let opens=0;
  class AdminEmailError extends Error {constructor(status,message){super(message);this.status=status;}}
  const service=await load("src/lib/communications/member-lifecycle-email-service.ts",{
    "server-only":{},"@/lib/database/server":{getApplicationDatabase:()=>{opens++;throw new Error("Unexpected database access");}},
    "./admin-email-model":{AdminEmailError},"./admin-email-repository":{},"./member-email-cadence-delivery":{},
    "./member-email-cadence-renderer":{},"./member-lifecycle-email-copy":{},"./member-lifecycle-email-model":model,
    "./member-lifecycle-email-repository":{},
  });
  for(const revision of [undefined,0,-1,1.2,"1",NaN]) await assert.rejects(service.updateMemberLifecycleEmail(crypto.randomUUID(),{
    key:"new_year",enabled:false,settings:{},revision}),error=>error.status===400);
  assert.equal(opens,0);
});

test("global lifecycle reactivation cannot replay a previously elapsed due time",async t=>{
  const f=await fixture(t);f.configuration.activatedAt=new Date().toISOString();
  assert.equal((await f.worker.processMemberLifecycleEmailBatch()).queued,0);assert.equal(f.sends.length,0);
});

test("edited lifecycle wording cannot bypass required Foundations or Circle evidence",async t=>{
  const f=await fixture(t);await f.db.query("update private.member_lifecycle_email_rules set copy='{\"subject\":\"Editable\",\"body\":\"Custom text\"}'::jsonb");
  await f.db.query("update member_lifecycle set foundations_state='in_progress'");
  assert.equal((await f.worker.processMemberLifecycleEmailBatch()).queued,0);
  await f.db.query("update member_lifecycle set foundations_state='completed'");await f.db.query("update circle_member_assignments set ended_at=now()");
  assert.equal((await f.worker.processMemberLifecycleEmailBatch()).queued,0);assert.equal(f.sends.length,0);
});

test("busy event or completion evidence defers lifecycle dispatch before provider access and can retry",async t=>{
  for(const lock of ["for share of event nowait","from member_foundation_requirement_completions where member_id="]) {
    const f=await fixture(t);f.lockFaults.push(lock);
    const result=await f.worker.processMemberLifecycleEmailBatch();
    assert.equal(result.failed,1);assert.equal(f.sends.length,0);assert.equal(f.providerChecks.length,0);
    const [delivery]=await f.deliveries();assert.equal(delivery.status,"failed");assert.equal(delivery.first_attempt_at,null);
    await f.retry();assert.equal((await f.worker.processMemberLifecycleEmailBatch()).sent,1);assert.equal(f.sends.length,1);
  }
});
