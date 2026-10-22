import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getMemberIdentity } from "@/lib/membership/repository";
import { getCommercialMembershipReservation, releaseCommercialMembershipReservation } from "@/lib/membership/commercial-repository";
import { getPublishedMembershipAgreement } from "@/lib/membership/published-agreement";
import { parseFoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import { prepaidScheduleFingerprint } from "@/lib/stripe/prepaid-policy";
import { MEMBERSHIP_OFFERS, isMembershipBillingPlan, type MembershipBillingPlan } from "@/lib/membership/pricing";
import { getPlatformConfiguration } from "@/lib/platform/config";
import {
  PlatformAccessDeniedError,
  requireActivePlatformMemberLink,
} from "@/lib/platform/repository";
import {
  MembershipCheckoutConflictError,
  MembershipCheckoutPlanConflictError,
  expireMembershipCheckoutAttempt,
  openMembershipCheckoutAttempt,
  reserveMembershipCheckout,
} from "@/lib/stripe/billing-repository";
import {
  isUuid,
  normalizeEmail,
} from "@/lib/stripe/membership-state";
import { validateMembershipPortalConfiguration } from "@/lib/stripe/portal";
import {
  getApplicationOrigin,
  getStripe,
  getPaidMembershipAgreementVersion,
  getStripeLivemode,
  validateStripeMembershipOfferPrice,
  isTrustedCheckoutOrigin,
} from "@/lib/stripe/server";

import { createEmbeddedMembershipSession } from "@/lib/stripe/checkout-session";

export const runtime = "nodejs";

type CheckoutRequest = {
  acceptanceId?: unknown;
  attemptId?: unknown;
  plan?: unknown;
  recurringPaymentAccepted?: unknown;
  consentSource?: unknown;
  commercialReservationId?: unknown;
  firstChargeAt?: unknown;
  billingSchedule?: unknown;
};

function invalidRequest(message: string) {
  return NextResponse.json(
    { error: message },
    { headers: { "Cache-Control": "no-store" }, status: 400 },
  );
}

function clientSecretResponse(clientSecret: string, plan: MembershipBillingPlan, commercialReservationId: string) {
  return NextResponse.json(
    { clientSecret, plan, commercialReservationId },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isTrustedCheckoutOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  let body: CheckoutRequest;

  try {
    body = (await request.json()) as CheckoutRequest;
  } catch {
    return invalidRequest("A valid checkout request is required.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalidRequest("A valid checkout request is required.");
  }

  const checkoutAttemptId = typeof body.attemptId === "string" ? body.attemptId : null;
  const acceptanceId = typeof body.acceptanceId === "string" ? body.acceptanceId : null;

  if (!isUuid(checkoutAttemptId) || !isUuid(acceptanceId)) {
    return invalidRequest("Start a new checkout attempt and try again.");
  }

  if (!isMembershipBillingPlan(body.plan)) {
    return invalidRequest("Choose monthly or annual membership.");
  }
  const plan = body.plan;
  const consentSource = body.consentSource === "stripe_checkout" ? "stripe_checkout" : "member";
  if (body.consentSource !== undefined && body.consentSource !== "stripe_checkout") return invalidRequest("Invalid payment confirmation method.");
  if (consentSource === "member" && body.recurringPaymentAccepted !== true) {
    return NextResponse.json({ error: "Confirm the recurring payment amount before continuing.", code: "billing_consent_required" }, { status: 400 });
  }

  try {
    const fundingViewer = await getCurrentPlatformViewer();
    const funding = fundingViewer ? (await getMemberIdentity(fundingViewer.authUserId))?.membershipFunding : null;
    if (funding === "operator" || funding === "complimentary") {
      return NextResponse.json({ error: "Your membership is complimentary. Return to membership entry to activate it." }, { status: 409 });
    }
    const configuration = getPlatformConfiguration();
    if (!configuration.stripeCheckoutReady && !configuration.stripeActivationReady) {
      return NextResponse.json(
        { error: "Membership checkout is not configured yet." },
        { status: 503 },
      );
    }

    const viewer = await getCurrentPlatformViewer();
    if (!viewer) {
      return NextResponse.json(
        { error: "Passwordless account access is required before Checkout." },
        { status: 401 },
      );
    }
    const platformUser = await requireActivePlatformMemberLink(viewer);
    const commercialReservationId = typeof body.commercialReservationId === "string" ? body.commercialReservationId : null;
    if (!isUuid(commercialReservationId) || commercialReservationId !== checkoutAttemptId) {
      return invalidRequest("Review your membership offer before authorizing payment.");
    }
    const commercial = await getCommercialMembershipReservation(commercialReservationId);
    if (!commercial || commercial.memberId !== platformUser.memberId || commercial.plan !== plan || commercial.status !== "reserved") {
      throw new MembershipCheckoutConflictError();
    }
    const firstChargeAt = commercial.firstChargeAt ?? null;
    const billingSchedule = commercial.billingSchedule ?? null;
    const consentedSchedule = body.billingSchedule == null ? null : parseFoundationsBillingSchedule(body.billingSchedule, plan);
    if (billingSchedule ? !consentedSchedule || prepaidScheduleFingerprint(billingSchedule) !== prepaidScheduleFingerprint(consentedSchedule)
      : body.billingSchedule != null) {
      return NextResponse.json({ error: "Review your Foundations group, payment today and next charge date before continuing.", code: "billing_date_consent_required" }, { status: 409 });
    }
    if (billingSchedule && Date.now() >= Date.parse(billingSchedule.cutoffAt)) {
      return NextResponse.json({ error: "Enrollment for this group has closed. Review the next Foundations group before paying.", code: "membership_offer_expired" }, { status: 409 });
    }
    if ((firstChargeAt?.toISOString() ?? null) !== (body.firstChargeAt ?? null)) {
      return NextResponse.json({ error: "Review and confirm the first payment date shown in your membership offer.", code: "billing_date_consent_required" }, { status: 409 });
    }
    const stripe = getStripe();
    const priceId = await validateStripeMembershipOfferPrice(commercial.offerId);
    if (commercial.stripePriceId !== priceId) throw new MembershipCheckoutConflictError();
    const paidAgreementVersion = getPaidMembershipAgreementVersion();
    if ((billingSchedule && !/^ruined_membership-v([3-9]|[1-9]\d+)$/.test(paidAgreementVersion)) || !/^ruined_membership-v([2-9]|[1-9]\d+)$/.test(paidAgreementVersion) || !await getPublishedMembershipAgreement(paidAgreementVersion)) {
      throw new Error("The paid membership agreement is not published.");
    }
    await validateMembershipPortalConfiguration("commitment");
    const applicationOrigin = getApplicationOrigin(new URL(request.url).origin);
    const email = normalizeEmail(viewer.email);
    const reserve = (attemptId: string) => reserveMembershipCheckout({
      acceptanceId, attemptId, authUserId: viewer.authUserId, email,
      plan, stripePriceId: priceId, paidAgreementVersion, commercialReservationId, consentSource,
    });
    const reservation = await reserve(checkoutAttemptId);
    const termsMessage = `I agree to the [Ruined Membership Agreement](${applicationOrigin}/membership/agreement/${encodeURIComponent(paidAgreementVersion)}).`;

    // Existing remote payment state is resolved before any replacement offer.
    // A new quote requires the member to review and consent again.
    if (reservation.existingStripeSessionId) {
      const existingSession = await stripe.checkout.sessions.retrieve(reservation.existingStripeSessionId);
      if (existingSession.status === "complete") {
        return NextResponse.json(
          { error: "This membership payment is already being confirmed." },
          { headers: { "Cache-Control": "no-store" }, status: 409 },
        );
      }
      if (existingSession.status === "expired") {
        await expireMembershipCheckoutAttempt(reservation.attemptId);
        await releaseCommercialMembershipReservation({ reservationId: commercialReservationId, reason: "checkout_expired" });
        return NextResponse.json({ error: "This payment session expired. Review a new offer before continuing.", code: "membership_offer_expired" }, { status: 409 });
      }
    if (firstChargeAt && firstChargeAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "This scheduled offer has expired. Review a new offer before confirming payment.", code: "membership_offer_expired" }, { status: 409 });
    }
      if (reservation.plan !== plan) throw new MembershipCheckoutPlanConflictError(reservation.plan);
      const expected = MEMBERSHIP_OFFERS[reservation.offerId];
      if (
        reservation.memberId === platformUser.memberId &&
        existingSession.status === "open" &&
        existingSession.mode === "subscription" &&
        existingSession.livemode === getStripeLivemode() &&
        existingSession.ui_mode === "embedded_page" &&
        existingSession.shipping_address_collection?.allowed_countries.length === 1 &&
        existingSession.shipping_address_collection.allowed_countries[0] === "US" &&
        existingSession.consent_collection?.terms_of_service === "required" &&
        existingSession.custom_text?.terms_of_service_acceptance?.message === termsMessage &&
        existingSession.metadata?.ruined_member_id === reservation.memberId &&
        existingSession.metadata?.ruined_billing_plan === reservation.plan &&
        existingSession.metadata?.billing_terms_version === "membership-billing-v2" &&
        existingSession.metadata?.ruined_offer_id === reservation.offerId &&
        existingSession.metadata?.ruined_commercial_reservation_id === reservation.commercialReservationId &&
        existingSession.metadata?.ruined_price_id === reservation.stripePriceId &&
        existingSession.metadata?.agreement_acceptance_id === reservation.agreementAcceptanceId &&
        (reservation.consentSource !== "stripe_checkout" ||
          (existingSession.metadata?.billing_consent_source === "stripe_checkout" &&
            existingSession.metadata?.billing_prepared_at === reservation.checkoutPreparedAt.toISOString())) &&
        (existingSession.metadata?.ruined_first_charge_at ?? null) === (reservation.firstChargeAt?.toISOString() ?? null) &&
        (existingSession.metadata?.ruined_billing_schedule_sha256 ?? null) === (billingSchedule ? prepaidScheduleFingerprint(billingSchedule) : null) &&
        existingSession.amount_subtotal === (reservation.firstChargeAt ? 0 : expected.amount) &&
        existingSession.currency === expected.currency &&
        existingSession.client_secret
      ) {
        return clientSecretResponse(existingSession.client_secret, reservation.plan, reservation.commercialReservationId);
      }
      // Do not expire an in-flight payment to satisfy a different tab/plan.
      throw new MembershipCheckoutConflictError();
    }

    if (firstChargeAt && firstChargeAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "This scheduled offer has expired. Review a new offer before confirming payment.", code: "membership_offer_expired" }, { status: 409 });
    }
    if (reservation.memberId !== platformUser.memberId || reservation.plan !== plan || reservation.stripePriceId !== priceId) {
      throw new MembershipCheckoutConflictError();
    }

    const session = await createEmbeddedMembershipSession({
      stripe, reservation, email, applicationOrigin, minimumAge: configuration.minimumAge, termsMessage,
    });

    if (!session.client_secret) {
      throw new Error("Stripe did not return an embedded Checkout client secret.");
    }

    await openMembershipCheckoutAttempt({
      attemptId: reservation.attemptId,
      expiresAt: new Date(session.expires_at * 1_000),
      stripeSessionId: session.id,
    });

    return clientSecretResponse(session.client_secret, reservation.plan, reservation.commercialReservationId);
  } catch (error) {
    if (error instanceof PlatformAccessDeniedError) {
      return NextResponse.json(
        { error: "A verified member signup is required before Checkout." },
        { status: 403 },
      );
    }

    if (error instanceof MembershipCheckoutPlanConflictError) {
      return NextResponse.json({
        error: `Your ${error.plan} checkout is already in progress. Resume it to avoid a second payment.`,
        code: "checkout_plan_locked", plan: error.plan,
      }, { headers: { "Cache-Control": "no-store" }, status: 409 });
    }

    if (error instanceof MembershipCheckoutConflictError) {
      if (error.code === "membership_offer_expired" && typeof body.commercialReservationId === "string") {
        await releaseCommercialMembershipReservation({ reservationId: body.commercialReservationId, reason: "before_checkout_abandoned" });
        return NextResponse.json({ error: "This offer expired. Review a new offer before continuing.", code: "membership_offer_expired" }, { status: 409 });
      }
      return NextResponse.json(
        {
          error:
            "Checkout cannot be started for this email. Contact Ruined before purchasing again.",
        },
        { status: 409 },
      );
    }

    const message = error instanceof Error ? error.message : "Unknown Stripe checkout error";
    const configurationError = message.endsWith("is not configured.");

    console.error("Stripe membership Checkout could not be created", {
      configurationError,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });

    return NextResponse.json(
      {
        error: configurationError
          ? "Membership checkout is not configured yet."
          : "Secure checkout is temporarily unavailable.",
      },
      { status: configurationError ? 503 : 502 },
    );
  }
}
