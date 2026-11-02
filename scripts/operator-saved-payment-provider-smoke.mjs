// Opt-in provider verification. Run in a clean environment with only a sandbox
// STRIPE_SECRET_KEY and STRIPE_SMOKE_EXPECTED_ACCOUNT. No database or real email.
// Uses the application's pinned Stripe version, not a new integration version.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Stripe from 'stripe';
import ts from 'typescript';

const key = process.env.STRIPE_SECRET_KEY ?? '';
const expectedAccount = process.env.STRIPE_SMOKE_EXPECTED_ACCOUNT ?? '';
if (!/^(sk|rk)_test_/.test(key) || !/^acct_[A-Za-z0-9]+$/.test(expectedAccount)
  || expectedAccount === 'acct_1U6AS14cnqzISerX' || process.env.DATABASE_URL
  || Object.keys(process.env).some(name => /SUPABASE|RESEND/.test(name) && process.env[name])) {
  throw new Error('A clean environment, test key, and explicit separate sandbox account are required.');
}
const stripe = new Stripe(key, { apiVersion: '2026-08-26.dahlia', timeout: 20_000, maxNetworkRetries: 0 });
assert.equal((await stripe.accounts.retrieve()).id, expectedAccount, 'Unexpected sandbox account');
const run = randomUUID(), customers = [], checks = [];
const check = (label, condition) => {
  assert.ok(condition, label);
  checks.push(label);
  console.log(JSON.stringify({ check: label, passed: true }));
};
async function load(path, dependencies = {}) {
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => {
    if (name === 'server-only') return {};
    assert.ok(name in dependencies, `Missing dependency ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const pricing = await load('src/lib/membership/pricing.ts');
const scheduling = await load('src/lib/membership/foundations-schedule.ts');
const policy = await load('src/lib/stripe/prepaid-policy.ts', {
  'node:crypto': { createHash }, '@/lib/membership/pricing': pricing, '@/lib/membership/foundations-schedule': scheduling,
});
const commitment = await load('src/lib/stripe/commitment-policy.ts', { 'node:crypto': { createHash }, '@/lib/membership/pricing': pricing });
const pricePolicy = await load('src/lib/stripe/price-policy.ts', { '@/lib/membership/pricing': pricing, './prepaid-policy': policy });
const model = await load('src/lib/stripe/operator-membership-model.ts');
const state = await load('src/lib/stripe/membership-state.ts');
const provider = await load('src/lib/stripe/operator-saved-payment-provider.ts', {
  'node:crypto': { createHash }, './membership-state': state, '@/lib/membership/pricing': pricing,
  './prepaid-policy': policy, './price-policy': pricePolicy, './operator-membership-model': model,
});
const offerId = 'founding_individual_monthly';
let price;
for await (const candidate of stripe.prices.list({ active: true, limit: 100 })) {
  const configuration = { livemode: false, offers: { [offerId]: candidate.id } };
  if (pricePolicy.matchesMembershipOfferPrice(candidate, offerId, configuration, true)) { price = candidate; break; }
}
assert.ok(price, 'Sandbox needs the existing $349 monthly Founding price');
const configuration = { livemode: false, monthly: price.id, annual: null, legacy: null, offers: { [offerId]: price.id } };
const prepaidProvider = await load('src/lib/stripe/prepaid-provider.ts', {
  '@/lib/stripe/commitment-policy': commitment, '@/lib/stripe/prepaid-policy': policy,
  '@/lib/stripe/price-policy': pricePolicy, '@/lib/stripe/server': { getMembershipPriceConfiguration: () => configuration },
});
const schedule = scheduling.createFoundationsBillingSchedule(new Date(), 'monthly');

async function fixture(label, methodToken, setup = false) {
  const memberId = randomUUID(), attemptId = randomUUID(), now = new Date();
  const customer = await stripe.customers.create({ name: `TEST ONLY ${label}`, email: `smoke-${run}-${label}@example.test`,
    address: { line1: '123 Test Street', city: 'Denver', state: 'CO', postal_code: '80202', country: 'US' },
    metadata: { ruined_member_id: memberId, test_run: run } });
  customers.push(customer.id);
  const method = await stripe.paymentMethods.attach(methodToken, { customer: customer.id });
  await stripe.paymentMethods.update(method.id, { allow_redisplay: 'always' });
  let setupIntent;
  if (setup) {
    setupIntent = await stripe.setupIntents.create({ customer: customer.id, payment_method: method.id,
      usage: 'off_session', confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: { ruined_member_id: memberId, test_run: run } });
    assert.equal(setupIntent.status, 'succeeded');
  }
  const target = { memberId, customerId: customer.id, paymentMethodId: method.id, setupIntentId: setupIntent?.id ?? '',
    stripeAccountId: expectedAccount, livemode: false, email: customer.email };
  const reservation = { attemptId, memberId, commercialReservationId: attemptId, consentSource: 'operator_saved_payment',
    operatorAuthorizationId: attemptId, operatorActorAuthUserId: randomUUID(), recurringPaymentAcceptedAt: now,
    agreementAcceptanceId: randomUUID(), agreementContentSha256: 'a'.repeat(64), agreementKey: 'ruined_membership',
    agreementVersion: 'ruined_membership-v3', agreementAcceptedAt: now, ageAttestedAt: now, billingSchedule: schedule,
    plan: 'monthly', offerId, stripePriceId: price.id, firstChargeAt: null, existingStripeSessionId: null };
  // Negative protocol fixtures intentionally bypass preflight: their test
  // methods cannot complete real setup. They only test Stripe's failure behavior
  // for the exact subscription parameters; they are never called eligible.
  const inspection = setup ? await provider.inspectOperatorSavedPayment(stripe, { target, offerId,
    priceId: price.id, schedule, automaticTaxEnabled: false, priceConfiguration: configuration })
    : { target, price, expectedTotal: 34900, tax: 0, automaticTaxEnabled: false };
  const params = provider.operatorSavedPaymentParameters({ reservation, inspection, minimumAge: 18 });
  const options = { idempotencyKey: `ruined-saved-smoke:${run}:${label}`, maxNetworkRetries: 0 };
  return { target, reservation, inspection, params, options };
}
function contractFor(fixture, subscriptionId) {
  const r = fixture.reservation;
  return commitment.buildMembershipCommitment({ id: r.attemptId, memberId: r.memberId,
    subscriptionId, customerId: fixture.target.customerId, livemode: false, offerId, priceId: price.id,
    agreementAcceptanceId: r.agreementAcceptanceId, agreementVersion: r.agreementVersion,
    agreementContentSha256: r.agreementContentSha256, acceptedAt: r.agreementAcceptedAt.toISOString(),
    startsAt: schedule.serviceStartsAt, billingTermsVersion: 'membership-billing-v2', billingSchedule: schedule });
}
try {
  const success = await fixture('success', 'pm_card_visa', true);
  check('Saved-method preflight verifies the exact $349 first payment', success.inspection.expectedTotal === 34900);
  const subscription = await stripe.subscriptions.create(success.params, success.options);
  const replay = await stripe.subscriptions.create(success.params, success.options);
  check('Identical provider retry returns one subscription', subscription.id === replay.id);
  check('Provider subscription matches delegated identity and accepted schedule', provider.matchesOperatorSavedSubscription(subscription, {
    reservation: success.reservation, target: success.target, automaticTaxEnabled: false,
  }));
  const proof = await prepaidProvider.inspectPrepaidMembershipInvoice(stripe, contractFor(success, subscription.id), { requireOnlyInitialInvoice: true });
  check('First payment is settled and renewals are deferred to the accepted date', proof.amount === 34900
    && subscription.status === 'trialing' && subscription.billing_cycle_anchor === Date.parse(schedule.prepaidThrough) / 1000);
  const charges = await stripe.charges.list({ customer: success.target.customerId, limit: 100 });
  check('Provider replay does not duplicate a charge', !charges.has_more && charges.data.filter(charge => charge.paid).length === 1);
  await assert.rejects(() => provider.inspectOperatorSavedPayment(stripe, { target: success.target, offerId,
    priceId: price.id, schedule, automaticTaxEnabled: false, priceConfiguration: configuration }));
  check('Existing billing cannot start a second saved-method subscription', true);

  for (const [label, token] of [['decline', 'pm_card_chargeCustomerFail'], ['authentication', 'pm_card_authenticationRequired']]) {
    const f = await fixture(label, token);
    let result, failure;
    try { result = await stripe.subscriptions.create(f.params, f.options); }
    catch (error) { failure = error; }
    const subscriptions = await stripe.subscriptions.list({ customer: f.target.customerId, status: 'all', limit: 100 });
    const invoices = await stripe.invoices.list({ customer: f.target.customerId, limit: 100 });
    const charges = await stripe.charges.list({ customer: f.target.customerId, limit: 100 });
    check(`${label}: reached collection rather than a configuration or transport failure`, failure?.type === 'StripeCardError'
      || Boolean(result && invoices.data.some(invoice => invoice.status === 'open' && invoice.amount_due === 34900 && invoice.amount_paid === 0)));
    check(`${label}: no settled charge or paid membership invoice`, !charges.has_more && !invoices.has_more
      && !charges.data.some(charge => charge.paid) && !invoices.data.some(invoice => invoice.status === 'paid' && invoice.amount_paid > 0));
    for (const candidate of subscriptions.data) {
      await assert.rejects(() => prepaidProvider.inspectPrepaidMembershipInvoice(stripe, contractFor(f, candidate.id)));
    }
    check(`${label}: provider evidence never grants paid membership`, !subscriptions.has_more);
    // Capture actual behavior, including a retained trial subscription despite a
    // failed initial invoice, rather than assuming every error means no objects.
    console.log(JSON.stringify({ scenario: label, resultStatus: result?.status ?? null, errorType: failure?.type ?? null,
      code: failure?.code ?? null, declineCode: failure?.decline_code ?? null,
      subscriptionStatuses: subscriptions.data.map(value => value.status), invoiceStatuses: invoices.data.map(value => value.status) }));
  }
  console.log(JSON.stringify({ success: true, checks: checks.length, scope: 'sandbox provider only; no database/webhook deployment proof' }));
} finally {
  const cleanupFailures = [];
  for (const customerId of customers) {
    try {
      for await (const subscription of stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
        if (!['canceled', 'incomplete_expired'].includes(subscription.status)) await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false });
      }
      for await (const invoice of stripe.invoices.list({ customer: customerId, limit: 100 })) {
        if (invoice.status === 'open') await stripe.invoices.voidInvoice(invoice.id);
        else if (invoice.status === 'draft') await stripe.invoices.del(invoice.id);
      }
      await stripe.customers.del(customerId);
    } catch (error) { cleanupFailures.push({ customerId, errorType: error?.type ?? error?.name ?? 'UnknownError' }); }
  }
  console.log(JSON.stringify({ sandboxCustomersRemoved: cleanupFailures.length === 0, cleanupFailures }));
  assert.equal(cleanupFailures.length, 0, 'Remove remaining disposable sandbox customers before rerunning');
}
