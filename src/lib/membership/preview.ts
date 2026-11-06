import { deriveMemberAccessPolicy } from "@/lib/membership/access-policy";
import { FOUNDATION_MOMENTS } from "@/data/foundations";
import type { MemberFoundationsState } from "@/lib/foundations/model";
import { getUpcomingPublicMemberExperiences } from "@/lib/events/member-experiences";
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
} from "@/lib/membership/model";

export const PREVIEW_REFERENCE_DATE = "2026-08-27T12:00:00.000Z";

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

const previewPartner: PrivacySafePersonSummary = {
  avatarUrl: null,
  bio: "Building a quieter, more deliberate way to work.",
  buildingNow: "A studio practice with fewer, better decisions.",
  displayName: "Mara Bell",
  memberTag: null,
  email: null,
  id: "preview-directory-02",
  isSelf: false,
  location: "Utah",
  phone: null,
};

const previewMeeting = {
  audienceLabel: "Circle 01",
  detailHref: "/my/circle",
  endsAt: "2026-09-04T02:30:00.000Z",
  id: "preview-meeting",
  kind: "circle_meeting",
  locationLabel: "Ruined Studio",
  meetingUrl: null,
  registrationHref: null,
  registrationState: "registered" as const,
  startsAt: "2026-09-04T01:00:00.000Z",
  summary: "A working session for the choices in front of the Circle.",
  timezone: "America/Denver",
  title: "Circle 01 / Monthly room",
};

const previewPublicExperiences = getUpcomingPublicMemberExperiences(
  Date.parse(PREVIEW_REFERENCE_DATE),
);
const previewExperience = previewPublicExperiences[0] ?? null;
const previewUpcomingExperiences = [previewMeeting, ...previewPublicExperiences]
  .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));

const previewArtifact = {
  acquisitionType: "gifted" as const,
  artifactState: "collecting" as const,
  awardId: "preview-artifact",
  description: "A hand-forged artifact.",
  earnedAt: "2026-08-25T16:00:00.000Z",
  earnedReason: "Welcome gift",
  fulfilledAt: null,
  imageUrl: null,
  inputRequired: true,
  name: "The First Coin",
  product: null,
  trackingUrl: null,
};

const previewSelf: PrivacySafePersonSummary = {
  avatarUrl: null,
  bio: "Learning to make fewer promises and keep the ones that remain.",
  buildingNow: "A more deliberate creative practice.",
  displayName: "Preview member",
  memberTag: "preview_member",
  email: PREVIEW_MEMBER_IDENTITY.email,
  id: "preview-directory-self",
  publicProfileHref: "/profile/preview_member",
  isSelf: true,
  location: "Alpine, Utah",
  phone: "+18015550100",
};

const previewCircleMembers: PrivacySafePersonSummary[] = [
  previewSelf,
  previewPartner,
  {
    avatarUrl: null,
    bio: "Turning overlooked materials into useful objects.",
    buildingNow: "A small-batch furniture workshop.",
    displayName: "Jonah Reed",
    memberTag: null,
    email: null,
    id: "preview-directory-03",
    isSelf: false,
    location: "Ogden, Utah",
    phone: null,
  },
  {
    avatarUrl: null,
    bio: "Making systems that leave more room for people.",
    buildingNow: "A neighborhood design practice.",
    displayName: "Sana Park",
    memberTag: null,
    email: null,
    id: "preview-directory-04",
    isSelf: false,
    location: "Salt Lake City, Utah",
    phone: null,
  },
  {
    avatarUrl: null,
    bio: "Writing about work, attention, and the American West.",
    buildingNow: "A first collection of essays.",
    displayName: "Eli Mercer",
    memberTag: null,
    email: null,
    id: "preview-directory-05",
    isSelf: false,
    location: "Provo, Utah",
    phone: null,
  },
  {
    avatarUrl: null,
    bio: "Rebuilding a family trade for a slower future.",
    buildingNow: "A contemporary metal shop.",
    displayName: "Niko Tan",
    memberTag: null,
    email: null,
    id: "preview-directory-06",
    isSelf: false,
    location: "Park City, Utah",
    phone: null,
  },
  {
    avatarUrl: null,
    bio: "Helping independent teams make clearer choices.",
    buildingNow: "A strategy studio for owner-led companies.",
    displayName: "Rae Morgan",
    memberTag: null,
    email: null,
    id: "preview-directory-07",
    isSelf: false,
    location: "Draper, Utah",
    phone: null,
  },
  {
    avatarUrl: null,
    bio: "Photographing the places people pass without seeing.",
    buildingNow: "A long-form documentary project.",
    displayName: "Tomas Vale",
    memberTag: null,
    email: null,
    id: "preview-directory-08",
    isSelf: false,
    location: "Heber, Utah",
    phone: null,
  },
  {
    avatarUrl: null,
    bio: "Building gatherings around food, memory, and place.",
    buildingNow: "A twelve-seat neighborhood table.",
    displayName: "Imani Cole",
    memberTag: null,
    email: null,
    id: "preview-directory-09",
    isSelf: false,
    location: "Millcreek, Utah",
    phone: null,
  },
  {
    avatarUrl: null,
    bio: "Making durable tools for independent creative work.",
    buildingNow: "A focused publishing platform.",
    displayName: "Noah Quinn",
    memberTag: null,
    email: null,
    id: "preview-directory-10",
    isSelf: false,
    location: "Lehi, Utah",
    phone: null,
  },
];

