import { installComplimentaryFundingFunctions } from "./helpers/operator-funding-fixture.mjs";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";

import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const require = createRequire(import.meta.url);
const ids = {
  admin: "11111111-1111-4111-8111-111111111111",
  member: "22222222-2222-4222-8222-222222222222",
  other: "33333333-3333-4333-8333-333333333333",
  block: "44444444-4444-4444-8444-444444444444",
  missing: "55555555-5555-4555-8555-555555555555",
  circleA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  circleB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  eventA: "aaaaaaaa-1111-4111-8111-111111111111",
  eventB: "bbbbbbbb-1111-4111-8111-111111111111",
  eventBlock: "cccccccc-1111-4111-8111-111111111111",
};
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
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
function shippedFunction(migration, name) {
  const start = migration.indexOf(`create or replace function ${name}(`) >= 0 ? migration.indexOf(`create or replace function ${name}(`) : migration.indexOf(`create function ${name}(`);
  const end = migration.indexOf("\n$$;", start);
  assert.ok(start >= 0 && end > start, `Shipped function missing: ${name}`);
  return migration.slice(start, end + 4);
}

async function fixture(t, { sourceStatus = "active", destinationStatus = "forming", sourceMembers = 1, block = false } = {}) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  // Use the shipped postgres-js JSON/date serializers, never its network client.
  // No environment credentials or external database are read by this test.
  const driver = postgres({ host: "127.0.0.1", port: 1, max: 1 });
  t.after(async () => { await db.close(); await driver.end(); });
  const placementPolicy = await source("db/migrations/20260930101000_circle_placement.sql");
  const gate = await source("db/migrations/20260825_membership_foundations_circle_gate.sql");
  const blocks = await source("db/migrations/20260826_membership_blocks_hardening.sql");
  const automation = await source("db/migrations/20260826_membership_operating_spine_04_foundations_automation.sql");
  const retirement = await source("db/migrations/20260908234300_circle_retirement.sql");
  const funding = await source("db/migrations/20260914181653_operator_complimentary_membership.sql");
  await db.exec(`
    create schema private;
    create table people (id uuid primary key, status text);
    create table platform_users (auth_user_id uuid primary key, status text, member_id uuid, person_id uuid);
    create table platform_role_grants (id bigint generated always as identity primary key, auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table ruined_members (id uuid primary key, person_id uuid, membership_state text, updated_at timestamptz default now());
    create table circle_staff_assignments (circle_id uuid, auth_user_id uuid, role_slug text, ended_at timestamptz);
    create function private.ruined_has_leadership_responsibility(uuid,text) returns boolean language sql as $$ select true $$;
    create table circle_placement_reviews (id uuid primary key default gen_random_uuid(), member_id uuid, circle_id uuid, previous_assignment_id bigint, requested_by_auth_user_id uuid, reason text, status text, reviewed_by_auth_user_id uuid, reviewed_at timestamptz, projected_count integer);
    create table member_lifecycle (member_id uuid primary key references ruined_members(id), account_state text, billing_state text, program_state text,
      administrative_onboarding_state text default 'completed', standing_state text default 'active', cancellation_effective_at timestamptz);
    create table circles (id uuid primary key, status text, capacity integer, starts_at timestamptz, ends_at timestamptz,
      activated_at timestamptz, activated_by_auth_user_id uuid, updated_at timestamptz default now());
    create table circle_member_assignments (id bigint generated always as identity primary key,
      member_id uuid references ruined_members(id), circle_id uuid references circles(id), assigned_at timestamptz default now(),
      assigned_by_auth_user_id uuid, ended_at timestamptz, end_reason text, ended_by_auth_user_id uuid);
    create unique index one_current_circle on circle_member_assignments(member_id) where ended_at is null;
    create table foundation_enrollments (id uuid primary key default gen_random_uuid(), status text,
      completion_circle_assignment_id bigint references circle_member_assignments(id), completed_at timestamptz);
    create table membership_blocks (id uuid primary key, status text, ends_at timestamptz, updated_at timestamptz default now());
    create table block_circle_assignments (circle_id uuid references circles(id), block_id uuid references membership_blocks(id),
      ended_at timestamptz, assigned_at timestamptz default now());
    create table operator_audit_events (actor_auth_user_id uuid, action text, subject_type text, subject_id text, reason text,
      before_snapshot jsonb check(jsonb_typeof(before_snapshot)='object'),
      after_snapshot jsonb check(jsonb_typeof(after_snapshot)='object'), metadata jsonb, dedupe_key text unique);
    create table domain_events (id uuid primary key default gen_random_uuid(), aggregate_type text, aggregate_id text,
      event_type text, person_id uuid, member_id uuid, actor_auth_user_id uuid, payload jsonb, occurred_at timestamptz, dedupe_key text unique);
    create table member_onboardings (member_id uuid primary key, state text, form_version text, requirements_snapshot jsonb,
      circle_assigned_at timestamptz, started_at timestamptz, completion_evidence jsonb, version integer default 1, updated_at timestamptz default now());
    create table member_onboarding_events (member_id uuid, event_type text, field_name text, actor_auth_user_id uuid,
      evidence jsonb, dedupe_key text unique, occurred_at timestamptz);
    create table workflow_actions (domain_event_id uuid references domain_events(id), action_type text, target_type text,
      target_id text, payload jsonb, idempotency_key text unique);
    create table experiences (id uuid primary key, status text, visibility text, circle_id uuid, block_id uuid);
    create table experience_calendar_links (experience_id uuid references experiences(id), provider text, status text);
    create table test_calendar_pending (experience_id uuid primary key, actor_auth_user_id uuid, reason text, marks integer default 1);
    ${shippedFunction(placementPolicy, "private.ruined_circle_participant_count")}
    ${shippedFunction(placementPolicy, "public.ruined_enforce_circle_capacity")}
    ${shippedFunction(funding, "private.ruined_member_has_operator_funding")}
    ${shippedFunction(funding, "private.ruined_lock_member_operator_funding")}
    ${shippedFunction(gate, "private.ruined_guard_circle_assignment_foundation_proof")}
    ${shippedFunction(gate, "private.ruined_guard_circle_activation_audit")}
    ${shippedFunction(retirement, "private.ruined_guard_circle_activation_audit")}
    ${shippedFunction(blocks, "private.ruined_reconcile_active_block")}
    ${shippedFunction(blocks, "private.ruined_reconcile_block_circle_status")}
    ${shippedFunction(automation, "private.ruined_queue_circle_assignment_work")}
    create trigger circle_member_assignments_00_foundation_proof_guard before insert or update or delete
      on circle_member_assignments for each row execute function private.ruined_guard_circle_assignment_foundation_proof();
    create trigger circle_member_assignments_capacity before insert or update of circle_id,ended_at
      on circle_member_assignments for each row execute function ruined_enforce_circle_capacity();
    create trigger circle_member_assignments_90_queue_work after insert on circle_member_assignments
      for each row execute function private.ruined_queue_circle_assignment_work();
    create trigger circles_00_activation_audit_guard before insert or update of id,status,starts_at,ends_at,activated_at,activated_by_auth_user_id
      on circles for each row execute function private.ruined_guard_circle_activation_audit();
    create trigger circles_active_block_reconcile after update of status
      on circles for each row execute function private.ruined_reconcile_block_circle_status();
  `);
  await installComplimentaryFundingFunctions(db);
  const couplePlacement = await source("db/migrations/20260930113000_couple_circle_placement.sql");
  await db.exec(`
    alter table membership_commercial_reservations add column couple_authorization_id uuid;
    alter table membership_commercial_participants add column person_id uuid, add column ordinal integer;
    create table membership_couple_authorizations(id uuid primary key, payer_member_id uuid, partner_member_id uuid, accepted_at timestamptz, accepted_by_auth_user_id uuid);
    ${["private.ruined_circle_couple_partner", "private.ruined_lock_circle_couple_members", "private.ruined_assert_couple_circle", "private.ruined_circle_couple_row_members", "private.ruined_lock_couple_circle_write", "private.ruined_check_couple_circle_write"].map(name => shippedFunction(couplePlacement, name)).join("\n")}
    create trigger circle_member_assignments_01_couple_lock before insert or update or delete on circle_member_assignments
      for each row execute function private.ruined_lock_couple_circle_write();
    create constraint trigger circle_member_assignments_couple_circle_check after insert or update or delete on circle_member_assignments
      deferrable initially deferred for each row execute function private.ruined_check_couple_circle_write();
  `);
  await db.query("insert into platform_users (auth_user_id,status) values ($1,'active')", [ids.admin]);
  await db.query("insert into platform_role_grants (auth_user_id,role_slug,revoked_at) values ($1,'ops_admin',null)", [ids.admin]);
  await db.query("insert into ruined_members (id,person_id,membership_state) values ($1,$1,'active'),($2,$2,'active')", [ids.member, ids.other]);
  await db.exec("insert into member_lifecycle (member_id,account_state,billing_state,program_state) select id,'active','active','onboarding' from ruined_members");
  await db.query("insert into circles (id,status,capacity) values ($1,'forming',10),($2,'forming',10)", [ids.circleA, ids.circleB]);
  const placement = (await db.query("insert into circle_member_assignments (member_id,circle_id,assigned_by_auth_user_id) values ($1,$2,$3) returning id::text", [ids.member, ids.circleA, ids.admin])).rows[0].id;
  if (sourceMembers === 2) await db.query("insert into circle_member_assignments (member_id,circle_id,assigned_by_auth_user_id) values ($1,$2,$3)", [ids.other, ids.circleA, ids.admin]);
  for (const [circle, status] of [[ids.circleA, sourceStatus], [ids.circleB, destinationStatus]]) {
    if (status !== "forming") await db.query("update circles set status='active', starts_at=statement_timestamp(),activated_by_auth_user_id=$2 where id=$1", [circle, ids.admin]);
    if (["archived", "completed"].includes(status)) await db.query("update circles set status=$2, ends_at=statement_timestamp() where id=$1", [circle, status]);
  }
  if (block) {
    await db.query("insert into membership_blocks (id,status) values ($1,'active')", [ids.block]);
    await db.query("insert into block_circle_assignments (circle_id,block_id) values ($1,$3),($2,$3)", [ids.circleA, ids.circleB, ids.block]);
  }
  await db.query("insert into experiences values ($1,'published','circle',$4,null),($2,'published','circle',$5,null),($3,'published','block',null,$6)", [ids.eventA, ids.eventB, ids.eventBlock, ids.circleA, ids.circleB, ids.block]);
  await db.exec("insert into experience_calendar_links select id,'google','synced' from experiences");
  const queries = [];
  const failure = { calendar: false, audit: false, auditMember: null };
  function wrap(engine) {
    const sql = async (strings, ...values) => {
      let query = strings[0];
      const params = values.map((value, index) => {
        query += `$${index + 1}${strings[index + 1]}`;
        if (value instanceof Parameter) return driver.options.serializers[3802](value.value);
        if (value !== null && /^\s*::jsonb\b/.test(strings[index + 1])) return driver.options.serializers[3802](value);
        return value instanceof Date ? types.date.serialize(value) : value;
      });
      queries.push(query.replace(/\s+/g, " ").trim());
      if ((failure.audit || (failure.auditMember && params.includes(failure.auditMember))) && /insert into operator_audit_events/.test(query)) throw new Error("Injected audit failure");
      return (await engine.query(query, params)).rows;
    };
    sql.json = driver.json;
    sql.begin = (callback) => engine.transaction((tx) => callback(wrap(tx)));
    return sql;
  }
  // Run the real Circle/Block audience-discovery SQL, replacing only the durable
  // link marker with another transactional table. No provider/worker executes.
  const calendar = await load("src/lib/platform/calendar-audience-invalidation.ts", {
    "server-only": {}, "@/lib/platform/ops-calendar-repository": {
      markOpsExperienceCalendarPending: async (tx, { actorAuthUserId, experienceId, reason }) => {
        await tx`insert into test_calendar_pending (experience_id,actor_auth_user_id,reason)
          values (${experienceId}::uuid,${actorAuthUserId}::uuid,${reason})
          on conflict (experience_id) do update set marks=test_calendar_pending.marks+1`;
        if (failure.calendar) throw new Error("Injected Calendar marker failure");
      },
    },
  });
  const repository = await load("src/lib/platform/ops-repository.ts", {
    // This legacy fixture runs with registration-only enrollment disabled.
    "@/lib/membership/registration-repository": { enrollNewMemberRegistration: async () => {} },
    "server-only": {}, "node:crypto": crypto, "@/lib/identity/repository": {},
    "@/lib/platform/calendar-audience-invalidation": calendar,
    "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) }, "@/lib/stripe/membership-state": {},
  });
  const tables = ["circle_member_assignments", "circles", "membership_blocks", "block_circle_assignments", "foundation_enrollments",
    "operator_audit_events", "domain_events", "member_onboardings", "member_onboarding_events", "workflow_actions", "test_calendar_pending", "circle_placement_reviews"];
  const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async (table) => [table,
    (await db.query(`select to_jsonb(record)::text as row from ${table} record order by to_jsonb(record)::text`)).rows])));
  const transfer = (overrides = {}) => repository.transferMemberToCircle({ actorAuthUserId: ids.admin, memberId: ids.member,
    assignmentId: placement, fromCircleId: ids.circleA, toCircleId: ids.circleB, ...overrides });
  return { db, failure, placement, queries, repository, snapshot, transfer };
}

