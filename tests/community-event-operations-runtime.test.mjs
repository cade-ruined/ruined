import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";
import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = "db/migrations/20260914221302_community_event_operations.sql";
const admin = "11111111-1111-4111-8111-111111111111";
const guide = "22222222-2222-4222-8222-222222222222";
async function load(path, dependencies = {}) {
  const code = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
class OpsOperatingRepositoryError extends Error { constructor(code, message) { super(message); this.code = code; } }

async function fixture(t, { migrate = true, databaseFails = false } = {}) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  const driver = postgres({ host: "127.0.0.1", port: 1, max: 1 });
  const previousDatabase = process.env.DATABASE_URL;
  // The URL only selects the configured branch; every query is intercepted by
  // the isolated engine. No real application or provider connection is opened.
  process.env.DATABASE_URL = "postgresql://isolated.invalid/test";
  t.after(async () => { if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase; await db.close(); await driver.end(); });
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const immutableFunction = foundation.match(/create or replace function ruined_reject_append_only_mutation\(\)[\s\S]*?\$\$;/)?.[0];
  const outbox = foundation.match(/create table if not exists integration_outbox \([\s\S]*?\n\);/)?.[0];
  assert.ok(immutableFunction && outbox);
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table platform_users (auth_user_id uuid primary key, status text);
    create table platform_role_grants (id bigint generated always as identity primary key, auth_user_id uuid references platform_users(auth_user_id), role_slug text, revoked_at timestamptz);
    create table operator_audit_events (actor_auth_user_id uuid, action text, subject_type text, subject_id text, before_snapshot jsonb, after_snapshot jsonb, metadata jsonb, dedupe_key text unique);
    ${immutableFunction}
    ${outbox}
  `);
  for (const file of ["20260821_byob_registration.sql", "20260821_byob_registration_v2.sql", "20260821_byob_registration_v3.sql"]) await db.exec(await source(`db/migrations/${file}`));
  if (migrate) await db.exec(await source(migration));
  await db.query("insert into platform_users values ($1,'active'),($2,'active')", [admin, guide]);
  await db.query("insert into platform_role_grants (auth_user_id,role_slug) values ($1,'ops_admin'),($2,'guide')", [admin, guide]);
  const wrap = (engine) => {
    const sql = async (strings, ...values) => {
      if (databaseFails) throw new Error("Database offline");
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
  const sql = wrap(db);
  const byobModel = await load("src/lib/events/byob-registration-model.ts");
  const gallery = await load("src/data/eventGalleries.ts");
  const events = await load("src/data/events.ts", { "@/data/eventGalleries": gallery, "@/lib/events/byob-registration-model": byobModel });
  const model = await load("src/lib/events/community-event-model.ts", { "@/data/events": events });
  const repository = await load("src/lib/events/community-event-repository.ts", {
    "node:crypto": { randomUUID }, "@/data/events": events,
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError },
    "@/lib/events/community-event-model": model,
  });
  const byob = await load("src/lib/events/byob-registration-repository.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/events/community-event-repository": repository,
    "@/lib/events/byob-registration-model": byobModel,
  });
  const submission = byobModel.parseByob02RegistrationInput({ firstName: "Casey", lastName: "Example", email: "casey@example.test", waiverAccepted: true, waiverVersion: byobModel.BYOB_02_WAIVER_VERSION });
  return { db, sql, repository, byob, submission, model, events };
}

test("migration preserves the exact existing public events and keeps new tables private", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.repository.getPublicCommunityEvents(), f.events.EVENTS);
  const privileges = await f.db.query(`select c.relname, c.relrowsecurity,
    has_table_privilege('anon', c.oid, 'SELECT') as anonymous_read,
    has_table_privilege('authenticated', c.oid, 'INSERT') as browser_write
    from pg_class c where c.relname in ('community_event_listings','community_event_attendance_events') order by c.relname`);
  assert.equal(privileges.rows.length, 2);
  for (const row of privileges.rows) { assert.equal(row.relrowsecurity, true); assert.equal(row.anonymous_read, false); assert.equal(row.browser_write, false); }
});

test("Administrator can create, publish, edit and archive a public listing with conflict protection", async (t) => {
  const f = await fixture(t);
  const base = f.model.legacyCommunityEventRecords()[0];
  const input = { ...base, eventKey: "studio-night", title: "Studio night", startsAt: "2027-01-15T02:00:00Z", publicationState: "draft", eventState: "Upcoming", registrationMode: "external", registrationUrl: "https://tickets.example.test/studio", registrationOpen: true };
  const draft = await f.repository.saveCommunityEvent(admin, input, null);
  assert.equal(draft.version, 1);
  assert.equal((await f.repository.getPublicCommunityEvents()).some((event) => event.id === input.eventKey), false);
  const published = await f.repository.saveCommunityEvent(admin, { ...draft, publicationState: "published" }, 1);
  assert.equal((await f.repository.getPublicCommunityEvents()).find((event) => event.id === input.eventKey)?.registration.href, input.registrationUrl);
  await assert.rejects(f.repository.saveCommunityEvent(admin, { ...published, title: "Stale" }, 1), (error) => error.code === "conflict");
  const archived = await f.repository.saveCommunityEvent(admin, { ...published, publicationState: "archived" }, 2);
  assert.equal(archived.version, 3);
  assert.equal((await f.repository.getPublicCommunityEvents()).some((event) => event.id === input.eventKey), false);
  assert.equal((await f.repository.getOpsCommunityEvents(admin)).find((event) => event.eventKey === input.eventKey)?.publicationState, "archived");
  assert.equal((await f.db.query("select count(*)::int as count from operator_audit_events")).rows[0].count, 3);
});

test("approved public registration is idempotent and attendance preserves waiver, registration and Sheets identity", async (t) => {
  const f = await fixture(t);
  await f.byob.registerByob02Participant(f.submission);
  await f.byob.registerByob02Participant(f.submission);
  const original = (await f.db.query("select * from community_event_registrations")).rows;
  const originalOutbox = (await f.db.query("select * from integration_outbox")).rows;
  assert.equal(original.length, 1); assert.equal(originalOutbox.length, 1);
  const roster = await f.repository.getCommunityRoster(admin, "byob-02", "CASEY");
  assert.equal(roster.count, 1); assert.equal(roster.registrations[0].id, original[0].id);
  const first = await f.repository.recordCommunityAttendance(admin, "byob-02", original[0].id, "present", null);
  assert.equal((await f.repository.getCommunityRoster(admin, "byob-02")).registrations[0].attendanceState, "present");
  await assert.rejects(f.repository.recordCommunityAttendance(admin, "byob-02", original[0].id, "absent", null), (error) => error.code === "conflict");
  await f.repository.recordCommunityAttendance(admin, "byob-02", original[0].id, "not_recorded", first.attendanceEventId);
  assert.equal((await f.repository.getCommunityRoster(admin, "byob-02")).registrations[0].attendanceState, "not_recorded");
  assert.deepEqual((await f.db.query("select * from community_event_registrations")).rows, original);
  assert.deepEqual((await f.db.query("select * from integration_outbox")).rows, originalOutbox);
  await assert.rejects(f.db.exec("update community_event_attendance_events set attendance_state='absent'"), /append-only/);
  await assert.rejects(f.db.exec("delete from community_event_attendance_events"), /append-only/);
});

test("closed and hidden BYOB listings cannot accept new registrations or create outbox work", async (t) => {
  const f = await fixture(t);
  const byob = (await f.repository.getOpsCommunityEvents(admin)).find((event) => event.eventKey === "byob-02");
  const closed = await f.repository.saveCommunityEvent(admin, { ...byob, registrationOpen: false }, byob.version);
  await assert.rejects(f.byob.registerByob02Participant(f.submission), (error) => error.code === "conflict");
  const hidden = await f.repository.saveCommunityEvent(admin, { ...closed, registrationOpen: true, publicationState: "archived" }, closed.version);
  await assert.rejects(f.byob.registerByob02Participant(f.submission), (error) => error.code === "conflict");
  await f.repository.saveCommunityEvent(admin, { ...hidden, publicationState: "published", eventState: "Ended" }, hidden.version);
  await assert.rejects(f.byob.registerByob02Participant(f.submission), (error) => error.code === "conflict");
  assert.equal((await f.db.query("select count(*)::int as count from integration_outbox")).rows[0].count, 0);
  assert.equal((await f.db.query("select count(*)::int as count from community_event_registrations")).rows[0].count, 0);
});

test("revoked, suspended and non-admin operators cannot read or mutate public rosters", async (t) => {
  const f = await fixture(t);
  const input = f.model.legacyCommunityEventRecords()[0];
  await assert.rejects(f.repository.getOpsCommunityEvents(guide), (error) => error.code === "forbidden");
  await assert.rejects(f.repository.getCommunityRoster(guide, "byob-02"), (error) => error.code === "forbidden");
  await assert.rejects(f.repository.saveCommunityEvent(guide, input, 1), (error) => error.code === "forbidden");
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [admin]);
  await assert.rejects(f.repository.getCommunityRoster(admin, "byob-02"), (error) => error.code === "forbidden");
  await f.db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1", [admin]);
  await f.db.query("update platform_users set status='suspended' where auth_user_id=$1", [admin]);
  await assert.rejects(f.repository.saveCommunityEvent(admin, input, 1), (error) => error.code === "forbidden");
});

test("registration scope, cancelled attendance, unsafe media and BYOB waiver reuse fail closed", async (t) => {
  const f = await fixture(t);
  await f.byob.registerByob02Participant(f.submission);
  const registration = (await f.repository.getCommunityRoster(admin, "byob-02")).registrations[0];
  await assert.rejects(f.repository.recordCommunityAttendance(admin, "byob-01", registration.id, "present", null), (error) => error.code === "not_found");
  await f.db.query("update community_event_registrations set status='cancelled', cancelled_at=now() where id=$1", [registration.id]);
  await assert.rejects(f.repository.recordCommunityAttendance(admin, "byob-02", registration.id, "present", null), (error) => error.code === "conflict");
  const input = f.model.legacyCommunityEventRecords()[1];
  for (const invalid of [{ ...input, imagePath: "//attacker.test/image" }, { ...input, imagePath: "/../secret" }, { ...input, eventKey: "byob-03" }, { ...input, registrationMode: "none" }]) {
    assert.throws(() => f.repository.parseCommunityEventInput(invalid), (error) => error.code === "invalid_request");
  }
});

test("an intentionally empty public feed never resurrects static entries", async (t) => {
  const f = await fixture(t);
  await f.db.exec("update community_event_listings set publication_state='archived'");
  assert.deepEqual(await f.repository.getPublicCommunityEvents(), []);
});

test("legacy schema fallback preserves real published content until migration, never a configured outage", async (t) => {
  const f = await fixture(t, { migrate: false });
  assert.deepEqual(await f.repository.getPublicCommunityEvents(), f.events.EVENTS);
  await f.byob.registerByob02Participant(f.submission);
  assert.equal((await f.db.query("select count(*)::int as count from community_event_registrations")).rows[0].count, 1);
});

test("configured database errors stop public feed reads and registration", async (t) => {
  const f = await fixture(t, { databaseFails: true });
  await assert.rejects(f.repository.getPublicCommunityEvents(), /Database offline/);
  await assert.rejects(f.byob.registerByob02Participant(f.submission), /Database offline/);
});

test("public consumers share the live feed and operator mutations retain request guards", async () => {
  const feed = await source("app/api/community/events/route.ts");
  assert.match(feed, /getPublicCommunityEvents\(\)/);
  assert.doesNotMatch(feed, /getCommunityRoster|registrations|waiver|email_normalized/);
  for (const file of ["app/api/ops/community-events/route.ts", "app/api/ops/community-events/[eventKey]/attendance/route.ts"]) {
    const route = await source(file);
    assert.match(route, /requireOpsMutationRequest\(request\)/);
    assert.match(route, /access\.viewer\.authUserId/);
    assert.match(route, /opsRepositoryErrorResponse\(error\)/);
  }
  for (const file of ["src/components/ImmersiveParallax.tsx", "src/components/DesktopImmersiveParallax.tsx", "src/components/MobileImmersiveJourney.tsx", "src/components/events/EventsIndex.tsx", "src/components/membership/MemberExperiences.tsx"]) {
    assert.match(await source(file), /usePublicEvents/);
  }
  const signup = await source("app/community/byob-02/register/page.tsx");
  assert.match(signup, /await getPublicCommunityEvents\(\)/);
  assert.match(signup, /event\.registration\?\.status === "Open" && event\.status !== "Ended"/);
  const search = await source("app/api/search/route.ts");
  assert.match(search, /getPublicCommunityEvents\(\)/);
  assert.match(search, /searchSite\(products, query, events\)/);
});
