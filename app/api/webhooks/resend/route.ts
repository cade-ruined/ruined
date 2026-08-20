import { NextResponse } from "next/server";

import {
  applyResendContactPreferencesWebhook,
  applyResendDeliveryWebhook,
} from "@/lib/communications/repository";
import {
  getResendContactPreferenceState,
  getResendConfigurationStatus,
  verifyResendWebhook,
} from "@/lib/communications/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_LENGTH = 1_048_576;

function eventDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Webhook date is invalid.");
  return date;
}

function firstRecipient(recipients: string[]): string {
  const recipient = recipients[0]?.trim();
  if (!recipient) throw new Error("Webhook recipient is missing.");
  return recipient;
}

export async function POST(request: Request) {
  const configuration = getResendConfigurationStatus();
  if (!configuration.webhookVerificationReady) {
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const svixId = request.headers.get("svix-id")?.trim() ?? "";
  let event;
  try {
    event = verifyResendWebhook(rawBody, request.headers);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const createdAt = eventDate(event.created_at);

    if (event.type === "contact.created" || event.type === "contact.updated") {
      const current = await getResendContactPreferenceState(event.data.email);
      const topics = Object.fromEntries(
        current.topics.map((topic) => [topic.topic, topic.subscription]),
      );
      const result = await applyResendContactPreferencesWebhook({
        svixId,
        eventType: event.type,
        eventCreatedAt: createdAt,
        resendContactId: current.contactId,
        email: current.email,
        globallyUnsubscribed: current.globallyUnsubscribed,
        topics,
      });
      return NextResponse.json({ received: true, result });
    }

    if (
      event.type === "email.bounced"
      || event.type === "email.complained"
      || event.type === "email.suppressed"
    ) {
      const deliveryState = event.type === "email.bounced"
        ? "bounced"
        : event.type === "email.complained"
          ? "complained"
          : "suppressed";
      const result = await applyResendDeliveryWebhook({
        svixId,
        eventType: event.type,
        eventCreatedAt: createdAt,
        externalObjectId: event.data.email_id,
        email: firstRecipient(event.data.to),
        deliveryState,
        withdrawConsent: event.type === "email.complained",
      });
      return NextResponse.json({ received: true, result });
    }

    if (event.type === "suppression.added" || event.type === "suppression.removed") {
      const removed = event.type === "suppression.removed";
      const deliveryState = removed
        ? "active"
        : event.data.origin === "bounce"
          ? "bounced"
          : event.data.origin === "complaint"
            ? "complained"
            : "suppressed";
      const result = await applyResendDeliveryWebhook({
        svixId,
        eventType: event.type,
        eventCreatedAt: createdAt,
        externalObjectId: event.data.id,
        email: event.data.email,
        deliveryState,
        withdrawConsent: !removed && event.data.origin === "complaint",
      });
      return NextResponse.json({ received: true, result });
    }

    return NextResponse.json({ received: true, ignored: true });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    console.error("Resend webhook processing failed.", { name, svixId });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
