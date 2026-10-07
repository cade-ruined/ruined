import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { installComplimentaryFundingFunctions } from "./helpers/operator-funding-fixture.mjs";
import { installRegistrationProfileReleaseFunction } from "./helpers/registration-access-fixture.mjs";
import { loadFoundationsAvailability } from "./helpers/foundations-availability-fixture.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const ids = { auth: "11111111-1111-4111-8111-111111111111", member: "22222222-2222-4222-8222-222222222222",
  person: "33333333-3333-4333-8333-333333333333", program: "44444444-4444-4444-8444-444444444444",
  version: "55555555-5555-4555-8555-555555555555" };
async function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
async function fixture(t, { role = "ops_admin", launched = false } = {}) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema private;
    create table people(id uuid primary key,status text default 'active');
    create table ruined_members(id uuid primary key,person_id uuid,email text);
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,email_normalized text,status text default 'active');
    create table platform_role_grants(id bigint generated always as identity primary key,auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text default 'active',administrative_onboarding_state text default 'completed',
      billing_state text default 'pending',cancellation_effective_at timestamptz,foundations_state text default 'not_started',program_state text default 'onboarding',
      standing_state text default 'active',version integer default 1,updated_at timestamptz default now());
    create table foundation_programs(id uuid primary key,slug text);
    create table foundation_versions(id uuid primary key,foundation_program_id uuid,title text,version integer,status text,published_at timestamptz default now());
    create table foundation_units(id uuid primary key,foundation_version_id uuid,unit_slug text,position integer,title text,configuration jsonb default '{}',is_required boolean default true);
    create table foundation_enrollments(id uuid primary key,member_id uuid,foundation_version_id uuid,progress_percent numeric,status text,enrolled_at timestamptz,
      started_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table foundation_unit_progress(enrollment_id uuid,unit_id uuid,foundation_version_id uuid,progress_percent numeric,status text,started_at timestamptz,
      completed_at timestamptz,updated_at timestamptz default now(),primary key(enrollment_id,unit_id));
    create table member_state_history(member_id uuid,dimension text,previous_state text,next_state text,reason_code text,source text,actor_auth_user_id uuid,dedupe_key text unique,metadata jsonb);
    create table circles(id uuid primary key,name text,status text,activated_at timestamptz,ends_at timestamptz);
    create table circle_member_assignments(id bigint generated always as identity primary key,member_id uuid,circle_id uuid,assigned_at timestamptz,ended_at timestamptz);
  `);
  // Current shipped administrator-only funding predicates, including revocation
  // locking; this intentionally does not use the older all-operator definition.
  const funding = await source("db/migrations/20260930100000_supporter_service.sql");
  for (const name of ["ruined_member_has_operator_funding", "ruined_lock_member_operator_funding"]) {
    const start = funding.indexOf(`create or replace function private.${name}(`);
    const end = funding.indexOf("$$;", start);
    assert.ok(start >= 0 && end > start);
    await db.exec(funding.slice(start, end + 3));
  }
  await installComplimentaryFundingFunctions(db);
  await installRegistrationProfileReleaseFunction(db);
  await db.query("insert into people(id) values($1)", [ids.person]);
  await db.query("insert into ruined_members values($1,$2,'admin@example.test',null)", [ids.member, ids.person]);
  await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized) values($1,$2,$3,'admin@example.test')", [ids.auth, ids.member, ids.person]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member'),($1,$2)", [ids.auth, role]);
  await db.query("insert into member_lifecycle(member_id) values($1)", [ids.member]);
  await db.query("insert into foundation_programs values($1,'ruined-foundations')", [ids.program]);
  await db.query("insert into foundation_versions(id,foundation_program_id,title,version,status) values($1,$2,'Foundations',1,'published')", [ids.version, ids.program]);
  for (const [index, slug] of ["story", "culture", "reveal"].entries()) await db.query(
    "insert into foundation_units(id,foundation_version_id,unit_slug,position,title) values($1,$2,$3,$4,$3)", [crypto.randomUUID(), ids.version, slug, index + 1]);
  let beforeTransaction = null;
  function wrap(engine) {
    const sql = async (strings, ...values) => {
      const query = strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, "");
      return (await engine.query(query, values)).rows;
    };
    sql.begin = async (...args) => {
      if (beforeTransaction) { const change = beforeTransaction; beforeTransaction = null; await change(); }
      return engine.transaction(tx => args.at(-1)(wrap(tx)));
    };
    return sql;
  }
  const sql = wrap(db);
  const platform = await load("src/lib/platform/repository.ts", {
    "server-only": {}, "@/lib/membership/personal-invitation-admission": {}, "@/lib/membership/public-signup-admission": {},
    "@/lib/membership/registration-repository": {},
    "@/lib/identity/repository": {}, "@/lib/platform/calendar-audience-invalidation": {},
    "@/lib/stripe/database": { getBillingDatabase: () => sql }, "@/lib/stripe/membership-state": {}, "@/lib/platform/model": {},
  });
  const gate = loadFoundationsAvailability({ MEMBERSHIP_FOUNDATIONS_LAUNCHED: String(launched) }, { getOperatorRole: platform.getOperatorRole });
  const policy = await load("src/lib/membership/access-policy.ts");
  const identity = async authUserId => {
    const [row] = await sql`select member.id as member_id,member.person_id,lifecycle.*,
      private.ruined_member_has_operator_funding(member.id) as operator_funded,
      not private.ruined_member_profile_released(member.id) as registration_held
      from ruined_members member join member_lifecycle lifecycle on lifecycle.member_id=member.id
      join platform_users account on account.member_id=member.id where account.auth_user_id=${authUserId}::uuid`;
    return row ? { memberId: row.member_id, personId: row.person_id, authUserId, accountState: row.account_state,
      administrativeOnboardingState: row.administrative_onboarding_state, billingState: row.billing_state,
      membershipFunding: row.operator_funded ? "operator" : "self", registrationHeld: row.registration_held,
      programState: row.program_state, standingState: row.standing_state, cancellationEffectiveAt: row.cancellation_effective_at } : null;
  };
  const repository = await load("src/lib/foundations/repository.ts", {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/foundations/availability": gate, "@/lib/membership/access-policy": policy,
    "@/lib/membership/repository": { getMemberIdentity: identity }, "@/lib/platform/calendar-audience-invalidation": {},
  });
  return { db, repository, gate, viewer: { authUserId: ids.auth, email: "admin@example.test" },
    beforeNextTransaction: callback => { beforeTransaction = callback; } };
}

test("an active unpaid Administrator can begin and persist Foundations progress before launch", async t => {
  const f = await fixture(t);
  const started = await f.repository.startMemberFoundations(f.viewer);
  assert.equal(started.status, "in_progress");
  assert.equal(started.nextMomentId, "story");
  const progressed = await f.repository.recordMemberFoundationProgress(f.viewer, "story");
  assert.equal(progressed.completedUnits, 1);
  assert.equal(progressed.nextMomentId, "culture");
  assert.equal((await f.db.query("select status from foundation_unit_progress progress join foundation_units unit on unit.id=progress.unit_id where unit_slug='story'")).rows[0].status, "completed");
  assert.equal((await f.db.query("select billing_state from member_lifecycle")).rows[0].billing_state, "pending");
  await assert.rejects(() => f.repository.completeMemberFoundations(f.viewer), f.repository.FoundationSequenceError);
  await f.repository.recordMemberFoundationProgress(f.viewer, "culture");
  await assert.rejects(() => f.repository.completeMemberFoundations(f.viewer), f.repository.CircleRequiredForFoundationCompletionError);
});

test("paid non-administrators cannot start Foundations early or claim administrator access", async t => {
  const f = await fixture(t, { role: "circle_leader" });
  await f.db.exec("update member_lifecycle set billing_state='active'");
  await assert.rejects(() => f.repository.startMemberFoundations({ ...f.viewer, roles: ["ops_admin"] }), f.gate.FoundationsNotLaunchedError);
  assert.equal((await f.db.query("select count(*)::int as count from foundation_enrollments")).rows[0].count, 0);
});

test("registration holds are enforced inside Foundations writes even for Administrators", async t => {
  const f = await fixture(t);
  await f.db.query("insert into member_registration_access(member_id) values($1)", [ids.member]);
  await assert.rejects(() => f.repository.startMemberFoundations(f.viewer), f.repository.FoundationAccessError);
  assert.equal((await f.db.query("select count(*)::int as count from foundation_enrollments")).rows[0].count, 0);
});

test("revocation between the initial admin check and writer lock blocks paid member progress", async t => {
  const f = await fixture(t);
  await f.repository.startMemberFoundations(f.viewer);
  await f.db.exec("update member_lifecycle set billing_state='active'");
  f.beforeNextTransaction(() => f.db.exec("update platform_role_grants set revoked_at=now() where role_slug='ops_admin'"));
  await assert.rejects(() => f.repository.recordMemberFoundationProgress(f.viewer, "story"), f.gate.FoundationsNotLaunchedError);
  assert.equal((await f.db.query("select count(*)::int as count from foundation_unit_progress where status='completed'")).rows[0].count, 0);
});
