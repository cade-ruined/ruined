export type MemberSmsReminder = {
  memberId: string;
  /** Stable per member and reminder occurrence. Never generate a new key for a retry. */
  reminderKey: string;
  kind: "call_reminder" | "membership_reminder" | "opt_in_confirmation";
  /** Confirmation is bound to the exact authenticated checkbox event. */
  expectedConsentId?: string;
  callDetails?: { eventId: string; title: string; startsAt: string; timeZone: string };
};
export type MemberSmsBlockedReason = "member_inactive" | "phone_missing" | "no_current_consent" | "phone_suppressed" | "source_ineligible";
export type MemberSmsSendResult =
  | { status: "disabled" | "unconfigured" }
  | { status: "blocked"; reason: MemberSmsBlockedReason }
  | { status: "duplicate"; attemptId: string }
  | { status: "accepted"; attemptId: string; messageSid: string }
  | { status: "unknown"; attemptId: string };
export type MemberSmsInbound = { messageSid: string; phone: string; kind: "STOP" | "START" | "HELP" | "message" };

/** Only membership reminder templates are available; no arbitrary campaign body. */
export function memberSmsReminderBody(input: MemberSmsReminder, publicOrigin: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.memberId)
    || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,159}$/.test(input.reminderKey)) {
    throw new Error("Invalid membership reminder identity.");
  }
  if (input.kind === "opt_in_confirmation" && (!/^[1-9][0-9]*$/.test(input.expectedConsentId ?? "")
    || input.reminderKey !== `consent:${input.expectedConsentId}`)) throw new Error("Invalid confirmation identity.");
  if (input.kind === "call_reminder" && input.callDetails) {
    const { title, startsAt, timeZone, eventId } = input.callDetails;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId) || !title.trim() || title.length > 200 || !Number.isFinite(Date.parse(startsAt))) {
      throw new Error("Invalid call reminder details.");
    }
    const when = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(startsAt));
    return `Ruined: ${title.replace(/\s+/g, " ").trim()} starts ${when}. View details and join: ${publicOrigin}/my/experiences. Reply STOP to unsubscribe or HELP for help.`;
  }
  if (input.kind === "opt_in_confirmation") return "Ruined: You opted in to membership updates and call reminders. Message frequency varies. Message and data rates may apply. For help, reply HELP or email connect@theruinedproject.com. Reply STOP to unsubscribe.";
  const prefix = input.kind === "call_reminder" ? "Your membership call is coming up. View the time and join link"
    : input.kind === "membership_reminder" ? "You have a membership reminder. View the details" : null;
  if (!prefix) throw new Error("Unsupported membership reminder.");
  return `Ruined: ${prefix}: ${publicOrigin}/my. Reply STOP to unsubscribe or HELP for help.`;
}
