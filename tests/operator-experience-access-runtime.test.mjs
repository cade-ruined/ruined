import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";

import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { Parameter, arraySerializer, types } from "../node_modules/postgres/src/types.js";

// This is an in-memory PostgreSQL test. It never reads DATABASE_URL or connects
// the lazy postgres-js client; only its real parameter helpers are used.
const driver = postgres({ host: "127.0.0.1", max: 1, prepare: false });
const ids = Object.fromEntries([
  "operator", "memberAuth", "outsideAuth", "nextAuth", "member", "outside", "next",
  "person", "outsidePerson", "nextPerson", "circle", "otherCircle", "block", "otherBlock", "event", "otherEvent",
].map((name) => [name, randomUUID()]));

class RepositoryError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function loadModule(path, dependencies) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return { randomUUID };
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports;
}

function sqlBridge(engine) {
  class Query {
    constructor(strings, values) { this.strings = strings; this.values = values; }
    compile(parameters) {
      let query = this.strings[0];
      this.values.forEach((value, index) => {
        if (value instanceof Query) query += value.compile(parameters);
        else {
          if (value instanceof Parameter) {
            value = value.array ? arraySerializer(value.value) : types.json.serialize(value.value);
          } else if (value instanceof Date) value = types.date.serialize(value);
          parameters.push(value);
          query += `$${parameters.length}`;
        }
        query += this.strings[index + 1];
      });
      return query;
    }
    then(resolve, reject) {
      const parameters = [];
      return engine.query(this.compile(parameters), parameters).then((result) => result.rows).then(resolve, reject);
    }
  }
  const sql = (strings, ...values) => new Query(strings, values);
  sql.json = driver.json;
  sql.array = driver.array;
  sql.begin = (callback) => engine.transaction((tx) => callback(sqlBridge(tx)));
  return sql;
}

function shippedTable(source, name) {
  const definition = source.match(new RegExp(`create table if not exists (?:public\\.)?${name} \\([\\s\\S]*?\\n\\);`))?.[0];
  assert.ok(definition, `Missing shipped ${name} table`);
  return definition;
}

