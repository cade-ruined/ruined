import { CADENCE_KIND_LABELS, type CadenceStage } from "./member-email-cadence-model";
import { AUTOMATION_STAGE_NAMES, automationNeedsAttention, automationStageTiming, automationStages } from "./email-automation-view";
import type { CadenceManagementOverview, CadenceManagementSummary } from "./member-email-cadence-management";

export const COMMUNICATION_CHANNELS = [
  { value: "emails", label: "Emails" },
  { value: "texts", label: "Texts" },
  { value: "notifications", label: "Notifications" },
] as const;

export const COMMUNICATION_BUCKETS = [
  { value: "registration", label: "Registration", description: "Joining Ruined and completing registration." },
  { value: "pre-foundations", label: "Pre-Foundations", description: "Profile access and preparation for the first call." },
  { value: "foundations", label: "Foundations", description: "The four Foundations sessions and their follow-through." },
  { value: "membership", label: "Membership", description: "Ongoing membership, Circles, and renewal." },
  { value: "missed-protocol", label: "Missed Protocol", description: "Follow-up for missed calls or unfinished work." },
  { value: "misc", label: "Misc", description: "Team updates and other communications." },
] as const;

export type CommunicationChannel = typeof COMMUNICATION_CHANNELS[number]["value"];
export type CommunicationBucket = typeof COMMUNICATION_BUCKETS[number]["value"];
export type CommunicationItem = {
  id: string;
  channel: CommunicationChannel;
  bucket: CommunicationBucket;
  title: string;
  trigger: string;
  audience: string;
  timing: string;
  status: "enabled" | "paused" | "attention" | "planned" | "manual";
  statusLabel: string;
  detail?: string;
  test?: boolean;
  action?: { label: string; href?: string; selection?: { scope: "event" | "sequence"; id: string; stage?: CadenceStage } };
};

export type CommunicationNavigation = {
  channel: CommunicationChannel;
  bucket: CommunicationBucket | null;
  view: "catalog" | "upcoming" | "activity" | "library";
};

const CHANNEL_VALUES: readonly string[] = COMMUNICATION_CHANNELS.map(item => item.value);
const BUCKET_VALUES: readonly string[] = COMMUNICATION_BUCKETS.map(item => item.value);
const VIEWS = ["catalog", "upcoming", "activity", "library"] as const;
type Search = string | URLSearchParams;

function navigation(input: Partial<CommunicationNavigation>): CommunicationNavigation {
  return {
    channel: CHANNEL_VALUES.includes(input.channel ?? "") ? input.channel! : "emails",
    bucket: BUCKET_VALUES.includes(input.bucket ?? "") ? input.bucket! : null,
    view: VIEWS.includes(input.view as CommunicationNavigation["view"]) ? input.view! : "catalog",
  };
}

/** Buckets organize workflows; they never replace a member's access or lifecycle state. */
export function readCommunicationNavigation(search: Search): CommunicationNavigation {
  const params = new URLSearchParams(search);
  return navigation({
    channel: params.get("channel") as CommunicationChannel,
    bucket: params.get("bucket") as CommunicationBucket | null,
    view: params.get("commsView") as CommunicationNavigation["view"],
  });
}

/** Updating a channel alone keeps the current bucket, including the six-bucket overview. */
export function writeCommunicationNavigation(search: Search, update: Partial<CommunicationNavigation>): string {
  const params = new URLSearchParams(search);
  const next = navigation({ ...readCommunicationNavigation(params), ...update });
  if (next.channel === "emails") params.delete("channel"); else params.set("channel", next.channel);
  if (next.bucket === null) params.delete("bucket"); else params.set("bucket", next.bucket);
  if (next.view === "catalog") params.delete("commsView"); else params.set("commsView", next.view);
  return params.toString();
}

function cadenceState(item: CadenceManagementSummary, scope: "event" | "sequence", overview: CadenceManagementOverview): Pick<CommunicationItem, "status" | "statusLabel"> {
  if (item.status === "cancelled") return { status: "paused", statusLabel: "Cancelled" };
  if (item.status === "past") return { status: "paused", statusLabel: "Finished" };
  if (!item.active || item.status === "paused" || /^Sequence paused\b/i.test(item.attention ?? "")) return { status: "paused", statusLabel: "Paused" };
  if (automationNeedsAttention(item) || overview.setupRequired) return { status: "attention", statusLabel: "Needs attention" };
  if (!overview.configuration.enabled) return { status: "paused", statusLabel: "Delivery paused" };
  if (!overview.configuration.ready) return { status: "attention", statusLabel: "Setup incomplete" };
  if (scope === "event" && item.status === "no_remaining") return { status: "paused", statusLabel: "No upcoming emails" };
  if (item.status === "inheritance_pending") return { status: "attention", statusLabel: "Waiting for setup" };
  return { status: "enabled", statusLabel: scope === "sequence" && item.status === "no_remaining" ? "Waiting for a call" : "Enabled" };
}

