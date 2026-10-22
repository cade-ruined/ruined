import { CADE_MANUAL_TEMPLATES } from "./cade-communications";
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
  status: "enabled" | "paused" | "attention" | "planned" | "manual" | "held" | "approved";
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

const HELD_EMAILS: ReadonlyArray<Pick<CommunicationItem, "id" | "bucket" | "title" | "trigger" | "audience" | "detail" | "timing">> = [
  { id: "held:email:profile-drip", bucket: "pre-foundations", title: "Make yourself recognizable", trigger: "Proposed profile follow-up after A few things worth knowing.", audience: "Members who still need their profile information.", timing: "Proposed: three days later at 3 p.m. MT; held", detail: "Confirm profile access, the completion link and timing. Full draft and decisions are in Libby’s work queue." },
  { id: "held:email:foundations-completion", bucket: "foundations", title: "Foundations completion", trigger: "Verified completion of every approved Foundations requirement.", audience: "Completed members only; incomplete members do not graduate through this email.", timing: "Held: confirm the send time after completion", detail: "Resolve completion criteria, Artifact award and fulfillment, leader title and downstream access. No Artifact or completion is inferred from attendance alone." },
  { id: "held:email:circle-reveal", bucket: "membership", title: "Circle reveal", trigger: "Verified completion and a confirmed Circle placement.", audience: "Completed members with a ready Circle, leader and call access.", timing: "Proposed: 24 hours after completion; held", detail: "Confirm reveal timing, Circle / leader information, access and the actual next calls. Existing placement behavior is separate; this email remains off." },
  { id: "held:email:missed-incomplete", bucket: "missed-protocol", title: "Missed / incomplete call protocols", trigger: "Unfinished process decision across Foundations, Membership and Circle calls.", audience: "Not selected until attendance, work and escalation rules are approved.", timing: "Not scheduled", detail: "One complete Libby work item contains all drafts and questions for review with Ty and Cade. No reusable templates, automatic follow-ups, deadlines or access consequences are enabled." },
  { id: "held:email:incomplete-foundations", bucket: "foundations", title: "Incomplete Foundations / blocked progression", trigger: "An incomplete Foundations requirement after the final call, once the process is agreed.", audience: "Not selected until the completion and catch-up rules are approved.", timing: "Not scheduled", detail: "A separate Libby work item retains this Foundations draft and its outstanding requirements, deadline, catch-up and progression decisions. No email or access restriction is enabled by this draft." },
  { id: "held:email:future-events", bucket: "misc", title: "Future event communications", trigger: "A future event whose process and communication strategy still need approval.", audience: "Not selected until the event category is approved.", timing: "Not scheduled", detail: "One category-level Libby work item holds the source and example. No send template or event automation is created." },
  { id: "held:email:later-anniversaries", bucket: "misc", title: "Registration anniversaries · year two and beyond", trigger: "A later registration anniversary, after its copy and rules are approved.", audience: "Future eligible anniversary members.", timing: "Not scheduled", detail: "The approved automated anniversary covers year one only. Libby’s work queue holds later-year planning." },
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
        timing: "Once on completed registration. Pending messages are checked every five minutes.",
        action: { label: "Edit template", href: "/ops/messages?mode=automations&bucket=registration&template=registration:welcome#registration-email-copy" } });
      items.push({ ...common, id: "workflow:pre-foundations", bucket: "pre-foundations", title: "A few things worth knowing.",
        trigger: "A new welcome is successfully delivered after this follow-up is released.",
        timing: "24 elapsed hours after the welcome; checked every five minutes.",
        action: { label: "Edit template", href: "/ops/messages?mode=automations&bucket=pre-foundations&template=registration:pre_foundations#registration-email-copy" },
        detail: `${workflow.controlBoundary} Waits for completed registration, a confirmed Foundations schedule and profile access. It does not replay old welcomes or send after the first call starts.` });
      items.push({ ...common, id: "workflow:profile-access", bucket: "pre-foundations", title: "Profile access ready",
        trigger: "An administrator grants the member profile access.",
        timing: "Once after profile access is granted. Pending messages are checked every five minutes.",
        action: { label: "Edit template", href: "/ops/messages?mode=automations&bucket=pre-foundations&template=registration:profile_ready#registration-email-copy" } });
    } else {
      items.push({ ...common, id: `workflow:${workflow.id}`, bucket: workflow.id === "renewal" ? "membership" : "misc",
        title: workflow.title, trigger: workflow.trigger, timing: workflow.timing });
    }
  }
  items.push(...HELD_EMAILS.map(item => ({ ...item, channel: "emails" as const, status: "held" as const, statusLabel: "Held", action: { label: "View work queue", href: "/ops/work" } })));
  items.push(...CADE_MANUAL_TEMPLATES.map(item => ({ id: `manual:${item.id}`, channel: item.channel, bucket: item.bucket, title: item.title,
    trigger: "An administrator selects and completes this approved one-off copy.", audience: "Only the affected, permitted recipients selected and reviewed for this message.",
    timing: "Manual · as needed", status: "manual" as const, statusLabel: "Copy approved · manual", detail: item.dependency,
    action: { label: item.channel === "emails" ? "Use in composer" : "Prepare text", href: `/ops/messages?mode=emails&manualTemplate=${item.id}` },
  })));
  const seen = new Set<string>();
  return [...items, ...supplemental].filter(item => {
    if (!item.id || seen.has(item.id) || !CHANNEL_VALUES.includes(item.channel) || !BUCKET_VALUES.includes(item.bucket)) return false;
    seen.add(item.id);
    return true;
  });
}
