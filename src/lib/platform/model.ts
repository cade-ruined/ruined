export type AccountState = "provisional" | "invited" | "active" | "suspended" | "closed";
export type ArtifactState = "not_started" | "collecting" | "in_production" | "fulfilled";
export type BillingState = "pending" | "active" | "attention_required" | "ended";
export type BlockState = "forming" | "active" | "completed" | "archived";
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
  blockName: string | null;
  blockStatus: BlockState | null;
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
  accountState: AccountState;
  artifactState: ArtifactState;
  billingState: BillingState;
  blockName: string | null;
  blockStatus: BlockState | null;
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

export type OperatorDashboardSnapshot = {
  activeMembers: number;
  attentionRequired: number;
  members: OperatorMemberSummary[];
  totalMembers: number;
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
  blockName: null,
  blockStatus: null,
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
    accountState: "active",
    artifactState: "collecting",
    billingState: "active",
    blockName: "Block 01",
    blockStatus: "active",
    circleName: "Circle 01",
    circleStatus: "active",
    email: "member01@ruined.local",
    foundationsProgress: 75,
    foundationsState: "in_progress",
    memberId: "preview-01",
    name: "Member 01",
    nextAction: "Complete CUT",
    programState: "active",
  },
  {
    accountState: "active",
    artifactState: "not_started",
    billingState: "attention_required",
    blockName: "Block 01",
    blockStatus: "active",
    circleName: "Circle 01",
    circleStatus: "active",
    email: "member02@ruined.local",
    foundationsProgress: 50,
    foundationsState: "in_progress",
    memberId: "preview-02",
    name: "Member 02",
    nextAction: "Resolve payment",
    programState: "paused",
  },
  {
    accountState: "invited",
    artifactState: "not_started",
    billingState: "pending",
    blockName: null,
    blockStatus: null,
    circleName: null,
    circleStatus: null,
    email: "member03@ruined.local",
    foundationsProgress: 0,
    foundationsState: "not_started",
    memberId: "preview-03",
    name: "Member 03",
    nextAction: "Complete membership entry",
    programState: "onboarding",
  },
  {
    accountState: "active",
    artifactState: "in_production",
    billingState: "active",
    blockName: "Block 01",
    blockStatus: "active",
    circleName: "Circle 02",
    circleStatus: "active",
    email: "member04@ruined.local",
    foundationsProgress: 100,
    foundationsState: "completed",
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
  totalMembers: PREVIEW_OPERATOR_MEMBERS.length,
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
