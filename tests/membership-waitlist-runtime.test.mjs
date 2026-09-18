import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migrationPath = "db/migrations/20260914225359_membership_waitlist.sql";

async function load(path, dependencies = {}, globals = {}) {
  const compiled = ts.transpileModule(await source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports, ...Object.values(globals));
  return cjsModule.exports;
}

const model = await load("src/lib/membership/waitlist-model.ts");
const originalInput = { name: "  Test   Person  ", email: "  TEST@EXAMPLE.TEST  ", phone: "+1 (555) 010-2020" };

async function databaseFixture(t) {
  const PGlite = await loadPGliteForSchemaChecks();
  // Always in memory. This fixture cannot read or connect to DATABASE_URL.
  const db = new PGlite();
  t.after(() => db.close());
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const outbox = foundation.match(/create table if not exists integration_outbox \([\s\S]*?\n\);/);
  assert.ok(outbox, "load the real existing outbox table");
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role waitlist_public_probe nologin;
    grant usage on schema public to public;
    alter default privileges in schema public grant all on tables to public, anon, authenticated;
    alter default privileges in schema public grant all on sequences to public, anon, authenticated;
    ${outbox[0]}
  `);
  await db.exec(await source(migrationPath));
  function wrap(engine) {
    const sql = async (strings, ...values) => (await engine.query(
      strings.reduce((query, part, index) => query + (index ? `$${index}` : "") + part, ""), values,
    )).rows;
    sql.begin = (callback) => engine.transaction((tx) => callback(wrap(tx)));
    return sql;
  }
  const repository = await load("src/lib/membership/waitlist-repository.ts", {
    "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => wrap(db) },
  });
  return { db, ...repository };
}

test("waitlist input normalizes contact details and rejects malformed or oversized fields", () => {
  assert.deepEqual(model.parseMembershipWaitlistInput(originalInput), {
    name: "Test Person", emailNormalized: "test@example.test", phone: "+1 (555) 010-2020",
  });
  for (const phone of [undefined, null, "", "   "]) {
    assert.equal(model.parseMembershipWaitlistInput({ ...originalInput, phone }).phone, null);
  }
  for (const value of [null, [], 1, "name", {},
    { ...originalInput, name: "   " }, { ...originalInput, name: "a".repeat(101) },
    { ...originalInput, name: "Line\nBreak" }, { ...originalInput, email: "test@example.test\r" },
    { ...originalInput, email: "invalid" }, { ...originalInput, email: "one@@example.test" },
    { ...originalInput, email: `${"a".repeat(250)}@x.test` },
    { ...originalInput, email: ["test@example.test"] },
    ...[123, {}, "abc", "123456", "1234567890123456", "+1 555 123 4567 ext 2", "555" + " ".repeat(35) + "1234"].map((phone) => ({ ...originalInput, phone })),
  ]) assert.equal(model.parseMembershipWaitlistInput(value), null, JSON.stringify(value));
});

test("the full waitlist migration revokes public access and RLS denies accidental grants", async (t) => {
  const { db, joinMembershipWaitlist } = await databaseFixture(t);
  await joinMembershipWaitlist(model.parseMembershipWaitlistInput(originalInput));
  await db.query("insert into membership_waitlist_rate_limits values ($1, now(), 1)", ["a".repeat(64)]);
  const tables = ["membership_waitlist", "membership_waitlist_rate_limits"];
  const rls = await db.query("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)", [tables]);
  assert.equal(rls.rows.length, 2);
  assert.ok(rls.rows.every((row) => row.relrowsecurity));
  for (const role of ["anon", "authenticated", "waitlist_public_probe"]) {
    for (const table of tables) {
      const acl = await db.query(`select
        has_table_privilege($1, $2, 'SELECT') as read,
        has_table_privilege($1, $2, 'INSERT') as insert,
        has_table_privilege($1, $2, 'UPDATE') as update,
        has_table_privilege($1, $2, 'DELETE') as delete,
        has_table_privilege($1, $2, 'TRUNCATE') as truncate
      `, [role, `public.${table}`]);
      assert.ok(Object.values(acl.rows[0]).every((allowed) => allowed === false));
    }
    const sequence = await db.query("select has_sequence_privilege($1, 'public.membership_waitlist_sheet_row_seq', 'USAGE') as usage", [role]);
    assert.equal(sequence.rows[0].usage, false);
    await db.exec(`set role ${role}`);
    try {
      for (const table of tables) {
        for (const query of [`select * from ${table}`, `insert into ${table} default values`, `update ${table} set ${table === "membership_waitlist" ? "name = name" : "attempts = attempts"}`, `delete from ${table}`]) {
          await assert.rejects(() => db.query(query), (error) => error.code === "42501");
        }
      }
      await assert.rejects(() => db.query("select nextval('public.membership_waitlist_sheet_row_seq')"), (error) => error.code === "42501");
    } finally { await db.exec("reset role"); }
  }

  for (const role of ["anon", "authenticated"]) {
    await db.exec(`grant select, insert, update, delete on membership_waitlist, membership_waitlist_rate_limits to ${role}; grant usage on sequence membership_waitlist_sheet_row_seq to ${role}; set role ${role}`);
    try {
      assert.deepEqual((await db.query("select * from membership_waitlist")).rows, []);
      assert.deepEqual((await db.query("select * from membership_waitlist_rate_limits")).rows, []);
      await assert.rejects(() => db.query("insert into membership_waitlist (name, email_normalized) values ('Another person', 'another@example.test')"), (error) => error.code === "42501");
      await assert.rejects(() => db.query("insert into membership_waitlist_rate_limits values ($1, now(), 1)", ["d".repeat(64)]), (error) => error.code === "42501");
      assert.deepEqual((await db.query("update membership_waitlist set name = 'Changed' returning id")).rows, []);
      assert.deepEqual((await db.query("delete from membership_waitlist returning id")).rows, []);
      assert.deepEqual((await db.query("update membership_waitlist_rate_limits set attempts = 2 returning fingerprint_hash")).rows, []);
      assert.deepEqual((await db.query("delete from membership_waitlist_rate_limits returning fingerprint_hash")).rows, []);
    } finally {
      await db.exec(`reset role; revoke all on membership_waitlist, membership_waitlist_rate_limits from ${role}; revoke all on sequence membership_waitlist_sheet_row_seq from ${role}`);
    }
  }
  assert.equal((await db.query("select name from membership_waitlist")).rows[0].name, "Test Person");
});

test("repository deduplication preserves the original details and atomically creates exactly one outbox event", async (t) => {
  const { db, joinMembershipWaitlist } = await databaseFixture(t);
  const original = model.parseMembershipWaitlistInput(originalInput);
  await joinMembershipWaitlist(original);
  const first = (await db.query("select * from membership_waitlist")).rows[0];
  assert.equal(Number(first.sheet_row), 2);
  assert.equal(first.name, original.name);
  assert.equal(first.email_normalized, original.emailNormalized);
  assert.equal(first.phone, original.phone);
  assert.ok(first.created_at);
  const duplicate = model.parseMembershipWaitlistInput({ name: "Changed name", email: "TEST@example.test", phone: "5551234567" });
  await joinMembershipWaitlist(duplicate);
  // PGlite serializes transactions; this tests repeated competing calls, not a
  // production multi-connection concurrency simulation.
  await Promise.all([joinMembershipWaitlist(duplicate), joinMembershipWaitlist(duplicate)]);
  assert.deepEqual((await db.query("select * from membership_waitlist")).rows, [first]);
  const events = (await db.query("select * from integration_outbox")).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].destination, "google");
  assert.equal(events[0].event_type, "membership_waitlist.sheet_sync_requested");
  assert.equal(events[0].aggregate_type, "membership_waitlist");
  assert.equal(events[0].aggregate_id, first.id);
  assert.deepEqual(events[0].payload, {}, "the queue carries a reference, not contact details");
  assert.equal(events[0].status, "pending");
  await joinMembershipWaitlist({ ...original, emailNormalized: "second@example.test" });
  assert.equal(Number((await db.query("select sheet_row from membership_waitlist where email_normalized = 'second@example.test'")).rows[0].sheet_row), 3, "normal retries do not consume spreadsheet rows");
  await db.exec(`create function reject_test_outbox() returns trigger language plpgsql as $$
    begin raise exception 'Test-only outbox failure'; end $$;
    create trigger reject_test_outbox before insert on integration_outbox for each row execute function reject_test_outbox();`);
  await assert.rejects(() => joinMembershipWaitlist({ ...original, emailNormalized: "failed@example.test" }), /Test-only outbox failure/);
  assert.equal((await db.query("select count(*)::integer as count from membership_waitlist")).rows[0].count, 2);
  assert.equal((await db.query("select count(*)::integer as count from integration_outbox")).rows[0].count, 2);
  assert.deepEqual((await db.query("select * from membership_waitlist where email_normalized = 'failed@example.test'")).rows, []);
});

test("the database constrains invalid contact details and the rate limiter permits eight attempts per window", async (t) => {
  const { db, consumeMembershipWaitlistRateLimit } = await databaseFixture(t);
  for (const [name, email, phone] of [
    ["", "valid@example.test", null], [" padded ", "valid@example.test", null],
    ["a".repeat(101), "valid@example.test", null], ["Valid", "UPPER@example.test", null],
    ["Valid", "bad-address", null], ["Valid", "valid@example.test", "123456"],
    ["Valid", "valid@example.test", "letters"], ["Valid", "valid@example.test", "1".repeat(16)],
  ]) {
    await assert.rejects(() => db.query("insert into membership_waitlist (name, email_normalized, phone) values ($1,$2,$3)", [name, email, phone]), (error) => error.code === "23514");
  }
  const fingerprint = "a".repeat(64);
  await db.query("insert into membership_waitlist_rate_limits values ($1, now() - interval '49 hours', 8), ($2, now() - interval '47 hours', 1)", ["b".repeat(64), "c".repeat(64)]);
  assert.equal(await consumeMembershipWaitlistRateLimit("not-a-fingerprint"), false);
  for (let i = 0; i < 8; i += 1) assert.equal(await consumeMembershipWaitlistRateLimit(fingerprint), true);
  assert.equal(await consumeMembershipWaitlistRateLimit(fingerprint), false);
  assert.equal(await consumeMembershipWaitlistRateLimit(fingerprint), false);
  assert.equal((await db.query("select attempts from membership_waitlist_rate_limits where fingerprint_hash = $1", [fingerprint])).rows[0].attempts, 8);
  assert.deepEqual((await db.query("select * from membership_waitlist_rate_limits where fingerprint_hash = $1", ["b".repeat(64)])).rows, []);
  assert.equal((await db.query("select count(*)::integer as count from membership_waitlist_rate_limits where fingerprint_hash = $1", ["c".repeat(64)])).rows[0].count, 1);
  assert.equal(await consumeMembershipWaitlistRateLimit("d".repeat(64)), true);
  await db.query("update membership_waitlist_rate_limits set window_started_at = date_trunc('hour', now()) - interval '1 hour' where fingerprint_hash = $1", [fingerprint]);
  assert.equal(await consumeMembershipWaitlistRateLimit(fingerprint), true);
});

async function apiFixture(options = {}) {
  const calls = { fingerprints: [], saved: [], deferred: [], sync: [], errors: [] };
  const settings = {
    env: { COMMUNICATION_RATE_LIMIT_SECRET: "isolated-test-secret", DATABASE_URL: "test-only-never-connected" },
    rateAllowed: true, ...options,
  };
  const route = await load("app/api/members/waitlist/route.ts", {
    "node:crypto": { createHmac },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) }, after: (callback) => calls.deferred.push(callback) },
    "@/lib/auth/request": { isTrustedPlatformOrigin: (request) => request.headers.get("origin") === "https://ruined.example" },
    "@/lib/membership/waitlist-model": model,
    "@/lib/membership/waitlist-repository": {
      consumeMembershipWaitlistRateLimit: async (fingerprint) => {
        calls.fingerprints.push(fingerprint);
        if (settings.rateError) throw settings.rateError;
        return settings.rateAllowed;
      },
      joinMembershipWaitlist: async (submission) => {
        if (settings.saveError) throw settings.saveError;
        calls.saved.push(submission);
      },
    },
    "@/lib/membership/waitlist-sheet-sync": { processMembershipWaitlistSheetOutboxBatch: async (size) => {
      calls.sync.push(size);
      if (settings.syncError) throw settings.syncError;
      return {};
    } },
  }, { process: { env: settings.env }, console: { error: (message) => calls.errors.push(message) } });
  const post = (body = originalInput, headers = {}, raw = false) => route.POST(new Request("https://ruined.example/api/members/waitlist", {
    method: "POST", headers: { origin: "https://ruined.example", "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers },
    body: raw ? body : JSON.stringify(body),
  }));
  return { calls, settings, post, route };
}

test("the API validates origin, JSON, body bounds, and fields before reaching persistence", async () => {
  const { post, calls } = await apiFixture();
  const cases = [
    [originalInput, { origin: "https://untrusted.example" }, false, 403],
    [originalInput, { origin: "" }, false, 403],
    [originalInput, { "content-type": "text/plain" }, false, 415],
    [originalInput, { "content-length": "4097" }, false, 413],
    [" ".repeat(4097), {}, true, 413],
    [" ".repeat(4097), { "content-length": "10" }, true, 413],
    ["{", {}, true, 400], [null, {}, false, 400], [[], {}, false, 400],
    [{ ...originalInput, email: "bad" }, {}, false, 400],
    [{ ...originalInput, name: " " }, {}, false, 400],
    [{ ...originalInput, phone: "not a phone" }, {}, false, 400],
  ];
  for (const [body, headers, raw, status] of cases) {
    const response = await post(body, headers, raw);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await response.json()).ok, undefined);
  }
  assert.deepEqual(calls.saved, []);
  assert.deepEqual(calls.fingerprints, []);
  assert.deepEqual(calls.deferred, []);
});

test("the honeypot returns the neutral confirmation without reading configuration or calling the database", async () => {
  const { post, calls } = await apiFixture({ env: {} });
  const response = await post({ website: "https://bot.example", name: "", email: "invalid" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(calls.saved, []);
  assert.deepEqual(calls.fingerprints, []);
  assert.deepEqual(calls.deferred, []);
});

test("successful requests store normalized data, hash the address, and tolerate deferred sheet failure", async () => {
  const { post, calls } = await apiFixture({ syncError: new Error("Google unavailable") });
  const response = await post(originalInput, { "content-type": "application/json; charset=utf-8" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(calls.saved, [model.parseMembershipWaitlistInput(originalInput)]);
  assert.match(calls.fingerprints[0], /^[a-f0-9]{64}$/);
  assert.equal(calls.fingerprints[0].includes("203.0.113.9"), false);
  assert.equal(calls.deferred.length, 1);
  assert.deepEqual(calls.sync, []);
  await assert.doesNotReject(calls.deferred[0]);
  assert.deepEqual(calls.sync, [3]);
  assert.equal(calls.errors.length, 1);
  assert.doesNotMatch(calls.errors[0], /test@example|Google unavailable|203\.0\.113/);
});

test("rate denial and persistence failures never return success or schedule a sheet write", async () => {
  for (const [options, expectedStatus] of [
    [{ rateAllowed: false }, 429],
    [{ rateError: new Error("database private detail") }, 503],
    [{ saveError: new Error("database private detail") }, 503],
    [{ env: {} }, 503],
    [{ env: { DATABASE_URL: "test-only-never-connected" } }, 503],
    [{ env: { COMMUNICATION_RATE_LIMIT_SECRET: "isolated-test-secret" } }, 503],
  ]) {
    const { post, calls } = await apiFixture(options);
    const response = await post();
    assert.equal(response.status, expectedStatus);
    const body = await response.json();
    assert.equal(body.ok, undefined);
    assert.ok(body.error);
    assert.doesNotMatch(body.error, /private detail/);
    if (expectedStatus === 429) assert.equal(response.headers.get("Retry-After"), "3600");
    assert.deepEqual(calls.saved, []);
    assert.deepEqual(calls.deferred, []);
  }
});
