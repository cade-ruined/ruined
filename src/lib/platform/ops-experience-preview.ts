import type {
  OpsExperienceDirectory,
  OpsExperienceRecord,
  OpsExperienceRosterItem,
} from "@/lib/platform/ops-experience-model";
import { PREVIEW_OPS_EXPERIENCES } from "@/lib/platform/ops-preview";

const circles = [
  { id: "preview-circle-01", name: "Circle 01" },
  { id: "preview-circle-02", name: "Circle 02" },
];

const blocks = [
  { id: "preview-block-01", name: "Block 01" },
  { id: "preview-block-02", name: "Block 02" },
];

const people = [
  "Cade",
  "Mitch",
  "Tyler",
  "Jordan",
  "Sam",
  "Elliot",
  "Noah",
  "Miles",
  "Avery",
  "Drew",
  "Quinn",
  "Riley",
];

function rosterItem(
  index: number,
  status: OpsExperienceRosterItem["status"],
  attendanceState: string | null = null,
): OpsExperienceRosterItem {
  return {
    attendanceState,
    avatarStoragePath: null,
    cancelledAt: null,
    memberId: `preview-member-${String(index + 1).padStart(2, "0")}`,
    personId: `preview-person-${String(index + 1).padStart(2, "0")}`,
    preferredName: people[index] ?? `Member ${index + 1}`,
    registeredAt: new Date(Date.UTC(2026, 7, 18 + index, 16, 0)).toISOString(),
    registrationId: `preview-registration-${String(index + 1).padStart(2, "0")}`,
    status,
    waitlistPosition: status === "waitlisted" ? index - 7 : null,
  };
}

const circleRoster: OpsExperienceRosterItem[] = [
  rosterItem(0, "registered", "attended"),
  rosterItem(1, "registered", "checked_in"),
  rosterItem(2, "registered"),
  rosterItem(3, "registered"),
  rosterItem(4, "registered"),
  rosterItem(5, "registered"),
  rosterItem(6, "registered"),
  rosterItem(7, "registered"),
  rosterItem(8, "waitlisted"),
  rosterItem(9, "waitlisted"),
];

const academyRoster: OpsExperienceRosterItem[] = [
  ...Array.from({ length: 31 }, (_, index) =>
    rosterItem(index, "registered", index < 2 ? "attended" : index === 2 ? "checked_in" : null),
  ),
  { ...rosterItem(31, "waitlisted"), waitlistPosition: 1 },
  { ...rosterItem(32, "waitlisted"), waitlistPosition: 2 },
  { ...rosterItem(33, "waitlisted"), waitlistPosition: 3 },
];

const common = {
  archivedAt: null,
  canEdit: true,
  canManageAttendance: true,
  canManageCommunication: true,
  canManageGlobal: true,
  canManageRoster: true,
  cancellationReason: null,
  cancelledAt: null,
  completedAt: null,
  externalRegistrationUrl: null,
  googleCommunicationsConfigured: true,
  registrationMode: "internal" as const,
  registrationOpensAt: "2026-08-20T15:00:00.000Z",
  state: "published" as const,
  timezone: "America/Denver",
  version: 3,
  waitlistEnabled: true,
};

const calendar = {
  attendeeCount: 8,
  configured: true,
  googleEventId: "preview-google-event-01",
  googleEventUrl: "https://calendar.google.com/calendar/event?eid=preview",
  lastError: null,
  lastSyncedAt: "2026-08-28T18:24:00.000Z",
  meetingUrl: "https://meet.google.com/abc-mnop-xyz",
  organizerEmail: "connect@theruinedproject.com",
  status: "synced" as const,
};

export const PREVIEW_OPS_EXPERIENCE_DIRECTORY: OpsExperienceDirectory = {
  blocks,
  canCreate: true,
  canManageGlobal: true,
  circles,
  experiences: PREVIEW_OPS_EXPERIENCES.map((experience, index) => ({
    ...experience,
    capacity: index === 0 ? 8 : 32,
    googleCommunicationsConfigured: experience.googleCommunicationsConfigured ?? true,
    meetingUrl: experience.meetingUrl ?? null,
    startsAt: experience.startsAt ?? "2026-09-04T01:00:00.000Z",
    state: "published" as const,
    waitlistedCount: index === 0 ? 2 : 3,
  })),
};

export const PREVIEW_OPS_EXPERIENCE_RECORDS: Record<string, OpsExperienceRecord> = {
  "preview-experience-circle-01": {
    ...common,
    calendar,
    blockId: "preview-block-01",
    capacity: 8,
    circleId: "preview-circle-01",
    details: "A monthly working session for Circle 01. Arrive ready to name what moved, what stalled, and what needs the Circle next.",
    endsAt: "2026-09-04T03:00:00.000Z",
    experienceId: "preview-experience-circle-01",
    history: [
      { actor: "Operator 01", eventType: "experience_created", occurredAt: "2026-08-18T16:00:00.000Z", reason: null },
      { actor: "Shaper 01", eventType: "experience_published", occurredAt: "2026-08-20T15:00:00.000Z", reason: null },
      { actor: "System", eventType: "registration_waitlisted", occurredAt: "2026-08-27T17:10:00.000Z", reason: "Capacity reached" },
    ],
    kind: "circle_meeting",
    locationLabel: "Ruined Studio · Salt Lake City",
    meetingUrl: "https://meet.google.com/abc-mnop-xyz",
    memberOptions: [
      { id: "preview-member-11", name: "Quinn" },
      { id: "preview-member-12", name: "Riley" },
    ],
    registeredCount: 8,
    registrationClosesAt: "2026-09-03T23:00:00.000Z",
    roster: circleRoster,
    scope: "Circle 01",
    startsAt: "2026-09-04T01:00:00.000Z",
    summary: "Circle 01 gathers for its September working session.",
    title: "Circle 01 / September",
    visibility: "circle",
    waitlistedCount: 2,
  },
  "preview-experience-02": {
    ...common,
    calendar: { ...calendar, attendeeCount: 31, googleEventId: "preview-google-event-02" },
    blockId: null,
    capacity: 32,
    circleId: null,
    details: "A practical Academy session about refining a body of work until the strongest idea is the only one left standing.",
    endsAt: "2026-09-20T03:00:00.000Z",
    experienceId: "preview-experience-02",
    history: [
      { actor: "Operator 01", eventType: "experience_created", occurredAt: "2026-08-12T19:00:00.000Z", reason: null },
      { actor: "Operator 01", eventType: "experience_updated", occurredAt: "2026-08-18T19:00:00.000Z", reason: "Capacity increased" },
      { actor: "Operator 01", eventType: "experience_published", occurredAt: "2026-08-19T19:00:00.000Z", reason: null },
    ],
    kind: "academy_session",
    locationLabel: "Google Meet",
    meetingUrl: "https://meet.google.com/ruined-academy",
    memberOptions: [
      { id: "preview-member-41", name: "Robin" },
      { id: "preview-member-42", name: "Casey" },
    ],
    registeredCount: 31,
    registrationClosesAt: "2026-09-19T18:00:00.000Z",
    roster: academyRoster,
    scope: "All active members",
    startsAt: "2026-09-20T00:00:00.000Z",
    summary: "Session 02: editing a promising idea until it becomes inevitable.",
    title: "Ruined Academy / Session 02",
    visibility: "all_members",
    waitlistedCount: 3,
  },
};

export function getPreviewOpsExperienceRecord(experienceId: string) {
  return PREVIEW_OPS_EXPERIENCE_RECORDS[experienceId] ?? null;
}
