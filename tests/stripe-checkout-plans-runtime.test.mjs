import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(relativePath, dependencies = {}) {
  const output = ts.transpileModule(await readFile(new URL(relativePath, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const pricing = await load("../src/lib/membership/pricing.ts");
const policy = await load("../src/lib/stripe/price-policy.ts", { "@/lib/membership/pricing": pricing });
const configuration = { monthly: "price_monthly", annual: "price_annual", legacy: "price_legacy", livemode: false };
function price(plan = "monthly", changes = {}) {
  const offer = pricing.MEMBERSHIP_PLANS[plan];
  return { id: configuration[plan], active: true, livemode: false, type: "recurring", billing_scheme: "per_unit", transform_quantity: null, currency: offer.currency, unit_amount: offer.amount, recurring: { interval: offer.interval, interval_count: 1, usage_type: "licensed" }, ...changes };
}
function subscription(plan = "monthly", changes = {}) {
  return { livemode: false, metadata: { ruined_billing_plan: plan }, items: { has_more: false, data: [{ quantity: 1, price: price(plan) }] }, ...changes };
}

test("only exact approved monthly and annual prices in the matching Stripe mode can be purchased", () => {
  for (const plan of ["monthly", "annual"]) assert.equal(policy.matchesMembershipPrice(price(plan), plan, configuration, true), true);
  for (const change of [
    { id: "price_legacy" }, { active: false }, { livemode: true }, { unit_amount: 100 }, { currency: "eur" },
    { type: "one_time" }, { billing_scheme: "tiered" }, { transform_quantity: { divide_by: 2 } },
    { recurring: { interval: "month", interval_count: 2, usage_type: "licensed" } },
    { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } },
  ]) assert.equal(policy.matchesMembershipPrice(price("monthly", change), "monthly", configuration, true), false, JSON.stringify(change));
  assert.equal(policy.matchesMembershipPrice(price("annual"), "monthly", configuration, true), false);
  assert.equal(policy.matchesMembershipPrice(price(), "monthly", { ...configuration, annual: configuration.monthly }, true), false);
});

test("webhooks recognize existing legacy subscriptions but never mistake modified prices or extra items for the offer", () => {
  assert.equal(policy.recognizesMembershipSubscription(subscription(), configuration), true);
  assert.equal(policy.recognizesMembershipSubscription(subscription("annual"), configuration), true);
  assert.equal(policy.recognizesMembershipSubscription(subscription("monthly", { items: { has_more: false, data: [{ quantity: 1, price: price("monthly", { active: false }) }] } }), configuration), true);
  const legacy = subscription("monthly", { metadata: {}, items: { has_more: false, data: [{ quantity: 1, price: price("monthly", { id: "price_legacy", unit_amount: 100 }) }] } });
  assert.equal(policy.recognizesMembershipSubscription(legacy, configuration), true);
  assert.equal(policy.recognizesMembershipSubscription({ ...legacy, metadata: { ruined_billing_plan: "monthly" } }, configuration), false);
  assert.equal(policy.recognizesMembershipSubscription(subscription("monthly", { livemode: true }), configuration), false);
  assert.equal(policy.recognizesMembershipSubscription(subscription("monthly", { metadata: { ruined_billing_plan: "annual" } }), configuration), false);
  for (const items of [
    { has_more: true, data: [{ quantity: 1, price: price() }] },
    { data: [{ quantity: 2, price: price() }] },
    { data: [{ quantity: 1, price: price() }, { quantity: 1, price: price() }] },
    { data: [{ quantity: 1, price: price("monthly", { unit_amount: 100 }) }] },
  ]) assert.equal(policy.recognizesMembershipSubscription(subscription("monthly", { items }), configuration), false);
});

const uuid = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
class CheckoutConflict extends Error {}
class PlanConflict extends CheckoutConflict { constructor(plan) { super(); this.plan = plan; } }
function reservation(plan = "monthly", changes = {}) {
  return { memberId, plan, stripePriceId: configuration[plan], attemptId: uuid, agreementAcceptanceId: uuid, agreementAcceptedAt: new Date("2026-09-24T12:00:00Z"), agreementContentSha256: "hash", agreementKey: "ruined_membership", agreementVersion: "ruined_membership-v2", ageAttestedAt: new Date("2026-09-24T12:00:00Z"), recurringPaymentAcceptedAt: new Date("2026-09-24T12:00:00Z"), existingStripeSessionId: null, ...changes };
}
function openSession(plan = "monthly", changes = {}) {
  return { id: "cs_existing", status: "open", mode: "subscription", livemode: false, ui_mode: "embedded_page", metadata: { ruined_member_id: memberId, ruined_billing_plan: plan, ruined_price_id: configuration[plan], agreement_acceptance_id: uuid }, amount_subtotal: pricing.MEMBERSHIP_PLANS[plan].amount, currency: "usd", client_secret: "safe_test_secret", ...changes };
}
async function routeHarness({ reserve, retrieve, validationError } = {}) {
  const creations = [], expirations = [], opened = [], reserved = [];
  const stripe = { checkout: { sessions: {
    retrieve: async id => retrieve ? retrieve(id) : openSession(),
    create: async (params, options) => { creations.push({ params, options }); return { id: "cs_new", expires_at: 1790290800, client_secret: "safe_test_secret" }; },
    expire: async () => { throw Error("An active session must not be expired by another tab"); },
  } } };
  const route = await load("../app/api/stripe/checkout/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => ({ authUserId: uuid, email: "Member@Example.test" }) },
    "@/lib/membership/repository": { getMemberIdentity: async () => ({ membershipFunding: "self" }) },
    "@/lib/membership/pricing": pricing,
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ stripeCheckoutReady: true, minimumAge: 18 }) },
    "@/lib/platform/repository": { PlatformAccessDeniedError: class extends Error {}, requireActivePlatformMemberLink: async () => ({ memberId }) },
    "@/lib/stripe/billing-repository": {
      MembershipCheckoutConflictError: CheckoutConflict, MembershipCheckoutPlanConflictError: PlanConflict,
      reserveMembershipCheckout: async input => { reserved.push(input); return reserve ? reserve(input) : reservation(input.plan); },
      expireMembershipCheckoutAttempt: async id => expirations.push(id),
      openMembershipCheckoutAttempt: async value => opened.push(value),
    },
    "@/lib/stripe/membership-state": { MEMBERSHIP_CONTEXT: "membership", MEMBERSHIP_OFFER: "founding_membership", isUuid: value => value === uuid, normalizeEmail: value => value.toLowerCase() },
    "@/lib/stripe/server": { isTrustedCheckoutOrigin: () => true, getStripe: () => stripe, getStripeLivemode: () => false, getPaidMembershipAgreementVersion: () => "ruined_membership-v2", validateStripeMembershipPrice: async plan => { if (validationError) throw validationError; return configuration[plan]; }, getApplicationOrigin: () => "https://members.example.test", isStripeTaxEnabled: () => false },
  });
  return { creations, expirations, opened, reserved, post: body => route.POST(new Request("https://members.example.test/api/stripe/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acceptanceId: uuid, attemptId: uuid, recurringPaymentAccepted: true, plan: "monthly", ...body }) })) };
}

test("checkout requires an approved plan and explicit recurring-payment consent before Stripe is called", async () => {
  for (const body of [{ plan: "price_cheap" }, { plan: null }, { recurringPaymentAccepted: false }, { recurringPaymentAccepted: "true" }]) {
    const harness = await routeHarness();
    assert.equal((await harness.post(body)).status, 400);
    assert.equal(harness.creations.length, 0);
    assert.equal(harness.reserved.length, 0);
  }
});

test("parallel tabs reuse the same bound attempt and Stripe idempotency parameters", async () => {
  const harness = await routeHarness();
  const responses = await Promise.all([harness.post({ plan: "annual" }), harness.post({ plan: "annual", priceId: "price_bad", amount: 1 })]);
  assert.deepEqual(await Promise.all(responses.map(r => r.json())), [{ clientSecret: "safe_test_secret", plan: "annual" }, { clientSecret: "safe_test_secret", plan: "annual" }]);
  assert.deepEqual(harness.creations[0], harness.creations[1]);
  const request = harness.creations[0];
  assert.deepEqual(request.params.line_items, [{ price: "price_annual", quantity: 1 }]);
  assert.equal(request.params.subscription_data.billing_mode.type, "flexible");
  assert.equal(request.params.subscription_data.trial_period_days, undefined);
  assert.match(request.options.idempotencyKey, /:annual:price_annual$/);
  assert.equal(request.params.metadata.billing_terms_version, "membership-billing-v1");
});

test("existing sessions are resumed; a competing plan cannot replace an in-flight payment", async () => {
  const resume = await routeHarness({ reserve: () => reservation("monthly", { existingStripeSessionId: "cs_existing" }) });
  assert.equal((await resume.post({})).status, 200);
  assert.equal(resume.creations.length, 0);
  assert.equal(resume.expirations.length, 0);
  const conflicting = await routeHarness({ reserve: () => { throw new PlanConflict("annual"); } });
  const response = await conflicting.post({});
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "Your annual checkout is already in progress. Resume it to avoid a second payment.", code: "checkout_plan_locked", plan: "annual" });
  assert.equal(conflicting.creations.length, 0);
});

