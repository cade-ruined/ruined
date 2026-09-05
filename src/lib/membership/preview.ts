import { deriveMemberAccessPolicy } from "@/lib/membership/access-policy";
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
  Date.parse("2026-08-27T12:00:00.000Z"),
);
const previewExperience = previewPublicExperiences[0] ?? null;
const previewUpcomingExperiences = [previewMeeting, ...previewPublicExperiences]
  .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));

const previewArtifact = {
  acquisitionType: "earned" as const,
  artifactState: "collecting" as const,
  awardId: "preview-artifact",
  description: "A hand-forged artifact.",
  earnedAt: "2026-08-25T16:00:00.000Z",
  earnedReason: "Foundations completed",
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
  email: PREVIEW_MEMBER_IDENTITY.email,
  id: "preview-directory-self",
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
      timeline: { completed: true, completedAt: "2026-08-24T16:00:00.000Z", entryCount: 4 },
    },
    state: "in_progress",
  },
  identity: PREVIEW_MEMBER_IDENTITY,
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
    fullName: "Preview Member",
    location: "Alpine, Utah",
    preferredName: "Preview",
    timezone: "America/Denver",
  },
  unreadUpdates: 2,
  upcomingExperiences: previewUpcomingExperiences,
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
    phoneScope: "none",
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
  block: { id: "preview-block", name: "Block 01", status: "active" },
  circle: { id: "preview-circle", name: "Circle 01", status: "active" },
  communication: { chatHref: null, chatState: "unavailable" },
  shaper: {
    avatarUrl: null,
    bio: null,
    buildingNow: null,
    displayName: "Tyler Bastian",
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
  "welcome-to-ruined": {
    access,
    bodyMarkdown:
      "Ruined begins with removal. We take away borrowed expectations, unnecessary noise, and the performance of having it figured out. What remains is the work that is actually yours.\n\nUse this Academy as a working shelf. Take one lesson into the week, test it in real life, and bring what happened back to your Circle.",
    captionsUrl: null,
    collectionName: "Start here",
    durationLabel: "00:25",
    externalUrl: null,
    featured: true,
    presenter: "Ruined",
    publishedAt: "2026-08-28T16:00:00.000Z",
    resourceType: "video",
    slug: "welcome-to-ruined",
    storageBucket: null,
    storagePath: null,
    summary: "Meet the people, place, and premise behind the work.",
    thumbnailUrl: "/media/meet-the-cast-poster.jpg",
    title: "Welcome to Ruined",
    version: 1,
    videoUrl: "/media/meet-the-cast.mp4",
  },
  "the-next-true-thing": {
    access,
    bodyMarkdown:
      "The next true thing is rarely the loudest option. It is the choice that remains after performance, urgency, and borrowed expectation are removed.\n\nChoose one thing. Name why it matters. Let the rest wait.",
    captionsUrl: null,
    collectionName: "Start here",
    durationLabel: "04 min",
    externalUrl: null,
    featured: false,
    presenter: "Cade Mangelson",
    publishedAt: "2026-08-20T16:00:00.000Z",
    resourceType: "article",
    slug: "the-next-true-thing",
    storageBucket: null,
    storagePath: null,
    summary: "A field note on choosing what deserves the next move.",
    thumbnailUrl: "/media/what-is-this.webp",
    title: "The next true thing",
    version: 1,
    videoUrl: null,
  },
  "what-we-remove": {
    access,
    bodyMarkdown:
      "Removal is not minimalism for appearance's sake. It is a way to expose the decision hiding under the noise.\n\nName what is decorative, inherited, delayed, or performed. Remove one layer at a time until the work can stand on its own.",
    captionsUrl: null,
    collectionName: "Start here",
    durationLabel: "06 min",
    externalUrl: null,
    featured: false,
    presenter: "Ruined",
    publishedAt: "2026-08-18T16:00:00.000Z",
    resourceType: "article",
    slug: "what-we-remove",
    storageBucket: null,
    storagePath: null,
    summary: "The difference between stripping something down and making it clear.",
    thumbnailUrl: "/after-the-fear-hero.webp",
    title: "What we remove",
    version: 1,
    videoUrl: null,
  },
  "hold-the-room": {
    access,
    bodyMarkdown:
      "A useful room does not rush to fill silence. It gives the truth enough time to arrive.\n\nBefore your next Circle, lower the pace. Ask one honest question. Let the first answer pass, then stay for the answer underneath it.",
    captionsUrl: null,
    collectionName: "The practice",
    durationLabel: "00:08",
    externalUrl: null,
    featured: false,
    presenter: "Ruined",
    publishedAt: "2026-08-16T16:00:00.000Z",
    resourceType: "video",
    slug: "hold-the-room",
    storageBucket: null,
    storagePath: null,
    summary: "A short visual reset before the next honest conversation.",
    thumbnailUrl: "/ruined-hero-lounge.jpg",
    title: "Fireside / Hold the room",
    version: 1,
    videoUrl: "/sequences/fireside/fire-stream-loop-mobile.mp4",
  },
  "work-without-performance": {
    access,
    bodyMarkdown:
      "Performance asks how the work will look. Practice asks what the work requires. Those questions create different days.\n\nProtect a block of time that cannot be displayed, announced, or optimized. Use it to make the part only you can make.",
    captionsUrl: null,
    collectionName: "The practice",
    durationLabel: "07 min",
    externalUrl: null,
    featured: false,
    presenter: "Cade Mangelson",
    publishedAt: "2026-08-12T16:00:00.000Z",
    resourceType: "article",
    slug: "work-without-performance",
    storageBucket: null,
    storagePath: null,
    summary: "Build a practice that remains useful when nobody is watching.",
    thumbnailUrl: "/ruined-work-shelf.webp",
    title: "Work without performance",
    version: 1,
    videoUrl: null,
  },
  "bring-your-own-burden-01": {
    access,
    bodyMarkdown:
      "Bring Your Own Burden is a room for telling the truth without turning it into content. Watch how the first gathering held tension, humor, and unfinished work at the same table.\n\nAfter watching, write down what you would bring into the room and what you would be willing to leave there.",
    captionsUrl: null,
    collectionName: "Field films",
    durationLabel: "00:29",
    externalUrl: null,
    featured: false,
    presenter: "Ruined Community",
    publishedAt: "2026-08-10T16:00:00.000Z",
    resourceType: "video",
    slug: "bring-your-own-burden-01",
    storageBucket: null,
    storagePath: null,
    summary: "A field film from the first Bring Your Own Burden gathering.",
    thumbnailUrl: "/events/byob-01-recap-poster.webp?v=2",
    title: "Bring Your Own Burden / 01",
    version: 1,
    videoUrl: "/events/byob-01-recap.mp4?v=2",
  },
  "after-the-fear": {
    access,
    bodyMarkdown:
      "Fear gets loud near the edge of a real decision. The aim is not to wait until it disappears. The aim is to make the next honest move while it is still in the room.\n\nWrite the decision in one sentence. Remove every imagined audience. What remains is where the work begins.",
    captionsUrl: null,
    collectionName: "Field films",
    durationLabel: "05 min",
    externalUrl: null,
    featured: false,
    presenter: "Ruined",
    publishedAt: "2026-08-08T16:00:00.000Z",
    resourceType: "article",
    slug: "after-the-fear",
    storageBucket: null,
    storagePath: null,
    summary: "A field note for the moment after certainty stops being available.",
    thumbnailUrl: "/after-the-fear-hero.webp",
    title: "After the fear",
    version: 1,
    videoUrl: null,
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
    href: `/my/learn/${resource.slug}`,
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
      description: "The shared language and first moves of Ruined membership.",
      id: "preview-learning-start-here",
      name: "Start here",
      resources: [
        previewLearningSummary("preview-learning-welcome", "welcome-to-ruined"),
        previewLearningSummary("preview-learning-next-true-thing", "the-next-true-thing"),
        previewLearningSummary("preview-learning-what-we-remove", "what-we-remove"),
      ],
      slug: "start-here",
    },
    {
      description: "Training for clearer attention, steadier work, and more useful rooms.",
      id: "preview-learning-practice",
      name: "The practice",
      resources: [
        previewLearningSummary("preview-learning-hold-room", "hold-the-room"),
        previewLearningSummary(
          "preview-learning-work-without-performance",
          "work-without-performance",
        ),
      ],
      slug: "the-practice",
    },
    {
      description: "The principles tested in gatherings, studios, and unfinished work.",
      id: "preview-learning-field-films",
      name: "Field films",
      resources: [
        previewLearningSummary(
          "preview-learning-bring-your-own-burden",
          "bring-your-own-burden-01",
        ),
        previewLearningSummary("preview-learning-after-the-fear", "after-the-fear"),
      ],
      slug: "field-films",
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
