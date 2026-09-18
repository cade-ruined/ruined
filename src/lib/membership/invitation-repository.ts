import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getApplicationDatabase } from "@/lib/database/server";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { getMemberIdentity } from "@/lib/membership/repository";
import {
  invitationCard, MEMBER_INVITATION_TOKEN, MemberInvitationError, validateMemberInvitationInput,
  type MemberInvitationInput, type MemberInvitationSnapshot, type PublicMemberInvitation,
} from "./invitation-model";

type InvitationRow = { member_id: string; public_token: string; enabled: boolean; version: number };
const wearSeed = (memberId: string) => createHash("sha256").update(`ruined-invitation:${memberId}`).digest("hex").slice(0, 24);
async function owner(authUserId: string) {
  const identity = await getMemberIdentity(authUserId);
  if (!identity) throw new MemberInvitationError(403, "Member access is required.");
  const policy = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(policy, "profile.read") && !memberCan(policy, "account.read")) throw new MemberInvitationError(403, "Member access is required.");
  return { identity, writable: memberCan(policy, "profile.write") };
}
export async function getOwnMemberInvitation(authUserId: string): Promise<MemberInvitationSnapshot> {
  const { identity, writable } = await owner(authUserId);
  const sql = getApplicationDatabase();
  const [rows, names, counts, eligibility] = await Promise.all([
    sql<InvitationRow[]>`select member_id, public_token, enabled, version from member_invitations where member_id = ${identity.memberId}::uuid`,
    sql<Array<{ name: string }>>`select coalesce(nullif(btrim(display_name), ''), nullif(btrim(preferred_name), ''), 'Member') as name from person_profiles where person_id = ${identity.personId}::uuid`,
    sql<Array<{ total: number }>>`select count(*)::integer as total from member_referrals where inviter_member_id = ${identity.memberId}::uuid and joined_at is not null`,
    sql<Array<{ eligible: boolean }>>`select private.ruined_member_can_share_invitation(${identity.memberId}::uuid) as eligible`,
  ]);
  const row = rows[0], eligible = eligibility[0]?.eligible === true;
  return { card: invitationCard(names[0]?.name ?? "Member", wearSeed(identity.memberId)), enabled: row?.enabled ?? false,
    eligible, writable, version: row?.version ?? 0, joinedCount: counts[0]?.total ?? 0,
    url: row?.enabled && eligible ? `/invitation/${row.public_token}` : null };
}
export async function saveOwnMemberInvitation(authUserId: string, value: MemberInvitationInput): Promise<MemberInvitationSnapshot> {
  const input = validateMemberInvitationInput(value);
  const { identity } = await owner(authUserId);
  await getApplicationDatabase().begin(async tx => {
    await tx`select id from ruined_members where id = ${identity.memberId}::uuid for update`;
    const [row] = await tx<InvitationRow[]>`select member_id, public_token, enabled, version from member_invitations where member_id = ${identity.memberId}::uuid for update`;
    if ((row?.version ?? 0) !== input.version) throw new MemberInvitationError(409, "This invitation changed in another tab. Reload before saving.");
    // Re-check the actual owner inside the write transaction, including revocation.
    const [authorized] = await tx<Array<{ active: boolean }>>`select exists (
      select 1 from platform_users viewer join platform_role_grants grant_row on grant_row.auth_user_id = viewer.auth_user_id
        and grant_row.role_slug = 'member' and grant_row.revoked_at is null
      where viewer.auth_user_id = ${authUserId}::uuid and viewer.person_id = ${identity.personId}::uuid and viewer.status = 'active'
    ) as active`;
    if (!authorized?.active) throw new MemberInvitationError(403, "Member access is required.");
    if (input.enabled) {
      await tx`select member_id from member_lifecycle where member_id = ${identity.memberId}::uuid for share`;
      const [check] = await tx<Array<{ eligible: boolean }>>`select private.ruined_member_can_share_invitation(${identity.memberId}::uuid) as eligible`;
      if (!check?.eligible) throw new MemberInvitationError(403, "Complete your membership before sharing an invitation.");
    }
    if (!row && !input.enabled) return;
    const token = row?.public_token ?? randomBytes(32).toString("base64url");
    await tx`insert into member_invitations(member_id, public_token, enabled)
      values (${identity.memberId}::uuid, ${token}, ${input.enabled})
      on conflict (member_id) do update set enabled = excluded.enabled, version = member_invitations.version + 1, updated_at = statement_timestamp()`;
  });
  return getOwnMemberInvitation(authUserId);
}
export async function getPublicMemberInvitation(token: string): Promise<PublicMemberInvitation | null> {
  if (!MEMBER_INVITATION_TOKEN.test(token)) return null;
  const [row] = await getApplicationDatabase()<Array<{ member_id: string; name: string }>>`
    select invitation.member_id, coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(profile.preferred_name), ''), 'Member') as name
    from member_invitations invitation join ruined_members member on member.id = invitation.member_id
    left join person_profiles profile on profile.person_id = member.person_id
    where invitation.public_token = ${token} and invitation.enabled
      and private.ruined_member_can_share_invitation(invitation.member_id)
    limit 1
  `;
  return row ? { card: invitationCard(row.name, wearSeed(row.member_id)) } : null;
}