function cadenceItems(item: CadenceManagementSummary, scope: "event" | "sequence", overview: CadenceManagementOverview): CommunicationItem[] {
  return automationStages(item.kind, item.track).map(stage => {
    const preparation = item.kind.startsWith("foundations_") && ["orientation", "one_week", "two_days"].includes(stage);
    const bucket: CommunicationBucket = item.kind === "membership" || item.kind === "circle" ? "membership" : preparation ? "pre-foundations" : "foundations";
    const title = scope === "event" ? item.title : CADENCE_KIND_LABELS[item.kind];
    const timing = automationStageTiming(stage, item.kind, item.track);
    return {
      id: `cadence:${scope}:${item.id}:${stage}`, channel: "emails", bucket,
      title: `${title} · ${AUTOMATION_STAGE_NAMES[stage]}`,
      trigger: `${AUTOMATION_STAGE_NAMES[stage]} for ${scope === "sequence" ? "each matching published call" : "this approved call"}.`,
      audience: item.audienceSummary,
      timing,
      ...cadenceState(item, scope, overview),
      detail: [item.attention, scope === "sequence"
        ? "Shared sequence. Applies to current and future matching calls; custom reminders and individually paused calls keep their settings."
        : "sequenceId" in item && item.sequenceId
          ? "This call has a saved shared-sequence approval, but its parent sequence is unavailable in this inventory. Inspect the call before changing its settings."
        : "Call-only approval. Changes stay with this call; shared sequence updates and pauses do not control an independent approval.",
      "Actual dates and eligibility are checked for each call. Past reminders are never replayed."].filter(Boolean).join(" "),
      test: item.track === "founder_test",
      action: { label: "View email", selection: { scope, id: item.id, stage } },
    };
  });
}

const PLANNED_EMAILS: ReadonlyArray<Pick<CommunicationItem, "id" | "bucket" | "title" | "trigger" | "audience" | "detail">> = [
  { id: "planned:email:missed-call", bucket: "missed-protocol", title: "Missed-call follow-up", trigger: "A missed call, once the attendance rule is approved.", audience: "Members meeting the future missed-call criteria.", detail: "Not automated. Attendance evidence, deadlines, follow-up limits, and copy still need approval." },
  { id: "planned:email:unfinished-work", bucket: "missed-protocol", title: "Unfinished-work follow-up", trigger: "An unfinished requirement, once completion rules are approved.", audience: "Members meeting the future unfinished-work criteria.", detail: "Not automated. Required work, deadlines, escalation, and copy still need approval." },
  { id: "planned:email:foundations-completion", bucket: "foundations", title: "Foundations completion email", trigger: "Verified Foundations completion, once email rules are approved.", audience: "Members whose completion meets the approved email criteria.", detail: "The completion email is planned. Its timing and copy still need approval; this does not change existing completion or badge behavior." },
  { id: "planned:email:circle-reveal", bucket: "membership", title: "Circle reveal email", trigger: "Approved Circle placement and readiness, once email rules are approved.", audience: "Members ready to be introduced to their assigned Circle.", detail: "This email is planned. Existing Circle access and in-app notifications remain separate." },
  { id: "planned:email:milestones", bucket: "misc", title: "Birthdays, anniversaries, and milestones", trigger: "An approved birthday, anniversary, or milestone rule.", audience: "Members meeting the future milestone criteria.", detail: "Not automated. Date anchors, benefits, timing, and copy still need approval." },
  { id: "planned:email:campaigns", bucket: "misc", title: "Holidays, launches, and clothing drops", trigger: "An approved campaign and scheduled date.", audience: "The campaign's approved marketing audience.", detail: "No recurring campaign is configured here. Dates, benefits, marketing permissions, and copy must be approved separately." },
];

/** Read-only inventory. Grouping never enrolls a member, creates a plan, or enables delivery. */
export function buildCommunicationsCatalog(overview: CadenceManagementOverview, supplemental: CommunicationItem[] = []): CommunicationItem[] {
  const items: CommunicationItem[] = [];
  const sequenceIds = new Set(overview.sequences.map(item => item.id));
  for (const sequence of overview.sequences) items.push(...cadenceItems(sequence, "sequence", overview));
  for (const plan of overview.plans) {
    // A shared stage has one home. Missing-parent plans remain inspectable rather than disappearing.
    if (plan.sequenceId && sequenceIds.has(plan.sequenceId)) continue;
    items.push(...cadenceItems(plan, "event", overview));
  }
  for (const workflow of overview.managedElsewhere ?? []) {
    const state = { status: workflow.state === "configured" ? "enabled" as const : workflow.state === "paused" ? "paused" as const : "attention" as const, statusLabel: workflow.statusLabel };
    const common = { channel: "emails" as const, audience: workflow.recipients, ...state, detail: workflow.controlBoundary,
      action: { label: workflow.management.label, href: workflow.management.href } };
    if (workflow.id === "registration") {
      items.push({ ...common, id: "workflow:registration-welcome", bucket: "registration", title: "Registration welcome",
        trigger: "Registration becomes complete after its required information and payment requirements are met.",
        timing: "Once on completed registration. Pending messages are checked every five minutes." });
      items.push({ ...common, id: "workflow:profile-access", bucket: "pre-foundations", title: "Profile access ready",
        trigger: "An administrator grants the member profile access.",
        timing: "Once after profile access is granted. Pending messages are checked every five minutes." });
    } else {
      items.push({ ...common, id: `workflow:${workflow.id}`, bucket: workflow.id === "renewal" ? "membership" : "misc",
        title: workflow.title, trigger: workflow.trigger, timing: workflow.timing });
    }
  }
  items.push(...PLANNED_EMAILS.map(item => ({ ...item, channel: "emails" as const, status: "planned" as const, statusLabel: "Planned", timing: "Not scheduled" })));
  const seen = new Set<string>();
  return [...items, ...supplemental].filter(item => {
    if (!item.id || seen.has(item.id) || !CHANNEL_VALUES.includes(item.channel) || !BUCKET_VALUES.includes(item.bucket)) return false;
    seen.add(item.id);
    return true;
  });
}
