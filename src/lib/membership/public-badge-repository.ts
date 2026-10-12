import "server-only";

import { getPublicMemberProfile } from "./public-card-repository";

/** Public profiles have their own fixed field set, separate from name-only cards. */
export async function getPublicMemberTimelineProfile(identifier: string) {
  const profile = await getPublicMemberProfile(identifier);
  return profile ? { profile } : null;
}
