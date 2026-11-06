import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
// Exercise the installed React server cache implementation. The dispatcher is
// scoped to this test's simulated RSC request, as React's server renderer does.
const ReactServer = require(join(dirname(require.resolve("react")), "cjs/react.react-server.development.js"));
const internals = ReactServer.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
async function request(run) {
  const previous = internals.A;
  const cache = new Map();
  internals.A = { getCacheForType(factory) {
    if (!cache.has(factory)) cache.set(factory, factory());
    return cache.get(factory);
  } };
  try { return await run(); } finally { internals.A = previous; }
}
function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", "console", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "server-only") return {};
    if (name === "react") return ReactServer;
    if (name === "react/jsx-runtime") return require(name);
    throw Error(`Unexpected request reuse dependency: ${name}`);
  }, loadedModule, loadedModule.exports, { error() {} });
  return loadedModule.exports;
}
const first = { authUserId: "11111111-1111-4111-8111-111111111111", email: "first@example.test" };
const second = { authUserId: "22222222-2222-4222-8222-222222222222", email: "second@example.test" };
function authFixture() {
  const counts = { clients: 0, claims: 0, users: 0 };
  const state = { viewer: first, outcome: "valid" };
  const client = { auth: {
    async getClaims() {
      counts.claims++;
      if (state.outcome === "outage") throw new TypeError("Sensitive provider error");
      if (state.outcome === "revoked") return { error: { status: 401, code: "session_not_found" } };
      return { data: { claims: { sub: state.viewer.authUserId, email: state.viewer.email } } };
    },
    async getUser() { counts.users++; return { data: { user: state.outcome === "deleted" ? null : { id: state.viewer.authUserId, email: state.viewer.email } } }; },
  } };
  const raw = load("src/lib/auth/session.ts", {
    "@/lib/auth/session-errors": load("src/lib/auth/session-errors.ts"),
    "@/lib/supabase/server": { createSupabaseServerClient: async () => { counts.clients++; return client; } },
  });
  const pages = load("src/lib/auth/page-session.ts", { "./session": raw });
  return { counts, state, client, raw, pages };
}

test("page session coalesces concurrent validation within one request and refreshes after an account switch, revocation or outage", async () => {
  const f = authFixture();
  await request(async () => {
    const [a, b, viewer] = await Promise.all([f.pages.resolveCurrentPlatformSession(), f.pages.resolveCurrentPlatformSession(), f.pages.getCurrentPlatformViewer()]);
    assert.strictEqual(a, b);
    assert.deepEqual(viewer, first);
    assert.equal(f.counts.claims, 1);
    assert.equal(f.counts.clients, 1);
  });
  f.state.viewer = second;
  assert.deepEqual(await request(() => f.pages.getCurrentPlatformViewer()), second);
  f.state.outcome = "revoked";
  assert.equal((await request(() => f.pages.resolveCurrentPlatformSession())).status, "signed_out");
  f.state.outcome = "outage";
  assert.equal((await request(() => f.pages.resolveCurrentPlatformSession())).status, "unavailable");
  f.state.outcome = "valid";
  assert.deepEqual(await request(() => f.pages.getCurrentPlatformViewer()), second);
  assert.equal(f.counts.claims, 5, "each subsequent server request validates independently");
});

test("raw API and foreground session guards stay fresh even inside a page render scope", async () => {
  const f = authFixture();
  await request(async () => {
    await f.pages.getCurrentPlatformViewer();
    f.state.outcome = "revoked";
    assert.equal(await f.raw.getCurrentPlatformViewer(), null);
    assert.equal(await f.raw.getCurrentPlatformViewer(), null);
    assert.equal(f.counts.claims, 3);
    f.state.outcome = "deleted";
    assert.equal((await f.raw.resolvePlatformSession(f.client, { verifyCurrentUser: true })).status, "signed_out");
    assert.equal(f.counts.users, 1, "foreground recovery still checks the current Auth user");
  });
  f.state.outcome = "valid";
  await f.pages.getCurrentPlatformViewer();
  await f.pages.getCurrentPlatformViewer();
  assert.equal(f.counts.claims, 6, "outside an RSC dispatcher React does not provide persistent caching");
});