async function fillDestination(f, count) {
  for (let index = 0; index < count; index++) {
    const id = crypto.randomUUID();
    await f.db.query("insert into ruined_members(id,person_id,membership_state) values($1,$1,'active')", [id]);
    await f.db.query("insert into member_lifecycle(member_id,account_state,billing_state,program_state) values($1,'active','active','active')", [id]);
    await f.db.query("insert into circle_member_assignments(member_id,circle_id,assigned_by_auth_user_id) values($1,$2,$3)", [id, ids.circleB, ids.admin]);
  }
}

test("transfer is one historical end + new placement, preserves proof, invalidates both Circles, and audits typed JSON", async (t) => {
  const f = await fixture(t, { block: true });
  await f.db.query("insert into foundation_enrollments (status,completion_circle_assignment_id,completed_at) values ('completed',$1,statement_timestamp())", [f.placement]);
  const prior = (await f.db.query("select * from circle_member_assignments where id=$1", [f.placement])).rows[0];
  const result = await f.transfer({ memberId: ids.member.toUpperCase(), fromCircleId: ids.circleA.toUpperCase() });
  assert.equal(result.circleId, ids.circleB);
  assert.equal(result.fromCircleId, ids.circleA);
  assert.equal(result.previousAssignmentId, f.placement);
  assert.notEqual(result.id, f.placement);
  assert.equal(result.memberId, ids.member);
  assert.equal(result.fromCircleStatus, "archived");
  assert.equal(result.fromBlockStatus, "archived");
  assert.equal(result.fromBlockId, ids.block);
  const rows = (await f.db.query("select assignment.*, assignment.id::text as id from circle_member_assignments assignment order by assignment.id")).rows;
  assert.equal(rows.length, 2);
  for (const field of ["circle_id", "member_id", "assigned_at", "assigned_by_auth_user_id"]) assert.deepEqual(rows[0][field], prior[field]);
  assert.equal(rows[0].end_reason, "ops_transferred_assignment");
  assert.equal(rows[0].ended_by_auth_user_id, ids.admin);
  assert.equal(rows[1].circle_id, ids.circleB);
  assert.equal(rows[1].ended_at, null);
  assert.equal(rows[1].assigned_at.toISOString(), result.assignedAt);
  assert.equal((await f.db.query("select old.ended_at=new.assigned_at as exact from circle_member_assignments old, circle_member_assignments new where old.id=$1 and new.id=$2", [f.placement, result.id])).rows[0].exact, true);
  assert.equal((await f.db.query("select completion_circle_assignment_id::text as id from foundation_enrollments")).rows[0].id, f.placement);
  assert.deepEqual((await f.db.query("select experience_id from test_calendar_pending order by experience_id")).rows.map((r) => r.experience_id), [ids.eventA, ids.eventB, ids.eventBlock]);
  const audit = (await f.db.query("select * from operator_audit_events where action='circle.member_transferred'")).rows[0];
  assert.equal(audit.action, "circle.member_transferred");
  assert.equal(audit.actor_auth_user_id, ids.admin);
  assert.deepEqual(audit.before_snapshot, { assignmentId: f.placement, circleId: ids.circleA });
  assert.deepEqual(audit.after_snapshot, result);
  const queued = (await f.db.query("select * from workflow_actions where idempotency_key=$1", [`notify-circle-assigned:${result.id}`])).rows;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].payload.circle_id, ids.circleB);
  assert.ok(f.queries.find((q) => /where id in .* order by id for update/.test(q)), "Both Circles lock in UUID order");
  const snapshot = await f.snapshot();
  await assert.rejects(f.transfer(), (e) => e.code === "conflict" && /placement changed/.test(e.message));
  assert.deepEqual(await f.snapshot(), snapshot, "Retry cannot duplicate a transfer or its durable follow-up");
  await assert.rejects(f.db.query("update circle_member_assignments set circle_id=$2 where id=$1", [f.placement, ids.circleB]), /immutable/);
});

