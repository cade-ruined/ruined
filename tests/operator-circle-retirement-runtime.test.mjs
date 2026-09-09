import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const require = createRequire(import.meta.url);
const admin = "11111111-1111-4111-8111-111111111111";
const circleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherCircleId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const blockId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const memberId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const migrationPath = "db/migrations/20260908234300_circle_retirement.sql";
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
class OpsRepositoryError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function load(path, dependencies) {
  const compiled = ts.transpileModule(await source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

function tableFrom(sql, table) {
  const match = sql.match(new RegExp(`create table if not exists (?:public\\.)?${table} \\([\\s\\S]*?\\n\\);`));
  assert.ok(match, `Missing real table: ${table}`);
  return match[0];
}

async function fixture(t, { migrate = true } = {}) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const gate = await source("db/migrations/20260825_membership_foundations_circle_gate.sql");
  const operations = await source("db/migrations/20260826_membership_operating_spine_05_content_operations.sql");
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table platform_users (auth_user_id uuid primary key, status text);
    create table platform_role_grants (auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table ruined_members (id uuid primary key);
    ${tableFrom(foundation, "circles")}
    alter table circles add activated_at timestamptz, add activated_by_auth_user_id uuid references platform_users;
    ${tableFrom(foundation, "circle_member_assignments")}
    create table foundation_enrollments (id bigint generated always as identity primary key,
      completion_circle_assignment_id bigint references circle_member_assignments(id), status text, completed_at timestamptz);
    create table membership_blocks (id uuid primary key, status text, ends_at timestamptz, updated_at timestamptz default now());
    create table block_circle_assignments (id bigint generated always as identity primary key,
      circle_id uuid references circles on delete restrict, block_id uuid references membership_blocks,
      assigned_by_auth_user_id uuid, assigned_at timestamptz default now(), created_at timestamptz default now(), ended_at timestamptz);
    ${tableFrom(operations, "operator_audit_events")}
    create table integration_outbox (aggregate_id text, payload jsonb);
    create table integration_entity_links (local_entity_id text, metadata jsonb);
    create table circle_staff_assignments (circle_id uuid references circles on delete restrict, ended_at timestamptz);
    create table circle_resources (circle_id uuid references circles on delete restrict, ended_at timestamptz);
    create table experiences (id bigint generated always as identity primary key,
      circle_id uuid references circles on delete restrict, status text, starts_at timestamptz, title text);
    create table learning_resource_targets (circle_id uuid references circles on delete restrict);
    create table member_announcement_targets (circle_id uuid references circles on delete restrict);
    create table operator_tasks (circle_id uuid references circles on delete restrict);
    create table operator_invitation_circles (circle_id uuid references circles on delete restrict);
    create table accountability_partner_assignments (circle_id uuid references circles on delete restrict);
  `);
  const guard = gate.match(/create or replace function private\.ruined_guard_circle_activation_audit\(\)[\s\S]*?for each row execute function private\.ruined_guard_circle_activation_audit\(\);/);
  assert.ok(guard);
  await db.exec(guard[0]);
  await db.exec(await source("db/migrations/20260826_membership_blocks_hardening.sql"));
  if (migrate) await db.exec(await source(migrationPath));
  await db.query("insert into platform_users values ($1,'active')", [admin]);
  await db.query("insert into platform_role_grants values ($1,'ops_admin',null)", [admin]);
  await db.query("insert into ruined_members values ($1)", [memberId]);
  await db.query("insert into circles (id,name,slug) values ($1,'Circle 01','circle-01'),($2,'Circle 02','circle-02')", [circleId, otherCircleId]);
  const statements = [];
  let intercept;
  function wrap(engine) {
    const execute = async (query, values) => {
      statements.push(query.replace(/\s+/g, " ").trim());
      if (intercept) await intercept(engine, query, values);
      return (await engine.query(query, values)).rows;
    };
    const sql = (strings, ...values) => execute(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values);
    sql.begin = (callback) => engine.transaction((tx) => callback(wrap(tx)));
    sql.unsafe = execute;
    sql.json = JSON.stringify;
    return sql;
  }
  const repository = await load("src/lib/platform/ops-circle-deletion-repository.ts", {
    "server-only": {}, "node:crypto": crypto,
    "@/lib/platform/ops-repository": { OpsRepositoryError },
    "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) },
  });
  const input = { actorAuthUserId: admin, circleId, confirmationName: "Circle 01" };
  return {
    db, statements,
    create: async (name) => {
      const creationRepository = await load("src/lib/platform/ops-repository.ts", {
        "server-only": {}, "node:crypto": crypto,
        "@/lib/identity/repository": {},
        "@/lib/platform/calendar-audience-invalidation": {},
        "@/lib/stripe/membership-state": {},
        "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) },
      });
      return creationRepository.createCircle({ actorAuthUserId: admin, name });
    },
    intercept: (callback) => { intercept = callback; },
    remove: (overrides = {}) => repository.deleteUnusedCircle({ ...input, ...overrides }),
    archive: (overrides = {}) => repository.archiveEmptyCircle({ ...input, ...overrides }),
    activate: (id = circleId) => db.query("update circles set status='active', starts_at=statement_timestamp(), activated_by_auth_user_id=$2 where id=$1", [id, admin]),
    circle: () => db.query("select * from circles where id=$1", [circleId]).then((result) => result.rows[0]),
    audits: () => db.query("select * from operator_audit_events order by id").then((result) => result.rows),
  };
}

test("DELETE removes only the confirmed unused forming Circle and records an atomic object-valued audit", async (t) => {
  const f = await fixture(t);
  const result = await f.remove();
  assert.equal(result.outcome, "deleted");
  assert.equal(await f.circle(), undefined);
  assert.equal((await f.db.query("select count(*)::int as n from circles")).rows[0].n, 1);
  const audit = (await f.audits())[0];
  assert.equal(audit.action, "circle.deleted");
  assert.equal(audit.before_snapshot.name, "Circle 01");
  assert.equal(audit.after_snapshot.outcome, "deleted");
  assert.ok(f.statements.findIndex((sql) => /from circles.*for update/.test(sql)) < f.statements.findIndex((sql) => /as occupied/.test(sql)));
});

test("a Circle created through the real operator repository can be deleted while it is still unused", async (t) => {
  const f = await fixture(t);
  const created = await f.create("  New Circle  ");
  assert.equal(created.name, "New Circle");
  assert.equal(created.status, "forming");
  assert.equal(created.activeMembers, 0);
  const result = await f.remove({ circleId: created.id, confirmationName: created.name });
  assert.equal(result.id, created.id);
  assert.equal(result.outcome, "deleted");
  assert.equal((await f.db.query("select id from circles where id=$1", [created.id])).rows.length, 0);
  assert.equal((await f.audits())[0].subject_id, created.id);
});

test("exact confirmation, malformed IDs and revoked/nonadmin roles deny without mutations", async (t) => {
  const f = await fixture(t);
  const before = await f.circle();
  await assert.rejects(f.remove({ confirmationName: "Circle 02" }), (error) => error.code === "invalid_request");
  await assert.rejects(f.archive({ circleId: "not-an-id" }), (error) => error.code === "invalid_request");
  await f.db.query("update platform_role_grants set role_slug='circle_leader'");
  await assert.rejects(f.remove(), (error) => error.code === "forbidden");
  await f.db.query("update platform_role_grants set role_slug='ops_admin', revoked_at=now()");
  await assert.rejects(f.archive(), (error) => error.code === "forbidden");
  assert.deepEqual(await f.circle(), before);
  assert.deepEqual(await f.audits(), []);
});

test("both retirement actions and the migrated trigger reject an occupied Circle", async (t) => {
  const f = await fixture(t);
  await f.db.query("insert into circle_member_assignments (circle_id,member_id) values ($1,$2)", [circleId, memberId]);
  for (const act of [f.remove, f.archive]) await assert.rejects(act(), (error) => error.code === "conflict" && /Move every member/.test(error.message));
  await assert.rejects(f.db.query("update circles set status='archived',ends_at=now() where id=$1", [circleId]), (error) => error.code === "23514");
  assert.equal((await f.circle()).status, "forming");
});

test("a roster change after the operator's request snapshot is rechecked under the Circle lock", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.db.query("select count(*)::int as n from circle_member_assignments")).rows[0].n, 0);
  let inserted = false;
  f.intercept(async (engine, query) => {
    if (/from circles.*for update/s.test(query) && !inserted) {
      inserted = true;
      await engine.query("insert into circle_member_assignments(circle_id,member_id) values($1,$2)", [circleId, memberId]);
    }
  });
  await assert.rejects(f.archive(), (error) => error.code === "conflict" && /Move every member/.test(error.message));
  assert.equal((await f.circle()).status, "forming");
  assert.deepEqual(await f.audits(), []);
});

test("every present or future FK dependency prevents hard deletion, including ended history", async (t) => {
  const f = await fixture(t);
  for (const table of ["circle_staff_assignments", "circle_resources", "experiences", "learning_resource_targets", "member_announcement_targets", "operator_tasks", "operator_invitation_circles", "accountability_partner_assignments"]) {
    await f.db.query(`insert into ${table} (circle_id) values ($1)`, [circleId]);
    await assert.rejects(f.remove(), (error) => error.code === "conflict" && /Archive Circle/.test(error.message));
    await f.db.query(`delete from ${table}`); // Isolated fixture cleanup only.
  }
  await f.db.query("insert into circle_member_assignments (circle_id,member_id,ended_at) values ($1,$2,now())", [circleId, memberId]);
  await assert.rejects(f.remove(), (error) => error.code === "conflict");
  await f.db.exec("create table future_circle_feature (circle_id uuid references circles on delete cascade)");
  await f.db.query("insert into future_circle_feature values ($1)", [otherCircleId]);
  await assert.rejects(f.remove({ circleId: otherCircleId, confirmationName: "Circle 02" }), (error) => error.code === "conflict");
  assert.equal((await f.db.query("select count(*)::int as n from future_circle_feature")).rows[0].n, 1);
});

test("polymorphic audit, outbox and integration evidence also prevent hard deletion", async (t) => {
  const f = await fixture(t);
  for (const [table, query] of [
    ["operator_audit_events", "insert into operator_audit_events(action,subject_type,subject_id,metadata) values ('circle.note','circle','other',jsonb_build_object('circleId',$1::text))"],
    ["integration_outbox", "insert into integration_outbox values ('other',jsonb_build_object('circle_id',$1::text))"],
    ["integration_entity_links", "insert into integration_entity_links values ($1,'{}')"],
  ]) {
    await f.db.query(query, [circleId]);
    await assert.rejects(f.remove(), (error) => error.code === "conflict");
    await f.db.query(`delete from ${table}`); // Isolated fixture cleanup only.
  }
});

test("late FK references fail closed rather than cascade or leave an audit-only partial delete", async (t) => {
  const f = await fixture(t);
  f.intercept(async (engine, query) => {
    if (/^delete from circles/.test(query.trim())) {
      await engine.query("insert into operator_tasks(circle_id) values ($1)", [circleId]);
    }
  });
  await assert.rejects(f.remove(), (error) => error.code === "conflict" && /linked record/.test(error.message));
  assert.ok(await f.circle());
  assert.deepEqual(await f.audits(), []);
});

test("audit failure rolls back deletion and archival", async (t) => {
  const f = await fixture(t);
  await f.db.exec("alter table operator_audit_events add constraint fail_fixture check (action='never')");
  const before = await f.circle();
  await assert.rejects(f.remove(), (error) => error.code === "23514");
  assert.deepEqual(await f.circle(), before);
  await assert.rejects(f.archive(), (error) => error.code === "23514");
  assert.deepEqual(await f.circle(), before);
});

test("used forming Circle archives without invented activation and retains every linked record", async (t) => {
  const f = await fixture(t);
  await f.db.query("insert into circle_member_assignments(circle_id,member_id,ended_at) values($1,$2,now())", [circleId, memberId]);
  await f.db.query("insert into circle_staff_assignments(circle_id) values($1)", [circleId]);
  await f.db.query("insert into circle_resources(circle_id) values($1)", [circleId]);
  await f.db.query("insert into experiences(circle_id,status,starts_at,title) values($1,'completed',now()-interval '1 day','Original gathering')", [circleId]);
  const history = (await f.db.query("select * from circle_member_assignments")).rows;
  const result = await f.archive();
  assert.equal(result.outcome, "archived");
  const circle = await f.circle();
  assert.equal(circle.status, "archived");
  assert.equal(circle.activated_at, null);
  assert.equal(circle.activated_by_auth_user_id, null);
  assert.equal(circle.starts_at, null);
  assert.ok(circle.ends_at);
  assert.deepEqual((await f.db.query("select * from circle_member_assignments")).rows, history);
  for (const table of ["circle_resources", "circle_staff_assignments", "experiences"]) assert.equal((await f.db.query(`select count(*)::int as n from ${table}`)).rows[0].n, 1);
  await f.archive();
  assert.equal((await f.audits()).length, 1);
  await assert.rejects(f.activate(), (error) => error.code === "23514");
});

test("forming retirement migration is replayable, stays in the runner and fails clearly while pending", async (t) => {
  const f = await fixture(t, { migrate: false });
  await assert.rejects(f.archive(), (error) => error.code === "conflict" && /database update/.test(error.message));
  assert.equal((await f.circle()).status, "forming");
  await f.db.exec(await source(migrationPath));
  await f.db.exec(await source(migrationPath));
  await f.archive();
  assert.match(await source("scripts/migrate-platform.mjs"), /20260908234300_circle_retirement\.sql/);
});

test("a legacy future-start Circle returns an actionable conflict instead of rewriting its dates", async (t) => {
  const f = await fixture(t);
  await f.db.query("update circles set starts_at=now()+interval '7 days' where id=$1", [circleId]);
  const before = await f.circle();
  await assert.rejects(f.archive(), (error) => error.code === "conflict" && /future start date/.test(error.message));
  assert.deepEqual(await f.circle(), before);
  assert.deepEqual(await f.audits(), []);
});

test("completed end times and future Circle event/Calendar references are not rewritten by archive", async (t) => {
  const f = await fixture(t);
  await f.activate();
  await f.db.query("update circles set status='completed',ends_at=statement_timestamp() where id=$1", [circleId]);
  const before = await f.circle();
  await f.db.query("insert into experiences(circle_id,status,starts_at,title) values($1,'published',now()+interval '10 days','Keep this event')", [circleId]);
  await f.db.query("insert into integration_entity_links values($1,'{\"provider\":\"google\",\"eventId\":\"unchanged\"}')", [circleId]);
  const events = (await f.db.query("select * from experiences")).rows;
  const links = (await f.db.query("select * from integration_entity_links")).rows;
  await f.archive();
  assert.deepEqual((await f.circle()).ends_at, before.ends_at);
  assert.deepEqual((await f.db.query("select * from experiences")).rows, events);
  assert.deepEqual((await f.db.query("select * from integration_entity_links")).rows, links);
});

test("the migration cannot fake activation, rewrite identity, reopen a retired Circle or weaken completion proof", async (t) => {
  const f = await fixture(t);
  for (const extra of ["activated_at=now()", `activated_by_auth_user_id='${admin}'`, "starts_at=now()", `id='${crypto.randomUUID()}'`]) {
    await assert.rejects(f.db.query(`update circles set status='archived',ends_at=now(),${extra} where id=$1`, [circleId]), (error) => error.code === "23514");
  }
  await f.activate();
  const activated = await f.circle();
  const assignment = (await f.db.query("insert into circle_member_assignments(circle_id,member_id,ended_at) values($1,$2,now()) returning id", [circleId, memberId])).rows[0];
  await f.db.query("insert into foundation_enrollments(completion_circle_assignment_id,status,completed_at) values($1,'completed',statement_timestamp())", [assignment.id]);
  const proof = (await f.db.query("select * from foundation_enrollments")).rows;
  await f.archive();
  assert.deepEqual((await f.db.query("select * from foundation_enrollments")).rows, proof);
  const archived = await f.circle();
  assert.deepEqual(archived.activated_at, activated.activated_at);
  assert.equal(archived.activated_by_auth_user_id, admin);
  await assert.rejects(f.db.query("update circles set starts_at=null where id=$1", [circleId]), (error) => error.code === "23514");
  await assert.rejects(f.db.query("update circles set ends_at=starts_at where id=$1", [circleId]), (error) => error.code === "23514");
});

test("archiving reports the existing parent Block reconciliation and preserves Block assignment history", async (t) => {
  const f = await fixture(t);
  await f.db.query("insert into membership_blocks(id,status) values($1,'forming')", [blockId]);
  await f.db.query("insert into block_circle_assignments(circle_id,block_id) values($1,$3),($2,$3)", [circleId, otherCircleId, blockId]);
  await f.db.query("update membership_blocks set status='active' where id=$1", [blockId]);
  const assignments = (await f.db.query("select * from block_circle_assignments order by id")).rows;
  const result = await f.archive();
  assert.equal(result.blockId, blockId);
  assert.equal(result.blockStatus, "archived");
  assert.equal(result.blockArchived, true);
  assert.deepEqual((await f.db.query("select * from block_circle_assignments order by id")).rows, assignments);
  const audit = (await f.audits())[0];
  assert.equal(audit.after_snapshot.blockArchived, true);
});

test("retirement routes enforce origin/session/JSON/explicit archive/name and map repository errors", async () => {
  let trusted = true; let viewer = { authUserId: admin }; let failure;
  const calls = [];
  const operation = (action) => async (input) => { calls.push({ action, ...input }); if (failure) throw failure; return { id: input.circleId, name: input.confirmationName, outcome: action }; };
  const route = await load("app/api/ops/circles/[circleId]/route.ts", {
    "next/server": require("next/server"),
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => trusted },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => viewer },
    "@/lib/platform/ops-repository": { OpsRepositoryError },
    "@/lib/platform/ops-circle-deletion-repository": { deleteUnusedCircle: operation("deleted"), archiveEmptyCircle: operation("archived") },
  });
  const run = (method, body = { confirmationName: "Circle 01" }, contentType = "application/json") => route[method](new Request("https://members.example.test/api/ops/circles/id", {
    method, headers: { "Content-Type": contentType }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ circleId }) });
  trusted = false; assert.equal((await run("DELETE")).status, 403);
  trusted = true; viewer = null; assert.equal((await run("DELETE")).status, 401);
  viewer = { authUserId: admin }; assert.equal((await run("DELETE", {}, "text/plain")).status, 415);
  for (const body of [null, [], {}, { confirmationName: "" }, { confirmationName: 1 }, { confirmationName: "x".repeat(81) }]) assert.equal((await run("DELETE", body)).status, 400);
  assert.equal((await run("PATCH")).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await run("DELETE")).status, 200);
  const archived = await run("PATCH", { confirmationName: "Circle 01", action: "archive" });
  assert.equal(archived.status, 200);
  assert.equal(archived.headers.get("Cache-Control"), "no-store");
  assert.equal((await archived.json()).circle.outcome, "archived");
  assert.deepEqual(calls.at(-1), { action: "archived", actorAuthUserId: admin, circleId, confirmationName: "Circle 01" });
  for (const [code, status] of [["forbidden",403],["not_found",404],["conflict",409],["invalid_request",400]]) {
    failure = new OpsRepositoryError(code, "Safe message");
    assert.equal((await run("DELETE")).status, status);
  }
});
