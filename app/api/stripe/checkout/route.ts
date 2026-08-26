import { NextResponse } from "next/server";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import {
  PlatformAccessDeniedError,
  requireActivePlatformMemberLink,
} from "@/lib/platform/repository";
import {
  MembershipCheckoutConflictError,
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
  getMembershipAgreementVersion,
  getStripe,
  getStripeMembershipPriceId,
  isStripeTaxEnabled,
  isTrustedCheckoutOrigin,
} from "@/lib/stripe/server";

export const runtime = "nodejs";

type CheckoutRequest = {
  ageConfirmed?: unknown;
  agreementAccepted?: unknown;
  attemptId?: unknown;
};

function invalidRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
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

  const checkoutAttemptId = typeof body.attemptId === "string" ? body.attemptId : null;

  if (!isUuid(checkoutAttemptId)) {
    return invalidRequest("Start a new checkout attempt and try again.");
  }

  if (body.ageConfirmed !== true) {
    return invalidRequest("You must confirm the current minimum-age policy.");
  }

  if (body.agreementAccepted !== true) {
    return invalidRequest("You must accept the membership terms and privacy policy.");
  }

  try {
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
    const agreementVersion = getMembershipAgreementVersion();
    const priceId = getStripeMembershipPriceId();
    const applicationOrigin = getApplicationOrigin(new URL(request.url).origin);
    const email = normalizeEmail(viewer.email);
    const acceptedAt = new Date();
    let reservation = await reserveMembershipCheckout({
      agreementAcceptedAt: acceptedAt,
      agreementVersion,
      ageAttestedAt: acceptedAt,
      attemptId: checkoutAttemptId,
      authUserId: viewer.authUserId,
      email,
      minimumAge: configuration.minimumAge,
    });

    if (reservation.memberId !== platformUser.memberId) {
      throw new Error("The verified account does not match the billing member.");
    }

    if (reservation.existingStripeSessionId) {
      const existingSession = await stripe.checkout.sessions.retrieve(
        reservation.existingStripeSessionId,
      );

      if (existingSession.status === "open" && existingSession.url) {
        return NextResponse.json({ checkoutUrl: existingSession.url });
      }

      if (existingSession.status === "complete") {
        return NextResponse.json(
          { error: "This membership payment is already being confirmed." },
          { status: 409 },
        );
      }

      await expireMembershipCheckoutAttempt(reservation.attemptId);
      const replacementAttemptId =
        reservation.attemptId === checkoutAttemptId ? crypto.randomUUID() : checkoutAttemptId;
      reservation = await reserveMembershipCheckout({
        agreementAcceptedAt: acceptedAt,
        agreementVersion,
        ageAttestedAt: acceptedAt,
        attemptId: replacementAttemptId,
        authUserId: viewer.authUserId,
        email,
        minimumAge: configuration.minimumAge,
      });
    }

    const metadata = {
      ruined_context: MEMBERSHIP_CONTEXT,
      ruined_offer: MEMBERSHIP_OFFER,
      ruined_member_id: reservation.memberId,
      ruined_checkout_attempt_id: reservation.attemptId,
      agreement_version: reservation.agreementVersion,
      agreement_accepted_at: reservation.agreementAcceptedAt.toISOString(),
      age_attested_at: reservation.ageAttestedAt.toISOString(),
      age_policy_minimum: String(configuration.minimumAge),
    };

    const session = await stripe.checkout.sessions.create(
      {
        automatic_tax: { enabled: isStripeTaxEnabled() },
        billing_address_collection: "required",
        cancel_url: `${applicationOrigin}/my/join`,
        client_reference_id: reservation.memberId,
        customer_email: email,
        integration_identifier: "ruined_my_qvksnctb",
        line_items: [{ price: priceId, quantity: 1 }],
        metadata,
        mode: "subscription",
        origin_context: "web",
        payment_method_collection: "always",
        subscription_data: { metadata },
        success_url: `${applicationOrigin}/my/join/complete`,
      },
      {
        idempotencyKey: `ruined-membership:${reservation.attemptId}:${reservation.agreementVersion}`,
      },
    );

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL.");
    }

    await openMembershipCheckoutAttempt({
      attemptId: reservation.attemptId,
      expiresAt: new Date(session.expires_at * 1_000),
      stripeSessionId: session.id,
    });

    return NextResponse.json({ checkoutUrl: session.url });
  } catch (error) {
    if (error instanceof PlatformAccessDeniedError) {
      return NextResponse.json(
        { error: "An active invited member account is required before Checkout." },
        { status: 403 },
      );
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
