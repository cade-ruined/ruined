import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration03 = "db/migrations/20260915161147_byob_03_registration.sql";

async function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(await source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)((name) => {
    if (name === "server-only") return {};
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}

async function fixture(t, { migrate03 = true } = {}) {
  // Run the actual public reader and registration writer against a local engine.
  // Fake process state and intercepted queries cannot reach a provider database.
  const db = new PGlite();
  t.after(() => db.close());
  const queries = [];
  function bridge(engine, inTransaction = false) {
    const sql = async (strings, ...values) => {
      const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      queries.push({ query, values, inTransaction });
      return (await engine.query(query, values)).rows;
    };
    sql.begin = (callback) => engine.transaction((tx) => callback(bridge(tx, true)));
    return sql;
  }
  const sql = bridge(db);
  const model = await load("src/lib/events/byob-registration-model.ts");
  const gallery = await load("src/data/eventGalleries.ts");
  const events = await load("src/data/events.ts", {
    "@/data/eventGalleries": gallery, "@/lib/events/byob-registration-model": model,
  });
  const communityModel = await load("src/lib/events/community-event-model.ts", {
    "@/data/events": events, "@/lib/events/byob-registration-model": model,
  });
  const repository = await load("src/lib/events/community-event-repository.ts", {
    "@/data/events": events,
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/events/community-event-model": communityModel,
    "@/lib/events/byob-registration-model": model,
  }, { process: { env: { DATABASE_URL: "postgresql://isolated.invalid/test" } } });
  const writer = await load("src/lib/events/byob-registration-repository.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/events/community-event-repository": repository,
    "@/lib/events/byob-registration-model": model,
  });
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const immutable = foundation.match(/create or replace function ruined_reject_append_only_mutation\(\)[\s\S]*?\$\$;/)?.[0];
  const outbox = foundation.match(/create table if not exists integration_outbox \([\s\S]*?\n\);/)?.[0];
  assert.ok(immutable && outbox);
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table platform_users (auth_user_id uuid primary key); ${immutable} ${outbox}`);
  for (const name of ["20260821_byob_registration.sql", "20260821_byob_registration_v2.sql", "20260821_byob_registration_v3.sql"]) {
    await db.exec(await source(`db/migrations/${name}`));
  }
  // This is a test-only copy of the existing listing schema owned by the member
  // host. It adds no operator application dependency to the public release.
  await db.exec(await source("tests/fixtures/community-event-operations.sql"));
  if (migrate03) await db.exec(await source(migration03));
  const submission = (config) => model.parseByobRegistrationInput({
    firstName: "Casey", lastName: "Example", email: "casey@example.test",
    waiverAccepted: true, waiverVersion: config.waiverVersion,
  }, config);
  return { db, queries, model, repository, writer, submission };
}

const publish03 = (f) => f.db.exec("update community_event_listings set publication_state='published', event_state='Upcoming', registration_open=true where event_key='byob-03'");

test("public registration keeps the same email and its waiver evidence separate for Nº.02 and Nº.03", async (t) => {
  const f = await fixture(t);
  await publish03(f);
  await f.writer.registerByob02Participant(f.submission(f.model.BYOB_02_REGISTRATION));
  const original02 = (await f.db.query("select * from community_event_registrations where event_key='byob-02'")).rows;
  const outbox02 = (await f.db.query("select * from integration_outbox")).rows;
  await f.writer.registerByobParticipant(f.submission(f.model.BYOB_03_REGISTRATION), f.model.BYOB_03_REGISTRATION);
  const original03 = (await f.db.query("select * from community_event_registrations where event_key='byob-03'")).rows;
  await f.writer.registerByobParticipant({ ...f.submission(f.model.BYOB_03_REGISTRATION), registrantFirstName: "Changed", registrantName: "Changed Example" }, f.model.BYOB_03_REGISTRATION);
  assert.equal(original02.length, 1);
  assert.equal(original03.length, 1);
  assert.notEqual(original02[0].id, original03[0].id);
  assert.equal(original02[0].email_normalized, original03[0].email_normalized);
  assert.equal(original03[0].waiver_version, f.model.BYOB_03_WAIVER_VERSION);
  assert.equal(original03[0].waiver_acceptance_evidence.waiver_sha256, f.model.BYOB_03_WAIVER_SHA256);
  assert.deepEqual((await f.db.query("select * from community_event_registrations where event_key='byob-02'")).rows, original02);
  assert.deepEqual((await f.db.query("select * from community_event_registrations where event_key='byob-03'")).rows, original03);
  const outbox = (await f.db.query("select * from integration_outbox order by id")).rows;
  assert.deepEqual(outbox[0], outbox02[0], "enabling Nº.03 must not rewrite the original Nº.02 queue item");
  assert.equal(outbox02.length, 1);
  assert.equal(outbox.length, 2, "repeated Nº.03 submissions must not duplicate delivery");
  assert.deepEqual(outbox.map((row) => row.aggregate_id), [original02[0].id, original03[0].id]);
  for (const row of outbox) {
    assert.equal(row.destination, "google");
    assert.equal(row.event_type, "community_event_registration.sheet_sync_requested");
    assert.equal(row.dedupe_key, `google:community-event-registration:${row.aggregate_id}:created:v1`);
    assert.deepEqual(row.payload, {}, "legal evidence and email remain canonical, outside the queue payload");
  }
  const public03 = (await f.repository.getPublicCommunityEvents()).find((event) => event.id === "byob-03");
  assert.equal(public03.registration.href, "/community/byob-03/register");
  assert.equal(public03.registration.status, "Open");
  assert.doesNotMatch(JSON.stringify(public03), /casey@example|waiver_acceptance_evidence/);
  const lock = f.queries.find(({ query, values }) => /for share/.test(query) && values.includes("byob-03"));
  const write = f.queries.find(({ query, values }) => /insert into community_event_registrations/.test(query) && values.includes("byob-03"));
  assert.equal(lock.inTransaction, true);
  assert.equal(write.inTransaction, true);
  assert.ok(f.queries.indexOf(lock) < f.queries.indexOf(write));
});

test("the real public reader blocks draft, closed, archived, ended and missing Nº.03 listings", async (t) => {
  const f = await fixture(t);
  const submit = () => f.writer.registerByobParticipant(f.submission(f.model.BYOB_03_REGISTRATION), f.model.BYOB_03_REGISTRATION);
  const closed = (error) => error instanceof f.repository.CommunityEventRegistrationClosedError;
  for (const [publication, eventState, open] of [
    ["draft", "Upcoming", true], ["published", "Upcoming", false],
    ["archived", "Upcoming", true], ["published", "Ended", true],
  ]) {
    await f.db.query("update community_event_listings set publication_state=$1, event_state=$2, registration_open=$3 where event_key='byob-03'", [publication, eventState, open]);
    await assert.rejects(submit(), closed);
  }
  await f.db.exec("delete from community_event_listings where event_key='byob-03'");
  await assert.rejects(submit(), closed);
  assert.equal((await f.db.query("select count(*)::int as count from community_event_registrations")).rows[0].count, 0);
  assert.equal((await f.db.query("select count(*)::int as count from integration_outbox")).rows[0].count, 0);
});

test("Nº.03 migration preserves historical Nº.02 evidence and queues while creating an unpublished listing", async (t) => {
  const f = await fixture(t, { migrate03: false });
  await f.writer.registerByob02Participant(f.submission(f.model.BYOB_02_REGISTRATION));
  const legacy = await f.db.query(`insert into community_event_registrations (
    event_key, registrant_name, email_normalized, waiver_version, waiver_acceptance_evidence
  ) values ('byob-02', 'Historical Participant', 'historical@example.test', 'byob-02-risk-acknowledgment-v1',
    '{"affirmative_action":"required_checkbox","scope":"registrant_only","guest_count":1}'::jsonb) returning id`);
  await f.db.query("insert into community_event_registration_guests (registration_id, position, guest_name) values ($1, 1, 'Historical Guest')", [legacy.rows[0].id]);
  const before = {};
  for (const table of ["community_event_waiver_versions", "community_event_registrations", "community_event_registration_guests", "integration_outbox"]) {
    before[table] = (await f.db.query(`select * from ${table} order by 1, 2`)).rows;
  }
  const publicBefore = await f.repository.getPublicCommunityEvents();
  await f.db.exec(await source(migration03));
  await f.db.exec(await source(migration03));
  for (const table of Object.keys(before)) {
    const where = table === "community_event_waiver_versions" ? " where event_key='byob-02'" : "";
    assert.deepEqual((await f.db.query(`select * from ${table}${where} order by 1, 2`)).rows, before[table], table);
  }
  assert.deepEqual(await f.repository.getPublicCommunityEvents(), publicBefore);
  assert.deepEqual((await f.db.query("select publication_state, registration_mode from community_event_listings where event_key='byob-03'")).rows, [{ publication_state: "draft", registration_mode: "byob" }]);
  assert.deepEqual((await f.db.query("select title, body, content_sha256 from community_event_waiver_versions where event_key='byob-03' and version=$1", [f.model.BYOB_03_WAIVER_VERSION])).rows, [{ title: f.model.BYOB_03_WAIVER_TITLE, body: f.model.BYOB_03_WAIVER_BODY, content_sha256: f.model.BYOB_03_WAIVER_SHA256 }]);
});

test("the public writer and database reject cross-event waivers and incomplete Nº.03 evidence", async (t) => {
  const f = await fixture(t);
  await publish03(f);
  for (const waiverVersion of [f.model.BYOB_02_WAIVER_VERSION, "byob-03-risk-acknowledgment-v0"]) {
    await assert.rejects(f.writer.registerByobParticipant({ ...f.submission(f.model.BYOB_03_REGISTRATION), waiverVersion }, f.model.BYOB_03_REGISTRATION));
  }
  assert.equal((await f.db.query("select count(*)::int as count from community_event_registrations")).rows[0].count, 0);
  await f.writer.registerByobParticipant(f.submission(f.model.BYOB_03_REGISTRATION), f.model.BYOB_03_REGISTRATION);
  const original = (await f.db.query("select * from community_event_registrations")).rows;
  for (const key of ["participant", "age_confirmation", "carpool_disclosure_presented", "waiver_sha256"]) {
    await assert.rejects(f.db.query("update community_event_registrations set waiver_acceptance_evidence=waiver_acceptance_evidence - $1::text", [key]), /check constraint/);
  }
  await assert.rejects(f.db.exec("update community_event_registrations set registrant_first_name=null, registrant_last_name=null"), /check constraint/);
  await assert.rejects(f.db.query("update community_event_registrations set waiver_version=$1", [f.model.BYOB_02_WAIVER_VERSION]), /foreign key constraint/);
  await assert.rejects(f.db.exec("update community_event_waiver_versions set title='Changed' where event_key='byob-03'"), /append-only/);
  assert.deepEqual((await f.db.query("select * from community_event_registrations")).rows, original);
  assert.equal((await f.db.query("select count(*)::int as count from integration_outbox")).rows[0].count, 1);
});

test("Nº.03 migration keeps attendee data private and admits only the two configured native event keys", async (t) => {
  const f = await fixture(t);
  const privileges = await f.db.query(`select c.relname, c.relrowsecurity,
    has_table_privilege(r.role_name, c.oid, 'SELECT') as can_read,
    has_table_privilege(r.role_name, c.oid, 'INSERT,UPDATE,DELETE') as can_write
    from pg_class c cross join (values ('anon'), ('authenticated')) r(role_name)
    where c.relname in ('community_event_waiver_versions','community_event_registrations',
      'community_event_registration_guests','community_event_registration_rate_limits',
      'community_event_listings','community_event_attendance_events')`);
  assert.equal(privileges.rows.length, 12);
  for (const row of privileges.rows) {
    assert.equal(row.relrowsecurity, true, row.relname);
    assert.equal(row.can_read, false, row.relname);
    assert.equal(row.can_write, false, row.relname);
  }
  await assert.rejects(f.db.exec("update community_event_listings set event_key='byob-04' where event_key='byob-03'"), /check constraint/);
  assert.equal(f.model.getByobRegistrationConfig("byob-04"), null);
});
