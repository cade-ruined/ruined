import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as crypto from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";
import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { installOperatorFundingFunctions } from "./helpers/operator-funding-fixture.mjs";
const ids = { admin: "11111111-1111-4111-8111-111111111111", coordinator: "22222222-2222-4222-8222-222222222222", finance: "33333333-3333-4333-8333-333333333333", supporter: "44444444-4444-4444-8444-444444444444", member: "55555555-5555-4555-8555-555555555555", person: "66666666-6666-4666-8666-666666666666", circle: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies) {
  const js = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", js)(name => { assert.ok(Object.hasOwn(dependencies, name), `Missing ${name}`); return dependencies[name]; }, mod, mod.exports);
  return mod.exports;
}
async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite(), driver = postgres({ host: "127.0.0.1", port: 1, max: 1 });
  t.after(async () => { await db.close(); await driver.end(); });
  await db.exec(`create schema private; create role anon; create role authenticated;
    create table people(id uuid primary key,status text default 'active');
    create table ruined_members(id uuid primary key,person_id uuid,membership_state text default 'active');
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,status text default 'active',email_normalized text);
    create table platform_role_grants(id bigint generated always as identity primary key,auth_user_id uuid,role_slug text,granted_by_auth_user_id uuid,revoked_at timestamptz,revoke_reason text);
    create unique index roles_active on platform_role_grants(auth_user_id,role_slug) where revoked_at is null;
    create table member_lifecycle(member_id uuid primary key,account_state text default 'active',administrative_onboarding_state text default 'completed',program_state text default 'active',foundations_state text default 'completed',standing_state text default 'active',billing_state text default 'active',cancellation_effective_at timestamptz);
    create table person_profiles(person_id uuid primary key,display_name text,preferred_name text);
    create table circles(id uuid primary key,name text,status text default 'active');
    create table circle_member_assignments(id bigint generated always as identity primary key,member_id uuid,circle_id uuid,assigned_at timestamptz default now(),ended_at timestamptz,ended_by_auth_user_id uuid);
    create table circle_staff_assignments(id bigint generated always as identity primary key,auth_user_id uuid,circle_id uuid,role_slug text,assigned_by_auth_user_id uuid,assigned_at timestamptz default statement_timestamp(),ended_at timestamptz,ended_by_auth_user_id uuid,end_reason text);
    create unique index leader on circle_staff_assignments(circle_id) where ended_at is null and role_slug='circle_leader';
    create table operator_audit_events(actor_auth_user_id uuid,action text,subject_type text,subject_id text,reason text,before_snapshot jsonb,after_snapshot jsonb,metadata jsonb,dedupe_key text);
  `);
  await installOperatorFundingFunctions(db);
  await db.exec(await source("db/migrations/20260930100000_supporter_service.sql"));
  await db.exec(await source("db/migrations/20260930111000_supporter_shared_billing.sql"));
  await db.exec(await source("db/migrations/20261001130000_administrator_leadership_access.sql"));
  await db.query("insert into people(id) values($1)",[ids.person]);
  await db.query("insert into ruined_members(id,person_id) values($1,$2)",[ids.member,ids.person]);
  await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized) values($1,$2,$3,'supporter@example.test'),($4,null,null,'admin@example.test'),($5,null,null,'coordinator@example.test'),($6,null,null,'finance@example.test')",[ids.supporter,ids.member,ids.person,ids.admin,ids.coordinator,ids.finance]);
  await db.query("insert into member_lifecycle(member_id) values($1)",[ids.member]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member'),($2,'ops_admin'),($3,'ops_admin'),($4,'ops_admin')",[ids.supporter,ids.admin,ids.coordinator,ids.finance]);
  await db.query("insert into circles(id,name) values($1,'First Circle')",[ids.circle]);
  await db.query("insert into circle_member_assignments(member_id,circle_id) values($1,$2)",[ids.member,ids.circle]);
  let auditFailure = false;
  function wrap(engine) {
    const sql = async (strings,...values) => {
      let query = strings[0]; const params = values.map((v,i) => { query += `$${i+1}${strings[i+1]}`; return v instanceof Parameter ? driver.options.serializers[3802](v.value) : v instanceof Date ? types.date.serialize(v) : v; });
      if (auditFailure && /insert into operator_audit_events/.test(query)) throw Error("Audit unavailable");
      return (await engine.query(query,params)).rows;
    };
    sql.json = driver.json; sql.begin = fn => engine.transaction(tx => fn(wrap(tx))); return sql;
  }
  const ops = await load("src/lib/platform/ops-repository.ts", {
    // This legacy fixture runs with registration-only enrollment disabled.
    "@/lib/membership/registration-repository": { enrollNewMemberRegistration: async () => {} }, "server-only":{}, "node:crypto":crypto, "@/lib/identity/repository":{}, "@/lib/platform/calendar-audience-invalidation":{}, "@/lib/stripe/database":{getBillingDatabase:()=>wrap(db)}, "@/lib/stripe/membership-state":{} });
  const model = await load("src/lib/platform/leadership-model.ts", {});
  const repository = await load("src/lib/platform/leadership-repository.ts", { "server-only":{}, "@/lib/stripe/database":{getBillingDatabase:()=>wrap(db)}, "@/lib/platform/ops-repository":ops, "@/lib/platform/leadership-model":model });
  const run = (actor,body) => repository.executeLeadershipCommand(actor,{ reason:"Reviewed in person.",...body });
  const grant = (authUserId,capability) => run(ids.admin,{action:"grant",authUserId,capability});
  const prepare = async () => { await run(ids.coordinator,{action:"ready",authUserId:ids.supporter,circleId:ids.circle}); };
  const start = () => run(ids.coordinator,{action:"start",authUserId:ids.supporter,circleId:ids.circle,temporary:false});
  return { db, run, grant, prepare, start, repository, model, failAudit:()=>{auditFailure=true;} };
}
const today = () => new Date().toISOString().slice(0,10);
const request = { action:"request_reimbursement",assignmentId:"1",periodStart:today(),periodEnd:today(),amountMinor:49900,currency:"USD" };

