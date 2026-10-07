import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/membership/operator-registration-progress.ts", import.meta.url), "utf8");
const result = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText)(result, result.exports);
const { operatorRegistrationStatus: status } = result.exports;
const registration = changes => ({ state: "collecting", registeredAt: null, profileComplete: true, ready: false,
  requiresInitialPayment: true, requiresPaymentMethod: false, completionBasis: null, emailVerified: true,
  paymentMethodState: "missing", paymentConfirmed: false, billingArranged: false, billingState: "pending", serviceStartsAt: null, ...changes });

test("verified abandoned signups and unverified invitations have separate next steps", () => {
  assert.equal(status(registration({ emailVerified: false, profileComplete: false })).label, "Email confirmation needed");
  const details = status(registration({ profileComplete: false }));
  assert.equal(details.label, "Information needed");
  assert.match(details.detail, /Email verified/);
  assert.equal(status(registration({})).label, "First payment needed");
});

test("paid, complimentary, and saved-card completion are never conflated", () => {
  const complete = { state: "registered", registeredAt: "2026-10-06T18:00:00Z", ready: true };
  const paid = status(registration({ ...complete, paymentConfirmed: true, completionBasis: "paid_membership" }));
  assert.equal(paid.label, "Payment received");
  assert.match(paid.detail, /profile held/);
  assert.doesNotMatch(JSON.stringify(paid), /Complimentary|pay again|First payment needed/);
  const complimentary = status(registration({ ...complete, requiresInitialPayment: false, requiresPaymentMethod: false, completionBasis: "complimentary" }));
  assert.equal(complimentary.label, "Complimentary");
  const saved = status(registration({ ...complete, requiresInitialPayment: false, requiresPaymentMethod: true, completionBasis: "saved_card", paymentMethodState: "saved" }));
  assert.equal(saved.label, "Card saved · not charged");
  assert.match(saved.next, /authorize paid activation/);
});

test("historical registration completion does not conceal a removed card or refunded payment", () => {
  const previous = { state: "registered", registeredAt: "2026-10-01T18:00:00Z", ready: false };
  const removed = status(registration({ ...previous, requiresInitialPayment: false, requiresPaymentMethod: true, completionBasis: "saved_card", paymentMethodState: "removed" }));
  assert.equal(removed.label, "Card needed");
  assert.match(removed.detail, /Previously registered · saved card removed/);
  const refunded = status(registration({ ...previous, completionBasis: "paid_membership", paymentConfirmed: false }));
  assert.equal(refunded.label, "Payment needs review");
  assert.match(refunded.next, /refund before asking the member to pay again/);
});

test("a subscription or billing arrangement alone is never payment received", () => {
  const arranged = status(registration({ billingArranged: true }));
  assert.equal(arranged.label, "Billing arranged");
  assert.match(arranged.detail, /payment not confirmed here/);
  assert.doesNotMatch(JSON.stringify(arranged), /Payment received|First payment needed/);
  const checkout = status(registration({ checkoutStarted: true }));
  assert.equal(checkout.label, "Checkout started");
  assert.match(checkout.next, /checks confirmation before another attempt/);
});

test("live paid checkout replaces the legacy save-card prerequisite without calling a card payment", () => {
  for (const paymentMethodState of ["missing", "removed", "saved"]) {
    const unpaid = status(registration({ requiresInitialPayment: false, requiresPaymentMethod: true,
      completionBasis: "saved_card", registeredAt: "2026-10-01T18:00:00Z", state: "registered",
      ready: paymentMethodState === "saved", paymentMethodState, paidCheckoutAvailable: true }));
    assert.equal(unpaid.label, "First payment needed");
    assert.match(unpaid.next, /\/my\/activate/);
    assert.match(unpaid.next, /No separate card-saving step/);
    assert.doesNotMatch(unpaid.label, /Payment received|Complimentary|Card needed/);
    if(paymentMethodState === "saved") assert.equal(unpaid.detail, "Card saved · not charged");
  }
});

test("legacy completed registration that later pays shows received despite its saved-card completion basis", () => {
  const paid = status(registration({ requiresInitialPayment: false, requiresPaymentMethod: true,
    completionBasis: "saved_card", registeredAt: "2026-10-01T18:00:00Z", state: "registered", ready: true,
    paymentMethodState: "removed", paymentConfirmed: true, billingArranged: true, paidCheckoutAvailable: true }));
  assert.equal(paid.label,"Payment received");
  assert.match(paid.detail,/profile held/);
  assert.equal(paid.next,"Operator opens the profile when ready.");
});

test("uncertain legacy proof requires review before asking for another charge", () => {
  const uncertain = status(registration({ requiresInitialPayment: false, requiresPaymentMethod: true,
    completionBasis: "saved_card", paidCheckoutAvailable: true, paymentNeedsReview: true, billingArranged: true }));
  assert.equal(uncertain.label, "Payment needs review");
  assert.match(uncertain.next, /refund before asking the member to pay again/);
});
