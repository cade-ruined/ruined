import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { Parameter, arraySerializer, types } from "../node_modules/postgres/src/types.js";

// Local PostgreSQL only. No DATABASE_URL, Google credentials, or live invitations.
const driver = postgres({ host: "127.0.0.1", max: 1, prepare: false });
const ids = Object.fromEntries(["admin", "supporter", "guide", "circle", "otherCircle", "block"].map((key) => [key, randomUUID()]));
class RepositoryError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies = {}) {
  const code = ts.transpileModule(await source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return { createHash, randomUUID };
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
          parameters.push(value instanceof Parameter
            ? value.array ? arraySerializer(value.value) : types.json.serialize(value.value)
            : value instanceof Date ? value.toISOString() : value);
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
  sql.json = driver.json; sql.array = driver.array;
  sql.begin = (callback) => engine.transaction((tx) => callback(sqlBridge(tx)));
  return sql;
}
function shippedTable(text, name) {
  const definition = text.match(new RegExp(`create table if not exists (?:public\\.)?${name} \\([\\s\\S]*?\\n\\);`))?.[0];
  assert.ok(definition, `Missing ${name}`);
  return definition;
}
function event(overrides = {}) {
  return {
    blockId: null, capacity: null, circleId: null, details: "",
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 90000000).toISOString(),
    externalRegistrationUrl: null, kind: "member_event", locationLabel: "",
    registrationClosesAt: null, registrationMode: "none", registrationOpensAt: null,
    summary: "", timezone: "America/Denver", title: "Members call", visibility: "all_members",
    waitlistEnabled: false, meetingUrl: "https://meet.google.com/abc-defg-hij", requestId: randomUUID(), ...overrides,
  };
}
function draft(overrides = {}) {
  const value = event(overrides);
  delete value.meetingUrl;
  delete value.requestId;
  return value;
}

