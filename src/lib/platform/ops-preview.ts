import type {
  OpsAnnouncementSummary,
  OpsArtifactQueueItem,
  OpsCircleCommunicationItem,
  OpsExperienceDirectoryItem,
  OpsMemberRecord,
  OpsOverviewData,
  OpsSystemHealth,
  OpsWorkQueue,
} from "@/lib/platform/ops-model";
import type { OpsArtifactControlData } from "@/lib/platform/ops-artifact-repository";
import type { OpsMemberProfileSupport } from "@/lib/platform/ops-profile-repository";
import type {
  OpsCircleManagementOptions,
  OpsCircleSummary,
} from "@/lib/platform/ops-repository";

const PREVIEW_NOW = "2026-08-26T16:00:00.000Z";

export function getPreviewOpsMemberRecord(memberId: string): OpsMemberRecord {
  const isAttention = memberId === "preview-02";
  const isNew = memberId === "preview-03";
  const isComplete = memberId === "preview-04";
  const preferredName = isAttention
    ? "Member 02"
    : isNew
      ? "Member 03"
      : isComplete
        ? "Member 04"
        : "Member 01";
  const hasCircle = !isNew;

  return {
    access: {
      authUserId: "preview-operator",
      capabilities: [
        "announcement.manage",
        "artifact.manage",
        "circle.resource.manage",
        "circle.shaper.manage",
        "experience.manage",
        "member.agreement_evidence.read",
        "member.billing_detail.read",
        "member.community.read",
        "member.journey.read",
        "member.note.write",
        "member.operational_contact.read",
        "member.override.write",
        "member.private_profile.read",
        "member.summary.read",
        "task.manage",
        "workflow.retry",
      ],
      roles: ["ops_admin"],
    },
    community: {
      block: hasCircle
        ? { blockId: "preview-block-01", name: "Block 01", state: "active" }
        : null,
      circle: hasCircle
        ? {
            circleId: "preview-circle-01",
            guides: ["Guide 01"],
            members: [
              { memberId: "preview-01", preferredName: "Member 01" },
              { memberId: "preview-02", preferredName: "Member 02" },
              { memberId: "preview-04", preferredName: "Member 04" },
            ],
            name: "Circle 01",
            shaperName: "Shaper 01",
            state: "active",
          }
        : null,
      meetings: hasCircle
        ? [
            {
              completedAt: null,
              experienceId: "preview-experience-circle-01",
              kind: "circle_meeting",
              occurredAt: "2026-09-04T01:00:00.000Z",
              state: "published",
              title: "Circle 01 / September",
            },
          ]
        : [],
      resources: hasCircle
        ? [
            {
              label: "Circle working agreement",
              resourceId: "preview-resource-01",
              url: "/ops/circles#preview-circle-01",
            },
          ]
        : [],
    },
    header: {
      blockName: hasCircle ? "Block 01" : null,
      circleName: hasCircle ? "Circle 01" : null,
      lifecycleVersion: 4,
      memberId,
      nextDecision: isAttention
        ? "Contact the member about payment without erasing their history."
        : isNew
          ? "Finish administrative onboarding, then place the member in a Circle."
          : isComplete
            ? "Review the Artifact now in production."
            : "Complete the remaining Foundations stage.",
      openWorkCount: isAttention ? 2 : 1,
      personId: `person-${memberId}`,
      preferredName,
      primaryEmail: `${memberId}@ruined.local`,
      states: {
        account: isNew ? "invited" : "active",
        administrativeOnboarding: isNew ? "in_progress" : "completed",
        admission: isNew ? "invited" : "accepted",
        artifact: isComplete ? "in_production" : isNew ? "not_started" : "collecting",
        billing: isAttention ? "attention_required" : isNew ? "pending" : "active",
        foundations: isComplete ? "completed" : isNew ? "not_started" : "in_progress",
        standing: isAttention ? "paused" : isNew ? "pre_active" : "active",
      },
    },
    journey: {
      artifacts: isNew
        ? []
        : [
            {
              artifactAwardId: "preview-award-01",
              artifactJobId: "preview-artifact-01",
              earnedAt: "2026-08-12T19:00:00.000Z",
              name: "Foundations Artifact",
              reason: "Foundations completion path",
              state: isComplete ? "in_production" : "collecting",
            },
          ],
      experiences: hasCircle
        ? [
            {
              completedAt: "2026-07-18T03:00:00.000Z",
              experienceId: "preview-experience-01",
              kind: "event",
              occurredAt: "2026-07-18T01:00:00.000Z",
              state: "attended",
              title: "BYOB Nº 01",
            },
          ]
        : [],
      foundations: {
        activeCircleRequired: true,
        completedAt: isComplete ? "2026-08-12T19:00:00.000Z" : null,
        futureLetterCompletedAt: isComplete ? "2026-08-12T18:50:00.000Z" : null,
        progressPercent: isComplete ? 100 : isNew ? 0 : isAttention ? 50 : 75,
        stages: [
          { completed: isNew ? 0 : 1, key: "story", label: "Story", total: 1 },
          { completed: isComplete ? 1 : 0, key: "philosophy", label: "Philosophy", total: 1 },
          { completed: isComplete ? 1 : 0, key: "culture", label: "Culture", total: 1 },
          { completed: isComplete ? 1 : 0, key: "commitment", label: "Commitment", total: 1 },
        ],
        startedAt: isNew ? null : "2026-07-20T17:00:00.000Z",
        state: isComplete ? "completed" : isNew ? "not_started" : "in_progress",
        timelineCompletedAt: isComplete ? "2026-08-10T17:00:00.000Z" : null,
      },
    },
    membership: {
      agreement: {
        acceptedAt: isNew ? null : "2026-07-19T18:00:00.000Z",
        contentSha256: isNew ? null : "d7d7b4f30b2d45b0f76022e721312bc53b1c17dc5c80a96295e6d44a4ce313ca",
        receiptId: isNew ? null : "preview-receipt-01",
        receiptState: isNew ? "not_recorded" : "delivered",
        version: isNew ? null : "2026.08",
      },
      billing: isNew
        ? null
        : {
            cancelAtPeriodEnd: false,
            currentPeriodEnd: "2026-09-19T18:00:00.000Z",
            latestInvoiceAmountPaid: 25000,
            latestInvoiceCurrency: "usd",
            latestInvoiceState: isAttention ? "open" : "paid",
            stripeState: isAttention ? "past_due" : "active",
          },
      cancellation: null,
      contact: {
        email: `${memberId}@ruined.local`,
        legalName: `${preferredName} Legal`,
        phone: "+18015550199",
        preferredName,
      },
      onboarding: {
        completedAt: isNew ? null : "2026-07-19T18:15:00.000Z",
        requirements: [
          { completedAt: PREVIEW_NOW, key: "verified_email", label: "Verified email", required: true, state: "complete" },
          { completedAt: isNew ? null : PREVIEW_NOW, key: "private_profile", label: "Legal name, mobile, and age attestation", required: true, state: isNew ? "missing" : "complete" },
          { completedAt: isNew ? null : PREVIEW_NOW, key: "agreement", label: "Membership agreement", required: true, state: isNew ? "missing" : "complete" },
          { completedAt: null, key: "fulfillment", label: "Artifact fulfillment details", required: false, state: "not_required" },
        ],
        state: isNew ? "in_progress" : "completed",
      },
    },
    operational: {
      history: [
        {
          actor: "System",
          occurredAt: "2026-07-19T18:15:00.000Z",
          source: "onboarding",
          summary: "Administrative onboarding completed.",
        },
        {
          actor: "Leader 01",
          occurredAt: "2026-07-20T17:00:00.000Z",
          source: "circle",
          summary: "Placed in Circle 01.",
        },
      ],
      notes: [
        {
          body: "Prefers evening Circle meetings.",
          category: "circle_context",
          createdAt: "2026-08-03T17:30:00.000Z",
          createdBy: "Operator 01",
          noteId: "preview-note-01",
          visibility: "assigned_staff",
        },
      ],
      overrides: [],
      tasks: [
        {
          assignedTo: null,
          completedAt: null,
          dueAt: "2026-08-30T18:00:00.000Z",
          priority: 60,
          state: "open",
          taskId: "preview-task-01",
          title: isAttention ? "Payment follow-up" : "Review Foundations proof",
        },
      ],
    },
  };
}

