import type {
  OpsAnnouncementSummary,
  OpsArtifactQueueItem,
  OpsExperienceDirectoryItem,
  OpsMemberRecord,
  OpsOverviewData,
  OpsSystemHealth,
  OpsWorkQueue,
} from "@/lib/platform/ops-model";

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
        "accountability.manage",
        "announcement.manage",
        "artifact.manage",
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
      accountabilityPartner: hasCircle
        ? {
            assignedAt: "2026-08-02T18:00:00.000Z",
            assignmentId: "preview-accountability-01",
            memberId: "preview-04",
            preferredName: "Member 04",
          }
        : null,
      block: hasCircle
        ? { blockId: "preview-block-01", name: "Block 01", state: "active" }
        : null,
      circle: hasCircle
        ? {
            circleId: "preview-circle-01",
            guides: ["Guide 01"],
            leaderName: "Leader 01",
            members: [
              { memberId: "preview-01", preferredName: "Member 01" },
              { memberId: "preview-02", preferredName: "Member 02" },
              { memberId: "preview-04", preferredName: "Member 04" },
            ],
            name: "Circle 01",
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
          { completed: isNew ? 0 : 1, key: "scan", label: "Life Scan", total: 1 },
          { completed: isComplete ? 1 : 0, key: "timeline", label: "Timeline", total: 1 },
          { completed: isComplete ? 1 : 0, key: "letter", label: "Future Letter", total: 1 },
          { completed: isComplete ? 1 : 0, key: "circle", label: "Active Circle", total: 1 },
        ],
        startedAt: isNew ? null : "2026-07-20T17:00:00.000Z",
        state: isComplete ? "completed" : isNew ? "not_started" : "in_progress",
        timelineCompletedAt: isComplete ? "2026-08-10T17:00:00.000Z" : null,
      },
      progression: isComplete
        ? { assignedAt: "2026-08-12T19:00:00.000Z", levelName: "Builder" }
        : null,
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

export const PREVIEW_OPS_EXPERIENCES: OpsExperienceDirectoryItem[] = [
  {
    endsAt: "2026-09-04T03:00:00.000Z",
    experienceId: "preview-experience-circle-01",
    kind: "circle_meeting",
    registeredCount: 8,
    scope: "Circle 01",
    startsAt: "2026-09-04T01:00:00.000Z",
    state: "published",
    title: "Circle 01 / September",
  },
  {
    endsAt: "2026-09-20T03:00:00.000Z",
    experienceId: "preview-experience-02",
    kind: "academy",
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
