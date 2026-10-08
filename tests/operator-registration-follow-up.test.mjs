import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Follow-up instructions must not call service modules: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const { operatorMemberJourney } = load("src/lib/membership/operator-registration-progress.ts");
const { operatorRegistrationFollowUp } = load("src/lib/membership/operator-registration-follow-up.ts", {
  "@/lib/auth/support-return": load("src/lib/auth/support-return.ts"),
});
const memberId = "00000000-0000-4000-8000-000000000101";
const at = "2026-10-08T18:00:00Z";
const registration = (progress = {}, fields = {}) => ({
  memberId, email: "cherry@example.test", name: "Cherry Hill", coupleStatus: null, couplePartnerEmail: null,
  progress: { state: "collecting", registeredAt: null, profileComplete: true, ready: false,
    requiresInitialPayment: true, requiresPaymentMethod: false, completionBasis: null,
    emailVerified: true, paymentMethodState: "missing", paymentConfirmed: false, paymentExempt: false,
    billingArranged: false, billingState: "pending", serviceStartsAt: null, paidCheckoutAvailable: true, ...progress },
  ...fields,
});
const followUp = row => operatorRegistrationFollowUp(row, row.progress ? operatorMemberJourney(row.progress) : null);
const expectedLink = destination => `https://members.theruinedproject.com/access${destination ? `?returnTo=${encodeURIComponent(destination)}` : ""}`;
const assertShare = (action, destination, recipient = "cherry@example.test") => {
  assert.equal(action.kind, "share");
  assert.equal(action.memberUrl, expectedLink(destination));
  assert.equal(action.recipient, recipient);
  assert.ok(action.message.includes(`\n\n${action.memberUrl}\n\nSign in with ${recipient}. We'll email you a confirmation code.`));
  assert.equal(action.operatorHref, `/ops/members/${memberId}?returnTo=%2Fops%2Fregistrations#membership`);
  assert.doesNotMatch(action.memberUrl, /cherry|memberId|token|secret/);
};
const assertNotShare = (action, kind) => {
  assert.equal(action.kind, kind);
  for (const key of ["memberUrl", "message", "recipient"]) assert.equal(action[key], undefined, key);
};

test("unverified email and incomplete information receive the correct sign-in destination", () => {
  const email = followUp(registration({ emailVerified: false, profileComplete: false }));
  assertShare(email, null); assert.equal(email.title, "Send the email confirmation link");
  const information = followUp(registration({ profileComplete: false }));
  assertShare(information, "/my/join"); assert.match(information.message, /information and registration terms/);
});

test("unpaid members receive the payment link whether a card is missing or already saved", () => {
  for (const paymentMethodState of ["missing", "saved", "removed"]) {
    const action = followUp(registration({ paymentMethodState }));
    assertShare(action, "/my/activate"); assert.equal(action.title, "Send the payment link");
    assert.match(action.message, /review the price and membership terms before paying securely through Stripe/);
    assert.doesNotMatch(action.message, /charged|automatically pay/i);
  }
  const resumed = followUp(registration({ checkoutStarted: true }));
  assertShare(resumed, "/my/activate"); assert.equal(resumed.title, "Send the checkout resume link");
  assert.match(resumed.detail, /already paid, review billing/);
});

test("shared billing follows up with the canonical paired recipient, never asks the nonpayer to pay separately", () => {
  const action = followUp(registration({ paymentByPartner: true }, { coupleStatus: "paired", couplePartnerEmail: "payer@example.test" }));
  assertShare(action, "/my/activate", "payer@example.test");
  assert.match(action.message, /shared Ruined membership/); assert.doesNotMatch(action.message, /cherry@example\.test/);
  assert.match(action.detail, /does not need a separate checkout/);
  for (const fields of [{ coupleStatus: "pending", couplePartnerEmail: "payer@example.test" }, { coupleStatus: "paired", couplePartnerEmail: null }]) {
    const review = followUp(registration({ paymentByPartner: true }, fields));
    assertNotShare(review, "review"); assert.equal(review.title, "Confirm the paying partner");
  }
});

test("closed checkout holds every payment follow-up, including already-started and shared checkout", () => {
  for (const overrides of [{}, { checkoutStarted: true }, { paymentByPartner: true }]) {
    const action = followUp(registration({ paidCheckoutAvailable: false, ...overrides }, { coupleStatus: "paired", couplePartnerEmail: "payer@example.test" }));
    assertNotShare(action, "review"); assert.equal(action.title, "Hold payment follow-up");
  }
});

test("complimentary and verified-paid members receive access review instead of another payment link", () => {
  for (const overrides of [{ paymentExempt: true }, { paymentConfirmed: true, paymentReceivedAt: at }]) {
    const action = followUp(registration({ registeredAt: at, ready: true, ...overrides }));
    assertNotShare(action, "release"); assert.equal(action.title, "Review and grant profile access");
    assert.match(action.detail, /after you confirm/);
  }
});

test("uncertain billing, refunds, historical payments and unavailable evidence only direct an operator to review", () => {
  for (const overrides of [{ paymentNeedsReview: true }, { historicalPaymentRecorded: true }, { billingState: "attention_required" }, { billingArranged: true }, { paymentConfirmed: true }]) {
    const action = followUp(registration(overrides));
    assertNotShare(action, "review"); assert.equal(action.title, "Review this registration");
    assert.match(action.operatorHref, /#membership$/);
  }
  const unavailable = followUp(registration({}, { progress: null }));
  assertNotShare(unavailable, "review"); assert.match(unavailable.detail, /check their registration before sending/);
});

test("complete onboarding has no payment request or automatic profile action", () => {
  for (const override of [{ paymentExempt: true }, { paymentConfirmed: true }]) {
    const action = followUp(registration({ state: "activated", profileGranted: true, registeredAt: at, ready: true, ...override }));
    assertNotShare(action, "complete"); assert.equal(action.title, "No onboarding follow-up needed");
  }
});