export const PREVIEW_OPS_WORK_QUEUE: OpsWorkQueue = {
  items: [
    {
      dueAt: "2026-08-27T18:00:00.000Z",
      kind: "task",
      label: "Payment follow-up",
      memberId: "preview-02",
      memberName: "Member 02",
      priority: 90,
      state: "open",
      workId: "preview-task-01",
    },
    {
      dueAt: "2026-08-30T18:00:00.000Z",
      kind: "artifact",
      label: "Foundations Artifact",
      memberId: "preview-04",
      memberName: "Member 04",
      priority: 70,
      state: "in_production",
      workId: "preview-artifact-01",
    },
    {
      dueAt: null,
      errorCode: "delivery_timeout",
      kind: "workflow_failure",
      label: "Member welcome delivery",
      memberId: "preview-03",
      memberName: "Member 03",
      priority: 80,
      state: "failed",
      workId: "preview-workflow-01",
    },
  ],
  totals: { artifacts: 1, failures: 1, tasks: 1 },
};

export const PREVIEW_OPS_ARTIFACTS: OpsArtifactQueueItem[] = [
  {
    artifactAwardId: "preview-award-01",
    artifactJobId: "preview-artifact-01",
    dueAt: "2026-08-30T18:00:00.000Z",
    earnedAt: "2026-08-12T19:00:00.000Z",
    memberId: "preview-04",
    memberName: "Member 04",
    name: "Foundations Artifact",
    priority: 70,
    reason: "Foundations completion path",
    state: "in_production",
  },
];

