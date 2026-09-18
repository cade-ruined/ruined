import type { MemberInvitationSnapshot } from "./invitation-model";
import { memberCardPreviewSnapshot } from "./public-card-preview";

/** Local sample only; never issues a usable invitation or invents joined referrals. */
export function memberInvitationPreviewSnapshot(): MemberInvitationSnapshot {
  const { card } = memberCardPreviewSnapshot();
  return {
    card: { name: card.name, memberTag: card.memberTag, wearSeed: card.wearSeed, avatarUrl: null, memberSince: null, location: null, bio: null, buildingNow: null, websiteUrl: null, labels: [] },
    enabled: false, eligible: false, writable: false, url: null, joinedCount: 0, version: 0,
  };
}
