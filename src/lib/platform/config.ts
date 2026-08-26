import "server-only";

export type PlatformConnection = "connected" | "disconnected";
export type PlatformMode = "connected" | "preview" | "unavailable";

export type PlatformConfiguration = {
  database: PlatformConnection;
  minimumAge: number;
  mode: PlatformMode;
  stripe: PlatformConnection;
  stripeCheckoutReady: boolean;
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
  const stripeConfigured =
    hasEnvironmentValue("STRIPE_SECRET_KEY") &&
    hasEnvironmentValue("STRIPE_WEBHOOK_SECRET") &&
    hasEnvironmentValue("STRIPE_MEMBERSHIP_PRICE_ID") &&
    hasEnvironmentValue("STRIPE_MEMBERSHIP_AGREEMENT_VERSION");
  const requestedMode = process.env.PLATFORM_MODE?.trim().toLowerCase() || "preview";
  const previewAllowed = process.env.NODE_ENV !== "production" && requestedMode === "preview";
  const mode: PlatformMode = previewAllowed
    ? "preview"
    : supabaseConfigured && databaseConfigured
      ? "connected"
      : "unavailable";
  const parsedMinimumAge = Number.parseInt(
    process.env.MEMBERSHIP_MINIMUM_AGE?.trim() || "16",
    10,
  );

  return {
    database: databaseConfigured ? "connected" : "disconnected",
    minimumAge:
      Number.isInteger(parsedMinimumAge) && parsedMinimumAge >= 16 && parsedMinimumAge <= 120
        ? parsedMinimumAge
        : 16,
    mode,
    stripe: stripeConfigured ? "connected" : "disconnected",
    stripeCheckoutReady:
      mode === "connected" &&
      supabaseConfigured &&
      databaseConfigured &&
      stripeConfigured &&
      stripePublishableKeyConfigured,
    supabase: supabaseConfigured ? "connected" : "disconnected",
  };
}