export const PREVIEW_OPS_ARTIFACT_CONTROLS: OpsArtifactControlData = {
  members: [
    { memberId: "11111111-1111-4111-8111-111111111101", name: "Member 01" },
    { memberId: "11111111-1111-4111-8111-111111111104", name: "Member 04" },
  ],
  shipments: [
    {
      artifactJobId: "77777777-7777-4777-8777-777777777777",
      carrier: "UPS",
      createdAt: "2026-08-26T16:00:00.000Z",
      memberName: "Member 04",
      serviceLevel: "Ground",
      shipmentId: "88888888-8888-4888-8888-888888888888",
      status: "label_created",
      trackingNumber: "1ZRUINEDPREVIEW",
      trackingUrl: "https://www.ups.com/track?loc=en_US&tracknum=1ZRUINEDPREVIEW",
      updatedAt: "2026-08-26T16:00:00.000Z",
      version: 1,
    },
  ],
  templates: [
    {
      bindingVerified: true,
      description: "A hand-forged Artifact.",
      livemode: true,
      name: "The First Coin",
      productGid: "gid://shopify/Product/10356658274625",
      productHandle: "the-first-coin",
      status: "active",
      templateId: "21935b51-7cbf-4cad-9564-380662b75c1b",
      templateSlug: "the-first-coin",
      version: 1,
      versionId: "2a1df4c5-7e44-4d50-a832-ec78c21de0ab",
      versionStatus: "published",
    },
  ],
};

