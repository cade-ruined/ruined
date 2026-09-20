import type { PublicMemberCard } from "./public-card-model";
import { MemberInvitationError } from "./invitation-model";

export const PERSONAL_INVITATION_DAILY_LIMIT = 20;
export type PersonalInvitationDeliveryStatus = "not_requested" | "queued" | "sending" | "sent" | "failed" | "cancelled";
export type PersonalMemberInvitation = {
  id: string; recipientName: string; recipientEmail: string; url: string | null;
  issuedAt: string; expiresAt: string; revokedAt: string | null; submittedAt: string | null; acceptedAt: string | null;
  joinedAt: string | null; deliveryStatus: PersonalInvitationDeliveryStatus; sentAt: string | null; version: number;
};
export type PersonalMemberInvitationsSnapshot = {
  card: PublicMemberCard; eligible: boolean; writable: boolean; emailReady: boolean; invitations: PersonalMemberInvitation[];
  counts: { created: number; active: number; expired: number; submitted: number; accepted: number; joined: number };
  dailyLimit: number; remainingToday: number;
  legacyInvitation: { url: string | null; issuedAt: string; expiresAt: string; enabled: boolean; version: number } | null;
};
export type PersonalInvitationSnapshot = PersonalMemberInvitationsSnapshot;
export type CreatePersonalMemberInvitationInput = { recipientName: string; recipientEmail: string; requestId: string; sendEmail: boolean };
export type PersonalMemberInvitationVersionInput = { version: number };
export const PERSONAL_INVITATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateCreatePersonalMemberInvitationInput(value: unknown): CreatePersonalMemberInvitationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemberInvitationError(400, "Add their name and email to create an invitation.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["recipientName", "recipientEmail", "requestId", "sendEmail"].includes(key)) ||
      typeof input.recipientName !== "string" || typeof input.recipientEmail !== "string" ||
      typeof input.requestId !== "string" || !PERSONAL_INVITATION_UUID.test(input.requestId) || typeof input.sendEmail !== "boolean" ||
      /[\u0000-\u001f\u007f]/u.test(input.recipientName + input.recipientEmail)) {
    throw new MemberInvitationError(400, "Check the recipient's name and email and try again.");
  }
  const recipientName = input.recipientName.trim().replace(/\s+/gu, " ");
  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  if (!recipientName || Array.from(recipientName).length > 100 || recipientEmail.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipientEmail)) {
    throw new MemberInvitationError(400, "Check the recipient's name and email and try again.");
  }
  return { recipientName, recipientEmail, requestId: input.requestId.toLowerCase(), sendEmail: input.sendEmail };
}

export function validatePersonalMemberInvitationVersionInput(value: unknown): PersonalMemberInvitationVersionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemberInvitationError(400, "Check the invitation and try again.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== "version") || !Number.isSafeInteger(input.version) || Number(input.version) < 1 || Number(input.version) > 2_147_483_646) {
    throw new MemberInvitationError(400, "Check the invitation and try again.");
  }
  return { version: input.version as number };
}
