import "server-only";
import { createHash } from "node:crypto";
import type Stripe from "stripe";
import type { MembershipCheckoutReservation } from "./billing-repository";
import { MEMBERSHIP_CONTEXT, MEMBERSHIP_OFFER } from "./membership-state";
import { MEMBERSHIP_OFFERS, type MembershipOfferId } from "@/lib/membership/pricing";
import type { FoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import { prepaidBillingMetadata, prepaidScheduleFromSubscription, prepaidScheduleFingerprint } from "./prepaid-policy";
import { matchesMembershipOfferPrice, type MembershipPriceConfiguration } from "./price-policy";
import { OperatorMembershipError } from "./operator-membership-model";

export type SavedPaymentTarget = {
  customerId: string; paymentMethodId: string; setupIntentId: string;
  stripeAccountId: string; livemode: boolean; memberId: string; email: string;
};
export type SavedPaymentInspection = {
  target: SavedPaymentTarget; mandateId: string | null; paymentMethodLabel: string;
  price: Stripe.Price; expectedTotal: number; tax: number; automaticTaxEnabled: boolean;
  customerFingerprint: string;
};
const id = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id ?? null;
function fail(message: string): never { throw new OperatorMembershipError(message, 409, "saved_payment_review_required"); }
export const savedPaymentFingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Read-only preflight. Storage consent identifies the instrument; the separate
 * operator authorization, recorded by the caller, authorizes its actual use. */
export async function inspectOperatorSavedPayment(stripe: Stripe, input: {
  target: SavedPaymentTarget; offerId: MembershipOfferId; priceId: string;
  schedule: FoundationsBillingSchedule; automaticTaxEnabled: boolean; priceConfiguration: MembershipPriceConfiguration;
}): Promise<SavedPaymentInspection> {
  const { target, schedule, offerId, priceId, automaticTaxEnabled } = input;
  const account = await stripe.accounts.retrieve(null);
  if (account.id !== target.stripeAccountId || target.livemode !== input.priceConfiguration.livemode) fail("The saved method belongs to a different payment account.");
  const [customer, method, setup, price] = await Promise.all([
    stripe.customers.retrieve(target.customerId), stripe.paymentMethods.retrieve(target.paymentMethodId),
    stripe.setupIntents.retrieve(target.setupIntentId), stripe.prices.retrieve(priceId),
  ]);
  if (customer.deleted || customer.livemode !== target.livemode || customer.email?.trim().toLowerCase() !== target.email
    || customer.metadata.ruined_member_id !== target.memberId) fail("The member’s saved billing identity needs review.");
  if (method.livemode !== target.livemode || id(method.customer) !== target.customerId
    || !["card", "link"].includes(method.type) || method.allow_redisplay !== "always") fail("This saved payment method cannot be collected by an operator.");
  const now = new Date();
  if (method.card && (method.card.exp_year < now.getUTCFullYear() || method.card.exp_year === now.getUTCFullYear() && method.card.exp_month < now.getUTCMonth() + 1)) fail("The saved card has expired.");
  if (setup.status !== "succeeded" || setup.usage !== "off_session" || setup.livemode !== target.livemode
    || id(setup.customer) !== target.customerId || id(setup.payment_method) !== target.paymentMethodId
    || setup.metadata?.ruined_member_id !== target.memberId) fail("The saved payment method is not ready for an authorized later payment.");
  const mandateId = id(setup.mandate);
  if (method.type === "link" && !mandateId) fail("The saved Link method has no verifiable authorization for recurring payments.");
  if (mandateId) {
    const mandate = await stripe.mandates.retrieve(mandateId);
    if (mandate.status !== "active" || mandate.type !== "multi_use" || mandate.livemode !== target.livemode
      || id(mandate.payment_method) !== target.paymentMethodId) fail("The saved payment authorization is no longer active.");
  }
  if (!matchesMembershipOfferPrice(price, offerId, input.priceConfiguration, true)) fail("The saved-payment offer does not match the membership price.");
  if (MEMBERSHIP_OFFERS[offerId].plan !== "monthly" || !schedule || Date.parse(schedule.cutoffAt) <= Date.now()) fail("Review the current monthly Foundations offer before collecting payment.");
  const address = customer.address;
  if (address?.country !== "US" || !address.line1?.trim() || !address.city?.trim() || !address.state?.trim() || !address.postal_code?.trim()) fail("A complete United States billing address is required before payment.");
  if (customer.balance !== 0 || customer.discount || customer.invoice_credit_balance && Object.values(customer.invoice_credit_balance).some(value => value !== 0)) fail("Existing credit or discounts need review before collecting this membership.");
  await assertNoOtherSavedPaymentBilling(stripe, target.customerId);
  const product = id(price.product)!;
  const preview = await stripe.invoices.createPreview({
    customer: target.customerId, currency: "usd", automatic_tax: { enabled: automaticTaxEnabled }, discounts: "",
    subscription_details: { items: [{ price: priceId, quantity: 1 }], billing_mode: { type: "flexible" }, trial_end: Date.parse(schedule.prepaidThrough) / 1000 },
    invoice_items: [{ price_data: { currency: "usd", product, unit_amount: MEMBERSHIP_OFFERS[offerId].amount, tax_behavior: "exclusive" }, quantity: 1, discountable: false }],
  });
  const amount = MEMBERSHIP_OFFERS[offerId].amount;
  if (preview.currency !== "usd" || preview.total_excluding_tax !== amount || preview.amount_due !== preview.total
    || preview.total < amount || !Number.isSafeInteger(preview.total) || preview.starting_balance !== 0
    || preview.lines.has_more || preview.lines.data.length !== 2
    || preview.lines.data.filter(line => line.subtotal === amount).length !== 1
    || preview.lines.data.filter(line => line.subtotal === 0).length !== 1
    || preview.total_discount_amounts?.some(discount => discount.amount !== 0)
    || automaticTaxEnabled && preview.automatic_tax.status !== "complete") fail("Stripe could not verify this exact first payment and tax. Review billing before collecting.");
  return { target, mandateId, price, expectedTotal: preview.total, tax: preview.total - amount, automaticTaxEnabled,
    paymentMethodLabel: method.card ? `${method.card.brand.toUpperCase()} ending in ${method.card.last4}` : "Saved Link payment method",
    customerFingerprint: savedPaymentFingerprint([customer.id, customer.email, customer.address, customer.shipping, customer.tax_exempt, customer.balance]),
  };
}

export async function assertNoOtherSavedPaymentBilling(stripe: Stripe, customerId: string, allowedSubscriptionId?: string) {
  const [subscriptions, invoices, items] = await Promise.all([
    stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 }),
    stripe.invoices.list({ customer: customerId, limit: 100 }),
    stripe.invoiceItems.list({ customer: customerId, pending: true, limit: 1 }),
  ]);
  if (subscriptions.has_more || invoices.has_more || items.has_more || items.data.length
    || subscriptions.data.some(subscription => subscription.id !== allowedSubscriptionId && !["canceled", "incomplete_expired"].includes(subscription.status))
    || invoices.data.some(invoice => !allowedSubscriptionId || id(invoice.parent?.subscription_details?.subscription) !== allowedSubscriptionId)) {
    fail("This Stripe customer already has billing activity or pending invoice items. Review it before starting another payment.");
  }
}

