import "server-only";

import { Resend } from "resend";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { isAdminEmailAddress } from "./admin-email-model";
import { getMemberEmailCadenceConfiguration } from "./member-email-cadence-model";
import { CadenceDeliveryError } from "./member-email-cadence-repository";
import { reserveCadenceProviderSlot } from "./member-email-cadence-provider";
import type { CadenceDeliveryClaim, CadenceEmailPayload } from "./member-email-cadence-types";

const PROVIDER_TIMEOUT_MS = 6_000;
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1_000;
const value = (name: string) => process.env[name]?.trim() ?? "";

/** These checks read configuration only; a disabled worker never opens the database or provider. */
export function getMemberEmailCadenceDeliveryConfiguration() {
  const configuration = getMemberEmailCadenceConfiguration();
  const missing = [
    ...(!configuration.enabled ? ["MEMBER_EMAIL_CADENCE_ENABLED=true"] : []),
    ...(!configuration.ready ? ["MEMBER_EMAIL_CADENCE_ACTIVATED_AT"] : []),
    ...(getPlatformConfiguration().mode !== "connected" ? ["connected platform"] : []),
    ...(!value("RESEND_API_KEY") ? ["RESEND_API_KEY"] : []),
    ...(!value("CRON_SECRET") ? ["CRON_SECRET"] : []),
  ];
  return { ...configuration, ready: missing.length === 0, missing };
}

export function assertCadenceReplayWindow(message: CadenceDeliveryClaim) {
  if (message.attempts > 5) throw new CadenceDeliveryError("attempts_exhausted", true);
  if (message.firstAttemptAt !== null) {
    const started = new Date(message.firstAttemptAt).getTime();
    if (!Number.isFinite(started) || Date.now() - started >= REPLAY_WINDOW_MS) {
      throw new CadenceDeliveryError("uncertain_delivery_requires_manual_review", true);
    }
  }
}

export function assertCadencePayload(payload: CadenceEmailPayload, email: string) {
  const fromEmail = (payload.from.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? payload.from).trim();
  if (!isAdminEmailAddress(email) || payload.to !== email) {
    throw new CadenceDeliveryError("recipient_changed_requires_review", true);
  }
  if (!isAdminEmailAddress(fromEmail) || /[\r\n\0]/.test(payload.from)
    || !Array.isArray(payload.replyTo) || payload.replyTo.some(address => !isAdminEmailAddress(address))
    || !payload.subject.trim() || payload.subject.length > 200 || /[\r\n\0]/.test(payload.subject)
    || !payload.html.trim() || !payload.text.trim()) {
    throw new CadenceDeliveryError("saved_message_invalid", true);
  }
}

/** Exact frozen bytes and one key are reused after acknowledgement loss. */
export async function sendCadencePayload(payload: CadenceEmailPayload, deliveryId: string, deadline: number) {
  await reserveCadenceProviderSlot(deadline);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new CadenceDeliveryError("delivery_budget");
  const timeout = Math.min(PROVIDER_TIMEOUT_MS, remaining);
  const client = new Resend(value("RESEND_API_KEY"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      client.emails.send(payload, { idempotencyKey: `cadence:${deliveryId}` }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CadenceDeliveryError("provider_timeout")), timeout);
      }),
    ]);
    if (response.error || !response.data?.id) {
      const status = response.error?.statusCode;
      const retryable = !status || status === 408 || status === 429 || status >= 500
        || response.error?.name === "concurrent_idempotent_requests";
      throw new CadenceDeliveryError(status ? `provider_http_${status}` : "provider_unavailable", !retryable);
    }
    return response.data.id;
  } catch (error) {
    if (error instanceof CadenceDeliveryError) throw error;
    throw new CadenceDeliveryError("provider_unavailable");
  } finally {
    clearTimeout(timer);
  }
}