test("operator roster authorization executes against isolated PostgreSQL, not source-string mocks", async (t) => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  const community = await readFile(new URL("../db/migrations/20260826_membership_operating_spine_03_community_experiences.sql", import.meta.url), "utf8");
  const foundation = await readFile(new URL("../db/migrations/20260819_platform_foundation.sql", import.meta.url), "utf8");
  const eventMigration = await readFile(new URL("../db/migrations/20260828_operator_experience_management.sql", import.meta.url), "utf8");
  const rejectMutation = foundation.match(/create or replace function ruined_reject_append_only_mutation\(\)[\s\S]*?\$\$;/)?.[0];
  assert.ok(rejectMutation);
  const policy = await loadModule("src/lib/membership/access-policy.ts", {});
  const eligibility = await loadModule("src/lib/platform/experience-member-access.ts", {
    "@/lib/membership/access-policy": policy,
  });
  let calendarInvalidations = 0;
  const repository = await loadModule("src/lib/platform/ops-experience-repository.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => sqlBridge(db) },
    "@/lib/google/communications": {},
    "@/lib/platform/experience-member-access": eligibility,
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: RepositoryError },
    "@/lib/platform/ops-calendar-repository": {
      markOpsExperienceCalendarPending: async () => { calendarInvalidations += 1; },
    },
  });
  const roster = (input = {}) => repository.setOpsExperienceRegistration({
    actorAuthUserId: ids.operator, experienceId: ids.event, action: "register", ...input,
  });
  const attendance = (registrationId, eventType, extra = {}) => repository.recordOpsExperienceAttendance({
    actorAuthUserId: ids.operator, experienceId: ids.event, registrationId, eventType, ...extra,
  });
  const deny = (operation) => assert.rejects(operation, (error) => (
    error instanceof RepositoryError && ["forbidden", "not_found"].includes(error.code)
  ));
  async function registerFixture(memberId = ids.member, status = "registered", eventId = ids.event, queueSeconds = 0) {
    const personId = memberId === ids.outside ? ids.outsidePerson : memberId === ids.next ? ids.nextPerson : ids.person;
    const { rows } = await db.query(`insert into experience_registrations
      (experience_id, person_id, member_id, status, source, waitlisted_at, cancelled_at, cancellation_reason)
      values ($1,$2,$3,$4,'ops',case when $4='waitlisted' then now() + $5 * interval '1 second' end,
        case when $4='cancelled' then now() end,case when $4='cancelled' then 'Fixture cancelled.' end) returning id`,
    [eventId, personId, memberId, status, queueSeconds]);
    return rows[0].id;
  }
  async function reset(role = "circle_leader") {
    await db.exec(`truncate table people, ruined_members, platform_users, platform_role_grants,
      member_lifecycle, circles, membership_blocks, circle_member_assignments, circle_staff_assignments,
      block_circle_assignments, experiences, operator_audit_events restart identity cascade`);
    calendarInvalidations = 0;
    await db.query(`insert into circles (id,status,activated_at) values ($1,'active',now()-interval '1 day'),($2,'active',now()-interval '1 day')`, [ids.circle, ids.otherCircle]);
    await db.query(`insert into membership_blocks (id,status,activated_at) values ($1,'active',now()-interval '1 day'),($2,'active',now()-interval '1 day')`, [ids.block, ids.otherBlock]);
    await db.query(`insert into block_circle_assignments (circle_id,block_id) values ($1,$2),($3,$4)`, [ids.circle, ids.block, ids.otherCircle, ids.otherBlock]);
    await db.query(`insert into platform_users (auth_user_id,status,email_normalized) values ($1,'active','operator@example.test')`, [ids.operator]);
    await db.query(`insert into platform_role_grants (auth_user_id,role_slug) values ($1,$2)`, [ids.operator, role]);
    if (role !== "ops_admin") await db.query(`insert into circle_staff_assignments (auth_user_id,circle_id,role_slug) values ($1,$2,$3)`, [ids.operator, ids.circle, role]);
    for (const [member, person, account, circle] of [
      [ids.member, ids.person, ids.memberAuth, ids.circle],
      [ids.outside, ids.outsidePerson, ids.outsideAuth, ids.otherCircle],
      [ids.next, ids.nextPerson, ids.nextAuth, ids.circle],
    ]) {
      await db.query(`insert into people values ($1,'active')`, [person]);
      await db.query(`insert into ruined_members values ($1,$2)`, [member, person]);
      await db.query(`insert into platform_users values ($1,$2,$3,'active',$4)`, [account, member, person, `${member}@example.test`]);
      await db.query(`insert into platform_role_grants (auth_user_id,role_slug) values ($1,'member')`, [account]);
      await db.query(`insert into member_lifecycle (member_id) values ($1)`, [member]);
      await db.query(`insert into circle_member_assignments (member_id,circle_id) values ($1,$2)`, [member, circle]);
    }
    for (const [event, circle] of [[ids.event, ids.circle], [ids.otherEvent, ids.otherCircle]]) {
      await db.query(`insert into experiences (id,slug,kind,title,starts_at,ends_at,visibility,circle_id,status,published_at)
        values ($1,$2,'circle_meeting','Circle meeting',now()+interval '2 days',now()+interval '2 days 1 hour','circle',$3,'published',now())`,
      [event, `event-${event}`, circle]);
    }
  }

  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table people (id uuid primary key, status text not null);
      create table ruined_members (id uuid primary key, person_id uuid references people(id), unique(id,person_id));
      create table platform_users (auth_user_id uuid primary key, member_id uuid, person_id uuid, status text, email_normalized text);
      create table platform_role_grants (id bigint generated always as identity primary key, auth_user_id uuid references platform_users(auth_user_id), role_slug text, revoked_at timestamptz);
      create table member_lifecycle (member_id uuid primary key references ruined_members(id), account_state text default 'active',
        administrative_onboarding_state text default 'completed', billing_state text default 'active', cancellation_effective_at timestamptz,
        foundations_state text default 'completed', program_state text default 'active', standing_state text default 'active', current_progression_level_slug text);
      create table circles (id uuid primary key, status text, activated_at timestamptz, ends_at timestamptz);
      create table membership_blocks (id uuid primary key, status text, activated_at timestamptz, ends_at timestamptz);
      create table circle_member_assignments (id bigint generated always as identity primary key, member_id uuid references ruined_members(id), circle_id uuid references circles(id), ended_at timestamptz, assigned_at timestamptz default now());
      create table circle_staff_assignments (id bigint generated always as identity primary key, auth_user_id uuid references platform_users(auth_user_id), circle_id uuid references circles(id), role_slug text, ended_at timestamptz, assigned_at timestamptz default now());
      create table block_circle_assignments (id bigint generated always as identity primary key, block_id uuid references membership_blocks(id), circle_id uuid references circles(id), ended_at timestamptz, assigned_at timestamptz default now());
      create table membership_progression_levels (slug text primary key);
      create table community_event_registrations (id uuid primary key);
      create table operator_audit_events (id bigint generated always as identity primary key, actor_auth_user_id uuid,
        action text, subject_type text, subject_id text, member_id uuid, reason text, before_snapshot jsonb,
        after_snapshot jsonb, metadata jsonb check(jsonb_typeof(metadata)='object'), dedupe_key text unique);
      ${shippedTable(community, "experiences")}
      ${shippedTable(community, "experience_registrations")}
      ${shippedTable(community, "experience_attendance_events")}
      ${rejectMutation}
    `);
    await db.exec(eventMigration);

    await t.test("all operator roles can admit an entitled member, but cannot bypass the Circle audience", async () => {
      for (const role of ["circle_leader", "guide", "ops_admin"]) {
        await reset(role);
        await deny(() => roster({ memberId: ids.outside }));
        assert.equal((await db.query("select count(*)::int as total from experience_registrations")).rows[0].total, 0);
        assert.equal(calendarInvalidations, 0);
        assert.equal((await roster({ memberId: ids.member })).status, "registered");
        assert.equal(calendarInvalidations, 1);
      }
    });

    await t.test("admission rechecks member identity, grants, lifecycle and temporal Circle evidence", async () => {
      const invalidations = [
        ["update people set status='inactive' where id=$1", ids.person],
        ["update platform_users set status='suspended' where auth_user_id=$1", ids.memberAuth],
        ["update platform_role_grants set revoked_at=now() where auth_user_id=$1", ids.memberAuth],
        ...["suspended", "closed", "invited"].map((state) => [`update member_lifecycle set account_state='${state}' where member_id=$1`, ids.member]),
        ...["pending", "ended", "attention_required"].map((state) => [`update member_lifecycle set billing_state='${state}' where member_id=$1`, ids.member]),
        ["update member_lifecycle set administrative_onboarding_state='in_progress' where member_id=$1", ids.member],
        ["update member_lifecycle set standing_state='paused' where member_id=$1", ids.member],
        ["update member_lifecycle set standing_state='cancellation_requested', cancellation_effective_at=now()-interval '1 day' where member_id=$1", ids.member],
        ["update circle_member_assignments set ended_at=now() where member_id=$1", ids.member],
        ["update circle_member_assignments set assigned_at=now()+interval '1 day' where member_id=$1", ids.member],
        ["update circles set status='archived' where id=$1", ids.circle],
        ["update circles set activated_at=now()+interval '1 day' where id=$1", ids.circle],
        ["update circles set ends_at=now()-interval '1 day' where id=$1", ids.circle],
      ];
      for (const [query, id] of invalidations) {
        await reset(); await db.query(query, [id]);
        await deny(() => roster({ memberId: ids.member }));
        assert.equal((await db.query("select count(*)::int as total from operator_audit_events")).rows[0].total, 0, query);
      }
    });

    await t.test("operator suspension, role revocation and ended/future staff scope deny even cleanup", async () => {
      for (const query of [
        "update platform_users set status='suspended' where auth_user_id=$1",
        "update platform_role_grants set revoked_at=now() where auth_user_id=$1",
        "update circle_staff_assignments set ended_at=now() where auth_user_id=$1",
        "update circle_staff_assignments set assigned_at=now()+interval '1 day' where auth_user_id=$1",
      ]) {
        await reset(); const registrationId = await registerFixture(); await db.query(query, [ids.operator]);
        await deny(() => roster({ memberId: ids.next }));
        await deny(() => roster({ action: "cancel", registrationId, reason: "Cleanup requested." }));
        await deny(() => attendance(registrationId, "revoked", { reason: "Correction." }));
      }
    });

    await t.test("paid Foundations access is limited to the member's own Circle", async () => {
      await reset("ops_admin");
      await db.query("update member_lifecycle set program_state='onboarding', foundations_state='in_progress' where member_id=$1", [ids.member]);
      assert.equal((await roster({ memberId: ids.member })).status, "registered");
      await db.query("update experiences set visibility='all_members',circle_id=null where id=$1", [ids.otherEvent]);
      await deny(() => roster({ experienceId: ids.otherEvent, memberId: ids.member }));
      await db.query("update member_lifecycle set program_state='active' where member_id=$1", [ids.member]);
      assert.equal((await roster({ experienceId: ids.otherEvent, memberId: ids.member })).status, "registered");
    });

    await t.test("admin Block admission respects current Block and Circle dates", async () => {
      for (const invalidation of [null,
        "update block_circle_assignments set assigned_at=now()+interval '1 day' where block_id=$1",
        "update block_circle_assignments set ended_at=now() where block_id=$1",
        "update membership_blocks set activated_at=now()+interval '1 day' where id=$1",
        "update membership_blocks set ends_at=now()-interval '1 day' where id=$1",
      ]) {
        await reset("ops_admin");
        await db.query("update experiences set visibility='block',circle_id=null,block_id=$1 where id=$2", [ids.block, ids.event]);
        await deny(() => roster({ memberId: ids.outside }));
        if (invalidation) { await db.query(invalidation, [ids.block]); await deny(() => roster({ memberId: ids.member })); }
        else assert.equal((await roster({ memberId: ids.member })).status, "registered");
      }
    });

    await t.test("manual promotions and reopening cancelled waitlist places cannot restore stale access", async () => {
      await reset(); const waitlisted = await registerFixture(ids.outside, "waitlisted");
      await deny(() => roster({ action: "promote", registrationId: waitlisted }));
      const cancelled = await registerFixture(ids.member, "cancelled");
      await db.query("update member_lifecycle set account_state='closed' where member_id=$1", [ids.member]);
      await deny(() => roster({ action: "waitlist", registrationId: cancelled, reason: "Restore place." }));
    });

    await t.test("eligible queue restoration and promotion preserve access until cancellation takes effect", async () => {
      await reset();
      await db.query("update member_lifecycle set standing_state='cancellation_requested', cancellation_effective_at=now()+interval '1 day' where member_id=$1", [ids.member]);
      const registrationId = await registerFixture(ids.member, "cancelled");
      assert.equal((await roster({ action: "waitlist", registrationId, reason: "Restore requested place." })).status, "waitlisted");
      assert.equal((await roster({ action: "promote", registrationId })).status, "registered");
    });

    await t.test("existing stale registrations remain removable without reopening access", async () => {
      await reset(); const registrationId = await registerFixture(ids.outside);
      await db.query("update member_lifecycle set account_state='closed' where member_id=$1", [ids.outside]);
      assert.equal((await roster({ action: "waitlist", registrationId, reason: "Release confirmed place." })).status, "waitlisted");
      assert.equal((await roster({ action: "cancel", registrationId, reason: "Remove stale registration." })).status, "cancelled");
    });

    await t.test("automatic promotion skips stale candidates while preserving eligible queue order", async () => {
      await reset(); await db.query("update experiences set capacity=1 where id=$1", [ids.event]);
      const confirmed = await registerFixture(ids.member);
      const stale = await registerFixture(ids.outside, "waitlisted", ids.event, -30);
      const next = await registerFixture(ids.next, "waitlisted", ids.event, -20);
      const result = await roster({ action: "cancel", registrationId: confirmed, reason: "Release my place." });
      assert.equal(result.promotedCount, 1);
      const statuses = new Map((await db.query("select id,status from experience_registrations")).rows.map((row) => [row.id,row.status]));
      assert.equal(statuses.get(stale), "waitlisted"); assert.equal(statuses.get(next), "registered");
      assert.equal((await db.query("select count(*)::int as total from experience_registration_events where source='system' and next_status='registered'")).rows[0].total, 1);
    });

    await t.test("known registration IDs cannot cross event or operator scope", async () => {
      await reset(); const other = await registerFixture(ids.outside, "registered", ids.otherEvent);
      for (const action of ["cancel", "waitlist", "promote"]) await deny(() => roster({ action, registrationId: other, reason: "Forged target." }));
      await deny(() => attendance(other, "checked_in"));
      await deny(() => roster({ experienceId: ids.otherEvent, action: "cancel", registrationId: other, reason: "Outside event." }));
    });

    await t.test("future check-in requires current entitlement, but past attendance remains truthful", async () => {
      await reset(); const registrationId = await registerFixture();
      assert.equal((await attendance(registrationId, "checked_in")).attendanceState, "checked_in");
      await db.query("update member_lifecycle set billing_state='ended' where member_id=$1", [ids.member]);
      await db.query("update circle_member_assignments set ended_at=now() where member_id=$1", [ids.member]);
      await deny(() => attendance(registrationId, "checked_in"));
      assert.equal((await attendance(registrationId, "revoked", { reason: "Remove early check-in." })).attendanceState, "revoked");
      await db.query("update experiences set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' where id=$1", [ids.event]);
      assert.equal((await attendance(registrationId, "attended")).attendanceState, "attended");
      assert.equal((await attendance(registrationId, "no_show")).attendanceState, "no_show");
      await db.query("update circle_staff_assignments set ended_at=now() where auth_user_id=$1", [ids.operator]);
      await deny(() => attendance(registrationId, "credited"));
    });
  } finally { await db.close(); await driver.end(); }
});
