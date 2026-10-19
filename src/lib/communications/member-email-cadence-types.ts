import type { CadenceEvent, CadenceKind, CadenceStage, CadenceTrack } from "./member-email-cadence-model";
import type { ResendEmailTemplate } from "./resend-email-model";

export type CadenceBindingSource = "literal" | "member_name" | "call_title" | "call_date" | "call_time" | "call_url" | "profile_url" | "preferences_url";
export type CadenceDraft = {
  scope?: "event" | "sequence";
  eventId: string; kind: CadenceKind; track: CadenceTrack; templateId: string; templateVersion: string;
  bodyTarget: string; headingTarget?: string;
  bindings: Record<string, { source: CadenceBindingSource; value?: string }>;
  copy?: Record<string,string>;
  messages?: Partial<Record<CadenceStage, { subject?: string; message?: string }>>;
};
export type CadenceEventSnapshot = CadenceEvent & {
  version: string; visibility: string; circle_id: string | null; block_id: string | null;
  progression_level_slug: string | null; registration_mode: string; kind: string;
};
export type CadencePlan = CadenceDraft & {
  id: string; revision: number; active: boolean; activatedAt: string;
  template: ResendEmailTemplate; event: CadenceEventSnapshot; siteUrl: string;
  sequenceId?: string | null; sequenceRevision?: number | null;
};
export type CadenceRecipient = {
  memberId: string; name: string; email: string; eligible: boolean; reason: string;
  registeredAt: string; consentId: string | null;
};
export type CadenceEmailPayload = { from: string; to: string; replyTo: string[]; subject: string; html: string; text: string };
export type CadenceDeliveryClaim = { id: string; memberId: string; attempts: number; firstAttemptAt: Date | string | null };
export type CadenceDelivery = CadenceDeliveryClaim & {
  email: string; memberName: string; payload: CadenceEmailPayload | null;
  plan: CadencePlan; event: CadenceEventSnapshot; stage: CadenceStage;
  dueAt: string; expiresAt: string;
};
