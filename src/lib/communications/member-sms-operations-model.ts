import {
  MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES,
  MEMBER_SMS_CALL_NOTICE_MINUTES,
  MEMBER_SMS_FOUNDATIONS_01_NOTICE_MINUTES,
  MEMBER_SMS_DAY_BEFORE_NOTICE_MINUTES,
} from "./member-sms-automation-model";
import { defaultMemberSmsTemplates, memberSmsTemplatePreview, type MemberSmsTemplateConfig } from "./member-sms-template-model";
import type { MemberSmsOperationTemplate } from "./member-sms-operations-types";

export const MEMBER_SMS_OPERATION_RULES = {
  opt_in_confirmation: {
    title: "Text opt-in confirmation",
    trigger: "A member opts in, or an administrator records the member’s explicit permission, after automatic texts are enabled.",
    audience: "Members with current text permission for their present phone number.",
    timing: `Within ${MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES} minutes of a new opt-in, checked every five minutes. Older consent is confirmed only when an eligible call reminder becomes due.`,
    noticeMinutes: null,
  },
  call_reminder: {
    title: "Standard call reminder",
    trigger: "An eligible published call with a working Google Meet link enters its reminder window.",
    audience: "Members with current paid or complimentary access, an open profile, current text permission, and access to that call.",
    timing: `${MEMBER_SMS_CALL_NOTICE_MINUTES} minutes before the call, checked every five minutes. The send window expires after ${MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES} minutes.`,
    noticeMinutes: MEMBER_SMS_CALL_NOTICE_MINUTES,
  },
  foundations_01: {
    title: "Foundations 01 reminder",
    trigger: "A published call explicitly assigned to Foundations 01, with invite-only visibility, internal registration, and a working Google Meet link, enters its reminder window.",
    audience: "Members with current paid or complimentary access, an open profile, current text permission, and confirmed registration and access to that Foundations 01 call.",
    timing: `${MEMBER_SMS_FOUNDATIONS_01_NOTICE_MINUTES} minutes (2½ hours) before the call, checked every five minutes. The send window expires after ${MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES} minutes.`,
    noticeMinutes: MEMBER_SMS_FOUNDATIONS_01_NOTICE_MINUTES,
  },
  day_before: {
    title: "Day-before call reminder",
    trigger: "An eligible published call with a working Google Meet link enters its day-before reminder window.",
    audience: "Members with current paid or complimentary access, an open profile, current text permission, and access to that call, including Foundations calls.",
    timing: `24 hours before the call, checked every five minutes. The send window expires after ${MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES} minutes.`,
    noticeMinutes: MEMBER_SMS_DAY_BEFORE_NOTICE_MINUTES,
  },
} as const;

/** The exception is a saved call assignment and access configuration, never a title match. */
export function memberSmsOperationNoticeMinutes(input: {
  foundations01: boolean;
  visibility: string;
  registrationMode: string;
}): number {
  return input.foundations01 && input.visibility === "invite_only" && input.registrationMode === "internal"
    ? MEMBER_SMS_FOUNDATIONS_01_NOTICE_MINUTES : MEMBER_SMS_CALL_NOTICE_MINUTES;
}

/** Pure previews from the delivery renderer. Sample values never reach a queue or provider. */
export function getMemberSmsTemplatePreviews(_publicOrigin: string, templates: MemberSmsTemplateConfig[] = defaultMemberSmsTemplates()): MemberSmsOperationTemplate[] {
  const variableLabels: Record<string, string> = { call_title: "Call title", call_date_time: "Call date and time",
    call_time: "Call time", call_link: "Member call-details link", meeting_link: "Google Meet link" };
  // Samples use the same canonical links as delivery; generating them never performs I/O.
  return templates.map(template => {
    const rule = MEMBER_SMS_OPERATION_RULES[template.id];
    const timing = template.id === "opt_in_confirmation" ? rule.timing : template.id === "day_before" ? MEMBER_SMS_OPERATION_RULES.day_before.timing
      : `${template.noticeMinutes} minutes${template.noticeMinutes === 150 ? " (2½ hours)" : ""} before the call, checked every five minutes. The send window expires after ${MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES} minutes.`;
    return { ...template, ...rule, noticeMinutes: template.noticeMinutes, timing, editableBody: template.body,
      body: memberSmsTemplatePreview(template), bodyIsExample: template.id !== "opt_in_confirmation",
      variables: [...new Set([...template.body.matchAll(/\{\{([a-z_]+)\}\}/g)].map(match => variableLabels[match[1]]).filter(Boolean))] };
  });
}