test("forming source stays forming; populated active source stays active; forming destination never auto-activates", async (t) => {
  for (const options of [{ sourceStatus: "forming" }, { sourceMembers: 2 }]) await t.test(JSON.stringify(options), async (t) => {
    const f = await fixture(t, options);
    const result = await f.transfer();
    assert.equal(result.fromCircleStatus, options.sourceStatus ?? "active");
    assert.equal((await f.db.query("select status from circles where id=$1", [ids.circleB])).rows[0].status, "forming");
    assert.equal(result.fromBlockId, null);
  });
});

test("unreviewed overrange, archived, completed, and unknown destinations cannot end an existing placement", async (t) => {
  for (const destinationStatus of ["full", "archived", "completed", "missing"]) await t.test(destinationStatus, async (t) => {
    const f = await fixture(t, { destinationStatus: ["archived", "completed"].includes(destinationStatus) ? destinationStatus : "active" });
    if (destinationStatus === "full") {
      await fillDestination(f, 12);
    }
    const before = await f.snapshot();
    await assert.rejects(f.transfer(destinationStatus === "missing" ? { toCircleId: ids.missing } : {}), (e) => e.code === (destinationStatus === "missing" ? "not_found" : destinationStatus === "full" ? "invalid_request" : "conflict"));
    assert.deepEqual(await f.snapshot(), before);
    assert.equal(f.queries.some((q) => /^update |^insert |^delete /i.test(q)), false);
  });
});

