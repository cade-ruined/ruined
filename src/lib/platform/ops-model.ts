export type OpsAccessRole = "circle_leader" | "guide" | "ops_admin";

export type OpsCapability =
  | "accountability.manage"
  | "announcement.manage"
  | "artifact.manage"
  | "experience.manage"
  | "member.agreement_evidence.read"
  | "member.billing_detail.read"
  | "member.community.read"
  | "member.journey.read"
  | "member.note.write"
  | "member.operational_contact.read"
  | "member.override.write"
  | "member.private_profile.read"
  | "member.summary.read"
  | "task.manage"
  | "workflow.retry";

export type OpsAccessContext = {
  authUserId: string;
  capabilities: OpsCapability[];
  roles: OpsAccessRole[];
};

export type OpsStateSummary = {
  account: string;
  administrativeOnboarding: string;
  admission: string;
  artifact: string;
  billing: string;
  foundations: string;
  standing: string;
};

export type OpsMemberHeader = {
  blockName: string | null;
  circleName: string | null;
  lifecycleVersion: number;
  memberId: string;
  nextDecision: string;
  openWorkCount: number;
  personId: string;
  preferredName: string;
  primaryEmail: string | null;
  states: OpsStateSummary;
};

export type OpsRequirementSummary = {
  completedAt: string | null;
  key: string;
  label: string;
  required: boolean;
  state: "complete" | "missing" | "not_required";
};

export type OpsMemberMembershipRecord = {
  agreement: {
    acceptedAt: string | null;
    contentSha256: string | null;
    receiptId: string | null;
    receiptState: string;
    version: string | null;
  };
  billing: {
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    latestInvoiceAmountPaid: number | null;
    latestInvoiceCurrency: string | null;
    latestInvoiceState: string | null;
    stripeState: string | null;
  } | null;
  cancellation: {
    effectiveAt: string | null;
    requestedAt: string;
    state: string;
  } | null;
  contact: {
    email: string | null;
    legalName: string | null;
    phone: string | null;
    preferredName: string;
  };
  onboarding: {
    completedAt: string | null;
    requirements: OpsRequirementSummary[];
    state: string;
  };
};

export type OpsFoundationsStage = {
  completed: number;
  key: string;
  label: string;
  total: number;
};

export type OpsExperienceSummary = {
  completedAt: string | null;
  experienceId: string;
  kind: string;
  occurredAt: string | null;
  state: string;
  title: string;
};

export type OpsArtifactSummary = {
  artifactAwardId: string;
  artifactJobId: string | null;
  earnedAt: string;
  name: string;
  reason: string;
  state: string;
};

export type OpsMemberJourneyRecord = {
  artifacts: OpsArtifactSummary[];
  experiences: OpsExperienceSummary[];
  foundations: {
    activeCircleRequired: boolean;
    completedAt: string | null;
    futureLetterCompletedAt: string | null;
    progressPercent: number;
    stages: OpsFoundationsStage[];
    startedAt: string | null;
    state: string;
    timelineCompletedAt: string | null;
  };
  progression: {
    assignedAt: string;
    levelName: string;
  } | null;
};

export type OpsCircleMemberSummary = {
  memberId: string;
  preferredName: string;
};

export type OpsMemberCommunityRecord = {
  accountabilityPartner: {
    assignedAt: string;
    assignmentId: string;
    memberId: string;
    preferredName: string;
  } | null;
  block: {
    blockId: string;
    name: string;
    state: string;
  } | null;
  circle: {
    circleId: string;
    guides: string[];
    leaderName: string | null;
    members: OpsCircleMemberSummary[];
    name: string;
    state: string;
  } | null;
  meetings: OpsExperienceSummary[];
  resources: Array<{
    label: string;
    resourceId: string;
    url: string;
  }>;
};

export type OpsMemberNote = {
  body: string;
  category: string;
  createdAt: string;
  createdBy: string;
  noteId: string;
  visibility: string;
};

export type OpsTaskSummary = {
  assignedTo: string | null;
  completedAt: string | null;
  dueAt: string | null;
  priority: number;
  state: string;
  taskId: string;
  title: string;
};

export type OpsHistoryEvent = {
  actor: string | null;
  occurredAt: string;
  source: string;
  summary: string;
};

export type OpsMemberOperationalRecord = {
  history: OpsHistoryEvent[];
  notes: OpsMemberNote[];
  overrides: Array<{
    dimension: string;
    nextState: string;
    occurredAt: string;
    operator: string;
    reason: string;
  }>;
  tasks: OpsTaskSummary[];
};

export type OpsMemberRecord = {
  access: OpsAccessContext;
  community: OpsMemberCommunityRecord;
  header: OpsMemberHeader;
  journey: OpsMemberJourneyRecord;
  membership: OpsMemberMembershipRecord;
  operational: OpsMemberOperationalRecord;
};

export type OpsWorkItem =
  | {
      dueAt: string | null;
      kind: "artifact";
      label: string;
      memberId: string;
      memberName: string;
      priority: number;
      state: string;
      workId: string;
    }
  | {
      dueAt: string | null;
      kind: "task";
      label: string;
      memberId: string | null;
      memberName: string | null;
      priority: number;
      state: string;
      workId: string;
    }
  | {
      dueAt: string | null;
      errorCode: string;
      kind: "workflow_failure";
      label: string;
      memberId: string | null;
      memberName: string | null;
      priority: number;
      state: string;
      workId: string;
    };

export type OpsWorkQueue = {
  items: OpsWorkItem[];
  totals: {
    artifacts: number;
    failures: number;
    tasks: number;
  };
};

export type OpsSystemHealth = {
  services: Array<{
    detail: string;
    label: string;
    lastSucceededAt: string | null;
    state: "attention" | "connected" | "unavailable";
  }>;
  workflowFailures: Array<{
    actionId: string;
    actionType: string;
    attempts: number;
    errorCode: string;
    failedAt: string;
    state: string;
  }>;
};

export type OpsArtifactQueueItem = OpsArtifactSummary & {
  dueAt: string | null;
  memberId: string;
  memberName: string;
  priority: number;
};

export type OpsExperienceDirectoryItem = {
  endsAt: string | null;
  experienceId: string;
  kind: string;
  registeredCount: number;
  scope: string;
  startsAt: string | null;
  state: string;
  title: string;
};

export type OpsAnnouncementSummary = {
  announcementId: string;
  body: string;
  publishedAt: string | null;
  state: string;
  targetLabel: string;
  title: string;
};

export type OpsOverviewActivityKind =
  | "artifact"
  | "circle"
  | "experience"
  | "foundations"
  | "membership"
  | "operations";

export type OpsOverviewActivityTone = "attention" | "complete" | "neutral";

export type OpsOverviewActivityItem = {
  activityId: string;
  href: string | null;
  kind: OpsOverviewActivityKind;
  memberId: string | null;
  occurredAt: string;
  subject: string;
  summary: string;
  tone: OpsOverviewActivityTone;
};

export type OpsOverviewCounts = {
  activeMembers: number;
  attentionRequired: number;
  circles: {
    active: number;
    forming: number;
  };
  eligibleWithoutCircle: number;
  foundations: {
    completed: number;
    inProgress: number;
    notStarted: number;
  };
  totalMembers: number;
  work: {
    artifacts: number;
    failures: number;
    tasks: number;
  };
};

export type OpsOverviewData = {
  activity: OpsOverviewActivityItem[];
  canPlaceMembers: boolean;
  counts: OpsOverviewCounts;
  priorityWork: OpsWorkItem[];
  upcomingExperiences: OpsExperienceDirectoryItem[];
};