function registrationFixture() {
  const calls = [];
  const state = { failure: false, paidCheckout: true, records: new Map() };
  const routing = load("src/lib/membership/registration-routing.ts");
  const pages = load("src/lib/membership/page-reads.ts", {
    "./registration-repository": { async getMemberRegistration(id) {
      calls.push(id);
      if (state.failure) throw Error("Temporary database failure");
      return state.records.get(id) ?? null;
    } },
    "./registration-routing": routing,
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ stripeCheckoutReady: state.paidCheckout }) },
  });
  return { calls, state, pages, routing };
}

test("registration row and destination share one actor-scoped read and preserve every existing routing rule", async () => {
  const f = registrationFixture();
  const scenarios = [null,
    { state: "activated", profileComplete: true, ready: true },
    { state: "collecting", profileComplete: false, ready: false },
    { state: "registered", profileComplete: true, ready: true },
    { state: "registered", profileComplete: true, ready: false, requiresInitialPayment: true, requiresPaymentMethod: true },
    { state: "collecting", profileComplete: true, ready: false, requiresInitialPayment: false, requiresPaymentMethod: true },
    { state: "collecting", profileComplete: true, ready: false, requiresInitialPayment: false, requiresPaymentMethod: false },
  ];
  for (const paidCheckout of [false, true]) for (const record of scenarios) {
    f.state.paidCheckout = paidCheckout;
    f.state.records.set(first.authUserId, record);
    const before = f.calls.length;
    await request(async () => {
      const [row, destination] = await Promise.all([
        f.pages.getMemberRegistration(first.authUserId), f.pages.getMemberRegistrationDestination(first.authUserId),
      ]);
      assert.strictEqual(row, record);
      assert.equal(destination, f.routing.memberRegistrationDestination(record, paidCheckout));
    });
    assert.equal(f.calls.length - before, 1);
  }
  f.state.records.set(first.authUserId, scenarios[1]);
  f.state.records.set(second.authUserId, scenarios[2]);
  await request(async () => {
    const [a, b] = await Promise.all([f.pages.getMemberRegistrationDestination(first.authUserId), f.pages.getMemberRegistrationDestination(second.authUserId)]);
    assert.equal(a, null);
    assert.equal(b, "/my/join");
  });
});

test("failed registration and revoked operator reads cannot persist into another request", async () => {
  const f = registrationFixture();
  f.state.failure = true;
  await request(async () => {
    const rows = await Promise.allSettled([f.pages.getMemberRegistration(first.authUserId), f.pages.getMemberRegistrationDestination(first.authUserId)]);
    assert.ok(rows.every(row => row.status === "rejected"));
    assert.equal(f.calls.length, 1);
  });
  f.state.failure = false;
  f.state.records.set(first.authUserId, { state: "activated" });
  assert.equal(await request(() => f.pages.getMemberRegistrationDestination(first.authUserId)), null);
  assert.equal(f.calls.length, 2);
  let role = "ops_admin", calls = 0;
  const pages = load("src/lib/platform/page-reads.ts", { "./repository": { getOperatorRole: async () => { calls++; return role; } } });
  await request(async () => {
    assert.deepEqual(await Promise.all([pages.getOperatorRole(first.authUserId), pages.getOperatorRole(first.authUserId)]), ["ops_admin", "ops_admin"]);
    assert.equal(await pages.getOperatorRole(second.authUserId), "ops_admin");
    assert.equal(calls, 2, "different actors never share a role entry");
  });
  role = null;
  assert.equal(await request(() => pages.getOperatorRole(first.authUserId)), null);
  assert.equal(calls, 3);
});

