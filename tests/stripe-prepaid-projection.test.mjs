import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { foundationsScheduleFixture as schedules, prepaidPolicyFixture as prepaid } from "./helpers/prepaid-policy-fixture.mjs";

async function load(path, dependencies = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, name);return dependencies[name];
  }, result, result.exports);
  return result.exports;
}
const pricing = await load("src/lib/membership/pricing.ts");
const membershipState = await load("src/lib/stripe/membership-state.ts");
const policy = await load("src/lib/stripe/commitment-policy.ts", { "node:crypto": { createHash }, "@/lib/membership/pricing": pricing });
const memberId = "22222222-2222-4222-8222-222222222222", partnerId = "11111111-1111-4111-8111-111111111111";
const reservationId = "33333333-3333-4333-8333-333333333333", acceptanceId = "44444444-4444-4444-8444-444444444444";

async function fixture({ existing = true } = {}) {
  const schedule = schedules.foundationsBillingScheduleForMonth("2026-11", "monthly"), log = [], states = [], partners = [];
  const reservation = { id: reservationId, memberId, offerId: "individual_monthly", stripePriceId: "price_member",
    stripeSubscriptionId: "sub_member", billingSchedule: schedule, status: "reserved", participants: [{ memberId }, { memberId: partnerId }] };
  const contract = policy.buildMembershipCommitment({ id: reservationId, memberId, subscriptionId: "sub_member", customerId: "cus_member",
    livemode: false, offerId: reservation.offerId, priceId: "price_member", agreementAcceptanceId: acceptanceId,
    agreementVersion: "ruined_membership-v3", agreementContentSha256: "a".repeat(64), acceptedAt: "2026-10-05T12:00:00.000Z",
    startsAt: schedule.serviceStartsAt, billingTermsVersion: "membership-billing-v2", billingSchedule: schedule });
  const subscription = { id: contract.subscriptionId, customer: contract.customerId, status: "trialing", livemode: false,
    latest_invoice: "in_initial", start_date: Date.parse(contract.acceptedAt) / 1000, canceled_at: null,
    automatic_tax: { enabled: false, disabled_reason: null }, cancel_at_period_end: false, cancel_at: null,
    trial_end: Date.parse(schedule.prepaidThrough) / 1000, billing_cycle_anchor: Date.parse(schedule.prepaidThrough) / 1000,
    metadata: { ruined_context: "membership", ruined_member_id: memberId, ruined_checkout_attempt_id: reservationId,
      agreement_acceptance_id: acceptanceId, ruined_commercial_reservation_id: reservationId, ruined_offer_id: reservation.offerId,
      ruined_billing_plan: "monthly", billing_terms_version: "membership-billing-v2", ...prepaid.prepaidBillingMetadata(schedule) },
    items: { data: [{ id: "si_member", price: { id: "price_member" }, current_period_start: 1, current_period_end: 2 }] } };
  const invoice = { id: "in_initial", customer: contract.customerId, customer_email: "member@example.test", livemode: false,
    currency: "usd", status: "paid", amount_due: 52993, amount_paid: 52993, billing_reason: "subscription_create",
    status_transitions: { paid_at: Date.parse(contract.acceptedAt) / 1000 },
    parent: { subscription_details: { subscription: subscription.id, metadata: { ruined_context: "membership" } } } };
  const state = { proof: existing ? { reservationId, refundState: "none", activatedAt: null } : null,
    contract: existing ? contract : null, inspectError: null, inspectedSubscription: null, reservationStatuses: [],
    inspected: 0, recorded: [], created: [], activated: 0, released: 0 };
  const tx = async (strings, ...values) => {
    const sql = strings.join("?");
    if (sql.includes("from ruined_members")) { log.push("members");assert.deepEqual(values[0], [partnerId, memberId]); }
    else if (sql.includes("from member_lifecycle")) log.push("lifecycle");
    else if (sql.includes("pg_advisory_xact_lock")) log.push("commercial");
    else if (sql.includes("select acceptance.id")) return [{ acceptanceId, agreementVersion: contract.agreementVersion,
      agreementContentSha256: contract.agreementContentSha256, acceptedAt: new Date(contract.acceptedAt) }];
    else if (sql.includes('select reservation_id as "reservationId"')) return [{ reservationId }];
    return [];
  };
  const commercial = {
    getCommercialMembershipReservation: async () => state.reservationStatuses.length
      ? { ...reservation, status: state.reservationStatuses.shift() } : reservation,
    getCommercialBillingGroupBySubscription: async () => null,
    activateCommercialMembership: async () => { log.push("activate");state.activated++; },
    releasePrepaidCommercialMembership: async () => { log.push("release");state.released++;reservation.status = "released"; },
    reconcileCommercialMemberships: async () => {},
  };
  const billing = {
    getMembershipPrepayment: async () => { log.push("proof");return state.proof; },
    recordMembershipPrepayment: async (_, input) => { log.push("recordProof");state.recorded.push(input);
      state.proof ??= { ...input, refundState: "none", activatedAt: null };return state.proof; },
    markMembershipPrepaymentReview: async (_, input) => { log.push("review");if (state.proof) Object.assign(state.proof, { refundState: "review_required", reviewReason: input.reason }); },
    upsertInvoice: async () => { log.push("invoice"); },
    updateMemberBillingState: async (_, input) => states.push(input),
    ensureBillingMember: async () => { log.push("ensureMember");return { id: memberId, membershipState: "active" }; },
    findMemberBySubscription: async () => { log.push("findMember");return null; },
    upsertSubscription: async () => { log.push("subscription"); },
    claimWebhookEvent: async () => "claimed", completeWebhookEvent: async () => {}, recordWebhookFailure: async () => {},
    hasMembershipCheckoutConsent: async () => true,
  };
  const commitments = {
    createMembershipCommitment: async (_, value) => { state.created.push(value);state.contract = value; },
    getMembershipCommitment: async () => { log.push("contract");return state.contract ? { contract: state.contract } : null; },
  };
  const stripe = { subscriptions: { retrieve: async () => subscription }, invoices: { retrieve: async () => invoice },
    customers: { retrieve: async () => ({ id: contract.customerId, email: "member@example.test" }) } };
  const helper = await load("src/lib/stripe/prepaid-webhook.ts", {
    "@/lib/membership/commercial-repository": commercial, "./commitment-policy": policy, "./commitment-repository": commitments,
    "./billing-repository": billing, "./prepaid-policy": prepaid, "./server": { getStripe: () => stripe },
    "./prepaid-provider": { inspectPrepaidMembershipInvoice: async () => {
      state.inspected++;if (state.inspectError) throw state.inspectError;
      return { subscription: state.inspectedSubscription ?? subscription, invoice, invoiceId: invoice.id,
        paymentIntentId: "pi_initial", chargeId: "ch_initial", amount: invoice.amount_paid };
    } },
  });
  const commitmentHelper = await load("src/lib/stripe/commitment-webhook.ts", {
    "./price-policy": { isMembershipOfferId: () => true }, "@/lib/membership/commercial-repository": commercial,
    "./billing-repository": billing, "./commitment-policy": policy, "./commitment-repository": commitments,
  });
  const webhook = await load("src/lib/stripe/webhook.ts", {
    "node:crypto": { randomUUID }, "@/lib/membership/badge-repository": { reconcileMemberBadgesForStripeEvent: async () => {} },
    "@/lib/membership/pricing": pricing, "@/lib/stripe/membership-state": membershipState, "@/lib/stripe/prepaid-policy": prepaid,
    "@/lib/stripe/price-policy": { recognizesMembershipSubscription: () => true, matchesMembershipInvoice: () => true, hasFullMembershipPayment: () => true },
    "@/lib/stripe/database": { getBillingDatabase: () => ({ begin: callback => callback(tx) }) },
    "@/lib/stripe/server": { getStripe: () => stripe, getMembershipPriceConfiguration: () => ({}), isStripeTaxEnabled: () => false },
    "@/lib/stripe/billing-repository": billing, "@/lib/stripe/prepaid-webhook": helper,
    "@/lib/stripe/commitment-webhook": { ...commitmentHelper, hasVerifiedCommitmentInvoicePayment: async () => true,
      invalidateCommitmentFromInvoice: async () => { log.push("invalidate");return true; },
      projectCommercialParticipantBillingState: async (_, input) => partners.push(input) },
  });
  const project = (verifiedPayment = true) => helper.projectPrepaidMembershipInvoice(tx, { subscription, invoice, memberId, eventCreated: 100, verifiedPayment });
  const event = type => webhook.processStripeWebhookEvent({ id: `evt_${type}`, created: 100, livemode: false, type,
    data: { object: type.startsWith("invoice.") ? invoice : subscription } });
  return { helper, project, event, subscription, invoice, reservation, schedule, state, log, states, partners, tx };
}

