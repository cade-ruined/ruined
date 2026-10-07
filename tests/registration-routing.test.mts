import assert from "node:assert/strict";
import test from "node:test";
import { canReviewRegistrationBilling, memberRegistrationDestination, registrationPaymentDestination } from "../src/lib/membership/registration-routing.ts";
import type { MemberRegistrationSnapshot } from "../src/lib/membership/registration-model.ts";

const legacy: MemberRegistrationSnapshot = {
  memberId: "fixture-member", state: "collecting", registeredAt: null, profileActivatedAt: null,
  requiresInitialPayment: false, requiresPaymentMethod: true, completionBasis: null,
  initialPayment: null, profileComplete: true, ready: false, version: 1,
};

test("historical registration goes from complete intake to paid checkout without a separate saved card", () => {
  const before = structuredClone(legacy);
  assert.equal(memberRegistrationDestination(legacy, true), "/my/activate");
  assert.equal(registrationPaymentDestination(legacy, true), "/my/activate");
  assert.equal(canReviewRegistrationBilling(legacy, true), true);
  assert.deepEqual(legacy, before, "Routing must not rewrite the original payment requirement or completion");
});

test("the historical no-charge flow remains when paid checkout is not open", () => {
  assert.equal(memberRegistrationDestination(legacy, false), "/my/payment-method");
  assert.equal(registrationPaymentDestination(legacy, false), "/my/payment-method");
  assert.equal(canReviewRegistrationBilling(legacy, false), false);
});

test("new pay-at-registration accounts are never silently downgraded to save-card", () => {
  const prepaid = { ...legacy, requiresInitialPayment: true, requiresPaymentMethod: false };
  for (const available of [false, true]) assert.equal(memberRegistrationDestination(prepaid, available), "/my/activate");
});

test("incomplete intake always precedes payment and never permits billing review", () => {
  for (const available of [false, true]) {
    const incomplete = { ...legacy, profileComplete: false };
    assert.equal(memberRegistrationDestination(incomplete, available), "/my/join");
    assert.equal(canReviewRegistrationBilling(incomplete, available), false);
  }
});

test("completed saved-card registrations keep their receipt and activated members keep profile access", () => {
  for (const available of [false, true]) {
    const completed = { ...legacy, ready: true, state: "registered" as const, completionBasis: "saved_card" as const };
    assert.equal(memberRegistrationDestination(completed, available), "/my/registered");
    assert.equal(memberRegistrationDestination({ ...completed, state: "activated" }, available), null);
    assert.equal(memberRegistrationDestination(null, available), null);
  }
});

test("complimentary intake does not lead to paid checkout even when Stripe is available", () => {
  const complimentary = { ...legacy, requiresPaymentMethod: false };
  assert.equal(registrationPaymentDestination(complimentary, true), "/my/registered");
  assert.equal(memberRegistrationDestination(complimentary, true), "/my/registered");
  assert.equal(canReviewRegistrationBilling(complimentary, true), false);
});
