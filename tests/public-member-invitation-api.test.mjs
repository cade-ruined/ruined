import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
const origin = "https://members.example.test";
const path = "/api/membership/signup/invitation";
const requestId = "11111111-1111-4111-8111-111111111111";
const input = { requestId, recipientName: "New Member", recipientEmail: "new@example.test", billingPlan: "annual" };

async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}

const invitationModel = await load("src/lib/membership/invitation-model.ts");
const personalModel = await load("src/lib/membership/personal-invitation-model.ts", { "./invitation-model": invitationModel });
const pricing = await load("src/lib/membership/pricing.ts");

async function fixture(options = {}) {
  const calls = [], logs = [];
  const state = { trusted: true, mode: "connected", checkoutReady: true, emailReady: true,
    rateAllowed: true, eligible: true, issued: { invitationId: "22222222-2222-4222-8222-222222222222", created: true }, ...options };
  const route = await load("app/api/membership/signup/invitation/route.ts", {
    "next/server": { NextResponse },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => state.trusted },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: state.mode, stripeCheckoutReady: state.checkoutReady }) },
    "@/lib/membership/pricing": pricing,
    "@/lib/membership/invitation-model": invitationModel,
    "@/lib/membership/personal-invitation-model": personalModel,
    "@/lib/membership/public-signup-admission": {
      consumePublicMembershipSignupRateLimit: async (email, request) => {
        calls.push({ throttle: email });
        assert.equal(request.url, origin + path);
        if (state.rateError) throw state.rateError;
        return state.rateAllowed;
      },
      getPublicMembershipSignupEligibility: async email => { calls.push({ eligibility: email }); return state.eligible; },
    },
    "@/lib/membership/direct-invitation-repository": { issueRuinedDirectInvitation: async value => {
      calls.push({ issue: value });
      if (state.issueError) throw state.issueError;
      return state.issued;
    } },
    "@/lib/membership/personal-invitation-delivery": {
      getPersonalInvitationEmailReady: () => state.emailReady,
      processPersonalInvitationEmailBatch: async (...args) => {
        calls.push({ delivery: args });
        assert.ok(calls.some(call => call.issue), "An invitation must commit before its delivery worker runs.");
        if (state.deliveryError) throw state.deliveryError;
      },
    },
  }, { console: { error: (...args) => logs.push(args) } });
  const request = (body = input, overrides = {}) => new NextRequest(origin + path, {
    method: "POST", headers: { origin, "content-type": "application/json", ...overrides.headers },
    body: overrides.rawBody ?? JSON.stringify(body),
  });
  return { ...route, calls, logs, state, request };
}

async function generic(response, id = requestId) {
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, requestId: id });
  assert.equal(response.cookies.getAll().length, 0, "Issuance never signs the recipient in.");
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
}

test("untrusted origin, preview, closed launch, and missing delivery config cannot issue cards or reach Auth", async () => {
  for (const [options, status] of [
    [{ trusted: false }, 403], [{ mode: "preview" }, 503], [{ checkoutReady: false }, 503], [{ emailReady: false }, 503],
  ]) {
    const f = await fixture(options);
    // Malformed content must not make the closed launch perform any work.
    const response = await f.POST(f.request(input, { rawBody: "{" }));
    assert.equal(response.status, status);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.logs, []);
    assert.equal(response.cookies.getAll().length, 0);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});

test("a standard invitation request normalizes recipient data and keeps the bearer token out of the public response", async () => {
  for (const billingPlan of ["monthly", "annual"]) {
    const f = await fixture();
    await generic(await f.POST(f.request({ ...input, billingPlan, recipientName: " New   Member ", recipientEmail: " NEW@EXAMPLE.TEST " })));
    assert.deepEqual(f.calls, [
      { throttle: input.recipientEmail }, { eligibility: input.recipientEmail },
      { issue: { ...input, billingPlan } }, { delivery: [1, { invitationId: f.state.issued.invitationId }] },
    ]);
    assert.deepEqual(f.logs, []);
  }
});

test("blocked and rate-limited identities receive the same response without invitation issuance or delivery", async () => {
  for (const options of [{ eligible: false }, { rateAllowed: false }, { issued: null }]) {
    const f = await fixture(options);
    await generic(await f.POST(f.request()));
    assert.equal(f.calls.some(call => call.delivery), false);
    if (options.eligible === false || options.rateAllowed === false) assert.equal(f.calls.some(call => call.issue), false);
    if (options.rateAllowed === false) assert.deepEqual(f.calls, [{ throttle: input.recipientEmail }]);
  }
});

test("owner, free-benefit, role, token, deadline and delivery overrides cannot be supplied by public callers", async () => {
  for (const extra of [
    { memberId: requestId }, { owner: requestId }, { origin: "member" }, { membershipType: "complimentary" },
    { complimentaryReason: "founder" }, { complimentaryEndsAt: null }, { role: "ops_admin" }, { sendEmail: false },
    { publicToken: "P".repeat(43) }, { expiresAt: "2099-01-01T00:00:00Z" }, { signup: { plan: "annual" } },
  ]) {
    const f = await fixture();
    assert.equal((await f.POST(f.request({ ...input, ...extra }))).status, 400);
    assert.deepEqual(f.calls, []);
  }
});

test("invalid recipients, plans and unbounded JSON are rejected before eligibility or delivery", async () => {
  const invalid = [null, [], {}, { ...input, requestId: "bad" }, { ...input, recipientName: "" },
    { ...input, recipientName: "x".repeat(101) }, { ...input, recipientEmail: "invalid" },
    { ...input, recipientName: "New\nMember" }, { ...input, recipientEmail: "new@example.test\r\nBcc: other@example.test" },
    ...[undefined, null, "free", "Annual", {}, []].map(billingPlan => ({ ...input, billingPlan }))];
  for (const body of invalid) {
    const f = await fixture();
    assert.equal((await f.POST(f.request(body))).status, 400);
    assert.deepEqual(f.calls, []);
  }
  for (const [overrides, status] of [
    [{ rawBody: "{" }, 400], [{ headers: { "content-type": "text/plain" } }, 415],
    [{ rawBody: JSON.stringify({ ...input, recipientName: "x".repeat(5000) }) }, 413],
    [{ headers: { "content-length": "99999" } }, 413],
  ]) {
    const f = await fixture();
    assert.equal((await f.POST(f.request(input, overrides))).status, status);
    assert.deepEqual(f.calls, []);
  }
});

test("repository and delivery failures expose no recipient, token, provider payload or application session", async () => {
  for (const failure of ["rateError", "issueError", "deliveryError"]) {
    const f = await fixture({ [failure]: new Error("private@example.test secret-card-token provider-payload") });
    const response = await f.POST(f.request());
    assert.equal(response.status, 503);
    assert.equal(response.cookies.getAll().length, 0);
    assert.doesNotMatch(JSON.stringify(await response.json()) + JSON.stringify(f.logs), /private@example|secret-card|provider-payload/);
    assert.deepEqual(f.logs, [["Ruined Direct invitation request failed", { errorType: "Error" }]]);
    if (failure !== "deliveryError") assert.equal(f.calls.some(call => call.delivery), false);
  }
});
