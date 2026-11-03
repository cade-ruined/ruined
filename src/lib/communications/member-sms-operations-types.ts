import type { MemberSmsOneOffRequestRecord } from "./member-sms-one-off-model";
import type { CommunicationItem } from "./communications-catalog";

/** Read-only operations projections. Forecasts are rechecked by the sender. */
export type MemberSmsOperationTemplate = {
  id: "opt_in_confirmation" | "call_reminder" | "foundations_01";
  title: string;
  body: string;
  timing: string;
  audience: string;
  trigger: string;
  noticeMinutes: number | null;
  variables: string[];
  bodyIsExample: boolean;
};
export type MemberSmsOperationRecipient = {
  memberId: string;
  name: string;
  maskedPhone: string;
  sharedPhone: boolean;
};
export type MemberSmsOperationCall = {
  eventId: string;
  title: string;
  startsAt: string;
  timeZone: string;
  foundations01: boolean;
};
export type MemberSmsUpcomingItem = {
  id: string;
  kind: "opt_in_confirmation" | "call_reminder";
  reminderKey: string;
  recipient: MemberSmsOperationRecipient;
  call: MemberSmsOperationCall | null;
  dueAt: string;
  expiresAt: string;
  body: string;
  /** Queued/processing are durable jobs; forecast is a current eligibility projection. */
  source: "forecast" | "queued" | "processing";
  confirmation: "not_applicable" | "accepted" | "required" | "unavailable";
  confirmationBody: string | null;
  confirmationStatus: string | null;
  blockedReason: string | null;
};
export type MemberSmsHistoryItem = {
  id: string;
  kind: "opt_in_confirmation" | "call_reminder" | "membership_reminder" | "one_off";
  actorName?: string | null;
  reminderKey: string;
  recipient: MemberSmsOperationRecipient;
  call: MemberSmsOperationCall | null;
  createdAt: string;
  updatedAt: string;
  status: "dispatching" | "accepted" | "blocked" | "unknown";
  deliveryStatus: string | null;
  deliveryUpdatedAt: string | null;
  deliveryErrorCode: number | null;
  blockedReason: string | null;
  messageSid: string | null;
  body: string | null;
  bodySource: "snapshot" | "verified_reconstruction" | "unavailable";
};
export type MemberSmsOperationJob = {
  id: string;
  kind: "opt_in_confirmation" | "call_reminder";
  recipient: MemberSmsOperationRecipient;
  call: MemberSmsOperationCall | null;
  dueAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  status: "queued" | "processing" | "finished";
  outcome: string | null;
};
export type MemberSmsOperationsOverview = {
  generatedAt: string;
  automation: {
    enabled: boolean;
    transportEnabled: boolean;
    automationEnabled: boolean;
    ready: boolean;
    activatedAt: string | null;
    state: "enabled" | "disabled" | "unconfigured" | "not_activated";
    missing: string[];
    callReady: boolean;
    warnings: string[];
    schedule: string;
    batchSize: number;
  };
  templates: MemberSmsOperationTemplate[];
  communications: CommunicationItem[];
  upcoming: {
    items: MemberSmsUpcomingItem[];
    horizonEnd: string;
    truncated: boolean;
    label: string;
    currentOptIns: number;
    eligibleOptIns: number;
  };
  jobs: { items: MemberSmsOperationJob[]; truncated: boolean };
  oneOffRequests?: { items: MemberSmsOneOffRequestRecord[]; truncated: boolean };
  history: { items: MemberSmsHistoryItem[]; nextCursor: string | null };
};