export const PREVIEW_MEMBER_HOME: MemberHomeSnapshot = {
  access,
  announcement: {
    body: "The next member room opens in September. Your Circle will receive the working notes first.",
    href: "/my/updates",
    id: "preview-announcement",
    publishedAt: "2026-08-25T16:00:00.000Z",
    title: "The next room",
  },
  artifact: previewArtifact,
  artifacts: [previewArtifact],
  avatarUrl: null,
  blockName: "Block 01",
  circleMembers: previewCircleMembers,
  circleName: "Circle 01",
  displayName: "Preview member",
  foundations: {
    progressPercent: 72.73,
    requirements: {
      activeCircle: { completed: true, name: "Circle 01" },
      futureLetter: { completed: false, completedAt: null },
      moments: { completed: 16, total: 22 },
      timeline: { completed: true, completedAt: "2026-08-24T16:00:00.000Z", entryCount: 2 },
    },
    state: "in_progress",
  },
  identity: PREVIEW_MEMBER_IDENTITY,
  memberNumber: 1,
  memberSince: "2026-08-01T16:00:00.000Z",
  nextAction: {
    body: "Continue from the place you last left it. Your Circle is already in place.",
    href: "/my/foundations",
    kind: "foundations",
    title: "Continue Foundations",
  },
  nextExperience: previewExperience,
  nextMeeting: previewMeeting,
  profile: {
    bio: "Learning to make fewer promises and keep the ones that remain.",
    buildingNow: "A more deliberate creative practice.",
    directoryStatus: "circle_visible",
    displayName: "Preview member",
    memberTag: "preview_member",
    fullName: "Preview Member",
    location: "Alpine, Utah",
    preferredName: "Preview",
    timezone: "America/Denver",
  },
  unreadUpdates: 2,
  upcomingExperiences: previewUpcomingExperiences,
};

export const PREVIEW_MEMBER_PROFILE: MemberProfileSnapshot = {
  revision: "0".repeat(64),
  access,
  directory: {
    avatarUrl: null,
    bio: "Learning to make fewer promises and keep the ones that remain.",
    buildingNow: "A more deliberate creative practice.",
    displayName: "Preview Member",
    fullName: "Preview Member",
    city: "Alpine",
    state: "Utah",
    memberTag: "preview_member",
    location: "Alpine, Utah",
    preferredName: "Preview",
    timezone: "America/Denver",
    websiteUrl: null,
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
    phoneScope: "none",
    version: 1,
  },
  privateProfile: {
    accessibilityNotes: null,
    apparelSizing: { top: "M" },
    birthDate: "1990-01-01",
    fulfillmentAddress: { addressLine1: "01 Preview Way", city: "Alpine", countryCode: "US", postalCode: "84004", region: "UT" },
    legalName: "Preview Member",
    mobile: "+18015550100",
  },
};

export const PREVIEW_MEMBER_ONBOARDING: MemberOnboardingSnapshot = {
  billingState: "pending",
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
    apparelSizing: PREVIEW_MEMBER_PROFILE.privateProfile.apparelSizing,
    avatarUrl: null,
    birthDate: "1990-01-01",
    fulfillmentAddress: PREVIEW_MEMBER_PROFILE.privateProfile.fulfillmentAddress,
    legalName: "Preview Member",
    mobile: "+18015550100",
    preferredName: "Preview",
    memberTag: "preview_member",
  },
  requiredFieldsComplete: true,
  state: "completed",
};

export const PREVIEW_MEMBER_CIRCLE: MemberCircleSnapshot = {
  access,
  block: { id: "preview-block", name: "Block 01", status: "active" },
  circle: { id: "preview-circle", name: "Circle 01", status: "active" },
  communication: { chatHref: null, chatState: "unavailable" },
  shaper: {
    avatarUrl: null,
    bio: null,
    buildingNow: null,
    displayName: "Tyler Bastian",
    memberTag: null,
    email: "leader@ruined.local",
    id: "preview-leader",
    isSelf: false,
    location: null,
    phone: null,
  },
  meetings: [previewMeeting],
  members: previewCircleMembers,
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
  upcoming: previewUpcomingExperiences,
};

