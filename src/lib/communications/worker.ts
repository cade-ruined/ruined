import "server-only";

import {
  beginResendContactSync,
  claimNextResendOutboxEvent,
  completeResendContactSync,
  createCommunicationsWorkerId,
  getConfirmationDeliveryContext,
  markResendOutboxEventFailed,
  markResendOutboxEventSucceeded,
  releaseResendContactSync,
  type ResendOutboxEvent,
} from "@/lib/communications/outbox";
import {
  getResendConfigurationStatus,
  sendDoubleOptInConfirmationEmail,
  upsertResendContact,
} from "@/lib/communications/resend";

export type CommunicationsWorkerResult = {
  claimed: number;
  failed: number;
  processed: number;
  skipped: number;
  ready: boolean;
  missing: string[];
};

function payloadString(
  event: ResendOutboxEvent,
  key: string,
): string | null {
  const value = event.payload[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function safeFailureLabel(event: ResendOutboxEvent, error: unknown): string {
  const errorName = error instanceof Error && error.name ? error.name : "Error";
  return `${event.eventType} failed (${errorName})`;
}

async function processEvent(
  event: ResendOutboxEvent,
  workerId: string,
): Promise<"processed" | "skipped"> {
  if (event.eventType === "communication.confirmation.requested") {
    const token = payloadString(event, "confirmation_token");
    const subscriptionVersion = payloadString(event, "subscription_version");
    if (!token || !subscriptionVersion) {
      throw new Error("Confirmation event payload is incomplete.");
    }

    const context = await getConfirmationDeliveryContext(
      event.aggregateId,
      subscriptionVersion,
    );
    if (!context) return "skipped";

    await sendDoubleOptInConfirmationEmail({
      email: context.email,
      idempotencyKey: event.dedupeKey,
      token,
    });
    return "processed";
  }

  if (event.eventType === "communication.contact.sync_requested") {
    const leaseId = `${workerId}:${event.id}`;
    const syncStartedAt = new Date();
    const lease = await beginResendContactSync(
      event.aggregateId,
      leaseId,
      syncStartedAt,
    );
    if (lease.status !== "acquired") {
      if (lease.status === "missing") return "skipped";
      throw new Error("Another Resend contact sync is already running.");
    }

    const context = lease.context;
    try {
      const synced = await upsertResendContact({
        email: context.email,
        topics: context.topics,
      });
      await completeResendContactSync(
        context.contactId,
        leaseId,
        synced.contactId,
        context.topics,
        new Date(),
      );
      return "processed";
    } catch (error) {
      await releaseResendContactSync(context.contactId, leaseId);
      throw error;
    }
  }

  throw new Error("Unsupported Resend outbox event type.");
}

export async function processResendOutboxBatch(
  requestedLimit = 10,
): Promise<CommunicationsWorkerResult> {
  const configuration = getResendConfigurationStatus();
  const ready = configuration.confirmationEmailReady && configuration.contactSyncReady;
  const result: CommunicationsWorkerResult = {
    claimed: 0,
    failed: 0,
    processed: 0,
    skipped: 0,
    ready,
    missing: configuration.missing.filter((name) => name !== "RESEND_WEBHOOK_SECRET"),
  };
  if (!ready) return result;

  const limit = Math.max(1, Math.min(25, Math.trunc(requestedLimit)));
  const workerId = createCommunicationsWorkerId();

  for (let index = 0; index < limit; index += 1) {
    const event = await claimNextResendOutboxEvent(workerId);
    if (!event) break;
    result.claimed += 1;

    try {
      const outcome = await processEvent(event, workerId);
      await markResendOutboxEventSucceeded(event.id, workerId);
      result[outcome] += 1;
    } catch (error) {
      await markResendOutboxEventFailed(
        event,
        workerId,
        safeFailureLabel(event, error),
      );
      result.failed += 1;
    }
  }

  return result;
}
