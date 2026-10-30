import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { loadFoundationsAvailability } from "./helpers/foundations-availability-fixture.mjs";

const require = createRequire(import.meta.url);
const Preview = () => null;
const Home = () => null;
const AccessNotice = () => null;
const Unavailable = () => null;
const component = (value) => ({ __esModule: true, default: value });

function fixture({ launched = false, state = "authenticated", eligible = false, revisit = false, identity = {}, role = null, viewer = { authUserId: "member", roles: ["ops_admin"] } } = {}) {
  const calls = [];
  const roleReads = [];
  const dependencies = {
    "next/navigation": { redirect: (href) => { throw new Error(`redirect:${href}`); } },
    "@/components/foundations/MemberFoundationsPreview": component(Preview),
    "@/components/foundations/MemberFoundationsHome": component(Home),
    "@/components/membership/MemberAccessNotice": component(AccessNotice),
    "@/components/platform/PlatformUnavailable": component(Unavailable),
    "@/lib/foundations/availability": loadFoundationsAvailability({ MEMBERSHIP_FOUNDATIONS_LAUNCHED: String(launched) }, {
      getOperatorRole: async id => { roleReads.push(id); return role; },
    }),
    "@/lib/membership/preview": { PREVIEW_MEMBER_IDENTITY: {}, PREVIEW_MEMBER_TIMELINE: { entries: [], revision: "0" } },
    "@/lib/membership/page-context": {
      getMembershipPageContext: async () => ({ state, data: ["signed_out", "denied", "unavailable"].includes(state) ? null : identity, viewer }),
    },
    "@/lib/membership/access-policy": {
      deriveMemberAccessPolicy: () => { calls.push("access"); return {}; },
      memberCan: (_, capability) => capability === "foundations.revisit" ? revisit : eligible,
    },
    "@/lib/membership/repository": {
      getMemberIdentity: async () => identity,
      getMemberFoundationRequirements: async () => { throw Error("The replacement deck must not depend on legacy requirements"); },
      getMemberTimeline: async (owner) => { calls.push(`private-timeline:${owner}`); return { entries: [{ title: "A private moment" }], revision: "1" }; },
    },
    "@/lib/foundations/repository": {
      getMemberFoundationsState: async () => { throw Error("The replacement deck must not depend on legacy progress"); },
    },
    "@/lib/sharing": { privateSharingMetadata: {} },
  };
  function load(path) {
    const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const mod = { exports: {} };
    new Function("require", "module", "exports", compiled)((name) => {
      if (name === "react/jsx-runtime") return require(name);
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    }, mod, mod.exports);
    return mod.exports.default;
  }
  return { calls, roleReads, load };
}

const homePath = "app/my/foundations/page.tsx";
const experiencePath = "app/my/foundations/experience/page.tsx";
const timelinePath = "app/my/foundations/timeline/page.tsx";

test("before launch, membership status and a stale admin viewer role cannot bypass the couch preview", async () => {
  for (const identity of [
    { billingState: "pending", administrativeOnboardingState: "in_progress" },
    { billingState: "active" },
    { membershipFunding: "complimentary" },
    { membershipFunding: "operator" },
  ]) {
    const f = fixture({ identity });
    assert.equal((await f.load(homePath)()).type, Preview);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.roleReads, ["member"]);
  }
});

test("current Administrators enter Foundations before global launch without loading the replaced program", async () => {
  const f = fixture({ role: "ops_admin", eligible: true, viewer: { authUserId: "member", roles: [] } });
  const page = await f.load(homePath)();
  assert.equal(page.type, Home);
  assert.deepEqual(page.props, {});
  assert.deepEqual(f.roleReads, ["member"]);
  assert.deepEqual(f.calls, ["access"]);
});

test("prelaunch Administrator access never bypasses existing member eligibility", async () => {
  const f = fixture({ role: "ops_admin" });
  assert.equal((await f.load(homePath)()).type, AccessNotice);
  assert.deepEqual(f.calls, ["access"]);
  assert.deepEqual(f.roleReads, ["member"]);
  for (const role of ["guide", "circle_leader"]) {
    const f = fixture({ role, eligible: true });
    assert.equal((await f.load(homePath)()).type, Preview);
    assert.deepEqual(f.calls, []);
  }
});

test("a local preview also requires an explicit launch flag before it exposes the experience", async () => {
  const closed = fixture({ state: "preview", role: "ops_admin" });
  assert.equal((await closed.load(homePath)()).type, Preview);
  assert.deepEqual(closed.calls, []);
  assert.deepEqual(closed.roleReads, [], "preview data must never qualify for the Administrator exception");
  const open = fixture({ state: "preview", launched: true, eligible: true });
  const page = await open.load(homePath)();
  assert.equal(page.type, Home);
  assert.deepEqual(page.props, {}, "The replacement has no writable legacy program mode");
  assert.deepEqual(open.calls, ["access"]);
});

test("the launch preview preserves authentication and denied-account boundaries", async () => {
  const signedOut = fixture({ state: "signed_out" });
  await assert.rejects(signedOut.load(homePath)(), /^Error: redirect:\/my\/access$/);
  for (const state of ["denied", "unavailable"]) {
    const f = fixture({ state });
    assert.equal((await f.load(homePath)()).type, Unavailable);
    assert.deepEqual(f.calls, []);
  }
});

test("the replaced experience URL always forwards to the separately gated deck without reading legacy progress", async () => {
  for (const launched of [false, true]) for (const state of ["authenticated", "signed_out", "denied", "unavailable", "preview"]) {
    const f = fixture({ launched, state });
    await assert.rejects(async () => f.load(experiencePath)(), /^Error: redirect:\/my\/foundations\/deck$/);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.roleReads, []);
  }
});

test("legacy Foundations Timeline links always forward to the profile Timeline without reading entries", () => {
  for (const launched of [false, true]) for (const state of ["authenticated", "signed_out", "denied", "unavailable", "preview"]) {
    const f = fixture({ launched, state });
    assert.throws(f.load(timelinePath), /^Error: redirect:\/my\/timeline$/);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.roleReads, []);
  }
});

test("launching the replacement Foundations retains membership eligibility and does not load the old program", async () => {
  const denied = fixture({ launched: true });
  assert.equal((await denied.load(homePath)()).type, AccessNotice);
  assert.deepEqual(denied.calls, ["access"]);
  const open = fixture({ launched: true, eligible: true });
  const page = await open.load(homePath)();
  assert.equal(page.type, Home);
  assert.deepEqual(page.props, {});
  assert.deepEqual(open.calls, ["access"]);
});

test("the old public presentation URL routes through the member launch and access gates", () => {
  assert.throws(fixture().load("app/foundations/page.tsx"), /^Error: redirect:\/my\/foundations$/);
});
