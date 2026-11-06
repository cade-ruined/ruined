import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { installMemberSmsFundingFixture, seedMemberSmsPaidReservation } from "./helpers/member-sms-funding-fixture.mjs";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration="db/migrations/20261103021417_member_paid_profile_release.sql";
const complimentaryMigration="db/migrations/20261104202219_automatic_complimentary_profile_release.sql";
function functionSql(path,name) {
  const source=read(path),match=source.match(new RegExp(`create (?:or replace )?function private\\.${name}\\(`));
  assert.ok(match,`Missing real function ${name}`);
  return source.slice(match.index,source.indexOf("$$;",match.index)+3);
}
function load(path,deps={}) {
  const code=ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function("require","module","exports","process",code)(name=>{
    if(name==="server-only")return{};assert.ok(name in deps,`Unexpected dependency ${name}`);return deps[name];
  },mod,mod.exports,{env:{STRIPE_PAYMENT_SETUP_ACCOUNT_ID:"acct_fixture",STRIPE_SECRET_KEY:"sk_live_fixture"}});
  return mod.exports;
}
async function fixture(t) {
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create schema private;
    create table people(id uuid primary key,status text default 'active');
    create table ruined_members(id uuid primary key,person_id uuid,email_normalized text,membership_state text default 'pending',deleted_at timestamptz);
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,email_normalized text,status text default 'active');
    create table platform_role_grants(id bigint generated always as identity primary key,auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text default 'active',billing_state text default 'pending',standing_state text default 'pre_active',cancellation_effective_at timestamptz);
    create table person_private_profiles(person_id uuid primary key,birth_date date,default_fulfillment_address jsonb);
    create table person_email_addresses(person_id uuid,email_normalized text,verification_state text,retired_at timestamptz);
    create table member_onboardings(member_id uuid primary key,profile_completed_at timestamptz);
    create table member_payment_method_setup_attempts(id uuid primary key,member_id uuid,stripe_account_id text,livemode boolean,status text,consent_revoked_at timestamptz);
    create table member_payment_method_accounts(member_id uuid,consent_attempt_id uuid,stripe_account_id text,livemode boolean,stripe_payment_method_id text,saved_at timestamptz,consent_revoked_at timestamptz,cleanup_pending boolean default false);
    create table member_payment_method_detachments(stripe_account_id text,livemode boolean,stripe_payment_method_id text);
    create table member_consents(id bigint generated always as identity primary key,member_id uuid,consent_type text,decision text,source text,actor_auth_user_id uuid,evidence jsonb);
    create table operator_audit_events(actor_auth_user_id uuid,action text,subject_type text,subject_id text,member_id uuid,before_snapshot jsonb,after_snapshot jsonb,metadata jsonb,dedupe_key text unique);
  `);
  const original=read("db/migrations/20260930140000_member_registration_access.sql");
  await db.exec(original.slice(0,original.indexOf("-- Retry bytes"))+"commit;");
  await installMemberSmsFundingFixture(db);
  const initial=read("db/migrations/20261006220000_registration_initial_payment.sql");
  await db.exec(initial.slice(0,initial.indexOf("create function private.ruined_registration_intake_ready"))+"commit;");
  await db.exec("alter table member_registration_access add column legal_acknowledgment_required boolean not null default true;");
  await db.exec(functionSql("db/migrations/20260930220000_registration_legal_acknowledgment.sql","ruined_registration_legal_complete"));
  await db.exec(functionSql("db/migrations/20260930200000_registration_eligibility.sql","ruined_registration_intake_eligibility_error"));
  await db.exec(functionSql("db/migrations/20261006220000_registration_initial_payment.sql","ruined_registration_intake_ready"));
  await db.exec(`create function private.ruined_registration_paid_reservation(uuid) returns uuid language sql as
    'select private.ruined_member_paid_reservation($1)';
    create function private.ruined_confirm_registration_pricing(uuid) returns void language sql as 'select';`);
  for (const name of ["ruined_member_registration_ready","ruined_guard_registration_payment_requirement"]) {
    await db.exec(functionSql("db/migrations/20261007111000_legacy_registration_checkout.sql",name));
  }
  await db.exec(read(migration));
  await db.exec(read(complimentaryMigration));
  await db.exec(`create trigger registration_payment_requirement before insert or update on member_registration_access
    for each row execute function private.ruined_guard_registration_payment_requirement();`);
  const hooks=[],faults=[];
  function wrap(engine) {
    const sql=async(strings,...values)=>{
      const query=strings.reduce((s,p,i)=>s+(i?`$${i}`:"")+p,"");
      const hook=hooks.findIndex(row=>query.includes(row.match));
      if(hook>=0) await hooks.splice(hook,1)[0].run(engine);
      const fault=faults.findIndex(match=>query.includes(match));
      if(fault>=0){faults.splice(fault,1);throw Error("Injected transaction failure");}
      return (await engine.query(query,values)).rows;
    };
    sql.json=JSON.stringify;sql.begin=(options,callback)=>engine.transaction(tx=>(callback??options)(wrap(tx)));return sql;
  }
  const sql=wrap(db);
  const repo=load("src/lib/membership/registration-repository.ts",{
    "@/lib/database/server":{getApplicationDatabase:()=>sql},
    "@/lib/platform/config":{getPlatformConfiguration:()=>({stripeActivationReady:true})},
    // Onboarding reconciliation is covered with real guards in complimentary-registration-onboarding.test.mjs.
    "./complimentary-onboarding-repository": { reconcileComplimentaryRegistrationOnboarding: async () => false },
    "./registration-routing":load("src/lib/membership/registration-routing.ts"),
  });
  async function member({paid=true,legacy=false,legal=true,complete=true,admin=false}={}) {
    const who={memberId:randomUUID(),personId:randomUUID(),auth:randomUUID(),email:`${randomUUID()}@example.test`};
    await db.query("insert into people(id) values($1)",[who.personId]);
    await db.query("insert into ruined_members(id,person_id,email_normalized) values($1,$2,$3)",[who.memberId,who.personId,who.email]);
    await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized) values($1,$2,$3,$4)",[who.auth,who.memberId,who.personId,who.email]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')",[who.auth]);
    if(admin)await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')",[who.auth]);
    await db.query("insert into member_lifecycle(member_id) values($1)",[who.memberId]);
    await db.query("insert into person_private_profiles values($1,'1990-01-01','{\"countryCode\":\"US\"}')",[who.personId]);
    await db.query("insert into person_email_addresses values($1,$2,'verified',null)",[who.personId,who.email]);
    await db.query("insert into member_onboardings values($1,case when $2 then now() else null end)",[who.memberId,complete]);
    if(legal)await db.query(`insert into member_consents(member_id,consent_type,decision,source,actor_auth_user_id,evidence)
      values($1,'privacy','accepted','member',$2,$3)`,[who.memberId,who.auth,JSON.stringify({context:"registration_documents_v1",affirmativeAction:"checkbox_and_submit",
        membershipTerms:{key:"ruined_registration",sha256:"a".repeat(64)},registrationTermsAccepted:true,paidAgreementAccepted:false,chargeAuthorized:false})]);
    await db.query("insert into member_registration_access(member_id,requires_initial_payment,payment_setup_account_id,payment_setup_livemode) values($1,$2,'acct_fixture',true)",[who.memberId,!legacy]);
    if(paid){
      Object.assign(who,await seedMemberSmsPaidReservation(db,{...who,reservation:randomUUID(),contract:randomUUID(),release:false}));
      const prior=who.subscription;who.subscription=prior.replaceAll("-","");
      for(const [table,column] of [["stripe_subscriptions","id"],...[
        "membership_commercial_reservations","stripe_membership_prepaid_proofs","stripe_checkout_attempts","stripe_checkout_sessions","stripe_invoices",
      ].map(name=>[name,"stripe_subscription_id"])])await db.query(`update ${table} set ${column}=$1 where ${column}=$2`,[who.subscription,prior]);
    }
    return who;
  }
  const state=async who=>(await db.query("select * from member_registration_access where member_id=$1",[who.memberId])).rows[0];
  const complete=who=>sql.begin(tx=>repo.reconcileMemberRegistration(tx,who.memberId));
  const snapshot=async(admin,who)=>(await repo.previewPaidMemberProfileReleases(admin.auth,[who.memberId]))[0];
  return {db,sql,repo,member,state,complete,snapshot,hooks,faults};
}

test("verified payment completes and releases both current and legacy registrations exactly once",async t=>{
  const f=await fixture(t);
  for(const legacy of [false,true]){
    const m=await f.member({legacy});await f.complete(m);
    const before=await f.state(m);assert.ok(before.registered_at);assert.ok(before.profile_activated_at);
    assert.equal(before.completion_basis,"paid_membership");assert.equal(before.profile_payment_reservation_id,m.reservation);
    assert.equal(before.activated_by_auth_user_id,null);
    assert.deepEqual((await f.db.query("select kind from member_registration_messages where member_id=$1 order by kind",[m.memberId])).rows.map(r=>r.kind),["profile_ready","welcome"]);
    await f.complete(m);await f.repo.reconcilePaidMemberRegistrations(m.subscription);
    assert.deepEqual(await f.state(m),before);
    const audit=(await f.db.query("select * from operator_audit_events where subject_id=$1",[m.memberId])).rows;
    assert.equal(audit.length,1);assert.equal(audit[0].actor_auth_user_id,null);assert.equal(audit[0].metadata.paymentReservationId,m.reservation);
    assert.equal((await f.db.query("select billing_state,standing_state from member_lifecycle where member_id=$1",[m.memberId])).rows[0].standing_state,"pre_active");
  }
});

test("couples release each complete participant against the payer's shared proof",async t=>{
  const f=await fixture(t),payer=await f.member(),partner=await f.member({paid:false});
  await f.db.query("insert into membership_commercial_participants values($1,$2,$3)",[payer.reservation,partner.memberId,partner.personId]);
  for(const m of [payer,partner])assert.deepEqual((await f.db.query("select private.ruined_member_paid_reservation($1) paid,private.ruined_registration_intake_ready($1) intake",[m.memberId])).rows[0],{paid:payer.reservation,intake:true});
  await f.repo.reconcilePaidMemberRegistrations(payer.subscription);
  for(const m of [payer,partner])assert.equal((await f.state(m)).profile_payment_reservation_id,payer.reservation);
});

test("payment never invents intake, legal acknowledgment or verified identity",async t=>{
  const f=await fixture(t);
  for(const options of [{legal:false},{complete:false}]){
    const m=await f.member(options);await f.complete(m);assert.equal((await f.state(m)).profile_activated_at,null);assert.equal((await f.state(m)).registered_at,null);
  }
  for(const mutate of [
    m=>f.db.query("update person_email_addresses set verification_state='unverified' where person_id=$1",[m.personId]),
    m=>f.db.query("update platform_users set email_normalized='other@example.test' where auth_user_id=$1",[m.auth]),
    m=>f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1",[m.memberId]),
    m=>f.db.query("update person_private_profiles set default_fulfillment_address='{\"countryCode\":\"CA\"}' where person_id=$1",[m.personId]),
  ]){const m=await f.member();await mutate(m);await f.complete(m);assert.equal((await f.state(m)).profile_activated_at,null);}
});

test("shared payment cannot release a partner after payer suspension, termination or effective cancellation",async t=>{
  const f=await fixture(t);
  for(const change of ["account_state='closed'","account_state='suspended'","standing_state='inactive'","standing_state='cancellation_requested',cancellation_effective_at=now()-interval '1 second'"]){
    const payer=await f.member(),partner=await f.member({paid:false});
    await f.db.query("insert into membership_commercial_participants values($1,$2,$3)",[payer.reservation,partner.memberId,partner.personId]);
    await f.db.query(`update member_lifecycle set ${change} where member_id=$1`,[payer.memberId]);
    assert.equal((await f.db.query("select private.ruined_member_paid_reservation($1) paid",[partner.memberId])).rows[0].paid,payer.reservation);
    await f.complete(partner);assert.equal((await f.state(partner)).profile_activated_at,null);
  }
  const payer=await f.member(),partner=await f.member({paid:false});
  await f.db.query("insert into membership_commercial_participants values($1,$2,$3)",[payer.reservation,partner.memberId,partner.personId]);
  await f.db.query("update member_onboardings set profile_completed_at=null where member_id=$1",[payer.memberId]);
  await f.complete(partner);assert.equal((await f.state(partner)).profile_payment_reservation_id,payer.reservation,"payer onboarding is not an extra partner requirement");
});

test("saved-card-only registration retains separate release and deployed administrator writers remain compatible",async t=>{
  const f=await fixture(t),card=await f.member({paid:false,legacy:true}),comp=await f.member({paid:false});
  const attempt=randomUUID();
  await f.db.query("insert into member_payment_method_setup_attempts values($1,$2,'acct_fixture',true,'saved',null)",[attempt,card.memberId]);
  await f.db.query("insert into member_payment_method_accounts values($1,$2,'acct_fixture',true,'pm_fixture',now(),null,false)",[card.memberId,attempt]);
  await f.db.query("insert into member_complimentary_grants(member_id) values($1)",[comp.memberId]);
  await f.complete(card);assert.ok((await f.state(card)).registered_at);assert.equal((await f.state(card)).profile_activated_at,null);
  // Previously deployed admin writers remain compatible with the additive migration.
  await f.db.query("update member_registration_access set registered_at=now(),completion_basis='complimentary' where member_id=$1",[comp.memberId]);
  await f.db.query("update member_registration_access set profile_activated_at=now(),activated_by_auth_user_id=$2 where member_id=$1",[comp.memberId,comp.auth]);
  const before=await f.state(comp);await f.complete(comp);assert.deepEqual(await f.state(comp),before);
  assert.ok((await f.state(comp)).profile_activated_at);assert.equal((await f.state(comp)).profile_payment_reservation_id,null);
});

test("current complimentary and operator funding automatically release completed registration once with real grant evidence",async t=>{
  const f=await fixture(t);
  for(const admin of [false,true]){
    const m=await f.member({paid:false,admin});
    const grant=admin
      ? (await f.db.query("select id::text as id from platform_role_grants where auth_user_id=$1 and role_slug='ops_admin'",[m.auth])).rows[0].id
      : (await f.db.query("insert into member_complimentary_grants(member_id) values($1) returning id",[m.memberId])).rows[0].id;
    await f.complete(m);const before=await f.state(m);
    assert.ok(before.registered_at);assert.ok(before.profile_activated_at);
    assert.equal(before.completion_basis,"complimentary");assert.equal(before.activated_by_auth_user_id,null);
    assert.equal(before.profile_payment_reservation_id,null);
    assert.equal(before.profile_complimentary_grant_id,admin?null:grant);
    assert.equal(before.profile_operator_grant_id===null?null:String(before.profile_operator_grant_id),admin?grant:null);
    assert.deepEqual((await f.db.query("select kind from member_registration_messages where member_id=$1 order by kind",[m.memberId])).rows.map(r=>r.kind),["profile_ready","welcome"]);
    await f.complete(m);assert.deepEqual(await f.state(m),before);
    const audit=(await f.db.query("select * from operator_audit_events where subject_id=$1",[m.memberId])).rows;
    assert.equal(audit.length,1);assert.equal(audit[0].actor_auth_user_id,null);
    assert.equal(audit[0].metadata[admin?"operatorGrantId":"complimentaryGrantId"],grant);
    assert.equal(audit[0].after_snapshot.billingChanged,false);
    assert.equal((await f.db.query("select count(*)::int n from stripe_checkout_attempts where member_id=$1",[m.memberId])).rows[0].n,0);
  }
});

test("complimentary access preserves intake, legal, identity, account, standing and current funding gates",async t=>{
  const f=await fixture(t);
  for(const mutate of [
    m=>f.db.query("update member_onboardings set profile_completed_at=null where member_id=$1",[m.memberId]),
    m=>f.db.query("delete from member_consents where member_id=$1",[m.memberId]),
    m=>f.db.query("update person_email_addresses set verification_state='pending' where person_id=$1",[m.personId]),
    m=>f.db.query("update platform_users set email_normalized='changed@example.test' where auth_user_id=$1",[m.auth]),
    m=>f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1",[m.auth]),
    m=>f.db.query("update people set status='inactive' where id=$1",[m.personId]),
    m=>f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1",[m.memberId]),
    m=>f.db.query("update member_lifecycle set standing_state='inactive' where member_id=$1",[m.memberId]),
    m=>f.db.query("update member_lifecycle set standing_state='cancellation_requested',cancellation_effective_at=now()-interval '1 second' where member_id=$1",[m.memberId]),
    m=>f.db.query("update person_private_profiles set default_fulfillment_address='{\"countryCode\":\"CA\"}' where person_id=$1",[m.personId]),
    m=>f.db.query("update member_complimentary_grants set revoked_at=now() where member_id=$1",[m.memberId]),
    m=>f.db.query("update member_complimentary_grants set ends_at=now()-interval '1 second' where member_id=$1",[m.memberId]),
    m=>f.db.query("update member_complimentary_grants set starts_at=now()+interval '1 day' where member_id=$1",[m.memberId]),
  ]){
    const m=await f.member({paid:false});
    await f.db.query("insert into member_complimentary_grants(member_id) values($1)",[m.memberId]);
    await mutate(m);await f.complete(m);
    assert.equal((await f.state(m)).profile_activated_at,null);
    assert.equal((await f.db.query("select count(*)::int n from member_registration_messages where member_id=$1 and kind='profile_ready'",[m.memberId])).rows[0].n,0);
  }
  const operator=await f.member({paid:false,admin:true});
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='ops_admin'",[operator.auth]);
  await f.complete(operator);assert.equal((await f.state(operator)).profile_activated_at,null);
});

test("complimentary release rechecks funding after identity locks and rolls back emails and audit atomically",async t=>{
  const f=await fixture(t),m=await f.member({paid:false});
  await f.db.query("insert into member_complimentary_grants(member_id) values($1)",[m.memberId]);
  f.hooks.push({match:"select member.id from ruined_members member",run:tx=>tx.query("update member_complimentary_grants set revoked_at=now() where member_id=$1",[m.memberId])});
  await f.complete(m);assert.ok((await f.state(m)).registered_at);assert.equal((await f.state(m)).profile_activated_at,null);
  // The fixture permits restoring funding; production grant history is immutable.
  await f.db.query("update member_complimentary_grants set revoked_at=null where member_id=$1",[m.memberId]);
  const before=await f.state(m);f.faults.push("insert into operator_audit_events");
  await assert.rejects(f.complete(m),/Injected/);assert.deepEqual(await f.state(m),before);
  assert.equal((await f.db.query("select count(*)::int n from member_registration_messages where member_id=$1 and kind='profile_ready'",[m.memberId])).rows[0].n,0);
  await f.complete(m);assert.ok((await f.state(m)).profile_activated_at);
});

test("complimentary provenance cannot be forged, reassigned or cleared and survives expired funding",async t=>{
  const f=await fixture(t),m=await f.member({paid:false}),other=await f.member({paid:false,admin:true});
  const grant=(await f.db.query("insert into member_complimentary_grants(member_id) values($1) returning id",[m.memberId])).rows[0].id;
  await assert.rejects(f.db.query("update member_registration_access set profile_activated_at=now(),profile_complimentary_grant_id=$2 where member_id=$1",[m.memberId,grant]),/completed intake/);
  await f.db.query("update member_registration_access set registered_at=now(),completion_basis='complimentary' where member_id=$1",[other.memberId]);
  await assert.rejects(f.db.query("update member_registration_access set profile_activated_at=now(),profile_complimentary_grant_id=$2 where member_id=$1",[other.memberId,grant]),/current complimentary grant/);
  await f.complete(m);
  await assert.rejects(f.db.query("update member_registration_access set profile_complimentary_grant_id=null where member_id=$1",[m.memberId]),/immutable/);
  await assert.rejects(f.db.query("update member_registration_access set member_id=$2 where member_id=$1",[m.memberId,randomUUID()]),/immutable/);
  await assert.rejects(f.db.query("update member_registration_access set activated_by_auth_user_id=$2 where member_id=$1",[m.memberId,m.auth]),/immutable/);
  await assert.rejects(f.db.query("update member_registration_access set profile_activated_at=null where member_id=$1",[m.memberId]),/immutable/);
  await assert.rejects(f.db.query("delete from member_complimentary_grants where id=$1",[grant]),/foreign key/);
  await f.db.query("update member_complimentary_grants set ends_at=now()-interval '1 second' where id=$1",[grant]);
  const before=await f.state(m);await f.complete(m);assert.deepEqual(await f.state(m),before);
  for(const role of ["anon","authenticated"]){
    for(const fn of ["ruined_complimentary_profile_release_ready(uuid)","ruined_guard_profile_complimentary_release()"]){
      assert.equal((await f.db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,`private.${fn}`])).rows[0].allowed,false);
    }
  }
});

test("refund, review, cancellation, mismatched account and removed participation block release",async t=>{
  const f=await fixture(t);
  for(const mutate of [
    m=>f.db.query("update stripe_membership_prepaid_proofs set refund_state='refunded',amount_refunded=amount_paid where reservation_id=$1",[m.reservation]),
    m=>f.db.query("update stripe_membership_prepaid_proofs set review_reason='payment_adjustment' where reservation_id=$1",[m.reservation]),
    m=>f.db.query("update stripe_subscriptions set stripe_status='canceled' where id=$1",[m.subscription]),
    m=>f.db.query("update stripe_subscriptions set cancel_at=now()-interval '1 second' where id=$1",[m.subscription]),
    m=>f.db.query("insert into membership_enrollment_episodes values($1,$2,now())",[m.reservation,m.memberId]),
    m=>f.db.query("update stripe_checkout_attempts set payment_setup_livemode=false where id=$1",[m.reservation]),
    m=>f.db.query("delete from membership_commercial_participants where member_id=$1",[m.memberId]),
  ]){const m=await f.member();await mutate(m);await f.complete(m);assert.equal((await f.state(m)).profile_activated_at,null);}
});

test("bounded repair requires current admin, exact version and payment, and rejects races",async t=>{
  const f=await fixture(t),admin=await f.member({paid:false,admin:true}),m=await f.member();
  await f.db.query("update member_registration_access set registered_at=now(),completion_basis='paid_membership',payment_reservation_id=$2 where member_id=$1",[m.memberId,m.reservation]);
  const preview=await f.snapshot(admin,m),expected={memberId:m.memberId,version:preview.version,paymentReservationId:m.reservation};
  assert.equal(preview.eligible,true);assert.equal((await f.state(m)).profile_activated_at,null);
  await assert.rejects(f.repo.reconcileSelectedPaidMemberProfileReleases(m.auth,[expected]),{status:403});
  await assert.rejects(f.repo.reconcileSelectedPaidMemberProfileReleases(admin.auth,[{...expected,version:999}]),{status:409});
  await assert.rejects(f.repo.reconcileSelectedPaidMemberProfileReleases(admin.auth,[{...expected,paymentReservationId:randomUUID()}]),{status:409});
  await assert.rejects(f.repo.reconcileSelectedPaidMemberProfileReleases(admin.auth,[expected,expected]),{status:400});
  f.hooks.push({match:"select proof.reservation_id from stripe_membership_prepaid_proofs",run:tx=>tx.query("update stripe_membership_prepaid_proofs set refund_state='refunded' where reservation_id=$1",[m.reservation])});
  await assert.rejects(f.repo.reconcileSelectedPaidMemberProfileReleases(admin.auth,[expected]),{status:409});
  assert.equal((await f.state(m)).profile_activated_at,null);
  const released=await f.repo.reconcileSelectedPaidMemberProfileReleases(admin.auth,[expected]);
  assert.ok(released[0].profileActivatedAt);
});

test("release and both message/audit writes roll back together; payment provenance stays historical and immutable",async t=>{
  const f=await fixture(t),m=await f.member();
  f.faults.push("insert into operator_audit_events");
  await assert.rejects(f.complete(m),/Injected/);assert.equal((await f.state(m)).registered_at,null);assert.equal((await f.state(m)).profile_activated_at,null);
  assert.equal((await f.db.query("select count(*)::int n from member_registration_messages")).rows[0].n,0);
  await f.complete(m);
  await assert.rejects(f.db.query("update member_registration_access set profile_payment_reservation_id=null where member_id=$1",[m.memberId]),/immutable/);
  await assert.rejects(f.db.query("update member_registration_access set activated_by_auth_user_id=$2 where member_id=$1",[m.memberId,m.auth]),/immutable/);
  await f.db.query("update stripe_membership_prepaid_proofs set refund_state='refunded' where reservation_id=$1",[m.reservation]);
  assert.equal((await f.state(m)).profile_payment_reservation_id,m.reservation);
  await assert.rejects(f.db.query("delete from membership_commercial_reservations where id=$1",[m.reservation]),/foreign key/);
  const unpaid=await f.member({paid:false});
  await assert.rejects(f.db.query("update member_registration_access set registered_at=now(),completion_basis='paid_membership' where member_id=$1",[unpaid.memberId]),/Verified initial membership payment/);
  for(const role of ["anon","authenticated"]){
    assert.equal((await f.db.query("select has_table_privilege($1,'member_registration_access','UPDATE') allowed",[role])).rows[0].allowed,false);
    assert.equal((await f.db.query("select has_function_privilege($1,'private.ruined_guard_profile_payment_release()','EXECUTE') allowed",[role])).rows[0].allowed,false);
  }
});
