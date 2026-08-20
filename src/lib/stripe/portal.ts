import "server-only";

import { findBillingMemberById } from "@/lib/stripe/billing-repository";
import { getStripe } from "@/lib/stripe/server";

/**
 * Call only after the application has authenticated the member and obtained
 * the member ID from its trusted server session. Never accept a Stripe Customer
 * ID or return URL directly from the browser.
 */
export async function createBillingPortalSessionForMember({
  memberId,
  returnUrl,
}: {
  memberId: string;
  returnUrl: string;
}): Promise<string> {
  const parsedReturnUrl = new URL(returnUrl);
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const allowedOrigins = new Set<string>();

  if (configuredOrigin) allowedOrigins.add(new URL(configuredOrigin).origin);
  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.add("http://localhost:3000");
    allowedOrigins.add("http://127.0.0.1:3000");
  }

  if (!allowedOrigins.has(parsedReturnUrl.origin)) {
    throw new Error("The billing Portal return URL is not allowed.");
  }

  const member = await findBillingMemberById(memberId);

  if (!member?.stripeCustomerId) {
    throw new Error("The authenticated member has no Stripe Customer.");
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: member.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}
