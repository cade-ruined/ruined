/** Read-only readiness check. Reads credentials only from the process environment. */
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import { MEMBERSHIP_OFFERS } from "../src/lib/membership/pricing.ts";
import { LIVE_MEMBERSHIP_PRICE_IDS, SANDBOX_MEMBERSHIP_PRICE_IDS } from "../src/lib/stripe/membership-catalog.ts";
import { matchesMembershipPortalPolicy } from "../src/lib/stripe/portal-policy.ts";

const API_VERSION = "2026-08-26.dahlia";
const NOVEMBER_FIRST_CHARGE = "2026-11-01T06:00:00.000Z";
const events = ["checkout.session.completed", "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed", "checkout.session.expired", "invoice.paid",
  "invoice.payment_failed", "invoice.payment_action_required", "invoice.voided",
  "invoice.marked_uncollectible", "customer.subscription.updated", "customer.subscription.deleted",
  "credit_note.created", "credit_note.updated", "credit_note.voided", "charge.refunded",
  "charge.dispute.created", "charge.dispute.closed", "refund.created", "refund.updated", "refund.failed"];
const required = ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET",
  "STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID", "STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID",
  "STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION", "STRIPE_BILLING_PORTAL_CONFIGURATION_ID",
  "STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID", "STRIPE_MEMBERSHIP_COMMERCIAL_READY", "NEXT_PUBLIC_SITE_URL"];
const remaining = "This read-only result does not verify deployed code, migrations, published agreement content, signed webhook delivery, permissions to create or cancel subscriptions, or actual payment collection. Verify the deferred Checkout, first paid invoice, cancellation and browser flow in an isolated Stripe sandbox before enabling production.";

