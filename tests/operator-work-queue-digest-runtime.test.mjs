import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies = {}, globals = {}) {
  const compiled = ts.transpileModule(await read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "process", "Date", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, mod, mod.exports, globals.process ?? process, globals.Date ?? Date);
  return mod.exports;
}
const datetime = await load("src/lib/datetime/zoned-date-time.ts");
const model = await load("src/lib/platform/work-queue-digest-model.ts", { "@/lib/datetime/zoned-date-time": datetime });
const email = await load("src/lib/platform/work-queue-digest-email.ts", { "./work-queue-digest-model": model });
const emptyQueue = { items: [], totals: { tasks: 0, artifacts: 0, failures: 0 } };
const sampleQueue = { items: [{ kind: "task", taskType: "registration.billing_review", description: "PRIVATE TASK DESCRIPTION", workId: crypto.randomUUID(), memberId: crypto.randomUUID(), memberName: "Test Member", label: "Review membership billing", state: "open", dueAt: null, priority: 70 }], totals: { tasks: 1, artifacts: 0, failures: 0 } };

test("digest defaults to Denver daylight savings and retains explicit fixed MST scheduling", () => {
  assert.equal(model.workQueueDigestTimezone(), "America/Denver");
  assert.equal(model.workQueueDigestTimezone("MST"), null);
  assert.equal(model.workQueueDigestTimezone("America/Denver"), "America/Denver");
  assert.equal(model.workQueueDigestTimezone("Etc/GMT+7"), "Etc/GMT+7");
  assert.deepEqual(model.dueWorkQueueDigestSlots(new Date("2026-07-05T16:59:59Z"), "Etc/GMT+7"), []);
  assert.equal(model.dueWorkQueueDigestSlots(new Date("2026-07-05T17:00:00Z"), "Etc/GMT+7")[0].scheduledFor, "2026-07-05T17:00:00.000Z");
  assert.equal(model.dueWorkQueueDigestSlots(new Date("2026-07-05T16:00:00Z"), "America/Denver")[0].scheduledFor, "2026-07-05T16:00:00.000Z");
  assert.equal(model.dueWorkQueueDigestSlots(new Date("2026-12-05T17:00:00Z"), "America/Denver")[0].scheduledFor, "2026-12-05T17:00:00.000Z");
  assert.deepEqual(model.dueWorkQueueDigestSlots(new Date("2026-07-05T22:00:00Z"), "Etc/GMT+7").map((slot) => slot.localHour), [15]);
  assert.deepEqual(model.dueWorkQueueDigestSlots(new Date("2026-07-05T17:29:59Z"), "Etc/GMT+7").map((slot) => slot.localHour), [10]);
  assert.deepEqual(model.dueWorkQueueDigestSlots(new Date("2026-07-05T17:30:00Z"), "Etc/GMT+7"), []);
  assert.deepEqual(model.dueWorkQueueDigestSlots(new Date("2026-07-05T20:00:00Z"), "Etc/GMT+7"), [], "a 1pm cold start does not send the missed morning slot");
  assert.deepEqual(model.dueWorkQueueDigestSlots(new Date("2026-07-06T06:59:00Z"), "Etc/GMT+7"), []);
  assert.deepEqual(model.dueWorkQueueDigestSlots(new Date("2026-07-06T07:00:00Z"), "Etc/GMT+7"), []);
});

