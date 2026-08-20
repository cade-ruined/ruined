import { NextResponse } from "next/server";

import {
  STRIPE_API_VERSION,
  getStripe,
  getStripeWebhookSecret,
} from "@/lib/stripe/server";
import { processStripeWebhookEvent } from "@/lib/stripe/webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  const rawBody = await request.text();
  let event;

  try {
    event = getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      getStripeWebhookSecret(),
    );
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  if (event.api_version !== STRIPE_API_VERSION) {
    console.error("Stripe webhook API version mismatch", {
      eventApiVersion: event.api_version,
      expectedApiVersion: STRIPE_API_VERSION,
    });
    return NextResponse.json(
      { error: "Unsupported Stripe event API version." },
      { status: 400 },
    );
  }

  try {
    const result = await processStripeWebhookEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    console.error("Stripe webhook processing failed", {
      eventId: event.id,
      eventType: event.type,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