test("Administrators inherit Leadership access and losing Administrator access takes effect immediately",async t=>{
  const f=await fixture(t);
  assert.equal((await f.db.query("select count(*)::int n from leadership_responsibility_grants")).rows[0].n,0);
  assert.deepEqual((await f.repository.getLeadershipDirectory(ids.admin)).capabilities,f.model.LEADERSHIP_RESPONSIBILITIES);
  await assert.rejects(f.grant(ids.supporter,"reimbursements"),/active Administrator/);
  await f.prepare();
  // Keep historical responsibility APIs compatible. Revoking this old record
  // cannot remove permissions included in the still-active Administrator role.
  await f.grant(ids.coordinator,"supporter_readiness");
  await f.run(ids.admin,{action:"revoke",authUserId:ids.coordinator,capability:"supporter_readiness"});
  assert.equal((await f.db.query("select private.ruined_has_leadership_responsibility($1,'supporter_readiness') allowed",[ids.coordinator])).rows[0].allowed,true);
  await f.db.query("update platform_role_grants set revoked_at=statement_timestamp() where auth_user_id=$1 and role_slug='ops_admin'",[ids.coordinator]);
  await assert.rejects(f.start(),error=>error.code==="forbidden");
  await assert.rejects(f.repository.getLeadershipDirectory(ids.coordinator),error=>error.code==="forbidden");
  await f.db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1 and role_slug='ops_admin'",[ids.coordinator]);
  await f.db.query("update platform_users set status='disabled' where auth_user_id=$1",[ids.coordinator]);
  await assert.rejects(f.start(),error=>error.code==="forbidden");
  assert.equal((await f.db.query("select count(*)::int n from operator_audit_events")).rows[0].n,3);
});
test("readiness, active membership and Circle membership are required before starting scoped service",async t=>{
  const f=await fixture(t);
  await assert.rejects(f.start(),/readiness/);
  await f.run(ids.coordinator,{action:"ready",authUserId:ids.supporter,circleId:ids.circle});
  await f.db.exec("update member_lifecycle set billing_state='pending'");
  await assert.rejects(f.start(),/active member/);
  await f.db.exec("update member_lifecycle set billing_state='active'"); await f.start();
  assert.equal((await f.db.query("select private.ruined_member_has_operator_funding($1) funded",[ids.member])).rows[0].funded,false,"Supporter role must not grant free access");
  await assert.rejects(f.start(),/already has/);
  await f.run(ids.coordinator,{action:"end",assignmentId:"1",coverAuthUserId:null});
  assert.equal((await f.db.query("select count(*)::int n from platform_role_grants where role_slug='circle_leader' and revoked_at is null")).rows[0].n,0);
  assert.equal((await f.db.query("select count(*)::int n from platform_role_grants where role_slug='member' and revoked_at is null")).rows[0].n,1);
  await assert.rejects(f.run(ids.coordinator,{action:"end",assignmentId:"1",coverAuthUserId:null}),/already ended/);
});
test("audit failure rolls back service start and permission grant together",async t=>{
  const f=await fixture(t);await f.prepare();f.failAudit();await assert.rejects(f.start(),/Audit unavailable/);
  assert.equal((await f.db.query("select count(*)::int n from circle_staff_assignments")).rows[0].n,0);
  assert.equal((await f.db.query("select count(*)::int n from platform_role_grants where role_slug='circle_leader'")).rows[0].n,0);
});
test("Administrators can approve and record historical service without an explicit reimbursement grant",async t=>{
  const f=await fixture(t);await f.prepare();await f.start();
  await f.run(ids.coordinator,{action:"end",assignmentId:"1",coverAuthUserId:null});
  await assert.rejects(f.run(ids.supporter,request),error=>error.code==="forbidden");
  await f.run(ids.admin,request);
  const record=(await f.db.query("select id from supporter_reimbursements")).rows[0];
  await assert.rejects(f.run(ids.finance,{action:"process",reimbursementId:record.id,reference:"BANK-001",processedAt:today()}),/Only an approved/);
  await f.run(ids.finance,{action:"approve",reimbursementId:record.id});
  await f.run(ids.finance,{action:"process",reimbursementId:record.id,reference:"BANK-001",processedAt:today()});
  await assert.rejects(f.run(ids.finance,{action:"process",reimbursementId:record.id,reference:"BANK-001",processedAt:today()}),/Only an approved/);
  assert.equal((await f.db.query("select status from supporter_reimbursements")).rows[0].status,"processed");
  const privateDirectory=await f.repository.getLeadershipDirectory(ids.finance), adminDirectory=await f.repository.getLeadershipDirectory(ids.admin);
  assert.equal(privateDirectory.reimbursements.length,1);assert.equal(adminDirectory.reimbursements.length,1);
  assert.equal((await f.db.query("select membership_state from ruined_members")).rows[0].membership_state,"active");
});
test("overlapping and future reimbursement claims are blocked; rejected claims may be resubmitted",async t=>{
  const f=await fixture(t);await f.prepare();await f.start();await f.run(ids.finance,request);
  await assert.rejects(f.run(ids.finance,request),/already covers/);
  await assert.rejects(f.run(ids.finance,{...request,periodEnd:"2099-01-01"}),/elapsed period/);
  const record=(await f.db.query("select id from supporter_reimbursements")).rows[0];
  await f.run(ids.finance,{action:"reject",reimbursementId:record.id});await f.run(ids.finance,request);
  assert.equal((await f.db.query("select count(*)::int n from supporter_reimbursements")).rows[0].n,2);
  await assert.rejects(f.db.exec("update supporter_reimbursements set amount_minor=1"),/immutable/);
  await assert.rejects(f.db.exec("delete from supporter_reimbursements"),/cannot be deleted/);
});
test("Leadership access preserves independent complimentary funding and administrator funding",async t=>{
  const f=await fixture(t);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'guide')",[ids.supporter]);
  const funding=async()=> (await f.db.query("select private.ruined_member_has_complimentary_funding($1) funded",[ids.member])).rows[0].funded;
  assert.equal(await funding(),false);
  await f.db.query("insert into member_complimentary_grants(member_id) values($1)",[ids.member]);assert.equal(await funding(),true);
  await f.db.exec("update member_complimentary_grants set revoked_at=now()");assert.equal(await funding(),false);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')",[ids.supporter]);assert.equal(await funding(),true);
});
test("input validation rejects forged capabilities, invalid dates, non-integer amounts and unsupported currency",async t=>{
  const f=await fixture(t);
  for(const change of [{amountMinor:0},{amountMinor:10.5},{currency:"JPY"},{periodStart:"2026-02-31"}]) assert.throws(()=>f.model.parseLeadershipCommand({...request,reason:"Review",...change}));
  assert.throws(()=>f.model.parseLeadershipCommand({action:"grant",authUserId:ids.finance,capability:"all",reason:"Review"}));
});

