import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const prefix = "src/lib/communications/member-email-cadence-";
const addresses = await load("src/lib/communications/admin-email-model.ts", {});
const envKeys = ["RESEND_API_KEY", "CRON_SECRET"];
async function configured(action) {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  process.env.RESEND_API_KEY = "re_mock_cadence_only";
  process.env.CRON_SECRET = "mock-cadence-cron";
  try { return await action(); }
  finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}
class CadenceDeliveryError extends Error {
  constructor(code, terminal = false) { super(code); this.code = code; this.terminal = terminal; }
}
const clone = value => structuredClone(value);
async function fixture(options = {}) {
  const configuration = { enabled: true, ready: true, activatedAt: "2026-01-01T00:00:00.000Z", ...options.configuration };
  const model = { getMemberEmailCadenceConfiguration: () => configuration };
  let row = { id: crypto.randomUUID(), memberId: crypto.randomUUID(), attempts: 0,
    firstAttemptAt: null, email: "member@example.test", memberName: "Avery", payload: null,
    dueAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 29 * 60_000).toISOString(),
    status: "pending", plan: {}, event: {}, stage: {}, ...options.row };
  const calls = { enqueue: 0, claims: 0, reads: 0, render: 0, freezes: 0, suppression: 0,
    provider: [], errors: [], transactions: 0, reservations: 0, inheritance: 0 };
  let txActive = false;
  const repository = {
    CadenceDeliveryError,
    async enqueueCadenceDeliveries() { calls.enqueue++; if (options.enqueue) await options.enqueue(); return 1; },
    async claimCadenceDelivery(lease) {
      calls.claims++;
      if (!["pending", "failed"].includes(row.status)) return null;
      row = { ...row, attempts: row.attempts + 1, status: "sending", lease };
      return clone(row);
    },
    async withCadenceDelivery(claim, lease, action) {
      calls.reads++;
      if (options.guard) {
        const kind = options.guard(calls.reads, row);
        if (kind) { row.status = kind; return { kind }; }
      }
      if (row.id !== claim.id || row.lease !== lease || row.status !== "sending") return { kind: "deferred" };
      const transaction = { row: clone(row) };
      calls.transactions++; txActive = true;
      try {
        const value = await action(transaction, clone(row));
        row = transaction.row;
        return { kind: "ok", value };
      } finally { txActive = false; }
    },
    async freezeCadenceDelivery(tx, id, payload) {
      assert.equal(id, row.id);
      calls.freezes++;
      tx.row.payload ??= clone(payload);
      tx.row.firstAttemptAt ??= new Date().toISOString();
    },
    async completeCadenceDelivery(tx, id, providerId) {
      assert.equal(id, row.id);
      if (options.complete) await options.complete(calls, row);
      tx.row.status = "sent"; tx.row.providerId = providerId;
    },
    async failCadenceDelivery(claim, lease, code, terminal) {
      assert.equal(claim.id, row.id); assert.equal(lease, row.lease);
      calls.errors.push({ code, terminal });
      row.status = terminal || row.attempts >= 5 ? "manualReview" : "failed";
      return row.status;
    },
  };
  const provider = { async reserveCadenceProviderSlot(deadline) {
    calls.reservations++;
    if (options.reserve) return options.reserve(deadline);
  }, async assertCadenceRecipientDeliverable(email, budget) {
    calls.suppression++;
    assert.equal(email, row.email); assert.ok(budget.deadline > Date.now());
    assert.ok(txActive, "current consent and recipient evidence remain locked during suppression and dispatch");
    if (options.suppression) return options.suppression(calls, row, budget);
  } };
  const renderer = { async renderCadenceEmail(delivery) {
    calls.render++;
    return { from: "Ruined <connect@example.test>", to: delivery.email, replyTo: ["connect@example.test"],
      subject: "Tomorrow: SEE.", html: "<p>Your call is tomorrow.</p>", text: "Your call is tomorrow." };
  } };
  const resend = { Resend: class {
    emails = { send: async (payload, request) => {
      assert.ok(row.payload && row.firstAttemptAt, "frozen content and attempt fence must commit before network");
      assert.deepEqual(payload, row.payload);
      assert.ok(txActive, "send rechecks occur inside the second transaction");
      calls.provider.push({ payload: clone(payload), request: clone(request) });
      if (options.send) return options.send(calls, row);
      return { data: { id: "mock-provider-id" }, error: null };
    } };
  } };
  const transport = await load(`${prefix}delivery.ts`, {
    "server-only": {}, resend, "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: options.mode ?? "connected" }) },
    "./admin-email-model": addresses, "./member-email-cadence-model": model, "./member-email-cadence-repository": repository,
    "./member-email-cadence-provider": provider,
  }, options.globals);
  const worker = await load(`${prefix}worker.ts`, {
    "server-only": {}, "node:crypto": crypto, "./member-email-cadence-model": model,
    "./member-email-cadence-delivery": transport, "./member-email-cadence-provider": provider,
    "./member-email-cadence-renderer": renderer, "./member-email-cadence-repository": repository,
    "./member-email-cadence-inheritance": { reconcileCadenceInheritance: async () => { calls.inheritance++; return { plans: 0, enrolled: 0 }; } },
  }, options.globals);
  return { ...worker, transport, calls, get row() { return row; }, update(patch) { Object.assign(row, patch); } };
}