export async function checkStripeMembershipReadiness({ env = process.env, target = "checkout", now = new Date(),
  createStripe = key => new Stripe(key, { apiVersion: API_VERSION, maxNetworkRetries: 1, timeout: 12000 }),
} = {}) {
  if (!["activation", "checkout"].includes(target)) return { ready: false, error: "InvalidReadinessTarget" };
  const activation = target === "activation";
  const missing = [...required, ...(activation ? ["STRIPE_MEMBERSHIP_FIRST_CHARGE_AT"] : [])].filter(name => !env[name]?.trim());
  if (missing.length) return { ready: false, target, missing, remaining };
  const value = name => env[name]?.trim();
  const enabled = name => value(name)?.toLowerCase() === "true";
  const mode = value("STRIPE_SECRET_KEY")?.match(/^(?:rk|sk)_(test|live)_/)?.[1] ?? null;
  const checks = [];
  const record = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  const taxEnabled = enabled("STRIPE_TAX_ENABLED");
  const firstChargeAt = value("STRIPE_MEMBERSHIP_FIRST_CHARGE_AT");
  const result = () => ({ ready: checks.every(check => check.passed), target, mode,
    liveCheckoutEnabled: enabled("STRIPE_MEMBERSHIP_LIVE_ENABLED"), activationEnabled: enabled("STRIPE_MEMBERSHIP_ACTIVATION_ENABLED"),
    registrationOnly: enabled("MEMBERSHIP_REGISTRATION_ONLY_ENABLED"), taxEnabled,
    ...(activation ? { plannedFirstChargeAt: NOVEMBER_FIRST_CHARGE } : {}), checks, remaining });

  record("Connected platform configuration is selected", value("PLATFORM_MODE") === "connected");
  record("Commercial offer implementation has been explicitly released", enabled("STRIPE_MEMBERSHIP_COMMERCIAL_READY"));
  record("Server key has a recognized mode", mode);
  record("Publishable and server keys use the same mode", value("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY").startsWith(`pk_${mode}_`));
  record("Live payment release is enabled when using live credentials", mode === "test" || enabled("STRIPE_MEMBERSHIP_LIVE_ENABLED"));
  record("An explicit paid agreement version is configured", /^ruined_membership-v([2-9]|[1-9]\d+)$/.test(value("STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION")));
  record("Reviewed early-exit invoice collection is configured", value("STRIPE_MEMBERSHIP_BUYOUT_READY") === "true");
  if (activation) {
    record("Member-confirmed activation is enabled", enabled("STRIPE_MEMBERSHIP_ACTIVATION_ENABLED"));
    record("Registration-only intake keeps ordinary paid signup closed", enabled("MEMBERSHIP_REGISTRATION_ONLY_ENABLED"));
    record("First charge is November 1, 2026 at midnight America/Denver",
      [NOVEMBER_FIRST_CHARGE, NOVEMBER_FIRST_CHARGE.replace(".000Z", "Z")].includes(firstChargeAt));
    record("The scheduled confirmation window is still open", now.getTime() < Date.parse(NOVEMBER_FIRST_CHARGE) - 32 * 60_000);
  } else {
    record("Ordinary paid signup is enabled", !enabled("MEMBERSHIP_REGISTRATION_ONLY_ENABLED"));
  }
  record("Early-exit fee has an explicit tax classification when tax is enabled", !taxEnabled || Boolean(value("STRIPE_MEMBERSHIP_BUYOUT_TAX_CODE")));
  if (!mode) return result();

  try {
    const stripe = createStripe(value("STRIPE_SECRET_KEY"));
    const catalog = mode === "live" ? LIVE_MEMBERSHIP_PRICE_IDS : SANDBOX_MEMBERSHIP_PRICE_IDS;
    const configuredIds = Object.keys(MEMBERSHIP_OFFERS).map(offerId => value(`STRIPE_MEMBERSHIP_${offerId.toUpperCase()}_PRICE_ID`) || catalog[offerId]);
    record("Each commercial offer has a distinct Price", new Set(configuredIds).size === configuredIds.length);
    for (const [offerId, expected] of Object.entries(MEMBERSHIP_OFFERS)) {
      const id = value(`STRIPE_MEMBERSHIP_${offerId.toUpperCase()}_PRICE_ID`) || catalog[offerId];
      const price = await stripe.prices.retrieve(id);
      record(`${offerId} price matches the published offer`, price.id === id && price.active && price.livemode === (mode === "live") && price.tax_behavior === "exclusive"
        && price.type === "recurring" && price.billing_scheme === "per_unit" && !price.transform_quantity
        && price.unit_amount === expected.amount && price.currency === expected.currency
        && price.recurring?.interval === expected.interval && price.recurring.interval_count === 1
        && price.recurring.usage_type === "licensed");
    }
    const endpointUrl = new URL("/api/stripe/webhook", value("NEXT_PUBLIC_SITE_URL")).href;
    const destinations = await stripe.webhookEndpoints.list({ limit: 100 });
    record("Enabled webhook has the correct URL, API version and required events", destinations.data.some(endpoint =>
      endpoint.url === endpointUrl && endpoint.status === "enabled" && endpoint.api_version === API_VERSION
      && (endpoint.enabled_events.includes("*") || events.every(event => endpoint.enabled_events.includes(event)))));
    const portalId = value("STRIPE_BILLING_PORTAL_CONFIGURATION_ID");
    const configuration = await stripe.billingPortal.configurations.retrieve(portalId);
    record("Explicit billing portal matches the environment and period-end cancellation policy", matchesMembershipPortalPolicy(configuration, portalId, mode === "live"));
    const commitmentPortalId = value("STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID");
    const commitmentPortal = await stripe.billingPortal.configurations.retrieve(commitmentPortalId);
    record("Commitment billing portal leaves cancellation in the member account", matchesMembershipPortalPolicy(commitmentPortal, commitmentPortalId, mode === "live", "commitment"));
    let unrestrictedHostedLogin = false;
    for await (const portal of stripe.billingPortal.configurations.list({ active: true, limit: 100 })) {
      if (portal.login_page?.enabled && portal.features.subscription_cancel.enabled) unrestrictedHostedLogin = true;
    }
    record("Shared hosted portal login cannot bypass the accepted commitment", !unrestrictedHostedLogin);
    if (taxEnabled) {
      const registrations = await stripe.tax.registrations.list({ status: "active", limit: 1 });
      record("Automatic tax has an active registration", registrations.data.length > 0);
    }
    return result();
  } catch (error) {
    // Never print raw Stripe errors: request details can contain personal information.
    return { ...result(), ready: false, error: error?.type || error?.name || "StripeReadinessError" };
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const result = args.length > 1 || args.some(arg => !["--activation", "--checkout"].includes(arg))
    ? { ready: false, error: "Use --activation for the November 1 launch, or --checkout for ordinary paid signup." }
    : await checkStripeMembershipReadiness({ target: args[0] === "--activation" ? "activation" : "checkout" });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 1;
}
