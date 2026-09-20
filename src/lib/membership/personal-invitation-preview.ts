import type { PersonalInvitationSnapshot, PersonalMemberInvitation } from "./personal-invitation-model";
import { memberInvitationPreviewSnapshot } from "./invitation-preview";

/** Clearly labelled local examples. No token, usable link, delivery or referral is created. */
export function personalInvitationPreviewSnapshot({ canGrantComplimentary = false }: { canGrantComplimentary?: boolean } = {}): PersonalInvitationSnapshot {
  const { card } = memberInvitationPreviewSnapshot();
  const now = Date.now();
  const ago = (hours: number) => new Date(now - hours * 60 * 60 * 1000).toISOString();
  const example = (id: string, recipientName: string, hoursAgo: number): PersonalMemberInvitation => ({
    id, recipientName, recipientEmail: `${recipientName.toLowerCase().replaceAll(" ", ".")}@example.test`,
    url: null, issuedAt: ago(hoursAgo), expiresAt: ago(hoursAgo - 48), revokedAt: null,
    submittedAt: null, acceptedAt: null, joinedAt: null, deliveryStatus: "not_requested", sentAt: null, version: 0,
    membershipType: "standard", complimentaryReason: null, complimentaryEndsAt: null, complimentaryGrant: null,
  });
  return {
    card, eligible: false, writable: false, emailReady: false, canGrantComplimentary,
    invitations: [
      example("preview-active", "Alex Rivera", 2),
      example("preview-expired", "Sam Morgan", 72),
      { ...example("preview-accepted", "Taylor Brooks", 50), acceptedAt: ago(12) },
      { ...example("preview-joined", "Jordan Lee", 96), acceptedAt: ago(95), joinedAt: ago(80) },
      ...(canGrantComplimentary ? [
        { ...example("preview-complimentary", "Morgan Lane", 1), membershipType: "complimentary" as const, complimentaryReason: "Founding member" },
        { ...example("preview-complimentary-accepted", "Casey Reed", 72), membershipType: "complimentary" as const, complimentaryReason: "Founding member", acceptedAt: ago(60), complimentaryGrant: { id: "preview-grant-ongoing", startsAt: ago(60), endsAt: null, revokedAt: null } },
        { ...example("preview-complimentary-ended", "Riley West", 96), membershipType: "complimentary" as const, complimentaryReason: "Guest membership", acceptedAt: ago(90), joinedAt: ago(80), complimentaryGrant: { id: "preview-grant-ended", startsAt: ago(90), endsAt: null, revokedAt: ago(12) } },
      ] : []),
    ],
    counts: { created: canGrantComplimentary ? 7 : 4, active: canGrantComplimentary ? 2 : 1, expired: 1, accepted: canGrantComplimentary ? 4 : 2, submitted: 0, joined: canGrantComplimentary ? 2 : 1 },
    dailyLimit: 20, remainingToday: 20, legacyInvitation: null,
  };
}
