import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(await readFile(new URL("../src/lib/platform/config.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function configuration(overrides = {}) {
  const env = {
    NODE_ENV: "production", PLATFORM_MODE: "connected", DATABASE_URL: "offline",
    NEXT_PUBLIC_SUPABASE_URL: "https://auth.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "offline",
    STRIPE_SECRET_KEY: "rk_live_fixture", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_MEMBERSHIP_COMMERCIAL_READY: "true",
    STRIPE_MEMBERSHIP_LIVE_ENABLED: "true", STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID: "price_monthly",
    STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID: "price_annual", STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION: "ruined_membership-v2",
    STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_legacy", STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID: "bpc_commitment",
    MEMBERSHIP_REGISTRATION_ONLY_ENABLED: "true", STRIPE_MEMBERSHIP_ACTIVATION_ENABLED: "true",
    STRIPE_MEMBERSHIP_BUYOUT_READY: "true",
    ...overrides,
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", source)(name => {
    assert.equal(name, "server-only"); return {};
  }, loaded, loaded.exports, { env });
  return loaded.exports.getPlatformConfiguration();
}

test("paid activation can open without releasing profiles or opening normal paid signup", () => {
  const actual = configuration();
  assert.equal(actual.stripeActivationReady, true);
  assert.equal(actual.membershipRegistrationOnly, true);
  assert.equal(actual.stripeCheckoutReady, false);
  assert.equal(actual.membershipSignupReady, false);
});

test("activation stays closed unless every payment release prerequisite is configured", () => {
  for (const [name, value] of [
    ["STRIPE_MEMBERSHIP_ACTIVATION_ENABLED", ""], ["STRIPE_MEMBERSHIP_COMMERCIAL_READY", "false"],
    ["STRIPE_MEMBERSHIP_LIVE_ENABLED", "false"], ["STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION", ""],
    ["STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID", ""], ["STRIPE_WEBHOOK_SECRET", ""],
    ["STRIPE_MEMBERSHIP_BUYOUT_READY", "false"],
    ["DATABASE_URL", ""], ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_fixture"],
  ]) assert.equal(configuration({ [name]: value }).stripeActivationReady, false, name);
});

test("Stripe Tax is optional and cannot independently enable membership charging", () => {
  assert.equal(configuration({ STRIPE_TAX_ENABLED: "false" }).stripeActivationReady, true);
  assert.equal(configuration({ STRIPE_TAX_ENABLED: "true", STRIPE_MEMBERSHIP_ACTIVATION_ENABLED: "false" }).stripeActivationReady, false);
});
