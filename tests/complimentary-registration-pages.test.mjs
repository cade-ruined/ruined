import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const viewer = { authUserId: "verified-member", email: "member@example.test" };
const Stub = () => null;
const redirect = href => { throw Object.assign(new Error("redirect"), { href }); };

function load(path, dependencies, logs = []) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "console", compiled)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw Error(`Unexpected dependency: ${name}`);
  }, loaded, loaded.exports, { error: (...values) => logs.push(values) });
  return loaded.exports.default;
}

const complimentaryRegistration = {
  state: "registered", ready: true, registeredAt: "2026-10-24T12:00:00.000Z",
  profileComplete: true, requiresInitialPayment: false, requiresPaymentMethod: false,
  completionBasis: "complimentary", initialPayment: null,
};

function complimentaryActivation({ registration = complimentaryRegistration, funding = "complimentary", state = "completed" } = {}) {
  const forbidBilling = () => assert.fail("Complimentary entry must not load paid membership or construct Stripe UI");
  const Page = load("app/my/activate/page.tsx", {
    "next/navigation": { redirect },
    "@/components/membership/MemberActivation": forbidBilling,
    "@/components/membership/MembershipEntryProgress": {},
    "@/lib/membership/entry-stage": { membershipEntryStage: forbidBilling },
    "@/components/platform/PlatformUnavailable": Stub,
    "@/lib/membership/page-context": { getMembershipPageContext: async () => ({
      state: "authenticated", viewer, configuration: { stripeActivationReady: false, stripeCheckoutReady: false },
      data: { membershipFunding: funding, requiredFieldsComplete: true, state, agreement: { acceptanceId: null } },
    }) },
    "@/lib/membership/preview": { PREVIEW_MEMBER_ONBOARDING: {} },
    "@/lib/membership/repository": { getMemberOnboarding: Stub },
    "@/lib/membership/registration-repository": { getMemberRegistration: async id => {
      assert.equal(id, viewer.authUserId); return registration;
    } },
    "@/lib/membership/public-signup-admission": { getMemberSignupPlan: forbidBilling },
    "@/lib/membership/paid-launch": { getMembershipFirstChargeAt: forbidBilling },
    "@/lib/membership/cohort-prepayment": { isMembershipCohortPrepaymentEnabled: forbidBilling },
    "@/lib/membership/foundations-schedule": { createFoundationsBillingSchedule: forbidBilling },
    "@/lib/membership/commercial-repository": { getCoupleMembershipAuthorization: forbidBilling, getCurrentCommercialMembershipReservation: forbidBilling },
    "@/lib/platform/repository": { requireActivePlatformMemberLink: forbidBilling },
    "@/lib/platform/config": { getStripePublishableKey: forbidBilling },
    "@/lib/membership/registration-routing": { canReviewRegistrationBilling: forbidBilling },
  });
  return () => Page({ searchParams: Promise.resolve({ checkout: "returned" }) });
}

test("a complimentary payment link returns to verified registration without any billing dependency", async () => {
  for (const funding of ["operator", "complimentary"]) {
    await assert.rejects(complimentaryActivation({ funding }), { href: "/my/registered" });
  }
});

test("complimentary intake or legal details remain required before registration confirmation", async () => {
  await assert.rejects(complimentaryActivation({ registration: {
    ...complimentaryRegistration, state: "collecting", registeredAt: null, ready: false, profileComplete: false,
  } }), { href: "/my/join" });
});

test("legacy complimentary members finish onboarding and released members return to their profile", async () => {
  await assert.rejects(complimentaryActivation({ registration: null, state: "in_progress" }), { href: "/my/join" });
  await assert.rejects(complimentaryActivation({ registration: null }), { href: "/my" });
  await assert.rejects(complimentaryActivation({ registration: { ...complimentaryRegistration, state: "activated" } }), { href: "/my" });
});

test("a partial complimentary completion offers support without claiming success or asking for payment", async () => {
  for (const ready of [true, false]) {
    const tree = await complimentaryActivation({ registration: {
      ...complimentaryRegistration, state: "collecting", registeredAt: null, ready,
    } })();
    const html = renderToStaticMarkup(tree);
    assert.match(html, /No card or payment is needed/);
    assert.match(html, /registration has not finished/);
    assert.match(html, /mailto:connect@theruinedproject.com/);
    assert.doesNotMatch(html, /Stripe|Connection required|registration is confirmed/);
  }
});

function receiptFixture({ registration = complimentaryRegistration, calendarError = null, registrationError = null } = {}) {
  const Receipt = () => null;
  const logs = [];
  const Page = load("app/my/registered/page.tsx", {
    "next/navigation": { redirect },
    "@/components/membership/MemberRegistrationReceipt": Receipt,
    "@/components/platform/PlatformUnavailable": Stub,
    "@/lib/membership/page-context": { getMembershipPageContext: async (_preview, read) => ({
      state: "authenticated", viewer, configuration: {}, data: await read(viewer.authUserId),
    }) },
    "@/lib/membership/registration-repository": { getMemberRegistration: async () => {
      if (registrationError) throw registrationError;
      return registration;
    } },
    "@/lib/membership/preview-scenarios": { memberRegistrationPreview: Stub },
    "@/lib/membership/registration-routing": {},
    "@/lib/platform/experience-member-access": { hasEligibleExplicitExperienceInvitations: async () => {
      if (calendarError) throw calendarError;
      return true;
    } },
  }, logs);
  return { Page, Receipt, logs };
}

test("an unavailable optional calendar lookup does not hide a confirmed complimentary receipt", async () => {
  const fixture = receiptFixture({ calendarError: new Error("PRIVATE_DATABASE_DETAILS") });
  const tree = await fixture.Page();
  assert.equal(tree.type, fixture.Receipt);
  assert.equal(tree.props.registeredAt, complimentaryRegistration.registeredAt);
  assert.equal(tree.props.requiresPaymentMethod, false);
  assert.equal(tree.props.invitedCalendarAvailable, false);
  assert.deepEqual(fixture.logs, [["Registration calendar availability could not be loaded", { errorType: "Error" }]]);
});

test("a required registration read failure is not converted into a successful receipt", async () => {
  const error = new Error("Registration unavailable");
  const fixture = receiptFixture({ registrationError: error });
  await assert.rejects(fixture.Page, error);
  assert.deepEqual(fixture.logs, []);
});

test("ready intake without a recorded completion explains the remaining registration issue", async () => {
  const fixture = receiptFixture({ registration: {
    ...complimentaryRegistration, state: "collecting", registeredAt: null,
  } });
  const tree = await fixture.Page();
  assert.notEqual(tree.type, fixture.Receipt);
  assert.notEqual(tree.type, Stub);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /registration needs a final check/);
  assert.match(html, /registration is not complete yet/);
  assert.match(html, /mailto:connect@theruinedproject.com/);
  assert.doesNotMatch(html, /Connection required|Stripe|\/my\/activate|registration is confirmed/);
});
