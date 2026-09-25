/** Read-only readiness check. Reads credentials only from the process environment. */
import Stripe from "stripe";
import { MEMBERSHIP_PLANS } from "../src/lib/membership/pricing.ts";

const API_VERSION = "2026-08-26.dahlia";
const events = ["checkout.session.completed", "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed", "checkout.session.expired", "invoice.paid",
  "invoice.payment_failed", "invoice.payment_action_required", "invoice.voided",
  "invoice.marked_uncollectible", "customer.subscription.updated", "customer.subscription.deleted"];
const required = ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET",
  "STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID", "STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID",
  "STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION", "NEXT_PUBLIC_SITE_URL"];
const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) {
  console.log(JSON.stringify({ ready: false, missing }, null, 2));
  process.exitCode = 1;
} else {
  const key = process.env.STRIPE_SECRET_KEY.trim();
  const mode = /^(?:rk|sk)_test_/.test(key) ? "test" : /^(?:rk|sk)_live_/.test(key) ? "live" : null;
  const checks = [];
  const record = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  record("Server key has a recognized mode", mode);
  record("Publishable and server keys use the same mode", process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.startsWith(`pk_${mode}_`));
  const stripe = new Stripe(key, { apiVersion: API_VERSION, maxNetworkRetries: 1, timeout: 12000 });
  try {
    for (const [plan, expected] of Object.entries(MEMBERSHIP_PLANS)) {
      const id = process.env[`STRIPE_MEMBERSHIP_${plan.toUpperCase()}_PRICE_ID`].trim();
      const price = await stripe.prices.retrieve(id);
      record(`${plan} price matches the published offer`, price.active && price.livemode === (mode === "live")
        && price.type === "recurring" && price.billing_scheme === "per_unit" && !price.transform_quantity
        && price.unit_amount === expected.amount && price.currency === expected.currency
        && price.recurring?.interval === expected.interval && price.recurring.interval_count === 1
        && price.recurring.usage_type === "licensed");
    }
    const endpointUrl = new URL("/api/stripe/webhook", process.env.NEXT_PUBLIC_SITE_URL).href;
    const destinations = await stripe.webhookEndpoints.list({ limit: 100 });
    record("Enabled webhook has the correct URL, API version and required events", destinations.data.some(endpoint =>
      endpoint.url === endpointUrl && endpoint.status === "enabled" && endpoint.api_version === API_VERSION
      && (endpoint.enabled_events.includes("*") || events.every(event => endpoint.enabled_events.includes(event)))));
    const configurations = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
    const configuration = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID
      ? configurations.data.find(item => item.id === process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID)
      : configurations.data.find(item => item.is_default);
    record("Billing portal supports payment updates and period-end cancellation", configuration
      && configuration.features.payment_method_update.enabled
      && configuration.features.subscription_cancel.enabled
      && configuration.features.subscription_cancel.mode === "at_period_end");
    if (process.env.STRIPE_TAX_ENABLED === "true") {
      const registrations = await stripe.tax.registrations.list({ status: "active", limit: 1 });
      record("Automatic tax has an active registration", registrations.data.length > 0);
    }
    console.log(JSON.stringify({ ready: checks.every(check => check.passed), mode,
      liveCheckoutEnabled: process.env.STRIPE_MEMBERSHIP_LIVE_ENABLED === "true", checks,
      remaining: "Verify the published paid agreement, database migrations and a completed test payment with signed webhook delivery before enabling live checkout." }, null, 2));
    if (checks.some(check => !check.passed)) process.exitCode = 1;
  } catch (error) {
    // Never print raw Stripe errors: request details can contain personal information.
    console.log(JSON.stringify({ ready: false, mode, checks, error: error?.type || error?.name || "StripeReadinessError" }, null, 2));
    process.exitCode = 1;
  }
}
