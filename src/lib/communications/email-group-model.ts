import { AdminEmailError, isAdminEmailAddress } from "./admin-email-model";

export const EMAIL_GROUP_MEMBER_LIMIT = 1000;
export const EMAIL_GROUP_SEARCH_LIMIT = 50;
export type EmailGroupPurpose = "general_updates" | "membership_updates";
export type EmailGroupRule =
  | { kind: "general_subscribers" }
  | { kind: "registered_members"; state: "all" | "waiting" | "open" }
  | { kind: "event_registrants"; eventKey: string }
  | { kind: "call_audience"; callEventId: string }
  | { kind: "foundations_cohort"; cohortMonth: string };
export type EmailGroupMember = { email: string; name: string; memberId?: string; personId?: string };
export type EmailGroupSummary = {
  id: string; name: string; description: string; mode: "manual" | "rule"; revision: number;
  archivedAt: string | null; memberCount: number | null; ruleSummary: string; updatedAt: string; issue?: string;
};
export type EmailGroupInput = {
  id?: string; revision?: number; name: string; description: string; mode: "manual" | "rule";
  rule?: EmailGroupRule | null; members?: EmailGroupMember[];
};
export type EmailGroupDetail = { group: EmailGroupSummary; rule: EmailGroupRule | null; members: EmailGroupMember[] };
export type EmailGroupRuleOptions = {
  events: { eventKey: string; name: string }[]; calls: { id: string; name: string }[];
  cohorts: { cohortMonth: string; name: string }[];
};
export type EmailGroupPeoplePage = { members: EmailGroupMember[]; hasMore: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function invalid(message = "Check the group details."): never { throw new AdminEmailError(400, message); }
export function emailGroupId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) return invalid("Choose a valid email group.");
  return value;
}
export function emailGroupRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) return invalid("Reload this group before saving changes.");
  return value as number;
}
function text(value: unknown, maximum: number, required = false): string {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return invalid();
  const result = value.trim();
  if (required && !result) return invalid("Give this group a name.");
  return result;
}
export function normalizeEmailGroupRule(value: unknown): EmailGroupRule {
  if (!object(value)) return invalid("Choose a group rule.");
  const keys = Object.keys(value);
  if (value.kind === "general_subscribers" && keys.length === 1) return { kind: value.kind };
  if (value.kind === "registered_members" && keys.every(key => ["kind", "state"].includes(key))
    && (value.state === undefined || ["all", "waiting", "open"].includes(String(value.state)))) {
    return { kind: value.kind, state: (value.state ?? "all") as "all" | "waiting" | "open" };
  }
  if (value.kind === "event_registrants" && keys.length === 2 && typeof value.eventKey === "string"
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.eventKey) && value.eventKey.length <= 80) return { kind: value.kind, eventKey: value.eventKey };
  if (value.kind === "call_audience" && keys.length === 2) return { kind: value.kind, callEventId: emailGroupId(value.callEventId) };
  if (value.kind === "foundations_cohort" && keys.length === 2 && typeof value.cohortMonth === "string"
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.cohortMonth) && value.cohortMonth >= "2026-11" && value.cohortMonth <= "9998-12") {
    return { kind: value.kind, cohortMonth: value.cohortMonth };
  }
  return invalid("Choose a supported group rule and its required selection.");
}
export function normalizeEmailGroupInput(value: unknown): EmailGroupInput & { rule: EmailGroupRule | null; members: EmailGroupMember[] } {
  if (!object(value) || Object.keys(value).some(key => !["id", "revision", "name", "description", "mode", "rule", "members"].includes(key))) return invalid();
  if (value.mode !== "manual" && value.mode !== "rule") return invalid("Choose a manual group or a rule.");
  const identity = value.id === undefined ? {} : { id: emailGroupId(value.id), revision: emailGroupRevision(value.revision) };
  if (!value.id && value.revision !== undefined) return invalid();
  const name = text(value.name, 120, true), description = text(value.description ?? "", 500);
  if (value.mode === "rule") {
    if (value.members !== undefined && (!Array.isArray(value.members) || value.members.length)) return invalid("Rule groups cannot also contain a manual list.");
    return { ...identity, name, description, mode: "rule", rule: normalizeEmailGroupRule(value.rule), members: [] };
  }
  if (value.rule !== undefined && value.rule !== null) return invalid("Manual groups cannot also contain a rule.");
  if (!Array.isArray(value.members) || value.members.length > EMAIL_GROUP_MEMBER_LIMIT) return invalid(`Select up to ${EMAIL_GROUP_MEMBER_LIMIT} known contacts.`);
  const members = new Map<string, EmailGroupMember>();
  for (const entry of value.members) {
    if (!object(entry) || Object.keys(entry).some(key => !["email", "name", "memberId", "personId"].includes(key))
      || typeof entry.email !== "string") return invalid("Select contacts from the contact picker.");
    const email = entry.email.trim().toLowerCase();
    if (!isAdminEmailAddress(email)) return invalid("Select a valid contact email.");
    const member: EmailGroupMember = { email, name: text(entry.name ?? "", 160),
      ...(entry.memberId === undefined ? {} : { memberId: emailGroupId(entry.memberId) }),
      ...(entry.personId === undefined ? {} : { personId: emailGroupId(entry.personId) }) };
    if (members.has(email)) return invalid("Each contact should appear only once in a group.");
    members.set(email, member);
  }
  return { ...identity, name, description, mode: "manual", rule: null, members: [...members.values()].sort((a, b) => a.email.localeCompare(b.email)) };
}
export function emailGroupRuleSummary(rule: EmailGroupRule | null): string {
  if (!rule) return "Contacts selected by an administrator. Inclusion does not change email permissions.";
  if (rule.kind === "general_subscribers") return "Confirmed subscribers to general Ruined updates.";
  if (rule.kind === "registered_members") return rule.state === "waiting" ? "Registered members awaiting profile access." : rule.state === "open" ? "Registered members with profile access." : "Registered members with verified current identities and qualifying registration or funding.";
  if (rule.kind === "event_registrants") return "Current registrants for the selected community event. Registration does not grant marketing permission.";
  if (rule.kind === "call_audience") return "The selected call’s current eligible audience with membership email reminders enabled.";
  return `Members with verified paid enrollment in the accepted ${rule.cohortMonth} Foundations cohort.`;
}
