import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";

import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const admin = "11111111-1111-4111-8111-111111111111";
const auth = "22222222-2222-4222-8222-222222222222";
const circle = "33333333-3333-4333-8333-333333333333";
const email = "pilot@example.test";
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(await source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  // The driver's serializers feed an isolated engine. No driver query or
  // provider call runs, and DATABASE_URL is never read.
  const driver = postgres({ host: "127.0.0.1", port: 1, max: 1 });
  t.after(async () => { await db.close(); await driver.end(); });
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const invitationTable = foundation.match(/create table if not exists passwordless_account_invites \([\s\S]*?\n\);/)?.[0];
  const circleGate = await source("db/migrations/20260825_membership_foundations_circle_gate.sql");
  const guardStart = circleGate.indexOf("create or replace function private.ruined_guard_invitation_revocation_audit()");
  const guardEnd = circleGate.indexOf("alter table public.foundation_enrollments", guardStart);
  const operatorMigration = await source("db/migrations/20260829_operator_access_management.sql");
  const configStart = operatorMigration.indexOf("create table if not exists public.operator_invitation_configs");
  const configEnd = operatorMigration.indexOf("alter table public.operator_invitation_configs enable row level security");
  assert.ok(invitationTable && guardStart >= 0 && guardEnd > guardStart && configStart >= 0 && configEnd > configStart);
  // Execute shipped invitation constraints, revocation guards, immutable
  // operator configuration and Circle-scope guards unchanged. The surrounding
  // identity/onboarding tables are minimal dependencies, not query mocks.
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema private;
    create table people (id uuid primary key, status text default 'active');
    create table person_email_addresses (
      person_id uuid references people(id), email text, email_normalized text unique,
      verification_state text, verified_at timestamptz, source text, is_primary boolean,
      retired_at timestamptz, updated_at timestamptz default now()
    );
    create table ruined_members (
      id uuid primary key, person_id uuid references people(id), email text,
      email_normalized text unique, membership_state text default 'pending', deleted_at timestamptz, updated_at timestamptz default now()
    );
    create table platform_users (
      auth_user_id uuid primary key, member_id uuid references ruined_members(id), person_id uuid references people(id),
      email_normalized text unique, user_type text, status text, invited_at timestamptz,
      activated_at timestamptz, last_signed_in_at timestamptz, updated_at timestamptz default now()
    );
    create table platform_roles (role_slug text primary key);
    insert into platform_roles values ('member'), ('ops_admin'), ('circle_leader'), ('guide');
    create table platform_role_grants (
      id bigint generated always as identity primary key, auth_user_id uuid references platform_users(auth_user_id),
      role_slug text references platform_roles(role_slug), granted_at timestamptz default now(),
      granted_by_auth_user_id uuid references platform_users(auth_user_id), revoked_at timestamptz
    );
    create table member_lifecycle (
      member_id uuid primary key references ruined_members(id), account_state text, billing_state text,
      program_state text, admission_state text, administrative_onboarding_state text,
      standing_state text, cancellation_effective_at timestamptz, access_started_at timestamptz,
      version integer default 1, updated_at timestamptz default now()
    );
    create table member_onboardings (
      member_id uuid primary key references ruined_members(id), state text, form_version text,
      requirements_snapshot jsonb, invited_at timestamptz, started_at timestamptz,
      profile_completed_at timestamptz, agreement_completed_at timestamptz, updated_at timestamptz default now()
    );
    create table member_state_history (
      member_id uuid, dimension text, previous_state text, next_state text, reason_code text,
      source text, actor_auth_user_id uuid, dedupe_key text unique
    );
    create table circles (id uuid primary key, name text, status text);
    create table circle_staff_assignments (
      circle_id uuid references circles(id), auth_user_id uuid references platform_users(auth_user_id),
      role_slug text, assigned_by_auth_user_id uuid, assigned_at timestamptz, ended_at timestamptz
    );
    create table person_profiles (person_id uuid primary key, display_name text, preferred_name text, updated_at timestamptz);
    create table communication_contacts (person_id uuid, email_normalized text, updated_at timestamptz);
    create table community_event_registrations (person_id uuid, email_normalized text, updated_at timestamptz);
    create table operator_audit_events (
      actor_auth_user_id uuid, action text, subject_type text, subject_id text, reason text,
      before_snapshot jsonb, after_snapshot jsonb, metadata jsonb, dedupe_key text unique
    );
    ${invitationTable}
    alter table passwordless_account_invites add column revoked_by_auth_user_id uuid references platform_users(auth_user_id);
    ${circleGate.slice(guardStart, guardEnd)}
    ${operatorMigration.slice(configStart, configEnd)}
    ${foundation.match(/create table if not exists integration_outbox \([\s\S]*?\n\);/)[0]}
    create table stripe_subscriptions(member_id uuid, stripe_status text);
    create table stripe_checkout_attempts(member_id uuid, status text);
    create table stripe_checkout_sessions(member_id uuid, session_status text);
  `);
  const operatorFunding = await source("db/migrations/20260914181653_operator_complimentary_membership.sql");
  for (const name of ["private.ruined_member_has_operator_funding", "private.ruined_lock_member_operator_funding"]) {
    const start = operatorFunding.indexOf(`create or replace function ${name}(`);
    const end = operatorFunding.indexOf("$$;", start);
    assert.ok(start >= 0 && end > start, `Missing shipped function ${name}`);
    await db.exec(operatorFunding.slice(start, end + 3));
  }
  for (const name of ['20260914225359_membership_waitlist','20260919211000_member_referrals',
    '20260922200000_member_invitation_expiry','20260923000000_personal_member_invitations','20260924000000_personal_invitation_admission']) {
    await db.exec(await source(`db/migrations/${name}.sql`));
  }
  const complimentary = await source("db/migrations/20260925000000_complimentary_member_invitations.sql");
  const fundingPredicateMarker = complimentary.indexOf("-- Replace only funding predicates.");
  assert.ok(fundingPredicateMarker > 0, "Missing migration prefix boundary");
  await db.exec(complimentary.slice(0, fundingPredicateMarker) + "\ncommit;");
  for (const name of ['20260929000000_public_member_signup', '20260929002000_ruined_direct_invitations']) {
    await db.exec(await source(`db/migrations/${name}.sql`));
  }
  await db.query("insert into platform_users (auth_user_id,email_normalized,status,user_type) values ($1,'admin@example.test','active','staff')", [admin]);
  await db.query("insert into platform_role_grants (auth_user_id,role_slug) values ($1,'ops_admin')", [admin]);
  await db.query("insert into circles values ($1,'Circle Test','active')", [circle]);

  let testClock = null;
  const wrap = (engine) => {
    const sql = async (strings, ...values) => {
      let query = strings[0];
      const parameters = values.map((value, index) => {
        query += `$${index + 1}${strings[index + 1]}`;
        if (value instanceof Parameter) return driver.options.serializers[value.type](value.value);
        return value instanceof Date ? types.date.serialize(value) : value;
      });
      // Deterministic deadline crossings without racing the full suite's load.
      // Date.toISOString is a validated test timestamp; production SQL is untouched.
      if (testClock) query = query.replaceAll('clock_timestamp()', `'${testClock.toISOString()}'::timestamptz`);
      return (await engine.query(query, parameters)).rows;
    };
    sql.json = driver.json;
    sql.begin = (callback) => engine.transaction((tx) => callback(wrap(tx)));
    return sql;
  };
  const basic = { "server-only": {}, "node:crypto": crypto };
  const identity = await load("src/lib/identity/repository.ts", basic);
  const database = { getApplicationDatabase: () => wrap(db), withFreshApplicationDatabaseRead: (_stage, read) => read() };
  const signup = await load("src/lib/membership/public-signup-admission.ts", {
    ...basic, "@/lib/database/server": database, "@/lib/identity/repository": identity,
    "@/lib/membership/pricing": await load("src/lib/membership/pricing.ts"),
  });
  let checkoutReady = true;
  const admission = await load("src/lib/membership/personal-invitation-admission.ts", {
    ...basic, "@/lib/database/server": database, "@/lib/identity/repository": identity,
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ stripeCheckoutReady: checkoutReady }) },
    "@/lib/membership/public-signup-admission": signup,
  });
  let beforeCommit = async () => {};
  const deps = {
    ...basic,
    "@/lib/membership/personal-invitation-admission": admission,
    "@/lib/membership/public-signup-admission": signup,
    "@/lib/identity/repository": identity,
    "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) },
    "@/lib/stripe/membership-state": await load("src/lib/stripe/membership-state.ts"),
    "@/lib/platform/model": await load("src/lib/platform/model.ts"),
    // Calendar invalidation is unrelated to invitation access and cannot send
    // external messages; all identity, invitation and role SQL executes.
    "@/lib/platform/calendar-audience-invalidation": { markCalendarAudiencesPendingForMember: (...args) => beforeCommit(...args) },
  };
  const platform = await load("src/lib/platform/repository.ts", deps);
  const members = await load("src/lib/platform/ops-repository.ts", deps);
  const pending = await load("src/lib/platform/ops-member-invitation-repository.ts", { ...deps, "@/lib/platform/ops-repository": members });
  const operators = await load("src/lib/platform/ops-access-repository.ts", { ...deps, "@/lib/platform/repository": platform });
  const allowMember = (overrides = {}) => members.createOrReissueMemberInvitation({ actorAuthUserId: admin, email, ...overrides });
  const allowGuide = () => operators.createOrReissueOperatorInvitation({ actorAuthUserId: admin, email, displayName: "Test Guide", role: "guide", circleIds: [circle] });
  const grants = async () => (await db.query("select role_slug from platform_role_grants where auth_user_id=$1 and revoked_at is null order by role_slug", [auth])).rows.map((row) => row.role_slug);
  async function personal({ recipient = email, expiresIn = '48 hours', owner = null, complimentary = false, complimentaryEndsIn = null } = {}) {
    const memberId = owner ?? crypto.randomUUID(), personId = crypto.randomUUID(), inviterAuth = crypto.randomUUID();
    if (!owner) {
      await db.query('insert into people(id) values($1)', [personId]);
      await db.query("insert into ruined_members(id,person_id,email,email_normalized,membership_state) values($1,$2,$3,$3,'active')", [memberId, personId, `${memberId}@example.test`]);
      await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status,user_type) values($1,$2,$3,$4,'active','member')", [inviterAuth, memberId, personId, `${memberId}@example.test`]);
      await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [inviterAuth]);
      await db.query("insert into member_lifecycle(member_id,account_state,billing_state,program_state,administrative_onboarding_state,standing_state) values($1,'active','active','onboarding','completed','active')", [memberId]);
    }
    if (complimentary) await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [inviterAuth]);
    const token = crypto.randomBytes(32).toString('base64url');
    const result = await db.query(`insert into member_personal_invitations(member_id,request_id,public_token,recipient_name,recipient_email_normalized,inviter_name,email_requested,issued_at,expires_at,membership_type,complimentary_reason,complimentary_ends_at,complimentary_authorized_by_auth_user_id)
      values($1,$2,$3,'Invited Person',$4,'Inviter',false,statement_timestamp()+$5::interval-interval '48 hours',statement_timestamp()+$5::interval,$6,$7,case when $8::text is null then null else statement_timestamp()+$8::interval end,$9::uuid) returning id,issued_at,expires_at`, [memberId,crypto.randomUUID(),token,recipient,expiresIn,complimentary ? 'complimentary' : 'standard',complimentary ? 'Founding member' : null,complimentaryEndsIn,complimentary ? inviterAuth : null]);
    return { token, memberId, inviterAuth, ...result.rows[0] };
  }
  async function direct() {
    const token = crypto.randomBytes(32).toString('base64url');
    const { rows: [invitation] } = await db.query(`insert into member_personal_invitations(
      member_id,origin,request_id,public_token,recipient_name,recipient_email_normalized,inviter_name,email_requested,membership_type,billing_plan)
      values(null,'ruined_direct',$1,$2,'New Member',$3,'Ruined',true,'standard','annual') returning *`, [crypto.randomUUID(), token, email]);
    return { token, ...invitation };
  }
  return { db, members, pending, operators, platform, admission, personal, direct, allowMember, allowGuide, grants,
    checkout: ready => { checkoutReady = ready; },
    beforeCommit: callback => { beforeCommit = callback; }, clock: value => { testClock = new Date(value); } };
}

test("closing public checkout invalidates direct admission but preserves member invitation admission", async t => {
  const f = await fixture(t);
  const direct = await f.direct();
  assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility(email, direct.token), true);
  f.checkout(false);
  assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility(email, direct.token), false);
  await assert.rejects(f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, direct.token), f.platform.PlatformAccessDeniedError);
  assert.deepEqual(await f.grants(), []);
  assert.equal((await f.db.query("select count(*)::int as count from ruined_members")).rows[0].count, 0);
  assert.equal((await f.db.query("select accepted_at from member_personal_invitations where id=$1", [direct.id])).rows[0].accepted_at, null);

  const memberInvitation = await f.personal();
  assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility(email, memberInvitation.token), true);
  await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, memberInvitation.token);
  assert.deepEqual(await f.grants(), ["member"], "The public launch gate must not break normal member invitations.");
});

test("direct verified claim is idempotent and cannot restore changed identity or withdrawn membership", async t => {
  const f = await fixture(t);
  const invitation = await f.direct();
  const viewer = { authUserId: auth, email };
  const firstClaim = await f.platform.claimPlatformMemberForViewer(viewer, invitation.token);
  const accepted = (await f.db.query("select * from member_personal_invitations where id=$1", [invitation.id])).rows[0];
  assert.deepEqual(await f.platform.claimPlatformMemberForViewer(viewer, invitation.token), firstClaim);
  assert.deepEqual((await f.db.query("select * from member_personal_invitations where id=$1", [invitation.id])).rows[0], accepted);
  assert.equal((await f.db.query("select billing_plan from member_onboardings where member_id=$1", [firstClaim.memberId])).rows[0].billing_plan, "annual");
  assert.deepEqual(await f.grants(), ["member"]);
  assert.equal((await f.db.query("select count(*)::int as count from member_referrals")).rows[0].count, 0);
  for (const imposter of [{ authUserId: crypto.randomUUID(), email }, { ...viewer, email: "different@example.test" }]) {
    await assert.rejects(f.platform.claimPlatformMemberForViewer(imposter, invitation.token), f.platform.PlatformAccessDeniedError);
  }
  for (const [block, restore] of [
    ["update ruined_members set deleted_at=now()", "update ruined_members set deleted_at=null"],
    ["update member_lifecycle set account_state='closed'", "update member_lifecycle set account_state='active'"],
    ["update member_lifecycle set account_state='suspended'", "update member_lifecycle set account_state='active'"],
    ["update member_lifecycle set admission_state='declined'", "update member_lifecycle set admission_state='accepted'"],
    ["update member_lifecycle set admission_state='withdrawn'", "update member_lifecycle set admission_state='accepted'"],
    [`update platform_users set status='disabled' where auth_user_id='${auth}'`, `update platform_users set status='active' where auth_user_id='${auth}'`],
    [`update platform_role_grants set revoked_at=now() where auth_user_id='${auth}'`, `update platform_role_grants set revoked_at=null where auth_user_id='${auth}'`],
    ["update people set status='merged'", "update people set status='active'"],
  ]) {
    await f.db.exec(block);
    assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility(email, invitation.token), false, block);
    await assert.rejects(f.platform.claimPlatformMemberForViewer(viewer, invitation.token), f.platform.PlatformAccessDeniedError, block);
    await f.db.exec(restore);
  }
  assert.deepEqual((await f.db.query("select * from member_personal_invitations where id=$1", [invitation.id])).rows[0], accepted);
  assert.equal((await f.db.query("select count(*)::int as count from ruined_members")).rows[0].count, 1);
});

test("member reissue and revoke preserve the pending operator invitation and immutable scope", async (t) => {
  const f = await fixture(t);
  const staff = await f.allowGuide();
  const originalStaff = (await f.db.query("select * from passwordless_account_invites where intended_user_type='staff'")).rows;
  const member = await f.allowMember();
  assert.equal(member.reissued, false, "An unrelated staff invitation is not a member reissue");
  const renewed = await f.allowMember({ email: " PILOT@EXAMPLE.TEST " });
  assert.equal(renewed.reissued, true);
  assert.notEqual(renewed.id, member.id);
  assert.deepEqual((await f.db.query("select * from passwordless_account_invites where intended_user_type='staff'")).rows, originalStaff);
  assert.equal((await f.db.query("select count(*)::int as count from passwordless_account_invites where intended_user_type='member' and revoked_at is null")).rows[0].count, 1);
  assert.deepEqual(await f.members.revokeLiveMemberInvitations({ actorAuthUserId: admin, email }), { email, revoked: 1 });
  assert.deepEqual((await f.db.query("select * from passwordless_account_invites where intended_user_type='staff'")).rows, originalStaff);
  assert.equal((await f.db.query("select role_slug from operator_invitation_configs where invitation_id=$1", [staff.entry.id.slice(11)])).rows[0].role_slug, "guide");
  assert.deepEqual(await f.grants(), [], "Allow/reissue/revoke grants no role before verification");
  await assert.rejects(f.members.revokeLiveMemberInvitations({ actorAuthUserId: admin, email }), (error) => error.code === "not_found");
});

test("operator reissue and revoke preserve a pending member invitation and its seven-day window", async (t) => {
  const f = await fixture(t);
  await f.allowMember();
  const originalMember = (await f.db.query("select * from passwordless_account_invites where intended_user_type='member'")).rows;
  const first = await f.allowGuide();
  const second = await f.allowGuide();
  assert.equal(first.reissued, false);
  assert.equal(second.reissued, true);
  assert.deepEqual((await f.db.query("select * from passwordless_account_invites where intended_user_type='member'")).rows, originalMember);
  assert.equal((new Date(originalMember[0].expires_at) - new Date(originalMember[0].invited_at)) / 86400000, 7);
  await f.operators.revokeOperatorInvitation({ actorAuthUserId: admin, email });
  assert.deepEqual((await f.db.query("select * from passwordless_account_invites where intended_user_type='member'")).rows, originalMember);
  assert.deepEqual(await f.grants(), []);
});

test("member-only verified claim grants only membership, never operator privileges or paid benefits", async (t) => {
  const f = await fixture(t);
  await f.allowMember();
  await assert.rejects(f.operators.claimPlatformOperatorForViewer({ authUserId: auth, email }), f.platform.PlatformAccessDeniedError);
  const claimed = await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email });
  assert.deepEqual(await f.grants(), ["member"]);
  const lifecycle = (await f.db.query("select account_state,billing_state,program_state,standing_state from member_lifecycle where member_id=$1", [claimed.memberId])).rows[0];
  assert.deepEqual(lifecycle, { account_state: "active", billing_state: "pending", program_state: "prospect", standing_state: "pre_active" });
  await assert.rejects(f.allowMember(), (error) => error.code === "conflict");
});

test("parallel approved invitation types claim one identity and only the specifically configured Guide scope", async (t) => {
  const f = await fixture(t);
  await f.allowMember();
  await f.allowGuide();
  await f.allowMember();
  await f.operators.claimPlatformOperatorForViewer({ authUserId: auth, email });
  const claimed = await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email });
  assert.deepEqual(await f.grants(), ["guide", "member"]);
  assert.deepEqual((await f.db.query("select circle_id,role_slug from circle_staff_assignments where auth_user_id=$1", [auth])).rows, [{ circle_id: circle, role_slug: "guide" }]);
  const users = (await f.db.query("select person_id,member_id from platform_users where auth_user_id=$1", [auth])).rows;
  assert.deepEqual(users, [{ person_id: claimed.personId, member_id: claimed.memberId }]);
  assert.equal((await f.db.query("select count(*)::int as count from passwordless_account_invites where accepted_at is not null")).rows[0].count, 2);
  assert.equal((await f.db.query("select billing_state from member_lifecycle where member_id=$1", [claimed.memberId])).rows[0].billing_state, "pending");
});

test("non-admin attempts cannot create or revoke invitations or mutate their audit evidence", async (t) => {
  const f = await fixture(t);
  await f.allowMember();
  const before = (await f.db.query("select * from passwordless_account_invites")).rows;
  await assert.rejects(f.allowMember({ actorAuthUserId: auth }), (error) => error.code === "forbidden");
  await assert.rejects(f.members.revokeLiveMemberInvitations({ actorAuthUserId: auth, email }), (error) => error.code === "forbidden");
  assert.deepEqual((await f.db.query("select * from passwordless_account_invites")).rows, before);
});

test("exact pending joining renewal expires the old allowance, audits, and rejects stale renew/remove after replacement or acceptance", async (t) => {
  const f = await fixture(t);
  const initial = await f.allowMember();
  const renewed = await f.allowMember({ expectedInvitationId: initial.id });
  assert.notEqual(initial.id, renewed.id);
  const rows = (await f.db.query("select * from passwordless_account_invites order by id")).rows;
  assert.ok(rows[0].revoked_at); assert.equal(rows[1].revoked_at, null);
  assert.equal((rows[1].expires_at - rows[1].invited_at) / 86400000, 7);
  const audit = (await f.db.query("select * from operator_audit_events where action='member_invitation.reissued'")).rows[0];
  assert.deepEqual(audit.before_snapshot, { invitationId: initial.id });
  assert.equal(audit.after_snapshot.invitationId, renewed.id);
  await assert.rejects(f.allowMember({ expectedInvitationId: initial.id }), /has changed/);
  await assert.rejects(f.pending.revokePendingMemberInvitation({ actorAuthUserId: admin, invitationId: initial.id, email }), /has changed/);
  assert.deepEqual((await f.db.query("select * from passwordless_account_invites order by id")).rows, rows);
  await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email });
  const acceptedRows = (await f.db.query("select * from passwordless_account_invites order by id")).rows;
  await assert.rejects(f.allowMember({ expectedInvitationId: renewed.id }), /has changed/);
  await assert.rejects(f.pending.revokePendingMemberInvitation({ actorAuthUserId: admin, invitationId: renewed.id, email }), /has changed/);
  assert.deepEqual((await f.db.query("select * from passwordless_account_invites order by id")).rows, acceptedRows);
});

test("personal invitation preflight is read-only, email-bound and rejects legacy bearer links", async (t) => {
  const f = await fixture(t), invite = await f.personal();
  const before = (await f.db.query(`select (select count(*) from ruined_members) as members,
    (select count(*) from platform_users) as users,(select count(*) from passwordless_account_invites) as allowances,
    (select count(*) from platform_role_grants) as grants,(select count(*) from membership_waitlist) as sources`)).rows;
  assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility(` ${email.toUpperCase()} `, invite.token), true);
  assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility('wrong@example.test', invite.token), false);
  const legacy = crypto.randomBytes(32).toString('base64url');
  await f.db.query('insert into member_invitations(member_id,public_token,enabled) values($1,$2,true)', [invite.memberId, legacy]);
  assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility(email, legacy), false);
  await assert.rejects(f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, legacy), f.platform.PlatformAccessDeniedError);
  const after = (await f.db.query(`select (select count(*) from ruined_members) as members,
    (select count(*) from platform_users) as users,(select count(*) from passwordless_account_invites) as allowances,
    (select count(*) from platform_role_grants) as grants,(select count(*) from membership_waitlist) as sources`)).rows;
  assert.deepEqual(after, before);
});

test("verified personal acceptance creates pending membership atomically, preserves the deadline and credits only completed joining", async (t) => {
  const f = await fixture(t), invite = await f.personal();
  await f.db.query("update member_personal_invitations set delivery_status='queued',next_attempt_at=now() where id=$1", [invite.id]);
  const claimed = await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, invite.token);
  assert.deepEqual(await f.grants(), ['member']);
  const lifecycle = (await f.db.query('select account_state,billing_state,program_state,standing_state,administrative_onboarding_state from member_lifecycle where member_id=$1', [claimed.memberId])).rows[0];
  assert.deepEqual(lifecycle, { account_state: 'active', billing_state: 'pending', program_state: 'prospect', standing_state: 'pre_active', administrative_onboarding_state: 'in_progress' });
  const allowance = (await f.db.query("select * from passwordless_account_invites where provider_reference=$1", [`personal-invitation:${invite.id}`])).rows[0];
  assert.equal(allowance.member_id, claimed.memberId);
  assert.equal(allowance.invited_at.toISOString(), invite.issued_at.toISOString());
  assert.equal(allowance.expires_at.toISOString(), invite.expires_at.toISOString());
  assert.equal(allowance.intended_user_type, 'member');
  const accepted = (await f.db.query('select * from member_personal_invitations where id=$1', [invite.id])).rows[0];
  assert.ok(accepted.accepted_at); assert.equal(accepted.accepted_by_auth_user_id, auth); assert.equal(accepted.accepted_member_id, claimed.memberId);
  assert.equal(accepted.delivery_status, 'cancelled'); assert.equal(accepted.next_attempt_at, null);
  assert.equal((await f.db.query('select count(*)::int as count from integration_outbox')).rows[0].count, 0);
  const referral = (await f.db.query('select * from member_referrals where personal_invitation_id=$1', [invite.id])).rows[0];
  assert.equal(referral.referred_member_id, claimed.memberId); assert.equal(referral.joined_at, null);
  assert.deepEqual(await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, invite.token), claimed);
  assert.deepEqual((await f.db.query('select accepted_at,version from member_personal_invitations where id=$1', [invite.id])).rows[0], { accepted_at: accepted.accepted_at, version: accepted.version });
  await f.db.query("update member_onboardings set state='completed',profile_completed_at=now(),agreement_completed_at=now() where member_id=$1", [claimed.memberId]);
  await f.db.query("update member_lifecycle set billing_state='active',program_state='onboarding',standing_state='active',administrative_onboarding_state='completed',access_started_at=clock_timestamp() where member_id=$1", [claimed.memberId]);
  assert.ok((await f.db.query('select joined_at from member_referrals where personal_invitation_id=$1', [invite.id])).rows[0].joined_at);
});

test("expired, revoked, mismatched and ineligible-inviter personal claims create no access", async (t) => {
  for (const scenario of ['expired', 'revoked', 'wrong_email', 'inactive_inviter']) {
    await t.test(scenario, async (subtest) => {
      const f = await fixture(subtest), invite = await f.personal({ expiresIn: scenario === 'expired' ? '-1 second' : '48 hours' });
      if (scenario === 'revoked') await f.db.query('update member_personal_invitations set revoked_at=now() where id=$1', [invite.id]);
      if (scenario === 'inactive_inviter') await f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1", [invite.memberId]);
      const claimedEmail = scenario === 'wrong_email' ? 'wrong@example.test' : email;
      assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility(claimedEmail, invite.token), false);
      await assert.rejects(f.platform.claimPlatformMemberForViewer({ authUserId: auth, email: claimedEmail }, invite.token), f.platform.PlatformAccessDeniedError);
      assert.deepEqual(await f.grants(), []);
      assert.equal((await f.db.query('select count(*)::int as count from passwordless_account_invites')).rows[0].count, 0);
      assert.equal((await f.db.query('select count(*)::int as count from ruined_members where email_normalized=$1', [email])).rows[0].count, 0);
    });
  }
});

test("the final wall-clock deadline rolls back a claim that expires during verification work", async (t) => {
  const f = await fixture(t), invite = await f.personal();
  let reachedFinalization = false;
  f.beforeCommit(async () => { reachedFinalization = true; f.clock(invite.expires_at); });
  await assert.rejects(f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, invite.token), f.platform.PlatformAccessDeniedError);
  assert.equal(reachedFinalization, true, 'The expiry occurred after the identity and grant work');
  assert.deepEqual(await f.grants(), []);
  for (const table of ['passwordless_account_invites','membership_waitlist','member_referrals']) {
    assert.equal((await f.db.query(`select count(*)::int as count from ${table}`)).rows[0].count, 0, `${table} rolled back`);
  }
  assert.equal((await f.db.query('select accepted_at from member_personal_invitations where id=$1', [invite.id])).rows[0].accepted_at, null);
});

test("personal invitations cannot restore suspended, closed, deleted, merged or revoked member access", async (t) => {
  for (const scenario of ['suspended', 'closed', 'deleted', 'merged', 'revoked']) {
    await t.test(scenario, async (subtest) => {
      const f = await fixture(subtest);
      await f.allowMember();
      const prior = await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email });
      const invite = await f.personal();
      if (scenario === 'suspended' || scenario === 'closed') await f.db.query('update member_lifecycle set account_state=$2 where member_id=$1', [prior.memberId, scenario]);
      if (scenario === 'deleted') await f.db.query('update ruined_members set deleted_at=now() where id=$1', [prior.memberId]);
      if (scenario === 'merged') await f.db.query("update people set status='merged' where id=$1", [prior.personId]);
      if (scenario === 'revoked') await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='member'", [auth]);
      assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility(email, invite.token), false);
      await assert.rejects(f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, invite.token), f.platform.PlatformAccessDeniedError);
      assert.equal((await f.db.query('select accepted_at from member_personal_invitations where id=$1', [invite.id])).rows[0].accepted_at, null);
      assert.equal((await f.db.query('select count(*)::int as count from passwordless_account_invites')).rows[0].count, 1);
    });
  }
});

test("acceptance uses the exact personal allowance and preserves the first inviter when a second card is accepted", async (t) => {
  const f = await fixture(t), first = await f.personal(), second = await f.personal();
  await f.allowMember();
  await f.allowGuide();
  const staffBefore = (await f.db.query("select * from passwordless_account_invites where intended_user_type='staff'")).rows;
  const member = await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, first.token);
  assert.deepEqual(await f.grants(), ['member']);
  assert.deepEqual((await f.db.query("select * from passwordless_account_invites where intended_user_type='staff'")).rows, staffBefore);
  const chosen = (await f.db.query("select provider_reference from passwordless_account_invites where accepted_at is not null and intended_user_type='member'")).rows;
  assert.deepEqual(chosen, [{ provider_reference: `personal-invitation:${first.id}` }]);
  await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, second.token);
  const references = (await f.db.query('select personal_invitation_id,referred_member_id from member_referrals')).rows;
  assert.deepEqual(references, [{ personal_invitation_id: first.id, referred_member_id: member.memberId }]);
  await assert.rejects(f.db.query('update member_personal_invitations set accepted_at=null,accepted_by_auth_user_id=null,accepted_member_id=null where id=$1', [first.id]), /immutable/);
  await assert.rejects(f.platform.claimPlatformMemberForViewer({ authUserId: crypto.randomUUID(), email }, first.token), f.platform.PlatformAccessDeniedError);
});

test("accepted accounts sign in normally after invitation expiry without renewing the original card", async (t) => {
  const f = await fixture(t), invite = await f.personal();
  const member = await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, invite.token);
  f.clock(invite.expires_at);
  assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility(email, invite.token), false);
  assert.deepEqual(await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }), member);
  assert.equal((await f.db.query('select expires_at from member_personal_invitations where id=$1', [invite.id])).rows[0].expires_at.toISOString(), invite.expires_at.toISOString());
});

test("accepted invitation audit does not block account erasure and inviter erasure keeps historical referral credit", async (t) => {
  const f = await fixture(t), invite = await f.personal();
  const member = await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, invite.token);
  await f.db.query('update ruined_members set deleted_at=clock_timestamp() where id=$1', [member.memberId]);
  await f.db.query("update platform_users set status='disabled',member_id=null,email_normalized=$2 where auth_user_id=$1", [auth,`deleted+${auth}@members.invalid`]);
  await f.db.query('delete from person_email_addresses where person_id=$1', [member.personId]);
  assert.equal((await f.db.query('select accepted_member_id from member_personal_invitations where id=$1', [invite.id])).rows[0].accepted_member_id, member.memberId);
  await f.db.query('update ruined_members set deleted_at=clock_timestamp() where id=$1', [invite.memberId]);
  assert.equal((await f.db.query('select count(*)::int as count from member_personal_invitations where id=$1', [invite.id])).rows[0].count, 0);
  const referral = (await f.db.query('select inviter_member_id,referred_member_id,personal_invitation_id from member_referrals')).rows[0];
  assert.deepEqual(referral, { inviter_member_id: invite.memberId, referred_member_id: member.memberId, personal_invitation_id: null });
});

test("verified complimentary acceptance records one independent grant without staff roles or paid billing", async (t) => {
  const f = await fixture(t), invite = await f.personal({ complimentary: true });
  assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility(email, invite.token), true);
  assert.equal((await f.db.query('select count(*)::int as count from member_complimentary_grants')).rows[0].count, 0, "Preflight never grants funding");
  const member = await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, invite.token);
  assert.deepEqual(await f.grants(), ["member"]);
  const [funding] = (await f.db.query('select * from member_complimentary_grants')).rows;
  assert.equal(funding.member_id, member.memberId);
  assert.equal(funding.source_invitation_id, invite.id);
  assert.equal(funding.granted_by_auth_user_id, invite.inviterAuth);
  assert.equal(funding.reason, "Founding member");
  assert.equal(funding.ends_at, null);
  assert.equal(funding.revoked_at, null);
  const lifecycle = (await f.db.query('select billing_state,administrative_onboarding_state from member_lifecycle where member_id=$1', [member.memberId])).rows[0];
  assert.deepEqual(lifecycle, { billing_state: "pending", administrative_onboarding_state: "in_progress" });
  assert.equal((await f.db.query('select membership_state from ruined_members where id=$1', [member.memberId])).rows[0].membership_state, "pending");
  assert.equal((await f.db.query('select private.ruined_member_has_complimentary_funding($1) as funded', [member.memberId])).rows[0].funded, true);
  assert.deepEqual(await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, invite.token), member);
  assert.deepEqual((await f.db.query('select * from member_complimentary_grants')).rows, [funding], "Replay preserves the exact original grant");
  assert.equal((await f.db.query('select count(*)::int as count from member_referrals')).rows[0].count, 1);
  assert.equal((await f.db.query('select joined_at from member_referrals')).rows[0].joined_at, null, "Acceptance does not pretend joining is complete");
  await f.db.query('update member_complimentary_grants set revoked_at=clock_timestamp(),revoked_by_auth_user_id=$1 where id=$2', [invite.inviterAuth, funding.id]);
  assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility(email, invite.token), false);
  await assert.rejects(f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, invite.token), f.platform.PlatformAccessDeniedError);
  assert.equal((await f.db.query('select private.ruined_member_has_complimentary_funding($1) as funded', [member.memberId])).rows[0].funded, false);
  assert.equal((await f.db.query('select count(*)::int as count from member_complimentary_grants')).rows[0].count, 1);
  await assert.rejects(f.db.query('update member_complimentary_grants set revoked_at=null,revoked_by_auth_user_id=null where id=$1', [funding.id]), /immutable/);
});

test("expired complimentary funding cannot be renewed by replaying its accepted invitation", async (t) => {
  const f = await fixture(t), invite = await f.personal({ complimentary: true, complimentaryEndsIn: "1 hour" });
  const member = await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, invite.token);
  const before = (await f.db.query('select * from member_complimentary_grants')).rows;
  // Move only the clock in the isolated shipped SQL predicates. This avoids
  // sleeping in CI or weakening the immutable grant to simulate elapsed time.
  const migration = await source("db/migrations/20260925000000_complimentary_member_invitations.sql");
  for (const name of ["private.ruined_member_has_complimentary_funding", "private.ruined_personal_invitation_benefit_available"]) {
    const match = migration.match(new RegExp(`create (?:or replace )?function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\$\\$;`))?.[0];
    assert.ok(match, `Missing shipped clock predicate ${name}`);
    await f.db.exec(match.replace(/^create (?:or replace )?function/, "create or replace function").replaceAll("clock_timestamp()", "(clock_timestamp()+interval '2 hours')"));
  }
  assert.equal((await f.db.query('select private.ruined_member_has_complimentary_funding($1) as funded', [member.memberId])).rows[0].funded, false);
  assert.equal(await f.admission.getPersonalInvitationAdmissionEligibility(email, invite.token), false);
  await assert.rejects(f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }, invite.token), f.platform.PlatformAccessDeniedError);
  assert.deepEqual((await f.db.query('select * from member_complimentary_grants')).rows, before);
  assert.deepEqual(await f.grants(), ["member"]);
  assert.deepEqual(await f.platform.claimPlatformMemberForViewer({ authUserId: auth, email }), member, "The original account can sign in without restoring its expired funding");
  assert.equal((await f.db.query('select billing_state from member_lifecycle where member_id=$1', [member.memberId])).rows[0].billing_state, "pending");
});