export function operatorSavedPaymentParameters(input: {
  reservation: MembershipCheckoutReservation; inspection: SavedPaymentInspection; minimumAge: number;
}): Stripe.SubscriptionCreateParams {
  const { reservation: r, inspection: p } = input;
  if (r.consentSource !== "operator_saved_payment" || !r.operatorAuthorizationId || !r.operatorActorAuthUserId
    || !r.recurringPaymentAcceptedAt || !r.billingSchedule || r.firstChargeAt || r.existingStripeSessionId
    || r.plan !== "monthly" || r.memberId !== p.target.memberId || r.stripePriceId !== p.price.id) fail("The payment does not match its delegated agreement.");
  const offer = MEMBERSHIP_OFFERS[r.offerId];
  const metadata = {
    ruined_context: MEMBERSHIP_CONTEXT, ruined_offer: MEMBERSHIP_OFFER, ruined_billing_plan: r.plan,
    ruined_price_id: r.stripePriceId, ruined_member_id: r.memberId, ruined_checkout_attempt_id: r.attemptId,
    ruined_commercial_reservation_id: r.commercialReservationId, ruined_offer_id: r.offerId,
    ruined_checkout_source: "operator_saved_payment", ruined_checkout_actor_id: r.operatorActorAuthUserId,
    ruined_operator_authorization_id: r.operatorAuthorizationId, ruined_saved_payment_id: r.attemptId,
    ruined_stripe_account_id: p.target.stripeAccountId, ruined_saved_payment_method_id: p.target.paymentMethodId,
    agreement_acceptance_id: r.agreementAcceptanceId, agreement_content_sha256: r.agreementContentSha256,
    agreement_key: r.agreementKey, agreement_version: r.agreementVersion,
    agreement_accepted_at: r.agreementAcceptedAt.toISOString(), age_attested_at: r.ageAttestedAt.toISOString(),
    billing_consent_source: "operator_saved_payment", billing_consent_at: r.recurringPaymentAcceptedAt.toISOString(),
    billing_terms_version: "membership-billing-v2", age_policy_minimum: String(input.minimumAge),
    ...prepaidBillingMetadata(r.billingSchedule),
  };
  return { customer: p.target.customerId, default_payment_method: p.target.paymentMethodId,
    automatic_tax: { enabled: p.automaticTaxEnabled }, collection_method: "charge_automatically", currency: "usd",
    billing_mode: { type: "flexible" }, items: [{ price: r.stripePriceId, quantity: 1 }], discounts: "",
    add_invoice_items: [{ price_data: { product: id(p.price.product)!, currency: "usd", unit_amount: offer.amount, tax_behavior: "exclusive" }, quantity: 1, discountable: false }],
    trial_end: Date.parse(r.billingSchedule.prepaidThrough) / 1000, trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    payment_behavior: "error_if_incomplete", off_session: true, metadata,
  };
}

