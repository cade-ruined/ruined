export type MemberFoundationEnrollmentStatus =
  | "not_started"
  | "in_progress"
  | "paused"
  | "completed"
  | "withdrawn";

export type MemberFoundationUnitStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "completed"
  | "blocked";

export type MemberFoundationUnit = {
  chapterId: string | null;
  id: string;
  kind: string;
  label: string;
  position: number;
  stage: string;
  status: MemberFoundationUnitStatus;
};

export type MemberFoundationsState = {
  activeCircleName: string | null;
  activeCircleStatus: "active" | "archived" | "completed" | "forming" | null;
  completedUnits: number;
  completionAvailable: boolean;
  enrollmentId: string | null;
  nextMomentId: string | null;
  progressPercent: number;
  readyForCircle: boolean;
  status: MemberFoundationEnrollmentStatus;
  totalUnits: number;
  units: MemberFoundationUnit[];
  version: number;
  versionTitle: string;
};

export const PREVIEW_MEMBER_FOUNDATIONS_STATE: MemberFoundationsState = {
  activeCircleName: null,
  activeCircleStatus: null,
  completedUnits: 5,
  completionAvailable: false,
  enrollmentId: "preview-foundations-enrollment",
  nextMomentId: "story-founder",
  progressPercent: 22.73,
  readyForCircle: false,
  status: "in_progress",
  totalUnits: 22,
  units: [],
  version: 1,
  versionTitle: "Founding Foundations",
};