test("temporary coverage validates readiness atomically and leaving never requires a replacement", async t => {
  const f = await fixture(t); await f.prepare(); await f.start();
  const cover="77777777-7777-4777-8777-777777777777", person="88888888-8888-4888-8888-888888888888", member="99999999-9999-4999-8999-999999999999";
  await f.db.query("insert into people(id) values($1)",[person]);
  await f.db.query("insert into ruined_members(id,person_id) values($1,$2)",[member,person]);
  await f.db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized) values($1,$2,$3,'cover@example.test')",[cover,member,person]);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')",[cover]);
  await f.db.query("insert into member_lifecycle(member_id) values($1)",[member]);
  await f.db.query("insert into circle_member_assignments(member_id,circle_id) values($1,$2)",[member,ids.circle]);
  await assert.rejects(f.run(ids.coordinator,{action:"end",assignmentId:"1",coverAuthUserId:cover}),/readiness/);
  assert.equal((await f.db.query("select ended_at from circle_staff_assignments where id=1")).rows[0].ended_at,null);
  assert.equal((await f.db.query("select count(*)::int n from operator_audit_events where action='supporter.service_ended'")).rows[0].n,0);
  await f.run(ids.coordinator,{action:"ready",authUserId:cover,circleId:ids.circle});
  await f.run(ids.coordinator,{action:"end",assignmentId:"1",coverAuthUserId:cover});
  const active=(await f.db.query("select staff.auth_user_id, details.temporary from circle_staff_assignments staff join supporter_service_details details on details.assignment_id=staff.id where staff.ended_at is null")).rows;
  assert.deepEqual(active,[{auth_user_id:cover,temporary:true}]);
});

