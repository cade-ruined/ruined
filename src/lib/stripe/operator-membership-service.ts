import "server-only";
import type Stripe from "stripe";
import { createHash } from "node:crypto";
import { getPlatformConfiguration, getStripePublishableKey } from "@/lib/platform/config";
import { getPublishedMembershipAgreement } from "@/lib/membership/published-agreement";
import { getMembershipFirstChargeAt } from "@/lib/membership/paid-launch";
import { isMembershipCohortPrepaymentEnabled } from "@/lib/membership/cohort-prepayment";
import { createFoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import { MEMBERSHIP_OFFERS, type MembershipBillingPlan } from "@/lib/membership/pricing";
import { bindCommercialMembershipPrice, getCommercialMembershipReservation, getCurrentCommercialMembershipReservation,
  reserveCommercialMembership, releaseCommercialMembershipReservation } from "@/lib/membership/commercial-repository";
import { getOperatorCheckoutMember, acceptOperatorMembershipAgreement } from "@/lib/stripe/operator-membership-repository";
import { getMembershipCheckoutForReservation, reserveMembershipCheckout, openMembershipCheckoutAttempt, expireMembershipCheckoutAttempt } from "@/lib/stripe/billing-repository";
import { createEmbeddedMembershipSession } from "@/lib/stripe/checkout-session";
import { prepaidScheduleFingerprint } from "@/lib/stripe/prepaid-policy";
import { validateMembershipPortalConfiguration } from "@/lib/stripe/portal";
import { getPaidMembershipAgreementVersion, getStripe, getStripeLivemode, validateStripeMembershipOfferPrice } from "@/lib/stripe/server";
import { OPERATOR_MEMBERSHIP_AUTHORITY_VERSION, OperatorMembershipError, type OperatorMembershipQuote } from "@/lib/stripe/operator-membership-model";

function checkoutConfiguration() {
  const config = getPlatformConfiguration();
  const publishableKey = getStripePublishableKey();
  if ((!config.stripeCheckoutReady && !config.stripeActivationReady) || !publishableKey) {
    throw new OperatorMembershipError("Membership payment is not configured yet.", 503);
  }
  return { ...config, publishableKey };
}

async function currentAgreement(prepaid: boolean) {
  const version = getPaidMembershipAgreementVersion();
  const agreement = await getPublishedMembershipAgreement(version);
  if (!agreement || !(prepaid ? /^ruined_membership-v([3-9]|[1-9]\d+)$/ : /^ruined_membership-v([2-9]|[1-9]\d+)$/).test(version)) {
    throw new OperatorMembershipError("The paid membership agreement is not available yet.", 503);
  }
  return { title: agreement.title, version, bodyText: agreement.body };
}

function reviewToken(authUserId: string, memberId: string, quote: Omit<OperatorMembershipQuote, "reviewToken">) {
  return createHash("sha256").update(JSON.stringify({ authUserId, memberId, id: quote.id,
    offer: quote.offer, agreement: quote.agreement, firstChargeAt: quote.firstChargeAt,
    billingSchedule: quote.billingSchedule, buyoutCap: quote.buyoutCap })).digest("hex");
}

export async function operatorMembershipStatus(authUserId: string, memberId: string) {
  const member = await getOperatorCheckoutMember(authUserId, memberId, { allowIneligible: true });
  const status = { eligible: member.eligible, reason: member.reason, paid: member.paid, memberName: member.name, actorName: member.actorName };
  const config = getPlatformConfiguration();
  const publishableKey = getStripePublishableKey();
  return { ...status, eligible: status.eligible && Boolean(publishableKey) && (config.stripeCheckoutReady || config.stripeActivationReady),
    reason: status.reason ?? ((!config.stripeCheckoutReady && !config.stripeActivationReady || !publishableKey) ? "Membership payment is not configured yet." : null), publishableKey };
}

export async function quoteOperatorMembership(input: { authUserId: string; memberId: string; requestId: string; plan: MembershipBillingPlan }) {
  const member = await getOperatorCheckoutMember(input.authUserId, input.memberId);
  const config = checkoutConfiguration();
  const prepaid = isMembershipCohortPrepaymentEnabled();
  const agreement = await currentAgreement(prepaid);
  let current = await getCurrentCommercialMembershipReservation(input.memberId);
  if (current) {
    const attempt = await getMembershipCheckoutForReservation(current.id, input.memberId);
    if (attempt && ["creating", "open"].includes(attempt.status) && attempt.actorAuthUserId === input.authUserId
      && attempt.operatorAuthorizationId === current.id && attempt.expiresAt > current.expiresAt) {
      current = { ...current, expiresAt: attempt.expiresAt };
    }
    const stale = current.expiresAt.getTime() <= Date.now() || current.billingSchedule && Date.parse(current.billingSchedule.cutoffAt) <= Date.now()
      || current.firstChargeAt && current.firstChargeAt.getTime() <= Date.now() + 31 * 60_000;
    if (stale) {
      if (attempt && !["failed", "expired"].includes(attempt.status)) {
        if (!attempt.stripeSessionId) throw new OperatorMembershipError("An earlier payment is being prepared. Wait for it to finish before opening another checkout.");
        const session = await getStripe().checkout.sessions.retrieve(attempt.stripeSessionId);
        if (session.status !== "expired" || session.livemode !== getStripeLivemode() || session.metadata?.ruined_member_id !== input.memberId
          || session.metadata.ruined_checkout_attempt_id !== attempt.id || session.metadata.ruined_commercial_reservation_id !== current.id) {
          throw new OperatorMembershipError("An earlier payment is still open or being confirmed. Finish that checkout before starting another.");
        }
        await expireMembershipCheckoutAttempt(attempt.id);
      }
      await releaseCommercialMembershipReservation({ reservationId: current.id, reason: attempt ? "checkout_expired" : "before_checkout_abandoned" });
      if (current.id === input.requestId) throw new OperatorMembershipError("This offer expired. Refresh the page to review a new offer.");
      current = null;
    } else if (current.kind !== "individual" || current.plan !== input.plan) {
      throw new OperatorMembershipError(`A ${current.plan} ${current.kind} offer is already open. Resume that offer before changing plans.`, 409, "checkout_plan_locked", current.plan);
    }
  }
  const now = new Date();
  const billingSchedule = prepaid ? createFoundationsBillingSchedule(now, input.plan) : null;
  const firstChargeAt = prepaid ? null : getMembershipFirstChargeAt(now);
  if (firstChargeAt) {
    const months = input.plan === "annual" ? 12 : 1;
    const intervalEnd = new Date(now);
    intervalEnd.setUTCDate(1);
    intervalEnd.setUTCMonth(intervalEnd.getUTCMonth() + months);
    intervalEnd.setUTCDate(Math.min(now.getUTCDate(), new Date(Date.UTC(intervalEnd.getUTCFullYear(), intervalEnd.getUTCMonth() + 1, 0)).getUTCDate()));
    if (firstChargeAt >= intervalEnd || firstChargeAt.getTime() <= now.getTime() + 32 * 60_000) {
      throw new OperatorMembershipError("The scheduled billing window is unavailable. Try again after membership billing begins.");
    }
  }
  const reservation = current ?? await reserveCommercialMembership({ requestId: input.requestId, memberId: input.memberId, kind: "individual", plan: input.plan,
    firstChargeAt, billingSchedule, expiresAt: new Date(Math.min(now.getTime() + 60 * 60_000,
      firstChargeAt ? firstChargeAt.getTime() - 60_000 : Infinity, billingSchedule ? Date.parse(billingSchedule.cutoffAt) : Infinity)) });
  const priceId = await validateStripeMembershipOfferPrice(reservation.offerId);
  await bindCommercialMembershipPrice({ reservationId: reservation.id, stripePriceId: priceId });
  const quote = { id: reservation.id, expiresAt: reservation.expiresAt.toISOString(), firstChargeAt: reservation.firstChargeAt?.toISOString() ?? null,
    billingSchedule: reservation.billingSchedule ?? null, offer: MEMBERSHIP_OFFERS[reservation.offerId], agreement,
    memberName: member.name, actorName: member.actorName, publishableKey: config.publishableKey, buyoutCap: 150_000 };
  return { quote: { ...quote, reviewToken: reviewToken(input.authUserId, input.memberId, quote) } };
}

export async function startOperatorMembershipCheckout(input: {
  authUserId: string; memberId: string; reservationId: string; reviewToken: string;
  authorityAccepted: boolean; authorityVersion: string; applicationOrigin: string; userAgent: string | null;
}) {
  if (input.authorityAccepted !== true || input.authorityVersion !== OPERATOR_MEMBERSHIP_AUTHORITY_VERSION) {
    throw new OperatorMembershipError("Confirm the member's authorization and your cardholder permission before payment.", 400);
  }
  const member = await getOperatorCheckoutMember(input.authUserId, input.memberId);
  const config = checkoutConfiguration();
  const commercial = await getCommercialMembershipReservation(input.reservationId);
  if (!commercial || commercial.memberId !== input.memberId || commercial.kind !== "individual" || commercial.status !== "reserved"
    || commercial.billingSchedule && Date.parse(commercial.billingSchedule.cutoffAt) <= Date.now()
    || commercial.firstChargeAt && commercial.firstChargeAt.getTime() <= Date.now()) {
    throw new OperatorMembershipError("This offer is no longer available. Refresh the page to review the current offer.");
  }
  const agreement = await currentAgreement(Boolean(commercial.billingSchedule));
  const expectedQuote = { id: commercial.id, expiresAt: commercial.expiresAt.toISOString(), firstChargeAt: commercial.firstChargeAt?.toISOString() ?? null,
    billingSchedule: commercial.billingSchedule ?? null, offer: MEMBERSHIP_OFFERS[commercial.offerId], agreement,
    memberName: member.name, actorName: member.actorName, publishableKey: config.publishableKey, buyoutCap: 150_000 };
  if (input.reviewToken !== reviewToken(input.authUserId, input.memberId, expectedQuote)) {
    throw new OperatorMembershipError("The membership terms or offer changed. Review them again before accepting.", 409, "review_changed");
  }
  const priceId = await validateStripeMembershipOfferPrice(commercial.offerId);
  if (commercial.stripePriceId !== priceId) throw new OperatorMembershipError("This membership price needs review before payment.");
  await validateMembershipPortalConfiguration("commitment");
  const { acceptanceId } = await acceptOperatorMembershipAgreement({ authUserId: input.authUserId, memberId: input.memberId,
    reservationId: commercial.id, authorityAccepted: true, authorityVersion: input.authorityVersion,
    origin: input.applicationOrigin, userAgent: input.userAgent,
    expectedAgreementVersion: agreement.version, expectedAgreementSha256: createHash("sha256").update(agreement.bodyText).digest("hex") });
  const reservation = await reserveMembershipCheckout({ acceptanceId, attemptId: commercial.id, commercialReservationId: commercial.id,
    authUserId: input.authUserId, operatorMemberId: input.memberId, email: member.email, plan: commercial.plan,
    stripePriceId: priceId, paidAgreementVersion: agreement.version, consentSource: "stripe_checkout" });
  const termsMessage = `I am authorized to accept the [Ruined Membership Agreement](${input.applicationOrigin}/membership/agreement/${encodeURIComponent(agreement.version)}) on behalf of this member and authorize payment and recurring renewals on my card.`;
  const stripe = getStripe();
  let session: Stripe.Checkout.Session;
  if (reservation.existingStripeSessionId) {
    session = await stripe.checkout.sessions.retrieve(reservation.existingStripeSessionId);
    if (session.status === "complete") throw new OperatorMembershipError("This payment is being confirmed. Check the member's payment status.");
    if (session.status === "expired") {
      await expireMembershipCheckoutAttempt(reservation.attemptId);
      await releaseCommercialMembershipReservation({ reservationId: commercial.id, reason: "checkout_expired" });
      throw new OperatorMembershipError("This checkout expired. Refresh the page to review a new offer.");
    }
    const metadata: Record<string, string> = { ruined_checkout_source: "operator", ruined_checkout_actor_id: input.authUserId,
      ruined_operator_authorization_id: reservation.operatorAuthorizationId!, ruined_member_id: input.memberId,
      ruined_checkout_attempt_id: reservation.attemptId, ruined_commercial_reservation_id: commercial.id,
      ruined_billing_plan: reservation.plan, ruined_price_id: reservation.stripePriceId, ruined_offer_id: reservation.offerId,
      agreement_acceptance_id: reservation.agreementAcceptanceId, agreement_version: reservation.agreementVersion,
      billing_terms_version: "membership-billing-v2", billing_consent_source: "stripe_checkout", billing_prepared_at: reservation.checkoutPreparedAt.toISOString() };
    if (session.status !== "open" || session.mode !== "subscription" || session.ui_mode !== "embedded_page" || session.livemode !== getStripeLivemode()
      || session.client_reference_id !== input.memberId || session.consent_collection?.terms_of_service !== "required"
      || session.custom_text?.terms_of_service_acceptance?.message !== termsMessage
      || session.shipping_address_collection?.allowed_countries.join(",") !== "US"
      || session.amount_subtotal !== (commercial.firstChargeAt ? 0 : expectedQuote.offer.amount) || session.currency !== expectedQuote.offer.currency
      || Object.entries(metadata).some(([key,value]) => session.metadata?.[key] !== value)
      || (session.metadata?.ruined_first_charge_at ?? null) !== (commercial.firstChargeAt?.toISOString() ?? null)
      || (session.metadata?.ruined_billing_schedule_sha256 ?? null) !== (commercial.billingSchedule ? prepaidScheduleFingerprint(commercial.billingSchedule) : null)) {
      throw new OperatorMembershipError("The existing payment does not match this administrator and member. Contact support before starting another.");
    }
  } else {
    session = await createEmbeddedMembershipSession({ stripe, reservation, email: member.email, applicationOrigin: input.applicationOrigin,
      minimumAge: config.minimumAge, termsMessage, operatorAuthUserId: input.authUserId });
    await openMembershipCheckoutAttempt({ attemptId: reservation.attemptId, expiresAt: new Date(session.expires_at * 1000), stripeSessionId: session.id });
  }
  if (!session.client_secret) throw new OperatorMembershipError("Secure payment could not be opened. Please try again.", 502);
  return { clientSecret: session.client_secret, plan: reservation.plan, commercialReservationId: commercial.id };
}