async function at(instant, action) { const original = Date.now;Date.now = () => Date.parse(instant);try { return await action(); } finally { Date.now = original; } }

test("settled prepayment creates cohort terms now but activates only on service start with current verified billing", async () => {
  const f = await fixture({ existing: false });
  await at("2026-10-05T13:00:00Z", async () => assert.equal(await f.project(), "pending"));
  assert.equal(f.state.created.length, 1);assert.equal(f.state.created[0].startsAt, f.schedule.serviceStartsAt);
  assert.equal(f.state.recorded[0].serviceStartsAt, f.schedule.serviceStartsAt);assert.equal(f.state.activated, 0);
  await at(f.schedule.serviceStartsAt, async () => {
    assert.equal(await f.project(false), "attention_required");assert.equal(f.state.activated, 0);
    assert.equal(await f.project(), "active");assert.equal(f.state.activated, 1);
    f.subscription.latest_invoice = "in_later";assert.equal(await f.project(), "attention_required");assert.equal(f.state.activated, 1);
  });
  assert.ok(f.log.indexOf("members") < f.log.indexOf("lifecycle"));
  assert.ok(f.log.indexOf("lifecycle") < f.log.indexOf("commercial"));
  assert.ok(f.log.indexOf("commercial") < f.log.indexOf("proof"));
  assert.ok(f.log.indexOf("proof") < f.log.indexOf("contract"));
});

