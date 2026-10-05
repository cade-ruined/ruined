// Disposable Stripe sandbox fixtures only. No application database or email.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";

if (!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "") || process.env.DATABASE_URL) {
  throw new Error("An isolated sandbox key and no database connection are required.");
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-08-26.dahlia", timeout: 15000, maxNetworkRetries: 1,
});
const run = randomUUID();
const price = "price_1UKjCj9rQIwIEzKeoNSBIVEq";
const evidence = [];
let clock, subscription, session;
const record = (name, value) => { assert.ok(value, name); evidence.push(name); };
async function clockReady(id) {
  for (let i = 0; i < 40; i++) {
    const current = await stripe.testHelpers.testClocks.retrieve(id);
    if (current.status === "ready") return current;
    assert.notEqual(current.status, "internal_failure");
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error("Sandbox clock did not finish.");
}
try {
  const account = await stripe.accounts.retrieve();
  record("Isolated Ruined sandbox account", account.id === "acct_1U6AS79rQIwIEzKe");
  const now = Math.floor(Date.now() / 1000), anchor = now + 3 * 86400;
  clock = await stripe.testHelpers.testClocks.create({ frozen_time: now, name: `Ruined deferred billing ${run}` });
  const customer = await stripe.customers.create({ name: "[TEST ONLY] November billing", test_clock: clock.id, metadata: { ruined_test_run: run } });
  const method = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: method.id } });
  session = await stripe.checkout.sessions.create({
    customer: customer.id, mode: "subscription", ui_mode: "embedded_page",
    return_url: "http://127.0.0.1:3255/my/activate?checkout=returned",
    payment_method_collection: "always", automatic_tax: { enabled: false },
    line_items: [{ price, quantity: 1 }], integration_identifier: "ruined_launch_smoketxqv",
    subscription_data: { billing_mode: { type: "flexible" }, billing_cycle_anchor: anchor, proration_behavior: "none" },
  });
  console.log(JSON.stringify({ checkout: { mode: session.mode, amountTotal: session.amount_total, amountSubtotal: session.amount_subtotal, paymentStatus: session.payment_status, status: session.status } }));
  record("Real Checkout accepts flexible billing with a future anchor and no prorations", session.mode === "subscription" && session.amount_total === 0);
  await stripe.checkout.sessions.expire(session.id);
  session = null;
  // Exercise the same provider billing configuration through a disposable
  // subscription so Test Clock can prove first collection and renewal timing.
  subscription = await stripe.subscriptions.create({
    customer: customer.id, items: [{ price }], collection_method: "charge_automatically",
    billing_mode: { type: "flexible" }, billing_cycle_anchor: anchor, proration_behavior: "none",
    metadata: { ruined_test_run: run },
  });
  record("No invoice or payment before the disclosed first billing date", subscription.latest_invoice === null && (await stripe.invoices.list({ customer: customer.id, limit: 100 })).data.length === 0);
  record("Provider preserves the exact first billing date", subscription.billing_cycle_anchor === anchor);
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: anchor + 7200 });
  await clockReady(clock.id);
  let invoices = await stripe.invoices.list({ customer: customer.id, limit: 100 });
  if (!invoices.data.some(invoice => invoice.status === "paid")) {
    await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: anchor + 14400 });
    await clockReady(clock.id);
    invoices = await stripe.invoices.list({ customer: customer.id, limit: 100 });
  }
  const paid = invoices.data.filter(invoice => invoice.status === "paid");
  record("First full founding payment collected on the configured date", paid.length === 1 && paid[0].amount_paid === 34900);
  record("Paid invoice begins at the first charge date", paid[0].lines.data.some(line => line.period.start === anchor));
  await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false });
  subscription = null;
  // Separate customer/clock tests cancellation while billing is still pending.
  const pendingCustomer = await stripe.customers.create({ name: "[TEST ONLY] Cancel before start", test_clock: clock.id, metadata: { ruined_test_run: run } });
  const pendingMethod = await stripe.paymentMethods.attach("pm_card_visa", { customer: pendingCustomer.id });
  await stripe.customers.update(pendingCustomer.id, { invoice_settings: { default_payment_method: pendingMethod.id } });
  const nextAnchor = anchor + 7 * 86400;
  subscription = await stripe.subscriptions.create({ customer: pendingCustomer.id, items: [{ price }],
    billing_mode: { type: "flexible" }, billing_cycle_anchor: nextAnchor, proration_behavior: "none" });
  const canceled = await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false });
  record("Cancellation before billing creates no invoice or fee", canceled.status === "canceled" && (await stripe.invoices.list({ customer: pendingCustomer.id, limit: 100 })).data.length === 0);
  subscription = null;
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: nextAnchor + 14400 });
  await clockReady(clock.id);
  record("Canceled advance activation is not billed at its former start date", (await stripe.invoices.list({ customer: pendingCustomer.id, limit: 100 })).data.length === 0);
  console.log(JSON.stringify({ ok: true, mode: "isolated-sandbox", checks: evidence,
    scope: "Provider configuration and simulated billing dates; application/webhook delivery is verified separately." }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, checks: evidence, type: error.type || error.name,
    code: error.code, parameter: error.param, status: error.statusCode,
    assertion: error instanceof assert.AssertionError ? error.message : undefined }, null, 2));
  process.exitCode = 1;
} finally {
  if (session) await stripe.checkout.sessions.expire(session.id).catch(() => {});
  if (subscription) await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false }).catch(() => {});
  if (clock) {
    await clockReady(clock.id).catch(() => {});
    await stripe.testHelpers.testClocks.del(clock.id).catch(() => { console.log("Sandbox cleanup requires review."); process.exitCode = 1; });
  }
}
