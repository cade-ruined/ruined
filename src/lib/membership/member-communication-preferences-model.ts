export const MEMBER_COMMUNICATION_NOTICE_VERSION = "membership-reminders-v1";
export const MEMBER_EMAIL_UPDATES_NOTICE = "Email me membership updates and call reminders.";
export const MEMBER_SMS_UPDATES_NOTICE = "Text me membership updates and call reminders.";
export const MEMBER_SMS_UPDATES_DETAIL = "Optional. Message frequency varies. Message and data rates may apply.";

export type MemberCommunicationPreferencesSnapshot = {
  email: boolean | null;
  sms: boolean | null;
  smsPhone: string | null;
  revision: string;
};
export const EMPTY_MEMBER_COMMUNICATION_PREFERENCES: MemberCommunicationPreferencesSnapshot = {
  email: null, sms: null, smsPhone: null, revision: "not_loaded",
};
export type MemberCommunicationPreferencesInput = {
  email: boolean;
  sms: boolean;
  expectedRevision: string;
  noticeVersion: string;
  /** Sent only after an active SMS checkbox selection for this exact number. */
  smsOptIn?: { phone: string };
};
