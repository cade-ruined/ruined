import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
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

async function fixture(t, { schema = true, configured = true, fail = false } = {}) {
  // Isolated engine and explicit fake environment. Never connect to a provider
  // or use the developer's DATABASE_URL. The member host owns schema migrations.
  const db = new PGlite();
  t.after(() => db.close());
  const queries = [];
  function bridge(engine, inTransaction = false) {
    const sql = async (strings, ...values) => {
      const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      queries.push({ query, inTransaction });
      if (fail) throw new Error("Configured database unavailable");
      return (await engine.query(query, values)).rows;
    };
    sql.begin = (callback) => engine.transaction((tx) => callback(bridge(tx, true)));
    return sql;
  }
  const sql = bridge(db);
  const byobModel = await load("src/lib/events/byob-registration-model.ts");
  const gallery = await load("src/data/eventGalleries.ts");
  const events = await load("src/data/events.ts", {
    "@/data/eventGalleries": gallery, "@/lib/events/byob-registration-model": byobModel,
  });
  const model = await load("src/lib/events/community-event-model.ts", { "@/data/events": events });
  const repository = await load("src/lib/events/community-event-repository.ts", {
    "@/data/events": events,
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/events/community-event-model": model,
  }, { process: { env: configured ? { DATABASE_URL: "isolated" } : {} } });
  const byob = await load("src/lib/events/byob-registration-repository.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/events/community-event-repository": repository,
    "@/lib/events/byob-registration-model": byobModel,
  });
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const immutable = foundation.match(/create or replace function ruined_reject_append_only_mutation\(\)[\s\S]*?\$\$;/)?.[0];
  const outbox = foundation.match(/create table if not exists integration_outbox \([\s\S]*?\n\);/)?.[0];
  assert.ok(immutable && outbox);
  await db.exec(`create role anon; create role authenticated; create role service_role; ${immutable} ${outbox}`);
  for (const file of ["20260821_byob_registration.sql", "20260821_byob_registration_v2.sql", "20260821_byob_registration_v3.sql"]) {
    await db.exec(await source(`db/migrations/${file}`));
  }
  if (schema) {
    // Consumer contract only; migration permissions/constraints are verified in
    // the member/operator release, not recreated by this public-site deployment.
    await db.exec(`create table community_event_listings (
      event_key text primary key, title text, eyebrow text, starts_at timestamptz,
      timezone text, location text, admission text, summary text, image_path text,
      video_path text, video_poster_path text, publication_state text,
      event_state text, registration_mode text, registration_url text,
      registration_open boolean, version integer, private_note text
    ); alter table community_event_listings enable row level security;`);
    for (const event of model.legacyCommunityEventRecords()) {
      await db.query(`insert into community_event_listings values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,1,'never expose this')`, [
        event.eventKey, event.title, event.eyebrow, event.startsAt, event.timezone,
        event.location, event.admission, event.summary, event.imagePath, event.videoPath,
        event.videoPosterPath, event.publicationState, event.eventState,
        event.registrationMode, event.registrationUrl, event.registrationOpen,
      ]);
    }
  }
  const submission = byobModel.parseByob02RegistrationInput({
    firstName: "Casey", lastName: "Example", email: "casey@example.test",
    waiverAccepted: true, waiverVersion: byobModel.BYOB_02_WAIVER_VERSION,
  });
  return { db, sql, queries, repository, byob, submission, events, model };
}

test("canonical listings retain exact legacy labels/gallery while filtering private fields", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.repository.getPublicCommunityEvents(), f.events.EVENTS);
  const updated = "Updated from operations";
  await f.db.query("update community_event_listings set title=$1 where event_key='byob-02'", [updated]);
  const publicEvents = await f.repository.getPublicCommunityEvents();
  assert.equal(publicEvents.find((event) => event.id === "byob-02").title, updated);
  assert.doesNotMatch(JSON.stringify(publicEvents), /never expose|private_note|version|email_normalized/);
});

test("draft/archived and intentionally empty published sets never revive static defaults", async (t) => {
  const f = await fixture(t);
  await f.db.exec("update community_event_listings set publication_state='draft' where event_key='byob-02'");
  assert.deepEqual((await f.repository.getPublicCommunityEvents()).map((event) => event.id), ["byob-01"]);
  await f.db.exec("update community_event_listings set publication_state='archived'");
  assert.deepEqual(await f.repository.getPublicCommunityEvents(), []);
});

test("an unconfigured public host preserves static events without opening a connection", async (t) => {
  const f = await fixture(t, { configured: false, fail: true });
  assert.deepEqual(await f.repository.getPublicCommunityEvents(), f.events.EVENTS);
  assert.equal(f.queries.length, 0);
});

test("legacy schema fallback is permitted, but configured failures reject feed and registration", async (t) => {
  const legacy = await fixture(t, { schema: false });
  assert.deepEqual(await legacy.repository.getPublicCommunityEvents(), legacy.events.EVENTS);
  await legacy.byob.registerByob02Participant(legacy.submission);
  assert.equal((await legacy.db.query("select count(*)::int as count from community_event_registrations")).rows[0].count, 1);
  const broken = await fixture(t, { fail: true });
  await assert.rejects(broken.repository.getPublicCommunityEvents(), /Configured database unavailable/);
  await assert.rejects(broken.byob.registerByob02Participant(broken.submission), /Configured database unavailable/);
});

