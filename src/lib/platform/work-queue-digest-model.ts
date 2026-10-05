import { zonedDateTimeLocalToIso, zonedDateTimeLocalValue } from "@/lib/datetime/zoned-date-time";

export const WORK_QUEUE_DIGEST_RECIPIENT = "libby@theruinedproject.com";
export const WORK_QUEUE_DIGEST_SITE = "https://members.theruinedproject.com";
export const WORK_QUEUE_DIGEST_MAX_ATTEMPTS = 5;
export const WORK_QUEUE_DIGEST_REPLAY_MS = 23 * 60 * 60 * 1000;
export type WorkQueueDigestTimezone = "America/Denver" | "Etc/GMT+7";
export type WorkQueueDigestSlot = {
  localDate: string;
  localHour: 10 | 15;
  timeZone: WorkQueueDigestTimezone;
  scheduledFor: string;
};
export type WorkQueueDigestPayload = { from: string; to: string; replyTo: string; subject: string; html: string; text: string };
export type WorkQueueDigestClaim = {
  id: string;
  recipientAuthUserId: string | null;
  recipientEmail: string;
  attempts: number;
  firstSendAttemptAt: Date | string | null;
  payload: WorkQueueDigestPayload | null;
  slot: WorkQueueDigestSlot;
};

export function workQueueDigestTimezone(value?: string | null): WorkQueueDigestTimezone | null {
  const normalized = value?.trim() || "America/Denver";
  return normalized === "America/Denver" || normalized === "Etc/GMT+7" ? normalized : null;
}

/** Only open a new slot for 30 minutes after its scheduled time. Existing
 * deliveries have a separate durable retry lifecycle. Cold starts do not backfill. */
export function dueWorkQueueDigestSlots(now: Date, timeZone: WorkQueueDigestTimezone): WorkQueueDigestSlot[] {
  if (!Number.isFinite(now.getTime())) return [];
  const localDate = zonedDateTimeLocalValue(now.toISOString(), timeZone).slice(0, 10);
  return ([10, 15] as const).flatMap((localHour) => {
    const scheduledFor = zonedDateTimeLocalToIso(`${localDate}T${localHour}:00`, timeZone)!;
    const age = now.getTime() - Date.parse(scheduledFor);
    return age >= 0 && age < 30 * 60_000 ? [{ localDate, localHour, timeZone, scheduledFor }] : [];
  });
}

export function digestReplayExpired(firstSendAttemptAt: Date | string | null, now = Date.now()): boolean {
  if (firstSendAttemptAt === null) return false;
  const first = new Date(firstSendAttemptAt).getTime();
  return !Number.isFinite(first) || now - first >= WORK_QUEUE_DIGEST_REPLAY_MS;
}

export class WorkQueueDigestError extends Error {
  constructor(readonly code: string, readonly terminal = false) { super(code); }
}