test("leadership API uses verified identity and rejects foreign origins, missing sessions and non-JSON requests", async () => {
  const calls=[]; const state={trusted:true,viewer:{authUserId:ids.finance}};
  class DomainError extends Error { constructor(code,message){super(message);this.code=code;} }
  const route=await load("app/api/ops/leadership/route.ts",{
    "next/server":{NextResponse:{json:(body,options)=>({body,...options})}},
    "@/lib/auth/request":{isTrustedPlatformOrigin:()=>state.trusted},
    "@/lib/auth/session":{getCurrentPlatformViewer:async()=>state.viewer},
    "@/lib/platform/leadership-repository":{executeLeadershipCommand:async(actor,body)=>{calls.push({actor,body});return {action:body.action};},getLeadershipDirectory:async actor=>({actor})},
    "@/lib/platform/ops-repository":{OpsRepositoryError:DomainError},
  });
  const request=(type="application/json")=>new Request("https://members.example.test/api/ops/leadership",{method:"POST",headers:{"Content-Type":type},body:JSON.stringify({action:"approve",actorAuthUserId:ids.admin})});
  assert.equal((await route.POST(request())).status,200);assert.equal(calls[0].actor,ids.finance);
  state.trusted=false;assert.equal((await route.POST(request())).status,403);state.trusted=true;
  state.viewer=null;assert.equal((await route.POST(request())).status,401);assert.equal((await route.GET()).status,401);
  state.viewer={authUserId:ids.finance};assert.equal((await route.POST(request("text/plain"))).status,415);
  assert.equal(calls.length,1);assert.equal((await route.GET()).headers["Cache-Control"],"private, no-store");
});

