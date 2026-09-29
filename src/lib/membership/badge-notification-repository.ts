import "server-only";

import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { MEMBERSHIP_BADGES, memberBadge, type MemberBadge } from "./badge-model";

export class BadgeNotificationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "BadgeNotificationError";
  }
}

/** Earned history remains available after billing ends; account access must still be valid. */
async function lockBadgeOwner(tx: TransactionSql, authUserId: string): Promise<string> {
  // Person linkage is canonical. Operator claims may lack the legacy member_id;
  // when that bridge exists, it must still agree with the canonical identity.
  const [owner] = await tx<Array<{ member_id: string }>>`
    select member.id as member_id
    from platform_users account
    join ruined_members member on member.person_id = account.person_id
      and (account.member_id is null or member.id = account.member_id)
      and member.deleted_at is null
    join people person on person.id = member.person_id and person.status = 'active'
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
      and lifecycle.account_state not in ('suspended', 'closed')
    join platform_role_grants member_grant on member_grant.auth_user_id = account.auth_user_id
      and member_grant.role_slug = 'member' and member_grant.revoked_at is null
    where account.auth_user_id = ${authUserId}::uuid and account.status = 'active'
    for share of account, member, person, lifecycle, member_grant
  `;
  if (!owner) throw new BadgeNotificationError(403, "Your member badges are unavailable.");
  return owner.member_id;
}

/** Only the exact additive-column rollout gap is allowed to look like an empty queue. */
function missingAcknowledgementColumn(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "42703"
    && "message" in error && /^column (?:award\.)?"?acknowledged_at"? does not exist$/.test(String(error.message));
}

export async function getUnacknowledgedMemberBadges(authUserId: string): Promise<MemberBadge[]> {
  const sql = getApplicationDatabase();
  try {
    return await sql.begin(async tx => {
      const memberId = await lockBadgeOwner(tx, authUserId);
      const rows = await tx<Array<{ badge_key: string; earned_at: Date; source_event_id: string; rule_version: number }>>`
        select award.badge_key, award.earned_at, award.source_event_id, award.rule_version from member_badge_awards award
        join ruined_members member on member.id = award.member_id
        where award.member_id = ${memberId}::uuid and award.acknowledged_at is null
          and (award.badge_key <> 'early-supporter' or exists (
            select 1 from private.member_number_assignments assignment
            where assignment.member_id = member.id and assignment.member_number = member.member_number
              and assignment.member_number between 0 and 50
          ))
        order by award.earned_at, award.badge_key
      `;
      return rows.flatMap(row => {
        const badge = memberBadge(row.badge_key, new Date(row.earned_at).toISOString());
        if (!badge) return [];
        return [{ ...badge, ...(row.badge_key === "early-supporter" && row.rule_version === 3
          && row.source_event_id === "existing-profile-grant:2026-09-28"
          ? { description: "Had a Ruined profile before launch." } : {}) }];
      });
    });
  } catch (error) {
    if (missingAcknowledgementColumn(error)) return [];
    throw error;
  }
}

export async function acknowledgeMemberBadge(authUserId: string, badgeKey: string): Promise<void> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(badgeKey) || !Object.hasOwn(MEMBERSHIP_BADGES, badgeKey)) {
    throw new BadgeNotificationError(400, "Choose a valid badge.");
  }
  const sql = getApplicationDatabase();
  await sql.begin(async tx => {
    const memberId = await lockBadgeOwner(tx, authUserId);
    const rows = await tx<Array<{ badge_key: string }>>`
      update member_badge_awards award
      set acknowledged_at = coalesce(award.acknowledged_at, statement_timestamp())
      from ruined_members member
      where award.member_id = ${memberId}::uuid and member.id = award.member_id
        and award.badge_key = ${badgeKey}
        and (award.badge_key <> 'early-supporter' or exists (
          select 1 from private.member_number_assignments assignment
          where assignment.member_id = member.id and assignment.member_number = member.member_number
            and assignment.member_number between 0 and 50
        ))
      returning award.badge_key
    `;
    if (!rows.length) throw new BadgeNotificationError(404, "That earned badge is unavailable.");
  });
}
