import type Stripe from "stripe";

export type MembershipPortalKind = "legacy" | "commitment";

/** The reviewed membership policy must not inherit an account-wide default. */
export function matchesMembershipPortalPolicy(
  configuration: Stripe.BillingPortal.Configuration,
  expectedId: string,
  livemode: boolean,
  kind: MembershipPortalKind = "legacy",
): boolean {
  const features = configuration.features;
  return configuration.id === expectedId
    && configuration.active
    && configuration.livemode === livemode
    && features.invoice_history.enabled
    && features.payment_method_update.enabled
    && (kind === "commitment"
      ? !features.subscription_cancel.enabled
      : features.subscription_cancel.enabled
        && features.subscription_cancel.mode === "at_period_end"
        && features.subscription_cancel.proration_behavior === "none")
    && !features.subscription_update.enabled;
}