test("disabled, unconfigured, preview, and future activation paths do no database or provider work", async () => configured(async () => {
  for (const options of [
    { configuration: { enabled: false } }, { configuration: { ready: false, activatedAt: null } },
    { mode: "preview" }, { configuration: { activatedAt: "2999-01-01T00:00:00.000Z" } },
  ]) {
    const f = await fixture(options);
    const result = await f.processMemberEmailCadenceBatch();
    assert.ok(result.skipped);
    assert.equal(f.calls.inheritance + f.calls.enqueue + f.calls.claims + f.calls.render + f.calls.suppression + f.calls.provider.length, 0);
  }
  for (const key of envKeys) {
    const saved = process.env[key]; delete process.env[key];
    const f = await fixture();
    const result = await f.processMemberEmailCadenceBatch();
    assert.equal(result.skipped, "unconfigured"); assert.ok(result.missing.includes(key));
    assert.equal(f.calls.enqueue + f.calls.provider.length, 0);
    process.env[key] = saved;
  }
}));

test("an occurrence commits frozen content before send, rechecks eligibility, and is never sent twice", async () => configured(async () => {
  const f = await fixture();
  const result = await f.processMemberEmailCadenceBatch();
  assert.equal(result.sent, 1); assert.equal(result.failed, 0);
  assert.equal(f.calls.reads, 2); assert.equal(f.calls.suppression, 1);
  assert.equal(f.calls.reservations, 1);
  assert.deepEqual(f.calls.provider[0].request, { idempotencyKey: `cadence:${f.row.id}` });
  assert.equal((await f.processMemberEmailCadenceBatch()).sent, 0);
  assert.equal(f.calls.provider.length, 1);
}));

test("acknowledgement loss retries identical bytes and key without re-rendering edited content", async () => configured(async () => {
  const f = await fixture({ complete: calls => { if (calls.provider.length === 1) throw new Error("private database detail"); } });
  assert.equal((await f.processMemberEmailCadenceBatch(1)).failed, 1);
  assert.ok(f.row.payload); assert.ok(f.row.firstAttemptAt);
  assert.equal(f.row.status, "failed");
  f.update({ memberName: "Changed after first send" });
  assert.equal((await f.processMemberEmailCadenceBatch(1)).sent, 1);
  assert.deepEqual(f.calls.provider[1], f.calls.provider[0]);
  assert.equal(f.calls.render, 1);
  assert.deepEqual(f.calls.errors, [{ code: "delivery_unavailable", terminal: false }]);
}));

test("replay expiry, exhausted attempts, and a changed destination stop before provider lookup or send", async () => configured(async () => {
  for (const row of [
    { firstAttemptAt: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString() },
    { firstAttemptAt: "invalid" }, { attempts: 5 },
  ]) {
    const f = await fixture({ row });
    assert.equal((await f.processMemberEmailCadenceBatch(1)).manualReview, 1);
    assert.equal(f.calls.suppression + f.calls.provider.length, 0);
  }
  const f = await fixture({ complete: () => { throw new Error("commit lost"); } });
  await f.processMemberEmailCadenceBatch(1);
  f.update({ email: "different@example.test" });
  assert.equal((await f.processMemberEmailCadenceBatch(1)).manualReview, 1);
  assert.equal(f.calls.provider.length, 1);
  assert.equal(f.calls.errors.at(-1).code, "recipient_changed_requires_review");
}));