test("checkpoint digest items link to membership checkpoints without sending their detailed descriptions", () => {
  const slot = model.dueWorkQueueDigestSlots(new Date("2026-10-05T17:00:00Z"), "Etc/GMT+7")[0];
  const queue = { ...sampleQueue, items: sampleQueue.items.map(item => ({ ...item, taskType: "registration.checkpoint.information", label: "Complete registration information" })) };
  const result = email.createWorkQueueDigestEmail({ queue, slot, generatedAt: slot.scheduledFor });
  assert.match(result.text, /Complete registration information/);
  assert.match(result.html, /#membership/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE TASK DESCRIPTION/);
});

test("digest email escapes titles, uses the official wordmark, respects capped totals, and omits private fields", () => {
  const slot = model.dueWorkQueueDigestSlots(new Date("2026-10-05T17:00:00Z"), "Etc/GMT+7")[0];
  const queue = { items: [...sampleQueue.items.map((item) => ({ ...item, label: '<script>alert("title")</script>', notes: "PRIVATE NOTE", email: "PRIVATE CONTACT", card: "PRIVATE CARD" })), { kind: "workflow_failure", workId: "failure-1", label: "Review automation", memberName: null, memberId: null, state: "failed", dueAt: "2026-10-05T16:00:00Z", priority: 100, errorCode: "PRIVATE ERROR" }], totals: { tasks: 200, artifacts: 0, failures: 1 } };
  const result = email.createWorkQueueDigestEmail({ queue, slot, generatedAt: "2026-10-05T17:02:00Z" });
  assert.match(result.subject, /10:00 AM MST/);
  assert.match(result.html, /ruined-wordmark-email\.png/);
  assert.match(result.html, /&lt;script&gt;/);
  assert.doesNotMatch(result.html, /<script>/);
  assert.match(result.html, /200\+ tasks/);
  assert.match(result.text, /Updated Oct 5, 9:00 AM MST/);
  assert.match(result.html, /#membership/);
  for (const secret of ["PRIVATE NOTE", "PRIVATE CONTACT", "PRIVATE CARD", "PRIVATE ERROR", "PRIVATE TASK DESCRIPTION"]) assert.equal(JSON.stringify(result).includes(secret), false);
  const empty = email.createWorkQueueDigestEmail({ queue: emptyQueue, slot, generatedAt: slot.scheduledFor });
  assert.match(empty.text, /No open tasks/);
  assert.match(empty.html, /0 tasks · 0 Artifacts · 0 failed actions/);
});

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key,status text);
    create table platform_users(auth_user_id uuid primary key,person_id uuid references people,email_normalized text,status text);
    create table platform_role_grants(auth_user_id uuid references platform_users,role_slug text,revoked_at timestamptz);
    create table person_email_addresses(id uuid primary key default gen_random_uuid(),person_id uuid references people,email_normalized text,verification_state text,retired_at timestamptz);`);
  await db.exec(await read("db/migrations/20261005191000_operator_work_queue_digest.sql"));
  const auth = crypto.randomUUID(), person = crypto.randomUUID();
  await db.query("insert into people values($1,'active')", [person]);
  await db.query("insert into platform_users values($1,$2,'libby@theruinedproject.com','active')", [auth, person]);
  await db.query("insert into platform_role_grants values($1,'ops_admin',null)", [auth]);
  await db.query("insert into person_email_addresses(person_id,email_normalized,verification_state) values($1,'libby@theruinedproject.com','verified')", [person]);
  const clock = { now: Date.parse("2026-10-05T17:05:00Z") };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const env = { NODE_ENV: "production", VERCEL_ENV: "production", PLATFORM_MODE: "connected", OPERATOR_WORK_QUEUE_DIGEST_ENABLED: "true", OPERATOR_WORK_QUEUE_DIGEST_TIMEZONE: "Etc/GMT+7", RESEND_API_KEY: "no-network-test-key", RESEND_FROM_EMAIL: "Ruined <connect@theruinedproject.com>", NEXT_PUBLIC_SITE_URL: "https://members.theruinedproject.com" };
  const sends = [], responses = [], committed = [], faults = [], hooks = [], reads = [];
  let queue = structuredClone(sampleQueue), platformMode = "connected", transactionDepth = 0;
  function wrap(client) {
    const sql = async (strings, ...values) => {
      const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      const fault = faults.findIndex((pattern) => query.includes(pattern));
      if (fault >= 0) { faults.splice(fault, 1); throw new Error("Injected database acknowledgement failure"); }
      return (await client.query(query, values.map((value) => value instanceof Date ? value.toISOString() : value))).rows;
    };
    sql.json = JSON.stringify;
    sql.begin = async (operation) => {
      const result = await client.transaction(async (tx) => {
        transactionDepth++;
        try { return await operation(wrap(tx)); } finally { transactionDepth--; }
      });
      const snapshot = (await db.query("select * from operator_work_queue_digest_deliveries order by scheduled_for")).rows;
      committed.push(snapshot);
      if (snapshot.some((row) => row.status === "processing" && row.delivery_payload)) {
        const hook = hooks.shift();
        if (hook) await hook();
      }
      return result;
    };
    return sql;
  }
  const repo = await load("src/lib/platform/work-queue-digest-repository.ts", {
    "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => wrap(db) },
    "@/lib/datetime/zoned-date-time": datetime, "./work-queue-digest-model": model,
  });
  const worker = await load("src/lib/platform/work-queue-digest-delivery.ts", {
    "server-only": {}, "node:crypto": crypto, "./work-queue-digest-model": model, "./work-queue-digest-repository": repo,
    "./work-queue-digest-email": email, "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: platformMode }) },
    "@/lib/platform/ops-operating-repository": { getOpsWorkQueue: async (actor) => {
      assert.equal(transactionDepth, 0, "queue read cannot open a nested transaction while recipient locks occupy the pool");
      reads.push(actor); return queue;
    } },
    "@/lib/support/model": { SUPPORT_EMAIL: "connect@theruinedproject.com" },
    resend: { Resend: class { emails = { send: async (payload, options) => {
      const row = committed.at(-1).find((item) => options.idempotencyKey.endsWith(item.id));
      assert.ok(row.first_send_attempt_at, "fence committed before provider call");
      assert.deepEqual(row.delivery_payload, payload, "frozen payload committed before provider call");
      assert.equal(payload.to, "libby@theruinedproject.com");
      sends.push({ payload: structuredClone(payload), options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response ? { data: null, error: response } : { data: { id: `accepted-${sends.length}` }, error: null };
    } }; } },
  }, { process: { env }, Date: ClockDate });
  return { db, auth, person, clock, env, repo, worker, sends, responses, faults, hooks, reads,
    setQueue(value) { queue = value; }, setPlatformMode(value) { platformMode = value; },
    rows: async () => (await db.query("select * from operator_work_queue_digest_deliveries order by scheduled_for")).rows,
    due: async () => { clock.now += 6 * 60_000; await db.query("update operator_work_queue_digest_deliveries set available_at=$1 where status='failed'", [new Date(clock.now).toISOString()]); },
  };
}

test("production gates are inert when disabled, preview, wrong origin, or invalid timezone", async (t) => {
  const f = await fixture(t);
  for (const [key, value] of [["OPERATOR_WORK_QUEUE_DIGEST_ENABLED", "false"], ["NODE_ENV", "development"], ["VERCEL_ENV", "preview"], ["PLATFORM_MODE", "preview"], ["NEXT_PUBLIC_SITE_URL", "https://untrusted.example"], ["OPERATOR_WORK_QUEUE_DIGEST_TIMEZONE", "MST"]]) {
    const original = f.env[key]; f.env[key] = value;
    assert.equal((await f.worker.processWorkQueueDigestBatch()).ready, false, key);
    f.env[key] = original;
  }
  f.setPlatformMode("preview");
  assert.equal((await f.worker.processWorkQueueDigestBatch()).ready, false);
  assert.deepEqual(await f.rows(), []);
  assert.deepEqual(f.sends, []);
});

test("daily slots enqueue once, send the actual admin queue, and still send an empty afternoon digest", async (t) => {
  const f = await fixture(t);
  delete f.env.OPERATOR_WORK_QUEUE_DIGEST_TIMEZONE;
  f.clock.now = Date.parse("2026-10-05T16:05:00Z");
  const result = await f.worker.processWorkQueueDigestBatch();
  assert.equal(result.timeZone, "America/Denver");
  assert.equal(result.sent, 1); assert.equal(result.remainingDue, 0);
  assert.deepEqual(f.reads, [f.auth]);
  assert.equal((await f.rows())[0].status, "sent");
  assert.equal((await f.worker.processWorkQueueDigestBatch()).sent, 0);
  f.clock.now = Date.parse("2026-10-05T21:00:00Z"); f.setQueue(emptyQueue);
  assert.equal((await f.worker.processWorkQueueDigestBatch()).sent, 1);
  assert.match(f.sends[1].payload.text, /No open tasks/);
  assert.equal((await f.rows()).length, 2);
  assert.equal(f.sends.length, 2);
  assert.equal((await f.rows())[0].recipient_auth_user_id, f.auth);
});

test("concurrent enqueue/claim operations deduplicate and a wrong lease cannot prepare or send", async (t) => {
  const f = await fixture(t), now = new Date(f.clock.now);
  const queued = await Promise.all([f.repo.enqueueWorkQueueDigests("Etc/GMT+7", now), f.repo.enqueueWorkQueueDigests("Etc/GMT+7", now)]);
  assert.equal(queued.reduce((sum, item) => sum + item.queued, 0), 1);
  const lease = crypto.randomUUID();
  const [first, second] = await Promise.all([f.repo.claimWorkQueueDigest(lease, now), f.repo.claimWorkQueueDigest(crypto.randomUUID(), now)]);
  assert.ok(first); assert.equal(second, null);
  assert.equal((await f.repo.withWorkQueueDigest(first, crypto.randomUUID(), "Etc/GMT+7", now, () => { throw new Error("Wrong lease callback"); })).kind, "deferred");
  assert.deepEqual(f.sends, []);
});

test("provider acceptance followed by lost database acknowledgement retries identical frozen content and key", async (t) => {
  const f = await fixture(t);
  f.faults.push("set status='sent'");
  assert.equal((await f.worker.processWorkQueueDigestBatch()).failed, 1);
  const [failed] = await f.rows();
  assert.equal(failed.status, "failed"); assert.ok(failed.first_send_attempt_at);
  f.setQueue(emptyQueue); await f.due();
  assert.equal((await f.worker.processWorkQueueDigestBatch()).sent, 1);
  assert.deepEqual(f.sends[1], f.sends[0]);
  assert.equal(f.reads.length, 1, "retries do not regenerate the current queue");
  await assert.rejects(f.db.query("update operator_work_queue_digest_deliveries set delivery_payload='{}' where id=$1", [failed.id]), /immutable/);
  await assert.rejects(f.db.query("update operator_work_queue_digest_deliveries set first_send_attempt_at=null where id=$1", [failed.id]), /immutable/);
});

test("expired uncertain deliveries require review without another provider call", async (t) => {
  const f = await fixture(t);
  f.responses.push(new Error("Transport failed"));
  await f.worker.processWorkQueueDigestBatch();
  const [failed] = await f.rows();
  f.clock.now += 23 * 60 * 60_000;
  const result = await f.worker.processWorkQueueDigestBatch();
  assert.equal(result.manualReview, 1); assert.equal(f.sends.length, 1);
  assert.equal((await f.rows()).find((row) => row.id === failed.id).status, "manual_review");
});

test("automatic retries stop after five attempts with the same payload and provider key", async (t) => {
  const f = await fixture(t);
  for (let attempt = 0; attempt < 5; attempt++) {
    f.responses.push({ statusCode: 429, name: "rate_limit_exceeded" });
    await f.worker.processWorkQueueDigestBatch();
    await f.due();
  }
  assert.equal(f.sends.length, 5);
  assert.equal((await f.rows())[0].status, "manual_review");
  assert.equal((await f.rows())[0].attempts, 5);
  assert.equal((await f.worker.processWorkQueueDigestBatch()).claimed, 0);
  assert.equal(f.sends.length, 5);
  for (const sent of f.sends) assert.deepEqual(sent, f.sends[0]);
});

test("activating at 1pm waits for 3pm and does not backfill a missed morning email", async (t) => {
  const f = await fixture(t);
  f.clock.now = Date.parse("2026-10-05T20:00:00Z");
  assert.equal((await f.worker.processWorkQueueDigestBatch()).queued, 0);
  assert.deepEqual(f.sends, []);
  f.clock.now = Date.parse("2026-10-05T22:05:00Z");
  assert.equal((await f.worker.processWorkQueueDigestBatch()).sent, 1);
  assert.deepEqual((await f.rows()).map((row) => row.local_hour), [15]);
});

test("recipient must remain the same active verified administrator through the final send", async (t) => {
  for (const scenario of ["revoke", "suspend", "retire-email", "change-address", "change-person-status"]) {
    await t.test(scenario, async (subtest) => {
      const f = await fixture(subtest);
      f.hooks.push(async () => {
        if (scenario === "revoke") await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [f.auth]);
        if (scenario === "suspend") await f.db.query("update platform_users set status='suspended' where auth_user_id=$1", [f.auth]);
        if (scenario === "retire-email") await f.db.query("update person_email_addresses set retired_at=now() where person_id=$1", [f.person]);
        if (scenario === "change-address") await f.db.query("update platform_users set email_normalized='someone@example.test' where auth_user_id=$1", [f.auth]);
        if (scenario === "change-person-status") await f.db.query("update people set status='inactive' where id=$1", [f.person]);
      });
      const result = await f.worker.processWorkQueueDigestBatch();
      assert.equal(result.cancelled, 1);
      assert.deepEqual(f.sends, []);
      assert.equal((await f.rows())[0].status, "cancelled");
      assert.equal((await f.worker.processWorkQueueDigestBatch()).ready, false);
    });
  }
});

test("a Circle role cannot enqueue digest emails, and a changed timezone cannot duplicate a sent local slot", async (t) => {
  const f = await fixture(t);
  await f.db.query("update platform_role_grants set role_slug='circle_leader'");
  assert.equal((await f.worker.processWorkQueueDigestBatch()).ready, false);
  assert.deepEqual(await f.rows(), []);
  await f.db.query("update platform_role_grants set role_slug='ops_admin'");
  await f.worker.processWorkQueueDigestBatch();
  f.env.OPERATOR_WORK_QUEUE_DIGEST_TIMEZONE = "America/Denver";
  assert.equal((await f.worker.processWorkQueueDigestBatch()).sent, 0);
  assert.equal(f.sends.length, 1);
});
