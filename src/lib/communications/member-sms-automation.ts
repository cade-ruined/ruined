import "server-only";

import { getApplicationDatabase } from "@/lib/database/server";
import { readMemberSmsConfiguration } from "./member-sms-config";
import { sendMemberSmsReminder } from "./member-sms-service";
import { MEMBER_SMS_AUTOMATION_BATCH_SIZE, readMemberSmsAutomationConfiguration, type MemberSmsAutomationSummary } from "./member-sms-automation-model";
import { claimMemberSmsAutomationJob, enqueueMemberSmsAutomation, finishMemberSmsAutomationJob,
  memberSmsAutomationReminder, memberSmsConfirmationAccepted, validateMemberSmsAutomationOccurrence } from "./member-sms-automation-repository";

/** Both switches must be enabled deliberately. No SMS work, database reads, or provider calls occur otherwise. */
export async function runMemberSmsAutomation(): Promise<MemberSmsAutomationSummary> {
  // The route allows 180 seconds. Leave time for two sequential ten-second
  // requests (confirmation + call), their database commits, and the response.
  const stopClaimingAt = Date.now() + 135_000;
  const config = readMemberSmsAutomationConfiguration();
  const transport = readMemberSmsConfiguration();
  const summary: MemberSmsAutomationSummary = { enabled: config.enabled && transport.enabled,
    queued: 0, processed: 0, accepted: 0, confirmationsAccepted: 0, blocked: 0, duplicate: 0, unknown: 0 };
  if (!summary.enabled) return { ...summary, skipped: "disabled" };
  if (!config.ready || !transport.sendReady) return { ...summary, skipped: "unconfigured" };
  if (Date.parse(config.activatedAt!) > Date.now()) return { ...summary, skipped: "not_activated" };
  const sql = getApplicationDatabase();
  summary.queued = await enqueueMemberSmsAutomation(sql, config);
  for (let count = 0; count < MEMBER_SMS_AUTOMATION_BATCH_SIZE && Date.now() < stopClaimingAt; count++) {
    const job = await claimMemberSmsAutomationJob(sql);
    if (!job) break;
    summary.processed++;
    try {
      const input = await memberSmsAutomationReminder(sql, job);
      if (input?.kind === "call_reminder" && !await memberSmsConfirmationAccepted(sql, input)) {
        // Existing explicit v2 consent receives its confirmation only when an
        // authorized call becomes due, never as a bulk historical enrollment.
        const confirmation = { ...input, kind: "opt_in_confirmation" as const, reminderKey: `consent:${input.expectedConsentId}` };
        const result = await sendMemberSmsReminder(confirmation, {
          guard: tx => validateMemberSmsAutomationOccurrence(tx, confirmation, config),
        });
        if (result.status === "accepted") summary.confirmationsAccepted++;
        if (!await memberSmsConfirmationAccepted(sql, input)) {
          summary[result.status === "unknown" ? "unknown" : "blocked"]++;
          await finishMemberSmsAutomationJob(sql, job.id, "confirmation_unavailable");
          continue;
        }
      }
      const result = input ? await sendMemberSmsReminder(input, {
        guard: tx => validateMemberSmsAutomationOccurrence(tx, input, config),
      }) : { status: "blocked" as const };
      const outcome = ["accepted", "duplicate", "unknown"].includes(result.status) ? result.status : "blocked";
      summary[outcome as "accepted" | "duplicate" | "unknown" | "blocked"]++;
      await finishMemberSmsAutomationJob(sql, job.id, result.status);
    } catch {
      // Even a failure after provider acceptance cannot create another attempt. No raw provider data is retained.
      summary.unknown++;
      await finishMemberSmsAutomationJob(sql, job.id, "unknown");
    }
  }
  return summary;
}
