import "server-only";

import { getApplicationDatabase } from "@/lib/database/server";
import { MEMBERSHIP_BADGES, type MemberBadgeKey } from "./badge-model";
import { BADGE_COLLECTION_KEYS, badgeCollectionItem, type MemberBadgeCollection } from "./badge-collection-model";
import { BadgeNotificationError, lockBadgeOwner, memberBadgeFromAward, readValidMemberBadgeRows, reconcileMemberBadgeCollection } from "./badge-repository";

export async function getMemberBadgeCollection(authUserId: string): Promise<MemberBadgeCollection> {
  return getApplicationDatabase().begin(async tx => {
    const memberId = await lockBadgeOwner(tx, authUserId);
    await reconcileMemberBadgeCollection(tx, memberId);
    const progress = await tx<Array<{ badge_key: string; progress: number; target: number }>>`
      select badge_key, progress, target from private.ruined_member_badge_progress(${memberId}::uuid)
    `;
    const awards = await readValidMemberBadgeRows(tx, memberId);
    const [collection] = await tx<Array<{ seen_at: Date | null }>>`
      select seen_at from member_badge_collections where member_id = ${memberId}::uuid
    `;
    const keys: MemberBadgeKey[] = [...BADGE_COLLECTION_KEYS];
    if (awards.some(award => award.badge_key === "early-supporter")) keys.push("early-supporter");
    return { ownerId: authUserId, seenAt: collection?.seen_at ? new Date(collection.seen_at).toISOString() : null,
      badges: keys.map(key => {
        const award = awards.find(row => row.badge_key === key);
        const badge = award ? memberBadgeFromAward(award) : null;
        const state = progress.find(row => row.badge_key === key);
        const item = badgeCollectionItem(key, { progress: state?.progress ?? (badge ? 1 : 0), target: state?.target ?? 1,
          earnedAt: badge?.earnedAt ?? null, publicVisible: Boolean(badge && award?.public_visible) });
        return badge ? { ...item, description: badge.description } : item;
      }) };
  });
}

export async function shouldIntroduceMemberBadges(authUserId: string): Promise<boolean> {
  try {
    return await getApplicationDatabase().begin(async tx => {
      const memberId = await lockBadgeOwner(tx, authUserId);
      const [row] = await tx<Array<{ seen_at: Date | null }>>`
        select seen_at from member_badge_collections where member_id = ${memberId}::uuid
      `;
      return !row?.seen_at;
    });
  } catch (error) {
    if (error instanceof BadgeNotificationError && error.status === 403) return false;
    throw error;
  }
}

export async function markMemberBadgeCollectionSeen(authUserId: string): Promise<void> {
  await getApplicationDatabase().begin(async tx => {
    const memberId = await lockBadgeOwner(tx, authUserId);
    await tx`
      insert into member_badge_collections(member_id, seen_at) values (${memberId}::uuid, statement_timestamp())
      on conflict(member_id) do update set seen_at = coalesce(member_badge_collections.seen_at, excluded.seen_at)
    `;
  });
}

export async function setMemberBadgeVisibility(authUserId: string, badgeKey: string, visible: boolean): Promise<void> {
  if (!Object.hasOwn(MEMBERSHIP_BADGES, badgeKey) || typeof visible !== "boolean") {
    throw new BadgeNotificationError(400, "Choose a valid badge and visibility.");
  }
  await getApplicationDatabase().begin(async tx => {
    const memberId = await lockBadgeOwner(tx, authUserId);
    await reconcileMemberBadgeCollection(tx, memberId);
    const awards = await readValidMemberBadgeRows(tx, memberId);
    if (!awards.some(award => award.badge_key === badgeKey)) throw new BadgeNotificationError(404, "That earned badge is unavailable.");
    await tx`
      update member_badge_awards set public_visible = ${visible}, visibility_updated_at = statement_timestamp()
      where member_id = ${memberId}::uuid and badge_key = ${badgeKey}
    `;
  });
}