export const PREVIEW_OPS_CIRCLES: OpsCircleSummary[] = [
  {
    activeMembers: 3,
    blockId: "11111111-1111-4111-8111-111111111120",
    blockName: "Block 01",
    blockStatus: "active",
    capacity: 10,
    id: "11111111-1111-4111-8111-111111111110",
    name: "Circle 01",
    resources: [
      {
        assignedAt: "2026-08-20T16:00:00.000Z",
        assignmentId: "11111111-1111-4111-8111-111111111150",
        isPinned: true,
        resourceId: "11111111-1111-4111-8111-111111111140",
        title: "Circle working agreement",
        version: 1,
        versionId: "11111111-1111-4111-8111-111111111141",
      },
    ],
    shaper: {
      assignedAt: "2026-08-19T16:00:00.000Z",
      assignmentId: "11111111-1111-4111-8111-111111111130",
      authUserId: "11111111-1111-4111-8111-111111111131",
      name: "Shaper 01",
    },
    slug: "circle-01",
    status: "active",
  },
];

export const PREVIEW_OPS_CIRCLE_MANAGEMENT: OpsCircleManagementOptions = {
  resources: [
    {
      resourceId: "11111111-1111-4111-8111-111111111142",
      title: "September practice",
      version: 2,
      versionId: "11111111-1111-4111-8111-111111111143",
    },
  ],
  shapers: [
    { authUserId: "11111111-1111-4111-8111-111111111132", name: "Shaper 02" },
  ],
};

export function getPreviewOpsMemberProfileSupport(memberId: string): OpsMemberProfileSupport {
  const memberNumber = memberId.endsWith("04") ? "04" : memberId.endsWith("02") ? "02" : "01";
  return {
    accessibilityNotes: "Needs step-free access for longer gatherings.",
    address: {
      addressLine1: "125 Ruined Way",
      addressLine2: null,
      city: "Salt Lake City",
      countryCode: "US",
      postalCode: "84101",
      region: "UT",
    },
    apparelTopSize: "M",
    avatarStoragePath: null,
    bio: "A builder making fewer, better things.",
    buildingNow: "A more deliberate creative practice.",
    directoryStatus: "circle_visible",
    displayName: `Member ${memberNumber}`,
    legalName: `Preview Member ${memberNumber}`,
    location: "Alpine, Utah",
    mobile: "+18015550199",
    preferredName: `Member ${memberNumber}`,
    timezone: "America/Denver",
    version: "2026-08-26T16:00:00.000Z|2026-08-26T16:00:00.000Z",
  };
}

export const PREVIEW_OPS_CIRCLE_COMMUNICATIONS: OpsCircleCommunicationItem[] = [
  {
    activeMembers: 3,
    blockId: "preview-block-01",
    blockName: "Block 01",
    blockStatus: "active",
    capacity: 10,
    chatUrl: "https://chat.google.com/room/preview-circle-01",
    googleCommunicationsConfigured: true,
    id: "preview-circle-01",
    name: "Circle 01",
    status: "active",
  },
];

export const PREVIEW_OPS_EXPERIENCES: OpsExperienceDirectoryItem[] = [
  {
    endsAt: "2026-09-04T03:00:00.000Z",
    experienceId: "preview-experience-circle-01",
    googleCommunicationsConfigured: true,
    kind: "circle_meeting",
    meetingUrl: "https://meet.google.com/abc-mnop-xyz",
    registeredCount: 8,
    scope: "Circle 01",
    startsAt: "2026-09-04T01:00:00.000Z",
    state: "published",
    title: "Circle 01 / September",
  },
  {
    endsAt: "2026-09-20T03:00:00.000Z",
    experienceId: "preview-experience-02",
    googleCommunicationsConfigured: true,
    kind: "academy",
    meetingUrl: null,
    registeredCount: 31,
    scope: "All active members",
    startsAt: "2026-09-20T00:00:00.000Z",
    state: "published",
    title: "Ruined Academy / Session 02",
  },
];

