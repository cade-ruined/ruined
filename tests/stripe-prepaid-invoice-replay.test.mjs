import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { prepaidFixtureDependencies, foundationsScheduleFixture, prepaidPolicyFixture } from "./helpers/prepaid-policy-fixture.mjs";
async function load(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} }, deps = { ...prepaidFixtureDependencies, ...dependencies };
  new Function("require", "module", "exports", code)(name => { assert.ok(name in deps, name); return deps[name]; }, result, result.exports);
  return result.exports;
}
const pricing = await load("src/lib/membership/pricing.ts");
const prices = await load("src/lib/stripe/price-policy.ts", { "@/lib/membership/pricing": pricing });
const state = await load("src/lib/stripe/membership-state.ts");
const schedule = foundationsScheduleFixture.foundationsBillingScheduleForMonth("2026-11", "monthly");
const memberId = "11111111-1111-4111-8111-111111111111", attemptId = "22222222-2222-4222-8222-222222222222", acceptanceId = "33333333-3333-4333-8333-333333333333";

async function fixture(currentPaid) {
  const writes = [], projected = [], retrieved = [], stored = [];
  const price = { id: "price_member", product: "prod_member", active: true, livemode: false, type: "recurring", billing_scheme: "per_unit", transform_quantity: null,
    tax_behavior: "exclusive", currency: "usd", unit_amount: 34900, recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } };
  const start = Date.parse("2026-10-05T18:00:00Z") / 1000, prepaidEnd = Date.parse(schedule.prepaidThrough) / 1000;
  const metadata = { ruined_context: "membership", ruined_member_id: memberId, ruined_checkout_attempt_id: attemptId, agreement_acceptance_id: acceptanceId,
    agreement_version: "ruined_membership-v3", billing_terms_version: "membership-billing-v2", ruined_offer_id: "founding_individual_monthly", ruined_billing_plan: "monthly",
    ruined_commercial_reservation_id: attemptId, ...prepaidPolicyFixture.prepaidBillingMetadata(schedule) };
  const subscription = { id: "sub_member", customer: "cus_member", livemode: false, status: currentPaid ? "active" : "past_due", metadata,
    start_date: start, trial_end: prepaidEnd, billing_cycle_anchor: prepaidEnd, latest_invoice: "in_renewal", automatic_tax: { enabled: false, disabled_reason: null },
    items: { has_more: false, data: [{ id: "si_member", quantity: 1, price, current_period_start: prepaidEnd, current_period_end: prepaidEnd + 31 * 86400 }] } };
  const common = { livemode: false, customer: subscription.customer, customer_email: "member@example.test", currency: "usd", status: "paid", amount_due: 34900, amount_paid: 34900, amount_remaining: 0,
    total: 34900, total_excluding_tax: 34900, total_discount_amounts: [], status_transitions: { paid_at: start }, metadata: {},
    parent: { subscription_details: { subscription: subscription.id, metadata } } };
  const line = { livemode: false, currency: "usd", quantity: 1, subtotal: 34900, amount: 34900, period: { start, end: prepaidEnd },
    pricing: { type: "price_details", price_details: { price: price.id, product: price.product } },
    parent: { type: "subscription_item_details", subscription_item_details: { subscription: subscription.id, subscription_item: "si_member", proration: false } } };
  const initial = { ...common, id: "in_initial", billing_reason: "subscription_create", lines: { has_more: false, data: [
    { ...line, pricing: { type: "price_details", price_details: { price: "price_upfront", product: price.product } }, parent: { type: "invoice_item_details", invoice_item_details: { subscription: subscription.id, invoice_item: "ii_upfront", proration: false } } },
    { ...line, subtotal: 0, amount: 0 },
  ] } };
  const current = { ...common, id: "in_renewal", billing_reason: "subscription_cycle", status: currentPaid ? "paid" : "open", amount_paid: currentPaid ? 34900 : 0,
    amount_remaining: currentPaid ? 0 : 34900, status_transitions: { paid_at: currentPaid ? prepaidEnd : null },
    lines: { has_more: false, data: [{ ...line, period: { start: prepaidEnd, end: prepaidEnd + 31 * 86400 } }] } };
  const stripe = { subscriptions: { retrieve: async () => subscription }, invoices: { retrieve: async id => { retrieved.push(id); assert.ok([initial.id, current.id].includes(id)); return id === initial.id ? initial : current; } } };
  const processor = await load("src/lib/stripe/webhook.ts", {
    "server-only": {}, "@/lib/membership/pricing": pricing, "@/lib/stripe/membership-state": state, "@/lib/stripe/price-policy": prices,
    "@/lib/membership/registration-repository": { reconcilePaidMemberRegistrations: async () => {} },
    "@/lib/membership/badge-repository": { reconcileMemberBadgesForStripeEvent: async () => {} },
    "@/lib/stripe/database": { getBillingDatabase: () => ({ begin: async fn => fn(async () => []) }) },
    "@/lib/stripe/server": { getStripe: () => stripe, getMembershipPriceConfiguration: () => ({ livemode: false, offers: { founding_individual_monthly: price.id } }), isStripeTaxEnabled: () => false },
    "@/lib/stripe/billing-repository": {
      claimWebhookEvent: async () => "claimed", completeWebhookEvent: async () => {}, recordWebhookFailure: async () => {},
      ensureBillingMember: async () => ({ id: memberId, membershipState: "active" }), findMemberBySubscription: async () => ({ id: memberId, membershipState: "active" }),
      hasMembershipCheckoutConsent: async (_, consent) => { assert.deepEqual(consent.billingSchedule, schedule); return true; },
      upsertInvoice: async (_, value) => stored.push(value.id), upsertSubscription: async () => {}, updateMemberBillingState: async (_, value) => writes.push(value),
    },
    "@/lib/stripe/commitment-webhook": { lockCommitmentSubscriptionProjection: async () => {}, invalidateCommitmentFromInvoice: async () => {}, hasVerifiedCommitmentInvoicePayment: async (_, invoice) => invoice.id === current.id && currentPaid,
      projectCommercialParticipantBillingState: async () => {} },
    "@/lib/stripe/prepaid-webhook": { projectPrepaidMembershipInvoice: async (_, input) => { projected.push(input); return input.verifiedPayment ? "active" : "attention_required"; } },
  });
  return { projected, retrieved, stored, writes, replay: () => processor.processStripeWebhookEvent({ id: "evt_old_initial_new_delivery", created: start, livemode: false, type: "invoice.paid", data: { object: initial } }) };
}

test("old prepaid initial invoice replay reconciles the current paid renewal without downgrading membership", async () => {
  const f = await fixture(true); await f.replay();
  assert.deepEqual(f.stored, ["in_initial", "in_renewal"]);
  assert.ok(f.retrieved.includes("in_renewal"));
  assert.equal(f.projected.length, 1); assert.equal(f.projected[0].invoice.id, "in_renewal"); assert.equal(f.projected[0].verifiedPayment, true);
  assert.deepEqual(f.writes.map(value => value.state), ["active"]);
});

test("old prepaid initial paid invoice cannot grant access when the current renewal is unpaid", async () => {
  const f = await fixture(false); await f.replay();
  assert.equal(f.projected.length, 1); assert.equal(f.projected[0].invoice.id, "in_renewal"); assert.equal(f.projected[0].verifiedPayment, false);
  assert.deepEqual(f.writes.map(value => value.state), ["attention_required"]);
});
