import "server-only";

import type Stripe from "stripe";
import type { BillingTransaction } from "./billing-repository";
import { reconcileCheckoutAttempt } from "./billing-repository";
import { isUuid } from "./membership-state";
import { MEMBERSHIP_OFFERS, type MembershipOfferId } from "@/lib/membership/pricing";
import { prepaidScheduleFingerprint } from "./prepaid-policy";
import type { FoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";

const id = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id ?? null;

/** Opening a payment form is not approval. Only a freshly retrieved, completed
 * Stripe session can supply native payment consent. This runs before fulfillment
 * for both Checkout and invoice-first webhook delivery; legacy consent is intact.
 */
export async function reconcileNativeCheckoutConsent(tx: BillingTransaction, stripe: Stripe, input: {
  subscription: Stripe.Subscription; sessionId?: string; eventId: string;
}): Promise<boolean> {
  const { subscription } = input;
  const attemptId = subscription.metadata.ruined_checkout_attempt_id;
  if (!isUuid(attemptId)) return false;
  const [attempt] = await tx<Array<{
    id: string; member_id: string; stripe_session_id: string | null; stripe_subscription_id: string | null;
    billing_consent_source: "member" | "stripe_checkout"; recurring_payment_accepted_at: Date | null;
    checkout_prepared_at: Date; agreement_acceptance_id: string; agreement_version: string;
    commercial_reservation_id: string; offer_id: MembershipOfferId; billing_plan: string; stripe_price_id: string;
    first_charge_at: Date | null; billing_schedule: FoundationsBillingSchedule | null;
    billing_consent_evidence: { sessionId: string; subscriptionId: string } | null;
  }>>`select id,member_id,stripe_session_id,stripe_subscription_id,billing_consent_source,recurring_payment_accepted_at,
      checkout_prepared_at,agreement_acceptance_id,agreement_version,commercial_reservation_id,offer_id,billing_plan,
      stripe_price_id,first_charge_at,billing_schedule,billing_consent_evidence
    from stripe_checkout_attempts where id=${attemptId}::uuid for update`;
  if (!attempt || attempt.billing_consent_source !== "stripe_checkout") return Boolean(attempt?.recurring_payment_accepted_at);
  const mismatch = () => { throw new Error("Stripe payment consent does not match the prepared membership."); };
  if (attempt.stripe_subscription_id && attempt.stripe_subscription_id !== subscription.id) return mismatch();
  if (attempt.recurring_payment_accepted_at) {
    if (attempt.billing_consent_evidence?.subscriptionId !== subscription.id ||
      input.sessionId && attempt.billing_consent_evidence.sessionId !== input.sessionId) return mismatch();
    return true;
  }
  if (input.sessionId && attempt.stripe_session_id && input.sessionId !== attempt.stripe_session_id) return mismatch();
  let sessionId = attempt.stripe_session_id ?? input.sessionId;
  if (!sessionId) {
    // Webhooks may beat the create-session response. Locate the one immutable
    // subscription session instead of guessing a session or trusting event JSON.
    const sessions = await stripe.checkout.sessions.list({ subscription: subscription.id, limit: 100 });
    if (sessions.has_more || sessions.data.length !== 1) return mismatch();
    sessionId = sessions.data[0].id;
  }
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items.data.price"] });
  if (session.status !== "complete") return false;
  const offer = MEMBERSHIP_OFFERS[attempt.offer_id];
  if (!offer) return mismatch();
  const expectedMetadata: Record<string, string> = {
    ruined_member_id: attempt.member_id, ruined_checkout_attempt_id: attempt.id,
    ruined_commercial_reservation_id: attempt.commercial_reservation_id,
    agreement_acceptance_id: attempt.agreement_acceptance_id, agreement_version: attempt.agreement_version,
    ruined_billing_plan: attempt.billing_plan, ruined_price_id: attempt.stripe_price_id,
    ruined_offer_id: attempt.offer_id, billing_terms_version: "membership-billing-v2",
    billing_consent_source: "stripe_checkout", billing_prepared_at: new Date(attempt.checkout_prepared_at).toISOString(),
  };
  for (const [key, value] of Object.entries(expectedMetadata)) {
    if (session.metadata?.[key] !== value || subscription.metadata[key] !== value) return mismatch();
  }
  for (const metadata of [session.metadata, subscription.metadata]) {
    if ((metadata?.ruined_first_charge_at ?? null) !== (attempt.first_charge_at?.toISOString() ?? null) ||
      (metadata?.ruined_billing_schedule_sha256 ?? null) !== (attempt.billing_schedule ? prepaidScheduleFingerprint(attempt.billing_schedule) : null)) return mismatch();
  }
  const lines = session.line_items;
  const recurringLine = lines?.data.find(line => id(line.price) === attempt.stripe_price_id);
  const upfrontLines = lines?.data.filter(line => id(line.price) !== attempt.stripe_price_id) ?? [];
  const upfront = upfrontLines[0];
  const expectedProduct = id(subscription.items.data[0]?.price.product);
  const prepaidLinesMatch = attempt.billing_schedule
    ? lines?.data.length === 2 && recurringLine?.amount_subtotal === 0 && upfrontLines.length === 1 &&
      upfront?.amount_subtotal === offer.amount && upfront.price?.unit_amount === offer.amount &&
      !upfront.price.recurring && upfront.price.currency === offer.currency && upfront.price.tax_behavior === "exclusive" &&
      Boolean(expectedProduct) && id(upfront.price.product) === expectedProduct
    : lines?.data.length === 1 && upfrontLines.length === 0;
  if (session.consent_collection?.terms_of_service !== "required" || session.consent?.terms_of_service !== "accepted" ||
    session.mode !== "subscription" || session.ui_mode !== "embedded_page" || session.client_reference_id !== attempt.member_id ||
    id(session.subscription) !== subscription.id || !id(subscription.customer) || id(session.customer) !== id(subscription.customer) ||
    session.livemode !== subscription.livemode || session.currency !== offer.currency ||
    session.amount_subtotal !== (attempt.first_charge_at ? 0 : offer.amount) ||
    !lines || lines.has_more || !recurringLine || !prepaidLinesMatch || lines.data.some(line => line.quantity !== 1 || line.currency !== offer.currency) ||
    subscription.items.data.length !== 1 || id(subscription.items.data[0].price) !== attempt.stripe_price_id) return mismatch();

  await reconcileCheckoutAttempt(tx, { attemptId: attempt.id, acceptanceId: attempt.agreement_acceptance_id,
    sessionId: session.id, subscriptionId: subscription.id, status: "completed", expiresAt: new Date(session.expires_at * 1000) });
  // Stripe exposes the accepted flag, not an exact checkbox click timestamp.
  // Store when we verified its consent, with provider/session evidence; never
  // reuse the preparation timestamp or imply that simply opening the form paid.
  const verifiedAt = new Date();
  await tx`update stripe_checkout_attempts
    set recurring_payment_accepted_at=${verifiedAt},billing_consent_evidence=${tx.json({
      source: "stripe_checkout", termsOfService: "accepted", sessionId: session.id,
      subscriptionId: subscription.id, memberId: attempt.member_id, attemptId: attempt.id,
      livemode: session.livemode, verifiedAt: verifiedAt.toISOString(), providerEventId: input.eventId,
    })}::jsonb where id=${attempt.id}::uuid and recurring_payment_accepted_at is null`;
  return true;
}
