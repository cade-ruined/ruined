import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}, logs = []) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "console", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "server-only") return {};
    if (name === "react/jsx-runtime") return require(name);
    throw Error(`Unexpected session page dependency: ${name}`);
  }, cjsModule, cjsModule.exports, { error: (...args) => logs.push(args) });
  return cjsModule.exports;
}

const viewer = { authUserId: "11111111-1111-4111-8111-111111111111", email: "member@example.test" };
const configuration = { getPlatformConfiguration: () => ({ mode: "connected" }) };
class MembershipAccessDeniedError extends Error {}
class PlatformAccessDeniedError extends Error {}
class PublicCardError extends Error {}
class MemberInvitationError extends Error {}
const Unavailable = () => null;
const Editor = () => null;
const Shell = () => null;
const Access = () => null;
const redirect = (href) => { throw Object.assign(Error("Redirect"), { href }); };

// Use the real session resolver so provider/network failures exercise the same
// classification as pages, rather than assuming a mocked status is correct.
function sessionFixture(outcome = "authenticated") {
  const api = load("src/lib/auth/session.ts", {
    "@/lib/auth/session-errors": load("src/lib/auth/session-errors.ts"),
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ auth: {
      getClaims: async () => {
        if (outcome === "network") throw new TypeError("PRIVATE provider transport failure");
        if (outcome === "unavailable") return { error: { status: 503, message: "PRIVATE provider error" } };
        if (outcome === "revoked") return { error: { status: 401, code: "session_not_found" } };
        if (outcome === "signed_out") return { data: null, error: null };
        return { data: { claims: { sub: viewer.authUserId, email: viewer.email } }, error: null };
      },
    } }) },
  });
  return api;
}

function contexts(session, { data = { private: "member snapshot" }, failure = null } = {}) {
  const reads = [], logs = [];
  const read = async (id) => { reads.push(id); if (failure) throw failure; return data; };
  const platform = load("src/lib/platform/page-data.ts", {
    "@/lib/auth/session": session,
    "@/lib/platform/config": configuration,
    "@/lib/platform/model": {},
    "@/lib/platform/repository": {
      getMemberPlatformSnapshot: read,
      getOperatorDashboard: async (id) => { const snapshot = await read(id); return snapshot && { dashboard: snapshot, role: "ops_admin" }; },
      getOperatorRole: async (id) => { await read(id); return data ? "ops_admin" : null; },
    },
  }, logs);
  const membership = load("src/lib/membership/page-context.ts", {
    "next/headers": { cookies: () => { throw Error("Connected mode must not read a preview scenario"); } },
    "@/lib/auth/session": session,
    "@/lib/platform/config": configuration,
    "@/lib/membership/preview-scenarios": {},
    "@/lib/membership/repository": { MembershipAccessDeniedError },
  }, logs);
  return { reads, logs, getters: [
    () => membership.getMembershipPageContext({ preview: true }, read, "test"),
    platform.getMemberPageContext,
    platform.getOperatorPageContext,
    platform.getOperatorAccessContext,
  ] };
}

test("member and operator contexts never turn provider outages into signed-out state or read private data", async () => {
  for (const outcome of ["unavailable", "network", "revoked", "signed_out"]) {
    const fixture = contexts(sessionFixture(outcome));
    for (const read of fixture.getters) {
      const context = await read();
      assert.equal(context.state, ["unavailable", "network"].includes(outcome) ? "unavailable" : "signed_out", outcome);
      assert.equal(context.viewer, null);
      assert.equal(context.data ?? context.member ?? context.dashboard ?? null, null);
    }
    assert.deepEqual(fixture.reads, []);
    assert.doesNotMatch(JSON.stringify(fixture.logs), /PRIVATE|member@example/);
  }
});

