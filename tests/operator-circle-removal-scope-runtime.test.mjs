import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const require = createRequire(import.meta.url);
const admin = "11111111-1111-4111-8111-111111111111";
const member = "22222222-2222-4222-8222-222222222222";
const circleA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const circleB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
async function load(path, dependencies) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

async function fixture(t, status = "active") {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create table platform_users (auth_user_id uuid primary key, status text);
    create table platform_role_grants (auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table ruined_members (id uuid primary key);
    create table circles (id uuid primary key, status text, ends_at timestamptz, updated_at timestamptz default now());
    create table circle_member_assignments (
      id bigint primary key, circle_id uuid references circles(id), member_id uuid references ruined_members(id),
      assigned_at timestamptz default now(), ended_at timestamptz, end_reason text, ended_by_auth_user_id uuid
    );
    create table membership_blocks (id uuid primary key, status text);
    create table block_circle_assignments (circle_id uuid, block_id uuid, ended_at timestamptz);
  `);
  await db.query("insert into platform_users values ($1,'active')", [admin]);
  await db.query("insert into platform_role_grants values ($1,'ops_admin',null)", [admin]);
  await db.query("insert into ruined_members values ($1)", [member]);
  await db.query("insert into circles (id,status) values ($1,'active'),($2,$3)", [circleA, circleB, status]);
  // Simulate a previously observed Circle A placement that has since moved to B.
  await db.query("insert into circle_member_assignments (id,circle_id,member_id,ended_at) values (1,$1,$3,now()),(2,$2,$3,null)", [circleA, circleB, member]);
  const invalidations = [];
  const statements = [];
  function wrap(engine) {
    const sql = async (strings, ...values) => {
      const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      statements.push(query.replace(/\s+/g, " ").trim());
      return (await engine.query(query, values)).rows;
    };
    sql.begin = (callback) => engine.transaction((tx) => callback(wrap(tx)));
    return sql;
  }
  const repository = await load("src/lib/platform/ops-repository.ts", {
    "server-only": {}, "node:crypto": crypto,
    "@/lib/identity/repository": {},
    "@/lib/platform/calendar-audience-invalidation": { markCalendarAudiencesPendingForCircle: async (_tx, input) => { invalidations.push(input); } },
    "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) },
    "@/lib/stripe/membership-state": {},
  });
  const snapshot = async () => ({
    assignments: (await db.query("select * from circle_member_assignments order by id")).rows,
    circles: (await db.query("select * from circles order by id")).rows,
  });
  const end = (overrides = {}) => repository.endMemberCircleAssignment({ actorAuthUserId: admin, memberId: member, ...overrides });
  return { db, repository, end, invalidations, snapshot, statements };
}

test("a stale Circle A removal cannot end the member's new Circle B placement or queue Calendar changes", async (t) => {
  const f = await fixture(t);
  const before = await f.snapshot();
  await assert.rejects(f.end({ circleId: circleA }), (error) => error.code === "conflict" && /Circle changed/.test(error.message));
  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(f.invalidations, []);
  assert.ok(f.statements.some((sql) => /pg_advisory_xact_lock/.test(sql)));
  assert.ok(f.statements.some((sql) => /from circle_member_assignments.*for update/.test(sql)));
  assert.equal(f.statements.some((sql) => /^update |^insert |^delete /i.test(sql)), false);
});

test("matching expected Circle removes only that placement and preserves last-member archive behavior", async (t) => {
  const f = await fixture(t);
  const historical = (await f.snapshot()).assignments[0];
  const result = await f.end({ circleId: circleB.toUpperCase() });
  assert.equal(result.circleId, circleB);
  assert.equal(result.circleStatus, "archived");
  assert.equal(result.memberId, member);
  assert.equal(result.id, "2");
  assert.ok(result.endedAt);
  const after = await f.snapshot();
  assert.deepEqual(after.assignments[0], historical);
  assert.equal(after.assignments[1].end_reason, "ops_ended_assignment");
  assert.equal(after.assignments[1].ended_by_auth_user_id, admin);
  assert.equal(after.circles.find((row) => row.id === circleA).status, "active");
  assert.deepEqual(f.invalidations, [{ actorAuthUserId: admin, circleId: circleB }]);
});

test("legacy omitted Circle remains supported and an empty forming Circle is not archived", async (t) => {
  const f = await fixture(t, "forming");
  const result = await f.end();
  assert.equal(result.circleStatus, "forming");
  assert.equal(result.circleId, circleB);
  assert.equal(f.invalidations.length, 1);
});

test("malformed expected Circle and revoked administrator remain fail-closed without mutation", async (t) => {
  const f = await fixture(t);
  const before = await f.snapshot();
  await assert.rejects(f.end({ circleId: "" }), (error) => error.code === "invalid_request");
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [admin]);
  await assert.rejects(f.end({ circleId: circleB }), (error) => error.code === "forbidden");
  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(f.invalidations, []);
});

test("PATCH forwards an optional expected Circle, does not discard malformed supplied values, and returns stale conflicts", async () => {
  const calls = [];
  class OpsRepositoryError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const route = await load("app/api/ops/circle-assignments/route.ts", {
    "next/server": require("next/server"),
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => true },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => ({ authUserId: admin }) },
    "@/lib/workflows/worker": { processWorkflowBatch: () => { throw new Error("Removal must not invoke the workflow worker"); } },
    "@/lib/platform/ops-repository": {
      OpsRepositoryError,
      endMemberCircleAssignment: async (input) => {
        calls.push(input);
        if (input.circleId === "") throw new OpsRepositoryError("invalid_request", "Choose a valid Circle.");
        if (input.circleId === circleA) throw new OpsRepositoryError("conflict", "This member's Circle changed. Refresh the roster before removing them.");
        return { memberId: member, circleId: circleB, id: "2", circleStatus: "active" };
      },
    },
  });
  for (const [body, expectedCircle, status] of [
    [{ memberId: member, circleId: circleB }, circleB, 200],
    [{ memberId: member }, undefined, 200],
    [{ memberId: member, circleId: null }, "", 400],
    [{ memberId: member, circleId: circleA }, circleA, 409],
  ]) {
    const response = await route.PATCH(new Request("https://example.test/api/ops/circle-assignments", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    assert.equal(response.status, status);
    assert.deepEqual(calls.at(-1), { actorAuthUserId: admin, memberId: member, circleId: expectedCircle });
    const payload = await response.json();
    if (status === 200) assert.equal(payload.assignment.circleId, circleB);
    if (status === 409) assert.match(payload.error, /Refresh the roster/);
  }
});
