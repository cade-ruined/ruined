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
  requirements?: {
    futureLetter: {
      completed: boolean;
      completedAt: string | null;
    };
    timeline: {
      completed: boolean;
      completedAt: string | null;
      entryCount: number;
    };
  };
  status: MemberFoundationEnrollmentStatus;
  totalUnits: number;
  units: MemberFoundationUnit[];
  version: number;
  versionTitle: string;
};
