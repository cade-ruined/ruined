import "server-only";

import twilio from "twilio";
import type { MemberSmsDispatchOptions } from "./member-sms-repository";
import { getApplicationDatabase } from "@/lib/database/server";
import { readMemberSmsConfiguration } from "./member-sms-config";
import { memberSmsReminderBody, type MemberSmsReminder, type MemberSmsSendResult } from "./member-sms-model";
import { dispatchReservedMemberSms, reserveMemberSmsAttempt } from "./member-sms-repository";
import { memberSmsTemplateId, renderMemberSmsTemplate } from "./member-sms-template-model";
import { readMemberSmsTemplates, memberSmsTemplateRevisionAllowed } from "./member-sms-template-repository";

/**
 * Internal transport: the automation supplies a source guard under the same locks.
 * Caller must retain one reminderKey for each occurrence, including retries.
 * Enable only after sender registration, Advanced Opt-Out, and approval.
 */
export async function sendMemberSmsReminder(input: MemberSmsReminder, options: MemberSmsDispatchOptions = {}): Promise<MemberSmsSendResult> {
  if (input.kind === "one_off" && !options.guard) return { status: "blocked", reason: "source_ineligible" };
  const config = readMemberSmsConfiguration();
  if (!config.enabled) return { status: "disabled" };
  if (!config.sendReady || !config.publicOrigin) return { status: "unconfigured" };
  const sql = getApplicationDatabase();
  const templateId = memberSmsTemplateId(input);
  const template = templateId ? (await readMemberSmsTemplates(sql)).find(item => item.id === templateId)! : null;
  if (template && !template.enabled) return { status: "blocked", reason: "source_ineligible" };
  const body = template ? renderMemberSmsTemplate(template, input, config.publicOrigin) : memberSmsReminderBody(input, config.publicOrigin);
  // Freeze one rendered body. A later edit blocks this occurrence at reservation
  // or dispatch; the durable attempt identity still prevents automatic retries.
  const guarded: MemberSmsDispatchOptions = template ? { guard: async tx =>
    await memberSmsTemplateRevisionAllowed(tx, template.id, template.revision) && (!options.guard || await options.guard(tx)) } : options;
  const reservation = await reserveMemberSmsAttempt(sql, input, body, guarded);
  if ("status" in reservation) return reservation;
  try {
    return await dispatchReservedMemberSms(sql, input, reservation, async phone => {
      const client = twilio(config.accountSid, config.authToken, { autoRetry: false, maxRetries: 0, timeout: 10_000, logLevel: "silent" });
      const message = await client.messages.create({
        to: phone,
        from: config.phoneNumber,
        messagingServiceSid: config.messagingServiceSid,
        body,
        // Reminders should expire rather than arrive many hours after a call.
        validityPeriod: 600,
        statusCallback: `${config.statusUrl}?attempt=${reservation.attemptId}`,
      });
      return message.sid;
    }, guarded);
  } catch {
    // The reservation committed before dispatch. A DB/connection failure here
    // cannot prove whether Twilio accepted the request. Never retry it.
    return { status: "unknown", attemptId: reservation.attemptId };
  }
}
