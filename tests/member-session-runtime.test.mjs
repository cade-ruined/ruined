import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
const { createServerClient } = require("@supabase/ssr");
const viewer = { authUserId: "11111111-1111-4111-8111-111111111111", email: "member@example.test" };
const claims = { sub: viewer.authUserId, email: viewer.email };
async function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const errors = await load("src/lib/auth/session-errors.ts");
const config = await load("src/lib/supabase/config.ts");
async function sessionModule(client = null, setupError = null) {
  return load("src/lib/auth/session.ts", {
    "@/lib/auth/session-errors": errors,
    "@/lib/supabase/server": { createSupabaseServerClient: async () => { if (setupError) throw setupError; return client; } },
  });
}
function client({ error = null, thrown = null, currentClaims = claims, currentUser = { id: viewer.authUserId, email: viewer.email }, userError = null } = {}) {
  let userChecks = 0;
  return {
    get userChecks() { return userChecks; },
    auth: {
      getClaims: async () => { if (thrown) throw thrown; return { data: currentClaims ? { claims: currentClaims } : null, error }; },
      getUser: async () => { userChecks++; return { data: { user: currentUser }, error: userError }; },
    },
  };
}

test("session resolution validates claims and preserves the existing viewer API", async () => {
  const api = await sessionModule(client());
  assert.deepEqual(await api.resolveCurrentPlatformSession(), { status: "authenticated", viewer });
  assert.deepEqual(await api.getCurrentPlatformViewer(), viewer);
  for (const currentClaims of [null, {}, { ...claims, sub: "not-a-user" }, { ...claims, email: "invalid" }]) {
    const invalid = await sessionModule(client({ currentClaims }));
    assert.deepEqual(await invalid.resolveCurrentPlatformSession(), { status: "signed_out" });
    assert.equal(await invalid.getCurrentPlatformViewer(), null);
  }
});

test("session resolution separates invalid credentials from provider and network failures", async () => {
  const api = await sessionModule();
  for (const error of [
    { code: "refresh_token_not_found", status: 400 }, { code: "refresh_token_already_used", status: 400 },
    { code: "session_expired", status: 401 }, { code: "user_banned", status: 403 },
    { name: "AuthSessionMissingError", status: 400 }, { name: "AuthInvalidJwtError", status: 400 },
  ]) assert.deepEqual(await api.resolvePlatformSession(client({ error })), { status: "signed_out" }, JSON.stringify(error));
  for (const error of [
    { name: "AuthRetryableFetchError", status: 503 }, { code: "unexpected_failure", status: 500 },
    { code: "over_request_rate_limit", status: 429 }, { code: "new_provider_failure", status: 400 },
    new TypeError("Network unavailable"), new DOMException("Aborted", "AbortError"),
  ]) {
    assert.deepEqual(await api.resolvePlatformSession(client({ error })), { status: "unavailable" });
    assert.deepEqual(await api.resolvePlatformSession(client({ thrown: error })), { status: "unavailable" });
  }
  assert.deepEqual(await api.resolveCurrentPlatformSession(), { status: "unavailable" });
  assert.deepEqual(await (await sessionModule(null, new Error("setup failed"))).resolveCurrentPlatformSession(), { status: "unavailable" });
});

test("foreground verification rejects deleted or mismatched identities without disclosing them", async () => {
  const api = await sessionModule();
  for (const input of [{ currentUser: null }, { currentUser: { id: "22222222-2222-4222-8222-222222222222", email: viewer.email } },
    { currentUser: { id: viewer.authUserId, email: "another@example.test" } }, { userError: { code: "user_not_found", status: 404 } }]) {
    const sdk = client(input);
    assert.deepEqual(await api.resolvePlatformSession(sdk, { verifyCurrentUser: true }), { status: "signed_out" });
    assert.equal(sdk.userChecks, 1);
  }
  assert.deepEqual(await api.resolvePlatformSession(client({ userError: { name: "AuthRetryableFetchError", status: 503 } }), { verifyCurrentUser: true }), { status: "unavailable" });
});

async function routeFixture(sdk, { changes = [], mode = "connected", owner, failSetup = false } = {}) {
  const api = await sessionModule();
  const route = await load("app/api/auth/session/route.ts", {
    "next/server": { NextResponse }, "@/lib/auth/session": api,
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
    "@/lib/supabase/server": { createSupabaseCurrentResponseClient: ({ response }) => {
      if (failSetup) throw Error("Setup unavailable");
      for (const cookie of changes) response.cookies.set(cookie);
      response.headers.set("Vary", "Accept-Encoding"); return sdk;
    } },
  });
  const request = new NextRequest("https://members.example.test/api/auth/session", { headers: owner ? { "X-Ruined-Session-Owner": owner } : {} });
  return route.GET(request);
}

