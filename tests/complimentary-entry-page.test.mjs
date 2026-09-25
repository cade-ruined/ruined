import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { jsx, jsxs } from "react/jsx-runtime";
import ts from "typescript";

const output = ts.transpileModule(await readFile(new URL("../app/my/join/page.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
function fixture({ membershipFunding = "self", billingState = "pending", state = "completed" } = {}) {
  const onboarding = { membershipFunding, billingState, state, requiredFieldsComplete: true, agreement: { acceptanceId: "saved-agreement" } };
  const JoinForm = () => null;
  const Progress = () => null;
  const dependencies = {
    "react/jsx-runtime": { jsx, jsxs },
    "next/image": () => null,
    "next/navigation": { redirect: href => { throw Object.assign(new Error("redirect"), { href }); } },
    "@/components/membership/JoinForm": JoinForm,
    "@/components/membership/MembershipEntryProgress": { MembershipEntryProgress: Progress, MembershipEntryProgressProvider: () => null },
    "@/components/platform/PlatformUnavailable": () => null,
    "@/lib/membership/page-context": { getMembershipPageContext: async () => ({ state: "authenticated", data: onboarding, configuration: { stripeCheckoutReady: true, minimumAge: 18 } }) },
    "@/lib/membership/entry-stage": { membershipEntryStage: () => "payment" },
    "@/lib/membership/preview": { PREVIEW_MEMBER_ONBOARDING: {} },
    "@/lib/membership/repository": { getMemberOnboarding: () => { throw Error("Live database prohibited"); } },
    "@/lib/membership/public-signup-admission": { getMemberSignupPlan: async () => "annual" },
    "@/lib/membership/photos": { isMemberPhotoStorageConfigured: () => true },
    "@/lib/platform/config": { getStripePublishableKey: () => "pk_test_fixture" },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, loaded, loaded.exports);
  function find(element, component) {
    if (element?.type === component) return element;
    for (const child of [element?.props?.children].flat()) {
      const result = child && typeof child === "object" ? find(child, component) : null;
      if (result) return result;
    }
    return null;
  }
  return { page: loaded.exports.default, form: tree => find(tree, JoinForm), progress: tree => find(tree, Progress) };
}

test("an expired payment waiver can reach payment with its existing completed profile and agreement", async () => {
  const f = fixture(); const tree = await f.page();
  assert.equal(f.form(tree).props.checkoutEnabled, true);
  assert.equal(f.form(tree).props.initialOnboarding.agreement.acceptanceId, "saved-agreement");
  assert.equal(f.progress(tree).props.complimentary, false);
});

for (const membershipFunding of ["operator", "complimentary"]) test(`${membershipFunding} entry offers activation without payment and completed members go home`, async () => {
  const f = fixture({ membershipFunding, state: "in_progress" }); const tree = await f.page();
  assert.equal(f.form(tree).props.checkoutEnabled, false);
  assert.equal(f.progress(tree).props.complimentary, true);
  await assert.rejects(fixture({ membershipFunding }).page, error => error.href === "/my");
});

test("paid completed members still go home when complimentary funding is absent", async () => {
  await assert.rejects(fixture({ billingState: "active" }).page, error => error.href === "/my");
});
