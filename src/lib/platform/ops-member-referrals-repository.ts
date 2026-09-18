import "server-only";

import { getApplicationDatabase } from "@/lib/database/server";
import { OpsRepositoryError, requireOpsAdmin } from "@/lib/platform/ops-repository";

export type OpsMemberReferrals = { joinedCount: number; joins: Array<{ memberId: string; name: string; joinedAt: string }> };
export async function getOpsMemberReferrals(actorAuthUserId: string, memberId: string): Promise<OpsMemberReferrals> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(memberId)) throw new OpsRepositoryError("invalid_request", "Choose a valid member.");
  return getApplicationDatabase().begin(async tx => {
    await requireOpsAdmin(tx, actorAuthUserId);
    const [member] = await tx<Array<{ id: string }>>`select id from ruined_members where id = ${memberId}::uuid`;
    if (!member) throw new OpsRepositoryError("not_found", "Member not found.");
    const [total] = await tx<Array<{ total: number }>>`select count(*)::integer as total from member_referrals where inviter_member_id = ${memberId}::uuid and joined_at is not null`;
    const rows = await tx<Array<{ member_id: string; name: string; joined_at: Date | string }>>`
      select referral.referred_member_id as member_id, referral.joined_at,
        coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(profile.preferred_name), ''), 'Member') as name
      from member_referrals referral left join person_profiles profile on profile.person_id = referral.referred_person_id
      where referral.inviter_member_id = ${memberId}::uuid and referral.joined_at is not null
      order by referral.joined_at desc, referral.referred_member_id limit 50
    `;
    return { joinedCount: total?.total ?? 0, joins: rows.map(row => ({ memberId: row.member_id, name: row.name, joinedAt: new Date(row.joined_at).toISOString() })) };
  });
}
