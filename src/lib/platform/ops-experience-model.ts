export type OpsExperienceLifecycleState =
  | "archived"
  | "cancelled"
  | "completed"
  | "draft"
  | "published";

export type OpsExperienceDirectoryItem = {
  capacity: number | null;
  endsAt: string | null;
  experienceId: string;
  googleCommunicationsConfigured: boolean;
  kind: string;
  meetingUrl: string | null;
  registeredCount: number;
  scope: string;
  startsAt: string;
  state: OpsExperienceLifecycleState;
  title: string;
  waitlistedCount: number;
};

export type OpsExperienceDirectory = {
  blocks: Array<{ id: string; name: string }>;
  canCreate: boolean;
  canManageGlobal: boolean;
  circles: Array<{ id: string; name: string }>;
  experiences: OpsExperienceDirectoryItem[];
};

export type OpsExperienceRosterItem = {
  attendanceState: string | null;
  avatarStoragePath: string | null;
  cancelledAt: string | null;
  memberId: string | null;
  personId: string;
  preferredName: string;
  registeredAt: string;
  registrationId: string;
  status: "cancelled" | "external_pending" | "registered" | "waitlisted";
  waitlistPosition: number | null;
};

export type OpsExperienceHistoryItem = {
  actor: string | null;
  eventType: string;
  occurredAt: string;
  reason: string | null;
};

export type OpsExperienceCalendarStatus =
  | "cancelled"
  | "failed"
  | "not_created"
  | "pending_cancel"
  | "pending_create"
  | "pending_update"
  | "synced";

export type OpsExperienceCalendarState = {
  attendeeCount: number;
  configured: boolean;
  googleEventId: string | null;
  googleEventUrl: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
  meetingUrl: string | null;
  organizerEmail: string | null;
  status: OpsExperienceCalendarStatus;
};

export type OpsExperienceRecord = OpsExperienceDirectoryItem & {
  archivedAt: string | null;
  blockId: string | null;
  canEdit: boolean;
  canManageAttendance: boolean;
  canManageCommunication: boolean;
  canManageGlobal: boolean;
  canManageRoster: boolean;
  calendar: OpsExperienceCalendarState;
  cancellationReason: string | null;
  cancelledAt: string | null;
  circleId: string | null;
  completedAt: string | null;
  details: string | null;
  externalRegistrationUrl: string | null;
  history: OpsExperienceHistoryItem[];
  locationLabel: string | null;
  memberOptions: Array<{ id: string; name: string }>;
  registrationClosesAt: string | null;
  registrationMode: "external" | "internal" | "none";
  registrationOpensAt: string | null;
  roster: OpsExperienceRosterItem[];
  summary: string | null;
  timezone: string;
  version: number;
  visibility: "all_members" | "block" | "circle" | "invite_only" | "public";
  waitlistEnabled: boolean;
};

export type OpsExperienceDraftInput = {
  blockId: string | null;
  capacity: number | null;
  circleId: string | null;
  details: string;
  endsAt: string | null;
  externalRegistrationUrl: string | null;
  kind: string;
  locationLabel: string;
  registrationClosesAt: string | null;
  registrationMode: "external" | "internal" | "none";
  registrationOpensAt: string | null;
  startsAt: string;
  summary: string;
  timezone: string;
  title: string;
  visibility: "all_members" | "block" | "circle" | "invite_only" | "public";
  waitlistEnabled: boolean;
};