test("exact source and assignment tokens reject old rosters, even after returning to the same Circle", async (t) => {
  const f = await fixture(t, { sourceStatus: "forming", destinationStatus: "active" });
  const before = await f.snapshot();
  for (const input of [{ assignmentId: "999" }, { fromCircleId: ids.missing }, { memberId: ids.other }]) {
    await assert.rejects(f.transfer(input), (e) => e.code === "conflict");
    assert.deepEqual(await f.snapshot(), before);
  }
  const first = await f.transfer();
  const second = await f.transfer({ assignmentId: first.id, fromCircleId: ids.circleB, toCircleId: ids.circleA });
  assert.notEqual(second.id, f.placement);
  const returned = await f.snapshot();
  await assert.rejects(f.transfer(), (e) => e.code === "conflict");
  assert.deepEqual(await f.snapshot(), returned);
});

test("member eligibility, malformed input, and admin authority remain server-owned and fail closed", async (t) => {
  const f = await fixture(t);
  const before = await f.snapshot();
  for (const input of [{ memberId: "invalid" }, { fromCircleId: "" }, { toCircleId: "" }, { toCircleId: ids.circleA },
    { assignmentId: "" }, { assignmentId: "0" }, { assignmentId: "1.1" }, { assignmentId: "9223372036854775808" }, { assignmentId: "1 OR 1=1" }]) {
    await assert.rejects(f.transfer(input), (e) => e.code === "invalid_request");
  }
  await assert.rejects(f.transfer({ memberId: ids.missing }), (e) => e.code === "not_found");
  for (const [column, bad] of [["account_state", "suspended"], ["billing_state", "past_due"], ["program_state", "alumni"]]) {
    await f.db.query(`update member_lifecycle set ${column}=$2 where member_id=$1`, [ids.member, bad]);
    await assert.rejects(f.transfer(), (e) => e.code === "conflict" && /Review this member/.test(e.message));
    await f.db.query(`update member_lifecycle set ${column}=$2 where member_id=$1`, [ids.member, column === "program_state" ? "onboarding" : "active"]);
  }
  await f.db.query("update ruined_members set membership_state='cancelled' where id=$1", [ids.member]);
  await assert.rejects(f.transfer(), (e) => e.code === "conflict");
  await f.db.query("update ruined_members set membership_state='active' where id=$1", [ids.member]);
  for (const role of ["circle_leader", "circle_guide"]) {
    await f.db.query("update platform_role_grants set role_slug=$2 where auth_user_id=$1", [ids.admin, role]);
    await assert.rejects(f.transfer(), (e) => e.code === "forbidden");
  }
  await f.db.query("update platform_role_grants set role_slug='ops_admin', revoked_at=now() where auth_user_id=$1", [ids.admin]);
  await assert.rejects(f.transfer(), (e) => e.code === "forbidden");
  await f.db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1", [ids.admin]);
  await f.db.query("update platform_users set status='suspended' where auth_user_id=$1", [ids.admin]);
  await assert.rejects(f.transfer(), (e) => e.code === "forbidden");
  assert.deepEqual(await f.snapshot(), before);
});