export const PREVIEW_OPS_OVERVIEW: OpsOverviewData = {
  activity: [
    {
      activityId: "preview-activity-billing-01",
      href: "/ops/members/preview-02#membership",
      kind: "membership",
      memberId: "preview-02",
      occurredAt: "2026-08-26T15:50:00.000Z",
      subject: "Member 02",
      summary: "Billing needs attention",
      tone: "attention",
    },
    {
      activityId: "preview-activity-foundations-01",
      href: "/ops/members/preview-04#journey",
      kind: "foundations",
      memberId: "preview-04",
      occurredAt: "2026-08-26T14:30:00.000Z",
      subject: "Member 04",
      summary: "Completed Ruined Foundations",
      tone: "complete",
    },
    {
      activityId: "preview-activity-onboarding-01",
      href: "/ops/members/preview-03#membership",
      kind: "membership",
      memberId: "preview-03",
      occurredAt: "2026-08-26T13:10:00.000Z",
      subject: "Member 03",
      summary: "Membership intake updated",
      tone: "neutral",
    },
    {
      activityId: "preview-activity-timeline-01",
      href: "/ops/members/preview-01#journey",
      kind: "foundations",
      memberId: "preview-01",
      occurredAt: "2026-08-26T12:20:00.000Z",
      subject: "Member 01",
      summary: "Timeline confirmed",
      tone: "complete",
    },
    {
      activityId: "preview-activity-circle-01",
      href: "/ops/members/preview-04#community",
      kind: "circle",
      memberId: "preview-04",
      occurredAt: "2026-08-25T19:00:00.000Z",
      subject: "Member 04",
      summary: "Assigned to Circle 02",
      tone: "neutral",
    },
    {
      activityId: "preview-activity-experience-01",
      href: "/ops/members/preview-01#journey",
      kind: "experience",
      memberId: "preview-01",
      occurredAt: "2026-08-24T03:00:00.000Z",
      subject: "Member 01",
      summary: "Attended BYOB Nº 01",
      tone: "complete",
    },
  ],
  canPlaceMembers: true,
  counts: {
    activeMembers: 2,
    attentionRequired: 1,
    circles: { active: 2, forming: 0 },
    eligibleWithoutCircle: 1,
    foundations: { completed: 1, inProgress: 2, notStarted: 1 },
    totalMembers: 4,
    work: { artifacts: 1, failures: 1, tasks: 1 },
  },
  priorityWork: PREVIEW_OPS_WORK_QUEUE.items,
  upcomingExperiences: PREVIEW_OPS_EXPERIENCES,
};

export const PREVIEW_OPS_ANNOUNCEMENTS: OpsAnnouncementSummary[] = [
  {
    announcementId: "preview-announcement-01",
    body: "September Circle meeting details are now available in My Ruined.",
    publishedAt: null,
    state: "draft",
    targetLabel: "All active members",
    title: "September inside My Ruined",
  },
];

export const PREVIEW_OPS_SYSTEM: OpsSystemHealth = {
  services: [
    { detail: "Identity and passwordless access", label: "Supabase", lastSucceededAt: PREVIEW_NOW, state: "connected" },
    { detail: "Membership operating record", label: "Postgres", lastSucceededAt: PREVIEW_NOW, state: "connected" },
    { detail: "Read-only billing projection", label: "Stripe", lastSucceededAt: PREVIEW_NOW, state: "connected" },
    { detail: "Member email delivery", label: "Resend", lastSucceededAt: "2026-08-26T15:42:00.000Z", state: "attention" },
    { detail: "Invitations organized by connect@theruinedproject.com", label: "Google Calendar", lastSucceededAt: PREVIEW_NOW, state: "connected" },
  ],
  workflowFailures: [
    {
      actionId: "preview-workflow-01",
      actionType: "member_welcome_delivery",
      attempts: 3,
      errorCode: "delivery_timeout",
      failedAt: "2026-08-26T15:45:00.000Z",
      state: "failed",
    },
  ],
};
