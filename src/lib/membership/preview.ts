import { deriveMemberAccessPolicy } from "@/lib/membership/access-policy";
import type {
  MemberAccountSnapshot,
  MemberArtifactsSnapshot,
  MemberCircleSnapshot,
  MemberExperiencesSnapshot,
  MemberHomeSnapshot,
  MemberIdentity,
  MemberLearningSnapshot,
  MemberLearningResourceDetail,
  MemberOnboardingSnapshot,
  MemberProfileSnapshot,
  MemberTimelineSnapshot,
  MemberUpdatesSnapshot,
  PrivacySafePersonSummary,
  ProgressionSummary,
} from "@/lib/membership/model";

export const PREVIEW_MEMBER_IDENTITY: MemberIdentity = {
  accountState: "active",
  administrativeOnboardingState: "completed",
  authUserId: "preview-auth-user",
  billingState: "active",
  cancellationEffectiveAt: null,
  email: "preview@ruined.local",
  foundationsState: "in_progress",
  memberId: "preview-member",
  personId: "preview-person",
  programState: "onboarding",
  standingState: "active",
};

const access = deriveMemberAccessPolicy(PREVIEW_MEMBER_IDENTITY);

export const PREVIEW_PROGRESSION: ProgressionSummary = {
  assignedAt: "2026-08-01T16:00:00.000Z",
  name: "Member",
  position: 1,
  slug: "member",
};

const previewPartner: PrivacySafePersonSummary = {
  avatarUrl: null,
  bio: "Building a quieter, more deliberate way to work.",
  buildingNow: "A studio practice with fewer, better decisions.",
  displayName: "Member 02",
  email: null,
  id: "preview-directory-02",
  isSelf: false,
  location: "Utah",
  phone: null,
};

const previewMeeting = {
  audienceLabel: "Circle 01",
  endsAt: "2026-09-04T02:30:00.000Z",
  id: "preview-meeting",
  kind: "circle_meeting",
  locationLabel: "Ruined Studio",
  meetingUrl: null,
  registrationHref: null,
  registrationState: "registered" as const,
  startsAt: "2026-09-04T01:00:00.000Z",
  summary: "A working session for the choices in front of the Circle.",
  title: "Circle 01 / Monthly room",
};

const previewExperience = {
  audienceLabel: "All members",
  endsAt: null,
  id: "preview-experience",
  kind: "gathering",
  locationLabel: "Tibble Fork Reservoir",
  meetingUrl: null,
  registrationHref: "/community/byob-02/register",
  registrationState: "external" as const,
  startsAt: "2026-09-11T14:00:00.000Z",
  summary: "Bring your own bell or bodyweight.",
  title: "BYOB Nº 02",
};

export const PREVIEW_MEMBER_HOME: MemberHomeSnapshot = {
  access,
  announcement: {
    body: "The next member room opens in September. Your Circle will receive the working notes first.",
    href: "/my/updates",
    id: "preview-announcement",
    publishedAt: "2026-08-25T16:00:00.000Z",
    title: "The next room",
  },
  artifact: null,
  avatarUrl: null,
  blockName: "Block 01",
  circleName: "Circle 01",
  displayName: "Preview member",
  foundations: {
    progressPercent: 72.73,
    requirements: {
      activeCircle: { completed: true, name: "Circle 01" },
      futureLetter: { completed: false, completedAt: null },
      moments: { completed: 16, total: 22 },
      timeline: { completed: true, completedAt: "2026-08-24T16:00:00.000Z", entryCount: 4 },
    },
    state: "in_progress",
  },
  identity: PREVIEW_MEMBER_IDENTITY,
  nextAction: {
    body: "Continue from the place you last left it. Your Circle is already in place.",
    href: "/my/foundations",
    kind: "foundations",
    title: "Continue Foundations",
  },
  nextExperience: previewExperience,
  nextMeeting: previewMeeting,
  partner: previewPartner,
  progression: PREVIEW_PROGRESSION,
  unreadUpdates: 2,
};

export const PREVIEW_MEMBER_PROFILE: MemberProfileSnapshot = {
  access,
  directory: {
    avatarUrl: null,
    bio: "Learning to make fewer promises and keep the ones that remain.",
    buildingNow: "A more deliberate creative practice.",
    displayName: "Preview member",
    location: "Alpine, Utah",
    preferredName: "Preview",
    timezone: "America/Denver",
  },
  email: PREVIEW_MEMBER_IDENTITY.email,
  foundationsState: PREVIEW_MEMBER_IDENTITY.foundationsState,
  memberId: PREVIEW_MEMBER_IDENTITY.memberId,
  preferences: {
    avatarVisible: true,
    bioVisible: true,
    buildingVisible: true,
    directoryStatus: "circle_visible",
    emailScope: "none",
    locationVisible: true,
    phoneScope: "accountability_partner",
    version: 1,
  },
  privateProfile: {
    accessibilityNotes: null,
    apparelSizing: null,
    birthDate: "1990-01-01",
    fulfillmentAddress: null,
    legalName: "Preview Member",
    mobile: "+18015550100",
  },
  progression: PREVIEW_PROGRESSION,
};