test("ending Circle membership automatically ends scoped service, preserves history and never waits for a replacement", async t => {
  const f=await fixture(t); await f.prepare(); await f.start();
  await f.db.query("update circle_member_assignments set ended_at=statement_timestamp(),ended_by_auth_user_id=$1 where member_id=$2 and ended_at is null",[ids.admin,ids.member]);
  const service=(await f.db.query("select ended_at,end_reason from circle_staff_assignments where id=1")).rows[0];
  assert.ok(service.ended_at); assert.equal(service.end_reason,"Circle membership ended");
  assert.equal((await f.db.query("select count(*)::int n from platform_role_grants where role_slug='circle_leader' and revoked_at is null")).rows[0].n,0);
  assert.equal((await f.db.query("select count(*)::int n from platform_role_grants where role_slug='member' and revoked_at is null")).rows[0].n,1);
  assert.equal((await f.db.query("select actor_auth_user_id from operator_audit_events where action='supporter.service_ended_membership'")).rows[0].actor_auth_user_id,ids.admin);
});

test("incomplete Foundations cannot receive readiness or service privileges before Circle reveal", async t => {
  const f=await fixture(t);
  await f.db.exec("update member_lifecycle set foundations_state='in_progress'");
  await assert.rejects(f.run(ids.coordinator,{action:"ready",authUserId:ids.supporter,circleId:ids.circle}),/completed membership entry and Foundations/);
  assert.equal((await f.db.query("select count(*)::int n from supporter_readiness_approvals")).rows[0].n,0);
  // Stale/historical readiness must not bypass the fresh start check either.
  await f.db.query("insert into supporter_readiness_approvals(auth_user_id,circle_id,approved_by_auth_user_id,reason) values($1,$2,$3,'Historical approval')",[ids.supporter,ids.circle,ids.coordinator]);
  await assert.rejects(f.start(),/Foundations/);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'circle_leader')",[ids.supporter]);
  await assert.rejects(f.db.query("insert into circle_staff_assignments(auth_user_id,circle_id,role_slug,assigned_by_auth_user_id) values($1,$2,'circle_leader',$3)",[ids.supporter,ids.circle,ids.coordinator]),/completed Foundations/);
  assert.equal((await f.db.query("select count(*)::int n from circle_staff_assignments")).rows[0].n,0);
});

test("funding readers tuple-lock only Administrator grants, never service grants later revoked by departure", async t => {
  const f=await fixture(t);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'circle_leader'),($1,'guide'),($1,'ops_admin')",[ids.supporter]);
  await f.db.query("insert into member_complimentary_grants(member_id) values($1)",[ids.member]);
  await f.db.transaction(async tx => {
    const before=(await tx.query("select role_slug,xmax::text as lock_xid from platform_role_grants where auth_user_id=$1 order by role_slug",[ids.supporter])).rows;
    const grantBefore=(await tx.query("select xmax::text as lock_xid from member_complimentary_grants where member_id=$1",[ids.member])).rows[0];
    assert.equal((await tx.query("select private.ruined_lock_member_complimentary_funding($1) funded",[ids.member])).rows[0].funded,true);
    const after=(await tx.query("select role_slug,xmax::text as lock_xid from platform_role_grants where auth_user_id=$1 order by role_slug",[ids.supporter])).rows;
    for (const role of ["member","circle_leader","guide"]) assert.equal(after.find(r=>r.role_slug===role).lock_xid,before.find(r=>r.role_slug===role).lock_xid,`${role} must not receive a funding SHARE tuple lock`);
    assert.notEqual(after.find(r=>r.role_slug==="ops_admin").lock_xid,before.find(r=>r.role_slug==="ops_admin").lock_xid,"Administrator funding must still serialize with revocation");
    const grantAfter=(await tx.query("select xmax::text as lock_xid from member_complimentary_grants where member_id=$1",[ids.member])).rows[0];
    assert.notEqual(grantAfter.lock_xid,grantBefore.lock_xid,"Independent complimentary funding must still serialize with revocation");
  });
});

