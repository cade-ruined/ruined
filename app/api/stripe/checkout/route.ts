import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getMemberIdentity } from "@/lib/membership/repository";
import { MEMBERSHIP_PLANS, isMembershipBillingPlan, type MembershipBillingPlan } from "@/lib/membership/pricing";
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
import {
  getApplicationOrigin,
  getStripe,
  getPaidMembershipAgreementVersion,
  getStripeLivemode,
  validateStripeMembershipPrice,
  isStripeTaxEnabled,
  isTrustedCheckoutOrigin,
} from "@/lib/stripe/server";

export const runtime = "nodejs";

type CheckoutRequest = {
  acceptanceId?: unknown;
  attemptId?: unknown;
  plan?: unknown;
  recurringPaymentAccepted?: unknown;
};

function invalidRequest(message: string) {
  return NextResponse.json(
    { error: message },
    { headers: { "Cache-Control": "no-store" }, status: 400 },
  );
}

function clientSecretResponse(clientSecret: string, plan: MembershipBillingPlan) {
  return NextResponse.json(
    { clientSecret, plan },
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
    if (!configuration.stripeCheckoutReady) {
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
    const stripe = getStripe();
    const priceId = await validateStripeMembershipPrice(plan);
    const paidAgreementVersion = getPaidMembershipAgreementVersion();
    const applicationOrigin = getApplicationOrigin(new URL(request.url).origin);
    const email = normalizeEmail(viewer.email);
    const reserve = (attemptId: string) => reserveMembershipCheckout({
      acceptanceId, attemptId, authUserId: viewer.authUserId, email,
      plan, stripePriceId: priceId, paidAgreementVersion,
    });
    let reservation = await reserve(checkoutAttemptId);

    // A competing tab may reserve a replacement while this request resolves an
    // expired remote Session. Always re-check the reservation before creating.
    for (let resolved = 0; reservation.existingStripeSessionId; resolved++) {
      if (resolved >= 3) throw new MembershipCheckoutConflictError();
      const existingSession = await stripe.checkout.sessions.retrieve(reservation.existingStripeSessionId);
      if (existingSession.status === "complete") {
        return NextResponse.json(
          { error: "This membership payment is already being confirmed." },
          { headers: { "Cache-Control": "no-store" }, status: 409 },
        );
      }
      if (existingSession.status === "expired") {
        await expireMembershipCheckoutAttempt(reservation.attemptId);
        reservation = await reserve(crypto.randomUUID());
        continue;
      }
      if (reservation.plan !== plan) throw new MembershipCheckoutPlanConflictError(reservation.plan);
      const expected = MEMBERSHIP_PLANS[reservation.plan];
      if (
        reservation.memberId === platformUser.memberId &&
        existingSession.status === "open" &&
        existingSession.mode === "subscription" &&
        existingSession.livemode === getStripeLivemode() &&
        existingSession.ui_mode === "embedded_page" &&
        existingSession.metadata?.ruined_member_id === reservation.memberId &&
        existingSession.metadata?.ruined_billing_plan === reservation.plan &&
        existingSession.metadata?.ruined_price_id === reservation.stripePriceId &&
        existingSession.metadata?.agreement_acceptance_id === reservation.agreementAcceptanceId &&
        existingSession.amount_subtotal === expected.amount &&
        existingSession.currency === expected.currency &&
        existingSession.client_secret
      ) {
        return clientSecretResponse(existingSession.client_secret, reservation.plan);
      }
      // Do not expire an in-flight payment to satisfy a different tab/plan.
      throw new MembershipCheckoutConflictError();
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
      billing_terms_version: "membership-billing-v1",
      age_policy_minimum: String(configuration.minimumAge),
    };

    const session = await stripe.checkout.sessions.create(
      {
        automatic_tax: { enabled: isStripeTaxEnabled() },
        billing_address_collection: "required",
        client_reference_id: reservation.memberId,
        customer_email: email,
        integration_identifier: "ruined_my_qvksnctb",
        line_items: [{ price: priceId, quantity: 1 }],
        metadata,
        mode: "subscription",
        origin_context: "web",
        payment_method_collection: "always",
        redirect_on_completion: "always",
        return_url: `${applicationOrigin}/my/join/complete?session_id={CHECKOUT_SESSION_ID}`,
        subscription_data: { billing_mode: { type: "flexible" }, metadata },
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

    return clientSecretResponse(session.client_secret, reservation.plan);
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