export const PREVIEW_MEMBER_ONBOARDING: MemberOnboardingSnapshot = {
  agreement: {
    acceptanceId: "preview-acceptance",
    acceptedAt: "2026-08-01T16:00:00.000Z",
    body: null,
    id: "preview-agreement-version",
    publishedAt: "2026-07-01T16:00:00.000Z",
    receiptId: "preview-receipt",
    title: "Ruined Membership Agreement",
    version: "preview-v1",
  },
  completedAt: "2026-08-01T16:00:00.000Z",
  email: PREVIEW_MEMBER_IDENTITY.email,
  profile: {
    apparelSizing: { top: "M" },
    avatarUrl: null,
    birthDate: "1990-01-01",
    fulfillmentAddress: {
      addressLine1: "01 Preview Way",
      city: "Alpine",
      countryCode: "US",
      postalCode: "84004",
      region: "UT",
    },
    legalName: "Preview Member",
    mobile: "+18015550100",
    preferredName: "Preview",
  },
  requiredFieldsComplete: true,
  state: "completed",
};

export const PREVIEW_MEMBER_CIRCLE: MemberCircleSnapshot = {
  access,
  accountabilityPartner: previewPartner,
  block: { id: "preview-block", name: "Block 01", status: "active" },
  circle: { id: "preview-circle", name: "Circle 01", status: "active" },
  leader: {
    avatarUrl: null,
    bio: null,
    buildingNow: null,
    displayName: "Circle leader",
    email: "leader@ruined.local",
    id: "preview-leader",
    isSelf: false,
    location: null,
    phone: null,
  },
  meetings: [previewMeeting],
  members: [
    {
      avatarUrl: null,
      bio: "Learning to make fewer promises and keep the ones that remain.",
      buildingNow: "A more deliberate creative practice.",
      displayName: "Preview member",
      email: PREVIEW_MEMBER_IDENTITY.email,
      id: "preview-directory-self",
      isSelf: true,
      location: "Alpine, Utah",
      phone: "+18015550100",
    },
    previewPartner,
  ],
  resources: [
    {
      description: "The standing notes for how the Circle holds the room.",
      href: "/my/learn",
      id: "preview-circle-resource",
      label: "Circle practice",
    },
  ],
};

export const PREVIEW_MEMBER_EXPERIENCES: MemberExperiencesSnapshot = {
  access,
  past: [],
  upcoming: [previewMeeting, previewExperience],
};

export const PREVIEW_MEMBER_LEARNING: MemberLearningSnapshot = {
  access,
  collections: [
    {
      description: "The shared language carried forward from Foundations.",
      id: "preview-learning-collection",
      name: "The practice",
      resources: [
        {
          collectionName: "The practice",
          href: "/my/learn/the-next-true-thing",
          id: "preview-learning-resource",
          publishedAt: "2026-08-20T16:00:00.000Z",
          resourceType: "article",
          summary: "A short field note on choosing what deserves the next move.",
          title: "The next true thing",
        },
      ],
      slug: "the-practice",
    },
  ],
  uncollected: [],
};

export const PREVIEW_MEMBER_LEARNING_DETAIL: MemberLearningResourceDetail = {
  access,
  bodyMarkdown:
    "The next true thing is rarely the loudest option. It is the choice that remains after performance, urgency, and borrowed expectation are removed.\n\nChoose one thing. Name why it matters. Let the rest wait.",
  collectionName: "The practice",
  externalUrl: null,
  publishedAt: "2026-08-20T16:00:00.000Z",
  resourceType: "article",
  slug: "the-next-true-thing",
  storageBucket: null,
  storagePath: null,
  summary: "A short field note on choosing what deserves the next move.",
  title: "The next true thing",
  version: 1,
};

export const PREVIEW_MEMBER_ARTIFACTS: MemberArtifactsSnapshot = {
  access,
  awards: [
    {
      artifactState: "collecting",
      awardId: "preview-artifact",
      earnedAt: "2026-08-25T16:00:00.000Z",
      earnedReason: "Foundations completed",
      fulfilledAt: null,
      imageUrl: null,
      inputRequired: true,
      name: "Foundations Artifact",
      trackingUrl: null,
    },
  ],
};

export const PREVIEW_MEMBER_UPDATES: MemberUpdatesSnapshot = {
  access,
  items: [
    {
      body: "The next member room opens in September. Your Circle will receive the working notes first.",
      href: "/my/experiences",
      id: "preview-update-announcement",
      kind: "announcement",
      publishedAt: "2026-08-25T16:00:00.000Z",
      readAt: null,
      title: "The next room",
    },
    {
      body: "Circle 01 is now active. The people closest to your work are in place.",
      href: "/my/circle",
      id: "preview-update-notification",
      kind: "notification",
      publishedAt: "2026-08-24T16:00:00.000Z",
      readAt: null,
      title: "Your Circle is in place",
    },
  ],
  unreadCount: 2,
};

export const PREVIEW_MEMBER_ACCOUNT: MemberAccountSnapshot = {
  access,
  agreement: {
    acceptedAt: "2026-08-01T16:00:00.000Z",
    receiptId: "preview-receipt",
    title: "Ruined Membership Agreement",
    version: "preview-v1",
  },
  billingState: "active",
  email: PREVIEW_MEMBER_IDENTITY.email,
  standingState: "active",
};

export const PREVIEW_MEMBER_TIMELINE: MemberTimelineSnapshot = {
  access,
  completedAt: "2026-08-24T16:00:00.000Z",
  entries: [
    {
      details: "The ending that changed the direction of the work.",
      id: "preview-timeline-01",
      position: 1,
      title: "The old version ended",
      year: 2021,
    },
    {
      details: null,
      id: "preview-timeline-02",
      position: 2,
      title: "The first deliberate rebuild",
      year: 2023,
    },
  ],
};
