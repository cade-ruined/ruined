export const MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES = 10;
export const MEMBER_SMS_CALL_NOTICE_MINUTES = 60;
export const MEMBER_SMS_AUTOMATION_BATCH_SIZE = 100;

export type MemberSmsAutomationConfiguration = {
  enabled: boolean;
  activatedAt: string | null;
  ready: boolean;
};

/** An explicit activation time prevents enabling automation from enrolling old consent. */
export function readMemberSmsAutomationConfiguration(env: NodeJS.ProcessEnv = process.env): MemberSmsAutomationConfiguration {
  const value = env.MEMBER_SMS_AUTOMATION_ACTIVATED_AT?.trim() ?? "";
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ? Date.parse(value) : NaN;
  const canonical = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  const activatedAt = canonical && canonical.replace(".000Z", "Z") === value.replace(".000Z", "Z") ? canonical : null;
  return { enabled: env.MEMBER_SMS_AUTOMATION_ENABLED?.trim() === "true", activatedAt, ready: activatedAt !== null };
}

export function memberSmsCallReminderKey(eventId: string, startsAt: Date | string): string {
  return `call:${eventId}:${new Date(startsAt).getTime()}:60m`;
}

export type MemberSmsAutomationSummary = {
  enabled: boolean;
  skipped?: "disabled" | "unconfigured" | "not_activated";
  queued: number;
  processed: number;
  accepted: number;
  confirmationsAccepted: number;
  blocked: number;
  duplicate: number;
  unknown: number;
};
