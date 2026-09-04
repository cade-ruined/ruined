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
    create table people (id uuid primary key);
    create table person_email_addresses (
      person_id uuid references people(id), email text, email_normalized text unique,
      verification_state text, verified_at timestamptz, source text, is_primary boolean,
      retired_at timestamptz, updated_at timestamptz default now()
    );
    create table ruined_members (
      id uuid primary key, person_id uuid references people(id), email text,
      email_normalized text unique, membership_state text default 'pending', updated_at timestamptz default now()
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
      standing_state text, version integer default 1, updated_at timestamptz default now()
    );
    create table member_onboardings (
      member_id uuid primary key references ruined_members(id), state text, form_version text,
      requirements_snapshot jsonb, invited_at timestamptz, started_at timestamptz, updated_at timestamptz default now()
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
  `);
  await db.query("insert into platform_users (auth_user_id,email_normalized,status,user_type) values ($1,'admin@example.test','active','staff')", [admin]);
  await db.query("insert into platform_role_grants (auth_user_id,role_slug) values ($1,'ops_admin')", [admin]);
  await db.query("insert into circles values ($1,'Circle Test','active')", [circle]);

  const wrap = (engine) => {
    const sql = async (strings, ...values) => {
      let query = strings[0];
      const parameters = values.map((value, index) => {
        query += `$${index + 1}${strings[index + 1]}`;
        if (value instanceof Parameter) return driver.options.serializers[value.type](value.value);
        return value instanceof Date ? types.date.serialize(value) : value;
      });
      return (await engine.query(query, parameters)).rows;
    };
    sql.json = driver.json;
    sql.begin = (callback) => engine.transaction((tx) => callback(wrap(tx)));
    return sql;
  };
  const basic = { "server-only": {}, "node:crypto": crypto };
  const identity = await load("src/lib/identity/repository.ts", basic);
  const deps = {
    ...basic,
    "@/lib/identity/repository": identity,
    "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) },
    "@/lib/stripe/membership-state": await load("src/lib/stripe/membership-state.ts"),
    "@/lib/platform/model": await load("src/lib/platform/model.ts"),
    // Calendar invalidation is unrelated to invitation access and cannot send
    // external messages; all identity, invitation and role SQL executes.
    "@/lib/platform/calendar-audience-invalidation": { markCalendarAudiencesPendingForMember: async () => {} },
  };
  const platform = await load("src/lib/platform/repository.ts", deps);
  const members = await load("src/lib/platform/ops-repository.ts", deps);
  const operators = await load("src/lib/platform/ops-access-repository.ts", { ...deps, "@/lib/platform/repository": platform });
  const allowMember = (overrides = {}) => members.createOrReissueMemberInvitation({ actorAuthUserId: admin, email, ...overrides });
  const allowGuide = () => operators.createOrReissueOperatorInvitation({ actorAuthUserId: admin, email, displayName: "Test Guide", role: "guide", circleIds: [circle] });
  const grants = async () => (await db.query("select role_slug from platform_role_grants where auth_user_id=$1 and revoked_at is null order by role_slug", [auth])).rows.map((row) => row.role_slug);
  return { db, members, operators, platform, allowMember, allowGuide, grants };
}

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