test("Calendar or audit failure rolls back the transfer, proof, empty-source/Block archive, and all queued follow-up", async (t) => {
  const f = await fixture(t, { block: true });
  const before = await f.snapshot();
  for (const failure of ["calendar", "audit"]) {
    f.failure[failure] = true;
    await assert.rejects(f.transfer(), /Injected/);
    assert.deepEqual(await f.snapshot(), before);
    f.failure[failure] = false;
  }
  const result = await f.transfer();
  assert.equal(result.fromCircleStatus, "archived");
  assert.equal((await f.db.query("select count(*)::int as count from circle_member_assignments where ended_at is null")).rows[0].count, 1);
});

test("two requests for the last place produce one accepted transfer and preserve the rejected member's source", async (t) => {
  const f = await fixture(t, { sourceMembers: 2 });
  await fillDestination(f, 11);
  const otherPlacement = (await f.db.query("select id::text from circle_member_assignments where member_id=$1", [ids.other])).rows[0].id;
  // PGlite serializes local transactions; this verifies the competing-request
  // outcome and shipped capacity guard, not multi-connection lock scheduling.
  const results = await Promise.allSettled([f.transfer(), f.transfer({ memberId: ids.other, assignmentId: otherPlacement })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.code, "invalid_request");
  assert.deepEqual((await f.db.query("select circle_id,count(*)::int as count from circle_member_assignments where ended_at is null group by circle_id order by circle_id")).rows,
    [{ circle_id: ids.circleA, count: 1 }, { circle_id: ids.circleB, count: 12 }]);
  assert.equal((await f.db.query("select count(*)::int as count from operator_audit_events")).rows[0].count, 2);
});

test("transfer API enforces origin/session/JSON, uses verified actor, maps domain errors, and never runs a worker", async () => {
  const calls = [];
  const state = { trusted: true, viewer: { authUserId: ids.admin }, error: null, viewerCalls: 0 };
  class OpsRepositoryError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const route = await load("app/api/ops/circle-transfers/route.ts", {
    "next/server": require("next/server"),
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => state.trusted },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => { state.viewerCalls++; return state.viewer; } },
    "@/lib/platform/ops-repository": { OpsRepositoryError, transferMemberToCircle: async (input) => {
      calls.push(input);
      if (state.error) throw state.error;
      if (Object.values(input).some((value) => value === "")) throw new OpsRepositoryError("invalid_request", "Choose a valid placement.");
      return { memberId: input.memberId, circleId: input.toCircleId, fromCircleId: input.fromCircleId, previousAssignmentId: input.assignmentId, id: "2" };
    } },
  });
  const body = { memberId: ids.member, fromCircleId: ids.circleA, toCircleId: ids.circleB, assignmentId: "1", actorAuthUserId: ids.other };
  const request = (payload = JSON.stringify(body), contentType = "application/json") => new Request("https://example.test/api/ops/circle-transfers", {
    method: "POST", headers: { "Content-Type": contentType }, body: payload,
  });
  state.trusted = false;
  assert.equal((await route.POST(request())).status, 403);
  assert.equal(state.viewerCalls, 0);
  state.trusted = true;
  state.viewer = null;
  assert.equal((await route.POST(request())).status, 401);
  state.viewer = { authUserId: ids.admin };
  assert.equal((await route.POST(request("plain", "text/plain"))).status, 415);
  assert.equal(calls.length, 0);
  const response = await route.POST(request());
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).transfer.circleId, ids.circleB);
  assert.deepEqual(calls.at(-1), { ...body, actorAuthUserId: ids.admin, exceptionReason: undefined, reviewId: undefined });
  for (const payload of ["{", "null", "[]", JSON.stringify({ ...body, assignmentId: 1 })]) {
    assert.equal((await route.POST(request(payload))).status, 400);
  }
  for (const [code, status] of [["forbidden", 403], ["not_found", 404], ["conflict", 409], ["invalid_request", 400]]) {
    state.error = new OpsRepositoryError(code, "Refresh this placement.");
    const errorResponse = await route.POST(request());
    assert.equal(errorResponse.status, status);
    assert.equal((await errorResponse.json()).error, "Refresh this placement.");
  }
  state.error = new Error("Private provider detail must never leave the server");
  const unexpected = await route.POST(request());
  assert.equal(unexpected.status, 503);
  assert.doesNotMatch(JSON.stringify(await unexpected.json()), /Private provider/);
});