test("registration checks a share-locked listing inside the same transaction before persistence", async (t) => {
  const f = await fixture(t);
  await f.byob.registerByob02Participant(f.submission);
  const lockIndex = f.queries.findIndex(({ query }) => /for share/.test(query));
  const writeIndex = f.queries.findIndex(({ query }) => /insert into community_event_registrations/.test(query));
  assert.ok(lockIndex >= 0 && writeIndex > lockIndex);
  assert.equal(f.queries[lockIndex].inTransaction, true);
  assert.equal(f.queries[writeIndex].inTransaction, true);
  const rows = (await f.db.query("select * from community_event_registrations")).rows;
  const queued = (await f.db.query("select * from integration_outbox")).rows;
  await f.byob.registerByob02Participant(f.submission);
  assert.deepEqual((await f.db.query("select * from community_event_registrations")).rows, rows);
  assert.deepEqual((await f.db.query("select * from integration_outbox")).rows, queued);
  assert.equal(rows.length, 1);
  assert.equal(queued.length, 1);
});

test("closing/hiding/ending BYOB blocks the next submission without consent or outbox writes", async (t) => {
  const f = await fixture(t);
  for (const state of [
    { publication: "published", event: "Upcoming", mode: "byob", open: false },
    { publication: "archived", event: "Upcoming", mode: "byob", open: true },
    { publication: "draft", event: "Upcoming", mode: "byob", open: true },
    { publication: "published", event: "Ended", mode: "byob", open: true },
    { publication: "published", event: "Upcoming", mode: "none", open: true },
  ]) {
    await f.db.query(`update community_event_listings set publication_state=$1,
      event_state=$2, registration_mode=$3, registration_open=$4 where event_key='byob-02'`,
    [state.publication, state.event, state.mode, state.open]);
    await assert.rejects(f.byob.registerByob02Participant(f.submission),
      (error) => error instanceof f.repository.CommunityEventRegistrationClosedError);
  }
  await f.db.exec("delete from community_event_listings where event_key='byob-02'");
  await assert.rejects(f.byob.registerByob02Participant(f.submission), /Registration is closed/);
  assert.equal((await f.db.query("select count(*)::int as count from community_event_registrations")).rows[0].count, 0);
  assert.equal((await f.db.query("select count(*)::int as count from integration_outbox")).rows[0].count, 0);
});

test("public feed endpoint marks empty data authoritative and outages no-store 503", async () => {
  const response = { json: (body, options = {}) => ({ body, ...options }) };
  const errors = [];
  for (const fail of [false, true]) {
    const route = await load("app/api/community/events/route.ts", {
      "next/server": { NextResponse: response },
      "@/lib/events/community-event-repository": { getPublicCommunityEvents: async () => {
        if (fail) throw new Error("private provider data");
        return [];
      } },
    }, { console: { error: (...args) => errors.push(args) } });
    const result = await route.GET();
    assert.equal(result.headers["Cache-Control"], "no-store");
    if (fail) assert.equal(result.status, 503);
    else assert.deepEqual(result.body, { events: [] });
  }
  assert.doesNotMatch(JSON.stringify(errors), /private provider data/);
});

test("search consumes authoritative listings and does not resurrect archived default events", async (t) => {
  const f = await fixture(t);
  const contract = await load("src/data/search-contract.ts");
  const search = await load("src/data/search.ts", { "@/data/events": f.events, "@/data/search-contract": contract });
  assert.ok(JSON.stringify(search.searchSite([], "byob", f.events.EVENTS)).includes("byob-02"));
  assert.ok(!JSON.stringify(search.searchSite([], "byob", [])).includes("byob-02"));
  const route = await source("app/api/search/route.ts");
  assert.match(route, /getPublicCommunityEvents\(\)/);
  assert.match(route, /searchSite\(products, query, events\)/);
});

test("all public entry points use the canonical source, without operator access or write dependencies", async () => {
  for (const path of ["src/components/ImmersiveParallax.tsx", "src/components/DesktopImmersiveParallax.tsx", "src/components/MobileImmersiveJourney.tsx", "src/components/events/EventsIndex.tsx"]) {
    const code = await source(path);
    assert.match(code, /usePublicEvents\(/);
    assert.doesNotMatch(code, /import \{ EVENTS/);
  }
  for (const path of ["app/community/page.tsx", "app/community/byob-02/register/page.tsx"]) {
    assert.match(await source(path), /await getPublicCommunityEvents\(\)/);
  }
  const signup = await source("app/community/byob-02/register/page.tsx");
  assert.match(signup, /event\.registration\?\.status === "Open" && event\.status !== "Ended"/);
  assert.match(await source("app/api/events/byob-02/register/route.ts"), /error instanceof CommunityEventRegistrationClosedError[\s\S]*?409/);
  const repository = await source("src/lib/events/community-event-repository.ts");
  assert.doesNotMatch(repository, /ops-operating|requireAdmin|saveCommunityEvent|getCommunityRoster|recordCommunityAttendance/);
});

test("client feed shares pending reads and fails closed instead of reusing static defaults", async () => {
  const effects = [];
  const updates = [];
  let requests = 0;
  let resolveRequest;
  const pending = new Promise((resolve) => { resolveRequest = resolve; });
  const hook = await load("src/lib/events/use-public-events.ts", {
    react: { useState: (initial) => [initial, (value) => updates.push(value)], useEffect: (fn) => effects.push(fn) },
  }, { fetch: () => { requests += 1; return pending; } });
  assert.deepEqual(hook.usePublicEvents(), []);
  assert.deepEqual(hook.usePublicEvents(), []);
  const cleanup = effects.map((effect) => effect());
  cleanup[0]();
  resolveRequest({ ok: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.deepEqual(updates, [[]], "unmounted consumers ignore late reads; mounted consumers clear unavailable events");
});
