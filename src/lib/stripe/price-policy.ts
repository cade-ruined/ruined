import type Stripe from "stripe";

import { MEMBERSHIP_PLANS, type MembershipBillingPlan } from "@/lib/membership/pricing";

export type MembershipPriceConfiguration = {
  monthly: string | null;
  annual: string | null;
  legacy: string | null;
  livemode: boolean;
};

export function matchesMembershipPrice(
  price: Stripe.Price,
  plan: MembershipBillingPlan,
  configuration: MembershipPriceConfiguration,
  requireActive = false,
): boolean {
  const expected = MEMBERSHIP_PLANS[plan];
  return Boolean(
    configuration[plan] &&
    configuration.monthly !== configuration.annual &&
    price.id === configuration[plan] &&
    price.livemode === configuration.livemode &&
    (!requireActive || price.active) &&
    price.type === "recurring" &&
    price.billing_scheme === "per_unit" &&
    !price.transform_quantity &&
    price.currency === expected.currency &&
    price.unit_amount === expected.amount &&
    price.recurring?.interval === expected.interval &&
    price.recurring.interval_count === 1 &&
    price.recurring.usage_type === "licensed",
  );
}

export function recognizesMembershipSubscription(
  subscription: Stripe.Subscription,
  configuration: MembershipPriceConfiguration,
): boolean {
  if (subscription.livemode !== configuration.livemode || subscription.items.has_more) return false;
  if (subscription.items.data.length !== 1) return false;
  const item = subscription.items.data[0];
  if (item.quantity !== 1 || item.price.livemode !== configuration.livemode) return false;
  const plan = subscription.metadata.ruined_billing_plan;
  if (plan === "monthly" && matchesMembershipPrice(item.price, "monthly", configuration)) return true;
  if (plan === "annual" && matchesMembershipPrice(item.price, "annual", configuration)) return true;

  // Previously purchased plans keep reconciling after the new offer launches.
  // The legacy ID is never eligible for a newly created checkout.
  return Boolean(
    configuration.legacy &&
    configuration.legacy !== configuration.monthly &&
    configuration.legacy !== configuration.annual &&
    item.price.id === configuration.legacy &&
    item.price.type === "recurring" &&
    !subscription.metadata.ruined_billing_plan,
  );
}

export function matchesMembershipInvoice(
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription,
  configuration: MembershipPriceConfiguration,
): boolean {
  if (!recognizesMembershipSubscription(subscription, configuration) || invoice.livemode !== configuration.livemode) return false;
  // This offer has one flat recurring line. Adjustments or plan migrations need
  // explicit reconciliation; they must not accidentally activate a first sale.
  if (invoice.lines.has_more || invoice.lines.data.length !== 1) return false;
  const line = invoice.lines.data[0];
  const item = subscription.items.data[0];
  const details = line.parent?.subscription_item_details;
  const linePrice = line.pricing?.price_details?.price;
  const linePriceId = typeof linePrice === "string" ? linePrice : linePrice?.id;
  return Boolean(
    line.livemode === configuration.livemode &&
    invoice.currency === item.price.currency && line.currency === item.price.currency &&
    line.parent?.type === "subscription_item_details" &&
    details?.subscription === subscription.id &&
    details.subscription_item === item.id && !details.proration &&
    line.quantity === 1 && linePriceId === item.price.id &&
    item.price.unit_amount && line.subtotal === item.price.unit_amount,
  );
}

export function hasFullMembershipPayment(invoice: Stripe.Invoice, subscription: Stripe.Subscription): boolean {
  const amount = subscription.items.data[0]?.price.unit_amount;
  return invoice.status === "paid" && Boolean(amount && invoice.amount_paid >= amount) && invoice.amount_remaining === 0;
}
