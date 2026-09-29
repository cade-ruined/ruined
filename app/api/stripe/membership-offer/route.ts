import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getMemberOnboarding } from "@/lib/membership/repository";
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
import { isUuid } from "@/lib/stripe/membership-state";
import { getPaidMembershipAgreementVersion, isTrustedCheckoutOrigin, validateStripeMembershipOfferPrice } from "@/lib/stripe/server";

export const runtime = "nodejs";
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isTrustedCheckoutOrigin(request)) return response({ error: "Request origin is not allowed." }, 403);
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return response({ error: "Sign in to review your membership offer." }, 401);
    if (!getPlatformConfiguration().stripeCheckoutReady) return response({ error: "Membership payment is not available yet." }, 503);
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
    const current = await getCurrentCommercialMembershipReservation(platformUser.memberId);
    if (current && (current.kind !== body.kind || current.plan !== body.plan)) {
      try { await releaseCommercialMembershipReservation({ reservationId: current.id, reason: "before_checkout_abandoned" }); }
      catch { return response({ error: "A payment is already in progress. Resume that membership and payment plan before making a different choice.", code: "checkout_plan_locked", plan: current.plan, kind: current.kind }, 409); }
    }
    const pair = body.kind === "couple" ? await getReadyCoupleMembershipAuthorization(platformUser.memberId) : null;
    if (body.kind === "couple" && !pair) return response({ error: "Both adults must register and approve the couples membership before payment.", code: "couple_pairing_required" }, 409);
    const reservation = await reserveCommercialMembership({ requestId: body.requestId, memberId: platformUser.memberId,
      kind: body.kind, plan: body.plan, ...(pair ? { partnerMemberId: pair.partnerMemberId, coupleAuthorizationId: pair.id } : {}),
      expiresAt: new Date(Date.now() + 60 * 60_000) });
    const stripePriceId = await validateStripeMembershipOfferPrice(reservation.offerId);
    await bindCommercialMembershipPrice({ reservationId: reservation.id, stripePriceId });
    return response({ quote: { id: reservation.id, expiresAt: reservation.expiresAt.toISOString(),
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
