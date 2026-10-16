import "server-only";

import { getApplicationDatabase } from "@/lib/database/server";
import { MEMBERSHIP_BADGES, type MemberBadge } from "./badge-model";
import {
  BadgeNotificationError, lockBadgeOwner, memberBadgeFromAward,
  readValidMemberBadgeRows, reconcileMemberBadgeCollection,
} from "./badge-repository";
export { BadgeNotificationError } from "./badge-repository";

export async function getUnacknowledgedMemberBadges(authUserId: string): Promise<MemberBadge[]> {
  return getApplicationDatabase().begin(async tx => {
    const memberId = await lockBadgeOwner(tx, authUserId);
    await reconcileMemberBadgeCollection(tx, memberId);
    const rows = await readValidMemberBadgeRows(tx, memberId);
    return rows.flatMap(row => {
      const badge = row.acknowledged_at ? null : memberBadgeFromAward(row);
      return badge ? [badge] : [];
    });
  });
}

export async function acknowledgeMemberBadge(authUserId: string, badgeKey: string): Promise<void> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(badgeKey) || !Object.hasOwn(MEMBERSHIP_BADGES, badgeKey)) {
    throw new BadgeNotificationError(400, "Choose a valid badge.");
  }
  await getApplicationDatabase().begin(async tx => {
    const memberId = await lockBadgeOwner(tx, authUserId);
    await reconcileMemberBadgeCollection(tx, memberId);
    const rows = await readValidMemberBadgeRows(tx, memberId);
    if (!rows.some(row => row.badge_key === badgeKey)) throw new BadgeNotificationError(404, "That earned badge is unavailable.");
    await tx`
      update member_badge_awards set acknowledged_at = coalesce(acknowledged_at, statement_timestamp())
      where member_id = ${memberId}::uuid and badge_key = ${badgeKey}
    `;
  });
}
