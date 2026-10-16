import "server-only";

import { getPublicMemberProfile, getPublicMemberProfileScope } from "./public-card-repository";
import { getPublicMemberBadges } from "./badge-repository";
import { getPublicMemberProfilePortraitSource } from "./photos";
import { ownedMemberPhotoPath } from "./photo-policy";

/** Public profiles have their own fixed field set, separate from name-only cards. */
export async function getPublicMemberTimelineProfile(identifier: string) {
  const scope = await getPublicMemberProfileScope(identifier);
  if (!scope) return null;
  const profile = await getPublicMemberProfile(identifier);
  if (!profile) return null;
  const [portrait, badges] = await Promise.all([
    getPublicMemberProfilePortraitSource(identifier), getPublicMemberBadges(scope.memberId),
  ]);
  const latest = await getPublicMemberProfileScope(identifier);
  if (!latest || latest.memberId !== scope.memberId || latest.version !== scope.version) return null;
  const avatarUrl = portrait && portrait.memberId === scope.memberId && portrait.version === scope.version
    ? ownedMemberPhotoPath(scope.memberId, portrait.avatarUrl)
      ? `/api/profile/${encodeURIComponent(identifier)}/portrait`
      : portrait.avatarUrl
    : null;
  return { profile: { ...profile, avatarUrl }, badges };
}