test("simple event creation publishes and queues delivery atomically in isolated PostgreSQL", async (t) => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  const config = { ready: true, organizerEmail: "organizer@example.test", calendarId: "primary" };
  let mode = false;
  let eligibleAttendeeCount = 1;
  const communications = { ...await load("src/lib/google/communications.ts"), googleCommunicationLivemode: () => mode };
  const dependencies = {
    "@/lib/database/server": { getApplicationDatabase: () => sqlBridge(db) },
    "@/lib/google/communications": communications,
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: RepositoryError },
    "@/lib/platform/experience-member-access": {},
  };
  const calendar = await load("src/lib/platform/ops-calendar-repository.ts", {
    ...dependencies,
    "@/lib/google/calendar": { getGoogleCalendarConfigurationStatus: () => config },
    "@/lib/google/calendar-model": await load("src/lib/google/calendar-model.ts"),
    "@/lib/site": { SITE_URL: "https://members.example.test" },
  });
  const repository = await load("src/lib/platform/ops-experience-repository.ts", {
    ...dependencies, "@/lib/platform/ops-calendar-repository": {
      ...calendar,
      // Actual audience eligibility and locking are covered by the full
      // Calendar PostgreSQL fixture; here exercise its atomic failure boundary.
      requireOpsExperienceCalendarAudienceForCreation: async () => {
        if (!eligibleAttendeeCount) throw new RepositoryError("conflict", "This audience has no eligible members with a verified email address.");
        return eligibleAttendeeCount;
      },
    },
  });
  const community = await source("db/migrations/20260826_membership_operating_spine_03_community_experiences.sql");
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const appendOnly = foundation.match(/create or replace function ruined_reject_append_only_mutation\(\)[\s\S]*?\$\$;/)?.[0];
  const externalIndex = foundation.match(/create unique index if not exists integration_entity_links_external_mode_idx[\s\S]*?;/)?.[0];
  assert.ok(appendOnly);
  assert.ok(externalIndex);
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key);
    create table ruined_members(id uuid primary key,person_id uuid references people(id),unique(id,person_id));
    create table platform_users(auth_user_id uuid primary key,status text);
    create table platform_role_grants(id bigserial primary key,auth_user_id uuid references platform_users,role_slug text,revoked_at timestamptz);
    create table circles(id uuid primary key);
    create table membership_blocks(id uuid primary key);
    create table circle_staff_assignments(id bigserial primary key,auth_user_id uuid,circle_id uuid,role_slug text,ended_at timestamptz,assigned_at timestamptz default now());
    create table membership_progression_levels(slug text primary key);
    create table community_event_registrations(id uuid primary key);
    create table operator_audit_events(id bigserial primary key,actor_auth_user_id uuid references platform_users,action text,subject_type text,subject_id text,member_id uuid,reason text,before_snapshot jsonb,after_snapshot jsonb,metadata jsonb,dedupe_key text unique);
    create table integration_entity_links(provider text,local_entity_type text,local_entity_id text,external_entity_type text,external_entity_id text,livemode boolean,metadata jsonb,updated_at timestamptz,unique(provider,local_entity_type,local_entity_id,external_entity_type,livemode));
    ${externalIndex}
    ${shippedTable(community, "experiences")}
    ${shippedTable(community, "experience_registrations")}
    ${shippedTable(community, "experience_attendance_events")}
    ${appendOnly}
  `);
  for (const migration of ["20260828_operator_experience_management", "20260829_operator_google_calendar_sync", "20260829_operator_google_calendar_sync_hardening", "20260829_operator_google_calendar_meet_url_constraint", "20260904225258_calendar_durable_reconciliation", "20261008180000_operator_event_meet_links"]) {
    await db.exec(await source(`db/migrations/${migration}.sql`));
  }
  await db.query("insert into platform_users values ($1,'active'),($2,'active'),($3,'active')", [ids.admin, ids.supporter, ids.guide]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values ($1,'ops_admin'),($2,'circle_leader'),($3,'guide')", [ids.admin, ids.supporter, ids.guide]);
  await db.query("insert into circles values ($1),($2)", [ids.circle, ids.otherCircle]);
  await db.query("insert into membership_blocks values ($1)", [ids.block]);
  await db.query("insert into circle_staff_assignments(auth_user_id,circle_id,role_slug) values ($1,$2,'circle_leader'),($3,$2,'guide')", [ids.supporter, ids.circle, ids.guide]);
  const create = (overrides = {}, actorAuthUserId = ids.admin) => repository.createAndPublishOpsExperience({ actorAuthUserId, event: event(overrides) });
  const tables = ["experiences", "integration_entity_links", "experience_calendar_links", "experience_events", "operator_audit_events"];
  const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async (name) => [name, (await db.query(`select to_jsonb(row)::text as value from ${name} row order by to_jsonb(row)::text`)).rows])));
  const unchangedFailure = async (operation, predicate) => {
    const before = await snapshot();
    await assert.rejects(operation, predicate);
    assert.deepEqual(await snapshot(), before, "a failed create leaves no partial event, invitation, link or audit");
  };

  await t.test("one create stores the supplied Meet link, publishes, and queues the audience without registration", async () => {
    const result = await create({ meetingUrl: " https://meet.google.com/abc-defg-hij/?authuser=1#join " });
    const saved = (await db.query("select * from experiences where id=$1", [result.experienceId])).rows[0];
    assert.equal(saved.status, "published"); assert.ok(saved.published_at);
    assert.equal(saved.registration_mode, "none"); assert.equal(saved.capacity, null); assert.equal(saved.waitlist_enabled, false);
    const link = (await db.query("select * from integration_entity_links where local_entity_id=$1", [result.experienceId])).rows[0];
    assert.deepEqual(link.metadata, { meetingUri: "https://meet.google.com/abc-defg-hij", source: "operator_event" });
    assert.equal(link.external_entity_id, "abc-defg-hij"); assert.equal(link.livemode, false);
    const pending = (await db.query("select * from experience_calendar_links where experience_id=$1", [result.experienceId])).rows[0];
    assert.equal(pending.status, "pending_create"); assert.equal(pending.desired_experience_version, saved.version);
    assert.equal(pending.desired_attendee_revision, 1); assert.equal(pending.provider_event_id, null);
    assert.deepEqual((await db.query("select event_type from experience_events where experience_id=$1 order by id", [result.experienceId])).rows.map((row) => row.event_type), ["created", "published"]);
    assert.equal((await db.query("select count(*)::int as count from experience_registrations where experience_id=$1", [result.experienceId])).rows[0].count, 0);
  });
  await t.test("Circle and Block audiences keep exact scope and allow assigned Circle Supporters", async () => {
    for (const [overrides, actor] of [
      [{ visibility: "circle", circleId: ids.circle, kind: "circle_meeting" }, ids.supporter],
      [{ visibility: "block", blockId: ids.block }, ids.admin],
    ]) {
      const result = await create(overrides, actor);
      const saved = (await db.query("select visibility,circle_id,block_id from experiences where id=$1", [result.experienceId])).rows[0];
      assert.deepEqual(saved, { visibility: overrides.visibility, circle_id: overrides.circleId ?? null, block_id: overrides.blockId ?? null });
    }
    for (const [overrides, actor] of [
      [{}, ids.supporter],
      [{ visibility: "circle", circleId: ids.otherCircle, kind: "circle_meeting" }, ids.supporter],
      [{ visibility: "circle", circleId: ids.circle, kind: "circle_meeting" }, ids.guide],
    ]) await unchangedFailure(() => create(overrides, actor), (error) => error.code === "forbidden");
    await db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [ids.supporter]);
    await unchangedFailure(() => create({ visibility: "circle", circleId: ids.circle, kind: "circle_meeting" }, ids.supporter), (error) => error.code === "forbidden");
  });
  await t.test("separate events may deliberately reuse one Google Meet room", async () => {
    const first = await create({ title: "Weekly call one" });
    const second = await create({ title: "Weekly call two" });
    assert.notEqual(first.experienceId, second.experienceId);
    const links = (await db.query("select external_entity_id,metadata from integration_entity_links where local_entity_id in ($1,$2)", [first.experienceId, second.experienceId])).rows;
    assert.equal(links.length, 2);
    assert.ok(links.every((link) => link.external_entity_id === "abc-defg-hij" && link.metadata.source === "operator_event"));
  });
  await t.test("lost-response retries reuse one published event and cannot change its original submission", async () => {
    const submission = event();
    const first = await create(submission);
    const before = await snapshot();
    const replay = await create(submission);
    assert.deepEqual(replay, first);
    assert.deepEqual(await snapshot(), before, "retries do not reset delivery, append audits or create another invitation");
    assert.deepEqual(await create({ ...submission, title: `  ${submission.title}  `, meetingUrl: `${submission.meetingUrl}/?authuser=2#join` }), first, "normalized copies of the same submission have one fingerprint");
    await unchangedFailure(() => create({ ...submission, title: "A different event" }), (error) => error.code === "conflict" && /different event/.test(error.message));
    config.ready = false;
    assert.deepEqual(await create(submission), first, "an already committed event is still recoverable if Calendar setup subsequently changes");
    config.ready = true;
  });
  await t.test("missing Calendar setup or delivery mode prevents a misleading published success", async () => {
    config.ready = false;
    await unchangedFailure(() => create(), (error) => error.code === "conflict" && /Calendar setup/.test(error.message));
    config.ready = true; mode = null;
    await unchangedFailure(() => create(), (error) => error.code === "conflict");
    mode = false;
  });
  await t.test("an event that already ended rolls back even its saved event and Meet link", async () => {
    await unchangedFailure(() => create({ startsAt: new Date(Date.now() - 7200000).toISOString(), endsAt: new Date(Date.now() - 3600000).toISOString() }), (error) => error.code === "conflict" && /end time/.test(error.message));
  });
  await t.test("an empty or ineligible audience cannot publish an organizer-only invitation", async () => {
    eligibleAttendeeCount = 0;
    await unchangedFailure(() => create(), (error) => error.code === "conflict" && /no eligible members/.test(error.message));
    eligibleAttendeeCount = 1;
  });
  await t.test("an audit failure after queueing rolls back every part of event creation", async () => {
    await db.exec(`create function fail_test_publication() returns trigger language plpgsql as $$ begin
      if new.action='experience.published' then raise exception 'simulated audit failure'; end if; return new; end $$;
      create trigger fail_test_publication before insert on operator_audit_events for each row execute function fail_test_publication()`);
    try { await unchangedFailure(() => create(), /simulated audit failure/); }
    finally { await db.exec("drop trigger fail_test_publication on operator_audit_events; drop function fail_test_publication()"); }
  });
  await t.test("invalid links, audiences and registration settings are rejected without writes", async () => {
    for (const overrides of [
      { meetingUrl: "https://meet.google.com.attacker.example/abc-defg-hij" },
      { meetingUrl: "https://attacker@meet.google.com/abc-defg-hij" },
      { meetingUrl: "http://meet.google.com/abc-defg-hij" }, { meetingUrl: "" },
      { visibility: "public" }, { visibility: "invite_only" },
      { registrationMode: "internal" }, { capacity: 5 }, { waitlistEnabled: true },
      { endsAt: new Date(Date.now() - 1000).toISOString() },
    ]) await unchangedFailure(() => create(overrides), (error) => error.code === "invalid_request");
  });
  await t.test("advanced draft creation still works without Calendar setup and sends nothing", async () => {
    config.ready = false; mode = null;
    const result = await repository.createOpsExperience({ actorAuthUserId: ids.admin, draft: draft({ registrationMode: "internal", capacity: 12, visibility: "public" }) });
    const saved = (await db.query("select status,published_at,registration_mode from experiences where id=$1", [result.experienceId])).rows[0];
    assert.deepEqual(saved, { status: "draft", published_at: null, registration_mode: "internal" });
    assert.deepEqual((await db.query("select id from experience_calendar_links where experience_id=$1", [result.experienceId])).rows, []);
  });
});