test("only a remotely expired session is replaced, and a completed or mismatched payment blocks new checkout", async () => {
  let count = 0;
  const expired = await routeHarness({ reserve: input => reservation(input.plan, { attemptId: input.attemptId, plan: count === 0 ? "annual" : input.plan, existingStripeSessionId: ++count === 1 ? "cs_expired" : null }), retrieve: () => openSession("monthly", { status: "expired" }) });
  assert.equal((await expired.post({})).status, 200);
  assert.equal(expired.expirations.length, 1);
  assert.notEqual(expired.reserved[0].attemptId, expired.reserved[1].attemptId);
  for (const changes of [{ status: "complete" }, { livemode: true }, { amount_subtotal: 100 }, { metadata: {} }]) {
    const harness = await routeHarness({ reserve: () => reservation("monthly", { existingStripeSessionId: "cs_existing" }), retrieve: () => openSession("monthly", changes) });
    assert.equal((await harness.post({})).status, 409);
    assert.equal(harness.expirations.length, 0);
    assert.equal(harness.creations.length, 0);
  }
});

test("a wrong configured provider price fails closed before any billing attempt", async () => {
  const harness = await routeHarness({ validationError: Error("wrong configured price") });
  assert.equal((await harness.post({})).status, 502);
  assert.equal(harness.creations.length, 0);
  assert.equal(harness.reserved.length, 0);
});