for (const funding of ["operator", "complimentary"]) test(`Circle placement and transfer require current ${funding} funding and completed unrestricted entry`, async (t) => {
  const f = await fixture(t);
  await f.db.query("insert into people values ($1,'active')", [ids.member]);
  await f.db.query("insert into platform_users (auth_user_id,status,member_id,person_id) values ($1,'active',$1,$1)", [ids.member]);
  await f.db.query("insert into platform_role_grants (auth_user_id,role_slug) values ($1,'member')", [ids.member]);
  await f.db.query("update ruined_members set membership_state='pending' where id=$1", [ids.member]);
  await f.db.query("update member_lifecycle set billing_state='pending' where member_id=$1", [ids.member]);
  const before = await f.snapshot();
  await assert.rejects(f.transfer(), (error) => error.code === "conflict");
  assert.deepEqual(await f.snapshot(), before, "Pending payment alone cannot authorize transfer");
  if (funding === "operator") await f.db.query("insert into platform_role_grants (auth_user_id,role_slug) values ($1,'guide')", [ids.member]);
  else await f.db.query("insert into member_complimentary_grants(member_id) values ($1)", [ids.member]);
  for (const [restrict, restore] of [
    ["update member_lifecycle set account_state='suspended' where member_id=$1", "update member_lifecycle set account_state='active' where member_id=$1"],
    ["update member_lifecycle set administrative_onboarding_state='in_progress' where member_id=$1", "update member_lifecycle set administrative_onboarding_state='completed' where member_id=$1"],
    ["update platform_users set status='suspended' where auth_user_id=$1", "update platform_users set status='active' where auth_user_id=$1"],
    funding === "operator"
      ? ["update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='guide'", "update platform_role_grants set revoked_at=null where auth_user_id=$1 and role_slug='guide'"]
      : ["update member_complimentary_grants set revoked_at=now() where member_id=$1", "update member_complimentary_grants set revoked_at=null where member_id=$1"],
    ...(funding === "complimentary" ? [["update member_complimentary_grants set ends_at=now()-interval '1 second' where member_id=$1", "update member_complimentary_grants set ends_at=null where member_id=$1"]] : []),
  ]) {
    await f.db.query(restrict, [ids.member]);
    await assert.rejects(f.transfer(), (error) => error.code === "conflict", restrict);
    assert.deepEqual(await f.snapshot(), before, "Denied transfer preserves placements, audit and queued work");
    await f.db.query(restore, [ids.member]);
  }
  const result = await f.transfer();
  assert.equal(result.circleId, ids.circleB);
  assert.equal(result.previousAssignmentId, f.placement);
  await f.db.query("update circle_member_assignments set ended_at=now(), ended_by_auth_user_id=$2 where member_id=$1 and ended_at is null", [ids.member, ids.admin]);
  const assignment = await f.repository.assignMemberToCircle({ actorAuthUserId: ids.admin, memberId: ids.member, circleId: ids.circleB });
  assert.equal(assignment.created, true, "A funded member without a Circle can be added without requiring paid billing");
  assert.equal(assignment.circleId, ids.circleB);
  const state = (await f.db.query("select member.membership_state,lifecycle.billing_state from ruined_members member join member_lifecycle lifecycle on lifecycle.member_id=member.id where member.id=$1", [ids.member])).rows[0];
  assert.deepEqual(state, { membership_state: "pending", billing_state: "pending" });
});

test("routine placement requires explicit responsibility even for a general Administrator", async t => {
  const f = await fixture(t);
  await f.db.exec("create or replace function private.ruined_has_leadership_responsibility(uuid,text) returns boolean language sql as $$ select false $$");
  const before = await f.snapshot();
  await assert.rejects(f.transfer(), error => error.code === "forbidden" && /responsibility/.test(error.message));
  await assert.rejects(f.repository.assignMemberToCircle({ actorAuthUserId: ids.admin, memberId: ids.other, circleId: ids.circleB }), error => error.code === "forbidden");
  assert.deepEqual(await f.snapshot(), before);
});

test("reviewed overrange transfer succeeds with explicit authority and writes permanent review provenance", async t => {
  const f = await fixture(t); await fillDestination(f, 12);
  await f.db.exec("create or replace function private.ruined_has_leadership_responsibility(uuid,text) returns boolean language sql as $$ select $2 = 'circle_placement' $$");
  await assert.rejects(f.transfer({ exceptionReason: "Keep this established connection together" }), error => error.code === "forbidden");
  await f.db.exec("create or replace function private.ruined_has_leadership_responsibility(uuid,text) returns boolean language sql as $$ select true $$");
  await assert.rejects(f.transfer({ exceptionReason: "short" }), error => error.code === "invalid_request");
  const result = await f.transfer({ exceptionReason: "Keep this established connection together" });
  assert.equal(result.circleId, ids.circleB);
  const review = (await f.db.query("select * from circle_placement_reviews")).rows[0];
  assert.equal(review.status, "placed"); assert.equal(review.projected_count, 13);
  assert.equal(review.reviewed_by_auth_user_id, ids.admin); assert.equal(String(review.previous_assignment_id), f.placement);
  assert.equal((await f.db.query("select action from operator_audit_events where action='circle.placement_exception_approved'")).rows.length, 1);
});

test("a pending exception is bound to the exact current placement and cannot be replayed", async t => {
  const f = await fixture(t); await fillDestination(f, 12);
  const reviewId = crypto.randomUUID();
  await f.db.query("insert into circle_placement_reviews(id,member_id,circle_id,previous_assignment_id,requested_by_auth_user_id,reason,status) values($1,$2,$3,999,$4,'Approved connection needs more space','pending')", [reviewId,ids.member,ids.circleB,ids.admin]);
  await assert.rejects(f.transfer({ reviewId, exceptionReason: "Approved connection needs more space" }), error => error.code === "conflict");
  await f.db.query("update circle_placement_reviews set previous_assignment_id=$2 where id=$1",[reviewId,f.placement]);
  await f.transfer({ reviewId, exceptionReason: "Approved connection needs more space" });
  assert.equal((await f.db.query("select status from circle_placement_reviews where id=$1",[reviewId])).rows[0].status,"placed");
  await assert.rejects(f.transfer({ reviewId, exceptionReason: "Approved connection needs more space" }), error => error.code === "conflict");
});


async function couple(f) {
  const reservation = crypto.randomUUID();
  const subscription = `sub_test_couple_${reservation}`;
  await f.db.query("insert into stripe_subscriptions(id,member_id,stripe_status) values($1,$2,'active')", [subscription, ids.member]);
  await f.db.query("insert into membership_commercial_reservations(id,payer_member_id,kind,status,stripe_subscription_id,created_at) values($1,$2,'couple','activated',$3,now())", [reservation, ids.member, subscription]);
  await f.db.query("insert into membership_commercial_participants(reservation_id,member_id,person_id,ordinal) values($1,$2,$2,1),($1,$3,$3,2)", [reservation, ids.member, ids.other]);
}

