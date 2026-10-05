import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migrationPath = "db/migrations/20261005190000_registration_operator_work.sql";
async function shippedFunction(db, path, name, replacement = name) {
  const migration = await source(path);
  const start = migration.search(new RegExp(`create (?:or replace )?function private\\.${name}\\(`));
  assert.ok(start >= 0, `Missing ${name}`);
  await db.exec(migration.slice(start, migration.indexOf("$$;", start) + 3).replace(name, replacement));
}
async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key, status text default 'active');
    create table ruined_members(id uuid primary key, person_id uuid references people(id), email_normalized text,
      membership_state text default 'pending', deleted_at timestamptz, unique(id,person_id));
    create table member_lifecycle(member_id uuid primary key, account_state text default 'active', billing_state text default 'pending',
      standing_state text default 'pre_active', program_state text default 'prospect', cancellation_effective_at timestamptz);
    create table platform_users(auth_user_id uuid primary key, person_id uuid, member_id uuid, email_normalized text, status text default 'active');
    create table platform_role_grants(auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table person_email_addresses(person_id uuid, email_normalized text, verification_state text default 'verified', retired_at timestamptz);
    create table circles(id uuid primary key); create table membership_blocks(id uuid primary key);
    create table member_onboardings(member_id uuid primary key, profile_completed_at timestamptz);
    create table person_private_profiles(person_id uuid primary key, birth_date date, default_fulfillment_address jsonb);
    create table member_registration_access(member_id uuid primary key, registered_at timestamptz, completion_basis text,
      payment_setup_account_id text, payment_setup_livemode boolean, profile_activated_at timestamptz,
      legal_acknowledgment_required boolean default false);
    create table member_consents(member_id uuid, consent_type text, decision text, source text, actor_auth_user_id uuid, evidence jsonb);
    create table member_payment_method_accounts(member_id uuid, stripe_account_id text, livemode boolean, consent_attempt_id uuid,
      stripe_payment_method_id text, saved_at timestamptz, consent_revoked_at timestamptz, cleanup_pending boolean default false,
      primary key(member_id,stripe_account_id,livemode));
    create table member_payment_method_setup_attempts(id uuid primary key, member_id uuid, stripe_account_id text, livemode boolean,
      status text default 'saved', consent_revoked_at timestamptz);
    create table member_payment_method_detachments(stripe_account_id text, livemode boolean, stripe_payment_method_id text);
    create table stripe_checkout_attempts(member_id uuid, status text, stripe_subscription_id text);
    create table stripe_subscriptions(id text primary key, member_id uuid, stripe_status text, cancel_at timestamptz);
    create table membership_couple_authorizations(id uuid primary key, payer_member_id uuid, partner_member_id uuid,
      accepted_at timestamptz, accepted_by_auth_user_id uuid);
    create table membership_commercial_reservations(id uuid primary key, kind text, status text, payer_member_id uuid,
      couple_authorization_id uuid, stripe_subscription_id text, created_at timestamptz default now());
    create table membership_commercial_participants(reservation_id uuid, member_id uuid, person_id uuid, ordinal integer);
    create table membership_enrollment_episodes(reservation_id uuid, member_id uuid, ended_at timestamptz);
    create table member_registration_couple_intents(member_id uuid primary key, partner_email_normalized text, consented_by_auth_user_id uuid);
    create table fixture_funding(member_id uuid primary key, complimentary boolean default false, operator boolean default false);
    create function private.ruined_member_has_complimentary_funding(id uuid) returns boolean language sql as
      $$ select coalesce((select complimentary from fixture_funding where member_id=id),false) $$;
    create function private.ruined_member_has_operator_funding(id uuid) returns boolean language sql as
      $$ select coalesce((select operator from fixture_funding where member_id=id),false) $$;
    create function private.ruined_lock_member_complimentary_funding(id uuid) returns boolean language sql as
      $$ select private.ruined_member_has_complimentary_funding(id) $$;
  `);
  const operations = await source("db/migrations/20260826_membership_operating_spine_05_content_operations.sql");
  await db.exec(operations.slice(operations.indexOf("create table if not exists public.operator_tasks ("), operations.indexOf("-- Overrides are immutable")));
  await db.exec(`create function public.ruined_reject_append_only_mutation() returns trigger language plpgsql as
    $$ begin raise exception 'Append-only records'; end $$;
    create trigger operator_task_events_append_only before update or delete on operator_task_events
      for each row execute function public.ruined_reject_append_only_mutation();`);
  await shippedFunction(db,"db/migrations/20260930200000_registration_eligibility.sql","ruined_registration_intake_eligibility_error");
  await shippedFunction(db,"db/migrations/20260930220000_registration_legal_acknowledgment.sql","ruined_registration_legal_complete");
  await shippedFunction(db,"db/migrations/20260930220000_registration_legal_acknowledgment.sql","ruined_member_registration_ready");
  await shippedFunction(db,"db/migrations/20260930140000_member_registration_access.sql","ruined_member_profile_released");
  await shippedFunction(db,"db/migrations/20260929006000_membership_commercial_eligibility.sql","ruined_member_has_couple_funding");
  await shippedFunction(db,"db/migrations/20260929006000_membership_commercial_eligibility.sql","ruined_member_shared_billing_state");
  await shippedFunction(db,"db/migrations/20260930113000_couple_circle_placement.sql","ruined_circle_couple_partner","ruined_commercial_circle_couple_partner");
  await shippedFunction(db,"db/migrations/20260930210000_registration_couples.sql","ruined_registration_circle_couple_partner");
  const migration = await source(migrationPath);
  await db.exec(migration);
  const configuration = {stripeCheckoutReady:false}, failures = {events:false};
  function sqlFor(engine) {
    const sql = async (parts,...values) => {
      const query = parts.reduce((out,part,index) => out+(index ? `$${index}` : "")+part,"");
      if(failures.events && /insert into operator_task_events/.test(query)) throw new Error("Injected event failure");
      return (await engine.query(query,values)).rows;
    };
    sql.json = JSON.stringify;
    sql.begin = fn => engine.transaction(tx => fn(sqlFor(tx)));
    return sql;
  }
  const loaded = {exports:{}};
  const dependencies = {"server-only":{},"node:crypto":crypto,
    "@/lib/database/server":{getApplicationDatabase:()=>sqlFor(db)},
    "@/lib/platform/config":{getPlatformConfiguration:()=>configuration}};
  new Function("require","module","exports",ts.transpileModule(await source("src/lib/platform/registration-work-repository.ts"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText)(name => { assert.ok(Object.hasOwn(dependencies,name),`Unexpected ${name}`); return dependencies[name]; },loaded,loaded.exports);
  const reconcile = loaded.exports.reconcileRegistrationOperatorWork;
  async function member() {
    const id=crypto.randomUUID(),auth=crypto.randomUUID(),attempt=crypto.randomUUID(),email=`${id}@example.test`;
    await db.query("insert into people(id) values($1)",[id]);
    await db.query("insert into ruined_members(id,person_id,email_normalized) values($1,$1,$2)",[id,email]);
    await db.query("insert into member_lifecycle(member_id) values($1)",[id]);
    await db.query("insert into platform_users(auth_user_id,person_id,member_id,email_normalized) values($1,$2,$2,$3)",[auth,id,email]);
    await db.query("insert into platform_role_grants values($1,'member',null)",[auth]);
    await db.query("insert into person_email_addresses(person_id,email_normalized) values($1,$2)",[id,email]);
    await db.query("insert into member_onboardings values($1,now())",[id]);
    await db.query(`insert into person_private_profiles values($1,'1990-01-01','{"countryCode":"US"}')`,[id]);
    await db.query("insert into member_registration_access(member_id,registered_at,completion_basis,payment_setup_account_id,payment_setup_livemode) values($1,now(),'saved_card','acct_Fixture',false)",[id]);
    await db.query("insert into member_payment_method_setup_attempts(id,member_id,stripe_account_id,livemode) values($1,$2,'acct_Fixture',false)",[attempt,id]);
    await db.query("insert into member_payment_method_accounts(member_id,stripe_account_id,livemode,consent_attempt_id,stripe_payment_method_id,saved_at) values($1,'acct_Fixture',false,$2,$3,now())",[id,attempt,`pm_${id}`]);
    return {id,auth,attempt,email};
  }
  const tasks = async id => (await db.query("select * from operator_tasks where member_id=$1 order by created_at,id",[id])).rows;
  async function replaceCard(member) {
    const attempt = crypto.randomUUID();
    await db.query("insert into member_payment_method_setup_attempts(id,member_id,stripe_account_id,livemode) values($1,$2,'acct_Fixture',false)",[attempt,member.id]);
    await db.query("update member_payment_method_accounts set consent_attempt_id=$2 where member_id=$1",[member.id,attempt]);
    return attempt;
  }
  async function couple(a,b,{commercial=false}={}) {
    for(const [own,partner] of [[a,b],[b,a]]) await db.query("insert into member_registration_couple_intents values($1,$2,$3)",[own.id,partner.email,own.auth]);
    if(!commercial) return;
    const id=crypto.randomUUID(),authorization=crypto.randomUUID();
    await db.query("insert into membership_couple_authorizations values($1,$2,$3,now(),$4)",[authorization,a.id,b.id,b.auth]);
    await db.query("insert into membership_commercial_reservations(id,kind,status,payer_member_id,couple_authorization_id) values($1,'couple','reserved',$2,$3)",[id,a.id,authorization]);
    await db.query("insert into membership_commercial_participants values($1,$2,$2,1),($1,$3,$3,2)",[id,a.id,b.id]);
    return id;
  }
  return {db,configuration,failures,reconcile,member,tasks,replaceCard,couple,migration};
}

test("existing saved-card registrations get one durable blocked task; release gates preserve assignment and never set overdue dates",async t=>{
  const f=await fixture(t),member=await f.member();
  assert.deepEqual(await f.reconcile(),{created:1,updated:0,resolved:0});
  let [task]=await f.tasks(member.id);
  assert.equal(task.status,"blocked"); assert.equal(task.due_at,null);
  assert.match(task.title,/billing opening pending/); assert.match(task.blocked_reason,/commercial and payment/);
  assert.deepEqual(await f.reconcile(),{created:0,updated:0,resolved:0});
  await Promise.all([f.reconcile(),f.reconcile()]);
  assert.equal((await f.tasks(member.id)).length,1);
  f.configuration.stripeCheckoutReady=true;
  assert.equal((await f.reconcile()).updated,1);
  [task]=await f.tasks(member.id); assert.equal(task.status,"blocked"); assert.match(task.blocked_reason,/profile has not been activated/);
  await f.db.query("update member_registration_access set profile_activated_at=now() where member_id=$1",[member.id]);
  assert.equal((await f.reconcile()).updated,1);
  [task]=await f.tasks(member.id); assert.equal(task.status,"open"); assert.equal(task.blocked_reason,null);
  await f.db.query("update operator_tasks set status='in_progress',assigned_to_auth_user_id=$2 where id=$1",[task.id,member.auth]);
  assert.deepEqual(await f.reconcile(),{created:0,updated:0,resolved:0});
  f.configuration.stripeCheckoutReady=false;
  await f.reconcile(); [task]=await f.tasks(member.id);
  assert.equal(task.status,"blocked"); assert.equal(task.assigned_to_auth_user_id,member.auth); assert.equal(task.due_at,null);
  const events=(await f.db.query("select * from operator_task_events order by id")).rows;
  assert.equal(events.length,4); assert.ok(events.every(event=>event.actor_type==='system' && event.actor_auth_user_id===null));
  assert.equal((await f.db.query("select count(*)::int n from stripe_subscriptions")).rows[0].n,0);
  assert.equal((await f.db.query("select count(*)::int n from stripe_checkout_attempts")).rows[0].n,0);
});

test("completed reviews stay completed for the same consent; a new saved method starts one fresh review",async t=>{
  const f=await fixture(t),member=await f.member(); await f.reconcile();
  const [original]=await f.tasks(member.id);
  await f.db.query("update operator_tasks set status='completed',completed_at=now() where id=$1",[original.id]);
  f.configuration.stripeCheckoutReady=true;
  await f.db.query("update member_registration_access set profile_activated_at=now() where member_id=$1",[member.id]);
  assert.deepEqual(await f.reconcile(),{created:0,updated:0,resolved:0});
  await f.replaceCard(member);
  assert.deepEqual(await f.reconcile(),{created:1,updated:0,resolved:0});
  const tasks=await f.tasks(member.id); assert.equal(tasks.length,2);
  assert.equal(tasks.find(task=>task.id===original.id).status,"completed");
  assert.equal(tasks.filter(task=>task.status==='open').length,1);
});

test("payment resolves the review; replaced cards retire stale work; withdrawal cancels it without erasing history",async t=>{
  const f=await fixture(t),paid=await f.member(),replaced=await f.member(),withdrawn=await f.member(); await f.reconcile();
  await f.db.query("insert into stripe_subscriptions values('sub_paid',$1,'active',null)",[paid.id]);
  await f.replaceCard(replaced);
  await f.db.query("update member_payment_method_accounts set consent_revoked_at=now() where member_id=$1",[withdrawn.id]);
  assert.deepEqual(await f.reconcile(),{created:1,updated:0,resolved:3});
  assert.equal((await f.tasks(paid.id))[0].status,"completed");
  assert.equal((await f.tasks(withdrawn.id))[0].status,"cancelled");
  assert.deepEqual((await f.tasks(replaced.id)).map(task=>task.status).sort(),['blocked','cancelled']);
  assert.deepEqual(await f.reconcile(),{created:0,updated:0,resolved:0});
  await assert.rejects(f.db.exec("delete from operator_task_events"),/Append-only/);
});

test("ineligible, inactive, funded, detached and incomplete registrations produce no billing work",async t=>{
  const f=await fixture(t);
  const changes=[
    "update member_registration_access set registered_at=null,completion_basis=null where member_id=$1",
    "update member_registration_access set completion_basis='complimentary' where member_id=$1",
    "update ruined_members set deleted_at=now() where id=$1",
    "update people set status='inactive' where id=$1",
    "update member_lifecycle set account_state='suspended' where member_id=$1",
    "update member_lifecycle set account_state='closed' where member_id=$1",
    "update member_lifecycle set program_state='withdrawn' where member_id=$1",
    "update member_lifecycle set billing_state='active' where member_id=$1",
    "update member_lifecycle set billing_state='attention_required' where member_id=$1",
    "insert into fixture_funding values($1,true,false)",
    "insert into fixture_funding values($1,false,true)",
    "update member_registration_access set legal_acknowledgment_required=true where member_id=$1",
    "update member_onboardings set profile_completed_at=null where member_id=$1",
    "update person_email_addresses set verification_state='unverified' where person_id=$1",
    "update member_payment_method_accounts set cleanup_pending=true where member_id=$1",
    "update member_payment_method_accounts set saved_at=null where member_id=$1",
    "update member_payment_method_accounts set stripe_payment_method_id=null where member_id=$1",
    "update member_payment_method_accounts set livemode=true where member_id=$1",
    "update member_payment_method_accounts set stripe_account_id='acct_Wrong' where member_id=$1",
    "update member_payment_method_setup_attempts set consent_revoked_at=now() where member_id=$1",
    "update member_payment_method_setup_attempts set status='revoked' where member_id=$1",
    "insert into member_payment_method_detachments select stripe_account_id,livemode,stripe_payment_method_id from member_payment_method_accounts where member_id=$1",
  ];
  for(const query of changes){ const member=await f.member(); await f.db.query(query,[member.id]); }
  assert.deepEqual(await f.reconcile(),{created:0,updated:0,resolved:0});
});

test("registration-only couples retain independent reviews; canonical shared billing moves review to the payer",async t=>{
  const f=await fixture(t),a=await f.member(),b=await f.member(); await f.couple(a,b);
  assert.equal((await f.reconcile()).created,2);
  assert.match((await f.tasks(a.id))[0].description,/Circle placement intent only/);
  await f.db.exec("delete from member_registration_couple_intents");
  const reservation=await f.couple(a,b,{commercial:true});
  const changed=await f.reconcile(); assert.equal(changed.resolved,1);
  assert.equal((await f.tasks(a.id))[0].status,"blocked");
  assert.match((await f.tasks(a.id))[0].description,/canonical billing owner/);
  assert.equal((await f.tasks(b.id))[0].status,"cancelled");
  await f.db.query("insert into stripe_subscriptions values('sub_couple',$1,'active',null)",[a.id]);
  await f.db.query("update member_lifecycle set billing_state='active' where member_id=$1",[a.id]);
  await f.db.query("update membership_commercial_reservations set status='activated',stripe_subscription_id='sub_couple' where id=$1",[reservation]);
  assert.equal((await f.reconcile()).resolved,1);
  assert.equal((await f.tasks(a.id))[0].status,"completed");
  assert.equal((await f.tasks(b.id)).length,1);
});

test("pending checkout blocks review and clearing the hold restores only system-cancelled work",async t=>{
  const f=await fixture(t),member=await f.member(); f.configuration.stripeCheckoutReady=true;
  await f.db.query("update member_registration_access set profile_activated_at=now() where member_id=$1",[member.id]);
  await f.db.query("insert into stripe_checkout_attempts values($1,'creating',null)",[member.id]);
  await f.reconcile(); let [task]=await f.tasks(member.id);
  assert.equal(task.status,"blocked"); assert.match(task.blocked_reason,/checkout or subscription confirmation/);
  await f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1",[member.id]);
  assert.equal((await f.reconcile()).resolved,1);
  await f.db.query("update member_lifecycle set account_state='active' where member_id=$1",[member.id]);
  await f.db.exec("delete from stripe_checkout_attempts");
  assert.equal((await f.reconcile()).updated,1); [task]=await f.tasks(member.id);
  assert.equal(task.status,"open"); assert.equal((await f.tasks(member.id)).length,1);
});

test("stale active lifecycle projections cannot mark troubled or ended Stripe billing as paid",async t=>{
  const f=await fixture(t);
  for(const status of ['paused','past_due','unpaid','canceled','incomplete_expired']) {
    const member=await f.member(); await f.reconcile();
    await f.db.query("update member_lifecycle set billing_state='active' where member_id=$1",[member.id]);
    await f.db.query("insert into stripe_subscriptions values($1,$2,$3,null)",[`sub_${member.id}`,member.id,status]);
    await f.reconcile();
    assert.equal((await f.tasks(member.id))[0].status,'cancelled',status);
  }
  const payer=await f.member(),partner=await f.member(); await f.reconcile();
  const reservation=await f.couple(payer,partner,{commercial:true});
  await f.db.query("update member_lifecycle set billing_state='active' where member_id in ($1,$2)",[payer.id,partner.id]);
  await f.db.query("insert into stripe_subscriptions values('sub_troubled_couple',$1,'paused',null)",[payer.id]);
  await f.db.query("update membership_commercial_reservations set status='activated',stripe_subscription_id='sub_troubled_couple' where id=$1",[reservation]);
  await f.reconcile();
  assert.equal((await f.tasks(payer.id))[0].status,'cancelled');
  assert.equal((await f.tasks(partner.id))[0].status,'cancelled');
  assert.equal((await f.db.query("select count(*)::int n from registration_operator_work where resolution_reason='billing_active'")).rows[0].n,0);
});

test("event failures roll back task creation, and the migration keeps the task source private and immutable",async t=>{
  const f=await fixture(t),member=await f.member();
  f.failures.events=true; await assert.rejects(f.reconcile(),/Injected event failure/);
  assert.equal((await f.tasks(member.id)).length,0);
  assert.equal((await f.db.query("select count(*)::int n from registration_operator_work")).rows[0].n,0);
  f.failures.events=false; await f.reconcile(); await f.db.exec(f.migration);
  await assert.rejects(f.db.exec("delete from registration_operator_work"),/history must be retained/);
  await assert.rejects(f.db.exec("update registration_operator_work set payment_setup_attempt_id=gen_random_uuid()"),/identity is immutable/);
  for(const role of ['anon','authenticated']) {
    assert.equal((await f.db.query("select has_table_privilege($1,'registration_operator_work','select') allowed",[role])).rows[0].allowed,false);
  }
  assert.equal((await f.db.query("select relrowsecurity enabled from pg_class where oid='registration_operator_work'::regclass")).rows[0].enabled,true);
  assert.equal((await f.tasks(member.id)).length,1);
});

test("registration work migration applies after the existing complete platform schema without data backfill",async t=>{
  const PGlite=await loadPGliteForSchemaChecks(),db=new PGlite(); t.after(()=>db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const paths=[...((await source("scripts/migrate-platform.mjs")).matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g))].map(match=>match[1]);
  for(const path of paths) if(path!==migrationPath && !/202610051[89]/.test(path)) await db.exec(await source(path));
  await db.exec(await source(migrationPath)); await db.exec(await source(migrationPath));
  assert.equal((await db.query("select count(*)::int n from registration_operator_work")).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from operator_tasks where task_type='registration.billing_review'")).rows[0].n,0);
});
