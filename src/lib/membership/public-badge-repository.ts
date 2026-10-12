import "server-only";

import { getPublicMemberProfile } from "./public-card-repository";

/** The public profile has a fixed field set, independent of card customization. */
export async function getPublicMemberTimelineProfile(identifier: string) {
  const profile = await getPublicMemberProfile(identifier);
  return profile ? { profile } : null;
}