function layoutDependencies({ auth, registrations, roles, calendar = async () => false, directory = async () => false }) {
  return {
    "next/navigation": { notFound() { throw Error("notFound"); } },
    "next/headers": { cookies: async () => ({ get: () => undefined }) },
    "@/lib/auth/page-session": auth,
    "@/lib/membership/page-reads": registrations,
    "@/lib/platform/page-reads": roles,
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/platform/visibility": { isMyRuinedVisible: () => true },
    "@/lib/membership/preview-scenarios": {},
    "@/lib/platform/experience-member-access": { hasEligibleExplicitExperienceInvitations: calendar },
    "@/lib/membership/member-search-repository": { canBrowseMemberDirectory: directory },
    "@/lib/sharing": { privateSharingMetadata: {} },
    ...Object.fromEntries(["MemberPreviewSwitcher", "MemberJourneyShell", "MemberSessionContinuity", "MemberBadgeCelebration", "MemberPortraitState", "MemberTimelineDraftState", "MemberJournalDraftState", "MemberPracticeDraftState"].map(name => [`@/components/membership/${name}`, name])),
  };
}
function find(node, type) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean);
  return node.type === type ? node : find(node.props?.children, type);
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test("real member layout and page context coalesce session and registration while the data loader still authorizes freshly", async () => {
  const auth = authFixture();
  const registrations = registrationFixture();
  registrations.state.records.set(first.authUserId, { state: "activated" });
  let roleReads = 0, dataReads = 0;
  const roles = load("src/lib/platform/page-reads.ts", { "./repository": { getOperatorRole: async () => { roleReads++; return null; } } });
  const dependencies = layoutDependencies({ auth: auth.pages, registrations: registrations.pages, roles });
  const Layout = load("app/my/layout.tsx", dependencies).default;
  const context = load("src/lib/membership/page-context.ts", {
    ...dependencies,
    "./page-reads": registrations.pages,
    "@/lib/membership/repository": { MembershipAccessDeniedError: class extends Error {} },
  });
  await request(async () => {
    const [tree, page] = await Promise.all([Layout({ children: "member page" }), context.getMembershipPageContext({}, async id => { dataReads++; assert.equal(id, first.authUserId); return { own: true }; }, "profile")]);
    assert.equal(page.state, "authenticated");
    assert.equal(find(tree, "MemberJourneyShell").props.registrationOnly, false);
    assert.equal(auth.counts.claims, 1);
    assert.equal(registrations.calls.length, 1);
    assert.equal(roleReads, 1);
    assert.equal(dataReads, 1);
  });
});