test("a couple Supporter follows shared funding and cannot use stale personal billing after the payer becomes inactive", async t => {
  const f = await fixture(t);
  const payer = "77777777-7777-4777-8777-777777777777", person = "88888888-8888-4888-8888-888888888888", reservation = "99999999-9999-4999-8999-999999999999";
  await f.db.query("insert into people(id) values($1)", [person]);
  await f.db.query("insert into ruined_members(id,person_id) values($1,$2)", [payer,person]);
  await f.db.query("insert into member_lifecycle(member_id) values($1)", [payer]);
  await f.db.query("insert into stripe_subscriptions(id,member_id,stripe_status) values('sub_shared_supporter',$1,'active')", [payer]);
  await f.db.query("insert into membership_commercial_reservations(id,payer_member_id,kind,status,stripe_subscription_id,created_at) values($1,$2,'couple','activated','sub_shared_supporter',statement_timestamp())", [reservation,payer]);
  await f.db.query("insert into membership_commercial_participants(reservation_id,member_id) values($1,$2),($1,$3)", [reservation,payer,ids.member]);
  await f.db.query("update member_lifecycle set billing_state='pending' where member_id=$1", [ids.member]);
  await f.prepare();
  await f.start();
  assert.equal((await f.db.query("select count(*)::int n from circle_staff_assignments where ended_at is null")).rows[0].n, 1);
  await f.run(ids.coordinator, { action:"end", assignmentId:"1", coverAuthUserId:null });
  // Deliberately stale own projection: only the payer's canonical funding wins.
  await f.db.query("update member_lifecycle set billing_state='active' where member_id=$1", [ids.member]);
  for (const billing of ["pending", "attention_required", "ended"]) {
    await f.db.query("update member_lifecycle set billing_state=$2 where member_id=$1", [payer,billing]);
    await assert.rejects(f.run(ids.coordinator, { action:"ready",authUserId:ids.supporter,circleId:ids.circle }), /active member/);
    await assert.rejects(f.start(), /active member/);
    await assert.rejects(f.db.query("insert into circle_staff_assignments(auth_user_id,circle_id,role_slug,assigned_by_auth_user_id) values($1,$2,'circle_leader',$3)", [ids.supporter,ids.circle,ids.coordinator]), /eligible current member/);
  }
  await f.db.query("update member_lifecycle set billing_state='active' where member_id=$1", [payer]);
  for (const status of ["past_due", "canceled"]) {
    await f.db.query("update stripe_subscriptions set stripe_status=$1 where id='sub_shared_supporter'", [status]);
    await assert.rejects(f.start(), /active member/);
    await assert.rejects(f.db.query("insert into circle_staff_assignments(auth_user_id,circle_id,role_slug,assigned_by_auth_user_id) values($1,$2,'circle_leader',$3)", [ids.supporter,ids.circle,ids.coordinator]), /eligible current member/);
  }
  assert.equal((await f.db.query("select count(*)::int n from circle_staff_assignments where ended_at is null")).rows[0].n, 0);
  assert.equal((await f.db.query("select count(*)::int n from platform_role_grants where role_slug='member' and revoked_at is null")).rows[0].n, 1);
  await f.db.query("update stripe_subscriptions set stripe_status='active' where id='sub_shared_supporter'");
  await f.start();
  assert.equal((await f.db.query("select count(*)::int n from circle_staff_assignments where ended_at is null")).rows[0].n, 1);
});
