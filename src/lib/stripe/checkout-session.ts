import "server-only";
import type Stripe from "stripe";
import type { MembershipCheckoutReservation } from "@/lib/stripe/billing-repository";
import { MEMBERSHIP_CONTEXT, MEMBERSHIP_OFFER } from "@/lib/stripe/membership-state";
import { MEMBERSHIP_OFFERS } from "@/lib/membership/pricing";
import { prepaidBillingMetadata } from "@/lib/stripe/prepaid-policy";
import { isStripeTaxEnabled } from "@/lib/stripe/server";

/** Shared provider parameters for member and explicitly authorized operator checkout. */
export async function createEmbeddedMembershipSession(input: {
  stripe: Stripe; reservation: MembershipCheckoutReservation; email: string;
  applicationOrigin: string; minimumAge: number; termsMessage: string;
  operatorAuthUserId?: string;
}) {
  const { stripe, reservation, email, applicationOrigin, minimumAge, termsMessage, operatorAuthUserId } = input;
  const { plan, billingSchedule, stripePriceId: priceId } = reservation;
  if (!operatorAuthUserId && reservation.operatorAuthorizationId) throw new Error("Operator authorization requires an operator checkout.");
  if (operatorAuthUserId && (reservation.operatorActorAuthUserId !== operatorAuthUserId || !reservation.operatorAuthorizationId)) {
    throw new Error("The operator payment authorization does not match this checkout.");
  }
  const metadata = {
    ...(operatorAuthUserId ? { ruined_checkout_actor_id: operatorAuthUserId, ruined_checkout_source: "operator", ruined_operator_authorization_id: reservation.operatorAuthorizationId! } : {}),
    ruined_context: MEMBERSHIP_CONTEXT,
    ruined_offer: MEMBERSHIP_OFFER,
    ruined_billing_plan: reservation.plan,
    ruined_price_id: reservation.stripePriceId,
    ruined_member_id: reservation.memberId,
    ruined_checkout_attempt_id: reservation.attemptId,
    agreement_acceptance_id: reservation.agreementAcceptanceId,
    agreement_content_sha256: reservation.agreementContentSha256,
    agreement_key: reservation.agreementKey,
    agreement_version: reservation.agreementVersion,
    agreement_accepted_at: reservation.agreementAcceptedAt.toISOString(),
    age_attested_at: reservation.ageAttestedAt.toISOString(),
    ...(reservation.consentSource === "stripe_checkout"
      ? { billing_consent_source: "stripe_checkout", billing_prepared_at: reservation.checkoutPreparedAt.toISOString() }
      : { billing_consent_at: reservation.recurringPaymentAcceptedAt!.toISOString() }),
    billing_terms_version: "membership-billing-v2",
    ...(reservation.firstChargeAt ? { ruined_first_charge_at: reservation.firstChargeAt.toISOString() } : {}),
    ...(billingSchedule ? prepaidBillingMetadata(billingSchedule) : {}),
    ruined_offer_id: reservation.offerId,
    ruined_commercial_reservation_id: reservation.commercialReservationId,
    age_policy_minimum: String(minimumAge),
  };

  // The paid reservation now prevents concurrent withdrawal. Storage consent
  // only supplies a customer; this fresh Checkout still requires payment approval.
  const { getSavedPaymentMethodForCheckout } = await import("@/lib/stripe/payment-method-service");
  const savedMethod = await getSavedPaymentMethodForCheckout(reservation.memberId, reservation.attemptId, operatorAuthUserId);
  if (operatorAuthUserId && !savedMethod) throw new Error("Operator checkout requires a bound member customer.");
  const selectedOffer = MEMBERSHIP_OFFERS[reservation.offerId];
  const initialTotal = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(selectedOffer.initialTermAmount / 100);
  const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", dateStyle: "long" }).format(new Date(date));
  const scheduledDisclosure = billingSchedule
    ? `Pay your first ${plan === "annual" ? "year" : "month"} today. Foundations and your 12-month term start ${dateLabel(billingSchedule.serviceStartsAt)}. This payment covers your first ${plan === "annual" ? "year" : "month"}; your next charge is ${dateLabel(billingSchedule.nextChargeAt)}. Cancel before service starts for a full refund. `
    : reservation.firstChargeAt
    ? `$0 today. Your first payment is on ${new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "long", day: "numeric", year: "numeric" }).format(reservation.firstChargeAt)}. Your initial term starts on that date. Cancel before then without a fee or charge. `
    : "";
  const billingDisclosure = plan === "monthly"
    ? `Initial 12-month commitment: ${initialTotal} before tax, in 12 monthly payments. Early exit replaces unpaid first-year installments with the lower of $1,500 or that remaining balance. After year one, renews monthly.`
    : `Initial 12-month membership: ${initialTotal} before tax, paid upfront. Renews annually. Turning off the next renewal has no early-exit charge.`;
  const recurringPrice = billingSchedule ? await stripe.prices.retrieve(priceId) : null;
  const recurringProduct = recurringPrice ? typeof recurringPrice.product === "string" ? recurringPrice.product : recurringPrice.product.id : null;
  const lineItems = [{ price: priceId, quantity: 1 }, ...(billingSchedule && recurringProduct ? [{ price_data: {
    currency: selectedOffer.currency, unit_amount: selectedOffer.amount, tax_behavior: "exclusive" as const, product: recurringProduct,
  }, quantity: 1 }] : [])];
  const session = await stripe.checkout.sessions.create(
    {
      automatic_tax: { enabled: isStripeTaxEnabled() },
      billing_address_collection: "required",
      shipping_address_collection: { allowed_countries: ["US"] },
      client_reference_id: reservation.memberId,
      ...(savedMethod
        ? { customer: savedMethod.customerId, customer_update: { address: "auto" as const } }
        : { customer_email: email }),
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: { message: termsMessage },
        submit: { message: `${scheduledDisclosure}${billingDisclosure} Applicable tax is added. US members only. Manage renewal or early exit in My Ruined > Membership billing. ${billingSchedule ? "After service begins, refund requests are reviewed individually." : "Refund requests are reviewed individually; contact connect@theruinedproject.com."}` },
      },
      expires_at: Math.floor(reservation.expiresAt.getTime() / 1_000),
      integration_identifier: "ruined_my_qvksnctb",
      line_items: lineItems,
      metadata,
      mode: "subscription",
      origin_context: "web",
      payment_method_collection: "always",
      redirect_on_completion: "always",
      return_url: operatorAuthUserId
        ? `${applicationOrigin}/ops/members/${reservation.memberId}?membershipCheckout=returned#membership`
        : reservation.firstChargeAt || billingSchedule
        ? `${applicationOrigin}/my/activate?checkout=returned`
        : `${applicationOrigin}/my/join/complete?session_id={CHECKOUT_SESSION_ID}`,
      subscription_data: { billing_mode: { type: "flexible" }, metadata,
        ...(billingSchedule ? { trial_end: Date.parse(billingSchedule.prepaidThrough) / 1000,
          trial_settings: { end_behavior: { missing_payment_method: "cancel" as const } } } : {}),
        ...(reservation.firstChargeAt ? { billing_cycle_anchor: Math.floor(reservation.firstChargeAt.getTime() / 1_000), proration_behavior: "none" as const } : {}),
      },
      ui_mode: "embedded_page",
    },
    {
      idempotencyKey: `ruined-membership:${reservation.attemptId}:${reservation.agreementAcceptanceId}:${reservation.plan}:${reservation.stripePriceId}`,
    },
  );

  return session;
}
