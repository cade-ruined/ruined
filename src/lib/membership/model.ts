import type {
  AccountState,
  ArtifactState,
  BillingState,
  BlockState,
  CircleState,
  FoundationsState,
  ProgramState,
} from "@/lib/platform/model";

export type AdministrativeOnboardingState =
  | "not_started"
  | "in_progress"
  | "completed";

export type MembershipStandingState =
  | "pre_active"
  | "active"
  | "paused"
  | "cancellation_requested"
  | "inactive"
  | "alumni";

export type MemberCapability =
  | "account.read"
  | "artifacts.read"
  | "artifacts.write"
  | "circle.read"
  | "experiences.member"
  | "foundations.revisit"
  | "foundations.summary"
  | "foundations.write"
  | "home.read"
  | "learn.read"
  | "profile.read"
  | "profile.write"
  | "updates.read";

export type MemberAccessMode =
  | "entry"
  | "onboarding"
  | "full"
  | "limited"
  | "alumni"
  | "suspended";

export type MemberAccessPolicy = {
  accessEndsAt: string | null;
  capabilities: readonly MemberCapability[];
  mode: MemberAccessMode;
  reason: string | null;
};

export type MemberIdentity = {
  accountState: AccountState;
  administrativeOnboardingState: AdministrativeOnboardingState;
  authUserId: string;
  billingState: BillingState;
  cancellationEffectiveAt: string | null;
  email: string;
  foundationsState: FoundationsState;
  memberId: string;
  personId: string;
  programState: ProgramState;
  standingState: MembershipStandingState;
};

export type ProgressionSummary = {
  assignedAt: string | null;
  name: string;
  position: number;
  slug: "member" | "shaper" | "builder" | "author" | "partner";
};

export type MemberNextAction = {
  body: string;
  href: string;
  kind:
    | "account"
    | "artifact"
    | "billing"
    | "circle"
    | "experience"
    | "foundations"
    | "onboarding"
    | "timeline"
    | "updates";
  title: string;
};

export type FoundationRequirementSummary = {
  activeCircle: {
    completed: boolean;
    name: string | null;
  };
  futureLetter: {
    completed: boolean;
    completedAt: string | null;
  };
  moments: {
    completed: number;
    total: number;
  };
  timeline: {
    completed: boolean;
    completedAt: string | null;
    entryCount: number;
  };
};

export type FoundationSummary = {
  progressPercent: number;
  requirements: FoundationRequirementSummary;
  state: FoundationsState;
};

export type PrivacySafePersonSummary = {
  avatarUrl: string | null;
  bio: string | null;
  buildingNow: string | null;
  displayName: string;
  email: string | null;
  id: string;
  isSelf: boolean;
  location: string | null;
  phone: string | null;
};

export type MemberExperienceSummary = {
  audienceLabel: string;
  detailHref: string;
  endsAt: string | null;
  id: string;
  kind: string;
  locationLabel: string | null;
  meetingUrl: string | null;
  registrationHref: string | null;
  registrationState:
    | "available"
    | "cancelled"
    | "closed"
    | "external"
    | "none"
    | "registered"
    | "waitlisted";
  startsAt: string;
  summary: string | null;
  title: string;
};

export type MemberArtifactSummary = {
  artifactState: ArtifactState;
  awardId: string;
  earnedAt: string;
  earnedReason: string;
  fulfilledAt: string | null;
  imageUrl: string | null;
  inputRequired: boolean;
  name: string;
  trackingUrl: string | null;
};

export type MemberAnnouncementSummary = {
  body: string;
  href: string | null;
  id: string;
  publishedAt: string;
  title: string;
};

export type MemberHomeSnapshot = {
  access: MemberAccessPolicy;
  announcement: MemberAnnouncementSummary | null;
  artifact: MemberArtifactSummary | null;
  artifacts: MemberArtifactSummary[];
  avatarUrl: string | null;
  blockName: string | null;
  circleMembers: PrivacySafePersonSummary[];
  circleName: string | null;
  displayName: string;
  foundations: FoundationSummary;
  identity: MemberIdentity;
  memberSince: string | null;
  nextAction: MemberNextAction;
  nextExperience: MemberExperienceSummary | null;
  nextMeeting: MemberExperienceSummary | null;
  partner: PrivacySafePersonSummary | null;
  profile: {
    bio: string | null;
    buildingNow: string | null;
    directoryStatus: MemberDirectoryPreferences["directoryStatus"];
    displayName: string;
    fullName: string | null;
    location: string | null;
    preferredName: string | null;
    timezone: string | null;
  };
  progression: ProgressionSummary;
  unreadUpdates: number;
  upcomingExperiences: MemberExperienceSummary[];
};

