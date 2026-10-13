import type { EmailGroupDetail, EmailGroupMember, EmailGroupRule, EmailGroupSummary } from "@/lib/communications/email-group-model";

export type EmailGroupRuleOptions = { events: Array<{ eventKey: string; name: string }>; calls: Array<{ id: string; name: string }>; cohorts: Array<{ cohortMonth: string; name: string }> };
export type EmailGroupPreviewStore = Map<string, EmailGroupDetail>;
export const SAMPLE_GROUP_PEOPLE: EmailGroupMember[] = [
  { email: "alex@example.test", name: "Alex Sample", memberId: "sample-alex" },
  { email: "jordan@example.test", name: "Jordan Sample", memberId: "sample-jordan" },
  { email: "casey@example.test", name: "Casey Sample", personId: "sample-casey" },
];
export const SAMPLE_GROUP_OPTIONS: EmailGroupRuleOptions = {
  events: [{ eventKey: "sample-gathering", name: "Open gathering — sample" }],
  calls: [{ id: "sample-call", name: "Foundations call — sample" }],
  cohorts: [{ cohortMonth: "2026-11", name: "November 2026 — sample" }],
};
export function emailGroupRuleLabel(rule: EmailGroupRule | null, options: EmailGroupRuleOptions): string {
  if (!rule) return "People selected individually";
  if (rule.kind === "general_subscribers") return "Confirmed general-update subscribers";
  if (rule.kind === "registered_members") return rule.state === "waiting" ? "Registered members waiting for profile access" : rule.state === "open" ? "Registered members with profile access" : "All registered members";
  if (rule.kind === "event_registrants") return `Registrations for ${options.events.find(item => item.eventKey === rule.eventKey)?.name ?? "the selected event"}`;
  if (rule.kind === "foundations_cohort") return `Accepted Foundations cohort: ${options.cohorts.find(item => item.cohortMonth === rule.cohortMonth)?.name ?? rule.cohortMonth}`;
  return `Current eligible audience for ${options.calls.find(item => item.id === rule.callEventId)?.name ?? "the selected call"}`;
}
export function sampleGroupMatches(rule: EmailGroupRule | null, members: EmailGroupMember[]): EmailGroupMember[] {
  if (!rule) return members;
  return rule.kind === "general_subscribers" ? [SAMPLE_GROUP_PEOPLE[0], SAMPLE_GROUP_PEOPLE[2]] : SAMPLE_GROUP_PEOPLE.slice(0, rule.kind === "registered_members" && rule.state === "waiting" ? 1 : 2);
}
export function createEmailGroupPreview(): EmailGroupPreviewStore {
  const summary = { description: "Sample group for trying the workspace. No real recipients.", revision: 1, archivedAt: null, updatedAt: "2026-10-13T15:00:00Z" };
  const manual: EmailGroupSummary = { ...summary, id: "sample-group-manual", name: "Selected members — sample", mode: "manual", memberCount: 2, ruleSummary: "People selected individually" };
  const rule: EmailGroupRule = { kind: "foundations_cohort", cohortMonth: "2026-11" };
  const dynamic: EmailGroupSummary = { ...summary, id: "sample-group-rule", name: "November Foundations — sample", mode: "rule", memberCount: 2, ruleSummary: emailGroupRuleLabel(rule, SAMPLE_GROUP_OPTIONS) };
  return new Map([[manual.id, { group: manual, rule: null, members: SAMPLE_GROUP_PEOPLE.slice(0, 2) }], [dynamic.id, { group: dynamic, rule, members: SAMPLE_GROUP_PEOPLE.slice(0, 2) }]]);
}
