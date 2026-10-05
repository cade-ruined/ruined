import { prepaidFixtureDependencies } from "./helpers/prepaid-policy-fixture.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}) {
  dependencies = { ...prepaidFixtureDependencies, ...dependencies };
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} }; new Function("require", "module", "exports", output)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, loaded, loaded.exports); return loaded.exports;
}
const pricing = await load("src/lib/membership/pricing.ts"), state = await load("src/lib/stripe/membership-state.ts");
const policy = await load("src/lib/stripe/commitment-policy.ts", { "node:crypto": { createHash }, "@/lib/membership/pricing": pricing });
const memberId = "11111111-1111-4111-8111-111111111111", attemptId = "22222222-2222-4222-8222-222222222222", acceptanceId = "33333333-3333-4333-8333-333333333333";
function subscription() { return { id: "sub_member", start_date: Date.parse("2026-09-15T12:00:00Z") / 1000, livemode: false, status: "active", customer: "cus_member", latest_invoice: "in_paid",
  automatic_tax: { enabled: false, disabled_reason: null }, cancel_at_period_end: false, cancel_at: null,
  metadata: { ruined_context: "membership", ruined_member_id: memberId, ruined_checkout_attempt_id: attemptId, agreement_acceptance_id: acceptanceId,
    billing_terms_version: "membership-billing-v2", ruined_offer_id: "individual_monthly", ruined_billing_plan: "monthly", ruined_commercial_reservation_id: attemptId },
  items: { data: [{ id: "si_member", current_period_start: 1, current_period_end: 2, price: { id: "price_member", unit_amount: 49900 } }] } }; }
function invoice(extra = {}) { return { id: "in_paid", livemode: false, customer: "cus_member", customer_email: "member@example.test", currency: "usd", status: "paid", status_transitions: { paid_at: 100 }, total: 53000,
  amount_due: 53000, amount_paid: 53000, amount_remaining: 0, pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0, starting_balance: 0, ending_balance: 0,
  customer_address: { country: "US" }, metadata: {}, parent: { subscription_details: { subscription: "sub_member", metadata: { ruined_context: "membership" } } }, ...extra }; }
async function helperHarness({ chargeChanges = {}, invoicePayments, refunds = [], existing = null, firstChargeAt = null } = {}) {
  const created = [], activated = [], invalidated = [], projections = [];
  const helper = await load("src/lib/stripe/commitment-webhook.ts", {
    "server-only": {}, "./price-policy": { isMembershipOfferId: id => Object.hasOwn(pricing.MEMBERSHIP_OFFERS, id) },
    "@/lib/membership/commercial-repository": {
      getCommercialMembershipReservation: async () => ({ id: attemptId, memberId, plan: "monthly", firstChargeAt, status: "reserved", offerId: "individual_monthly", stripePriceId: "price_member", stripeSubscriptionId: "sub_member", participants: [{ memberId }] }),
      activateCommercialMembership: async value => activated.push(value), getCommercialBillingGroupBySubscription: async () => null, reconcileCommercialMemberships: async () => {},
    },
    "./billing-repository": { hasMembershipCheckoutConsent: async () => true, updateMemberBillingState: async (_, value) => projections.push(value) },
    "./commitment-policy": policy,
    "./commitment-repository": { createMembershipCommitment: async (_, value) => created.push(value), getMembershipCommitment: async () => existing,
      invalidateMembershipCommitmentLedger: async (_, value) => invalidated.push(value) },
  });
  const stripe = {
    invoicePayments: { list: async () => ({ has_more: false, data: invoicePayments ?? [{ invoice: "in_paid", amount_paid: 53000, livemode: false, currency: "usd", status: "paid", payment: { type: "payment_intent", payment_intent: "pi_member" } }] }) },
    paymentIntents: { retrieve: async () => ({ status: "succeeded", livemode: false, customer: "cus_member", latest_charge: "ch_member" }) },
    charges: { retrieve: async () => ({ id: "ch_member", amount: 53000, currency: "usd", livemode: false, customer: "cus_member", paid: true, captured: true,
      status: "succeeded", refunded: false, amount_refunded: 0, disputed: false, ...chargeChanges }) },
    refunds: { list: async () => ({ has_more: false, data: refunds }) },
  };
  const tx = async (strings) => strings.join("?").includes('select acceptance.id as "acceptanceId"') ? [{ acceptanceId, agreementVersion: "ruined_membership-v2", agreementContentSha256: "a".repeat(64), acceptedAt: "2026-09-01T00:00:00Z" }] : [];
  return { helper, stripe, tx, created, activated, invalidated, projections };
}