test("initial couples placement puts both eligible members in the same Circle atomically", async t => {
  const f = await fixture(t, { sourceStatus: "forming" });
  await f.db.query("update circle_member_assignments set ended_at=statement_timestamp(),ended_by_auth_user_id=$2,end_reason='test_previous_placement' where member_id=$1", [ids.member, ids.admin]);
  await couple(f);
  const result = await f.repository.assignMemberToCircle({ actorAuthUserId: ids.admin, memberId: ids.member.toUpperCase(), circleId: ids.circleB.toUpperCase() });
  assert.equal(result.created, true);
  assert.equal(result.memberId, ids.member);
  assert.equal(result.circleId, ids.circleB);
  assert.deepEqual((await f.db.query("select member_id,circle_id from circle_member_assignments where ended_at is null order by member_id")).rows,
    [{ member_id: ids.member, circle_id: ids.circleB }, { member_id: ids.other, circle_id: ids.circleB }]);
  assert.equal((await f.db.query("select count(*)::int as count from operator_audit_events where action='circle.placement_approved'")).rows[0].count, 2);
  const ordinaryMemberLocks = f.queries.map((q, i) => /pg_advisory_xact_lock\(hashtext\(\$1\), 2\)/.test(q) ? i : -1).filter(i => i >= 0);
  assert.equal(ordinaryMemberLocks.length, 2);
  assert.ok(ordinaryMemberLocks.every(i => i < f.queries.findIndex(q => /ruined_lock_member_complimentary_funding/.test(q))), "Both member locks precede all funding/lifecycle locks");
  const before = await f.snapshot();
  const retry = await f.repository.assignMemberToCircle({ actorAuthUserId: ids.admin, memberId: ids.member, circleId: ids.circleB });
  assert.equal(retry.created, false);
  assert.deepEqual(await f.snapshot(), before);
});

test("initial couples placement respects the partner's existing Circle and preserves its original assignment", async t => {
  const f = await fixture(t);
  await couple(f);
  const before = await f.snapshot();
  await assert.rejects(f.repository.assignMemberToCircle({ actorAuthUserId: ids.admin, memberId: ids.other, circleId: ids.circleB }), error => error.code === "conflict" && /Couples share a Circle/.test(error.message));
  assert.deepEqual(await f.snapshot(), before);
  await f.repository.assignMemberToCircle({ actorAuthUserId: ids.admin, memberId: ids.other, circleId: ids.circleA });
  assert.equal((await f.db.query("select id::text from circle_member_assignments where member_id=$1 and ended_at is null", [ids.member])).rows[0].id, f.placement);
  assert.equal((await f.db.query("select count(*)::int as count from circle_member_assignments where circle_id=$1 and ended_at is null", [ids.circleA])).rows[0].count, 2);
});

test("couples transfer closes both historical assignments, preserves Foundations proof, and retires the empty source", async t => {
  const f = await fixture(t, { sourceMembers: 2, block: true });
  await couple(f);
  const prior = (await f.db.query("select * from circle_member_assignments order by member_id")).rows;
  for (const old of prior) await f.db.query("insert into foundation_enrollments(status,completion_circle_assignment_id,completed_at) values('completed',$1,statement_timestamp())", [old.id]);
  const result = await f.transfer();
  assert.equal(result.memberId, ids.member);
  assert.equal(result.fromCircleStatus, "archived");
  assert.equal(result.fromBlockStatus, "archived");
  const current = (await f.db.query("select member_id,circle_id from circle_member_assignments where ended_at is null order by member_id")).rows;
  assert.deepEqual(current, [{ member_id: ids.member, circle_id: ids.circleB }, { member_id: ids.other, circle_id: ids.circleB }]);
  for (const old of prior) {
    const ended = (await f.db.query("select * from circle_member_assignments where id=$1", [old.id])).rows[0];
    for (const key of ["member_id", "circle_id", "assigned_at", "assigned_by_auth_user_id"]) assert.deepEqual(ended[key], old[key]);
    assert.equal(ended.end_reason, "ops_transferred_assignment");
    assert.equal((await f.db.query("select old.ended_at=current.assigned_at as exact from circle_member_assignments old join circle_member_assignments current on current.member_id=old.member_id and current.ended_at is null where old.id=$1", [old.id])).rows[0].exact, true);
    assert.equal((await f.db.query("select count(*)::int as count from foundation_enrollments where completion_circle_assignment_id=$1", [old.id])).rows[0].count, 1);
  }
  assert.equal((await f.db.query("select count(*)::int as count from operator_audit_events where action='circle.member_transferred'")).rows[0].count, 2);
  const requestedAudit = (await f.db.query("select after_snapshot from operator_audit_events where action='circle.member_transferred' and subject_id=$1", [ids.member])).rows[0];
  assert.deepEqual(requestedAudit.after_snapshot, result);
  assert.deepEqual((await f.db.query("select experience_id from test_calendar_pending order by experience_id")).rows.map(row => row.experience_id), [ids.eventA, ids.eventB, ids.eventBlock]);
});

