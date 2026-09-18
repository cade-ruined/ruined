import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";
import { Parameter, arraySerializer, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { installOperatorFundingFunctions } from "./helpers/operator-funding-fixture.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(await source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return crypto;
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
class RepositoryError extends Error { constructor(code, message) { super(message); this.code = code; } }
function shippedTable(sql, name) {
  const table = sql.match(new RegExp(`create table if not exists (?:public\\.)?${name} \\([\\s\\S]*?\\n\\);`))?.[0];
  assert.ok(table, `Missing shipped table ${name}`); return table;
}

test("Experience page snapshots use read-only PostgreSQL while Calendar changes retain locking authorization", async (t) => {
  const PGlite = await loadPGliteForSchemaChecks(); const db = new PGlite();
  const driver = postgres({ host: "127.0.0.1", port: 1, prepare: false }); // Serializers only. Never connects.
  t.after(async () => { await db.close(); await driver.end(); });
  const ids = Object.fromEntries(["admin", "auth", "member", "person", "circle", "otherCircle", "block", "event"].map((key) => [key, crypto.randomUUID()]));
  const queries = [], providerCalls = [];
  let transactionDepth = 0;
  const config = { ready: true, organizerEmail: "operator@example.test", calendarId: "primary" };
  function bridge(engine) {
    class Query {
      constructor(strings, values) { this.strings = strings; this.values = values; }
      compile(params) {
        let query = this.strings[0];
        this.values.forEach((value, index) => {
          if (value instanceof Query) query += value.compile(params);
          else {
            params.push(value instanceof Parameter ? value.array ? arraySerializer(value.value) : types.json.serialize(value.value) : value instanceof Date ? value.toISOString() : value);
            query += `$${params.length}`;
          }
          query += this.strings[index + 1];
        });
        return query;
      }
      then(resolve, reject) {
        const params = [], query = this.compile(params);
        queries.push(query.replace(/\s+/g, " ").trim());
        return engine.query(query, params).then((result) => result.rows).then(resolve, reject);
      }
    }
    const sql = (strings, ...values) => new Query(strings, values);
    sql.json = driver.json; sql.array = driver.array;
    sql.begin = (fn) => engine.transaction(async (tx) => {
      transactionDepth += 1;
      try { return await fn(bridge(tx)); } finally { transactionDepth -= 1; }
    });
    return sql;
  }
  const policy = await load("src/lib/membership/access-policy.ts");
  const eligibility = await load("src/lib/platform/experience-member-access.ts", { "@/lib/membership/access-policy": policy });
  const calendarModel = await load("src/lib/google/calendar-model.ts");
  const communications = await load("src/lib/google/communications.ts");
  const googleCommunications = { ...communications, googleCommunicationLivemode: () => false };
  async function provider(input) {
    assert.equal(transactionDepth, 0, "Provider calls remain outside database transactions");
    providerCalls.push(input);
    return {
      eventId: input.eventId ?? calendarModel.googleCalendarEventIdForRequestKey(input.requestKey),
      organizerVerified: true, organizerEmail: config.organizerEmail, meetReady: true,
      meetUrl: "https://meet.google.com/abc-defg-hij", conferenceStatus: "success", conferenceId: "abc-defg-hij",
      etag: '"fixture"', htmlUrl: "https://calendar.google.com/event/fixture", iCalUid: "fixture", status: "confirmed",
    };
  }
  const calendar = await load("src/lib/platform/ops-calendar-repository.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => bridge(db) },
    "@/lib/google/calendar": {
      getGoogleCalendarConfigurationStatus: () => config,
      createGoogleCalendarEvent: provider, updateGoogleCalendarEvent: provider,
      cancelGoogleCalendarEvent: provider, getRuinedOwnedGoogleCalendarEventResult: provider,
      GoogleCalendarApiError: class extends Error {}, GoogleCalendarConflictError: class extends Error {},
    },
    "@/lib/google/calendar-model": calendarModel,
    "@/lib/google/communications": googleCommunications,
    "@/lib/platform/experience-member-access": eligibility,
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: RepositoryError },
    "@/lib/site": { SITE_URL: "https://members.example.test" },
  });
  const repository = await load("src/lib/platform/ops-experience-repository.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => bridge(db) },
    "@/lib/google/communications": googleCommunications,
    "@/lib/platform/experience-member-access": eligibility,
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: RepositoryError },
    "@/lib/platform/ops-calendar-repository": calendar,
  });
  const community = await source("db/migrations/20260826_membership_operating_spine_03_community_experiences.sql");
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const appendOnly = foundation.match(/create or replace function ruined_reject_append_only_mutation\(\)[\s\S]*?\$\$;/)?.[0];
  assert.ok(appendOnly);
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key,status text);
    create table ruined_members(id uuid primary key,person_id uuid references people(id),email text,email_normalized text,deleted_at timestamptz,unique(id,person_id));
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,status text,email_normalized text);
    create table platform_role_grants(id bigint generated always as identity primary key,auth_user_id uuid references platform_users,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text default 'active',administrative_onboarding_state text default 'completed',billing_state text default 'active',cancellation_effective_at timestamptz,foundations_state text default 'completed',program_state text default 'active',standing_state text default 'active',current_progression_level_slug text);
    create table person_profiles(person_id uuid,preferred_name text,display_name text,avatar_storage_path text);
    create table user_profiles(auth_user_id uuid,display_name text);
    create table person_email_addresses(person_id uuid,email_normalized text,is_primary boolean,retired_at timestamptz,verification_state text);
    create table circles(id uuid primary key,name text,status text,activated_at timestamptz,ends_at timestamptz);
    create table membership_blocks(id uuid primary key,name text,status text,activated_at timestamptz,ends_at timestamptz);
    create table circle_member_assignments(id bigint generated always as identity primary key,member_id uuid,circle_id uuid,ended_at timestamptz,assigned_at timestamptz default now());
    create table block_circle_assignments(id bigint generated always as identity primary key,circle_id uuid,block_id uuid,ended_at timestamptz,assigned_at timestamptz default now());
    create table circle_staff_assignments(id bigint generated always as identity primary key,auth_user_id uuid,circle_id uuid,role_slug text,ended_at timestamptz,assigned_at timestamptz default now());
    create table membership_progression_levels(slug text primary key);
    create table community_event_registrations(id uuid primary key);
    create table operator_audit_events(id bigserial primary key,actor_auth_user_id uuid references platform_users,action text,subject_type text,subject_id text,member_id uuid,request_id text,reason text,before_snapshot jsonb,after_snapshot jsonb,metadata jsonb,dedupe_key text unique);
    create table integration_entity_links(provider text,local_entity_type text,local_entity_id text,external_entity_type text,external_entity_id text,livemode boolean,metadata jsonb,updated_at timestamptz,unique(provider,local_entity_type,local_entity_id,external_entity_type,livemode));
    ${shippedTable(community, "experiences")}
    ${shippedTable(community, "experience_registrations")}
    ${shippedTable(community, "experience_attendance_events")}
    ${appendOnly}
  `);
  await installOperatorFundingFunctions(db);
  for (const migration of ["20260828_operator_experience_management", "20260829_operator_google_calendar_sync", "20260829_operator_google_calendar_sync_hardening", "20260829_operator_google_calendar_meet_url_constraint", "20260904225258_calendar_durable_reconciliation"]) {
    await db.exec(await source(`db/migrations/${migration}.sql`));
  }
  async function reset() {
    await db.exec("truncate people,ruined_members,platform_users,member_lifecycle,person_profiles,person_email_addresses,circles,membership_blocks,circle_member_assignments,block_circle_assignments,circle_staff_assignments,experiences,operator_audit_events restart identity cascade");
    await db.query("insert into people values ($1,'active')", [ids.person]);
    await db.query("insert into ruined_members(id,person_id,email,email_normalized) values ($1,$2,'member@example.test','member@example.test')", [ids.member, ids.person]);
    await db.query("insert into platform_users values ($1,null,null,'active','operator@example.test'),($2,$3,$4,'active','member@example.test')", [ids.admin, ids.auth, ids.member, ids.person]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values ($1,'ops_admin'),($2,'member')", [ids.admin, ids.auth]);
    await db.query("insert into member_lifecycle(member_id) values ($1)", [ids.member]);
    await db.query("insert into person_profiles values ($1,'Member','Full Member',null)", [ids.person]);
    await db.query("insert into person_email_addresses values ($1,'member@example.test',true,null,'verified')", [ids.person]);
    await db.query("insert into circles values ($1,'Circle A','active',now()-interval '1 day',null),($2,'Circle B','active',now()-interval '1 day',null)", [ids.circle, ids.otherCircle]);
    await db.query("insert into membership_blocks values ($1,'Block A','active',now()-interval '1 day',null)", [ids.block]);
    await db.query("insert into circle_member_assignments(member_id,circle_id) values ($1,$2)", [ids.member, ids.circle]);
    await db.query("insert into block_circle_assignments(circle_id,block_id) values ($1,$2)", [ids.circle, ids.block]);
    await db.query("insert into experiences(id,slug,kind,title,starts_at,ends_at,visibility,circle_id,status,published_at) values ($1,'circle-meeting','circle_meeting','Circle Meeting',now()+interval '1 day',now()+interval '1 day 1 hour','circle',$2,'published',now())", [ids.event, ids.circle]);
    config.ready = true; queries.length = 0; providerCalls.length = 0;
  }
  const record = () => repository.getOpsExperienceRecord(ids.admin, ids.event);
  const circleAudience = { visibility: "circle", circle_id: ids.circle, block_id: null };
  const snapshotEligible = (audience = circleAudience) => bridge(db).begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    return eligibility.memberEligibleForExperienceSnapshot(tx, audience, ids.member);
  });
  const authorized = (audience = circleAudience) => bridge(db).begin((tx) => eligibility.memberEligibleForExperience(tx, audience, ids.member));
  const snapshot = async () => Object.fromEntries(await Promise.all(["experiences", "experience_registrations", "platform_role_grants", "member_lifecycle", "experience_calendar_links", "experience_calendar_sync_requests", "operator_audit_events"].map(async (table) => [table, (await db.query(`select to_jsonb(row)::text as value from ${table} row order by to_jsonb(row)::text`)).rows])));

  await t.test("actual event record loads its populated audience in READ ONLY without locks, writes or provider calls", async () => {
    await reset(); const before = await snapshot();
    const result = await record();
    assert.equal(result.title, "Circle Meeting"); assert.equal(result.calendar.attendeeCount, 1);
    assert.equal(result.memberOptions[0].id, ids.member);
    assert.ok(queries.some((query) => /set transaction isolation level repeatable read read only/i.test(query)));
    assert.ok(queries.some((query) => query.includes("ruined_member_has_operator_funding")));
    assert.ok(queries.every((query) => !/for (share|update)|ruined_lock_member_operator_funding/i.test(query)));
    assert.deepEqual(await snapshot(), before); assert.deepEqual(providerCalls, []);
    config.ready = false; assert.equal((await record()).calendar.configured, false);
    assert.equal((await record()).calendar.attendeeCount, 1, "missing Google credentials do not block the event record");
  });

  await t.test("fixture enforces PostgreSQL's original 25006 failure for the locking wrapper in READ ONLY", async () => {
    await reset();
    await assert.rejects(bridge(db).begin(async (tx) => {
      await tx`set transaction isolation level repeatable read read only`;
      await eligibility.memberEligibleForExperience(tx, circleAudience, ids.member);
    }), (error) => error.code === "25006" && /SELECT FOR SHARE/.test(error.message));
    assert.equal(await snapshotEligible(), true);
    queries.length = 0; assert.equal(await authorized(), true);
    assert.ok(queries.some((query) => query.includes("ruined_lock_member_operator_funding")));
    assert.ok(queries.some((query) => query.includes("for share of member, person, lifecycle, account, member_grant")));
    assert.ok(queries.some((query) => query.includes("for share of assignment, circle")));
  });

  await t.test("Experience member picker excludes deletion tombstones independently of active lifecycle fields", async () => {
    await reset();
    assert.equal((await record()).memberOptions.length, 1);
    await db.query("update ruined_members set deleted_at=now() where id=$1", [ids.member]);
    assert.deepEqual((await record()).memberOptions, []);
  });

  await t.test("snapshot and locking checks deny the same standing, identity, payment and Circle changes", async () => {
    for (const change of [
      "update member_lifecycle set account_state='suspended'",
      "update member_lifecycle set administrative_onboarding_state='in_progress'",
      "update member_lifecycle set billing_state='pending'",
      "update member_lifecycle set standing_state='paused'",
      "update member_lifecycle set standing_state='cancellation_requested',cancellation_effective_at=now()-interval '1 day'",
      "update platform_users set status='suspended' where member_id is not null",
      "update platform_users set person_id=null where member_id is not null",
      "update platform_role_grants set revoked_at=now() where role_slug='member'",
      "update people set status='erased'",
      "update circle_member_assignments set ended_at=now()",
      "update circle_member_assignments set assigned_at=now()+interval '1 day'",
      "update circles set status='forming'",
      "update circles set ends_at=now()-interval '1 day'",
    ]) {
      await reset(); await db.exec(change);
      assert.equal(await snapshotEligible(), false, change);
      assert.equal(await authorized(), false, change);
      assert.equal((await record()).calendar.attendeeCount, 0, change);
    }
  });

  await t.test("complimentary funding and incomplete Foundations use the same policy in both wrappers", async () => {
    await reset();
    await db.exec("update member_lifecycle set billing_state='pending',foundations_state='in_progress',program_state='onboarding'");
    assert.equal(await snapshotEligible(), false);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values ($1,'guide')", [ids.auth]);
    assert.equal(await snapshotEligible(), true); assert.equal(await authorized(), true);
    assert.equal((await record()).calendar.attendeeCount, 1);
    const global = { visibility: "all_members", circle_id: null, block_id: null };
    assert.equal(await snapshotEligible(global), false); assert.equal(await authorized(global), false);
    await db.exec("update platform_role_grants set revoked_at=now() where role_slug='guide'");
    assert.equal(await snapshotEligible(), false); assert.equal(await authorized(), false);
  });

  await t.test("Block snapshots remain read-only and enforce current Circle and Block placement", async () => {
    await reset(); const audience = { visibility: "block", circle_id: null, block_id: ids.block };
    await db.query("update experiences set visibility='block',circle_id=null,block_id=$1", [ids.block]);
    assert.equal(await snapshotEligible(audience), true); assert.equal((await record()).calendar.attendeeCount, 1);
    queries.length = 0; assert.equal(await authorized(audience), true);
    assert.ok(queries.some((query) => query.includes("for share of member_assignment, circle, block_assignment, block")));
    await db.exec("update block_circle_assignments set assigned_at=now()+interval '1 day'");
    assert.equal(await snapshotEligible(audience), false); assert.equal(await authorized(audience), false);
    assert.equal((await record()).calendar.attendeeCount, 0);
  });

  await t.test("Calendar mutation still locks entitlement evidence, rechecks current access, and writes only from its authorization path", async () => {
    await reset(); assert.equal((await record()).calendar.attendeeCount, 1);
    queries.length = 0;
    const result = await calendar.syncOpsExperienceCalendar({ actorAuthUserId: ids.admin, experienceId: ids.event, intent: "create", requestKey: `snapshot-write-${crypto.randomUUID()}` });
    assert.equal(result.status, "synced"); assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].attendees.length, 1);
    const fundingLock = queries.findIndex((query) => query.includes("ruined_lock_member_operator_funding"));
    const intentWrite = queries.findIndex((query) => /insert into operator_audit_events/i.test(query));
    assert.ok(fundingLock >= 0 && intentWrite > fundingLock);
    assert.ok(queries.some((query) => /for share of member, person, lifecycle, account, member_grant/.test(query)));
    await db.exec("update platform_role_grants set revoked_at=now() where role_slug='ops_admin'");
    const before = await snapshot();
    await assert.rejects(calendar.syncOpsExperienceCalendar({ actorAuthUserId: ids.admin, experienceId: ids.event, intent: "sync", requestKey: `snapshot-revoked-${crypto.randomUUID()}` }), (error) => error.code === "forbidden");
    assert.equal(providerCalls.length, 1); assert.deepEqual(await snapshot(), before);
  });

  await t.test("a prior page snapshot cannot admit a member whose access was revoked before a later Calendar send", async () => {
    await reset(); assert.equal((await record()).calendar.attendeeCount, 1);
    await db.exec("update platform_role_grants set revoked_at=now() where role_slug='member'");
    await calendar.syncOpsExperienceCalendar({ actorAuthUserId: ids.admin, experienceId: ids.event, intent: "create", requestKey: `snapshot-changed-${crypto.randomUUID()}` });
    assert.equal(providerCalls.length, 1); assert.deepEqual(providerCalls[0].attendees, []);
  });
});
