import type { PersonalInvitationSnapshot, PersonalMemberInvitation } from "./personal-invitation-model";
import { memberInvitationPreviewSnapshot } from "./invitation-preview";

/** Clearly labelled local examples. No token, usable link, delivery or referral is created. */
export function personalInvitationPreviewSnapshot(): PersonalInvitationSnapshot {
  const { card } = memberInvitationPreviewSnapshot();
  const now = Date.now();
  const ago = (hours: number) => new Date(now - hours * 60 * 60 * 1000).toISOString();
  const example = (id: string, recipientName: string, hoursAgo: number): PersonalMemberInvitation => ({
    id, recipientName, recipientEmail: `${recipientName.toLowerCase().replaceAll(" ", ".")}@example.test`,
    url: null, issuedAt: ago(hoursAgo), expiresAt: ago(hoursAgo - 48), revokedAt: null,
    submittedAt: null, joinedAt: null, deliveryStatus: "not_requested", sentAt: null, version: 0,
  });
  return {
    card, eligible: false, writable: false, emailReady: false,
    invitations: [
      example("preview-active", "Alex Rivera", 2),
      example("preview-expired", "Sam Morgan", 72),
      { ...example("preview-joined", "Jordan Lee", 96), submittedAt: ago(95), joinedAt: ago(80) },
    ],
    counts: { created: 3, active: 1, expired: 1, submitted: 1, joined: 1 },
    dailyLimit: 20, remainingToday: 20, legacyInvitation: null,
  };
}
