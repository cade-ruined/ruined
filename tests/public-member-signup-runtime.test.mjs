import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { load } from "./helpers/personal-invitation-fixture.mjs";

const viewer = { authUserId: "11111111-1111-4111-8111-111111111111", email: "new@example.test" };
const otherAuth = "22222222-2222-4222-8222-222222222222";
const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const pricing = await load("src/lib/membership/pricing.ts");

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  const driver = postgres({ host: "127.0.0.1", port: 1, max: 1 });
  t.after(async () => { await db.close(); await driver.end(); });
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key, status text default 'active');
    create table person_email_addresses(person_id uuid references people(id), email text, email_normalized text unique,
      verification_state text, verified_at timestamptz, source text, is_primary boolean, retired_at timestamptz, updated_at timestamptz default now());
    create table ruined_members(id uuid primary key, person_id uuid unique references people(id), email text, email_normalized text unique,
      membership_state text default 'pending', membership_activated_at timestamptz, deleted_at timestamptz);
    create table platform_users(auth_user_id uuid primary key, member_id uuid unique references ruined_members(id), person_id uuid references people(id),
      email_normalized text unique, user_type text, status text, activated_at timestamptz, last_signed_in_at timestamptz, updated_at timestamptz default now());
    create table platform_role_grants(auth_user_id uuid references platform_users(auth_user_id), role_slug text, granted_at timestamptz, revoked_at timestamptz);
    create unique index platform_roles_unique on platform_role_grants(auth_user_id,role_slug) where revoked_at is null;
    create table member_lifecycle(member_id uuid primary key references ruined_members(id), account_state text, billing_state text,
      program_state text, admission_state text, administrative_onboarding_state text, standing_state text, version bigint default 1, updated_at timestamptz default now());
    create table member_onboardings(member_id uuid primary key references ruined_members(id),state text,form_version text,requirements_snapshot jsonb,
      started_at timestamptz,updated_at timestamptz default now());
    create table member_state_history(member_id uuid,dimension text,previous_state text,next_state text,reason_code text,source text,actor_auth_user_id uuid,dedupe_key text unique);
    create table communication_contacts(person_id uuid,email_normalized text,updated_at timestamptz);
    create table community_event_registrations(person_id uuid,email_normalized text,updated_at timestamptz);
  `);
  await db.exec(await source("db/migrations/20260929000000_public_member_signup.sql"));
  const wrap = engine => {
    const sql = (strings, ...values) => {
      const parameters = values.map(value => value instanceof Parameter ? driver.options.serializers[value.type](value.value)
        : value instanceof Date ? types.date.serialize(value) : value);
      return engine.query(strings.reduce((result, part, i) => result + (i ? `$${i}` : "") + part, ""), parameters).then(result => result.rows);
    };
    sql.begin = callback => engine.transaction(tx => callback(wrap(tx)));
    return sql;
  };
  const identity = await load("src/lib/identity/repository.ts", { "server-only": {}, "node:crypto": crypto });
  const api = await load("src/lib/membership/public-signup-admission.ts", {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => wrap(db) },
    "@/lib/identity/repository": identity, "@/lib/membership/pricing": pricing,
  });
  return { db, api };
}

test("verified public signup creates one pending membership, preserves selected plan, and grants entry capabilities only", async t => {
  const { db, api } = await fixture(t);
  assert.equal(await api.getPublicMembershipSignupEligibility(viewer.email), true);
  await api.claimPublicMembershipSignup(viewer, "annual");
  await api.claimPublicMembershipSignup(viewer, "monthly");
  const { rows: [row] } = await db.query(`select m.membership_state,m.membership_activated_at,l.*,o.billing_plan,u.status,
    (select count(*)::int from ruined_members) as member_count,(select count(*)::int from platform_role_grants) as grant_count,
    (select verification_state from person_email_addresses) as verification from ruined_members m
    join member_lifecycle l on l.member_id=m.id join member_onboardings o on o.member_id=m.id join platform_users u on u.member_id=m.id`);
  assert.equal(row.member_count, 1); assert.equal(row.grant_count, 1);
  assert.equal(row.membership_state, "pending"); assert.equal(row.membership_activated_at, null);
  assert.equal(row.account_state, "active"); assert.equal(row.status, "active");
  assert.equal(row.billing_state, "pending"); assert.equal(row.program_state, "prospect");
  assert.equal(row.standing_state, "pre_active"); assert.equal(row.administrative_onboarding_state, "in_progress");
  assert.equal(row.verification, "verified"); assert.equal(row.billing_plan, "annual");
  assert.equal(await api.getMemberSignupPlan(viewer.authUserId), "annual");
  const policy = await load("src/lib/membership/access-policy.ts");
  const access = policy.deriveMemberAccessPolicy({ accountState: row.account_state,billingState: row.billing_state,programState: row.program_state,
    standingState: row.standing_state,administrativeOnboardingState: row.administrative_onboarding_state,cancellationEffectiveAt:null });
  assert.equal(access.mode,"entry");
  for (const capability of ["foundations.write","circle.read","learn.read","experiences.member"]) assert.equal(policy.memberCan(access,capability),false);
  assert.equal(policy.memberCan(access,"profile.write"),true);
});

test("public signup never changes an existing paid membership or active grant", async t => {
  const { db, api } = await fixture(t);
  await api.claimPublicMembershipSignup(viewer,"monthly");
  await db.exec("update ruined_members set membership_state='active',membership_activated_at=now(); update member_lifecycle set billing_state='active',program_state='active',standing_state='active',administrative_onboarding_state='completed'");
  const before = (await db.query("select * from member_lifecycle")).rows;
  await api.claimPublicMembershipSignup(viewer,"annual");
  assert.deepEqual((await db.query("select * from member_lifecycle")).rows,before);
  assert.equal(await api.getMemberSignupPlan(viewer.authUserId),"monthly");
});

test("public signup fails closed for deleted, closed, suspended, declined and revoked members", async t => {
  const { db, api } = await fixture(t);
  await api.claimPublicMembershipSignup(viewer,"monthly");
  for (const [block,restore] of [
    ["update ruined_members set deleted_at=now()","update ruined_members set deleted_at=null"],
    ["update member_lifecycle set account_state='closed'","update member_lifecycle set account_state='active'"],
    ["update member_lifecycle set account_state='suspended'","update member_lifecycle set account_state='active'"],
    ["update member_lifecycle set admission_state='declined'","update member_lifecycle set admission_state='accepted'"],
    ["update member_lifecycle set admission_state='withdrawn'","update member_lifecycle set admission_state='accepted'"],
    ["update platform_users set status='disabled'","update platform_users set status='active'"],
    ["update platform_role_grants set revoked_at=now()","update platform_role_grants set revoked_at=null"],
    ["update people set status='merged'","update people set status='active'"],
  ]) {
    await db.exec(block);
    assert.equal(await api.getPublicMembershipSignupEligibility(viewer.email),false,block);
    await assert.rejects(api.claimPublicMembershipSignup(viewer,"annual"),api.PublicMembershipSignupDeniedError,block);
    await db.exec(restore);
  }
});

test("verified signup cannot attach another auth user or alternate email to an existing member", async t => {
  const { db, api } = await fixture(t);
  await api.claimPublicMembershipSignup(viewer,"monthly");
  await assert.rejects(api.claimPublicMembershipSignup({ ...viewer,authUserId:otherAuth },"annual"),api.PublicMembershipSignupDeniedError);
  await assert.rejects(api.claimPublicMembershipSignup({ ...viewer,email:"someone-else@example.test" },"annual"),api.PublicMembershipSignupDeniedError);
  assert.equal((await db.query("select count(*)::int as count from ruined_members")).rows[0].count,1);
});

test("public signup limits delivery by both email and network without retaining raw identifiers", async t => {
  const { db, api } = await fixture(t);
  const request = new Request("https://members.example.test/api/auth/otp/request",{headers:{"x-forwarded-for":"192.0.2.1"}});
  for (let i=0;i<8;i++) assert.equal(await api.consumePublicMembershipSignupRateLimit(viewer.email,request),true);
  assert.equal(await api.consumePublicMembershipSignupRateLimit(viewer.email,request),false);
  assert.equal(await api.consumePublicMembershipSignupRateLimit("another@example.test",request),false);
  assert.equal(await api.consumePublicMembershipSignupRateLimit(viewer.email,new Request(request.url,{headers:{"x-forwarded-for":"192.0.2.2"}})),false);
  const rows = (await db.query("select fingerprint_hash from member_signup_rate_limits")).rows;
  assert.ok(rows.every(row=>/^[a-f0-9]{64}$/.test(row.fingerprint_hash)));
});
