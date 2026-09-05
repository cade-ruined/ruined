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
  getStripe,
  getStripeMembershipPriceId,
  isStripeTaxEnabled,
  isTrustedCheckoutOrigin,
} from "@/lib/stripe/server";

export const runtime = "nodejs";

type CheckoutRequest = {
  acceptanceId?: unknown;
  attemptId?: unknown;
};

function invalidRequest(message: string) {
  return NextResponse.json(
    { error: message },
    { headers: { "Cache-Control": "no-store" }, status: 400 },
  );
}

function clientSecretResponse(clientSecret: string) {
  return NextResponse.json(
    { clientSecret },
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

  const checkoutAttemptId = typeof body.attemptId === "string" ? body.attemptId : null;
  const acceptanceId = typeof body.acceptanceId === "string" ? body.acceptanceId : null;

  if (!isUuid(checkoutAttemptId) || !isUuid(acceptanceId)) {
    return invalidRequest("Start a new checkout attempt and try again.");
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
    const priceId = getStripeMembershipPriceId();
    const applicationOrigin = getApplicationOrigin(new URL(request.url).origin);
    const email = normalizeEmail(viewer.email);
    let reservation = await reserveMembershipCheckout({
      acceptanceId,
      attemptId: checkoutAttemptId,
      authUserId: viewer.authUserId,
      email,
    });

    if (reservation.memberId !== platformUser.memberId) {
      throw new Error("The verified account does not match the billing member.");
    }

    if (reservation.existingStripeSessionId) {
      const existingSession = await stripe.checkout.sessions.retrieve(
        reservation.existingStripeSessionId,
      );

      if (
        reservation.existingAcceptanceMatches &&
        existingSession.status === "open" &&
        existingSession.ui_mode === "embedded_page" &&
        existingSession.client_secret
      ) {
        return clientSecretResponse(existingSession.client_secret);
      }

      if (existingSession.status === "complete") {
        return NextResponse.json(
          { error: "This membership payment is already being confirmed." },
          { status: 409 },
        );
      }

      if (existingSession.status === "open") {
        await stripe.checkout.sessions.expire(existingSession.id);
      }
      await expireMembershipCheckoutAttempt(reservation.attemptId);
      const replacementAttemptId =
        reservation.attemptId === checkoutAttemptId ? crypto.randomUUID() : checkoutAttemptId;
      reservation = await reserveMembershipCheckout({
        acceptanceId,
        attemptId: replacementAttemptId,
        authUserId: viewer.authUserId,
        email,
      });
    }

    if (!reservation.existingAcceptanceMatches) {
      await expireMembershipCheckoutAttempt(reservation.attemptId);
      reservation = await reserveMembershipCheckout({
        acceptanceId,
        attemptId: crypto.randomUUID(),
        authUserId: viewer.authUserId,
        email,
      });
    }

    const metadata = {
      ruined_context: MEMBERSHIP_CONTEXT,
      ruined_offer: MEMBERSHIP_OFFER,
      ruined_member_id: reservation.memberId,
      ruined_checkout_attempt_id: reservation.attemptId,
      agreement_acceptance_id: reservation.agreementAcceptanceId,
      agreement_content_sha256: reservation.agreementContentSha256,
      agreement_key: reservation.agreementKey,
      agreement_version: reservation.agreementVersion,
      agreement_accepted_at: reservation.agreementAcceptedAt.toISOString(),
      age_attested_at: reservation.ageAttestedAt.toISOString(),
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
        subscription_data: { metadata },
        ui_mode: "embedded_page",
      },
      {
        idempotencyKey: `ruined-membership:${reservation.attemptId}:${reservation.agreementAcceptanceId}`,
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

    return clientSecretResponse(session.client_secret);
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
