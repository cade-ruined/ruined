import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, loaded, loaded.exports);
  return loaded.exports;
}
const pricing = await load("src/lib/membership/pricing.ts");
const policy = await load("src/lib/stripe/commitment-policy.ts", { "node:crypto": { createHash }, "@/lib/membership/pricing": pricing });
function contract(offerId = "individual_monthly", extra = {}) {
  return policy.buildMembershipCommitment({ id: "11111111-1111-4111-8111-111111111111", memberId: "22222222-2222-4222-8222-222222222222",
    subscriptionId: "sub_member", customerId: "cus_member", livemode: false, offerId, priceId: "price_member", agreementAcceptanceId: "33333333-3333-4333-8333-333333333333",
    agreementVersion: "ruined_membership-v2", agreementContentSha256: "a".repeat(64), acceptedAt: "2026-09-01T00:00:00.000Z", startsAt: "2026-09-15T12:00:00.000Z",
    billingTermsVersion: "membership-billing-v2", ...extra });
}
function invoice(c, month, extra = {}) {
  const step = c.billingPlan === "annual" ? 12 : 1;
  return { invoiceId: `in_${month}`, periodStart: policy.membershipCommitmentAnniversary(c.startsAt, month),
    periodEnd: policy.membershipCommitmentAnniversary(c.startsAt, month + step), priceId: c.priceId, currency: "usd",
    duesBilled: c.installmentDues, duesPaid: c.installmentDues, duesRefunded: 0, duesCredited: 0, state: "paid", adjustmentState: "none", ...extra };
}
function ledger(c, months = 1, changes = {}) {
  const now = new Date(Date.parse(policy.membershipCommitmentAnniversary(c.startsAt, months - 1)) + 1000);
  return { now, value: { revision: 1, reconciledAt: now.toISOString(), state: "complete", invoices: Array.from({ length: months }, (_, month) => invoice(c, month)), ...changes } };
}

test("snapshots exact accepted offer totals and a calendar year independent from Stripe monthly periods", () => {
  for (const [offer, total, installment] of [["individual_monthly", 598800, 49900], ["founding_individual_monthly", 418800, 34900], ["couple_monthly", 838800, 69900],
    ["individual_annual", 499000, 499000], ["founding_individual_annual", 349000, 349000], ["couple_annual", 699000, 699000]]) {
    const c = contract(offer); assert.equal(c.totalInitialDues, total); assert.equal(c.installmentDues, installment); assert.equal(c.initialTermEndsAt, "2027-09-15T12:00:00.000Z");
  }
  assert.equal(policy.membershipCommitmentAnniversary("2024-02-29T18:00:00Z", 12), "2025-02-28T18:00:00.000Z");
  assert.equal(policy.membershipCommitmentAnniversary("2026-01-31T18:00:00Z", 1), "2026-02-28T18:00:00.000Z");
  assert.equal(policy.membershipCommitmentAnniversary("2026-01-31T18:00:00Z", 2), "2026-03-31T18:00:00.000Z");
  assert.doesNotThrow(() => contract("individual_monthly", { acceptedAt: "2026-09-15T12:00:00.123Z" }));
  assert.throws(() => contract("individual_monthly", { acceptedAt: "2026-09-15T12:00:01.001Z" }), /unaccepted_commitment/);
  assert.throws(() => contract("individual_monthly", { billingTermsVersion: "membership-billing-v1" }), /unaccepted_commitment/);
});

test("buyout replaces remaining dues, is capped at $1500, and preserves the fully paid period", () => {
  for (const [offer, months, expected] of [["individual_monthly", 1, 150000], ["individual_monthly", 9, 149700], ["individual_monthly", 11, 49900],
    ["founding_individual_monthly", 11, 34900], ["couple_monthly", 11, 69900], ["individual_monthly", 12, 0]]) {
    const c = contract(offer), l = ledger(c, months), quote = policy.quoteMembershipCancellation(c, l.value, "early_exit", l.now);
    assert.equal(quote.buyoutDues, expected); assert.equal(quote.replacesRemainingInstallments, true);
    assert.equal(quote.effectiveAt, policy.membershipCommitmentAnniversary(c.startsAt, months));
    assert.equal(quote.accessThrough, quote.effectiveAt);
  }
});

test("annual prepaid has no buyout and keeps the whole prepaid year", () => {
  const c = contract("individual_annual"), l = ledger(c);
  const quote = policy.quoteMembershipCancellation(c, l.value, "early_exit", l.now);
  assert.equal(quote.buyoutDues, 0); assert.equal(quote.replacesRemainingInstallments, false); assert.equal(quote.effectiveAt, c.initialTermEndsAt);
});