export function matchesOperatorSavedSubscription(subscription: Stripe.Subscription, input: {
  reservation: MembershipCheckoutReservation; target: SavedPaymentTarget; automaticTaxEnabled: boolean;
}) {
  const { reservation: r, target } = input;
  const schedule = prepaidScheduleFromSubscription(subscription);
  return Boolean(subscription.livemode === target.livemode && id(subscription.customer) === target.customerId
    && id(subscription.default_payment_method) === target.paymentMethodId && subscription.collection_method === "charge_automatically"
    && subscription.automatic_tax.enabled === input.automaticTaxEnabled && !subscription.automatic_tax.disabled_reason
    && subscription.items.data.length === 1 && !subscription.items.has_more && subscription.items.data[0].price.id === r.stripePriceId
    && subscription.items.data[0].quantity === 1 && r.billingSchedule && schedule
    && prepaidScheduleFingerprint(schedule) === prepaidScheduleFingerprint(r.billingSchedule)
    && subscription.metadata.ruined_checkout_source === "operator_saved_payment"
    && subscription.metadata.billing_consent_source === "operator_saved_payment"
    && subscription.metadata.ruined_member_id === r.memberId && subscription.metadata.ruined_checkout_attempt_id === r.attemptId
    && subscription.metadata.ruined_saved_payment_id === r.attemptId && subscription.metadata.ruined_commercial_reservation_id === r.commercialReservationId
    && subscription.metadata.ruined_checkout_actor_id === r.operatorActorAuthUserId
    && subscription.metadata.ruined_operator_authorization_id === r.operatorAuthorizationId
    && subscription.metadata.ruined_stripe_account_id === target.stripeAccountId
    && subscription.metadata.ruined_saved_payment_method_id === target.paymentMethodId
    && subscription.metadata.agreement_acceptance_id === r.agreementAcceptanceId
    && subscription.metadata.agreement_version === r.agreementVersion
    && subscription.metadata.agreement_content_sha256 === r.agreementContentSha256
    && subscription.metadata.ruined_offer_id === r.offerId && subscription.metadata.ruined_price_id === r.stripePriceId
    && subscription.metadata.billing_consent_at === r.recurringPaymentAcceptedAt?.toISOString());
}

export function savedPaymentFailure(error: unknown): { state: "requires_action" | "failed" | "review"; code: string; message: string } {
  const failure = error as { type?: string; code?: string; decline_code?: string };
  if (failure.type === "StripeCardError") {
    if (failure.code === "authentication_required" || failure.decline_code === "authentication_required") return {
      state: "requires_action", code: "authentication_required", message: "The bank requires the member to authenticate payment. Payment is not confirmed; review this attempt before opening a member checkout.",
    };
    return { state: "failed", code: "payment_declined", message: "Stripe did not confirm payment. The member needs to review or replace their payment method." };
  }
  // Timeouts, transport errors and 5xx responses may happen after a successful
  // charge. Never turn an unknown result into a new payment attempt.
  return { state: "review", code: "provider_outcome_unknown", message: "The payment result needs reconciliation. Do not start another payment." };
}
