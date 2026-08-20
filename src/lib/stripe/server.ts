import "server-only";

import Stripe from "stripe";

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

declare global {
  var ruinedStripeClient: Stripe | undefined;
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

export function getStripe(): Stripe {
  if (!globalThis.ruinedStripeClient) {
    globalThis.ruinedStripeClient = new Stripe(
      requiredEnvironmentValue("STRIPE_SECRET_KEY"),
      {
        apiVersion: STRIPE_API_VERSION,
        appInfo: {
          name: "Ruined Membership",
          url: "https://theruinedproject.com/my",
          version: "0.1.0",
        },
        maxNetworkRetries: 2,
        timeout: 12_000,
      },
    );
  }

  return globalThis.ruinedStripeClient;
}

export function getStripeMembershipPriceId(): string {
  return requiredEnvironmentValue("STRIPE_MEMBERSHIP_PRICE_ID");
}

export function getStripeWebhookSecret(): string {
  return requiredEnvironmentValue("STRIPE_WEBHOOK_SECRET");
}

export function getMembershipAgreementVersion(): string {
  return requiredEnvironmentValue("STRIPE_MEMBERSHIP_AGREEMENT_VERSION");
}

export function isStripeTaxEnabled(): boolean {
  return process.env.STRIPE_TAX_ENABLED?.trim().toLowerCase() === "true";
}

export function getApplicationOrigin(requestOrigin: string): string {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (process.env.NODE_ENV !== "production") {
    return new URL(requestOrigin).origin;
  }

  if (!configuredOrigin) {
    throw new Error("NEXT_PUBLIC_SITE_URL is not configured.");
  }

  return new URL(configuredOrigin).origin;
}

export function isTrustedCheckoutOrigin(request: Request): boolean {
  const suppliedOrigin = request.headers.get("origin");

  if (!suppliedOrigin) {
    return request.headers.get("sec-fetch-site") === "same-origin";
  }

  try {
    const allowedOrigins = new Set([new URL(request.url).origin]);
    const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();

    if (configuredOrigin) {
      allowedOrigins.add(new URL(configuredOrigin).origin);
    }

    return allowedOrigins.has(new URL(suppliedOrigin).origin);
  } catch {
    return false;
  }
}
