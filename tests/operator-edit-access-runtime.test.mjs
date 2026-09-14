import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";
import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const ids = { admin: "11111111-1111-4111-8111-111111111111", operator: "22222222-2222-4222-8222-222222222222", other: "33333333-3333-4333-8333-333333333333", a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
async function load(path, dependencies) {
  const compiled = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks(); const db = new PGlite();
  const driver = postgres({ host: "127.0.0.1", port: 1, max: 1 });
  t.after(async () => { await db.close(); await driver.end(); });
  await db.exec(`
    create table platform_users (auth_user_id uuid primary key, email_normalized text unique, status text, person_id uuid, member_id uuid, last_signed_in_at timestamptz, updated_at timestamptz default now());
    create table platform_role_grants (id bigint generated always as identity primary key, auth_user_id uuid, role_slug text, revoked_at timestamptz, revoke_reason text, granted_by_auth_user_id uuid, granted_at timestamptz default now());
    create unique index active_grant on platform_role_grants(auth_user_id,role_slug) where revoked_at is null;
    create table circles (id uuid primary key, name text, status text);
    create table circle_staff_assignments (id bigint generated always as identity primary key, circle_id uuid, auth_user_id uuid, role_slug text, assigned_by_auth_user_id uuid, assigned_at timestamptz default now(), ended_at timestamptz, ended_by_auth_user_id uuid, end_reason text);
    create unique index active_scope on circle_staff_assignments(circle_id,auth_user_id,role_slug) where ended_at is null;
    create unique index single_shaper on circle_staff_assignments(circle_id) where ended_at is null and role_slug='circle_leader';
    create table passwordless_account_invites (id bigint generated always as identity primary key, member_id uuid, email_normalized text, intended_user_type text, invited_at timestamptz default now(), expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz, revoked_by_auth_user_id uuid);
    create table operator_invitation_configs (invitation_id bigint primary key, role_slug text, display_name text);
    create table operator_invitation_circles (invitation_id bigint, circle_id uuid);
    create table operator_audit_events (actor_auth_user_id uuid, action text, subject_type text, subject_id text, reason text, before_snapshot jsonb, after_snapshot jsonb, metadata jsonb, dedupe_key text);
    create table ruined_members (id uuid primary key, person_id uuid);
    create table person_profiles (person_id uuid primary key, preferred_name text, display_name text);
    create table user_profiles (auth_user_id uuid primary key, display_name text);
    create table test_calendar (member_id uuid);
  `);
  await db.query("insert into platform_users (auth_user_id,email_normalized,status) values ($1,'admin@example.com','active'),($2,'operator@example.com','active'),($3,'other@example.com','active')", [ids.admin, ids.operator, ids.other]);
  await db.query("insert into platform_role_grants (auth_user_id,role_slug) values ($1,'ops_admin'),($2,'guide')", [ids.admin, ids.operator]);
  await db.query("insert into circles values ($1,'Circle A','active'),($2,'Circle B','forming')", [ids.a, ids.b]);
  await db.query("insert into circle_staff_assignments (circle_id,auth_user_id,role_slug) values ($1,$2,'guide')", [ids.a, ids.operator]);
  const queries = []; const fail = { audit: false };
  function wrap(engine) {
    const sql = async (strings, ...values) => {
      let query = strings[0];
      const params = values.map((value, index) => { query += `$${index + 1}${strings[index + 1]}`; return value instanceof Parameter ? driver.options.serializers[3802](value.value) : value instanceof Date ? types.date.serialize(value) : value; });
      queries.push(query.replace(/\s+/g, " ").trim());
      if (fail.audit && /insert into operator_audit_events/.test(query)) throw new Error("Audit unavailable");
      return (await engine.query(query, params)).rows;
    };
    sql.json = driver.json;
    sql.begin = (options, callback) => engine.transaction((tx) => (callback ?? options)(wrap(tx)));
    return sql;
  }
  const dependencies = { "server-only": {}, "node:crypto": crypto, "@/lib/identity/repository": {}, "@/lib/platform/repository": {},
    "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) }, "@/lib/stripe/membership-state": { normalizeEmail: (value) => value.trim().toLowerCase(), isPlausibleEmail: (value) => value.includes("@") },
    "@/lib/platform/calendar-audience-invalidation": { markCalendarAudiencesPendingForMember: (tx, input) => tx`insert into test_calendar values (${input.memberId}::uuid)` } };
  const access = await load("src/lib/platform/ops-access-repository.ts", dependencies);
  const operating = await load("src/lib/platform/ops-repository.ts", dependencies);
  const invitations = await load("src/lib/platform/ops-member-invitation-repository.ts", { ...dependencies, "@/lib/platform/ops-repository": operating });
  const edit = (changes = {}) => access.updateOperatorAccess({ actorAuthUserId: ids.admin, targetAuthUserId: ids.operator, role: "guide", circleIds: [ids.b], expectedRole: "guide", expectedCircleIds: [ids.a], expectedStatus: "active", administratorConfirmed: false, restoreAccount: false, reason: "New Circle responsibility", ...changes });
  const snapshot = async () => Object.fromEntries(await Promise.all(["platform_users", "platform_role_grants", "circle_staff_assignments", "operator_audit_events", "passwordless_account_invites"].map(async (table) => [table, (await db.query(`select to_jsonb(row)::text as value from ${table} row order by to_jsonb(row)::text`)).rows])));
  return { db, access, operating, invitations, edit, queries, fail, snapshot };
}

test("editing Circle scope preserves assignment history, audits, and survives directory reload", async (t) => {
  const f = await fixture(t); const updated = await f.edit();
  assert.deepEqual(updated.circles, [{ id: ids.b, name: "Circle B" }]);
  const assignments = (await f.db.query("select circle_id,ended_at from circle_staff_assignments order by id")).rows;
  assert.equal(assignments.length, 2); assert.ok(assignments[0].ended_at); assert.equal(assignments[1].ended_at, null);
  const loaded = (await f.access.getOperatorAccessDirectory(ids.admin)).find((entry) => entry.authUserId === ids.operator);
  assert.deepEqual(loaded.circles, updated.circles); assert.equal(loaded.role, "guide");
  const audit = (await f.db.query("select * from operator_audit_events")).rows[0];
  assert.equal(audit.action, "operator_access.updated"); assert.deepEqual(audit.before_snapshot.circleIds, [ids.a]); assert.deepEqual(audit.after_snapshot.circleIds, [ids.b]);
  assert.ok(f.queries.findIndex((query) => query.includes("ruined-operator-admins")) < f.queries.findIndex((query) => query.includes("as authorized")));
});
test("promotion requires administrator confirmation and removes Circle scope without deleting history", async (t) => {
  const f = await fixture(t); const before = await f.snapshot();
  await assert.rejects(f.edit({ role: "ops_admin", circleIds: [] }), /Confirm administrator/); assert.deepEqual(await f.snapshot(), before);
  await f.edit({ role: "ops_admin", circleIds: [], administratorConfirmed: true });
  assert.deepEqual((await f.db.query("select role_slug from platform_role_grants where auth_user_id=$1 and revoked_at is null", [ids.operator])).rows, [{ role_slug: "ops_admin" }]);
  assert.equal((await f.db.query("select count(*)::integer as count from circle_staff_assignments where ended_at is null")).rows[0].count, 0);
});
test("self edits, unauthorized callers, stale role/scope/status, and unavailable Circles make no writes", async (t) => {
  const f = await fixture(t); const before = await f.snapshot();
  for (const input of [{ actorAuthUserId: ids.operator }, { actorAuthUserId: ids.other }, { expectedRole: "circle_leader" }, { expectedCircleIds: [] }, { expectedStatus: "suspended" }]) {
    await assert.rejects(f.edit(input)); assert.deepEqual(await f.snapshot(), before);
  }
  await f.db.query("update circles set status='archived' where id=$1", [ids.b]);
  await assert.rejects(f.edit(), /no longer available/); assert.deepEqual(await f.snapshot(), before);
});
test("suspended accounts require explicit restore; disabled accounts cannot be restored here", async (t) => {
  const f = await fixture(t);
  await f.db.query("update platform_users set status='suspended' where auth_user_id=$1", [ids.operator]);
  await assert.rejects(f.edit({ expectedStatus: "suspended" }), /restoration was not confirmed/);
  await f.edit({ expectedStatus: "suspended", restoreAccount: true });
  assert.equal((await f.db.query("select status from platform_users where auth_user_id=$1", [ids.operator])).rows[0].status, "active");
  assert.equal((await f.db.query("select action from operator_audit_events")).rows[0].action, "operator_access.restored");
  await f.db.query("update platform_users set status='disabled' where auth_user_id=$1", [ids.operator]);
  await assert.rejects(f.edit({ expectedStatus: "suspended", restoreAccount: true, expectedCircleIds: [ids.b] }), /separate recovery review/);
});
test("Shaper collisions and pending Shaper invitations reject the complete edit", async (t) => {
  const f = await fixture(t);
  await f.db.query("insert into circle_staff_assignments (circle_id,auth_user_id,role_slug) values ($1,$2,'circle_leader')", [ids.b, ids.other]);
  const before = await f.snapshot(); await assert.rejects(f.edit({ role: "circle_leader" }), /already has a Shaper/); assert.deepEqual(await f.snapshot(), before);
  await f.db.query("update circle_staff_assignments set ended_at=now() where auth_user_id=$1", [ids.other]);
  const invitation = (await f.db.query("insert into passwordless_account_invites(email_normalized,intended_user_type,expires_at) values ('new@example.com','staff',now()+interval '7 days') returning id")).rows[0].id;
  await f.db.query("insert into operator_invitation_configs values ($1,'circle_leader','New Shaper')", [invitation]); await f.db.query("insert into operator_invitation_circles values ($1,$2)", [invitation, ids.b]);
  await assert.rejects(f.edit({ role: "circle_leader" }), /pending Shaper invitation/);
});
test("audit failure rolls back grants, scopes, and account restoration together", async (t) => {
  const f = await fixture(t); await f.db.query("update platform_users set status='suspended' where auth_user_id=$1", [ids.operator]);
  const before = await f.snapshot(); f.fail.audit = true;
  await assert.rejects(f.edit({ expectedStatus: "suspended", restoreAccount: true, role: "ops_admin", circleIds: [], administratorConfirmed: true }), /Audit unavailable/);
  assert.deepEqual(await f.snapshot(), before);
});
test("pending joining persists, includes expired allowances, excludes staff/accepted/revoked, and supports exact revocation", async (t) => {
  const f = await fixture(t);
  await f.db.exec(`insert into passwordless_account_invites(email_normalized,intended_user_type,expires_at,accepted_at,revoked_at) values
    ('pending@example.com','member',now()+interval '7 days',null,null), ('expired@example.com','member',now()-interval '1 day',null,null),
    ('staff@example.com','staff',now()+interval '7 days',null,null), ('accepted@example.com','member',now()+interval '7 days',now(),null),
    ('revoked@example.com','member',now()+interval '7 days',null,now())`);
  const page = await f.invitations.getPendingMemberInvitations(ids.admin);
  assert.equal(page.totalResults, 2); assert.deepEqual(page.entries.map((entry) => entry.status).sort(), ["expired", "pending"]);
  await assert.rejects(f.invitations.getPendingMemberInvitations(ids.other), /administrator access/);
  const expired = page.entries.find((entry) => entry.status === "expired"); const pending = page.entries.find((entry) => entry.status === "pending");
  const expiry = (await f.invitations.getPendingMemberInvitation(ids.admin, pending.id)).expiresAt;
  assert.equal((await f.invitations.getPendingMemberInvitation(ids.admin, pending.id)).expiresAt, expiry, "Review never extends expiry");
  await assert.rejects(f.invitations.revokePendingMemberInvitation({ actorAuthUserId: ids.admin, invitationId: expired.id, email: pending.email }), /has changed/);
  await f.invitations.revokePendingMemberInvitation({ actorAuthUserId: ids.admin, invitationId: expired.id, email: expired.email });
  assert.equal((await f.invitations.getPendingMemberInvitations(ids.admin)).totalResults, 1);
  await assert.rejects(f.invitations.getPendingMemberInvitation(ids.admin, expired.id), /accepted, removed, or replaced/);
  await assert.rejects(f.operating.createOrReissueMemberInvitation({ actorAuthUserId: ids.admin, email: expired.email, expectedInvitationId: expired.id }), /has changed/);
});