test("withdrawal at either eligibility check and provider suppression fail closed", async () => configured(async () => {
  for (const check of [1, 2]) {
    const f = await fixture({ guard: count => count === check ? "cancelled" : null });
    assert.equal((await f.processMemberEmailCadenceBatch(1)).cancelled, 1);
    assert.equal(f.calls.provider.length, 0);
  }
  for (const terminal of [false, true]) {
    const f = await fixture({ suppression: () => { throw new CadenceDeliveryError(terminal ? "recipient_suppressed" : "provider_unavailable", terminal); } });
    const result = await f.processMemberEmailCadenceBatch(1);
    assert.equal(result[terminal ? "manualReview" : "failed"], 1);
    assert.equal(f.calls.provider.length, 0);
  }
}));

test("provider uncertainty stops the batch and retains the same replay key", async () => configured(async () => {
  const f = await fixture({ send: () => new Promise(() => {}), globals: {
    setTimeout: callback => { queueMicrotask(callback); return 1; }, clearTimeout: () => {},
  } });
  const result = await f.processMemberEmailCadenceBatch(25);
  assert.equal(result.failed, 1); assert.equal(f.calls.claims, 1);
  assert.ok(f.row.firstAttemptAt); assert.ok(f.row.payload);
  assert.equal(f.calls.errors[0].code, "provider_timeout");
  await f.processMemberEmailCadenceBatch(25);
  assert.deepEqual(f.calls.provider[0], f.calls.provider[1]);
}));

test("known provider errors use safe codes and preserve retry or manual-review boundaries", async () => configured(async () => {
  for (const [status, terminal] of [[429, false], [500, false], [422, true]]) {
    const f = await fixture({ send: () => ({ error: { statusCode: status, message: "private recipient and provider details" } }) });
    const result = await f.processMemberEmailCadenceBatch(1);
    assert.equal(result[terminal ? "manualReview" : "failed"], 1);
    assert.deepEqual(f.calls.errors, [{ code: `provider_http_${status}`, terminal }]);
    assert.doesNotMatch(JSON.stringify(result), /private recipient/);
  }
}));

test("concurrent workers cannot both claim one occurrence", async () => configured(async () => {
  const f = await fixture();
  const results = await Promise.all([f.processMemberEmailCadenceBatch(1), f.processMemberEmailCadenceBatch(1)]);
  assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 1);
  assert.equal(f.calls.provider.length, 1);
}));

test("deadline exhaustion never begins a provider send", async () => configured(async () => {
  const f = await fixture();
  await assert.rejects(f.transport.sendCadencePayload({}, crypto.randomUUID(), Date.now() - 1), error => error.code === "delivery_budget");
  assert.equal(f.calls.provider.length, 0);
}));

test("a reminder expiring during suppression lookup cannot begin a send", async () => configured(async () => {
  let now = Date.now();
  const expiresAt = now + 100;
  const f = await fixture({ row: { expiresAt: new Date(expiresAt).toISOString() },
    globals: { Date: class extends Date { static now() { return now; } } },
    suppression: (_calls, _row, budget) => { assert.equal(budget.deadline, expiresAt); now = expiresAt; },
  });
  const result = await f.processMemberEmailCadenceBatch(1);
  assert.equal(result.manualReview, 1); assert.equal(f.calls.provider.length, 0);
  assert.deepEqual(f.calls.errors, [{ code: "delivery_window_expired", terminal: true }]);
}));

test("a reminder expiring while waiting for its send slot never begins the SDK request", async () => configured(async () => {
  let now = Date.now();
  const f = await fixture({ globals: { Date: class extends Date { static now() { return now; } } },
    reserve: deadline => { now = deadline; },
  });
  const result = await f.processMemberEmailCadenceBatch(1);
  assert.equal(result.failed, 1); assert.equal(f.calls.reservations, 1); assert.equal(f.calls.provider.length, 0);
  assert.equal(f.calls.errors[0].code, "delivery_budget");
}));