test("tax is never subtracted as principal; partial payments, refunds and credits are accounted explicitly", () => {
  const c = contract(), l = ledger(c, 11);
  l.value.invoices[10] = invoice(c, 10, { duesPaid: 30000, state: "open" });
  assert.equal(policy.quoteMembershipCancellation(c, l.value, "early_exit", l.now).buyoutDues, 69800);
  l.value.invoices[10] = invoice(c, 10, { duesRefunded: 10000 });
  assert.throws(() => policy.quoteMembershipCancellation(c, l.value, "early_exit", l.now), /invoice_review_required/);
  l.value.invoices[10].adjustmentState = "reviewed";
  assert.equal(policy.quoteMembershipCancellation(c, l.value, "early_exit", l.now).buyoutDues, 59900);
  l.value.invoices[10].duesCredited = 10000;
  assert.equal(policy.quoteMembershipCancellation(c, l.value, "early_exit", l.now).buyoutDues, 49900);
  l.value.invoices[10].duesPaid += 4000;
  assert.throws(() => policy.quoteMembershipCancellation(c, l.value, "early_exit", l.now), /invoice_review_required/);
});

test("missing, stale, overlapping, prorated and ambiguous monetary evidence fails closed", () => {
  const c = contract(), l = ledger(c, 2);
  for (const changed of [{ state: "unknown" }, { reconciledAt: "2026-09-15T12:00:00.000Z" }, { invoices: [l.value.invoices[1]] },
    { invoices: [...l.value.invoices, l.value.invoices[1]] }, { invoices: [invoice(c, 0, { duesBilled: 10000 }), l.value.invoices[1]] },
    { invoices: [invoice(c, 0, { state: "void" }), l.value.invoices[1]] }, { invoices: [invoice(c, 0, { adjustmentState: "unresolved" }), l.value.invoices[1]] }]) {
    assert.throws(() => policy.quoteMembershipCancellation(c, { ...l.value, ...changed }, "early_exit", l.now), policy.MembershipCommitmentError);
  }
});

test("turning off renewal needs no invoice ledger or fee even when payment is overdue", () => {
  const c = contract(), now = new Date("2026-10-16T00:00:00Z");
  const provider = { subscriptionId: c.subscriptionId, customerId: c.customerId, livemode: false,
    currentPeriodEnd: "2026-11-15T12:00:00.000Z", status: "past_due", observedAt: now.toISOString() };
  const quote = policy.quoteMembershipRenewalCancellation(c, provider, now);
  assert.equal(quote.buyoutDues, 0); assert.equal(quote.remainingInitialDues, null); assert.equal(quote.ledgerRevision, 0);
  assert.equal(quote.effectiveAt, c.initialTermEndsAt); assert.equal(quote.accessThrough, null);
  const earlier = policy.quoteMembershipRenewalCancellation(c, { ...provider, cancelAt: provider.currentPeriodEnd }, now);
  assert.equal(earlier.effectiveAt, provider.currentPeriodEnd, "never extend a prior valid cancellation");
  assert.throws(() => policy.quoteMembershipRenewalCancellation(c, { ...provider, livemode: true }, now), /provider_snapshot_required/);
});

test("prestart cancellation is free for every offer and expires at the immutable start", () => {
  for (const offer of Object.keys(pricing.MEMBERSHIP_OFFERS)) {
    const c = contract(offer, { startsAt: "2026-11-01T06:00:00.000Z" });
    const now = new Date("2026-11-01T05:59:00.000Z");
    const provider = { subscriptionId: c.subscriptionId, customerId: c.customerId, livemode: false,
      status: "active", firstChargeAt: c.startsAt, canceledAt: null, observedAt: now.toISOString(), hasInvoices: false, pendingInvoiceItems: false };
    const quote = policy.quoteMembershipPrestartCancellation(c, provider, now);
    assert.equal(quote.intent, "cancel_before_start"); assert.equal(quote.buyoutDues, 0); assert.equal(quote.remainingInitialDues, 0);
    assert.equal(quote.accessThrough, null); assert.equal(quote.effectiveAt, now.toISOString()); assert.equal(quote.expiresAt, c.startsAt);
    for (const change of [{ status: "canceled" }, { hasInvoices: true }, { pendingInvoiceItems: true }, { customerId: "cus_other" },
      { livemode: true }, { firstChargeAt: "2026-11-02T06:00:00.000Z" }, { observedAt: "2026-11-01T05:50:00.000Z" }]) {
      assert.throws(() => policy.quoteMembershipPrestartCancellation(c, { ...provider, ...change }, now), /prestart_cancellation_requires_review/);
    }
    assert.throws(() => policy.quoteMembershipPrestartCancellation(c, provider, new Date(c.startsAt)), /prestart_cancellation_requires_review/);
    assert.throws(() => policy.quoteMembershipRenewalCancellation(c, { ...provider, currentPeriodEnd: c.startsAt }, now), /snapshot_required/);
    assert.notEqual(policy.cancellationQuoteFingerprint({ ...quote, prestartProviderSnapshot: { ...provider, hasInvoices: true } }), quote.fingerprint);
  }
});
