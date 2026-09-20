import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";
import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { installOperatorFundingFunctions } from "./helpers/operator-funding-fixture.mjs";

const ids = {
  admin: "11111111-1111-4111-8111-111111111111",
  account: "22222222-2222-4222-8222-222222222222",
  other: "33333333-3333-4333-8333-333333333333",
  member: "44444444-4444-4444-8444-444444444444",
  person: "55555555-5555-4555-8555-555555555555",
  a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

async function load(path, dependencies) {
  const compiled = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  // postgres is used only for its parameter serializers; this driver never connects.
  const driver = postgres({ host: "127.0.0.1", port: 1, max: 1 });
  t.after(async () => { await db.close(); await driver.end(); });
  await db.exec(`
    create schema private;
    create role anon; create role authenticated;
    create table people (id uuid primary key, status text not null default 'active');
    create table ruined_members (id uuid primary key, person_id uuid references people, email text, membership_state text default 'active');
    create table platform_users (auth_user_id uuid primary key, email_normalized text unique, status text, person_id uuid, member_id uuid unique);
    create table platform_role_grants (id bigint generated always as identity primary key, auth_user_id uuid references platform_users, role_slug text, revoked_at timestamptz, revoke_reason text, granted_by_auth_user_id uuid, granted_at timestamptz default now());
    create unique index active_grant on platform_role_grants(auth_user_id,role_slug) where revoked_at is null;
    create table member_lifecycle (member_id uuid primary key references ruined_members, account_state text default 'active', administrative_onboarding_state text default 'completed', billing_state text default 'active', program_state text default 'active', standing_state text default 'active', cancellation_effective_at timestamptz);
    create table person_profiles (person_id uuid primary key, preferred_name text, display_name text);
    create table user_profiles (auth_user_id uuid primary key, display_name text);
    create table circles (id uuid primary key, name text, status text, capacity integer default 10, slug text, created_at timestamptz default now());
    create table circle_member_assignments (id bigint generated always as identity primary key, member_id uuid references ruined_members, circle_id uuid references circles, assigned_at timestamptz default now(), ended_at timestamptz);
    create unique index current_member_circle on circle_member_assignments(member_id) where ended_at is null;
    create table circle_staff_assignments (id bigint generated always as identity primary key, circle_id uuid references circles, auth_user_id uuid references platform_users, role_slug text, assigned_by_auth_user_id uuid, assigned_at timestamptz default now(), ended_at timestamptz, ended_by_auth_user_id uuid, end_reason text);
    create unique index active_scope on circle_staff_assignments(circle_id,auth_user_id,role_slug) where ended_at is null;
    create unique index single_shaper on circle_staff_assignments(circle_id) where ended_at is null and role_slug='circle_leader';
    create table passwordless_account_invites (id bigint generated always as identity primary key, member_id uuid, email_normalized text, intended_user_type text, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz);
    create table operator_invitation_configs (invitation_id bigint primary key, role_slug text, display_name text);
    create table operator_invitation_circles (invitation_id bigint, circle_id uuid);
    create table operator_audit_events (actor_auth_user_id uuid, action text, subject_type text, subject_id text, reason text, before_snapshot jsonb, after_snapshot jsonb, metadata jsonb, dedupe_key text);
    create table learning_resources (id uuid primary key, title text, status text, position integer, current_version_id uuid);
    create table learning_resource_versions (id uuid primary key, version integer, published_at timestamptz);
    create table circle_resources (id bigint, circle_id uuid, learning_resource_id uuid, learning_resource_version_id uuid, is_pinned boolean, created_at timestamptz, ended_at timestamptz, position integer);
    create table membership_blocks (id uuid primary key, name text, status text);
    create table block_circle_assignments (circle_id uuid, block_id uuid, ended_at timestamptz);
  `);
  await installOperatorFundingFunctions(db);
  await db.exec(await readFile(new URL("../db/migrations/20260915174319_circle_shaper_admin_eligibility.sql", import.meta.url), "utf8"));
  await db.exec(`create trigger validate_staff before insert or update of circle_id,auth_user_id,role_slug,ended_at on circle_staff_assignments for each row execute function private.ruined_validate_circle_staff_assignment()`);
  await db.query("insert into people(id) values ($1)", [ids.person]);
  await db.query("insert into ruined_members(id,person_id,email) values ($1,$2,'member@example.com')", [ids.member, ids.person]);
  await db.query("insert into member_lifecycle(member_id) values ($1)", [ids.member]);
  await db.query("insert into platform_users values ($1,'admin@example.com','active',null,null),($2,'member@example.com','active',$3,$4),($5,'other@example.com','active',null,null)", [ids.admin, ids.account, ids.person, ids.member, ids.other]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values ($1,'ops_admin'),($2,'member'),($3,'circle_leader')", [ids.admin, ids.account, ids.other]);
  await db.query("insert into person_profiles values ($1,'Member Name','Full Member Name')", [ids.person]);
  await db.query("insert into circles(id,name,status,slug) values ($1,'Circle A','active','circle-a'),($2,'Circle B','forming','circle-b')", [ids.a, ids.b]);
  await db.query("insert into circle_member_assignments(member_id,circle_id) values ($1,$2)", [ids.member, ids.a]);
  const queries = []; const fail = { audit: false };
  function wrap(engine) {
    const sql = async (strings, ...values) => {
      let query = strings[0];
      const params = values.map((value, index) => {
        query += `$${index + 1}${strings[index + 1]}`;
        return value instanceof Parameter ? driver.options.serializers[3802](value.value) : value instanceof Date ? types.date.serialize(value) : value;
      });
      queries.push(query.replace(/\s+/g, " ").trim());
      if (fail.audit && /insert into operator_audit_events/.test(query)
        && (fail.audit === true || params.includes(fail.audit))) throw new Error("Audit unavailable");
      return (await engine.query(query, params)).rows;
    };
    sql.json = driver.json;
    sql.begin = (options, callback) => engine.transaction((tx) => (callback ?? options)(wrap(tx)));
    return sql;
  }
  const repository = await load("src/lib/platform/ops-repository.ts", {
    "server-only": {}, "node:crypto": crypto, "@/lib/identity/repository": {},
    "@/lib/platform/calendar-audience-invalidation": {},
    "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) },
    "@/lib/stripe/membership-state": { normalizeEmail: (value) => value.trim().toLowerCase(), isPlausibleEmail: (value) => value.includes("@") },
  });
  const assign = (changes = {}) => repository.assignShaperToCircle({ actorAuthUserId: ids.admin, circleId: ids.a, memberId: ids.member, grantShaperAccess: true, ...changes });
  const options = (circleId = ids.a) => repository.getOpsCircleManagementOptions(ids.admin, circleId);
  const snapshot = async () => Object.fromEntries(await Promise.all(["platform_users", "platform_role_grants", "circle_staff_assignments", "operator_audit_events", "ruined_members", "member_lifecycle", "circle_member_assignments"].map(async (table) => [table, (await db.query(`select to_jsonb(row)::text as value from ${table} row order by to_jsonb(row)::text`)).rows])));
  const invite = async ({ email = "pending@example.com", circleId = ids.a, role = "circle_leader", expired = false } = {}) => {
    const id = (await db.query("insert into passwordless_account_invites(email_normalized,intended_user_type,expires_at) values ($1,'staff',now()+$2::interval) returning id", [email, expired ? "-1 day" : "7 days"])).rows[0].id;
    await db.query("insert into operator_invitation_configs values ($1,$2,'Pending operator')", [id, role]);
    await db.query("insert into operator_invitation_circles values ($1,$2)", [id, circleId]);
    return id;
  };
  return { db, repository, assign, options, queries, fail, snapshot, invite };
}

test("selected Circle candidates come from its complete current roster, not directory search pages", async (t) => {
  const f = await fixture(t);
  const initial = await f.options();
  assert.deepEqual(initial.circleMembers, [{ memberId: ids.member, circleId: ids.a, name: "Member Name", email: "member@example.com", authUserId: ids.account, requiresShaperAccess: true, unavailableReason: null }]);
  assert.deepEqual(initial.shapers, [{ authUserId: ids.other, name: "other@example.com" }]);
  assert.deepEqual((await f.options(ids.b)).circleMembers, []);
  assert.deepEqual((await f.options("not-a-uuid")).circleMembers, []);
  assert.equal(Object.hasOwn(await f.repository.getOpsCircleManagementOptions(ids.admin), "circleMembers"), false);
  // Deliberately exceed directory page sizes without changing normal Circle capacity.
  await f.db.exec(`insert into ruined_members(id,email) select md5(n::text)::uuid,'person'||n||'@example.com' from generate_series(1,55) n;
    insert into circle_member_assignments(member_id,circle_id) select id,'${ids.a}'::uuid from ruined_members where person_id is null`);
  assert.equal((await f.options()).circleMembers.length, 56);
  await assert.rejects(f.repository.getOpsCircleManagementOptions(ids.other, ids.a), /administrator access/);
  await f.db.query("update circle_member_assignments set ended_at=now() where member_id=$1", [ids.member]);
  assert.equal((await f.options()).circleMembers.some((member) => member.memberId === ids.member), false);
});

test("confirmed ordinary member assignment atomically grants only Shaper access, preserves membership, and is idempotent", async (t) => {
  const f = await fixture(t); const before = await f.snapshot();
  await assert.rejects(f.assign({ grantShaperAccess: false }), /Confirm granting Shaper access/);
  assert.deepEqual(await f.snapshot(), before);
  const result = await f.assign({ circleId: ids.a.toUpperCase() });
  assert.equal(result.authUserId, ids.account); assert.equal(result.memberId, ids.member);
  assert.equal(result.created, true); assert.equal(result.shaperAccessGranted, true);
  assert.equal(result.name, "Member Name");
  assert.deepEqual((await f.db.query("select role_slug from platform_role_grants where auth_user_id=$1 order by role_slug", [ids.account])).rows, [{ role_slug: "circle_leader" }, { role_slug: "member" }]);
  const after = await f.snapshot();
  for (const table of ["platform_users", "ruined_members", "member_lifecycle", "circle_member_assignments"]) assert.deepEqual(after[table], before[table]);
  assert.equal((await f.options()).circleMembers[0].requiresShaperAccess, false);
  const retry = await f.assign({ grantShaperAccess: false });
  assert.equal(retry.created, false); assert.equal(retry.shaperAccessGranted, false);
  assert.deepEqual(await f.snapshot(), after);
  const audits = (await f.db.query("select action,after_snapshot from operator_audit_events order by action")).rows;
  assert.deepEqual(audits.map((row) => row.action), ["circle.shaper_assigned", "operator_access.shaper_granted"]);
  assert.deepEqual(audits[1].after_snapshot.circleIds, [ids.a]);
  assert.equal(audits[1].after_snapshot.role, "circle_leader");
});

test("active Administrator member becomes the visible Shaper without any role changes or self-payment fiction", async (t) => {
  const f = await fixture(t);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values ($1,'ops_admin')", [ids.account]);
  await f.db.query("update ruined_members set membership_state='pending' where id=$1", [ids.member]);
  await f.db.query("update member_lifecycle set billing_state='pending' where member_id=$1", [ids.member]);
  assert.equal((await f.options()).circleMembers[0].requiresShaperAccess, false);
  const before = await f.snapshot(); const result = await f.assign({ grantShaperAccess: false });
  assert.equal(result.shaperAccessGranted, false);
  const after = await f.snapshot();
  for (const table of ["platform_role_grants", "platform_users", "ruined_members", "member_lifecycle"]) assert.deepEqual(after[table], before[table]);
  const circles = await f.repository.getOpsCircleSummaries(ids.admin);
  assert.equal(circles.find((circle) => circle.id === ids.a).shaper.authUserId, ids.account);
  assert.equal(circles.find((circle) => circle.id === ids.a).shaper.name, "Member Name");
});

test("existing Shaper member and legacy existing-operator path preserve grants and retry safely", async (t) => {
  const f = await fixture(t);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values ($1,'circle_leader')", [ids.account]);
  const before = await f.snapshot(); const result = await f.assign({ grantShaperAccess: undefined });
  assert.equal(result.shaperAccessGranted, false);
  assert.deepEqual((await f.snapshot()).platform_role_grants, before.platform_role_grants);
  const legacy = { actorAuthUserId: ids.admin, circleId: ids.b.toUpperCase(), shaperAuthUserId: ids.other };
  assert.equal((await f.repository.assignShaperToCircle(legacy)).created, true);
  assert.equal((await f.repository.assignShaperToCircle(legacy)).created, false);
});

test("Guide, revoked operator access, disabled accounts, and missing sign-in are explained and never repaired silently", async (t) => {
  const f = await fixture(t);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values ($1,'guide')", [ids.account]);
  let before = await f.snapshot();
  assert.match((await f.options()).circleMembers[0].unavailableReason, /Guide/);
  await assert.rejects(f.assign(), /Guide/); assert.deepEqual(await f.snapshot(), before);
  await f.db.query("update platform_role_grants set revoked_at=now() where role_slug='guide'");
  before = await f.snapshot();
  assert.match((await f.options()).circleMembers[0].unavailableReason, /previous operator access/);
  await assert.rejects(f.assign(), /previous operator access/); assert.deepEqual(await f.snapshot(), before);
  for (const status of ["suspended", "disabled", "invited"]) {
    await f.db.query("update platform_users set status=$1 where auth_user_id=$2", [status, ids.account]);
    before = await f.snapshot();
    assert.match((await f.options()).circleMembers[0].unavailableReason, /account access/);
    await assert.rejects(f.assign(), /account access/); assert.deepEqual(await f.snapshot(), before);
  }
  await f.db.query("update platform_users set member_id=null where auth_user_id=$1", [ids.account]);
  assert.equal((await f.options()).circleMembers[0].authUserId, null);
  await assert.rejects(f.assign(), /sign in/);
});

test("stale placement, missing onboarding, payment, standing and canonical identity all block before grants", async (t) => {
  const f = await fixture(t);
  for (const [column, value, error] of [
    ["administrative_onboarding_state", "in_progress", /finish their membership entry/],
    ["billing_state", "pending", /active membership/],
    ["standing_state", "suspended", /standing/],
    ["program_state", "completed", /standing/],
    ["account_state", "suspended", /account access/],
  ]) {
    await f.db.query(`update member_lifecycle set ${column}=$1 where member_id=$2`, [value, ids.member]);
    const before = await f.snapshot();
    await assert.rejects(f.assign(), error); assert.deepEqual(await f.snapshot(), before);
    await f.db.query(`update member_lifecycle set ${column}=$1 where member_id=$2`, [column === "administrative_onboarding_state" ? "completed" : "active", ids.member]);
  }
  await f.db.query("update circle_member_assignments set circle_id=$1 where member_id=$2", [ids.b, ids.member]);
  let before = await f.snapshot(); await assert.rejects(f.assign(), /no longer in this Circle/); assert.deepEqual(await f.snapshot(), before);
  await f.db.query("update circle_member_assignments set circle_id=$1 where member_id=$2", [ids.a, ids.member]);
  await f.db.query("update platform_users set person_id=null where auth_user_id=$1", [ids.account]);
  before = await f.snapshot(); await assert.rejects(f.assign(), /sign in/); assert.deepEqual(await f.snapshot(), before);
});

test("competing Shaper and pending Circle invitation leave no partial access grant", async (t) => {
  const f = await fixture(t);
  await f.db.query("insert into circle_staff_assignments(circle_id,auth_user_id,role_slug) values ($1,$2,'circle_leader')", [ids.a, ids.other]);
  let before = await f.snapshot(); await assert.rejects(f.assign(), /already has a Shaper/); assert.deepEqual(await f.snapshot(), before);
  await f.db.exec("update circle_staff_assignments set ended_at=now()");
  const invitationId = await f.invite();
  before = await f.snapshot(); await assert.rejects(f.assign(), /pending Shaper invitation/); assert.deepEqual(await f.snapshot(), before);
  await assert.rejects(f.repository.assignShaperToCircle({ actorAuthUserId: ids.admin, circleId: ids.a, shaperAuthUserId: ids.other }), /pending Shaper invitation/);
  await f.db.query("update passwordless_account_invites set revoked_at=now() where id=$1", [invitationId]);
  await f.invite({ expired: true });
  assert.equal((await f.assign()).created, true);
});

test("a member's pending operator invitation must be resolved before assigning a different role", async (t) => {
  const f = await fixture(t);
  await f.invite({ email: "member@example.com", circleId: ids.b, role: "guide" });
  const before = await f.snapshot();
  assert.match((await f.options()).circleMembers[0].unavailableReason, /pending operator invitation/);
  await assert.rejects(f.assign(), /pending operator invitation/);
  assert.deepEqual(await f.snapshot(), before);
});

test("audit failure rolls back grants and placement; authorization and mixed identity requests cannot write", async (t) => {
  const f = await fixture(t); const before = await f.snapshot();
  for (const changes of [{ actorAuthUserId: ids.other }, { actorAuthUserId: ids.account }, { shaperAuthUserId: ids.other }, { memberId: "bad" }, { grantShaperAccess: "true" }]) {
    await assert.rejects(f.assign(changes)); assert.deepEqual(await f.snapshot(), before);
  }
  f.fail.audit = true;
  await assert.rejects(f.assign(), /Audit unavailable/); assert.deepEqual(await f.snapshot(), before);
  f.fail.audit = "circle.shaper_assigned";
  await assert.rejects(f.assign(), /Audit unavailable/); assert.deepEqual(await f.snapshot(), before);
});

test("future placements, closed Circles, revoked member access and inactive people are not eligible", async (t) => {
  const f = await fixture(t);
  await f.db.exec("update circle_member_assignments set assigned_at=now()+interval '1 day'");
  assert.deepEqual((await f.options()).circleMembers, []);
  await assert.rejects(f.assign(), /no longer in this Circle/);
  await f.db.exec("update circle_member_assignments set assigned_at=now()");
  for (const status of ["archived", "completed"]) {
    await f.db.query("update circles set status=$1 where id=$2", [status, ids.a]);
    const before = await f.snapshot();
    await assert.rejects(f.assign(), /forming or active Circle/); assert.deepEqual(await f.snapshot(), before);
  }
  await f.db.query("update circles set status='active' where id=$1", [ids.a]);
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='member'", [ids.account]);
  let before = await f.snapshot(); await assert.rejects(f.assign(), /account access/); assert.deepEqual(await f.snapshot(), before);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values ($1,'member')", [ids.account]);
  await f.db.query("update people set status='erased' where id=$1", [ids.person]);
  before = await f.snapshot(); await assert.rejects(f.assign(), /account access/); assert.deepEqual(await f.snapshot(), before);
});

test("cancellation retains access only until its effective date; granting access never bypasses unpaid membership", async (t) => {
  const f = await fixture(t);
  await f.db.exec("update member_lifecycle set standing_state='cancellation_requested', cancellation_effective_at=now()-interval '1 day'");
  await assert.rejects(f.assign(), /standing/);
  await f.db.exec("update member_lifecycle set cancellation_effective_at=now()+interval '1 day', billing_state='pending'");
  await assert.rejects(f.assign(), /active membership/);
  assert.equal((await f.db.query("select count(*)::integer as count from platform_role_grants where auth_user_id=$1 and role_slug='circle_leader'", [ids.account])).rows[0].count, 0);
  await f.db.exec("update member_lifecycle set billing_state='active'");
  assert.equal((await f.assign()).created, true);
});

test("write lock order matches member transfers and operator role edits before Circle scope", async (t) => {
  const f = await fixture(t); await f.assign();
  const find = (part) => f.queries.findIndex((query) => query.includes(part));
  const memberLock = f.queries.findIndex((query) => query.includes("pg_advisory_xact_lock(hashtext($1), 2)"));
  assert.ok(find("ruined-operator-admins") < memberLock);
  assert.ok(memberLock < find("ruined_lock_member_complimentary_funding"));
  assert.ok(find("ruined_lock_member_complimentary_funding") < find("select grant_row.id"));
  assert.ok(find("select grant_row.id") < find("for update of member, person, lifecycle"));
  assert.ok(find("for update of member, person, lifecycle") < find("select id from circle_member_assignments"));
  assert.ok(find("select id from circle_member_assignments") < find("select id, name, status from circles"));
});

test("route authenticates the actor and rejects malformed confirmation without invoking the repository", async () => {
  const calls = []; const auth = { trusted: true, viewer: { authUserId: ids.admin } };
  const route = await load("app/api/ops/circle-shaper-assignments/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => ({ body, ...options }) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => auth.trusted },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => auth.viewer },
    "@/lib/platform/ops-repository": { assignShaperToCircle: async (input) => { calls.push(input); return { created: true }; }, endCircleShaperAssignment: async () => ({}), OpsRepositoryError: class extends Error {} },
  });
  const request = (body, contentType = "application/json") => new Request("https://members.example.com/api/ops/circle-shaper-assignments", { method: "POST", headers: { "Content-Type": contentType }, body: JSON.stringify(body) });
  const body = { circleId: ids.a, memberId: ids.member, grantShaperAccess: true, actorAuthUserId: ids.other };
  assert.equal((await route.POST(request(body))).status, 201);
  assert.deepEqual(calls[0], { actorAuthUserId: ids.admin, circleId: ids.a, memberId: ids.member, grantShaperAccess: true, shaperAuthUserId: undefined });
  assert.equal((await route.POST(request({ ...body, grantShaperAccess: "true" }))).status, 400);
  auth.trusted = false; assert.equal((await route.POST(request(body))).status, 403);
  auth.trusted = true; auth.viewer = null; assert.equal((await route.POST(request(body))).status, 401);
  auth.viewer = { authUserId: ids.admin }; assert.equal((await route.POST(request(body, "text/plain"))).status, 415);
  assert.equal(calls.length, 1);
});
