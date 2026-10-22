import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, compiled, compiled.exports);
  return compiled.exports;
}
const model = await load("src/lib/stripe/payment-method-model.ts");
const membershipState = await load("src/lib/stripe/membership-state.ts");
const actorId = "00000000-0000-4000-8000-000000000001";
const memberId = "00000000-0000-4000-8000-000000000002";
const attemptId = "00000000-0000-4000-8000-000000000003";
const context = id => ({ params: Promise.resolve({ memberId: id ?? memberId }) });
const consent = () => ({ attemptId, consentAccepted: true, consentVersion: model.OPERATOR_PAYMENT_SETUP_CONSENT_VERSION });
const request = (method = "GET", body, headers = {}) => new Request(`https://members.example.test/api/ops/members/${memberId}/payment-method`, {
  method, headers: { "Content-Type": "application/json", Origin: "https://members.example.test", ...headers },
  ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
});

async function fixture() {
  const calls = [];
  let authenticated = true, trusted = true, failure = null;
  const state = { enabled: true, eligible: true, canRemove: false, removalPending: false, state: "not_saved", reason: null, paymentMethod: null };
  const session = { url: "https://checkout.stripe.com/c/pay/operator-setup" };
  const auth = { getCurrentPlatformViewer: async () => authenticated ? { authUserId: actorId } : null };
  const json = (body, options = {}) => new Response(JSON.stringify(body), { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const ops = await load("src/lib/platform/ops-api.ts", {
    "next/server": { NextResponse: { json } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => trusted },
    "@/lib/auth/session": auth,
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: class extends Error {} },
  });
  const action = name => async (...args) => { calls.push({ name, args }); if (failure) throw failure; return name === "start" ? session : state; };
  const api = await load("app/api/ops/members/[memberId]/payment-method/route.ts", {
    "@/lib/auth/session": auth,
    "@/lib/platform/ops-api": ops,
    "@/lib/stripe/server": { getApplicationOrigin: () => "https://canonical.example.test" },
    "@/lib/stripe/membership-state": membershipState,
    "@/lib/stripe/payment-method-model": model,
    "@/lib/stripe/payment-method-service": { getOperatorMemberPaymentMethodStatus: action("status"), startOperatorMemberPaymentMethodSetup: action("start") },
  });
  return { api, calls, state, session, authenticate: value => authenticated = value, trust: value => trusted = value, fail: value => failure = value };
}

test("operator card API requires a signed-in actor and does not cache either operation", async () => {
  const f = await fixture();
  f.authenticate(false);
  for (const response of [await f.api.GET(request(), context()), await f.api.POST(request("POST", consent()), context())]) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(f.calls.length, 0);
  f.authenticate(true);
  const response = await f.api.GET(request(), context());
  assert.deepEqual(await response.json(), f.state);
  assert.deepEqual(f.calls, [{ name: "status", args: [actorId, memberId] }]);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("operator card POST checks request origin and JSON before invoking the payment service", async () => {
  const f = await fixture();
  f.trust(false);
  assert.equal((await f.api.POST(request("POST", consent()), context())).status, 403);
  f.trust(true);
  assert.equal((await f.api.POST(request("POST", consent(), { "Content-Type": "text/plain" }), context())).status, 415);
  assert.equal(f.calls.length, 0);
});

test("operator card API rejects malformed identity, consent, oversized data, and caller-controlled payment context", async () => {
  const f = await fixture();
  assert.equal((await f.api.GET(request(), context("not-a-member"))).status, 404);
  assert.equal((await f.api.POST(request("POST", consent()), context("not-a-member"))).status, 404);
  for (const body of ["{", [], null, {}, { ...consent(), attemptId: "invalid" }, { ...consent(), consentAccepted: "true" }, { ...consent(), consentVersion: model.PAYMENT_SETUP_CONSENT_VERSION }]) {
    assert.equal((await f.api.POST(request("POST", body), context())).status, 400);
  }
  for (const extra of ["authUserId", "memberId", "customerId", "applicationOrigin"]) {
    assert.equal((await f.api.POST(request("POST", { ...consent(), [extra]: "attacker-value" }), context())).status, 400);
  }
  assert.equal((await f.api.POST(request("POST", "x".repeat(1001)), context())).status, 413);
  assert.equal(f.calls.length, 0);
});

test("operator card setup keeps the signed-in actor distinct from the target and uses the configured return origin", async () => {
  const f = await fixture();
  const response = await f.api.POST(request("POST", consent()), context());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), f.session);
  assert.deepEqual(f.calls, [{ name: "start", args: [{ authUserId: actorId, memberId, ...consent(), applicationOrigin: "https://canonical.example.test" }] }]);
});

test("operator card API preserves authorization and eligibility failures but hides provider details", async () => {
  const f = await fixture();
  f.fail(new model.PaymentMethodSetupError("Administrator access is required.", 403));
  for (const response of [await f.api.GET(request(), context()), await f.api.POST(request("POST", consent()), context())]) {
    assert.equal(response.status, 403);
    assert.match(await response.text(), /Administrator access/);
  }
  f.fail(new model.PaymentMethodSetupError("Another card setup is in progress.", 409));
  const conflict = await f.api.POST(request("POST", consent()), context());
  assert.equal(conflict.status, 409);
  assert.match(await conflict.text(), /in progress/);
  f.fail(new Error("sk_live_private provider customer details"));
  for (const response of [await f.api.GET(request(), context()), await f.api.POST(request("POST", consent()), context())]) {
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sk_live|customer details/);
  }
});