test("the default pass delivers beyond ten recipients and remains capped at one hundred", async () => {
  for (const requestedLimit of [undefined, 1000]) {
    const rows = Array.from({ length: 125 }, () => ({ id: crypto.randomUUID(), memberId: crypto.randomUUID(),
      attempts: 1, firstAttemptAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      email: "member@example.test", payload: { to: "member@example.test" } }));
    let claimed = 0, checked = 0, sent = 0;
    const worker = await load(`${prefix}worker.ts`, {
      "server-only": {}, "node:crypto": crypto,
      "./member-email-cadence-model": { getMemberEmailCadenceConfiguration: () => ({ enabled: true, ready: true, activatedAt: "2026-01-01T00:00:00.000Z" }) },
      "./member-email-cadence-delivery": {
        getMemberEmailCadenceDeliveryConfiguration: () => ({ enabled: true, ready: true, missing: [] }),
        assertCadencePayload: () => {}, assertCadenceReplayWindow: () => {},
        sendCadencePayload: async () => { sent++; return "mock-provider-id"; },
      },
      "./member-email-cadence-provider": { assertCadenceRecipientDeliverable: async () => { checked++; } },
      "./member-email-cadence-renderer": { renderCadenceEmail: () => assert.fail("Already frozen") },
      "./member-email-cadence-inheritance": { reconcileCadenceInheritance: async () => ({ plans: 0, enrolled: 0 }) },
      "./member-email-cadence-repository": {
        CadenceDeliveryError, enqueueCadenceDeliveries: async () => rows.length,
        claimCadenceDelivery: async () => rows[claimed++] ?? null,
        withCadenceDelivery: async (claim, _lease, action) => ({ kind: "ok", value: await action({}, claim) }),
        freezeCadenceDelivery: async () => {}, completeCadenceDelivery: async () => {},
        failCadenceDelivery: async () => assert.fail("No mocked delivery should fail"),
      },
    });
    const result = await worker.processMemberEmailCadenceBatch(requestedLimit);
    assert.equal(result.sent, 100); assert.equal(claimed, 100); assert.equal(checked, 100); assert.equal(sent, 100);
  }
});

test("exhausting the batch budget while enqueuing leaves deliveries unclaimed for the next pass", async () => configured(async () => {
  let now = Date.now();
  const f = await fixture({ globals: { Date: class extends Date { static now() { return now; } } },
    enqueue: () => { now += 165_000; },
  });
  const result = await f.processMemberEmailCadenceBatch();
  assert.equal(result.queued, 1); assert.equal(result.claimed, 0);
  assert.equal(f.calls.claims + f.calls.suppression + f.calls.provider.length, 0);
  assert.equal(f.row.status, "pending");
}));

test("cron requires exact bearer authorization and reports disabled versus unavailable safely", async () => configured(async () => {
  let calls = 0, enabled = false;
  const route = await load("app/api/internal/communications/member-email/route.ts", {
    "node:crypto": crypto, "next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
    "@/lib/communications/member-email-cadence-worker": { async processMemberEmailCadenceBatch() { calls++; return { enabled, ready: false }; } },
  });
  for (const header of [undefined, "Bearer wrong", "Basic mock-cadence-cron"]) {
    assert.equal((await route.GET(new Request("https://example.test/api/internal/communications/member-email", {
      headers: header ? { authorization: header } : {},
    }))).status, 401);
  }
  assert.equal(calls, 0);
  const request = new Request("https://example.test/api/internal/communications/member-email", { headers: { authorization: "Bearer mock-cadence-cron" } });
  const disabled = await route.GET(request);
  assert.equal(disabled.status, 200); assert.equal(disabled.headers.get("cache-control"), "private, no-store");
  enabled = true;
  assert.equal((await route.POST(request)).status, 503);
  delete process.env.CRON_SECRET;
  assert.equal((await route.GET(request)).status, 401);
  assert.equal(calls, 2);
}));
