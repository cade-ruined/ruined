import "server-only";

import { findBillingMemberById } from "@/lib/stripe/billing-repository";
import { getMemberBillingCommitment } from "@/lib/stripe/commitment-account";
import { matchesMembershipPortalPolicy, type MembershipPortalKind } from "@/lib/stripe/portal-policy";
import { getStripe, getStripeLivemode } from "@/lib/stripe/server";

export async function validateMembershipPortalConfiguration(kind: MembershipPortalKind = "legacy"): Promise<string> {
  const variable = kind === "commitment"
    ? "STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID"
    : "STRIPE_BILLING_PORTAL_CONFIGURATION_ID";
  const configurationId = process.env[variable]?.trim();
  if (!configurationId) throw new Error(`${variable} is not configured.`);
  const configuration = await getStripe().billingPortal.configurations.retrieve(configurationId);
  if (!matchesMembershipPortalPolicy(configuration, configurationId, getStripeLivemode(), kind)) {
    throw new Error("The configured billing portal does not match the membership cancellation policy.");
  }
  return configurationId;
}

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

  const contract = await getMemberBillingCommitment(memberId);
  let kind: MembershipPortalKind = contract ? "commitment" : "legacy";
  if (!contract) {
    // Checkout can be paid before its invoice webhook creates the local contract.
    // Never expose a new v2 subscription to the legacy cancellation controls in
    // that delivery window. Provider failure must not fall back to legacy policy.
    for await (const subscription of getStripe().subscriptions.list({ customer: member.stripeCustomerId, status: "all", limit: 100 })) {
      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      if (customerId !== member.stripeCustomerId || subscription.livemode !== getStripeLivemode()) {
        throw new Error("The billing subscription does not match this member's customer.");
      }
      if (subscription.metadata.billing_terms_version === "membership-billing-v2"
        && !["canceled", "incomplete_expired"].includes(subscription.status)) {
        if (subscription.metadata.ruined_member_id !== memberId) throw new Error("The paid membership owner could not be verified.");
        kind = "commitment";
        break;
      }
    }
  }
  const configuration = await validateMembershipPortalConfiguration(kind);
  const session = await getStripe().billingPortal.sessions.create({
    configuration,
    customer: member.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}