export const PREVIEW_MEMBER_LEARNING_DETAILS = {
  "foundations-01": {
    access,
    bodyMarkdown:
      "Revisit the first Foundations call: awareness, responsibility, creation, and your Timeline practice.\n\nWhen you are ready, take what you notice back into Foundations 01. Your work picks up where you left it.",
    captionsUrl: null,
    collectionName: "Foundations",
    durationLabel: "43 min",
    externalUrl: null,
    featured: true,
    presenter: "Ruined",
    publishedAt: "2026-11-06T00:00:00.000Z",
    resourceType: "video",
    slug: "foundations-01",
    storageBucket: null,
    storagePath: null,
    summary: "Awareness, responsibility, creation — and the stories that brought you here.",
    thumbnailUrl: "/membership/library/foundations-01.jpg",
    title: "Foundations 01",
    version: 1,
    videoUrl: "/api/preview/library-video",
  },
} satisfies Record<string, MemberLearningResourceDetail>;

type PreviewLearningSlug = keyof typeof PREVIEW_MEMBER_LEARNING_DETAILS;

export function getPreviewMemberLearningResource(
  slug: string,
): MemberLearningResourceDetail | null {
  return (
    (PREVIEW_MEMBER_LEARNING_DETAILS as Record<string, MemberLearningResourceDetail>)[slug] ??
    null
  );
}

function previewLearningSummary(
  id: string,
  slug: PreviewLearningSlug,
): MemberLearningSnapshot["collections"][number]["resources"][number] {
  const resource = PREVIEW_MEMBER_LEARNING_DETAILS[slug];
  return {
    captionsUrl: resource.captionsUrl,
    collectionName: resource.collectionName,
    durationLabel: resource.durationLabel,
    featured: resource.featured,
    href: `/my/library/${resource.slug}`,
    id,
    presenter: resource.presenter,
    publishedAt: resource.publishedAt,
    resourceType: resource.resourceType,
    summary: resource.summary,
    thumbnailUrl: resource.thumbnailUrl,
    title: resource.title,
    videoUrl: resource.videoUrl,
  };
}

export const PREVIEW_MEMBER_LEARNING: MemberLearningSnapshot = {
  access,
  collections: [
    {
      description: "The shared starting point. Return to the calls and bring them into your work.",
      id: "preview-learning-foundations",
      name: "Foundations",
      resources: [previewLearningSummary("preview-learning-foundations-01", "foundations-01")],
      slug: "foundations",
    },
  ],
  uncollected: [],
};

export const PREVIEW_MEMBER_ARTIFACTS: MemberArtifactsSnapshot = {
  access,
  awards: [previewArtifact],
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
  subscription: null,
  email: PREVIEW_MEMBER_IDENTITY.email,
  standingState: "active",
};

export const PREVIEW_MEMBER_TIMELINE: MemberTimelineSnapshot = {
  access,
  completedAt: "2026-08-24T16:00:00.000Z",
  revision: "0",
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

// Every member surface describes the same person and the same saved progress.
const previewCompletedUnits = PREVIEW_MEMBER_HOME.foundations.requirements.moments.completed;
export const PREVIEW_MEMBER_FOUNDATIONS_STATE: MemberFoundationsState = {
  activeCircleName: PREVIEW_MEMBER_CIRCLE.circle?.name ?? null,
  activeCircleStatus: PREVIEW_MEMBER_CIRCLE.circle?.status ?? null,
  completedUnits: previewCompletedUnits,
  completionAvailable: false,
  enrollmentId: "preview-foundations-enrollment",
  nextMomentId: FOUNDATION_MOMENTS[previewCompletedUnits]?.id ?? null,
  progressPercent: PREVIEW_MEMBER_HOME.foundations.progressPercent,
  readyForCircle: false,
  requirements: {
    futureLetter: PREVIEW_MEMBER_HOME.foundations.requirements.futureLetter,
    timeline: {
      completed: PREVIEW_MEMBER_TIMELINE.completedAt !== null,
      completedAt: PREVIEW_MEMBER_TIMELINE.completedAt,
      entryCount: PREVIEW_MEMBER_TIMELINE.entries.length,
    },
  },
  status: PREVIEW_MEMBER_IDENTITY.foundationsState,
  totalUnits: FOUNDATION_MOMENTS.length,
  units: FOUNDATION_MOMENTS.map((moment, index) => ({
    chapterId: "chapterId" in moment ? moment.chapterId : null,
    id: moment.id,
    kind: moment.kind,
    label: moment.label,
    position: index + 1,
    stage: moment.stage,
    status: index < previewCompletedUnits ? "completed" : index === previewCompletedUnits ? "in_progress" : "not_started",
  })),
  version: 1,
  versionTitle: "Founding Foundations",
};
