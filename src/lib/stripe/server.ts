import "server-only";

import Stripe from "stripe";

import type { MembershipBillingPlan, MembershipOfferId } from "@/lib/membership/pricing";
import { LIVE_MEMBERSHIP_PRICE_IDS, SANDBOX_MEMBERSHIP_PRICE_IDS } from "@/lib/stripe/membership-catalog";
import { matchesMembershipOfferPrice, matchesMembershipPrice, type MembershipPriceConfiguration } from "@/lib/stripe/price-policy";

export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

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

export function getStripeMembershipPriceId(plan: MembershipBillingPlan): string {
  return requiredEnvironmentValue(plan === "monthly"
    ? "STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID"
    : "STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID");
}

export function getStripeLivemode(): boolean {
  const key = requiredEnvironmentValue("STRIPE_SECRET_KEY");
  if (!/^(?:sk|rk)_(?:live|test)_/.test(key)) throw new Error("Stripe server key mode is invalid.");
  return /^(?:sk|rk)_live_/.test(key);
}

export function getMembershipPriceConfiguration(): MembershipPriceConfiguration {
  const livemode = getStripeLivemode();
  const catalog = livemode ? LIVE_MEMBERSHIP_PRICE_IDS : SANDBOX_MEMBERSHIP_PRICE_IDS;
  const offers = Object.fromEntries(Object.entries(catalog).map(([offerId, catalogPriceId]) => [
    offerId, process.env[`STRIPE_MEMBERSHIP_${offerId.toUpperCase()}_PRICE_ID`]?.trim() || catalogPriceId,
  ])) as Record<MembershipOfferId, string>;
  return {
    monthly: process.env.STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID?.trim() || null,
    annual: process.env.STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID?.trim() || null,
    legacy: process.env.STRIPE_MEMBERSHIP_PRICE_ID?.trim() || null,
    livemode,
    offers,
  };
}

export function getStripeMembershipOfferPriceId(offerId: MembershipOfferId): string {
  const priceId = getMembershipPriceConfiguration().offers?.[offerId];
  if (!priceId) throw new Error("Membership offer price is not configured.");
  return priceId;
}

export async function validateStripeMembershipOfferPrice(offerId: MembershipOfferId): Promise<string> {
  const configuration = getMembershipPriceConfiguration();
  const priceId = getStripeMembershipOfferPriceId(offerId);
  const price = await getStripe().prices.retrieve(priceId);
  if (!matchesMembershipOfferPrice(price, offerId, configuration, true)) {
    throw new Error("The configured Stripe membership price does not match the approved offer.");
  }
  return priceId;
}

export function getPaidMembershipAgreementVersion(): string {
  return requiredEnvironmentValue("STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION");
}

export async function validateStripeMembershipPrice(plan: MembershipBillingPlan): Promise<string> {
  const configuration = getMembershipPriceConfiguration();
  const priceId = getStripeMembershipPriceId(plan);
  const price = await getStripe().prices.retrieve(priceId);
  if (!matchesMembershipPrice(price, plan, configuration, true)) {
    throw new Error("The configured Stripe membership price does not match the approved offer.");
  }
  return priceId;
}

export function getStripeWebhookSecret(): string {
  return requiredEnvironmentValue("STRIPE_WEBHOOK_SECRET");
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