test("v2 activation verifies current cash settlement and rejects refunds, disputes, credits and mixed allocations", async () => {
  let h = await helperHarness(); assert.equal(await h.helper.hasVerifiedCommitmentInvoicePayment(h.stripe, invoice(), subscription()), true);
  for (const options of [{ chargeChanges: { amount_refunded: 1 } }, { chargeChanges: { disputed: true } }, { refunds: [{ status: "pending" }] },
    { invoicePayments: [] }, { chargeChanges: { amount: 106000 } }]) {
    h = await helperHarness(options); assert.equal(await h.helper.hasVerifiedCommitmentInvoicePayment(h.stripe, invoice(), subscription()), false, JSON.stringify(options));
  }
  h = await helperHarness();
  assert.equal(await h.helper.hasVerifiedCommitmentInvoicePayment(h.stripe, invoice({ customer_address: { country: "CA" } }), subscription()), false);
  assert.equal(await h.helper.hasVerifiedCommitmentInvoicePayment(h.stripe, invoice({ post_payment_credit_notes_amount: 1 }), subscription()), false);
});

test("first paid v2 invoice creates one immutable contract from stored acceptance and original subscription start", async () => {
  const h = await helperHarness(), sub = subscription();
  await h.helper.prepareCommitmentInvoiceProjection(h.tx, { event: { id: "evt_paid" }, subscription: sub, invoice: invoice(), memberId, paidActivation: true });
  assert.equal(h.created.length, 1); assert.equal(h.created[0].id, attemptId); assert.equal(h.created[0].startsAt, "2026-09-15T12:00:00.000Z");
  assert.equal(h.created[0].initialTermEndsAt, "2027-09-15T12:00:00.000Z"); assert.equal(h.created[0].acceptedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(h.activated.length, 1); assert.equal(h.invalidated.length, 1, "a single paid invoice is not a complete principal ledger");
  const replay = await helperHarness({ existing: { contract: h.created[0] } });
  await replay.helper.prepareCommitmentInvoiceProjection(replay.tx, { event: { id: "evt_paid_again" }, subscription: sub, invoice: invoice(), memberId, paidActivation: true });
  assert.equal(replay.created.length, 0);
  sub.metadata.billing_terms_version = "membership-billing-v1";
  await h.helper.prepareCommitmentInvoiceProjection(h.tx, { event: { id: "evt_legacy" }, subscription: sub, invoice: invoice(), memberId, paidActivation: true });
  assert.equal(h.created.length, 1, "legacy membership never acquires a new commitment");
});

async function webhookHarness({ verified = true, fee = false, latestInvoice = "in_paid", scheduled = false } = {}) {
  const states = [], consents = [], prepared = [], scheduledPrepared = [], invalidated = [], partners = [], locks = [], sub = subscription(); sub.latest_invoice = latestInvoice;
  if (scheduled) sub.metadata.ruined_first_charge_at="2026-11-01T06:00:00.000Z";
  const currentInvoice = invoice(fee ? { metadata: { ruined_cancellation_id: "cancel_id", ruined_context: "membership_cancellation" } } : {});
  const stripe = { subscriptions: { retrieve: async () => sub }, invoices: { retrieve: async () => currentInvoice } };
  const loaded = await load("src/lib/stripe/webhook.ts", {
    "@/lib/membership/badge-repository": { reconcileMemberBadgesForStripeEvent: async () => {} },
    "server-only": {}, "@/lib/membership/pricing": pricing, "@/lib/stripe/membership-state": state,
    "@/lib/stripe/price-policy": { recognizesMembershipSubscription: () => true, matchesMembershipInvoice: () => true, hasFullMembershipPayment: () => true },
    "@/lib/stripe/database": { getBillingDatabase: () => ({ begin: async fn => fn({}) }) },
    "@/lib/stripe/server": { getStripe: () => stripe, getMembershipPriceConfiguration: () => ({}), isStripeTaxEnabled: () => false },
    "@/lib/stripe/billing-repository": { claimWebhookEvent: async () => "claimed", completeWebhookEvent: async () => {}, recordWebhookFailure: async () => {},
      ensureBillingMember: async () => ({ id: memberId, membershipState: "pending" }), findMemberBySubscription: async () => ({ id: memberId, membershipState: "pending" }),
      hasMembershipCheckoutConsent: async (_, input) => { consents.push(input); return true; }, updateMemberBillingState: async (_, input) => states.push(input),
      upsertInvoice: async () => {}, upsertSubscription: async () => {}, reconcileCheckoutAttempt: async () => {}, upsertCheckoutSession: async () => {} },
    "@/lib/stripe/commitment-webhook": { hasVerifiedCommitmentInvoicePayment: async () => verified, prepareCommitmentInvoiceProjection: async (_, input) => prepared.push(input),
      invalidateCommitmentFromInvoice: async (_, input) => { invalidated.push(input); return true; }, projectCommercialParticipantBillingState: async (_, input) => partners.push(input),
      lockCommitmentSubscriptionProjection: async (_, input) => locks.push(input), releaseCanceledScheduledMembership:async()=>{},
      prepareScheduledMembershipProjection:async(_,input)=>scheduledPrepared.push(input) },
  });
  return { states, consents, prepared, scheduledPrepared, invalidated, partners, locks,
    completed:()=>loaded.processStripeWebhookEvent({id:"evt_completed",created:99,livemode:false,type:"checkout.session.completed",data:{object:{id:"cs_member",mode:"subscription",status:"complete",expires_at:9999999999,subscription:sub.id,customer:sub.customer,customer_details:{email:"member@example.test"},metadata:sub.metadata}}}),
    paid: () => loaded.processStripeWebhookEvent({ id: "evt_paid", created: 100, livemode: false, type: "invoice.paid", data: { object: currentInvoice } }),
    changed: () => loaded.processStripeWebhookEvent({ id: "evt_changed", created: 101, livemode: false, type: "customer.subscription.updated", data: { object: sub } }) };
}

test("webhook checks v2 consent and activates only verified current membership payment", async () => {
  const h = await webhookHarness(); await h.paid();
  assert.equal(h.consents[0].billingTermsVersion, "membership-billing-v2"); assert.equal(h.consents[0].offerId, "individual_monthly"); assert.equal(h.consents[0].commercialReservationId, attemptId);
  assert.equal(h.prepared[0].paidActivation, true); assert.equal(h.states[0].state, "active"); assert.equal(h.partners[0].state, "active");
  const refunded = await webhookHarness({ verified: false }); await refunded.paid();
  assert.equal(refunded.prepared[0].paidActivation, false); assert.equal(refunded.states[0].state, "attention_required");
  const older = await webhookHarness({ latestInvoice: "in_newer" }); await older.paid(); assert.equal(older.states.length, 0); assert.equal(older.invalidated.length, 1);
});

test("replacement fees cannot grant membership and scheduling cancellation does not invalidate fee accounting", async () => {
  const fee = await webhookHarness({ fee: true }); await fee.paid(); assert.equal(fee.states.length, 0); assert.equal(fee.prepared.length, 0);
  const h = await webhookHarness(); await h.changed(); assert.equal(h.invalidated.length, 0); assert.equal(h.locks.length, 1); assert.equal(h.partners.length, 1);
});

test("verified scheduled Checkout creates a future commitment without activating membership", async()=>{
  const firstChargeAt=new Date("2026-11-01T06:00:00Z"),h=await helperHarness({firstChargeAt}),sub=subscription();
  sub.metadata.ruined_first_charge_at=firstChargeAt.toISOString();sub.metadata.ruined_price_id="price_member";
  sub.billing_cycle_anchor=firstChargeAt.getTime()/1000;sub.latest_invoice=null;
  const session={status:"complete",mode:"subscription",payment_status:"no_payment_required",amount_total:0,livemode:false,
    consent:{terms_of_service:"accepted"},customer:sub.customer,subscription:sub.id,metadata:{...sub.metadata}};
  await h.helper.prepareScheduledMembershipProjection(h.tx,{subscription:sub,session,memberId});
  assert.equal(h.created[0].startsAt,firstChargeAt.toISOString());
  assert.equal(h.created[0].initialTermEndsAt,"2027-11-01T06:00:00.000Z");
  assert.equal(h.activated.length,0);assert.equal(h.projections.length,0);
  for(const patch of [{amount_total:1},{payment_status:"paid"},{consent:{terms_of_service:null}},{metadata:{...session.metadata,ruined_first_charge_at:"2030-01-01T00:00:00.000Z"}}]){
    await assert.rejects(h.helper.prepareScheduledMembershipProjection(h.tx,{subscription:sub,session:{...session,...patch},memberId}),/scheduled_billing_consent_mismatch/);
  }
});

test("scheduled completion and an active provider subscription keep member access pending",async()=>{
  const h=await webhookHarness({scheduled:true,latestInvoice:null});
  await h.completed();
  assert.equal(h.scheduledPrepared.length,1);assert.equal(h.states.length,0);assert.equal(h.prepared.length,0);
  await h.changed();
  assert.equal(h.states.at(-1).state,"pending");assert.equal(h.prepared.length,0);
});

test("the first paid scheduled invoice anchors the commitment to the disclosed date, not Checkout creation",async()=>{
  const firstChargeAt=new Date("2026-11-01T06:00:00Z"),h=await helperHarness({firstChargeAt}),sub=subscription();
  sub.metadata.ruined_first_charge_at=firstChargeAt.toISOString();sub.billing_cycle_anchor=firstChargeAt.getTime()/1000;
  await h.helper.prepareCommitmentInvoiceProjection(h.tx,{event:{id:"evt_paid_scheduled"},subscription:sub,
    invoice:invoice({lines:{data:[{period:{start:firstChargeAt.getTime()/1000}}]}}),memberId,paidActivation:true});
  assert.equal(h.created[0].startsAt,firstChargeAt.toISOString());
  assert.equal(h.activated.length,1);
  await assert.rejects(h.helper.prepareCommitmentInvoiceProjection(h.tx,{event:{id:"evt_early"},subscription:sub,
    invoice:invoice({lines:{data:[{period:{start:firstChargeAt.getTime()/1000-1}}]}}),memberId,paidActivation:true}),/scheduled_billing_date_mismatch/);
});


test("a November 1 v2 schedule retains its accepted agreement and dates after new offers switch to v3 prepaid", async () => {
  const priorAgreement = process.env.STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION;
  const priorPrepaid = process.env.STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED;
  process.env.STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION = "ruined_membership-v3";
  process.env.STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED = "true";
  try {
    const firstChargeAt = new Date("2026-11-01T06:00:00Z"), h = await helperHarness({ firstChargeAt }), sub = subscription();
    sub.metadata.ruined_first_charge_at = firstChargeAt.toISOString(); sub.metadata.ruined_price_id = "price_member";
    sub.metadata.agreement_version = "ruined_membership-v2";
    sub.billing_cycle_anchor = firstChargeAt.getTime() / 1000; sub.latest_invoice = null;
    const session = { status: "complete", mode: "subscription", payment_status: "no_payment_required", amount_total: 0, livemode: false,
      consent: { terms_of_service: "accepted" }, customer: sub.customer, subscription: sub.id, metadata: { ...sub.metadata } };
    await h.helper.prepareScheduledMembershipProjection(h.tx, { subscription: sub, session, memberId });
    const accepted = h.created[0];
    assert.equal(accepted.agreementVersion, "ruined_membership-v2");
    assert.equal(accepted.startsAt, "2026-11-01T06:00:00.000Z");
    assert.equal(accepted.initialTermEndsAt, "2027-11-01T06:00:00.000Z");
    assert.ok(!accepted.billingSchedule);
    assert.equal(h.activated.length, 0);
    const later = await helperHarness({ firstChargeAt, existing: { contract: accepted } });
    sub.latest_invoice = "in_paid";
    await later.helper.prepareCommitmentInvoiceProjection(later.tx, { event: { id: "evt_legacy_v2_paid" }, subscription: sub,
      invoice: invoice({ lines: { data: [{ period: { start: firstChargeAt.getTime() / 1000 } }] } }), memberId, paidActivation: true });
    assert.equal(later.created.length, 0, "accepted contract is retained");
    assert.equal(later.activated.length, 1, "accepted November 1 charge remains eligible for normal paid activation");
  } finally {
    if (priorAgreement === undefined) delete process.env.STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION; else process.env.STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION = priorAgreement;
    if (priorPrepaid === undefined) delete process.env.STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED; else process.env.STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED = priorPrepaid;
  }
});
