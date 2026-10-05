import "server-only";

import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getOpsWorkQueue } from "@/lib/platform/ops-operating-repository";
import { SUPPORT_EMAIL } from "@/lib/support/model";
import { createWorkQueueDigestEmail } from "./work-queue-digest-email";
import {
  digestReplayExpired, workQueueDigestTimezone, WorkQueueDigestError,
  WORK_QUEUE_DIGEST_MAX_ATTEMPTS, WORK_QUEUE_DIGEST_RECIPIENT, WORK_QUEUE_DIGEST_SITE,
  type WorkQueueDigestClaim, type WorkQueueDigestPayload,
} from "./work-queue-digest-model";
import {
  claimWorkQueueDigest, completeWorkQueueDigest, enqueueWorkQueueDigests, failWorkQueueDigest,
  getWorkQueueDigestHealth, preserveWorkQueueDigest, withWorkQueueDigest,
} from "./work-queue-digest-repository";

const PROVIDER_TIMEOUT_MS = 6_000;
const BATCH_BUDGET_MS = 15_000;
const value = (name: string) => process.env[name]?.trim() ?? "";

export function getWorkQueueDigestConfiguration() {
  const enabled = value("OPERATOR_WORK_QUEUE_DIGEST_ENABLED") === "true";
  const timeZone = workQueueDigestTimezone(value("OPERATOR_WORK_QUEUE_DIGEST_TIMEZONE"));
  const from = value("RESEND_FROM_EMAIL");
  const fromEmail = (from.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? from).trim();
  let siteReady = false;
  try { siteReady = new URL(value("NEXT_PUBLIC_SITE_URL")).href === `${WORK_QUEUE_DIGEST_SITE}/`; } catch { /* Configuration is reported without exposing values. */ }
  const missing = [
    ...(!enabled ? ["OPERATOR_WORK_QUEUE_DIGEST_ENABLED=true"] : []),
    ...(process.env.NODE_ENV !== "production" || value("VERCEL_ENV") !== "production" ? ["production deployment"] : []),
    ...(getPlatformConfiguration().mode !== "connected" || value("PLATFORM_MODE").toLowerCase() === "preview" ? ["connected platform"] : []),
    ...(!value("RESEND_API_KEY") ? ["RESEND_API_KEY"] : []),
    ...(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(fromEmail) || fromEmail.length > 254 || /[\r\n]/.test(from) ? ["RESEND_FROM_EMAIL"] : []),
    ...(!siteReady ? ["production site origin"] : []),
    ...(!timeZone ? ["valid OPERATOR_WORK_QUEUE_DIGEST_TIMEZONE"] : []),
  ];
  return { enabled, ready: missing.length === 0, missing, timeZone };
}

function assertReplay(claim: WorkQueueDigestClaim, now: Date) {
  if (claim.attempts > WORK_QUEUE_DIGEST_MAX_ATTEMPTS) throw new WorkQueueDigestError("attempts_exhausted", true);
  if (digestReplayExpired(claim.firstSendAttemptAt, now.getTime())) throw new WorkQueueDigestError("uncertain_delivery_requires_manual_review", true);
}

async function sendWithTimeout(client: Resend, payload: WorkQueueDigestPayload, id: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.emails.send(payload, { idempotencyKey: `ruined-operator-work-digest/${id}` }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new WorkQueueDigestError("provider_timeout")), PROVIDER_TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Only the production cron calls this worker. Preview and disabled modes are inert. */
export async function processWorkQueueDigestBatch(requestedLimit = 5) {
  const result = { ...getWorkQueueDigestConfiguration(), queued: 0, claimed: 0, sent: 0, failed: 0, cancelled: 0, manualReview: 0, deferred: 0, remainingDue: 0 };
  if (!result.ready || !result.timeZone) return result;
  const timeZone = result.timeZone;
  const client = new Resend(value("RESEND_API_KEY"));
  const lease = randomUUID();
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(10, Math.trunc(requestedLimit))) : 5;
  const started = Date.now();
  try {
    const enqueued = await enqueueWorkQueueDigests(timeZone, new Date());
    result.queued = enqueued.queued;
    if (!enqueued.recipientReady) { result.ready = false; result.missing = ["active verified administrator recipient"]; }
    for (let index = 0; index < limit && Date.now() - started < BATCH_BUDGET_MS; index++) {
      const claim = await claimWorkQueueDigest(lease, new Date());
      if (!claim) break;
      result.claimed++;
      try {
        assertReplay(claim, new Date());
        // Read the queue before holding recipient locks. getOpsWorkQueue owns
        // its own transaction; nesting it under a lock can exhaust the pool
        // when overlapping workers wait for the same recipient.
        let candidatePayload = claim.payload;
        if (!candidatePayload && claim.recipientAuthUserId) {
          const queue = await getOpsWorkQueue(claim.recipientAuthUserId);
          candidatePayload = { from: value("RESEND_FROM_EMAIL"), to: WORK_QUEUE_DIGEST_RECIPIENT, replyTo: SUPPORT_EMAIL,
            ...createWorkQueueDigestEmail({ queue, slot: claim.slot, generatedAt: new Date().toISOString() }) };
        }
        const prepared = await withWorkQueueDigest(claim, lease, timeZone, new Date(), async (tx, current) => {
          assertReplay(current, new Date());
          const payload = current.payload ?? candidatePayload;
          if (!payload) throw new WorkQueueDigestError("saved_message_unavailable", true);
          if (payload.to !== WORK_QUEUE_DIGEST_RECIPIENT) throw new WorkQueueDigestError("saved_recipient_changed", true);
          await preserveWorkQueueDigest(tx, current.id, payload, new Date());
        });
        if (prepared.kind !== "ok") { result[prepared.kind]++; continue; }
        const sent = await withWorkQueueDigest(claim, lease, timeZone, new Date(), async (tx, current) => {
          assertReplay(current, new Date());
          if (!current.firstSendAttemptAt || !current.payload || current.payload.to !== WORK_QUEUE_DIGEST_RECIPIENT) {
            throw new WorkQueueDigestError("saved_message_unavailable", true);
          }
          const response = await sendWithTimeout(client, current.payload, current.id);
          if (response.error || !response.data?.id) {
            const status = response.error?.statusCode;
            const retryable = !status || status === 408 || status === 429 || status >= 500 || response.error?.name === "concurrent_idempotent_requests";
            throw new WorkQueueDigestError(status ? `provider_http_${status}` : "provider_unavailable", !retryable);
          }
          await completeWorkQueueDigest(tx, current.id, response.data.id, new Date());
        });
        if (sent.kind === "ok") result.sent++;
        else result[sent.kind]++;
      } catch (error) {
        const code = error instanceof WorkQueueDigestError ? error.code : "delivery_unavailable";
        const outcome = await failWorkQueueDigest(claim, lease, code, error instanceof WorkQueueDigestError && error.terminal, new Date());
        result[outcome]++;
        if (code === "provider_timeout") break;
      }
    }
    const health = await getWorkQueueDigestHealth(new Date());
    result.manualReview = health.manualReview;
    result.remainingDue = health.remainingDue;
  } catch {
    result.ready = false;
    result.missing = ["operator work digest worker unavailable"];
  }
  return result;
}
