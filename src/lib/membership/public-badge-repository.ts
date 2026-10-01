import "server-only";

import { getMemberBadges } from "./badge-repository";
import type { MemberBadge } from "./badge-model";
import { getPublicMemberCard, getPublicMemberCardScope } from "./public-card-repository";
import { MEMBER_CARD_TOKEN, type PublicMemberCard } from "./public-card-model";

/** Public sharing permits the earned badge display, never its billing/award evidence. */
export async function getPublicMemberTimelineProfile(token: string): Promise<{
  card: PublicMemberCard;
  badges: MemberBadge[];
} | null> {
  if (!MEMBER_CARD_TOKEN.test(token)) return null;
  const scope = await getPublicMemberCardScope(token);
  if (!scope) return null;
  const awards = await getMemberBadges(scope.memberId);
  // Re-read the consent-filtered profile after badge loading so a slow badge
  // query cannot outlive the profile repository's own source-revision checks.
  const card = await getPublicMemberCard(token);
  if (!card) return null;
  // Profile sharing can be withdrawn while the badge query is running.
  const current = await getPublicMemberCardScope(token);
  if (!current || current.memberId !== scope.memberId || current.version !== scope.version) return null;
  return {
    card,
    badges: awards.map(({ key, label, description, earnedAt }) => ({ key, label, description, earnedAt })),
  };
}
