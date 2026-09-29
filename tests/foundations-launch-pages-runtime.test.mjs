import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const Preview = () => null;
const Home = () => null;
const Experience = () => null;
const AccessNotice = () => null;
const Unavailable = () => null;
const component = (value) => ({ __esModule: true, default: value });

function fixture({ launched = false, state = "authenticated", eligible = false, identity = {} } = {}) {
  const calls = [];
  const dependencies = {
    "next/navigation": { redirect: (href) => { throw new Error(`redirect:${href}`); } },
    "@/components/foundations/MemberFoundationsPreview": component(Preview),
    "@/components/foundations/MemberFoundationsHome": component(Home),
    "@/components/foundations/MemberFoundationsExperience": component(Experience),
    "@/components/membership/MemberAccessNotice": component(AccessNotice),
    "@/components/platform/PlatformUnavailable": component(Unavailable),
    "@/lib/foundations/availability": { isFoundationsLaunched: () => launched },
    "@/lib/membership/preview": { PREVIEW_MEMBER_IDENTITY: {} },
    "@/lib/membership/preview-scenarios": { memberPreviewFoundations: () => ({ preview: true }) },
    "@/lib/membership/page-context": {
      getMembershipPageContext: async () => ({ state, data: ["signed_out", "denied", "unavailable"].includes(state) ? null : identity, viewer: { authUserId: "member" } }),
    },
    "@/lib/membership/access-policy": {
      deriveMemberAccessPolicy: () => { calls.push("access"); return {}; },
      memberCan: () => eligible,
    },
    "@/lib/membership/repository": {
      getMemberIdentity: async () => identity,
      getMemberFoundationRequirements: async () => { calls.push("requirements"); return {}; },
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
  return { calls, load };
}

const homePath = "app/my/foundations/page.tsx";
const experiencePath = "app/my/foundations/experience/page.tsx";

test("before launch, pending, active, complimentary and operator members all get the couch preview without onboarding or progress reads", async () => {
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
  }
});

test("a local preview also requires an explicit launch flag before it exposes the experience", async () => {
  const closed = fixture({ state: "preview" });
  assert.equal((await closed.load(homePath)()).type, Preview);
  await assert.rejects(closed.load(experiencePath)(), /^Error: redirect:\/my\/foundations$/);
  assert.deepEqual(closed.calls, []);
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