const membershipStates = await load("../src/lib/stripe/membership-state.ts");
function membershipInvoice(sub, changes = {}) {
  const item = sub.items.data[0];
  return {
    id: "in_member", livemode: false, currency: "usd", amount_due: item.price.unit_amount,
    amount_paid: item.price.unit_amount, amount_remaining: 0, status: "paid", billing_reason: "subscription_create",
    parent: { subscription_details: { subscription: sub.id, metadata: { ruined_context: "membership" } } },
    customer: "cus_member", customer_email: "member@example.test",
    lines: { has_more: false, data: [{ id: "il_member", livemode: false, currency: "usd", quantity: 1, subtotal: item.price.unit_amount,
      pricing: { price_details: { price: item.price.id } },
      parent: { type: "subscription_item_details", subscription_item_details: { subscription: sub.id, subscription_item: item.id, proration: false } },
    }] }, ...changes,
  };
}
async function webhookHarness({ consent = true } = {}) {
  const states = [], reconciled = [];
  const sub = subscription("monthly", {
    id: "sub_member", status: "active", customer: "cus_member", automatic_tax: { enabled: false },
    metadata: { ruined_context: "membership", ruined_member_id: memberId, ruined_billing_plan: "monthly", ruined_checkout_attempt_id: uuid, agreement_acceptance_id: uuid },
    items: { has_more: false, data: [{ id: "si_member", quantity: 1, price: price() }] },
  });
  const processor = await load("../src/lib/stripe/webhook.ts", {
    "server-only": {}, "@/lib/membership/pricing": pricing, "@/lib/stripe/price-policy": policy,
    "@/lib/stripe/membership-state": membershipStates,
    "@/lib/stripe/database": { getBillingDatabase: () => ({ begin: async fn => fn({}) }) },
    "@/lib/stripe/server": { getMembershipPriceConfiguration: () => configuration, isStripeTaxEnabled: () => false, getStripe: () => ({ subscriptions: { retrieve: async () => sub } }) },
    "@/lib/stripe/billing-repository": {
      claimWebhookEvent: async () => "claimed", completeWebhookEvent: async () => {}, recordWebhookFailure: async () => {},
      findMemberBySubscription: async () => ({ id: memberId, membershipState: "pending" }),
      hasMembershipCheckoutConsent: async () => consent,
      upsertInvoice: async () => {}, upsertSubscription: async () => {},
      updateMemberBillingState: async (_tx, value) => states.push(value.state),
      reconcileCheckoutAttempt: async (_tx, value) => reconciled.push(value),
      ensureBillingMember: async () => { throw Error("Unexpected billing identity creation"); },
    },
  });
  return { sub, states, reconciled, process: (object, type = "invoice.paid") => processor.processStripeWebhookEvent({ id: "evt_test", created: 1790000000, livemode: false, type, data: { object } }) };
}

test("paid webhook activation requires the actual invoice line, full amount and the stored checkout consent", async () => {
  const valid = await webhookHarness();
  await valid.process(membershipInvoice(valid.sub));
  assert.deepEqual(valid.states, ["active"]);
  for (const kind of ["unpaid", "short", "wrong_price", "different_subscription", "no_consent", "manual_line", "truncated_lines", "wrong_currency"]) {
    const harness = await webhookHarness({ consent: kind !== "no_consent" });
    const invoice = membershipInvoice(harness.sub);
    if (kind === "unpaid") { invoice.status = "open"; invoice.amount_paid = 0; }
    if (kind === "short") invoice.amount_paid = 1;
    if (kind === "wrong_price") invoice.lines.data[0].pricing.price_details.price = "price_prior_wrong_price";
    if (kind === "different_subscription") invoice.lines.data[0].parent.subscription_item_details.subscription = "sub_other";
    if (kind === "manual_line") invoice.lines.data[0].parent.type = "invoice_item_details";
    if (kind === "truncated_lines") invoice.lines.has_more = true;
    if (kind === "wrong_currency") invoice.currency = "eur";
    await harness.process(invoice);
    assert.notEqual(harness.states[0], "active", kind);
  }
});

test("an expired session without a Customer releases its durable attempt without granting access", async () => {
  const harness = await webhookHarness();
  await harness.process({ id: "cs_expired", customer: null, subscription: null, customer_email: null, status: "expired", expires_at: 1790000000,
    metadata: { ruined_context: "membership", ruined_member_id: memberId, ruined_checkout_attempt_id: uuid, agreement_acceptance_id: uuid },
  }, "checkout.session.expired");
  assert.equal(harness.reconciled.length, 1);
  assert.equal(harness.reconciled[0].status, "expired");
  assert.deepEqual(harness.states, []);
});
