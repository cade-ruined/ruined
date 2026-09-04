// Resend retains idempotency keys for 24 hours. Keep a one-hour safety margin.
// A known rejection can be retried later; an ambiguous send cannot safely be
// replayed after this window, even if the scheduled worker runs only daily.
export const SUPPORT_EMAIL_REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;
export const SUPPORT_EMAIL_MAX_ATTEMPTS = 5;

export type SupportDeliveryRow = {
  status: "pending" | "processing" | "sent" | "failed" | "dead_letter";
  attempts: number;
  first_attempt_at: Date | string | null;
  available_at?: Date | string | null;
  locked_at?: Date | string | null;
  last_error: string | null;
};

export function supportDeliveryMayHaveBeenSent(row: SupportDeliveryRow): boolean {
  if (row.status === "sent") return true;
  if (row.last_error?.startsWith("not_sent:")) return false;
  // Never reinterpret a legacy attempted delivery as safely unsent.
  return row.status !== "pending" || row.attempts > 0 || row.first_attempt_at !== null || row.last_error !== null;
}

export function supportDeliveryReplayExpired(row: SupportDeliveryRow, now = Date.now()): boolean {
  if (!supportDeliveryMayHaveBeenSent(row)) return false;
  const firstAttempt = row.first_attempt_at === null ? NaN : new Date(row.first_attempt_at).getTime();
  return !Number.isFinite(firstAttempt) || now - firstAttempt >= SUPPORT_EMAIL_REPLAY_WINDOW_MS;
}

export function supportDeliveryState(row: SupportDeliveryRow, now = Date.now()) {
  if (row.status === "sent") return {
    key: "accepted", label: "Accepted by email provider", description: "This confirms acceptance, not inbox delivery.", canRetry: false, needsReview: false,
  } as const;
  const uncertain = supportDeliveryMayHaveBeenSent(row);
  if (uncertain && (row.status === "dead_letter" || row.attempts >= SUPPORT_EMAIL_MAX_ATTEMPTS || supportDeliveryReplayExpired(row, now))) return {
    key: "review_delivery", label: "Review delivery", description: "The email may have been sent. Check Resend before contacting the recipient again; automatic resend is held to avoid a duplicate.", canRetry: false, needsReview: true,
  } as const;
  if (row.status === "dead_letter") return {
    key: "not_sent", label: "Not sent", description: "The provider did not accept this email. Correct the sender, recipient, or provider issue, then retry.", canRetry: !uncertain, needsReview: true,
  } as const;
  if (row.status === "failed") return {
    key: "retry_scheduled", label: uncertain ? "Confirmation pending" : "Retry scheduled",
    description: uncertain ? "The provider may have accepted this email. A retry can confirm it only inside the protected replay window." : "The email was not accepted. The worker will retry when it next runs.",
    canRetry: !uncertain, needsReview: false,
  } as const;
  if (row.status === "processing") return {
    key: "sending", label: "Sending", description: "Waiting for the email provider to confirm acceptance.", canRetry: false, needsReview: false,
  } as const;
  return { key: "queued", label: "Queued", description: "Saved and waiting for the email worker.", canRetry: false, needsReview: false } as const;
}

export function supportDeliveryNeedsReview(row: SupportDeliveryRow, now = Date.now()): boolean {
  return supportDeliveryState(row, now).needsReview;
}
