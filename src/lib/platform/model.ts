export type AccountState = "provisional" | "invited" | "active" | "suspended" | "closed";
export type ArtifactState = "not_started" | "collecting" | "in_production" | "fulfilled";
export type BillingState = "pending" | "active" | "attention_required" | "ended";
export type CircleState = "forming" | "active" | "completed" | "archived";
export type FoundationsState = "not_started" | "in_progress" | "completed";
export type ProgramState =
  | "prospect"
  | "onboarding"
  | "active"
  | "paused"
  | "completed"
  | "withdrawn";

export type MemberPlatformSnapshot = {
  accountState: AccountState;
  artifactState: ArtifactState;
  billingState: BillingState;
  circleName: string | null;
  circleStatus: CircleState | null;
  email: string;
  foundationsProgress: number;
  foundationsState: FoundationsState;
  memberId: string;
  name: string;
  nextAction: string;
  programState: ProgramState;
};

export type OperatorMemberSummary = {
  artifactState: ArtifactState;
  billingState: BillingState;
  circleName: string | null;
  circleStatus: CircleState | null;
  foundationsProgress: number;
  memberId: string;
  name: string;
  nextAction: string;
  programState: ProgramState;
};

export type OperatorDashboardSnapshot = {
  activeMembers: number;
  attentionRequired: number;
  members: OperatorMemberSummary[];
  unassignedMembers: number;
};

export type PlatformViewer = {
  authUserId: string;
  email: string;
};

export function hasActiveMemberAccess(member: MemberPlatformSnapshot): boolean {
  return (
    member.accountState === "active" &&
    member.billingState === "active" &&
    (member.programState === "onboarding" || member.programState === "active")
  );
}

export const PREVIEW_MEMBER: MemberPlatformSnapshot = {
  accountState: "provisional",
  artifactState: "not_started",
  billingState: "pending",
  circleName: null,
  circleStatus: null,
  email: "preview@ruined.local",
  foundationsProgress: 0,
  foundationsState: "not_started",
  memberId: "preview-member",
  name: "Preview member",
  nextAction: "Connect Supabase and Stripe, then complete membership entry.",
  programState: "prospect",
};

const PREVIEW_OPERATOR_MEMBERS: OperatorMemberSummary[] = [
  {
    artifactState: "collecting",
    billingState: "active",
    circleName: "Circle 01",
    circleStatus: "active",
    foundationsProgress: 75,
    memberId: "preview-01",
    name: "Member 01",
    nextAction: "Complete CUT",
    programState: "active",
  },
  {
    artifactState: "not_started",
    billingState: "attention_required",
    circleName: "Circle 01",
    circleStatus: "active",
    foundationsProgress: 50,
    memberId: "preview-02",
    name: "Member 02",
    nextAction: "Resolve payment",
    programState: "paused",
  },
  {
    artifactState: "not_started",
    billingState: "pending",
    circleName: null,
    circleStatus: null,
    foundationsProgress: 0,
    memberId: "preview-03",
    name: "Member 03",
    nextAction: "Complete membership entry",
    programState: "onboarding",
  },
  {
    artifactState: "in_production",
    billingState: "active",
    circleName: "Circle 02",
    circleStatus: "active",
    foundationsProgress: 100,
    memberId: "preview-04",
    name: "Member 04",
    nextAction: "Review Artifact proof",
    programState: "active",
  },
];

export const PREVIEW_OPERATOR_DASHBOARD: OperatorDashboardSnapshot = {
  activeMembers: 2,
  attentionRequired: 1,
  members: PREVIEW_OPERATOR_MEMBERS,
  unassignedMembers: 1,
};

export function nextMemberAction({
  artifactState,
  billingState,
  foundationsState,
  hasCircle,
}: {
  artifactState: ArtifactState;
  billingState: BillingState;
  foundationsState: FoundationsState;
  hasCircle: boolean;
}): string {
  if (billingState === "attention_required") return "Resolve membership billing";
  if (billingState === "ended") return "Review membership status";
  if (billingState === "pending") return "Complete membership entry";
  if (foundationsState !== "completed") return "Continue Foundations";
  if (!hasCircle) return "Await Circle assignment";
  if (artifactState === "collecting") return "Complete Artifact inputs";
  if (artifactState === "in_production") return "Review Artifact status";
  return "Open your Circle";
}