test("session endpoint returns private status only and differentiates recovery, logout and account changes", async () => {
  for (const [sdk, options, status, payload] of [
    [client(), {}, 200, "authenticated"], [client(), { owner: viewer.authUserId }, 200, "authenticated"],
    [client(), { owner: "22222222-2222-4222-8222-222222222222" }, 409, "account_changed"],
    [client({ currentClaims: null }), {}, 401, "signed_out"],
    [client({ error: { code: "refresh_token_not_found", status: 400 } }), {}, 401, "signed_out"],
    [client({ error: { name: "AuthRetryableFetchError", status: 503 } }), {}, 503, "unavailable"],
    [client(), { mode: "preview" }, 503, "unavailable"], [client(), { failSetup: true }, 503, "unavailable"],
  ]) {
    const response = await routeFixture(sdk, options);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { status: payload });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
    assert.match(response.headers.get("Vary"), /Cookie/);
    assert.equal(response.headers.get("Retry-After"), status === 503 ? "5" : null);
  }
});

test("temporary session checks preserve cookies; genuine invalid sessions clear them; rotation is retained", async () => {
  const cleared = { name: "sb-fixture-auth-token", value: "", maxAge: 0, path: "/" };
  const unavailable = client({ error: { code: "unknown_provider_failure", status: 400 } });
  assert.equal((await routeFixture(unavailable, { changes: [cleared] })).cookies.getAll().length, 0);
  const invalid = await routeFixture(client({ error: { code: "refresh_token_not_found", status: 400 } }), { changes: [cleared] });
  assert.equal(invalid.cookies.get(cleared.name).maxAge, 0);
  const rotated = { name: "sb-fixture-auth-token.0", value: "rotated", ...config.SUPABASE_COOKIE_OPTIONS, secure: true };
  const response = await routeFixture(unavailable, { changes: [cleared, rotated] });
  assert.equal(response.status, 503);
  assert.equal(response.cookies.get(rotated.name).value, "rotated");
  assert.equal(response.cookies.get(rotated.name).maxAge, 400 * 24 * 60 * 60);
  assert.equal(response.cookies.get(rotated.name).secure, true);
});