test("member navigation starts independent reads together and failure keeps unavailable permissions closed", async () => {
  const held = deferred(), invitation = deferred(), directory = deferred();
  const starts = [];
  const Layout = load("app/my/layout.tsx", layoutDependencies({
    auth: { resolveCurrentPlatformSession: async () => ({ status: "authenticated", viewer: first }) },
    registrations: { getMemberRegistration: async () => { starts.push("registration"); return held.promise; } },
    roles: { getOperatorRole: async () => { starts.push("role"); return "ops_admin"; } },
    calendar: async () => { starts.push("calendar"); return invitation.promise; },
    directory: async () => { starts.push("directory"); return directory.promise; },
  })).default;
  const result = Layout({ children: "page" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(starts, ["registration", "role"]);
  held.resolve({ state: "registered", ready: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(starts, ["registration", "role", "calendar", "directory"]);
  invitation.resolve(true); directory.resolve(false);
  const shell = find(await result, "MemberJourneyShell");
  assert.equal(shell.props.registrationOnly, true);
  assert.equal(shell.props.invitedCalendarAvailable, true);
  assert.equal(shell.props.memberDirectoryAvailable, false);
  const failed = load("app/my/layout.tsx", layoutDependencies({
    auth: { resolveCurrentPlatformSession: async () => ({ status: "authenticated", viewer: first }) },
    registrations: { getMemberRegistration: async () => { throw Error("Private failure"); } },
    roles: { getOperatorRole: async () => { throw Error("Private failure"); } },
    calendar: () => assert.fail("registration failure cannot authorize Calendar"),
    directory: () => assert.fail("registration failure cannot authorize member discovery"),
  })).default;
  const closed = find(await failed({}), "MemberJourneyShell");
  assert.equal(closed.props.registrationOnly, true);
  assert.equal(closed.props.operatorRole, null);
  assert.equal(closed.props.invitedCalendarAvailable, false);
  assert.equal(closed.props.memberDirectoryAvailable, false);
});

test("operator layout and access context share validated identity and role without loading the legacy dashboard", async () => {
  const auth = authFixture();
  let roleReads = 0, role = "ops_admin";
  const roles = load("src/lib/platform/page-reads.ts", { "./repository": { getOperatorRole: async () => { roleReads++; return role; } } });
  const dependencies = {
    "@/lib/auth/page-session": auth.pages,
    "@/lib/platform/page-reads": roles,
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/platform/model": {},
    "@/lib/sharing": { privateSharingMetadata: {} },
    "@/components/platform/PlatformShell": "OperatorShell",
    "@/lib/platform/repository": {
      getOperatorDashboard: () => assert.fail("Access-only pages must not load the legacy dashboard"),
      getMemberPlatformSnapshot: () => assert.fail("Operator access must not load member data"),
    },
  };
  const Layout = load("app/ops/layout.tsx", dependencies).default;
  const context = load("src/lib/platform/page-data.ts", dependencies);
  await request(async () => {
    const [tree, access] = await Promise.all([Layout({ children: "operator page" }), context.getOperatorAccessContext()]);
    assert.equal(tree.props.operatorRole, "ops_admin");
    assert.equal(access.state, "authenticated");
    assert.equal(roleReads, 1);
    assert.equal(auth.counts.claims, 1);
  });
  role = null;
  const denied = await request(() => context.getOperatorAccessContext());
  assert.equal(denied.state, "denied");
  assert.equal(roleReads, 2);
});

const accessOnlyPages = [
  "members/page.tsx", "members/[memberId]/page.tsx", "registrations/page.tsx", "work/page.tsx",
  "academy/page.tsx", "academy/[resourceId]/page.tsx", "artifacts/page.tsx", "community/[eventKey]/page.tsx",
  "notifications/page.tsx", "announcements/page.tsx", "experiences/page.tsx", "experiences/[experienceId]/page.tsx",
];
test("all twelve access-only operator routes stop before private reads on lost identity, denied role or unavailable access", async () => {
  for (const path of accessOnlyPages) for (const state of ["signed_out", "denied", "unavailable"]) {
    let accessReads = 0;
    const privateReads = [];
    const source = readFileSync(new URL(`../app/ops/${path}`, import.meta.url), "utf8");
    const deps = {
      "next/navigation": { redirect: href => { throw Object.assign(Error("redirect"), { href }); } },
      "@/lib/platform/page-data": {
        getOperatorAccessContext: async () => { accessReads++; return { state, role: state === "denied" ? null : "ops_admin", viewer: first }; },
        getOperatorPageContext: () => assert.fail("Unused dashboard must not load before the page"),
      },
      "@/components/platform/PlatformUnavailable": "Unavailable",
    };
    const moduleAst = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const node of moduleAst.statements) {
      if (!ts.isImportDeclaration(node)) continue;
      const name = node.moduleSpecifier.text;
      if (Object.hasOwn(deps, name) || name === "next") continue;
      deps[name] = name.startsWith("@/components/") ? "UnusedComponent" : new Proxy({}, { get(_target, property) {
        if (property === "__esModule") return true;
        return (...args) => { privateReads.push({ name, property, args }); throw Error("Blocked pages cannot read data"); };
      } });
    }
    const Page = load(`app/ops/${path}`, deps).default;
    const run = () => Page({ params: Promise.resolve({ memberId: "member", resourceId: "resource", eventKey: "event", experienceId: "experience" }), searchParams: Promise.resolve({}) });
    if (state === "signed_out") await assert.rejects(run, { href: "/ops/access" }, path);
    else assert.equal((await run()).type, "Unavailable", `${path}:${state}`);
    assert.equal(accessReads, 1, `${path}:${state}`);
    assert.deepEqual(privateReads, [], `${path}:${state}`);
  }
});
