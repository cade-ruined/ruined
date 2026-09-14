import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies = {}) {
  const output = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    assert.ok(name in dependencies, `Unexpected live dependency: ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const policy = await load("src/lib/membership/access-policy.ts");
const preview = await load("src/lib/membership/preview.ts", {
  "@/lib/membership/access-policy": policy,
  "@/data/foundations": { FOUNDATION_MOMENTS: Array.from({ length: 22 }, (_, index) => ({ id: `moment-${index}`, label: `Moment ${index}`, stage: "see", kind: "lesson" })) },
  "@/lib/events/member-experiences": { getUpcomingPublicMemberExperiences: () => [] },
});
const scenarios = await load("src/lib/membership/preview-scenarios.ts", {
  "@/lib/membership/access-policy": policy, "@/lib/membership/preview": preview,
});

test("every demo scenario uses the real access policy across Home, Account and Foundations", () => {
  for (const scenario of scenarios.MEMBER_PREVIEW_SCENARIOS) {
    const identity = scenarios.memberPreviewIdentity(scenario);
    const home = scenarios.memberPreviewSnapshot(preview.PREVIEW_MEMBER_HOME, scenario);
    const account = scenarios.memberPreviewSnapshot(preview.PREVIEW_MEMBER_ACCOUNT, scenario);
    const expected = policy.deriveMemberAccessPolicy(identity);
    assert.deepEqual(home.identity, identity);
    assert.deepEqual(home.access, expected);
    assert.deepEqual(account.access, expected);
    assert.equal(account.billingState, identity.billingState);
    assert.equal(account.membershipFunding, identity.membershipFunding);
    if (policy.memberCan(expected, "foundations.write")) {
      const foundations = scenarios.memberPreviewFoundations(identity);
      assert.equal(foundations.completedUnits, home.foundations.requirements.moments.completed);
      assert.equal(foundations.progressPercent, home.foundations.progressPercent);
      assert.equal(foundations.status, home.foundations.state);
      assert.equal(foundations.units.filter((unit) => unit.status === "completed").length, foundations.completedUnits);
      assert.equal(foundations.requirements.futureLetter.completed, home.foundations.requirements.futureLetter.completed);
    }
  }
});

test("restricted previews do not expose fake Circle or Academy entitlement", () => {
  for (const scenario of ["joining", "limited"]) {
    const circle = scenarios.memberPreviewSnapshot(preview.PREVIEW_MEMBER_CIRCLE, scenario);
    const library = scenarios.memberPreviewSnapshot(preview.PREVIEW_MEMBER_LEARNING, scenario);
    assert.equal(circle.circle, null);
    assert.deepEqual(circle.members, []);
    assert.deepEqual(library.collections, []);
    assert.deepEqual(library.uncollected, []);
    const experiences = scenarios.memberPreviewSnapshot(preview.PREVIEW_MEMBER_EXPERIENCES, scenario);
    assert.equal(experiences.upcoming.some((event) => event.kind === "circle_meeting"), false);
  }
  const joining = scenarios.memberPreviewSnapshot(preview.PREVIEW_MEMBER_ACCOUNT, "joining");
  assert.equal(joining.agreement.acceptedAt, null);
  assert.equal(joining.agreement.receiptId, null);
  const joiningHome = scenarios.memberPreviewSnapshot(preview.PREVIEW_MEMBER_HOME, "joining");
  assert.equal(joiningHome.memberSince, null);
  assert.equal(joiningHome.foundations.requirements.timeline.completedAt, null);
  assert.equal(joiningHome.foundations.requirements.moments.completed, 0);
  assert.equal(preview.PREVIEW_MEMBER_ACCOUNT.agreement.receiptId, "preview-receipt", "Scenarios must not mutate the source fixture");
});

test("profile, joining form, Timeline and Foundations share one coherent sample", () => {
  assert.deepEqual(preview.PREVIEW_MEMBER_PROFILE.privateProfile.apparelSizing, preview.PREVIEW_MEMBER_ONBOARDING.profile.apparelSizing);
  assert.deepEqual(preview.PREVIEW_MEMBER_PROFILE.privateProfile.fulfillmentAddress, preview.PREVIEW_MEMBER_ONBOARDING.profile.fulfillmentAddress);
  assert.equal(preview.PREVIEW_MEMBER_HOME.foundations.requirements.timeline.entryCount, preview.PREVIEW_MEMBER_TIMELINE.entries.length);
  assert.equal(preview.PREVIEW_MEMBER_FOUNDATIONS_STATE.completedUnits, 16);
});

test("scenario endpoint is unavailable in production and never changes real roles or payment", async () => {
  const route = await source("app/api/preview/member-scenario/route.ts");
  assert.match(route, /mode !== "preview" \|\| process.env.NODE_ENV === "production"/);
  assert.match(route, /isTrustedPlatformOrigin\(request\)/);
  assert.match(route, /httpOnly: true, sameSite: "strict"/);
  assert.doesNotMatch(route, /getApplicationDatabase|signInWithOtp|billing_state|platform_role_grants/);
  assert.equal(scenarios.memberPreviewScenario("ops_admin"), "foundations");
});