test("couples transfer includes an eligible unplaced partner, or keeps an already-present partner untouched", async t => {
  for (const alreadyPlaced of [false, true]) await t.test(String(alreadyPlaced), async t => {
    const f = await fixture(t);
    if (alreadyPlaced) await f.db.query("insert into circle_member_assignments(member_id,circle_id,assigned_by_auth_user_id) values($1,$2,$3)", [ids.other, ids.circleB, ids.admin]);
    await couple(f);
    const partnerBefore = (await f.db.query("select * from circle_member_assignments where member_id=$1", [ids.other])).rows;
    await f.transfer();
    assert.equal((await f.db.query("select count(*)::int as count from circle_member_assignments where circle_id=$1 and ended_at is null", [ids.circleB])).rows[0].count, 2);
    if (alreadyPlaced) assert.deepEqual((await f.db.query("select * from circle_member_assignments where member_id=$1", [ids.other])).rows, partnerBefore);
  });
});

test("ineligible partner and second-member audit failure roll back every part of a couples transfer", async t => {
  const f = await fixture(t, { sourceMembers: 2, block: true });
  await couple(f);
  await f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1", [ids.other]);
  let before = await f.snapshot();
  await assert.rejects(f.transfer(), error => error.code === "conflict");
  assert.deepEqual(await f.snapshot(), before);
  await f.db.query("update member_lifecycle set account_state='active' where member_id=$1", [ids.other]);
  before = await f.snapshot();
  f.failure.auditMember = ids.member;
  await assert.rejects(f.transfer(), /Injected audit failure/);
  assert.deepEqual(await f.snapshot(), before, "The first partner's successful placement, history, review, Calendar and notifications all roll back");
});

test("both members receive current capacity reviews and missing review authority cannot split a couple", async t => {
  const f = await fixture(t, { sourceMembers: 2 });
  await couple(f); await fillDestination(f, 12);
  const before = await f.snapshot();
  await assert.rejects(f.transfer(), error => error.code === "invalid_request");
  assert.deepEqual(await f.snapshot(), before);
  await f.transfer({ exceptionReason: "Keep the confirmed couple in the same Circle" });
  const reviews = (await f.db.query("select member_id,projected_count,status from circle_placement_reviews order by projected_count")).rows;
  assert.deepEqual(reviews, [{ member_id: ids.other, projected_count: 13, status: "placed" }, { member_id: ids.member, projected_count: 14, status: "placed" }]);
});

test("couple lock conflicts become a refreshable conflict and do not write membership data", async t => {
  const f = await fixture(t);
  await f.db.exec("create or replace function private.ruined_lock_circle_couple_members(requested_members uuid[]) returns void language plpgsql as $$ begin raise exception 'Couple is being updated' using errcode='40001'; end $$");
  const before = await f.snapshot();
  await assert.rejects(f.transfer(), error => error.code === "conflict" && /Refresh/.test(error.message));
  assert.deepEqual(await f.snapshot(), before);
});

test("a couple cannot take the last routine place without review, even after the first partner fits", async t => {
  const f = await fixture(t, { sourceMembers: 2 });
  await couple(f); await fillDestination(f, 11);
  const before = await f.snapshot();
  await assert.rejects(f.transfer(), error => error.code === "invalid_request");
  assert.deepEqual(await f.snapshot(), before, "The second partner's capacity rejection rolls back the first partner's otherwise eligible placement");
  await f.transfer({ exceptionReason: "Keep the confirmed couple together in this Circle" });
  assert.equal((await f.db.query("select count(*)::int as count from circle_member_assignments where circle_id=$1 and ended_at is null", [ids.circleB])).rows[0].count, 13);
});


test("review-queue approval carries the request reason to both members without widening authority", async t => {
  const f = await fixture(t, { sourceMembers: 2 });
  await couple(f); await fillDestination(f, 12);
  const reviewId = crypto.randomUUID();
  const reason = "Keep this confirmed couples membership together";
  await f.db.query("insert into circle_placement_reviews(id,member_id,circle_id,previous_assignment_id,requested_by_auth_user_id,reason,status) values($1,$2,$3,$4,$5,$6,'pending')", [reviewId, ids.member, ids.circleB, f.placement, ids.admin, reason]);
  await f.db.exec("create or replace function private.ruined_has_leadership_responsibility(uuid,text) returns boolean language sql as $$ select $2 = 'circle_placement' $$");
  const before = await f.snapshot();
  await assert.rejects(f.transfer({ reviewId, exceptionReason: reason }), error => error.code === "forbidden");
  assert.deepEqual(await f.snapshot(), before);
  await f.db.exec("create or replace function private.ruined_has_leadership_responsibility(uuid,text) returns boolean language sql as $$ select true $$");
  await f.transfer({ reviewId, exceptionReason: reason });
  const reviews = (await f.db.query("select id,member_id,reason,status,projected_count from circle_placement_reviews order by projected_count")).rows;
  assert.equal(reviews.length, 2);
  assert.deepEqual(reviews.map(review => [review.member_id, review.reason, review.status, review.projected_count]), [[ids.other, reason, "placed", 13], [ids.member, reason, "placed", 14]]);
  assert.equal(reviews[1].id, reviewId, "The initiating member's pending review is completed, not replaced");
});

test("deferred couple violations and serialization conflicts at commit map to refreshable domain errors", async t => {
  for (const code of ["P4206", "40001"]) await t.test(code, async t => {
    const f = await fixture(t);
    await f.db.exec(`create function private.test_deferred_couple_failure() returns trigger language plpgsql as $$ begin raise exception 'test deferred conflict' using errcode='${code}'; end $$;
      create constraint trigger test_deferred_couple_failure after insert on circle_member_assignments deferrable initially deferred for each row execute function private.test_deferred_couple_failure()`);
    const before = await f.snapshot();
    await assert.rejects(f.transfer(), error => error.code === "conflict" && /Refresh/.test(error.message));
    assert.deepEqual(await f.snapshot(), before);
  });
});