export type MemberDirectoryPreferences = {
  avatarVisible: boolean;
  bioVisible: boolean;
  buildingVisible: boolean;
  directoryStatus: "circle_visible" | "hidden";
  emailScope: "accountability_partner" | "circle" | "none";
  locationVisible: boolean;
  phoneScope: "accountability_partner" | "circle" | "none";
  version: number;
};

export type MemberProfileSnapshot = {
  access: MemberAccessPolicy;
  directory: {
    avatarUrl: string | null;
    bio: string | null;
    buildingNow: string | null;
    displayName: string;
    location: string | null;
    preferredName: string | null;
    timezone: string | null;
  };
  email: string;
  foundationsState: FoundationsState;
  memberId: string;
  privateProfile: {
    accessibilityNotes: string | null;
    apparelSizing: Record<string, unknown> | null;
    birthDate: string | null;
    fulfillmentAddress: Record<string, unknown> | null;
    legalName: string | null;
    mobile: string | null;
  };
  preferences: MemberDirectoryPreferences;
  progression: ProgressionSummary;
};

export type MemberOnboardingSnapshot = {
  agreement: {
    acceptanceId: string | null;
    acceptedAt: string | null;
    body: string | null;
    id: string | null;
    publishedAt: string | null;
    receiptId: string | null;
    title: string | null;
    version: string | null;
  };
  completedAt: string | null;
  email: string;
  profile: Pick<
    MemberProfileSnapshot["privateProfile"],
    | "apparelSizing"
    | "birthDate"
    | "fulfillmentAddress"
    | "legalName"
    | "mobile"
  > & {
    avatarUrl: string | null;
    preferredName: string | null;
  };
  requiredFieldsComplete: boolean;
  state: AdministrativeOnboardingState;
};

export type MemberCircleSnapshot = {
  access: MemberAccessPolicy;
  accountabilityPartner: PrivacySafePersonSummary | null;
  block: {
    id: string;
    name: string;
    status: BlockState;
  } | null;
  circle: {
    id: string;
    name: string;
    status: CircleState;
  } | null;
  leader: PrivacySafePersonSummary | null;
  meetings: MemberExperienceSummary[];
  members: PrivacySafePersonSummary[];
  resources: Array<{
    description: string | null;
    href: string;
    id: string;
    label: string;
  }>;
};

export type MemberExperiencesSnapshot = {
  access: MemberAccessPolicy;
  past: MemberExperienceSummary[];
  upcoming: MemberExperienceSummary[];
};

export type MemberLearningResourceSummary = {
  collectionName: string | null;
  href: string;
  id: string;
  publishedAt: string;
  resourceType: "article" | "audio" | "download" | "external_link" | "video";
  summary: string | null;
  title: string;
};

export type MemberLearningSnapshot = {
  access: MemberAccessPolicy;
  collections: Array<{
    description: string | null;
    id: string;
    name: string;
    resources: MemberLearningResourceSummary[];
    slug: string;
  }>;
  uncollected: MemberLearningResourceSummary[];
};

export type MemberLearningResourceDetail = {
  access: MemberAccessPolicy;
  bodyMarkdown: string | null;
  collectionName: string | null;
  externalUrl: string | null;
  publishedAt: string;
  resourceType: MemberLearningResourceSummary["resourceType"];
  slug: string;
  storageBucket: string | null;
  storagePath: string | null;
  summary: string | null;
  title: string;
  version: number;
};

export type MemberArtifactsSnapshot = {
  access: MemberAccessPolicy;
  awards: MemberArtifactSummary[];
};

export type MemberUpdateItem = {
  body: string;
  href: string | null;
  id: string;
  kind: "announcement" | "notification";
  publishedAt: string;
  readAt: string | null;
  title: string;
};

export type MemberUpdatesSnapshot = {
  access: MemberAccessPolicy;
  items: MemberUpdateItem[];
  unreadCount: number;
};

export type MemberAccountSnapshot = {
  access: MemberAccessPolicy;
  agreement: {
    acceptedAt: string | null;
    receiptId: string | null;
    title: string | null;
    version: string | null;
  };
  billingState: BillingState;
  email: string;
  standingState: MembershipStandingState;
};

export type MemberTimelineEntry = {
  details: string | null;
  id: string;
  position: number;
  title: string;
  year: number;
};

export type MemberTimelineSnapshot = {
  access: MemberAccessPolicy;
  completedAt: string | null;
  entries: MemberTimelineEntry[];
};
