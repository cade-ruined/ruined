import {
  MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES,
  MEMBER_SMS_CALL_NOTICE_MINUTES,
  MEMBER_SMS_FOUNDATIONS_01_NOTICE_MINUTES,
} from "./member-sms-automation-model";
import { memberSmsReminderBody } from "./member-sms-model";
import type { MemberSmsOperationTemplate } from "./member-sms-operations-types";

export const MEMBER_SMS_OPERATION_RULES = {
  opt_in_confirmation: {
    title: "Text opt-in confirmation",
    trigger: "A member explicitly opts in to membership texts after automation activation.",
    audience: "Members with current, supported SMS consent for their present phone number.",
    timing: `Within ${MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES} minutes of a new opt-in, checked every five minutes. Older consent is confirmed only when an eligible call reminder becomes due.`,
    noticeMinutes: null,
  },
  call_reminder: {
    title: "Standard call reminder",
    trigger: "An eligible published call with a working Google Meet link enters its reminder window.",
    audience: "Active members with released profile access, current SMS consent, and access to that call.",
    timing: `${MEMBER_SMS_CALL_NOTICE_MINUTES} minutes before the call, checked every five minutes. The send window expires after ${MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES} minutes.`,
    noticeMinutes: MEMBER_SMS_CALL_NOTICE_MINUTES,
  },
  foundations_01: {
    title: "Foundations 01 reminder",
    trigger: "A published call explicitly assigned to Foundations 01, with invite-only visibility, internal registration, and a working Google Meet link, enters its reminder window.",
    audience: "Active members with released profile access, current SMS consent, and confirmed registration and access to that Foundations 01 call.",
    timing: `${MEMBER_SMS_FOUNDATIONS_01_NOTICE_MINUTES} minutes (2½ hours) before the call, checked every five minutes. The send window expires after ${MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES} minutes.`,
    noticeMinutes: MEMBER_SMS_FOUNDATIONS_01_NOTICE_MINUTES,
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
export function getMemberSmsTemplatePreviews(publicOrigin: string): MemberSmsOperationTemplate[] {
  const memberId = "00000000-0000-4000-8000-000000000001";
  const eventId = "00000000-0000-4000-8000-000000000002";
  const callDetails = {
    eventId,
    title: "Membership call",
    startsAt: "2030-01-15T19:00:00.000Z",
    timeZone: "America/Denver",
  };
  return [
    {
      id: "opt_in_confirmation", ...MEMBER_SMS_OPERATION_RULES.opt_in_confirmation,
      body: memberSmsReminderBody({ memberId, kind: "opt_in_confirmation", reminderKey: "consent:1", expectedConsentId: "1" }, publicOrigin),
      variables: [], bodyIsExample: false,
    },
    {
      id: "call_reminder", ...MEMBER_SMS_OPERATION_RULES.call_reminder,
      body: memberSmsReminderBody({ memberId, kind: "call_reminder", reminderKey: "preview:standard-call", callDetails }, publicOrigin),
      variables: ["Call title", "Call date and time", "Member call-details link"], bodyIsExample: true,
    },
    {
      id: "foundations_01", ...MEMBER_SMS_OPERATION_RULES.foundations_01,
      body: memberSmsReminderBody({ memberId, kind: "call_reminder", reminderKey: "preview:foundations-01", callDetails: {
        ...callDetails, title: "Foundations 01", foundations01: true, meetingUrl: "https://meet.google.com/abc-defg-hij",
      } }, publicOrigin),
      variables: ["Call time", "Google Meet link"], bodyIsExample: true,
    },
  ];
}
