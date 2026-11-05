import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const viewer = { authUserId: "current-member", email: "member@example.test" };
const snapshot = { query: "Avery", page: 1, results: [{ name: "Avery", href: "/profile/avery" }], hasMore: false };
class MembershipAccessDeniedError extends Error {}
class MemberSearchError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const redirect = href => { throw Object.assign(Error("redirect"), { href }); };
function Directory() { return null; }
function Unavailable() { return null; }

function load(path, dependencies, logs = []) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", "console", "fetch", code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "server-only") return {};
    if (name === "react/jsx-runtime") return require(name);
    assert.fail(`Unexpected dependency: ${name}`);
  }, result, result.exports, { error: (...args) => logs.push(args) }, () => assert.fail("Unexpected network call"));
  return result.exports;
}

function fixture({ destination = "/my/registered", session = "authenticated", data = snapshot, failure = null, registrationFailure = null } = {}) {
  const calls = [], logs = [];
  const context = load("src/lib/membership/page-context.ts", {
    "next/headers": { cookies: () => assert.fail("Connected mode must not use preview cookies") },
    "next/navigation": { redirect },
    "./registration-repository": { getMemberRegistrationDestination: async id => {
      assert.equal(id, viewer.authUserId); calls.push("registration");
      if (registrationFailure) throw registrationFailure;
      return destination;
    } },
    "@/lib/membership/preview-scenarios": {},
    "@/lib/auth/session": { resolveCurrentPlatformSession: async () => ({ status: session, viewer }) },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/membership/repository": { MembershipAccessDeniedError },
    "@/lib/platform/experience-member-access": { hasEligibleExplicitExperienceInvitations: async () => {
      calls.push("calendar"); return false;
    } },
  }, logs);
  const read = async id => {
    assert.equal(id, viewer.authUserId); calls.push("load");
    if (failure) throw failure;
    return data;
  };
  return { calls, logs, context, read,
    run: (area = "members", options = { authorizeBeforeRegistrationRedirect: true }) => context.getMembershipPageContext({}, read, area, options),
  };
}

test("directory opts into one independent authorization before any unfinished-registration redirect", async () => {
  for (const destination of ["/my/join", "/my/activate", "/my/payment-method", "/my/registered", null]) {
    const f = fixture({ destination });
    const context = await f.run();
    assert.equal(context.state, "authenticated");
    assert.equal(context.data, snapshot);
    assert.equal(context.viewer, viewer);
    assert.deepEqual(f.calls, ["registration", "load"]);
  }
});

test("an ineligible directory visitor retains the original registration destination", async () => {
  for (const destination of ["/my/join", "/my/activate", "/my/registered"]) {
    for (const options of [{ data: null }, { failure: new MembershipAccessDeniedError() }]) {
      const f = fixture({ ...options, destination });
      await assert.rejects(f.run(), { href: destination });
      assert.deepEqual(f.calls, ["registration", "load"]);
      assert.deepEqual(f.logs, [], "A redirect is not a database failure");
    }
  }
  const released = fixture({ destination: null, data: null });
  assert.equal((await released.run()).state, "denied");
});

test("profile, Foundations and other member pages still redirect before their loader by default", async () => {
  for (const area of ["home", "profile", "foundations", "The Work", "circle", "members"]) {
    const f = fixture();
    await assert.rejects(f.context.getMembershipPageContext({}, f.read, area), { href: "/my/registered" });
    assert.deepEqual(f.calls, ["registration"]);
  }
});

test("signed-out and unavailable sessions never call directory authorization", async () => {
  for (const session of ["signed_out", "unavailable"]) {
    const f = fixture({ session });
    const context = await f.run();
    assert.equal(context.state, session);
    assert.equal(context.viewer, null);
    assert.equal(context.data, null);
    assert.deepEqual(f.calls, []);
  }
});

test("directory authorization and registration outages fail closed without exposing internal errors", async () => {
  for (const options of [{ failure: Error("PRIVATE member payment detail") }, { registrationFailure: Error("PRIVATE registration detail") }]) {
    const f = fixture(options);
    const context = await f.run();
    assert.equal(context.state, "unavailable");
    assert.equal(context.data, null);
    assert.equal(context.viewer, viewer);
    assert.deepEqual(f.calls, options.failure ? ["registration", "load"] : ["registration"]);
    assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE|member@example/);
  }
});

function directoryPage(f, search) {
  return load("app/my/members/page.tsx", {
    "next/navigation": { redirect },
    "@/components/membership/MemberDirectory": Directory,
    "@/components/platform/PlatformUnavailable": Unavailable,
    "@/lib/membership/page-context": f.context,
    "@/lib/membership/member-search-model": {
      MEMBER_SEARCH_LIMIT: 80, MemberSearchError, normalizeMemberSearchQuery: value => value.trim().replace(/^@+/, ""),
    },
    "@/lib/membership/member-search-repository": { getMemberSearch: search },
    "@/lib/membership/member-search-preview": { getMemberSearchPreview: () => ({}) },
    "@/lib/database/server": { withFreshApplicationDatabaseRead: async (name, callback) => {
      assert.equal(name, "member-search"); return callback();
    } },
  }).default;
}

test("the directory page uses fresh repository eligibility and a later revocation restores registration routing", async () => {
  const f = fixture({ destination: "/my/join" });
  let eligible = true;
  const searches = [];
  const Page = directoryPage(f, async (auth, query) => {
    searches.push({ auth, query });
    if (!eligible) throw new MemberSearchError(403, "PRIVATE membership eligibility");
    return snapshot;
  });
  const render = () => Page({ searchParams: Promise.resolve({ q: " @Avery " }) });
  const page = await render();
  assert.equal(page.type, Directory);
  assert.equal(page.props.initialSearch, snapshot);
  assert.equal(page.props.preview, false);
  eligible = false;
  await assert.rejects(render(), { href: "/my/join" });
  assert.deepEqual(searches, Array(2).fill({ auth: viewer.authUserId, query: "Avery" }));
  assert.deepEqual(f.calls, ["registration", "registration"]);
  assert.deepEqual(f.logs, []);
});

test("the directory page never authorizes signed-out sessions and renders unavailable on repository failure", async () => {
  const signedOut = fixture({ session: "signed_out" });
  const signedOutPage = directoryPage(signedOut, () => assert.fail("Signed-out search"));
  await assert.rejects(signedOutPage({ searchParams: Promise.resolve({}) }), { href: "/my/access" });
  assert.deepEqual(signedOut.calls, []);

  const failure = fixture();
  const unavailablePage = directoryPage(failure, () => { throw new MemberSearchError(503, "PRIVATE database detail"); });
  const tree = await unavailablePage({ searchParams: Promise.resolve({}) });
  assert.equal(tree.type, Unavailable);
  assert.deepEqual(failure.calls, ["registration"]);
  assert.doesNotMatch(JSON.stringify(failure.logs), /PRIVATE/);
});
