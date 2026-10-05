import assert from "node:assert/strict";
import test from "node:test";
import { checkStripeMembershipReadiness } from "../scripts/check-stripe-membership.mjs";
import { MEMBERSHIP_OFFERS } from "../src/lib/membership/pricing.ts";

function fixture(overrides = {}) {
  const env = { PLATFORM_MODE: "connected", DATABASE_URL: "offline", NEXT_PUBLIC_SUPABASE_URL: "https://auth.invalid",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "offline", NEXT_PUBLIC_SITE_URL: "https://members.example.test",
    STRIPE_SECRET_KEY: "rk_live_fixture", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID: "price_monthly", STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID: "price_annual",
    STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION: "ruined_membership-v2", STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_legacy",
    STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID: "bpc_commitment", STRIPE_MEMBERSHIP_COMMERCIAL_READY: "true",
    STRIPE_MEMBERSHIP_LIVE_ENABLED: "true", STRIPE_MEMBERSHIP_BUYOUT_READY: "true", STRIPE_MEMBERSHIP_ACTIVATION_ENABLED: "true",
    MEMBERSHIP_REGISTRATION_ONLY_ENABLED: "true", STRIPE_MEMBERSHIP_FIRST_CHARGE_AT: "2026-11-01T06:00:00Z", STRIPE_TAX_ENABLED: "false",
    ...Object.fromEntries(Object.keys(MEMBERSHIP_OFFERS).map(id => [`STRIPE_MEMBERSHIP_${id.toUpperCase()}_PRICE_ID`, `price_${id}`])), ...overrides };
  let taxReads = 0, stripeInstances = 0;
  const live = env.STRIPE_SECRET_KEY.includes("_live_");
  const stripe = {
    prices: { retrieve: async id => {
      const offer = MEMBERSHIP_OFFERS[id.replace("price_", "")];
      return { id, active: true, livemode: live, tax_behavior: "exclusive", type: "recurring", billing_scheme: "per_unit",
        unit_amount: offer.amount, currency: offer.currency, recurring: { interval: offer.interval, interval_count: 1, usage_type: "licensed" } };
    } },
    webhookEndpoints: { list: async () => ({ data: [{ url: "https://members.example.test/api/stripe/webhook", status: "enabled", api_version: "2026-08-26.dahlia", enabled_events: ["*"] }] }) },
    billingPortal: { configurations: {
      retrieve: async id => ({ id, active: true, livemode: live, features: { invoice_history: { enabled: true }, payment_method_update: { enabled: true },
        subscription_update: { enabled: false }, subscription_cancel: { enabled: id === "bpc_legacy", mode: "at_period_end", proration_behavior: "none" } } }),
      list: () => ({ async *[Symbol.asyncIterator]() {} }),
    } },
    tax: { registrations: { list: async () => { taxReads++; return { data: [] }; } } },
  };
  const check = options => checkStripeMembershipReadiness({ env, target: "activation", now: new Date("2026-10-05T18:00:00Z"),
    createStripe: () => { stripeInstances++; return stripe; }, ...options });
  return { env, stripe, check, taxReads: () => taxReads, stripeInstances: () => stripeInstances };
}

test("November activation readiness keeps normal paid signup closed and does not require Stripe Tax", async () => {
  const f = fixture(), result = await f.check();
  assert.equal(result.ready, true); assert.equal(result.target, "activation"); assert.equal(result.registrationOnly, true);
  assert.equal(result.plannedFirstChargeAt, "2026-11-01T06:00:00.000Z"); assert.equal(result.taxEnabled, false); assert.equal(f.taxReads(), 0);
  assert.equal((await f.check({ target: "checkout" })).ready, false, "ordinary paid signup remains deliberately closed");
  assert.match(result.remaining, /does not verify deployed code/); assert.match(result.remaining, /actual payment collection/);
});

test("activation readiness rejects every missing or disabled release gate and the wrong first payment date", async () => {
  for (const [name, value] of [["STRIPE_MEMBERSHIP_ACTIVATION_ENABLED", "false"], ["STRIPE_MEMBERSHIP_COMMERCIAL_READY", "false"],
    ["STRIPE_MEMBERSHIP_LIVE_ENABLED", "false"], ["STRIPE_MEMBERSHIP_BUYOUT_READY", "false"],
    ["MEMBERSHIP_REGISTRATION_ONLY_ENABLED", "false"], ["STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION", "ruined_registration-v1"],
    ["STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID", ""], ["DATABASE_URL", ""],
    ["STRIPE_MEMBERSHIP_FIRST_CHARGE_AT", ""], ["STRIPE_MEMBERSHIP_FIRST_CHARGE_AT", "2026-11-01T07:00:00Z"],
    ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_fixture"]]) {
    const f = fixture({ [name]: value });
    assert.equal((await f.check()).ready, false, name);
  }
  assert.equal((await fixture().check({ now: new Date("2026-11-01T06:00:00Z") })).ready, false, "prelaunch check cannot imply future authorization after billing begins");
  const missing = fixture({ STRIPE_MEMBERSHIP_FIRST_CHARGE_AT: "" });
  await missing.check(); assert.equal(missing.stripeInstances(), 0);
});

test("sandbox readiness does not demand a live-release flag but uses matching test prices and keys", async () => {
  const f = fixture({ STRIPE_SECRET_KEY: "rk_test_fixture", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_fixture", STRIPE_MEMBERSHIP_LIVE_ENABLED: "false" });
  assert.equal((await f.check()).ready, true);
});

test("tax configuration is checked only when automatic tax is explicitly enabled", async () => {
  const f = fixture({ STRIPE_TAX_ENABLED: "true", STRIPE_MEMBERSHIP_BUYOUT_TAX_CODE: "txcd_reviewed" });
  assert.equal((await f.check()).ready, false); assert.equal(f.taxReads(), 1);
  f.stripe.tax.registrations.list = async () => ({ data: [{ id: "taxreg_test" }] });
  assert.equal((await f.check()).ready, true);
});

test("readiness fails closed for provider errors and never returns raw request details", async () => {
  const f = fixture();
  f.stripe.prices.retrieve = async () => { throw Object.assign(Error("SECRET-REQUEST-DATA"), { type: "StripePermissionError", raw: { secret: "DO-NOT-PRINT" } }); };
  const result = await f.check();
  assert.equal(result.ready, false); assert.equal(result.error, "StripePermissionError");
  assert.doesNotMatch(JSON.stringify(result), /SECRET-REQUEST-DATA|DO-NOT-PRINT|rk_live_fixture|whsec_fixture/);
});
