import "server-only";

import { randomUUID } from "node:crypto";
import { getMemberEmailCadenceConfiguration } from "./member-email-cadence-model";
import { assertCadencePayload, assertCadenceReplayWindow, getMemberEmailCadenceDeliveryConfiguration,
  sendCadencePayload } from "./member-email-cadence-delivery";
import { assertCadenceRecipientDeliverable } from "./member-email-cadence-provider";
import { renderCadenceEmail } from "./member-email-cadence-renderer";
import { CadenceDeliveryError, claimCadenceDelivery, completeCadenceDelivery, enqueueCadenceDeliveries,
  failCadenceDelivery, freezeCadenceDelivery, withCadenceDelivery } from "./member-email-cadence-repository";

const BATCH_BUDGET_MS = 165_000;

/** Enqueues only current, approved occurrences. This worker cannot enroll members or change their consent. */
export async function processMemberEmailCadenceBatch(requestedLimit = 100) {
  const configuration = getMemberEmailCadenceConfiguration();
  const result = { ...getMemberEmailCadenceDeliveryConfiguration(), queued: 0, claimed: 0, sent: 0,
    failed: 0, cancelled: 0, deferred: 0, manualReview: 0, skipped: null as null | "disabled" | "unconfigured" | "not_activated" };
  if (!configuration.enabled) return { ...result, skipped: "disabled" as const };
  if (!result.ready) return { ...result, skipped: "unconfigured" as const };
  if (Date.parse(configuration.activatedAt!) > Date.now()) return { ...result, skipped: "not_activated" as const };

  const deadline = Date.now() + BATCH_BUDGET_MS;
  const lease = randomUUID();
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.trunc(requestedLimit))) : 100;
  try {
    result.queued = await enqueueCadenceDeliveries(configuration);
    if (Date.now() >= deadline) return result;
    for (let index = 0; index < limit && Date.now() < deadline; index++) {
      const claim = await claimCadenceDelivery(lease);
      if (!claim) break;
      result.claimed++;
      try {
        const prepared = await withCadenceDelivery(claim, lease, async (tx, delivery) => {
          assertCadenceReplayWindow(delivery);
          const payload = delivery.payload ?? { ...await renderCadenceEmail(delivery), to: delivery.email };
          assertCadencePayload(payload, delivery.email);
          // Commit both the immutable bytes and uncertainty fence before any send.
          await freezeCadenceDelivery(tx, delivery.id, payload);
        });
        if (prepared.kind !== "ok") { result[prepared.kind]++; continue; }

        const delivered = await withCadenceDelivery(claim, lease, async (tx, delivery) => {
          assertCadenceReplayWindow(delivery);
          if (!delivery.firstAttemptAt || !delivery.payload) {
            throw new CadenceDeliveryError("saved_message_changed_requires_review", true);
          }
          assertCadencePayload(delivery.payload, delivery.email);
          const expiresAt = Date.parse(delivery.expiresAt);
          if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
            throw new CadenceDeliveryError("delivery_window_expired", true);
          }
          const dispatchDeadline = Math.min(deadline, expiresAt);
          if (Date.now() >= dispatchDeadline) throw new CadenceDeliveryError("delivery_budget");
          await assertCadenceRecipientDeliverable(delivery.email, { deadline: dispatchDeadline });
          assertCadenceReplayWindow(delivery);
          if (Date.now() >= expiresAt) throw new CadenceDeliveryError("delivery_window_expired", true);
          const providerId = await sendCadencePayload(delivery.payload, delivery.id, dispatchDeadline);
          await completeCadenceDelivery(tx, delivery.id, providerId);
        });
        if (delivered.kind === "ok") result.sent++;
        else result[delivered.kind]++;
      } catch (error) {
        const code = error instanceof CadenceDeliveryError ? error.code : "delivery_unavailable";
        const terminal = error instanceof CadenceDeliveryError && error.terminal;
        const outcome = await failCadenceDelivery(claim, lease, code, terminal);
        result[outcome]++;
        // A timed-out provider call may still complete. Never start another send in this batch.
        if (code === "provider_timeout" || code === "delivery_budget") break;
      }
    }
  } catch {
    result.ready = false;
    result.missing = ["membership email worker unavailable"];
  }
  return result;
}