function fakeJwt(exp) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ...claims, exp, aud: "authenticated", iat: exp - 3600 })}.${Buffer.from("fixture-signature").toString("base64url")}`;
}

test("actual Supabase SSR rotates an expired token into persistent response cookies without requesting another OTP", async () => {
  const user = { id: viewer.authUserId, email: viewer.email, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" };
  const now = Math.floor(Date.now() / 1000);
  const old = { access_token: fakeJwt(now - 60), refresh_token: "old-refresh", expires_at: now - 60, expires_in: 3600, token_type: "bearer", user };
  const current = { ...old, access_token: fakeJwt(now + 3600), refresh_token: "rotated-refresh", expires_at: now + 3600 };
  const cookieName = "sb-session-test-auth-token";
  const request = new NextRequest("https://members.example.test/api/auth/session", { headers: { Cookie: `${cookieName}=base64-${Buffer.from(JSON.stringify(old)).toString("base64url")}` } });
  const calls = [];
  const fakeFetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    assert.equal(url.hostname, "session-test.example.test", "Only the isolated fake provider may be called");
    if (url.pathname === "/auth/v1/token") {
      assert.equal(JSON.parse(init.body).refresh_token, "old-refresh");
      assert.equal(url.searchParams.get("grant_type"), "refresh_token");
      return Response.json(current);
    }
    if (url.pathname === "/auth/v1/user") return Response.json(user);
    throw Error(`Unexpected provider call ${url.pathname}`);
  };
  const server = await load("src/lib/supabase/server.ts", {
    "@supabase/ssr": { createServerClient: (url, key, options) => createServerClient(url, key, { ...options, global: { fetch: fakeFetch } }) },
    "next/headers": { cookies: () => { throw Error("Only response-bound client is allowed"); } },
    "next/server": { NextResponse },
    "@/lib/supabase/config": { SUPABASE_COOKIE_OPTIONS: { ...config.SUPABASE_COOKIE_OPTIONS, secure: true }, getSupabasePublicConfig: () => ({ url: "https://session-test.example.test", publishableKey: "fixture-publishable" }) },
  });
  const route = await load("app/api/auth/session/route.ts", {
    "next/server": { NextResponse }, "@/lib/auth/session": await sessionModule(),
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) }, "@/lib/supabase/server": server,
  });
  const response = await route.GET(request);
  assert.equal(response.status, 200, JSON.stringify({ calls, body: await response.clone().json(), cookieNames: response.cookies.getAll().map(cookie => cookie.name) })); assert.deepEqual(await response.json(), { status: "authenticated" });
  assert.equal(calls.filter(path => path === "/auth/v1/token").length, 1);
  assert.ok(calls.includes("/auth/v1/user")); assert.ok(!calls.some(path => path.includes("otp")));
  const rotated = response.cookies.getAll().filter(cookie => cookie.name.startsWith(cookieName) && cookie.value);
  assert.ok(rotated.length > 0);
  assert.match(Buffer.from(rotated.map(cookie => cookie.value).join("").replace(/^base64-/, ""), "base64url").toString(), /rotated-refresh/);
  for (const cookie of rotated) { assert.equal(cookie.maxAge, 400 * 24 * 60 * 60); assert.equal(cookie.secure, true); assert.equal(cookie.sameSite, "lax"); assert.equal(cookie.path, "/"); }
  assert.ok(request.cookies.getAll().some(cookie => cookie.name.startsWith(cookieName) && cookie.value !== `base64-${Buffer.from(JSON.stringify(old)).toString("base64url")}`));
});

test("middleware preserves stored login on temporary cleanup and propagates valid refresh or invalid-session cleanup", async () => {
  for (const outcome of ["unavailable", "authenticated", "signed_out"]) {
    const route = await load("src/lib/supabase/middleware.ts", {
      "@/lib/auth/session-errors": errors,
      "@supabase/ssr": { createServerClient: (_url, _key, options) => ({ auth: { getClaims: async () => {
        options.cookies.setAll([{ name: "sb-fixture-auth-token", value: outcome === "authenticated" ? "new-session" : "", options: { path: "/", maxAge: outcome === "authenticated" ? 34560000 : 0 } }], { "Cache-Control": "private, no-store" });
        return { data: outcome === "authenticated" ? { claims } : null, error: outcome === "unavailable" ? { code: "unknown_provider_failure", status: 400 } : outcome === "signed_out" ? { code: "refresh_token_not_found", status: 400 } : null };
      } } }) },
      "next/server": { NextResponse },
      "@/lib/supabase/config": { SUPABASE_COOKIE_OPTIONS: config.SUPABASE_COOKIE_OPTIONS, getSupabasePublicConfig: () => ({ url: "https://fixture.example.test", publishableKey: "fixture" }) },
      "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    });
    const request = new NextRequest("https://members.example.test/my", { headers: { Cookie: "sb-fixture-auth-token=old-session" } });
    const result = await route.refreshSupabaseMiddlewareSession(request);
    assert.deepEqual(result.claims, outcome === "authenticated" ? claims : null);
    assert.equal(request.cookies.get("sb-fixture-auth-token").value, outcome === "unavailable" ? "old-session" : outcome === "authenticated" ? "new-session" : "");
    assert.equal(result.response.cookies.getAll().length, outcome === "unavailable" ? 0 : 1);
    assert.equal(result.response.headers.get("Cache-Control"), "private, no-store");
  }
});

test("sign out revokes only this device and retains the origin boundary", async () => {
  const calls = [];
  const route = await load("app/api/auth/sign-out/route.ts", {
    "next/server": { NextResponse }, "@/lib/auth/request": { isTrustedPlatformOrigin: request => request.headers.get("Origin") === "https://members.example.test" },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/supabase/server": { createSupabaseCurrentResponseClient: ({ response }) => ({ auth: { signOut: async options => { calls.push(options); response.cookies.set("sb-fixture-auth-token", "", { path: "/", maxAge: 0 }); return { error: null }; } } }) },
  });
  const denied = await route.POST(new NextRequest("https://members.example.test/api/auth/sign-out", { method: "POST", headers: { Origin: "https://elsewhere.example.test" } }));
  assert.equal(denied.status, 403); assert.deepEqual(calls, []);
  const response = await route.POST(new NextRequest("https://members.example.test/api/auth/sign-out", { method: "POST", headers: { Origin: "https://members.example.test" } }));
  assert.equal(response.status, 303); assert.deepEqual(calls, [{ scope: "local" }]);
  assert.equal(response.cookies.get("sb-fixture-auth-token").maxAge, 0);
});

test("the install manifest never reads or refreshes an authenticated session", async () => {
  let calls = 0;
  const route = await load("middleware.ts", {
    "next/server": { NextResponse }, "@/lib/platform/visibility": { isMyRuinedVisible: () => true },
    "@/lib/supabase/middleware": { refreshSupabaseMiddlewareSession: async () => { calls++; return { response: NextResponse.next() }; } },
  });
  const manifest = await route.middleware(new NextRequest("https://members.example.test/my/manifest.webmanifest"));
  assert.equal(calls, 0); assert.equal(manifest.cookies.getAll().length, 0);
  await route.middleware(new NextRequest("https://members.example.test/my")); assert.equal(calls, 1);
});
