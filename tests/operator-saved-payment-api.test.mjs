import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, compiled, compiled.exports);
  return compiled.exports;
}
const model = await load("src/lib/stripe/operator-membership-model.ts");
const memberState = await load("src/lib/stripe/membership-state.ts");
const actorId = "00000000-0000-4000-8000-000000000001", memberId = "00000000-0000-4000-8000-000000000002", requestId = "00000000-0000-4000-8000-000000000003";
const context = (id = memberId) => ({ params: Promise.resolve({ memberId: id }) });
const quote = () => ({ action: "quote", requestId });
const collect = () => ({ action: "collect", reservationId: requestId, reviewToken: "a".repeat(64), authorityAccepted: true, authorityVersion: model.OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION, authorizationEvidence: "Member explicitly authorized agreement acceptance, first payment and recurring renewals." });
const request = (method = "GET", body, headers = {}) => new Request(`https://members.example.test/api/ops/members/${memberId}/saved-payment`, { method, headers: { "Content-Type": "application/json", Origin: "https://members.example.test", ...headers }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });

async function fixture() {
  const calls = []; let authenticated = true, trusted = true, failure = null;
  class PlatformAccessDeniedError extends Error {}
  class CommercialMembershipError extends Error { constructor(message, status = 409) { super(message); this.status = status; } }
  class MembershipCheckoutConflictError extends Error {}
  const auth = { getCurrentPlatformViewer: async () => authenticated ? { authUserId: actorId } : null };
  const json = (body, options = {}) => new Response(JSON.stringify(body), { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const ops = await load("src/lib/platform/ops-api.ts", { "next/server": { NextResponse: { json } }, "@/lib/auth/request": { isTrustedPlatformOrigin: () => trusted }, "@/lib/auth/session": auth, "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: class extends Error {} } });
  const action = name => async (...args) => { calls.push({ name, args }); if (failure) throw failure; return { state: "pending" }; };
  const api = await load("app/api/ops/members/[memberId]/saved-payment/route.ts", {
    "@/lib/auth/session": auth, "@/lib/platform/ops-api": ops, "@/lib/platform/repository": { PlatformAccessDeniedError },
    "@/lib/membership/commercial-repository": { CommercialMembershipError }, "@/lib/stripe/billing-repository": { MembershipCheckoutConflictError },
    "@/lib/stripe/membership-state": memberState, "@/lib/stripe/server": { getApplicationOrigin: () => "https://canonical.example.test" },
    "@/lib/stripe/operator-membership-model": model, "@/lib/stripe/operator-saved-payment-service": { statusOperatorSavedMembership: action("status"), quoteOperatorSavedMembership: action("quote"), startOperatorSavedMembership: action("collect") },
  });
  return { api, calls, PlatformAccessDeniedError, authenticate: value => authenticated = value, trust: value => trusted = value, fail: value => failure = value };
}

test("saved-payment API requires sign-in, administrator service authorization and trusted JSON mutations", async () => {
  const f = await fixture(); f.authenticate(false);
  for (const response of [await f.api.GET(request(), context()), await f.api.POST(request("POST", collect()), context())]) { assert.equal(response.status, 401); assert.equal(response.headers.get("Cache-Control"), "no-store"); }
  f.authenticate(true); f.trust(false);
  assert.equal((await f.api.POST(request("POST", collect()), context())).status, 403);
  f.trust(true);
  assert.equal((await f.api.POST(request("POST", collect(), { "Content-Type": "text/plain" }), context())).status, 415);
  assert.equal(f.calls.length, 0);
  f.fail(new f.PlatformAccessDeniedError());
  assert.equal((await f.api.POST(request("POST", collect()), context())).status, 403);
});

test("saved-payment API rejects forged actor, method, price, plan and incomplete delegation evidence", async () => {
  const f = await fixture();
  for (const body of [quote(), collect()]) for (const key of ["authUserId", "memberId", "customerId", "paymentMethodId", "priceId", "amount", "plan", "applicationOrigin", "returnUrl"]) {
    assert.equal((await f.api.POST(request("POST", { ...body, [key]: "forged" }), context())).status, 400, key);
  }
  for (const body of ["{", null, [], {}, { ...collect(), authorityAccepted: false }, { ...collect(), authorityAccepted: "true" }, { ...collect(), authorityVersion: model.OPERATOR_MEMBERSHIP_AUTHORITY_VERSION }, { ...collect(), authorizationEvidence: "" }, { ...collect(), authorizationEvidence: "x".repeat(1501) }, { ...collect(), reviewToken: "bad" }, { ...quote(), requestId: "bad" }]) {
    assert.equal((await f.api.POST(request("POST", body), context())).status, 400);
  }
  assert.equal((await f.api.POST(request("POST", "x".repeat(4001)), context())).status, 413);
  assert.equal((await f.api.GET(request(), context("bad"))).status, 404);
  assert.equal(f.calls.length, 0);
});

test("saved-payment API retains the actual administrator separately from the beneficiary and evidence", async () => {
  const f = await fixture();
  await f.api.POST(request("POST", quote()), context());
  const response = await f.api.POST(request("POST", collect(), { "User-Agent": "test-agent" }), context());
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).state, "pending");
  assert.deepEqual(f.calls, [
    { name: "quote", args: [{ authUserId: actorId, memberId, requestId, plan: "monthly" }] },
    { name: "collect", args: [{ authUserId: actorId, memberId, reservationId: requestId, reviewToken: "a".repeat(64), authorityAccepted: true, authorityVersion: model.OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION, authorizationEvidence: collect().authorizationEvidence, applicationOrigin: "https://canonical.example.test", userAgent: "test-agent" }] },
  ]);
});

test("saved-payment API never leaks provider secrets or converts an unknown outcome to paid", async () => {
  const f = await fixture(); f.fail(new Error("sk_live_fixture private payment details"));
  const response = await f.api.POST(request("POST", collect()), context());
  assert.equal(response.status, 503);
  const text = await response.text(); assert.match(text, /could not be confirmed/); assert.doesNotMatch(text, /sk_live|private payment details|"state":"paid"/);
});