test("adjusted prepayment stays held across paid replays; only canceled fully refunded unused enrollment releases", async () => {
  for (const refundState of ["pending", "partial", "refunded", "review_required"]) {
    const f = await fixture();f.state.proof.refundState = refundState;
    await at(f.schedule.serviceStartsAt, async () => assert.equal(await f.project(), "attention_required"));
    assert.equal(f.state.inspected, 0);assert.equal(f.state.activated, 0);assert.equal(f.state.released, 0);
    f.subscription.status = "canceled";f.subscription.canceled_at = Date.parse("2026-10-10T12:00:00Z") / 1000;
    assert.equal(await f.project(), refundState === "refunded" ? "pending" : "attention_required");
    assert.equal(f.state.released, refundState === "refunded" ? 1 : 0);
    if (refundState === "refunded") { assert.equal(await f.project(), null);assert.equal(f.state.released, 1); }
  }
  const used = await fixture();Object.assign(used.state.proof, { refundState: "refunded", activatedAt: used.schedule.serviceStartsAt });
  used.subscription.status = "canceled";used.subscription.canceled_at = Date.parse(used.schedule.serviceStartsAt) / 1000;
  assert.equal(await used.project(), "ended");assert.equal(used.state.released, 0);
});

test("provider adjustment is durable and malformed consent fails before payment inspection", async () => {
  const f = await fixture();f.state.inspectError = new policy.MembershipCommitmentError("prepaid_payment_requires_review");
  assert.equal(await f.project(), "attention_required");assert.equal(f.state.proof.refundState, "review_required");
  f.state.inspectError = null;assert.equal(await f.project(), "attention_required");assert.equal(f.state.inspected, 1);
  const wrong = await fixture();wrong.subscription.metadata.ruined_service_starts_at = "2026-11-15T22:00:00.000Z";
  await assert.rejects(wrong.project(), /commercial_consent_identity_mismatch/);assert.equal(wrong.state.inspected, 0);
});

test("fresh provider changes during verification cannot activate through the older subscription snapshot", async () => {
  for (const changes of [{ status: "canceled" }, { status: "past_due" }, { latest_invoice: "in_new_unpaid" }]) {
    const f = await fixture();f.state.inspectedSubscription = { ...f.subscription, ...changes };
    await at(f.schedule.serviceStartsAt, async () => assert.equal(await f.project(), "attention_required"));
    assert.equal(f.state.activated, 0);assert.equal(f.state.recorded.length, 0);
  }
});

test("released old subscription events leave a later active membership and partner projection untouched", async () => {
  for (const type of ["invoice.paid", "customer.subscription.updated", "customer.subscription.deleted"]) {
    const f = await fixture();f.reservation.status = "released";f.subscription.status = "canceled";
    f.state.proof.refundState = "refunded";f.subscription.canceled_at = Date.parse("2026-10-10T12:00:00Z") / 1000;
    const response = await f.event(type);assert.equal(response.handled, true);
    assert.deepEqual(f.states, []);assert.deepEqual(f.partners, []);assert.equal(f.state.inspected, 0);
    assert.equal(f.state.activated, 0);assert.equal(f.state.released, 0);
    assert.ok(f.log.indexOf("members") < f.log.indexOf("ensureMember"));
    assert.ok(f.log.indexOf("members") < f.log.indexOf("subscription"));
    assert.ok(!f.log.includes("invalidate"), "historical release cannot invalidate the new membership projection");
  }
});

test("a reservation released while commercial locks were waiting is re-read before any projection", async () => {
  const f = await fixture();f.state.reservationStatuses.push("reserved", "released");
  assert.equal(await f.project(), null);assert.equal(f.state.inspected, 0);assert.equal(f.state.activated, 0);
  assert.ok(f.log.includes("commercial"));assert.ok(!f.log.includes("proof"));
});

test("live invoice path takes sorted participant locks before payer writes and proof before contract invalidation", async () => {
  const f = await fixture();await at(f.schedule.serviceStartsAt, async () => f.event("invoice.paid"));
  assert.equal(f.states.at(-1).state, "active");assert.equal(f.partners.at(-1).state, "active");
  for (const label of ["ensureMember", "invoice", "subscription"]) assert.ok(f.log.indexOf("members") < f.log.indexOf(label), label);
  assert.ok(f.log.indexOf("commercial") < f.log.indexOf("proof"));
  assert.ok(f.log.indexOf("proof") < f.log.indexOf("contract"));
  assert.ok(f.log.indexOf("contract") < f.log.indexOf("invalidate"));
});
