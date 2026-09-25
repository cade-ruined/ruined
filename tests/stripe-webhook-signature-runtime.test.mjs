import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Stripe from "stripe";
import ts from "typescript";

const apiVersion = "2026-08-26.dahlia";
const secret = "whsec_local_signature_regression_fixture";
const stripe = new Stripe("sk_test_local_signature_fixture", { apiVersion });
const output = ts.transpileModule(await readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ failure = false, workerFailure = false } = {}) {
  const processed = [];
  const ids = new Set();
  let workerCalls = 0;
  const dependencies = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/stripe/server": { STRIPE_API_VERSION: apiVersion, getStripe: () => stripe,
      getStripeLivemode: () => false, getStripeWebhookSecret: () => secret },
    "@/lib/stripe/webhook": { processStripeWebhookEvent: async event => {
      if (failure) throw new Error("Fixture database unavailable");
      processed.push(event);
      const duplicate = ids.has(event.id);
      ids.add(event.id);
      return { handled: true, duplicate };
    } },
    "@/lib/workflows/worker": { processWorkflowBatch: async limit => {
      assert.equal(limit, 8); workerCalls++;
      if (workerFailure) throw new Error("Fixture worker unavailable");
    } },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "console", output)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, { error() {} });
  return { POST: loaded.exports.POST, processed, workerCalls: () => workerCalls };
}
function event(overrides = {}) {
  return { id: "evt_local_invoice_paid", object: "event", api_version: apiVersion,
    type: "invoice.paid", livemode: false, data: { object: { id: "in_local", object: "invoice", status: "paid", amount_paid: 49900 } }, ...overrides };
}
function signed(payload, options = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret, ...options });
  return new Request("https://members.example.test/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": signature }, body,
  });
}

test("missing, forged and expired signatures never reach membership processing", async () => {
  const app = fixture();
  const missing = new Request("https://members.example.test/api/stripe/webhook", { method: "POST", body: JSON.stringify(event()) });
  const forged = signed(event(), { secret: "whsec_another_fixture" });
  const expired = signed(event(), { timestamp: Math.floor(Date.now() / 1000) - 3600 });
  for (const request of [missing, forged, expired]) assert.equal((await app.POST(request)).status, 400);
  assert.equal(app.processed.length, 0);
  assert.equal(app.workerCalls(), 0);
});

test("even a valid signature cannot cross test/live or API-version boundaries", async () => {
  const app = fixture();
  assert.equal((await app.POST(signed(event({ livemode: true })))).status, 400);
  assert.equal((await app.POST(signed(event({ api_version: "2026-07-29.dahlia" })))).status, 400);
  assert.equal(app.processed.length, 0);
});

test("signature verification uses the exact raw body, including whitespace", async () => {
  const app = fixture();
  const body = JSON.stringify(event(), null, 2);
  assert.equal((await app.POST(signed(body))).status, 200);
  assert.equal(app.processed.length, 1);
  assert.equal(app.processed[0].data.object.amount_paid, 49900);
});

test("tampering with the invoice after signing cannot grant access", async () => {
  const app = fixture();
  const original = JSON.stringify(event());
  const request = signed(original);
  const tampered = new Request(request.url, { method: "POST", headers: request.headers, body: original.replace("49900", "1") });
  assert.equal((await app.POST(tampered)).status, 400);
  assert.equal(app.processed.length, 0);
});

test("confirmed duplicate webhook delivery does not enqueue member follow-ups twice", async () => {
  const app = fixture();
  assert.equal((await app.POST(signed(event()))).status, 200);
  const duplicate = await app.POST(signed(event()));
  assert.deepEqual(await duplicate.json(), { received: true, handled: true, duplicate: true });
  assert.equal(app.workerCalls(), 1);
});

test("processing failures ask Stripe to retry; follow-up failures do not lose confirmed billing", async () => {
  const failed = fixture({ failure: true });
  assert.equal((await failed.POST(signed(event()))).status, 500);
  assert.equal(failed.workerCalls(), 0);
  const deferred = fixture({ workerFailure: true });
  assert.equal((await deferred.POST(signed(event()))).status, 200);
  assert.equal(deferred.processed.length, 1);
});
