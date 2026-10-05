import assert from "node:assert/strict";
import * as phone from "libphonenumber-js/min";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
const origin = "https://members.example.test";
const contextCookie = "ruined-direct-signup-context";
const invitationToken = "D".repeat(43);
const invitationId = "22222222-2222-4222-8222-222222222222";
const input = { requestId: "11111111-1111-4111-8111-111111111111", recipientName: "New Member", recipientEmail: "new@example.test", billingPlan: "annual" };
const viewer = { authUserId: "33333333-3333-4333-8333-333333333333", email: input.recipientEmail };
class PlatformAccessDeniedError extends Error {}
async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const invitationModel = await load("src/lib/membership/invitation-model.ts");
const personalModel = await load("src/lib/membership/personal-invitation-model.ts", { "./invitation-model": invitationModel, "libphonenumber-js/min": phone });
const pricing = await load("src/lib/membership/pricing.ts");
const request = (path, body, cookie, overrides = {}) => new NextRequest(origin + path, {
  method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie: `${contextCookie}=${cookie}` } : {}), ...overrides.headers },
  body: overrides.rawBody ?? JSON.stringify(body),
});
async function fixture(overrides = {}) {
  const state = { mode: "connected", ready: true, trusted: true, rateAllowed: true, eligible: true, issued: true,
    member: "none", operator: "none", admission: true, resolve: true, ...overrides };
  const calls = [], logs = [];
  const dependencies = {
    "node:crypto": crypto, "next/server": { NextResponse },
    "@/lib/auth/request": { DIRECT_SIGNUP_CONTEXT_COOKIE: contextCookie, MEMBER_INVITATION_CONTEXT_COOKIE: "ruined-invitation-context",
      MEMBER_SIGNUP_CONTEXT_COOKIE: "ruined-signup-context", isTrustedPlatformOrigin: () => state.trusted,
      getMemberEmailConfirmationUrl: () => state.confirmation === false ? null : `${origin}/my/confirmed` },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: state.mode, membershipSignupReady: state.ready }) },
    "@/lib/membership/pricing": pricing, "@/lib/membership/invitation-model": invitationModel,
    "@/lib/membership/personal-invitation-model": personalModel,
    "@/lib/membership/public-signup-admission": {
      consumePublicMembershipSignupRateLimit: async email => { calls.push({ rate: email }); return state.rateAllowed; },
      getPublicMembershipSignupEligibility: async email => { calls.push({ publicEligibility: email }); return state.eligible; },
    },
    "@/lib/membership/direct-invitation-repository": {
      issueRuinedDirectInvitation: async (value, options) => { calls.push({ issue: value, options }); return state.issued ? { invitationId, created: true } : null; },
      resolveRuinedDirectInvitationToken: async (email, context) => {
        calls.push({ resolve: { email, context } });
        return state.resolve && email === input.recipientEmail && (context.invitationId === invitationId || context.token === invitationToken) ? invitationToken : null;
      },
    },
    "@/lib/membership/personal-invitation-admission": { getPersonalInvitationAdmissionEligibility: async (email, token) => {
      calls.push({ admission: { email, token } }); return state.admission && email === input.recipientEmail && token === invitationToken;
    } },
    "@/lib/platform/repository": { PlatformAccessDeniedError },
    "@/lib/auth/platform-access": {
      getUnifiedAccessEligibility: async email => { calls.push({ access: email }); return { eligible: state.member !== "none" || state.operator !== "none", member: state.member, operator: state.operator }; },
      completePlatformSignIn: async (identity, context) => {
        calls.push({ claim: identity, context });
        if (state.claimDenied) throw new PlatformAccessDeniedError();
        return { redirectTo: context ? "/my/join" : state.destination ?? "/my" };
      },
      getSupportSignInDestination: () => assert.fail("Direct signup must use a server-selected destination."),
    },
    "@/lib/supabase/server": { createSupabaseCurrentResponseClient: ({ response }) => state.noProvider ? null : { auth: {
      signInWithOtp: async value => { calls.push({ send: value }); if (state.providerThrows) throw new Error("private provider detail"); return { error: state.providerError ?? null }; },
      verifyOtp: async value => { calls.push({ verify: value }); response.cookies.set("test-session", "verified", { httpOnly: true, path: "/" });
        return { data: { user: state.badCode ? null : { id: viewer.authUserId, email: state.wrongEmail ? "other@example.test" : viewer.email } }, error: state.badCode ? {} : null }; },
      signOut: async options => { calls.push({ signout: options }); response.cookies.set("test-session", "", { maxAge: 0 }); return { error: null }; },
    } } },
  };
  const console = { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) };
  return { state, calls, logs, start: (await load("app/api/membership/signup/start/route.ts", dependencies, { console })).POST,
    verify: (await load("app/api/auth/otp/verify/route.ts", dependencies, { console })).POST };
}
async function generic(response) {
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, requestId: input.requestId });
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.cookies.getAll().length, 1);
  const cookie = response.cookies.get(contextCookie);
  assert.match(cookie.value, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, "lax"); assert.equal(cookie.path, "/"); assert.equal(cookie.maxAge, 3600);
  assert.equal(response.cookies.get("test-session"), undefined);
}
test("inline registration creates tracked standard invitation context and sends only an email code", async () => {
  const f = await fixture();
  const response = await f.start(request("/api/membership/signup/start", input));
  const cookie = response.cookies.get(contextCookie).value;
  await generic(response);
  assert.equal(cookie, invitationToken);
  assert.deepEqual(f.calls.find(call => call.issue), { issue: input, options: { emailDelivery: false } });
  assert.deepEqual(f.calls.find(call => call.send), { send: { email: input.recipientEmail, options: { shouldCreateUser: true, emailRedirectTo: `${origin}/my/confirmed` } } });
  assert.equal(f.calls.some(call => call.claim || call.verify), false);
});
test("returning, blocked, throttled and unissued requests cannot be distinguished through response shape", async () => {
  for (const state of [{ member: "returning" }, { operator: "returning" }, { eligible: false }, { rateAllowed: false }, { issued: false }, { admission: false }]) {
    const f = await fixture(state);
    await generic(await f.start(request("/api/membership/signup/start", input)));
    assert.equal(f.calls.some(call => call.claim), false);
    if (state.member || state.operator) {
      assert.equal(f.calls.some(call => call.issue), false);
      assert.deepEqual(f.calls.find(call => call.send), { send: { email: input.recipientEmail, options: { shouldCreateUser: false } } });
    } else assert.equal(f.calls.some(call => call.send), false);
  }
});
test("throttled or provider-rejected resends preserve previously issued context without exposing provider details", async () => {
  for (const state of [{ rateAllowed: false }, { providerError: { code: "over_email_send_rate_limit", status: 429 } }, { providerThrows: true }]) {
    const f = await fixture(state);
    const response = await f.start(request("/api/membership/signup/start", input, invitationToken));
    assert.equal(response.cookies.get(contextCookie).value, invitationToken);
    await generic(response);
    assert.doesNotMatch(JSON.stringify(f.logs), /private provider detail|new@example|D{43}/);
  }
});
test("origins, readiness, strict input and payload size are checked before direct issuance or OTP delivery", async () => {
  for (const [options, body, requestOptions, status] of [
    [{ trusted: false }, input, {}, 403], [{ ready: false }, input, {}, 503], [{ mode: "preview" }, input, {}, 503],
    [{}, { ...input, membershipType: "complimentary" }, {}, 400], [{}, { ...input, sendEmail: false }, {}, 400],
    [{}, { ...input, requestId: "invalid" }, {}, 400], [{}, { ...input, billingPlan: "free" }, {}, 400],
    [{}, { ...input, recipientName: "bad\nBcc: header" }, {}, 400], [{}, { ...input, recipientEmail: "wrong" }, {}, 400],
    [{}, input, { rawBody: "{" }, 400], [{}, input, { headers: { "content-type": "text/plain" } }, 415],
    [{}, input, { headers: { "content-length": "99999" } }, 413],
  ]) {
    const f = await fixture(options);
    assert.equal((await f.start(request("/api/membership/signup/start", body, undefined, requestOptions))).status, status);
    assert.deepEqual(f.calls, []);
  }
});
const verifyBody = { email: input.recipientEmail, token: "123456", directSignup: true };
test("verified inline signup accepts only its recipient-bound server context then releases session cookies", async () => {
  const f = await fixture();
  const response = await f.verify(request("/api/auth/otp/verify", { ...verifyBody, returnTo: "/ops" }, invitationToken));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { redirectTo: "/my/join" });
  assert.deepEqual(f.calls.find(call => call.claim), { claim: viewer, context: { invitationToken } });
  assert.ok(f.calls.findIndex(call => call.verify) < f.calls.findIndex(call => call.claim));
  assert.equal(response.cookies.get("test-session").value, "verified");
  assert.equal(response.cookies.get(contextCookie).maxAge, 0);
});
test("invalid, mismatched, expired, revoked, or forged direct context cannot reach provider verification", async () => {
  for (const [options, body, cookie] of [
    [{}, verifyBody, undefined], [{}, verifyBody, "bad"], [{}, verifyBody, "M".repeat(43)],
    [{}, { ...verifyBody, email: "another@example.test" }, invitationToken], [{ resolve: false }, verifyBody, invitationToken],
    [{ admission: false }, verifyBody, invitationToken], [{ ready: false }, verifyBody, invitationToken],
    [{}, { ...verifyBody, invitationToken }, invitationToken], [{}, { ...verifyBody, directSignup: "true" }, invitationToken],
    [{ member: "invited", resolve: false }, verifyBody, invitationToken],
  ]) {
    const f = await fixture(options);
    const response = await f.verify(request("/api/auth/otp/verify", body, cookie));
    assert.equal(response.status, 401);
    assert.equal(f.calls.some(call => call.verify || call.claim), false);
    assert.notEqual(response.cookies.get("test-session")?.value, "verified");
  }
});
test("incorrect codes, wrong provider identity, and revoked atomic claims never release authenticated cookies", async () => {
  for (const options of [{ badCode: true }, { wrongEmail: true }, { claimDenied: true }]) {
    const f = await fixture(options);
    const response = await f.verify(request("/api/auth/otp/verify", verifyBody, invitationToken));
    assert.equal(response.status, 401);
    assert.equal(response.cookies.get("test-session").value, "");
    if (!options.claimDenied) assert.equal(f.calls.some(call => call.claim), false);
    assert.deepEqual(f.calls.find(call => call.signout), { signout: { scope: "local" } });
  }
});
test("returning accounts use ordinary authorization and the server-selected destination without reacquisition", async () => {
  for (const options of [{ member: "returning" }, { operator: "returning", destination: "/ops" }]) {
    const f = await fixture(options);
    const response = await f.verify(request("/api/auth/otp/verify", { ...verifyBody, returnTo: "/my/join" }, invitationToken));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { redirectTo: options.destination ?? "/my" });
    assert.deepEqual(f.calls.find(call => call.claim), { claim: viewer, context: undefined });
    assert.equal(f.calls.some(call => call.resolve || call.admission), false);
  }
});
