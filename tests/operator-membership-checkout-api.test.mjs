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
const model = await load("src/lib/stripe/operator-membership-model.ts");
const membershipState = await load("src/lib/stripe/membership-state.ts");
const pricing = await load("src/lib/membership/pricing.ts");
const actorId = "00000000-0000-4000-8000-000000000001";
const memberId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const context = (id = memberId) => ({ params: Promise.resolve({ memberId: id }) });
const quote = () => ({ action: "quote", requestId, plan: "monthly" });
const checkout = () => ({ action: "checkout", reservationId: requestId, reviewToken: "a".repeat(64), authorityAccepted: true, authorityVersion: model.OPERATOR_MEMBERSHIP_AUTHORITY_VERSION });
const request = (method = "GET", body, headers = {}) => new Request(`https://members.example.test/api/ops/members/${memberId}/checkout`, {
  method, headers: { "Content-Type": "application/json", Origin: "https://members.example.test", ...headers },
  ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
});

async function fixture() {
  const calls = [];
  let authenticated = true, trusted = true, failure = null;
  class PlatformAccessDeniedError extends Error {}
  class CommercialMembershipError extends Error { constructor(message, status = 409) { super(message); this.status = status; } }
  class MembershipCheckoutConflictError extends Error { constructor(code) { super(code); this.code = code; } }
  const auth = { getCurrentPlatformViewer: async () => authenticated ? { authUserId: actorId } : null };
  const json = (body, options = {}) => new Response(JSON.stringify(body), { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const ops = await load("src/lib/platform/ops-api.ts", {
    "next/server": { NextResponse: { json } }, "@/lib/auth/request": { isTrustedPlatformOrigin: () => trusted },
    "@/lib/auth/session": auth, "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: class extends Error {} },
  });
  const results = { status: { eligible: true, paid: false }, quote: { quote: { id: requestId } }, start: { clientSecret: "secret_fixture", plan: "monthly", commercialReservationId: requestId } };
  const action = name => async (...args) => { calls.push({ name, args }); if (failure) throw failure; return results[name]; };
  const api = await load("app/api/ops/members/[memberId]/checkout/route.ts", {
    "@/lib/auth/session": auth, "@/lib/platform/ops-api": ops,
    "@/lib/platform/repository": { PlatformAccessDeniedError },
    "@/lib/membership/commercial-repository": { CommercialMembershipError },
    "@/lib/stripe/billing-repository": { MembershipCheckoutConflictError },
    "@/lib/membership/pricing": pricing, "@/lib/stripe/membership-state": membershipState,
    "@/lib/stripe/server": { getApplicationOrigin: () => "https://canonical.example.test" },
    "@/lib/stripe/operator-membership-model": model,
    "@/lib/stripe/operator-membership-service": { operatorMembershipStatus: action("status"), quoteOperatorMembership: action("quote"), startOperatorMembershipCheckout: action("start") },
  });
  return { api, calls, results, PlatformAccessDeniedError, CommercialMembershipError, MembershipCheckoutConflictError,
    authenticate: value => authenticated = value, trust: value => trusted = value, fail: value => failure = value };
}

test("delegated membership API requires a signed-in administrator and never caches status or secrets", async () => {
  const f = await fixture(); f.authenticate(false);
  for (const response of [await f.api.GET(request(), context()), await f.api.POST(request("POST", quote()), context()), await f.api.POST(request("POST", checkout()), context())]) {
    assert.equal(response.status, 401); assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(f.calls.length, 0); f.authenticate(true);
  for (const response of [await f.api.GET(request(), context()), await f.api.POST(request("POST", quote()), context()), await f.api.POST(request("POST", checkout()), context())]) {
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("both delegated membership mutations require trusted origin and JSON", async () => {
  const f = await fixture();
  for (const body of [quote(), checkout()]) {
    f.trust(false); assert.equal((await f.api.POST(request("POST", body), context())).status, 403);
    f.trust(true); assert.equal((await f.api.POST(request("POST", body, { "Content-Type": "text/plain" }), context())).status, 415);
  }
  assert.equal(f.calls.length, 0);
});

test("delegated checkout rejects caller-controlled identity, prices, return URLs and unchecked authority", async () => {
  const f = await fixture();
  assert.equal((await f.api.GET(request(), context("invalid"))).status, 404);
  for (const body of [quote(), checkout()]) {
    assert.equal((await f.api.POST(request("POST", body), context("invalid"))).status, 404);
    for (const key of ["authUserId", "memberId", "email", "customerId", "priceId", "amount", "applicationOrigin", "returnUrl", "acceptanceId"]) {
      assert.equal((await f.api.POST(request("POST", { ...body, [key]: "caller-value" }), context())).status, 400, key);
    }
  }
  for (const body of ["{", null, [], {}, { ...quote(), requestId: "bad" }, { ...quote(), plan: "founding" },
    { ...checkout(), reservationId: "bad" }, { ...checkout(), reviewToken: "bad" }, { ...checkout(), reviewToken: "g".repeat(64) },
    { ...checkout(), authorityAccepted: false }, { ...checkout(), authorityAccepted: "true" }, { ...checkout(), authorityVersion: "previous" }]) {
    assert.equal((await f.api.POST(request("POST", body), context())).status, 400);
  }
  assert.equal((await f.api.POST(request("POST", "x".repeat(1501)), context())).status, 413);
  assert.equal(f.calls.length, 0);
});

test("delegated checkout passes the real session actor, route beneficiary and canonical origin separately", async () => {
  const f = await fixture();
  await f.api.GET(request(), context());
  await f.api.POST(request("POST", quote()), context());
  await f.api.POST(request("POST", checkout(), { "User-Agent": "x".repeat(1300) }), context());
  assert.deepEqual(f.calls, [
    { name: "status", args: [actorId, memberId] },
    { name: "quote", args: [{ authUserId: actorId, memberId, requestId, plan: "monthly" }] },
    { name: "start", args: [{ authUserId: actorId, memberId, reservationId: requestId, reviewToken: "a".repeat(64),
      authorityAccepted: true, authorityVersion: model.OPERATOR_MEMBERSHIP_AUTHORITY_VERSION,
      applicationOrigin: "https://canonical.example.test", userAgent: "x".repeat(1000) }] },
  ]);
});

test("delegated checkout exposes actionable authority/offer conflicts but redacts provider errors", async () => {
  const f = await fixture();
  for (const [error, status, expected] of [
    [new f.PlatformAccessDeniedError(), 403, /Administrator access/],
    [new f.CommercialMembershipError("Offer has expired."), 409, /Offer has expired/],
    [new model.OperatorMembershipError("Review the current offer.", 409, "review_changed"), 409, /review_changed/],
    [new f.MembershipCheckoutConflictError("membership_agreement_changed"), 409, /review_changed/],
    [new f.MembershipCheckoutConflictError("private_database_state"), 409, /payment in progress/],
    [new Error("sk_live_secret customer-private-provider-response"), 503, /temporarily unavailable/],
  ]) {
    f.fail(error);
    for (const response of [await f.api.GET(request(), context()), await f.api.POST(request("POST", checkout()), context())]) {
      assert.equal(response.status, status); assert.equal(response.headers.get("Cache-Control"), "no-store");
      const text = await response.text(); assert.match(text, expected); assert.doesNotMatch(text, /sk_live|customer-private|private_database_state/);
    }
  }
});
