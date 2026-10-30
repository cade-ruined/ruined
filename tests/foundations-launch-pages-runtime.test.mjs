import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { loadFoundationsAvailability } from "./helpers/foundations-availability-fixture.mjs";

const require = createRequire(import.meta.url);
const Preview = () => null;
const Home = () => null;
const Experience = () => null;
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
    "@/components/foundations/MemberFoundationsExperience": component(Experience),
    "@/components/membership/MemberAccessNotice": component(AccessNotice),
    "@/components/platform/PlatformUnavailable": component(Unavailable),
    "@/lib/foundations/availability": loadFoundationsAvailability({ MEMBERSHIP_FOUNDATIONS_LAUNCHED: String(launched) }, {
      getOperatorRole: async id => { roleReads.push(id); return role; },
    }),
    "@/lib/membership/preview": { PREVIEW_MEMBER_IDENTITY: {}, PREVIEW_MEMBER_TIMELINE: { entries: [], revision: "0" } },
    "@/lib/membership/preview-scenarios": { memberPreviewFoundations: () => ({ preview: true }) },
    "@/lib/membership/page-context": {
      getMembershipPageContext: async () => ({ state, data: ["signed_out", "denied", "unavailable"].includes(state) ? null : identity, viewer }),
    },
    "@/lib/membership/access-policy": {
      deriveMemberAccessPolicy: () => { calls.push("access"); return {}; },
      memberCan: (_, capability) => capability === "foundations.revisit" ? revisit : eligible,
    },
    "@/lib/membership/repository": {
      getMemberIdentity: async () => identity,
      getMemberFoundationRequirements: async () => { calls.push("requirements"); return {}; },
      getMemberTimeline: async (owner) => { calls.push(`private-timeline:${owner}`); return { entries: [{ title: "A private moment" }], revision: "1" }; },
    },
    "@/lib/foundations/repository": {
      getMemberFoundationsState: async () => { calls.push("progress"); return { enrollmentId: "enrolled", status: "in_progress" }; },
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
    await assert.rejects(f.load(experiencePath)(), /^Error: redirect:\/my\/foundations$/);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.roleReads, ["member", "member"]);
  }
});

test("current Administrators enter Foundations and the experience before global launch", async () => {
  for (const [path, expected] of [[homePath, Home], [experiencePath, Experience]]) {
    const f = fixture({ role: "ops_admin", eligible: true, viewer: { authUserId: "member", roles: [] } });
    const page = await f.load(path)();
    assert.equal(page.type, expected);
    assert.equal(page.props.writable, true);
    assert.deepEqual(f.roleReads, ["member"]);
    assert.deepEqual(f.calls, ["access", "progress", "requirements"]);
  }
});

test("prelaunch Administrator access never bypasses existing member eligibility", async () => {
  for (const path of [homePath, experiencePath]) {
    const f = fixture({ role: "ops_admin" });
    assert.equal((await f.load(path)()).type, AccessNotice);
    assert.deepEqual(f.calls, ["access"]);
    assert.deepEqual(f.roleReads, ["member"]);
  }
  for (const role of ["guide", "circle_leader"]) {
    const f = fixture({ role, eligible: true });
    assert.equal((await f.load(homePath)()).type, Preview);
    assert.deepEqual(f.calls, []);
  }
});

test("a local preview also requires an explicit launch flag before it exposes the experience", async () => {
  const closed = fixture({ state: "preview", role: "ops_admin" });
  assert.equal((await closed.load(homePath)()).type, Preview);
  await assert.rejects(closed.load(experiencePath)(), /^Error: redirect:\/my\/foundations$/);
  assert.deepEqual(closed.calls, []);
  assert.deepEqual(closed.roleReads, [], "preview data must never qualify for the Administrator exception");
  const open = fixture({ state: "preview", launched: true, eligible: true });
  for (const path of [homePath, experiencePath]) {
    assert.equal((await open.load(path)()).props.writable, false);
  }
});

test("the launch preview preserves authentication and denied-account boundaries", async () => {
  for (const path of [homePath, experiencePath]) {
    const signedOut = fixture({ state: "signed_out" });
    await assert.rejects(signedOut.load(path)(), /^Error: redirect:\/my\/access$/);
    for (const state of ["denied", "unavailable"]) {
      const f = fixture({ state });
      assert.equal((await f.load(path)()).type, Unavailable);
      assert.deepEqual(f.calls, []);
    }
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

test("launching Foundations retains membership eligibility and loads saved progress for eligible members", async () => {
  for (const [path, expected] of [[homePath, Home], [experiencePath, Experience]]) {
    const denied = fixture({ launched: true });
    assert.equal((await denied.load(path)()).type, AccessNotice);
    assert.deepEqual(denied.calls, ["access"]);
    const open = fixture({ launched: true, eligible: true });
    const page = await open.load(path)();
    assert.equal(page.type, expected);
    assert.equal(page.props.writable, true);
    assert.deepEqual(open.calls, ["access", "progress", "requirements"]);
  }
});

test("the old public presentation URL routes through the member launch and access gates", () => {
  assert.throws(fixture().load("app/foundations/page.tsx"), /^Error: redirect:\/my\/foundations$/);
});
