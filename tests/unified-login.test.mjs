import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
class PlatformAccessDeniedError extends Error {}
const viewer = { authUserId: "11111111-1111-4111-8111-111111111111", email: "person@example.com" };

async function load(path, dependencies) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "server-only") return {};
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

async function accessModule(member, operator, overrides = {}) {
  const calls = [];
  const api = await load("src/lib/auth/platform-access.ts", {
    "@/lib/auth/support-return": await load("src/lib/auth/support-return.ts", {}),
    "@/lib/platform/repository": {
      PlatformAccessDeniedError,
      getPasswordlessAccessEligibility: async (email, audience) => {
        assert.equal(email, viewer.email);
        return audience === "ops" ? operator : member;
      },
      claimPlatformMemberForViewer: async (input) => { assert.deepEqual(input, viewer); calls.push("member"); },
      getOperatorRole: async () => null,
      ...overrides.repository,
    },
    "@/lib/platform/ops-access-repository": {
      claimPlatformOperatorForViewer: async () => { calls.push("operator"); },
      ...overrides.operator,
    },
    "@/lib/platform/operator-member-profile": {
      ensureOperatorMemberProfile: async () => { calls.push("profile"); return { memberAccess: true }; },
      ...overrides.profile,
    },
  });
  return { ...api, calls };
}

test("one email check accepts either invitation but creates Auth only for a new invited identity", async () => {
  for (const member of ["none", "invited", "returning"]) {
    for (const operator of ["none", "invited", "returning"]) {
      const api = await accessModule(member, operator);
      const result = await api.getUnifiedAccessEligibility(viewer.email);
      assert.equal(result.eligible, member !== "none" || operator !== "none");
      assert.equal(result.shouldCreateUser, ![member, operator].includes("returning") && [member, operator].includes("invited"));
    }
  }
});

test("members and operators enter their profile with server-derived permissions", async () => {
  for (const [member, operator, destination, calls] of [
    ["returning", "none", "/my", ["member"]],
    ["invited", "none", "/my/join", ["member"]],
    ["none", "returning", "/my", ["operator", "profile"]],
    ["none", "invited", "/my", ["operator", "profile"]],
    ["invited", "invited", "/my", ["operator", "member", "profile"]],
    ["returning", "returning", "/my", ["operator", "member", "profile"]],
  ]) {
    const api = await accessModule(member, operator);
    assert.deepEqual(await api.completePlatformSignIn(viewer), { redirectTo: destination });
    assert.deepEqual(api.calls, calls);
  }
});

test("no invitation grants nothing; a revoked claim cannot be replaced by operator profile creation", async () => {
  const none = await accessModule("none", "none");
  await assert.rejects(none.completePlatformSignIn(viewer), PlatformAccessDeniedError);
  assert.deepEqual(none.calls, []);
  const revoked = await accessModule("none", "invited", {
    operator: { claimPlatformOperatorForViewer: async () => { throw new PlatformAccessDeniedError(); } },
  });
  await assert.rejects(revoked.completePlatformSignIn(viewer), PlatformAccessDeniedError);
  assert.deepEqual(revoked.calls, []);
});

test("a stale secondary invitation cannot lock out independently valid access", async () => {
  const memberStillWorks = await accessModule("returning", "invited", {
    operator: { claimPlatformOperatorForViewer: async () => { throw new PlatformAccessDeniedError(); } },
  });
  assert.deepEqual(await memberStillWorks.completePlatformSignIn(viewer), { redirectTo: "/my" });
  assert.deepEqual(memberStillWorks.calls, ["member"]);

  const operatorStillWorks = await accessModule("invited", "returning", {
    repository: {
      claimPlatformMemberForViewer: async () => { throw new PlatformAccessDeniedError(); },
    },
  });
  assert.deepEqual(await operatorStillWorks.completePlatformSignIn(viewer), { redirectTo: "/my" });
  assert.deepEqual(operatorStillWorks.calls, ["operator", "profile"]);
});

