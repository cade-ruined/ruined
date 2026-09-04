import "server-only";

import { getGoogleCalendarConfigurationStatus } from "@/lib/google/calendar";
import { googleCommunicationLivemode } from "@/lib/google/communications";
import { getPendingCalendarReconciliations, reconcilePendingExperienceCalendar } from "@/lib/platform/ops-calendar-repository";

export async function processCalendarReconciliationBatch(requestedLimit = 1) {
  const ready = getGoogleCalendarConfigurationStatus().ready && googleCommunicationLivemode() !== null;
  const result = { ready, claimed: 0, processed: 0, failed: 0, skipped: 0 };
  if (!ready) return result;
  const startedAt = Date.now();
  const candidates = await getPendingCalendarReconciliations(requestedLimit);
  for (const candidate of candidates) {
    if (Date.now() - startedAt > 20_000) break;
    result.claimed += 1;
    try {
      const processed = await reconcilePendingExperienceCalendar(candidate);
      if (processed) result.processed += 1;
      else { result.claimed -= 1; result.skipped += 1; }
    } catch (error) {
      // Another request may have claimed this link after discovery. Provider
      // failures carry their durable retry time; interrupted calls keep a lease.
      if (error instanceof Error && "code" in error && error.code === "conflict") { result.claimed -= 1; result.skipped += 1; }
      else result.failed += 1;
    }
  }
  return result;
}
