import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks, supportMigrationUrl } from "../scripts/check-support-schema.mjs";
import { taggedDatabase } from "../scripts/check-support-repository.mjs";

async function load(path, dependencies = {}) {
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports;
}

const policy = await load("src/lib/support/delivery-policy.ts");
const emailModel = await load("src/lib/support/email-model.ts");

test("a failed row with no send evidence is still not proof that manual resend is safe", () => {
  for (const status of ["failed", "dead_letter", "processing"]) {
    const state = policy.supportDeliveryState({ status, attempts: 0, first_attempt_at: null, last_error: null });
    assert.equal(state.key, "review_delivery");
    assert.equal(state.canRetry, false);
  }
});

async function fixture() {
  const PGlite = await loadPGliteForSchemaChecks();
  const pg = new PGlite();
  const ids = Object.fromEntries(["auth", "person", "ticket", "message", "delivery"].map((key) => [key, crypto.randomUUID()]));
  await pg.exec(`
    create role anon nologin; create role authenticated nologin;
    create table people(id uuid primary key, status text);
    create table platform_users(auth_user_id uuid primary key, person_id uuid, email_normalized text, status text);
    create table person_email_addresses(id uuid primary key default gen_random_uuid(), person_id uuid, email_normalized text, verification_state text, retired_at timestamptz);
  `);
  await pg.exec(await readFile(supportMigrationUrl, "utf8"));
  await pg.query("insert into people values($1,'active')", [ids.person]);
  await pg.query("insert into platform_users values($1,$2,'member@example.test','active')", [ids.auth, ids.person]);
  await pg.query("insert into person_email_addresses(person_id,email_normalized,verification_state) values($1,'member@example.test','verified')", [ids.person]);
  await pg.query("insert into support_tickets(id,requester_auth_user_id,requester_email,requester_name,category,subject,request_key,request_fingerprint) values($1,$2,'member@example.test','Member','circle','Circle help',$3,'fixture')", [ids.ticket, ids.auth, crypto.randomUUID()]);
  await pg.query("insert into support_messages(id,ticket_id,author_auth_user_id,author_type,body,request_key) values($1,$2,$3,'member','Circle question',$4)", [ids.message, ids.ticket, ids.auth, crypto.randomUUID()]);
  await pg.query("insert into support_email_deliveries(id,ticket_id,message_id,audience) values($1,$2,$3,'operator')", [ids.delivery, ids.ticket, ids.message]);
  const sql = taggedDatabase(pg);
  const sends = [];
  const responses = [];
  const faults = [];
  const db = (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ");
    const index = faults.findIndex((pattern) => query.includes(pattern));
    if (index >= 0) { faults.splice(index, 1); throw new Error("Injected database failure, not a network call"); }
    return sql(strings, ...values);
  };
  const row = async () => (await pg.query("select * from support_email_deliveries where id=$1", [ids.delivery])).rows[0];
  const worker = await load("src/lib/support/delivery.ts", {
    "server-only": {}, "node:crypto": crypto,
    "@/lib/database/server": { getApplicationDatabase: () => db },
    "@/lib/support/delivery-policy": policy,
    "@/lib/support/email-model": emailModel,
    "@/lib/support/model": { SUPPORT_EMAIL: "connect@theruinedproject.com" },
    resend: { Resend: class { emails = { send: async (payload, options) => {
      // The actual SQL must have committed its fence before the provider call.
      const beforeSend = await row();
      assert.equal(beforeSend.last_error, "uncertain:send_in_flight");
      assert.equal(beforeSend.status, "processing");
      assert.ok(beforeSend.first_attempt_at);
      sends.push({ payload, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response ? { data: null, error: response } : { data: { id: "accepted-test-id" }, error: null };
    } }; } },
  });
  const settings = { SUPPORT_EMAIL_ENABLED: "true", RESEND_API_KEY: "fake-no-network", RESEND_FROM_EMAIL: "Ruined <connect@theruinedproject.com>", NEXT_PUBLIC_SITE_URL: "https://ruined.example", NODE_ENV: "test" };
  const original = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  return { pg, ids, sends, responses, faults, row, worker,
    due: () => pg.query("update support_email_deliveries set available_at=now()-interval '1 minute' where id=$1", [ids.delivery]),
    tomorrow: () => pg.query("update support_email_deliveries set first_attempt_at=now()-interval '25 hours', available_at=now()-interval '1 minute', locked_at=now()-interval '25 hours' where id=$1", [ids.delivery]),
    close: async () => {
      for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await pg.close();
    },
  };
}

test("real queue retries a confirmed rejection on the next daily run without extending any ambiguous replay window", async () => {
  const f = await fixture();
  try {
    f.responses.push({ statusCode: 429, name: "rate_limit_exceeded" });
    assert.equal((await f.worker.processSupportEmailBatch()).failed, 1);
    assert.equal((await f.row()).last_error, "not_sent:provider_http_429");
    await f.tomorrow();
    assert.equal((await f.worker.processSupportEmailBatch()).sent, 1);
    assert.equal(f.sends.length, 2);
    assert.equal(f.sends[0].options.idempotencyKey, f.sends[1].options.idempotencyKey);
    assert.ok(Date.now() - new Date((await f.row()).first_attempt_at).getTime() < 10_000);
  } finally { await f.close(); }
});

test("old unknown sends and legacy stale processing are held without a second provider call", async () => {
  const f = await fixture();
  try {
    f.responses.push(new Error("Network disconnected after request; result unknown"));
    await f.worker.processSupportEmailBatch();
    assert.equal((await f.row()).last_error, "uncertain:delivery_unavailable");
    await f.tomorrow();
    assert.equal((await f.worker.processSupportEmailBatch()).deadLetter, 1);
    assert.equal(f.sends.length, 1);
    for (const [status, error] of [["processing", "uncertain:send_in_flight"], ["processing", null], ["failed", "provider_http_500"]]) {
      await f.pg.query("update support_email_deliveries set status=$1,last_error=$2,attempts=1 where id=$3", [status, error, f.ids.delivery]);
      await f.tomorrow();
      assert.equal((await f.worker.processSupportEmailBatch()).deadLetter, 1);
      assert.equal(f.sends.length, 1);
      assert.equal(policy.supportDeliveryState(await f.row()).canRetry, false);
    }
  } finally { await f.close(); }
});

test("preflight failure before a provider call is recoverable after the daily interval", async () => {
  const f = await fixture();
  try {
    f.faults.push("select ticket.id as ticket_id");
    assert.equal((await f.worker.processSupportEmailBatch()).failed, 1);
    assert.equal(f.sends.length, 0);
    assert.equal((await f.row()).last_error, "not_sent:delivery_unavailable");
    await f.tomorrow();
    assert.equal((await f.worker.processSupportEmailBatch()).sent, 1);
  } finally { await f.close(); }
});

test("provider acceptance followed by a lost database acknowledgement retains its protected replay key", async () => {
  const f = await fixture();
  try {
    f.faults.push("set status = 'sent'");
    assert.equal((await f.worker.processSupportEmailBatch()).failed, 1);
    const failed = await f.row();
    assert.equal(failed.last_error, "uncertain:delivery_unavailable");
    await f.due();
    assert.equal((await f.worker.processSupportEmailBatch()).sent, 1);
    assert.equal(f.sends[0].options.idempotencyKey, f.sends[1].options.idempotencyKey);
    assert.equal(new Date((await f.row()).first_attempt_at).getTime(), new Date(failed.first_attempt_at).getTime());
  } finally { await f.close(); }
});

test("a later rate-limit rejection cannot erase uncertainty from an earlier send", async () => {
  const f = await fixture();
  try {
    f.responses.push({ statusCode: 500 }, { statusCode: 429 });
    await f.worker.processSupportEmailBatch();
    await f.due();
    await f.worker.processSupportEmailBatch();
    assert.equal((await f.row()).last_error, "uncertain:provider_http_429");
    await f.tomorrow();
    assert.equal((await f.worker.processSupportEmailBatch()).deadLetter, 1);
    assert.equal(f.sends.length, 2);
  } finally { await f.close(); }
});

test("a known-rejected send still stops after five automatic attempts", async () => {
  const f = await fixture();
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      f.responses.push({ statusCode: 429 });
      await f.due();
      await f.worker.processSupportEmailBatch();
    }
    assert.equal((await f.row()).status, "dead_letter");
    assert.equal((await f.row()).attempts, 5);
    assert.equal(policy.supportDeliveryState(await f.row()).canRetry, true);
    assert.equal((await f.worker.processSupportEmailBatch()).claimed, 0);
    assert.equal(f.sends.length, 5);
  } finally { await f.close(); }
});
