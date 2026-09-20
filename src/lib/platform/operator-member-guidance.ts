import type { OperatorMemberSummary } from "@/lib/platform/model";
import type { OpsMemberRecord, OpsRequirementSummary } from "@/lib/platform/ops-model";

export type OperatorMemberGuidance = {
  key: string;
  status: "Blocked" | "Waiting" | "Ready";
  actor: "Member" | "Operator" | "Support";
  title: string;
  detail: string;
  target: "membership" | "journey" | "record" | "circle-placement" | "circle-activation";
  placement: "blocked" | "review" | "ready" | "assigned";
};

type GuidanceState = {
  membershipFunding?: "self" | "operator" | "complimentary";
  projection: "summary" | "record";
  account: string;
  billing: string;
  foundations: string;
  artifact: string;
  circleState: string | null;
  onboarding?: string;
  admission?: string;
  standing?: string;
  program?: string;
  membership?: string;
  latestInvoiceState?: string | null;
  requirements?: OpsRequirementSummary[];
};

// Presentation only. This never grants access or substitutes for the mutation's
// current account, billing, program, assignment and capacity checks.
function guidance(state: GuidanceState): OperatorMemberGuidance {
  const complimentary = (state.membershipFunding === "operator" || state.membershipFunding === "complimentary");
  const result = (
    key: string, status: OperatorMemberGuidance["status"], actor: OperatorMemberGuidance["actor"],
    title: string, detail: string,
    target: OperatorMemberGuidance["target"] = "membership",
    placement: OperatorMemberGuidance["placement"] = "blocked",
  ): OperatorMemberGuidance => ({ key, status, actor, title, detail, target, placement });

  if (state.account === "suspended" || state.account === "closed") {
    return result(state.account, "Blocked", "Support", state.account === "suspended" ? "Review the account suspension" : "Review the closed account",
      "Ask an Administrator or connect@theruinedproject.com to review the account before continuing member setup. Do not work around this with a Circle or operator invitation.");
  }
  if (state.admission === "declined" || state.admission === "withdrawn" || state.program === "withdrawn") {
    return result("admission-review", "Blocked", "Support", "Review the membership decision", "This membership is declined or withdrawn. An Administrator must review the decision before setup can continue.");
  }
  if (state.standing === "paused" || state.program === "paused") {
    return result("paused", "Blocked", "Support", "Review the membership pause", "Confirm the pause terms with an Administrator before restarting participation or changing Circle placement.");
  }
  if (state.standing === "inactive" || (!complimentary && state.billing === "ended")) {
    return result("membership-ended", "Blocked", "Support", "Review the ended membership", "Ask an Administrator to review the membership and any return arrangements. A new Circle assignment does not reactivate membership.");
  }
  if (state.standing === "cancellation_requested") {
    return result("cancellation", "Waiting", "Support", "Review the cancellation timing", "Check the recorded effective date before planning further participation. A cancellation request does not by itself mean access has already ended.");
  }
  const known = [
    [state.account, ["provisional", "invited", "active"]],
    [state.billing, ["pending", "active", "attention_required", "ended"]],
    [state.foundations, ["not_started", "in_progress", "completed"]],
    [state.artifact, ["not_started", "collecting", "in_production", "fulfilled"]],
    [state.onboarding, ["not_started", "in_progress", "completed"]],
    [state.admission, ["interested", "applied", "invited", "accepted"]],
    [state.standing, ["pre_active", "active", "alumni"]],
    [state.program, ["prospect", "onboarding", "active", "completed"]],
    [state.membership, ["pending", "active", "attention_required", "ended"]],
  ] as const;
  if (known.some(([value, values]) => value !== undefined && !(values as readonly string[]).includes(value))) {
    return result("state-review", "Blocked", "Support", "Review the member states", "One of the recorded states needs review. Ask an Administrator to check the details before continuing setup.");
  }
  if (state.account !== "active") {
    return result("sign-in", "Waiting", "Member", "Sign in to start joining", "The member opens the shared sign-in page, requests their own code, and completes the joining steps. An operator cannot verify their email for them.");
  }
  const required = state.requirements?.filter((item) => item.required && !(complimentary && item.key === "billing"));
  const missing = required?.find((item) => item.state === "missing");
  const paymentRecorded = state.billing === "active" || state.latestInvoiceState === "paid"
    || required?.some((item) => item.key === "billing" && item.state === "complete");
  if (!complimentary && ((state.billing === "pending" && paymentRecorded)
    || (state.billing === "attention_required" && state.latestInvoiceState === "paid")
    || (state.billing === "pending" && state.onboarding === "completed")
    || (missing?.key === "billing" && paymentRecorded))) {
    return result("payment-confirmation", "Waiting", "Support", "Check payment confirmation", "Payment evidence or completed setup is already recorded, but the billing or joining checkpoints disagree. Ask Support to check the confirmation; do not ask the member to pay again.");
  }
  if (!complimentary && state.billing === "attention_required") {
    return result("payment-attention", "Waiting", "Member", "Update payment details", "The member reviews billing in their account. If payment already went through, ask Support to check confirmation before requesting another payment.");
  }
  if (((state.onboarding !== undefined && state.onboarding !== "completed") || state.standing === "pre_active") && required?.length && required.every((item) => item.state === "complete")) {
    if (complimentary) return result("joining", "Waiting", "Member", "Finish joining", "Profile and agreement are complete. The member confirms complimentary membership in their account.");
    return result("joining-confirmation", "Waiting", "Support", "Check joining confirmation", "All required joining steps are recorded as complete, but membership setup has not caught up. Ask Support to review the record rather than repeating agreement or payment steps.");
  }
  if ((state.onboarding !== undefined && state.onboarding !== "completed") || (!complimentary && state.billing === "pending") || state.standing === "pre_active") {
    if (complimentary) return result("joining", "Waiting", "Member", "Complete joining", "Complete the remaining profile and agreement steps, then confirm complimentary membership in your account.");
    const steps: Record<string, string> = {
      verified_email: "Next, the member verifies their email using their own sign-in code.",
      private_profile: "Next, the member completes their profile in the joining form.",
      agreement: "Next, the member reads and accepts the agreement themselves.",
      billing: "Next, the member completes payment in their account. If they already paid, ask Support to check confirmation first.",
    };
    return result("joining", "Waiting", "Member", "Complete joining",
      `${missing && steps[missing.key] ? steps[missing.key] : paymentRecorded
        ? "The member reviews any remaining joining details in their account. Payment is already recorded; ask Support to check any request to pay again."
        : "The member completes the remaining profile, agreement, and payment steps in their account."} Operators can review progress, but cannot accept the agreement or pay on the member’s behalf.`);
  }
  if ((!complimentary && state.membership !== undefined && state.membership !== "active") || state.program === "prospect") {
    return result("setup-review", "Blocked", "Support", "Review the membership setup", "Account and billing are active, but the membership or program record is not ready for placement. Ask an Administrator to review the details; do not request payment again.");
  }
  if (state.projection === "summary" && (state.membership === undefined || state.program === undefined)) {
    return result("readiness-review", "Waiting", "Operator", "Review membership readiness", "This directory view does not include every membership or program state. Open the member record to review readiness before changing placement; do not request payment again.", "membership", "review");
  }
  if (state.standing === "alumni" || state.program === "completed") {
    return result("ongoing-review", "Ready", "Operator", "Review ongoing participation", "Joining is no longer the next step. Review this member’s current participation arrangements before changing their Circle.", "journey");
  }
  if (state.circleState === null) {
    return result("circle-placement", state.program === undefined ? "Waiting" : "Ready", "Operator", "Review Circle placement",
      "An Administrator chooses a Circle with space. The Circle screen checks membership access, completed entry, program, and capacity before Add is available.", "circle-placement", state.program === undefined ? "review" : "ready");
  }
  if (state.circleState === "forming") {
    return result("circle-activation", "Waiting", "Operator", "Review Circle activation", "Placement is saved. An Administrator activates the Circle when it is ready to run. An active Circle is required to finish Foundations.", "circle-activation", "assigned");
  }
  if (state.circleState !== "active") {
    return result("circle-review", "Waiting", "Operator", "Review the Circle assignment", "The recorded Circle is not active. An Administrator should review the current assignment before continuing Foundations.", "circle-placement", "assigned");
  }
  if (state.foundations === "not_started" || state.foundations === "in_progress") {
    return result("foundations", "Waiting", "Member", "Continue Foundations", "The member completes their next Foundations step. Review their progress below; keep their own Timeline, Future Letter, and completion work with them.", "journey", "assigned");
  }
  if (state.artifact === "collecting") {
    return result("artifact-inputs", "Waiting", "Member", "Complete Artifact details", "The member supplies the remaining Artifact details. Review the award and fulfillment record below.", "journey", "assigned");
  }
  if (state.artifact === "in_production") {
    return result("artifact-production", "Waiting", "Operator", "Check Artifact fulfillment", "Review the production or fulfillment record for the next update. There is no need to repeat joining or Foundations.", "journey", "assigned");
  }
  return result("ready", "Ready", "Operator", "Review current activity", "No joining step is outstanding in this view. Check open tasks and recent activity for anything that needs follow-up.", "record", "assigned");
}

