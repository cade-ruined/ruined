import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getMemberIdentity } from "@/lib/membership/repository";
import { getCommercialMembershipReservation, releaseCommercialMembershipReservation } from "@/lib/membership/commercial-repository";
import { getPublishedMembershipAgreement } from "@/lib/membership/published-agreement";
import { parseFoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import { prepaidBillingMetadata, prepaidScheduleFingerprint } from "@/lib/stripe/prepaid-policy";
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
  MEMBERSHIP_CONTEXT,
  MEMBERSHIP_OFFER,
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
  isStripeTaxEnabled,
  isTrustedCheckoutOrigin,
} from "@/lib/stripe/server";

export const runtime = "nodejs";

type CheckoutRequest = {
  acceptanceId?: unknown;
  attemptId?: unknown;
  plan?: unknown;
  recurringPaymentAccepted?: unknown;
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
  if (body.recurringPaymentAccepted !== true) {
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
      plan, stripePriceId: priceId, paidAgreementVersion, commercialReservationId,
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

    const metadata = {
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
      billing_consent_at: reservation.recurringPaymentAcceptedAt.toISOString(),
      billing_terms_version: "membership-billing-v2",
      ...(reservation.firstChargeAt ? { ruined_first_charge_at: reservation.firstChargeAt.toISOString() } : {}),
      ...(billingSchedule ? prepaidBillingMetadata(billingSchedule) : {}),
      ruined_offer_id: reservation.offerId,
      ruined_commercial_reservation_id: reservation.commercialReservationId,
      age_policy_minimum: String(configuration.minimumAge),
    };

    // The paid reservation now prevents concurrent withdrawal. Storage consent
    // only supplies a customer; this fresh Checkout still requires payment approval.
    const { getSavedPaymentMethodForCheckout } = await import("@/lib/stripe/payment-method-service");
    const savedMethod = await getSavedPaymentMethodForCheckout(reservation.memberId, reservation.attemptId);
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
        return_url: reservation.firstChargeAt || billingSchedule
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
