import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { timingSafeEqual } from "node:crypto";
import ts from "typescript";

async function load(path, dependencies, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}

async function cron({ paymentFails = false, deletionTime = 0 } = {}) {
  let now = 100_000;
  class Clock extends Date { static now() { return now; } }
  const calls = [];
  const route = await load("app/api/internal/membership/process/route.ts", {
    "node:crypto": { timingSafeEqual }, "next/server": { NextResponse: { json: Response.json } },
    "@/lib/platform/member-deletion-cleanup": { processMemberDeletionCleanupBatch: async (...args) => {
      calls.push({ type: "deletion", args }); now += deletionTime; return { claimed: 0, completed: 0, failed: 0, deferred: 0 };
    } },
    "@/lib/stripe/payment-method-service": { cleanupWithdrawnMemberPaymentMethods: async input => {
      calls.push({ type: "payment", input });
      if (paymentFails) throw new Error("provider unavailable");
      return { processed: 1, pending: 0 };
    } },
    "@/lib/workflows/worker": { processWorkflowBatch: async (...args) => {
      calls.push({ type: "workflow", args }); return { claimed: 1, processed: 1, failed: 0 };
    } },
  }, { Date: Clock, process: { env: { CRON_SECRET: "fixture-private-cron" } }, console: { error() {} } });
  return { calls, invoke: (authorization) => route.POST(new Request("https://members.example.test/api/internal/membership/process", {
    method: "POST", headers: authorization ? { authorization } : {},
  })) };
}

test("only the authenticated cron can retry saved-card removal", async () => {
  const f = await cron();
  for (const auth of [undefined, "Bearer wrong", "fixture-private-cron"]) assert.equal((await f.invoke(auth)).status, 401);
  assert.deepEqual(f.calls, []);
  const response = await f.invoke("Bearer fixture-private-cron");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(f.calls, [
    { type: "deletion", args: [3, null, 150_000] },
    { type: "payment", input: { limit: 3, deadline: 112_000 } },
    { type: "workflow", args: [50, 150_000] },
  ]);
  assert.deepEqual((await response.json()).paymentMethodCleanup, { processed: 1, pending: 0 });
});

test("payment-provider outage leaves cleanup pending without blocking membership workflows", async () => {
  const f = await cron({ paymentFails: true });
  const response = await f.invoke("Bearer fixture-private-cron");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).paymentMethodCleanup, { processed: 0, pending: 1 });
  assert.equal(f.calls.at(-1).type, "workflow");
});

test("cron skips new payment cleanup when its total time budget is consumed", async () => {
  const f = await cron({ deletionTime: 50_001 });
  const response = await f.invoke("Bearer fixture-private-cron");
  assert.equal(f.calls.some(call => call.type === "payment"), false);
  assert.deepEqual((await response.json()).paymentMethodCleanup, { processed: 0, pending: 1 });
});

test("workflow deadline finishes a claimed action but does not claim another", async () => {
  let now = 100, claims = 0, completed = 0;
  class Clock extends Date { static now() { return now; } }
  const worker = await load("src/lib/workflows/worker.ts", {
    "server-only": {}, "@/lib/workflows/repository": {
      createWorkflowWorkerId: () => "fixture-worker",
      claimNextWorkflowAction: async () => { claims++; return { id: "one-action" }; },
      executeWorkflowAction: async () => { now = 201; return { complete: true }; },
      markWorkflowActionSucceeded: async () => { completed++; return true; },
      markWorkflowActionFailed: () => assert.fail("successful in-flight action must finish before stopping"),
    },
  }, { Date: Clock });
  assert.deepEqual(await worker.processWorkflowBatch(50, 200), { claimed: 1, processed: 1, failed: 0 });
  assert.equal(claims, 1); assert.equal(completed, 1);
  assert.deepEqual(await worker.processWorkflowBatch(50, 200), { claimed: 0, processed: 0, failed: 0 });
  assert.equal(claims, 1);
});
