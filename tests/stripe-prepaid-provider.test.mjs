import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { prepaidPolicyFixture as prepaid, foundationsScheduleFixture as schedules } from "./helpers/prepaid-policy-fixture.mjs";

async function load(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, name); return dependencies[name];
  }, result, result.exports);
  return result.exports;
}
const pricing = await load("src/lib/membership/pricing.ts");
const policy = await load("src/lib/stripe/commitment-policy.ts", { "node:crypto": { createHash }, "@/lib/membership/pricing": pricing });
const prices = await load("src/lib/stripe/price-policy.ts", { "@/lib/membership/pricing": pricing, "./prepaid-policy": prepaid });
const config = { livemode: false, offers: { individual_monthly: "price_member" } };
const provider = await load("src/lib/stripe/prepaid-provider.ts", { "@/lib/stripe/commitment-policy": policy,
  "@/lib/stripe/prepaid-policy": prepaid, "@/lib/stripe/price-policy": prices,
  "@/lib/stripe/server": { getMembershipPriceConfiguration: () => config } });

function fixture() {
  const billingSchedule = schedules.foundationsBillingScheduleForMonth("2026-11", "monthly");
  const contract = policy.buildMembershipCommitment({ id: randomUUID(), memberId: randomUUID(), subscriptionId: "sub_member", customerId: "cus_member",
    livemode: false, offerId: "individual_monthly", priceId: "price_member", agreementAcceptanceId: randomUUID(), agreementVersion: "ruined_membership-v3",
    agreementContentSha256: "a".repeat(64), acceptedAt: "2026-10-05T20:00:00.000Z", startsAt: billingSchedule.serviceStartsAt,
    billingTermsVersion: "membership-billing-v2", billingSchedule });
  const subscription = { id: contract.subscriptionId, customer: contract.customerId, livemode: false, status: "trialing", start_date: Date.parse(contract.acceptedAt)/1000,
    trial_end: Date.parse(billingSchedule.prepaidThrough)/1000, billing_cycle_anchor: Date.parse(billingSchedule.prepaidThrough)/1000,
    metadata: { billing_terms_version: "membership-billing-v2", ruined_member_id: contract.memberId, ruined_checkout_attempt_id: contract.id,
      ruined_commercial_reservation_id: contract.id, agreement_acceptance_id: contract.agreementAcceptanceId, ruined_offer_id: contract.offerId,
      ruined_billing_plan: "monthly", ...prepaid.prepaidBillingMetadata(billingSchedule) },
    items: { has_more: false, data: [{ id: "si_member", quantity: 1, price: { id: contract.priceId, product: "prod_member", type: "recurring",
      unit_amount: contract.installmentDues, currency: "usd", livemode: false, billing_scheme: "per_unit", tax_behavior: "exclusive",
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } } }] } };
  const line = { currency: "usd", livemode: false, quantity: 1, period: { start: subscription.start_date, end: subscription.trial_end } };
  const invoice = { id: "in_first", customer: contract.customerId, livemode: false, currency: "usd", status: "paid", billing_reason: "subscription_create",
    total: 52993, total_excluding_tax: contract.installmentDues, amount_paid: 52993, amount_remaining: 0, customer_address: { country: "US" },
    pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0, starting_balance: 0, ending_balance: 0,
    parent: { subscription_details: { subscription: contract.subscriptionId } },
    lines: { has_more: false, data: [
      { ...line, amount: contract.installmentDues, subtotal: contract.installmentDues, pricing: { type: "price_details", price_details: { price: "price_once", product: "prod_member" } },
        parent: { type: "invoice_item_details", invoice_item_details: { invoice_item: "ii_first", subscription: contract.subscriptionId, proration: false } } },
      { ...line, amount: 0, subtotal: 0, pricing: { type: "price_details", price_details: { price: contract.priceId, product: "prod_member" } },
        parent: { type: "subscription_item_details", subscription_item_details: { subscription_item: "si_member", subscription: contract.subscriptionId, proration: false } } },
    ] } };
  const invoices = [invoice], refunds = [];
  const payment = { invoice: invoice.id, status: "paid", livemode: false, currency: "usd", amount_paid: invoice.total,
    payment: { type: "payment_intent", payment_intent: "pi_first" } };
  const charge = { id: "ch_first", payment_intent: "pi_first", status: "succeeded", paid: true, captured: true, disputed: false,
    customer: contract.customerId, currency: "usd", livemode: false, amount: invoice.total, amount_refunded: 0, refunded: false };
  const stripe = { subscriptions: { retrieve: async () => subscription },
    invoices: { list: () => ({ async *[Symbol.asyncIterator]() { yield* invoices; } }), retrieve: async () => invoice },
    creditNotes: { list: async () => ({ data: [], has_more: false }) }, invoicePayments: { list: async () => ({ data: [payment], has_more: false }) },
    paymentIntents: { retrieve: async () => ({ id: "pi_first", latest_charge: charge.id, status: "succeeded", amount_received: invoice.total,
      currency: "usd", livemode: false, customer: contract.customerId }) }, charges: { retrieve: async () => charge },
    refunds: { list: async () => ({ data: refunds, has_more: false }) } };
  return { contract, subscription, invoice, invoices, payment, charge, refunds, stripe,
    inspect: options => provider.inspectPrepaidMembershipInvoice(stripe, contract, options) };
}

test("prepaid inspection binds actual initial cash to immutable service coverage and detects extra invoices", async () => {
  const f = fixture(), proof = await f.inspect({ requireOnlyInitialInvoice: true });
  assert.equal(proof.amount, 52993); assert.equal(proof.periodStart, f.contract.startsAt);
  assert.equal(proof.periodEnd, f.contract.billingSchedule.prepaidThrough); assert.equal(proof.refund, null);
  f.invoices.push({ id: "in_unexpected", billing_reason: "manual" });
  await assert.rejects(f.inspect({ requireOnlyInitialInvoice: true }), /requires_review/);
});

test("failed and pending full refunds remain visible for safe retries; succeeded requires matching cash readback", async () => {
  for (const status of ["failed", "canceled", "pending", "succeeded"]) {
    const f = fixture(); f.refunds.push({ id: "re_first", status, amount: f.invoice.total, currency: "usd", charge: f.charge.id,
      payment_intent: "pi_first", metadata: { ruined_cancellation_id: "recorded-cancellation" } });
    if (status === "succeeded") { f.charge.amount_refunded = f.invoice.total; f.charge.refunded = true; }
    assert.equal((await f.inspect({ allowRefund: true })).refund.status, status);
    await assert.rejects(f.inspect(), /requires_review/);
    if (status === "succeeded") {
      f.charge.amount_refunded--;
      await assert.rejects(f.inspect({ allowRefund: true }), /requires_review/);
    }
  }
});

test("wrong consent, price, settlement, partial refund and disputed charge cannot authorize prepaid refund", async () => {
  for (const mutate of [f => { f.subscription.metadata.ruined_commercial_reservation_id = randomUUID(); },
    f => { f.contract.priceId = "price_other"; }, f => { f.contract.offerId = "founding_individual_monthly"; },
    f => { f.payment.status = "pending"; }, f => { f.charge.disputed = true; },
    f => { f.refunds.push({ id: "re_partial", status: "pending", amount: 100, currency: "usd", charge: f.charge.id, payment_intent: "pi_first" }); }]) {
    const f = fixture(); mutate(f); await assert.rejects(f.inspect({ allowRefund: true }), /requires_review/);
  }
});