test("authenticated contexts retain identity through a data outage and still enforce member denial", async () => {
  for (const options of [{}, { data: null }, { failure: Object.assign(Error("PRIVATE database failure"), { code: "08006" }) }]) {
    const fixture = contexts(sessionFixture(), options);
    for (const read of fixture.getters) {
      const context = await read();
      assert.equal(context.state, options.failure ? "unavailable" : options.data === null ? "denied" : "authenticated");
      assert.deepEqual(context.viewer, viewer);
    }
    assert.deepEqual(fixture.reads, Array(4).fill(viewer.authUserId));
    assert.doesNotMatch(JSON.stringify(fixture.logs), /PRIVATE|member@example/);
  }
  const denied = contexts(sessionFixture(), { failure: new MembershipAccessDeniedError() });
  assert.equal((await denied.getters[0]()).state, "denied");
});

test("direct card and invitation pages render connection fallback during auth outages and redirect only a lost session", async () => {
  for (const path of ["app/my/card/page.tsx", "app/my/invitation/page.tsx"]) {
    for (const outcome of ["unavailable", "network", "revoked", "signed_out", "authenticated"]) {
      const reads = [];
      const read = async (id) => { reads.push(id); return { writable: true }; };
      const page = load(path, {
        "next/navigation": { redirect },
        "@/components/membership/MemberCardEditor": Editor,
        "@/components/membership/MemberInvitation": Editor,
        "@/components/platform/PlatformUnavailable": Unavailable,
        "@/lib/auth/session": sessionFixture(outcome),
        "@/lib/platform/config": configuration,
        "@/lib/membership/public-card-repository": { getOwnMemberCard: read },
        "@/lib/membership/personal-invitation-repository": { getOwnPersonalInvitations: read },
        "@/lib/membership/personal-invitation-delivery": { getPersonalInvitationEmailReady: () => false },
        "@/lib/membership/public-card-preview": {},
        "@/lib/membership/personal-invitation-preview": {},
        "@/lib/membership/public-card-model": { PublicCardError },
        "@/lib/membership/invitation-model": { MemberInvitationError },
      });
      if (["revoked", "signed_out"].includes(outcome)) await assert.rejects(page.default({}), { href: "/my/access" });
      else {
        const tree = await page.default({});
        assert.equal(tree.type, outcome === "authenticated" ? Editor : Unavailable);
        if (outcome !== "authenticated") assert.equal(tree.props.accessHref, undefined, "an outage must not ask for another sign-in");
      }
      assert.deepEqual(reads, outcome === "authenticated" ? [viewer.authUserId] : []);
    }
  }
});

test("access page preserves valid sessions through provider, claim and destination failures without offering a fresh sign-in", async () => {
  for (const scenario of ["unavailable", "network", "claim-outage", "destination-outage", "denied", "signed_out", "authenticated"]) {
    const calls = [];
    const page = load("app/access/page.tsx", {
      "next/navigation": { redirect },
      "@/components/membership/MemberJourneyShell": Shell,
      "@/components/platform/AccessPage": Access,
      "@/components/platform/PlatformUnavailable": Unavailable,
      "@/lib/auth/session": sessionFixture(scenario),
      "@/lib/platform/config": configuration,
      "@/lib/platform/repository": { PlatformAccessDeniedError },
      "@/lib/auth/support-return": { getSupportReturnTo: () => "/my/support" },
      "@/lib/sharing": { sharingMetadata: () => ({}) },
      "@/lib/auth/platform-access": {
        completePlatformSignIn: async (identity) => {
          assert.deepEqual(identity, viewer); calls.push("claim");
          if (scenario === "claim-outage") throw Error("PRIVATE database failure");
          if (scenario === "denied") throw new PlatformAccessDeniedError();
          return { redirectTo: "/my" };
        },
        getSupportSignInDestination: async () => {
          calls.push("destination");
          if (scenario === "destination-outage") throw Error("PRIVATE destination lookup failure");
          return "/my/support";
        },
      },
    });
    const input = { searchParams: Promise.resolve({}) };
    if (scenario === "authenticated") await assert.rejects(page.default(input), { href: "/my/support" });
    else {
      const tree = await page.default(input);
      assert.equal(tree.type, Shell);
      assert.equal(tree.props.children.type, ["signed_out", "denied"].includes(scenario) ? Access : Unavailable);
      assert.doesNotMatch(JSON.stringify(tree.props.children.props), /PRIVATE/);
    }
    if (["unavailable", "network", "signed_out"].includes(scenario)) assert.deepEqual(calls, []);
  }
});