test("restricted member state remains restricted while separate operator permission can still work", async () => {
  const api = await accessModule("none", "returning", {
    profile: { ensureOperatorMemberProfile: async () => ({ memberAccess: false }) },
  });
  assert.deepEqual(await api.completePlatformSignIn(viewer), { redirectTo: "/ops" });
});

function request(path, body) {
  return new NextRequest(`http://localhost:3001/api/auth/otp/${path}`, {
    method: "POST", headers: { origin: "http://localhost:3001", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function routeModule(kind, options = {}) {
  const calls = [];
  const supportAccess = await accessModule("returning", options.admin ? "returning" : "none", {
    repository: { getOperatorRole: async () => options.admin ? "ops_admin" : null },
  });
  const api = await load(`app/api/auth/otp/${kind}/route.ts`, {
    "next/server": { NextResponse },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => options.trusted !== false, getMemberEmailConfirmationUrl: () => "https://ruined.example/my/confirmed" },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/platform/repository": { PlatformAccessDeniedError },
    "@/lib/auth/platform-access": {
      getUnifiedAccessEligibility: async () => { calls.push("eligibility"); return { eligible: options.eligible !== false, shouldCreateUser: options.newIdentity === true }; },
      completePlatformSignIn: async (input) => {
        calls.push("claim"); assert.deepEqual(input, viewer);
        if (options.denied) throw new PlatformAccessDeniedError();
        return { redirectTo: "/my" };
      },
      getSupportSignInDestination: supportAccess.getSupportSignInDestination,
    },
    "@/lib/supabase/server": {
      createSupabaseCurrentResponseClient: ({ request: req, response }) => ({ auth: {
        signInWithOtp: async (input) => { calls.push(input); return { error: null }; },
        verifyOtp: async () => {
          calls.push("verify");
          req.cookies.set("test-session", "verified");
          response.cookies.set("test-session", "verified", { httpOnly: true, sameSite: "lax", path: "/" });
          response.headers.set("Cache-Control", "private, no-store");
          return { error: null, data: { user: { id: viewer.authUserId, email: options.wrongEmail ? "other@example.com" : viewer.email } } };
        },
        signOut: async () => {
          calls.push("signout"); response.cookies.set("test-session", "", { maxAge: 0 });
          return { error: null };
        },
      } }),
    },
  });
  return { ...api, calls };
}

test("OTP delivery cannot be steered by a forged audience and stays generic for unknown addresses", async () => {
  const unknown = await routeModule("request", { eligible: false });
  assert.deepEqual(await (await unknown.POST(request("request", { email: viewer.email, audience: "ops" }))).json(), { ok: true });
  assert.deepEqual(unknown.calls, ["eligibility"]);
  const invited = await routeModule("request", { newIdentity: true });
  assert.equal((await invited.POST(request("request", { email: viewer.email, audience: "member" }))).status, 200);
  assert.deepEqual(invited.calls[1], { email: viewer.email, options: { shouldCreateUser: true, emailRedirectTo: "https://ruined.example/my/confirmed" } });
});

test("verification ignores client roles/destinations and carries verified cookies only after the claim", async () => {
  const api = await routeModule("verify");
  const response = await api.POST(request("verify", { email: viewer.email, token: "12345678", audience: "ops", next: "https://attacker.example" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { redirectTo: "/my" });
  assert.deepEqual(api.calls, ["eligibility", "verify", "claim"]);
  assert.equal(response.cookies.get("test-session")?.value, "verified");
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("changed permissions or mismatched verified email clear the new session and expose no destination", async () => {
  for (const options of [{ denied: true }, { wrongEmail: true }]) {
    const api = await routeModule("verify", options);
    const response = await api.POST(request("verify", { email: viewer.email, token: "123456" }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).redirectTo, undefined);
    assert.equal(response.cookies.get("test-session")?.value, "");
    assert.ok(api.calls.includes("signout"));
    if (options.wrongEmail) assert.ok(!api.calls.includes("claim"));
  }
});

test("untrusted requests and ineligible verification never reach Auth", async () => {
  for (const kind of ["request", "verify"]) {
    const api = await routeModule(kind, { trusted: false });
    assert.equal((await api.POST(request(kind, { email: viewer.email, token: "123456" }))).status, 403);
    assert.deepEqual(api.calls, []);
  }
  const denied = await routeModule("verify", { eligible: false });
  assert.equal((await denied.POST(request("verify", { email: viewer.email, token: "123456" }))).status, 401);
  assert.deepEqual(denied.calls, ["eligibility", "signout"]);
});

test("a failed new login clears an older browser session", async () => {
  const api = await routeModule("verify", { eligible: false });
  const req = request("verify", { email: viewer.email, token: "123456" });
  req.cookies.set("test-session", "older-account");
  const response = await api.POST(req);
  assert.equal(response.status, 401);
  assert.equal(response.cookies.get("test-session")?.value, "");
  assert.ok(api.calls.includes("signout"));
});

test("support returns accept only exact internal support paths", async () => {
  const helpers = await load("src/lib/auth/support-return.ts", {});
  for (const valid of ["/my/support", "/ops/support", `/my/support/${viewer.authUserId}`, `/ops/support/${viewer.authUserId}`]) {
    assert.equal(helpers.getSupportReturnTo(valid), valid);
    assert.equal(helpers.getSupportAccessUrl(valid), `/access?returnTo=${encodeURIComponent(valid)}`);
  }
  for (const invalid of [undefined, null, [], {}, 1, "https://attacker.example", "//attacker.example", "/my", "/ops/operators", "/my/support/", "/my/support/not-a-uuid", "/my/support?next=https://attacker.example", "/my/support#hello", "/my/support\n", " /my/support", "/my/support/../account", "/my/support/%2e%2e", "\\my\\support"]) {
    assert.equal(helpers.getSupportReturnTo(invalid), null);
    assert.equal(helpers.getSupportAccessUrl(invalid), "/access");
  }
});

test("support destination cannot create operator authority or change login eligibility", async () => {
  const member = await accessModule("returning", "none");
  assert.deepEqual(await member.completePlatformSignIn(viewer), { redirectTo: "/my" });
  assert.equal(await member.getSupportSignInDestination(viewer, `/my/support/${viewer.authUserId}`, "/my"), `/my/support/${viewer.authUserId}`);
  assert.equal(await member.getSupportSignInDestination(viewer, "/ops/support", "/my"), "/my");
  assert.deepEqual(member.calls, ["member"]);
  const shaper = await accessModule("none", "returning", { repository: { getOperatorRole: async () => "circle_leader" } });
  assert.equal(await shaper.getSupportSignInDestination(viewer, "/ops/support", "/my"), "/my");
  const admin = await accessModule("none", "returning", { repository: { getOperatorRole: async () => "ops_admin" } });
  assert.equal(await admin.getSupportSignInDestination(viewer, `/ops/support/${viewer.authUserId}`, "/my"), `/ops/support/${viewer.authUserId}`);
});

test("verified support links return to the ticket only after successful authorization", async () => {
  for (const [returnTo, admin, expected] of [
    [`/my/support/${viewer.authUserId}`, false, `/my/support/${viewer.authUserId}`],
    [`/ops/support/${viewer.authUserId}`, true, `/ops/support/${viewer.authUserId}`],
    ["/ops/support", false, "/my"],
    ["https://attacker.example", true, "/my"],
    ["//attacker.example", true, "/my"],
    ["/ops/operators", true, "/my"],
    ["/my/support?next=/ops", true, "/my"],
  ]) {
    const api = await routeModule("verify", { admin });
    const response = await api.POST(request("verify", { email: viewer.email, token: "123456", returnTo, next: "/ops", audience: "ops" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { redirectTo: expected });
    assert.deepEqual(api.calls, ["eligibility", "verify", "claim"]);
  }
  const denied = await routeModule("verify", { denied: true, admin: true });
  const response = await denied.POST(request("verify", { email: viewer.email, token: "123456", returnTo: "/ops/support" }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).redirectTo, undefined);
});
