import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBillingGuardrails,
  deriveMembershipState,
  isPlausibleEmail,
  isUuid,
  normalizeEmail,
} from "../src/lib/stripe/membership-state.ts";

test("billing failures require attention without overriding a terminal cancellation", () => {
  assert.equal(
    applyBillingGuardrails({ hasOperationalProblem: true, state: "active" }),
    "attention_required",
  );
  assert.equal(
    applyBillingGuardrails({ hasOperationalProblem: true, state: "ended" }),
    "ended",
  );
});

test("only a paid invoice can activate a pending membership", () => {
  assert.equal(
    deriveMembershipState({
      paidInvoice: false,
      previousState: "pending",
      subscriptionState: "active",
    }),
    "pending",
  );

  assert.equal(
    deriveMembershipState({
      paidInvoice: true,
      previousState: "pending",
      subscriptionState: "active",
    }),
    "active",
  );
});

test("a healthy subscription update preserves an already active membership", () => {
  assert.equal(
    deriveMembershipState({
      paidInvoice: false,
      previousState: "active",
      subscriptionState: "active",
    }),
    "active",
  );
});

test("billing problems are visible without pretending they are paid", () => {
  for (const subscriptionState of ["past_due", "paused", "unpaid"] as const) {
    assert.equal(
      deriveMembershipState({
        paidInvoice: false,
        previousState: "active",
        subscriptionState,
      }),
      "attention_required",
    );
  }
});

test("attention remains until a later paid invoice resolves it", () => {
  assert.equal(
    deriveMembershipState({
      paidInvoice: false,
      previousState: "attention_required",
      subscriptionState: "active",
    }),
    "attention_required",
  );

  assert.equal(
    deriveMembershipState({
      paidInvoice: true,
      previousState: "attention_required",
      subscriptionState: "active",
    }),
    "active",
  );
});

test("an ended membership is not resurrected by a subscription update alone", () => {
  assert.equal(
    deriveMembershipState({
      paidInvoice: false,
      previousState: "ended",
      subscriptionState: "active",
    }),
    "ended",
  );
});

test("terminal Stripe states end membership billing state", () => {
  for (const subscriptionState of ["canceled", "incomplete_expired"] as const) {
    assert.equal(
      deriveMembershipState({
        paidInvoice: false,
        previousState: "active",
        subscriptionState,
      }),
      "ended",
    );
  }
});

test("checkout identity validation normalizes email and accepts only UUID v4", () => {
  assert.equal(normalizeEmail("  Member@Example.COM "), "member@example.com");
  assert.equal(isPlausibleEmail("member@example.com"), true);
  assert.equal(isPlausibleEmail("not-an-email"), false);
  assert.equal(isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isUuid("550e8400-e29b-11d4-a716-446655440000"), false);
});