export function guidanceForMemberSummary(member: OperatorMemberSummary): OperatorMemberGuidance {
  return guidance({ projection: "summary", account: member.accountState, billing: member.billingState, foundations: member.foundationsState,
    artifact: member.artifactState, circleState: member.circleName ? member.circleStatus ?? "unknown" : null,
    membershipFunding: member.membershipFunding, onboarding: member.administrativeOnboardingState, standing: member.standingState,
    program: member.programState, membership: member.membershipState });
}

export function guidanceForMemberRecord(record: OpsMemberRecord): OperatorMemberGuidance {
  const state = record.header.states;
  return guidance({ projection: "record", account: state.account, billing: state.billing, foundations: state.foundations,
    artifact: state.artifact, circleState: record.community.circle?.state ?? (record.header.circleName ? "unknown" : null),
    onboarding: state.administrativeOnboarding, admission: state.admission, standing: state.standing,
    latestInvoiceState: record.membership.billing?.latestInvoiceState,
    membershipFunding: record.membership.membershipFunding,
    requirements: record.membership.onboarding.requirements });
}

export function memberGuidanceAction(next: OperatorMemberGuidance, memberId: string, canManageSetup: boolean) {
  if (next.key === "ongoing-review") return { href: "#journey", label: "Review ongoing participation" };
  if (next.target === "circle-placement" || next.target === "circle-activation") {
    return canManageSetup
      ? { href: `/ops/circles?memberId=${encodeURIComponent(memberId)}#${next.target === "circle-activation" ? "activate-circle" : "assign-member"}`, label: next.title }
      : { href: "#community", label: "View Circle placement" };
  }
  return { href: `#${next.target}`, label: next.target === "membership" ? "Review joining & billing" : next.target === "journey" ? "Review member progress" : "Review tasks & history" };
}
