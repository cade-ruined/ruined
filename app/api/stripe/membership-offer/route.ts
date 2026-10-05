import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getMemberOnboarding } from "@/lib/membership/repository";
import { getMembershipFirstChargeAt } from "@/lib/membership/paid-launch";
import { isMembershipCohortPrepaymentEnabled } from "@/lib/membership/cohort-prepayment";
import { createFoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import { getPublishedMembershipAgreement } from "@/lib/membership/published-agreement";
import {
  bindCommercialMembershipPrice,
  CommercialMembershipError,
  getCurrentCommercialMembershipReservation,
  getReadyCoupleMembershipAuthorization,
  releaseCommercialMembershipReservation,
  reserveCommercialMembership,
} from "@/lib/membership/commercial-repository";
import { isMembershipBillingPlan, MEMBERSHIP_OFFERS } from "@/lib/membership/pricing";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { PlatformAccessDeniedError, requireActivePlatformMemberLink } from "@/lib/platform/repository";
import { getMembershipCheckoutForReservation, expireMembershipCheckoutAttempt } from "@/lib/stripe/billing-repository";
import { isUuid } from "@/lib/stripe/membership-state";
import { getPaidMembershipAgreementVersion, getStripe, getStripeLivemode, isTrustedCheckoutOrigin, validateStripeMembershipOfferPrice } from "@/lib/stripe/server";

export const runtime = "nodejs";
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isTrustedCheckoutOrigin(request)) return response({ error: "Request origin is not allowed." }, 403);
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return response({ error: "Sign in to review your membership offer." }, 401);
    const configuration = getPlatformConfiguration();
    if (!configuration.stripeCheckoutReady && !configuration.stripeActivationReady) return response({ error: "Membership payment is not available yet." }, 503);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "Choose your membership and payment plan." }, 400);
    const platformUser = await requireActivePlatformMemberLink(viewer);
    if (body.action === "release") {
      if (!isUuid(body.reservationId) || Object.keys(body).some(key => !["action", "reservationId"].includes(key))) return response({ error: "A valid offer is required." }, 400);
      const existing = await getCurrentCommercialMembershipReservation(platformUser.memberId);
      if (!existing || existing.id !== body.reservationId) return response({ error: "This offer is no longer current." }, 409);
      await releaseCommercialMembershipReservation({ reservationId: existing.id, reason: "before_checkout_abandoned" });
      return response({ released: true });
    }
    if (Object.keys(body).some(key => !["requestId", "kind", "plan"].includes(key)) ||
      !isUuid(body.requestId) || !isMembershipBillingPlan(body.plan) || !["individual", "couple"].includes(body.kind)) {
      return response({ error: "Choose your membership and payment plan." }, 400);
    }
    const onboarding = await getMemberOnboarding(viewer.authUserId);
    if (!onboarding?.requiredFieldsComplete || onboarding.profile.fulfillmentAddress?.countryCode !== "US") {
      return response({ error: "Paid membership is available to United States members. Complete your US address in your profile before continuing.", code: "membership_us_required" }, 409);
    }
    if (onboarding.membershipFunding === "operator" || onboarding.membershipFunding === "complimentary") return response({ error: "Your complimentary membership does not require payment." }, 409);
    const agreementVersion = getPaidMembershipAgreementVersion();
    if (!/^ruined_membership-v([2-9]|[1-9]\d+)$/.test(agreementVersion) || !await getPublishedMembershipAgreement(agreementVersion)) return response({ error: "The paid membership agreement is not available yet." }, 503);
    let current = await getCurrentCommercialMembershipReservation(platformUser.memberId);
    if (current?.billingSchedule && Date.parse(current.billingSchedule.cutoffAt) <= Date.now()) {
      const attempt = await getMembershipCheckoutForReservation(current.id, platformUser.memberId);
      let terminated = !attempt || ["expired", "failed"].includes(attempt.status);
      if (!terminated && attempt?.stripeSessionId) {
        const stripe = getStripe();
        let session = await stripe.checkout.sessions.retrieve(attempt.stripeSessionId);
        if (session.livemode !== getStripeLivemode() || session.metadata?.ruined_commercial_reservation_id !== current.id
          || session.metadata.ruined_member_id !== platformUser.memberId) return response({ error: "This payment needs review before another offer can be opened." }, 409);
        if (session.status === "open") session = await stripe.checkout.sessions.expire(session.id);
        if (session.status === "expired") { await expireMembershipCheckoutAttempt(attempt.id); terminated = true; }
      }
      if (!terminated) return response({ error: "Your earlier payment is being confirmed. Refresh its billing status before starting another membership.", code: "checkout_plan_locked" }, 409);
      await releaseCommercialMembershipReservation({ reservationId: current.id, reason: attempt ? "checkout_expired" : "before_checkout_abandoned" });
      if (current.id === body.requestId) return response({ error: "This group's enrollment cutoff has passed. Review the next Foundations group and its billing dates.", code: "membership_offer_expired" }, 409);
      current = null;
    }
    if (current?.firstChargeAt && current.firstChargeAt.getTime() <= Date.now() + 31 * 60_000) {
      const attempt = await getMembershipCheckoutForReservation(current.id, platformUser.memberId);
      let terminated = !attempt || ["expired", "failed"].includes(attempt.status);
      if (!terminated && attempt?.stripeSessionId) {
        const session = await getStripe().checkout.sessions.retrieve(attempt.stripeSessionId);
        if (session.status === "expired" && session.livemode === getStripeLivemode() &&
          session.metadata?.ruined_commercial_reservation_id === current.id &&
          session.metadata?.ruined_member_id === platformUser.memberId) {
          await expireMembershipCheckoutAttempt(attempt.id);
          terminated = true;
        }
      }
      if (terminated) {
        await releaseCommercialMembershipReservation({ reservationId: current.id, reason: attempt ? "checkout_expired" : "before_checkout_abandoned" });
        if (current.id === body.requestId) return response({ error: "The old offer is closed. Review a new membership offer.", code: "membership_offer_expired" }, 409);
        current = null;
      } else {
        return response({ error: "Your earlier Checkout is still being confirmed. Refresh its status before starting another membership.", code: "checkout_plan_locked" }, 409);
      }
    }
    if (current && (current.kind !== body.kind || current.plan !== body.plan)) {
      try { await releaseCommercialMembershipReservation({ reservationId: current.id, reason: "before_checkout_abandoned" }); }
      catch { return response({ error: "A payment is already in progress. Resume that membership and payment plan before making a different choice.", code: "checkout_plan_locked", plan: current.plan, kind: current.kind }, 409); }
    }
    const pair = body.kind === "couple" ? await getReadyCoupleMembershipAuthorization(platformUser.memberId) : null;
    if (body.kind === "couple" && !pair) return response({ error: "Both adults must register and approve the couples membership before payment.", code: "couple_pairing_required" }, 409);
    const now = new Date();
    const prepaid = isMembershipCohortPrepaymentEnabled();
    if (prepaid && !/^ruined_membership-v([3-9]|[1-9]\d+)$/.test(agreementVersion)) return response({ error: "The prepaid membership agreement is not published yet." }, 503);
    const billingSchedule = prepaid ? createFoundationsBillingSchedule(now, body.plan) : null;
    const firstChargeAt = prepaid ? null : getMembershipFirstChargeAt(now);
    if (firstChargeAt) {
      const months = body.plan === "annual" ? 12 : 1;
      const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months + 1, 0)).getUTCDate();
      const intervalEnd = new Date(now);
      intervalEnd.setUTCDate(1);
      intervalEnd.setUTCMonth(intervalEnd.getUTCMonth() + months);
      intervalEnd.setUTCDate(Math.min(now.getUTCDate(), lastDay));
      if (firstChargeAt >= intervalEnd || firstChargeAt.getTime() <= now.getTime() + 32 * 60_000) {
        return response({ error: "The scheduled billing window is unavailable. Please return after membership billing begins.", code: "membership_billing_window_unavailable" }, 409);
      }
    }
    const reservation = await reserveCommercialMembership({ requestId: body.requestId, memberId: platformUser.memberId,
      kind: body.kind, plan: body.plan, ...(pair ? { partnerMemberId: pair.partnerMemberId, coupleAuthorizationId: pair.id } : {}),
      firstChargeAt, billingSchedule, expiresAt: new Date(Math.min(now.getTime() + 60 * 60_000,
        firstChargeAt ? firstChargeAt.getTime() - 60_000 : Infinity, billingSchedule ? Date.parse(billingSchedule.cutoffAt) : Infinity)) });
    if (reservation.firstChargeAt && reservation.firstChargeAt.getTime() <= Date.now() + 31 * 60_000) {
      return response({ error: "This scheduled offer has expired. Review a new offer after billing begins.", code: "membership_offer_expired" }, 409);
    }
    const stripePriceId = await validateStripeMembershipOfferPrice(reservation.offerId);
    await bindCommercialMembershipPrice({ reservationId: reservation.id, stripePriceId });
    return response({ quote: { id: reservation.id, expiresAt: reservation.expiresAt.toISOString(), firstChargeAt: reservation.firstChargeAt?.toISOString() ?? null,
      billingSchedule: reservation.billingSchedule ?? null,
      offer: MEMBERSHIP_OFFERS[reservation.offerId], billingTermsVersion: "membership-billing-v2", buyoutCap: 150_000,
      participants: reservation.participants.map(participant => ({ memberId: participant.memberId, name: participant.name })),
    } });
  } catch (error) {
    if (error instanceof PlatformAccessDeniedError) return response({ error: "A registered member account is required." }, 403);
    if (error instanceof CommercialMembershipError && error.code === "founding_place_pending") {
      return response({ error: error.message, code: error.code, retryable: true }, 409);
    }
    console.error("Membership offer could not be prepared", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return response({ error: "Your offer could not be prepared. An existing payment or membership may need to be resolved before changing plans.", code: "membership_offer_unavailable" }, 409);
  }
}
