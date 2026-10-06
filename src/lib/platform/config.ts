import "server-only";

export type PlatformConnection = "connected" | "disconnected";
export type PlatformMode = "connected" | "preview" | "unavailable";

export type PlatformConfiguration = {
  database: PlatformConnection;
  minimumAge: number;
  mode: PlatformMode;
  stripe: PlatformConnection;
  stripeCheckoutReady: boolean;
  stripeActivationReady: boolean;
  stripePaymentSetupReady: boolean;
  membershipSignupReady: boolean;
  membershipRegistrationOnly: boolean;
  membershipPrepaymentRequired: boolean;
  stripePortalReady: boolean;
  supabase: PlatformConnection;
};

function hasEnvironmentValue(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function getStripePublishableKey(): string | null {
  const value = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  return value && /^pk_(?:test|live)_/.test(value) ? value : null;
}

export function getPlatformConfiguration(): PlatformConfiguration {
  const supabaseConfigured =
    hasEnvironmentValue("NEXT_PUBLIC_SUPABASE_URL") &&
    hasEnvironmentValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const databaseConfigured = hasEnvironmentValue("DATABASE_URL");
  const stripePublishableKeyConfigured = Boolean(getStripePublishableKey());
  const stripeSecretMode = process.env.STRIPE_SECRET_KEY?.trim().match(/^(?:sk|rk)_(test|live)_/)?.[1];
  const stripePublishableMode = getStripePublishableKey()?.match(/^pk_(test|live)_/)?.[1];
  const stripeConfigured =
    Boolean(stripeSecretMode) && hasEnvironmentValue("STRIPE_WEBHOOK_SECRET");
  const paidCheckoutConfigured =
    // This release hold applies to both test and live keys. A Stripe price alone
    // does not implement the commitment, eligibility, or couple membership rules.
    process.env.STRIPE_MEMBERSHIP_COMMERCIAL_READY?.trim().toLowerCase() === "true" &&
    hasEnvironmentValue("STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID") &&
    hasEnvironmentValue("STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID") &&
    hasEnvironmentValue("STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION") &&
    hasEnvironmentValue("STRIPE_BILLING_PORTAL_CONFIGURATION_ID") &&
    stripeSecretMode === stripePublishableMode &&
    (stripeSecretMode === "test" || process.env.STRIPE_MEMBERSHIP_LIVE_ENABLED?.trim().toLowerCase() === "true");
  const requestedMode = process.env.PLATFORM_MODE?.trim().toLowerCase() || "preview";
  const previewAllowed = process.env.NODE_ENV !== "production" && requestedMode === "preview";
  const mode: PlatformMode = previewAllowed
    ? "preview"
    : supabaseConfigured && databaseConfigured
      ? "connected"
      : "unavailable";
  const parsedMinimumAge = Number.parseInt(
    process.env.MEMBERSHIP_MINIMUM_AGE?.trim() || "18",
    10,
  );

  const stripePaymentSetupReady = mode === "connected" &&
      supabaseConfigured &&
      databaseConfigured &&
      stripeConfigured &&
      process.env.STRIPE_MEMBERSHIP_PAYMENT_SETUP_ENABLED?.trim().toLowerCase() === "true" &&
      /^acct_[A-Za-z0-9]+$/.test(process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID?.trim() ?? "");
  const membershipRegistrationOnly = process.env.MEMBERSHIP_REGISTRATION_ONLY_ENABLED?.trim().toLowerCase() === "true";
  const stripeCheckoutReady = !membershipRegistrationOnly && mode === "connected" &&
      supabaseConfigured &&
      databaseConfigured &&
      stripeConfigured &&
      paidCheckoutConfigured &&
      stripePublishableKeyConfigured;
  // Paid authorization is a separate release from registration and profile
  // access. A held registrant may confirm billing without opening their profile.
  const stripeActivationReady = mode === "connected" && stripeConfigured &&
      paidCheckoutConfigured && stripePublishableKeyConfigured &&
      hasEnvironmentValue("STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID") &&
      process.env.STRIPE_MEMBERSHIP_BUYOUT_READY?.trim().toLowerCase() === "true" &&
      process.env.STRIPE_MEMBERSHIP_ACTIVATION_ENABLED?.trim().toLowerCase() === "true";

  // This requirement is pinned onto new registrations. A temporarily missing
  // payment prerequisite must close enrollment, never downgrade it to save-card.
  const membershipPrepaymentRequired = membershipRegistrationOnly &&
    process.env.MEMBERSHIP_REGISTRATION_PREPAYMENT_REQUIRED?.trim().toLowerCase() === "true";
  const prepaidSignupReady = stripeActivationReady &&
    process.env.STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED?.trim().toLowerCase() === "true" &&
    /^acct_[A-Za-z0-9]+$/.test(process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID?.trim() ?? "");

  return {
    database: databaseConfigured ? "connected" : "disconnected",
    minimumAge:
      Number.isInteger(parsedMinimumAge) && parsedMinimumAge >= 18 && parsedMinimumAge <= 120
        ? parsedMinimumAge
        : 18,
    mode,
    stripe: stripeConfigured ? "connected" : "disconnected",
    stripePortalReady: stripeConfigured && hasEnvironmentValue("STRIPE_BILLING_PORTAL_CONFIGURATION_ID"),
    // Saving a payment method neither starts a subscription nor authorizes a
    // charge. It has its own explicit release gate while paid checkout is held.
    stripePaymentSetupReady,
    membershipRegistrationOnly,
    membershipPrepaymentRequired,
    stripeCheckoutReady,
    stripeActivationReady,
    // Saving a card for an invited account does not itself open public signup.
    membershipSignupReady: membershipPrepaymentRequired ? prepaidSignupReady : stripeCheckoutReady || (stripePaymentSetupReady &&
      process.env.STRIPE_MEMBERSHIP_PAYMENT_SETUP_SIGNUP_ENABLED?.trim().toLowerCase() === "true"),
    supabase: supabaseConfigured ? "connected" : "disconnected",
  };
}
