import { memberSmsReminderBody, type MemberSmsReminder } from "./member-sms-model";

export const MEMBER_SMS_TEMPLATE_IDS = ["opt_in_confirmation", "call_reminder", "foundations_01", "day_before"] as const;
export type MemberSmsTemplateId = typeof MEMBER_SMS_TEMPLATE_IDS[number];
export type MemberSmsTemplateConfig = {
  id: MemberSmsTemplateId; body: string; enabled: boolean; noticeMinutes: number | null; revision: number;
  effectiveAt: string; updatedAt: string; updatedBy: string | null;
};
export type MemberSmsTemplateEdit = Pick<MemberSmsTemplateConfig, "id" | "body" | "enabled" | "noticeMinutes" | "revision">;
export type MemberSmsTemplateView = MemberSmsTemplateConfig & { title: string; tokens: string[]; footer: string; defaultBody: string; preview: string };
export class MemberSmsTemplateError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "MemberSmsTemplateError"; }
}
export const MEMBER_SMS_TEMPLATE_MAX_BODY = 900;
export const MEMBER_SMS_TEMPLATE_MAX_RENDER = 1000;
const CALL_FOOTER = "Reply STOP to unsubscribe or HELP for help.";
const CALL_TOKENS = ["call_title", "call_date_time", "call_time", "call_link"];
export const MEMBER_SMS_TEMPLATE_DEFINITIONS = {
  opt_in_confirmation: { title: "Text opt-in confirmation", tokens: [] as string[], enabled: true, noticeMinutes: null,
    body: "Ruined: You opted in to membership updates and call reminders.",
    footer: "Message frequency varies. Message and data rates may apply. For help, reply HELP or email connect@theruinedproject.com. Reply STOP to unsubscribe." },
  call_reminder: { title: "Standard call reminder", tokens: CALL_TOKENS, enabled: true, noticeMinutes: 60,
    body: "Ruined: {{call_title}} starts {{call_date_time}}. View details and join: {{call_link}}.", footer: CALL_FOOTER },
  foundations_01: { title: "Foundations 01 reminder", tokens: [...CALL_TOKENS, "meeting_link"], enabled: true, noticeMinutes: 150,
    body: "RU/NED Foundations starts today at {{call_time}}. Your Google Meet link: {{meeting_link}}. We’ll see you soon.", footer: CALL_FOOTER },
  day_before: { title: "Day-before call reminder", tokens: CALL_TOKENS, enabled: false, noticeMinutes: 1440,
    body: "Ruined: {{call_title}} is tomorrow at {{call_time}}. View details and join: {{call_link}}.", footer: CALL_FOOTER },
} as const;
const ORIGIN = "https://members.theruinedproject.com";
const EPOCH = "1970-01-01T00:00:00.000Z";
const tokenBounds: Record<string, number> = { call_title: 200, call_date_time: 120, call_time: 80, call_link: 60, meeting_link: 80 };
export function defaultMemberSmsTemplates(): MemberSmsTemplateConfig[] {
  return MEMBER_SMS_TEMPLATE_IDS.map(id => ({ id, body: MEMBER_SMS_TEMPLATE_DEFINITIONS[id].body,
    enabled: MEMBER_SMS_TEMPLATE_DEFINITIONS[id].enabled, noticeMinutes: MEMBER_SMS_TEMPLATE_DEFINITIONS[id].noticeMinutes,
    revision: 0, effectiveAt: EPOCH, updatedAt: EPOCH, updatedBy: null }));
}
export function validateMemberSmsTemplateEdit(value: unknown): MemberSmsTemplateEdit {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemberSmsTemplateError(400, "Choose a valid text template.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "body,enabled,id,noticeMinutes,revision" || typeof input.id !== "string"
    || !MEMBER_SMS_TEMPLATE_IDS.includes(input.id as MemberSmsTemplateId) || typeof input.body !== "string"
    || typeof input.enabled !== "boolean" || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0 || Number(input.revision) >= 2147483647) {
    throw new MemberSmsTemplateError(400, "Choose a valid text template and saved revision.");
  }
  const id = input.id as MemberSmsTemplateId, definition = MEMBER_SMS_TEMPLATE_DEFINITIONS[id];
  const body = input.body.replace(/\r\n?/g, "\n").trim();
  if (!body || body.length > MEMBER_SMS_TEMPLATE_MAX_BODY || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(body)
    || /<\/?[a-z!][^>]*>/i.test(body) || !/(?:\bRuined\b|\bRU\/NED\b)/i.test(body)) {
    throw new MemberSmsTemplateError(400, "Use plain text with the Ruined or RU/NED name, up to 900 characters.");
  }
  if ((id === "call_reminder" || id === "day_before") && !body.includes("{{call_link}}")) throw new MemberSmsTemplateError(400, "Keep {{call_link}} so members can view the call details and join.");
  if (id === "foundations_01" && !body.includes("{{call_link}}") && !body.includes("{{meeting_link}}")) throw new MemberSmsTemplateError(400, "Keep {{call_link}} or {{meeting_link}} so members can join Foundations.");
  let expandedLength = body.length + 1 + definition.footer.length;
  const remaining = body.replace(/\{\{([a-z_]+)\}\}/g, (match, token: string) => {
    if (!definition.tokens.includes(token)) throw new MemberSmsTemplateError(400, `The ${token} placeholder is not available for this template.`);
    expandedLength += tokenBounds[token] - match.length; return "";
  });
  if (/[{}]/.test(remaining)) throw new MemberSmsTemplateError(400, "Use only the listed placeholders in double braces.");
  if (expandedLength > MEMBER_SMS_TEMPLATE_MAX_RENDER) throw new MemberSmsTemplateError(400, "Shorten the text so call details and required footer fit within 1,000 characters.");
  if (id === "opt_in_confirmation" && (!input.enabled || input.noticeMinutes !== null)) throw new MemberSmsTemplateError(400, "The opt-in confirmation must remain enabled with its existing timing.");
  if (id === "day_before" && input.noticeMinutes !== 1440) throw new MemberSmsTemplateError(400, "The day-before reminder is fixed at 24 hours.");
  if ((id === "call_reminder" || id === "foundations_01") && (!Number.isInteger(input.noticeMinutes) || Number(input.noticeMinutes) < 15 || Number(input.noticeMinutes) > 720)) {
    throw new MemberSmsTemplateError(400, "Choose a whole number from 15 to 720 minutes before the call.");
  }
  return { id, body, enabled: input.enabled, noticeMinutes: input.noticeMinutes as number | null, revision: input.revision as number };
}
/** Legacy generic reminders and reviewed one-off messages keep their existing renderer. */
export function memberSmsTemplateId(input: MemberSmsReminder): MemberSmsTemplateId | null {
  if (input.kind === "opt_in_confirmation") return "opt_in_confirmation";
  if (input.kind !== "call_reminder" || !input.callDetails) return null;
  return input.callDetails.reminderStage === "day_before" ? "day_before" : input.callDetails.foundations01 ? "foundations_01" : "call_reminder";
}
export function renderMemberSmsTemplate(template: MemberSmsTemplateConfig, input: MemberSmsReminder, publicOrigin: string): string {
  if (memberSmsTemplateId(input) !== template.id || publicOrigin !== ORIGIN) throw new MemberSmsTemplateError(400, "The text template does not match this reminder.");
  // Retain the original identity, call date, and canonical Google Meet validation.
  memberSmsReminderBody(input, publicOrigin);
  validateMemberSmsTemplateEdit({ id: template.id, body: template.body, enabled: template.enabled, noticeMinutes: template.noticeMinutes, revision: template.revision });
  const details = input.callDetails;
  const tokens: Record<string, string> = {};
  if (details) {
    tokens.call_title = details.title.replace(/\s+/g, " ").trim();
    tokens.call_date_time = new Intl.DateTimeFormat("en-US", { timeZone: details.timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(details.startsAt));
    tokens.call_time = new Intl.DateTimeFormat("en-US", { timeZone: details.timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "shortGeneric" }).format(new Date(details.startsAt));
    tokens.call_link = `${publicOrigin}/my/experiences`;
    tokens.meeting_link = details.meetingUrl ?? "";
  }
  const body = template.body.replace(/\{\{([a-z_]+)\}\}/g, (_match, token: string) => {
    if (!tokens[token]) throw new MemberSmsTemplateError(400, "Required call details are unavailable."); return tokens[token];
  }) + " " + MEMBER_SMS_TEMPLATE_DEFINITIONS[template.id].footer;
  if (body.length > MEMBER_SMS_TEMPLATE_MAX_RENDER) throw new MemberSmsTemplateError(400, "The rendered text exceeds 1,000 characters.");
  return body;
}
export function memberSmsTemplatePreview(template: MemberSmsTemplateConfig, publicOrigin = ORIGIN): string {
  const input: MemberSmsReminder = { memberId: "00000000-0000-4000-8000-000000000001", kind: "opt_in_confirmation", reminderKey: "consent:1", expectedConsentId: "1" };
  if (template.id !== "opt_in_confirmation") {
    input.kind = "call_reminder"; input.reminderKey = `preview:${template.id}`;
    input.callDetails = { eventId: "00000000-0000-4000-8000-000000000002", title: template.id === "foundations_01" ? "Foundations 01" : "Membership call",
      startsAt: "2030-01-15T19:00:00.000Z", timeZone: "America/Denver", foundations01: template.id === "foundations_01",
      meetingUrl: "https://meet.google.com/abc-defg-hij", ...(template.id === "day_before" ? { reminderStage: "day_before" } : {}) };
  }
  return renderMemberSmsTemplate(template, input, publicOrigin);
}
export function memberSmsTemplateView(template: MemberSmsTemplateConfig, publicOrigin = ORIGIN): MemberSmsTemplateView {
  const definition = MEMBER_SMS_TEMPLATE_DEFINITIONS[template.id];
  return { ...template, title: definition.title, tokens: [...definition.tokens], footer: definition.footer,
    defaultBody: definition.body, preview: memberSmsTemplatePreview(template, publicOrigin) };
}
