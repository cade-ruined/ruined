import { CADENCE_KIND_LABELS, CADENCE_STAGE_LABELS, cadenceOccurrences, type CadenceKind, type CadenceTrack, type CadenceStage } from "./member-email-cadence-model";
import type { CadenceManagementSummary } from "./member-email-cadence-management";

type Summary = CadenceManagementSummary;
export type AutomationFilter = "all" | "active" | "paused" | "attention" | "finished" | "cancelled";
export type AutomationViewOptions = {
  stage?: "all" | CadenceStage;
  kind: "all" | "foundations" | CadenceKind;
  track: "all" | CadenceTrack;
  schedule: "all" | "upcoming" | "week" | "month" | "none";
  sort: "next" | "updated" | "name";
};
export const DEFAULT_AUTOMATION_VIEW_OPTIONS: AutomationViewOptions = {
  kind: "all", track: "all", schedule: "all", sort: "next",
};

export function automationTitle(item: Summary) {
  return item.title || `${CADENCE_KIND_LABELS[item.kind]} · ${item.track === "founder_test" ? "Founder test" : "Members"}`;
}

export function automationNeedsAttention(item: Summary) {
  return item.status === "changed" || item.status === "unavailable" || item.status === "blocked"
    || /^(Call changed\b|Some matching calls need attention)/i.test(item.attention ?? "")
    || (item.delivery?.failed ?? 0) + (item.delivery?.manualReview ?? 0) > 0;
}

function matchesStatus(item: Summary, status: AutomationFilter) {
  const sequencePaused = /^Sequence paused\b/i.test(item.attention ?? "");
  if (status === "attention") return automationNeedsAttention(item);
  if (status === "paused") return !item.active || item.status === "paused" || sequencePaused;
  if (status === "active") return item.active
    && !["paused", "past", "cancelled", "unavailable", "changed", "blocked"].includes(item.status)
    && !automationNeedsAttention(item) && !sequencePaused;
  if (status === "finished") return item.status === "past";
  if (status === "cancelled") return item.status === "cancelled";
  return true;
}

function upcomingTimestamp(item: Summary, now: number) {
  const timestamp = item.nextReminder ? Date.parse(item.nextReminder.dueAt) : NaN;
  return Number.isFinite(timestamp) && timestamp >= now ? timestamp : null;
}

function matchesSchedule(item: Summary, schedule: AutomationViewOptions["schedule"], now: number) {
  if (schedule === "all") return true;
  const next = upcomingTimestamp(item, now);
  if (schedule === "none") return next === null;
  if (next === null) return false;
  if (schedule === "upcoming") return true;
  const days = schedule === "week" ? 7 : 30;
  return next <= now + days * 24 * 60 * 60 * 1000;
}

function byName(a: Summary, b: Summary) {
  return automationTitle(a).localeCompare(automationTitle(b), "en", { numeric: true, sensitivity: "base" })
    || a.id.localeCompare(b.id, "en");
}

/** Organizes the saved library only; it never changes scheduling or delivery eligibility. */
export function filterAndSortAutomations<T extends Summary>(
  items: readonly T[], query: string, status: AutomationFilter, options: AutomationViewOptions, now = Date.now(),
): T[] {
  const search = query.trim().toLowerCase();
  const filtered = items.filter(item => {
    if (search && ![
      automationTitle(item), item.templateName, CADENCE_KIND_LABELS[item.kind],
      item.track === "founder_test" ? "founder test" : "members", item.audienceSummary ?? "",
      ...automationStages(item.kind, item.track).map(stage => CADENCE_STAGE_LABELS[stage]),
    ].join(" ").toLowerCase().includes(search)) return false;
    if (!matchesStatus(item, status)) return false;
    if (options.stage && options.stage !== "all" && !automationStages(item.kind, item.track).includes(options.stage)) return false;
    if (options.kind === "foundations" ? !item.kind.startsWith("foundations_") : options.kind !== "all" && item.kind !== options.kind) return false;
    if (options.track !== "all" && item.track !== options.track) return false;
    return matchesSchedule(item, options.schedule, now);
  });

  return filtered.sort((a, b) => {
    if (options.sort === "next") {
      const aNext = upcomingTimestamp(a, now), bNext = upcomingTimestamp(b, now);
      if (aNext === null && bNext !== null) return 1;
      if (aNext !== null && bNext === null) return -1;
      if (aNext !== null && bNext !== null && aNext !== bNext) return aNext - bNext;
    } else if (options.sort === "updated") {
      const aUpdated = Date.parse(a.updatedAt), bUpdated = Date.parse(b.updatedAt);
      const aValid = Number.isFinite(aUpdated), bValid = Number.isFinite(bUpdated);
      if (!aValid && bValid) return 1;
      if (aValid && !bValid) return -1;
      if (aValid && bValid && aUpdated !== bUpdated) return bUpdated - aUpdated;
    }
    return byName(a, b);
  });
}


export type AutomationSection = "upcoming" | "library" | "activity";
export function automationStages(kind: CadenceKind, track: CadenceTrack): CadenceStage[] {
  return [...(kind === "foundations_01" ? track === "members" ? ["orientation", "one_week"] as const : ["two_days"] as const : []), "day_before", "day_of"];
}
export function automationStageTiming(stage: CadenceStage, kind: CadenceKind, track: CadenceTrack) {
  if (stage === "orientation") return "16 days before";
  if (stage === "one_week") return "7 days before";
  if (stage === "two_days") return "48 hours before";
  if (stage === "day_before") return "24 hours before";
  return kind === "foundations_01" && track === "members" ? "Call day · 8 a.m. MT" : "2½ hours before";
}
export function automationStatus(item: Pick<Summary, "active" | "status"> & { attention?: string; scope?: "event" | "sequence"; matchingCallCount?: number }, configuration: { enabled: boolean; ready: boolean }) {
  if (item.status === "cancelled") return "Cancelled";
  if (item.status === "past") return "Finished";
  if (!item.active || item.status === "paused" || /^Sequence paused\b/i.test(item.attention ?? "")) return "Paused";
  if (["changed", "unavailable", "blocked"].includes(item.status) || /^(Call changed\b|Some matching calls need attention)/i.test(item.attention ?? "")) return "Needs attention";
  if (!configuration.enabled) return "Delivery paused";
  if (!configuration.ready) return "Needs attention";
  if (item.status === "inheritance_pending") return "Waiting for setup";
  if (item.status === "no_remaining") return item.scope === "sequence" || item.matchingCallCount !== undefined ? "Waiting for a call" : "No upcoming emails";
  return "Scheduled";
}
/** Preview fallback only. The server supplies these opportunities in live mode. */
export function upcomingFromPlans(overview: import("./member-email-cadence-management").CadenceManagementOverview, now = Date.now()) {
  return overview.plans.flatMap(plan => {
    const event = overview.events.find(event => event.id === plan.eventId);
    if (!event || ["cancelled", "past", "unavailable"].includes(plan.status)) return [];
    return cadenceOccurrences(event, plan.kind, plan.track).filter(item => Date.parse(item.dueAt) >= now).map(item => ({
      ...item, planId: plan.id, eventId: event.id, eventTitle: event.title, timeZone: event.timeZone,
      kind: plan.kind, track: plan.track, status: plan.status, active: plan.active, attention: plan.attention, sequenceId: plan.sequenceId,
    }));
  }).sort((a,b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}