test("creation API schedules only the committed new event and accurately reports queued delivery", async () => {
  const parser = await load("src/lib/platform/ops-experience-api.ts");
  const callbacks = [], calls = [];
  const eventId = randomUUID();
  let rejection = null;
  const route = await load("app/api/ops/experiences/route.ts", {
    "next/server": { after: (callback) => { calls.push("schedule"); callbacks.push(callback); } },
    "@/lib/google/calendar-worker": { processCalendarReconciliationForExperience: async (id) => { calls.push(["deliver", id]); } },
    "@/lib/platform/ops-api": {
      requireOpsMutationRequest: async () => ({ viewer: { authUserId: ids.admin } }),
      opsJson: (body, status = 200) => ({ body, status }),
      opsRepositoryErrorResponse: (error) => ({ body: { error: error.message }, status: error.code === "conflict" ? 409 : 400 }),
    },
    "@/lib/platform/ops-experience-api": parser,
    "@/lib/platform/ops-experience-repository": {
      createAndPublishOpsExperience: async (input) => { assert.equal(input.actorAuthUserId, ids.admin); if (rejection) throw rejection; calls.push("committed"); return { experienceId: eventId }; },
      createOpsExperience: async () => { calls.push("draft"); return { experienceId: eventId }; },
    },
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: RepositoryError },
  });
  const post = (body) => route.POST(new Request("https://members.example.test/api/ops/experiences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await post({ intent: "create_and_publish", ...event(), injected: true })).status, 400);
  assert.deepEqual(calls, []);
  const result = await post({ intent: "create_and_publish", ...event() });
  assert.deepEqual(result, { status: 201, body: { experience: { experienceId: eventId }, calendarDelivery: "queued" } });
  assert.deepEqual(calls, ["committed", "schedule"]);
  await callbacks[0]();
  assert.deepEqual(calls[2], ["deliver", eventId]);
  rejection = new RepositoryError("conflict", "Calendar setup is incomplete.");
  assert.equal((await post({ intent: "create_and_publish", ...event() })).status, 409);
  assert.equal(callbacks.length, 1, "failed transactions never schedule invitations");
  assert.equal((await post(draft())).status, 201);
  assert.equal(callbacks.length, 1, "legacy drafts never schedule invitations");
});
