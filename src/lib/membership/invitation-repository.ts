import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getApplicationDatabase, withFreshApplicationDatabaseRead } from "@/lib/database/server";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { getMemberIdentity } from "@/lib/membership/repository";
import {
  invitationCard, MEMBER_INVITATION_TOKEN, MemberInvitationError, validateMemberInvitationInput,
  type MemberInvitationInput, type MemberInvitationSnapshot, type PublicMemberInvitation,
} from "./invitation-model";

type InvitationRow = { member_id: string; public_token: string; enabled: boolean; version: number; expires_at: Date | string; active: boolean };
const expiresAt = (value: Date | string) => new Date(value).toISOString();
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
    sql<InvitationRow[]>`select member_id, public_token, enabled, version, expires_at, expires_at > clock_timestamp() as active from member_invitations where member_id = ${identity.memberId}::uuid`,
    sql<Array<{ name: string; member_tag: string | null }>>`select coalesce(nullif(btrim(display_name), ''), nullif(btrim(preferred_name), ''), 'Member') as name, member_tag from person_profiles where person_id = ${identity.personId}::uuid`,
    sql<Array<{ total: number }>>`select count(*)::integer as total from member_referrals where inviter_member_id = ${identity.memberId}::uuid and joined_at is not null`,
    sql<Array<{ eligible: boolean }>>`select private.ruined_member_can_share_invitation(${identity.memberId}::uuid) as eligible`,
  ]);
  const row = rows[0], eligible = eligibility[0]?.eligible === true;
  return { card: invitationCard(names[0]?.name ?? "Member", wearSeed(identity.memberId), names[0]?.member_tag ?? null), enabled: row?.enabled ?? false,
    expiresAt: row ? expiresAt(row.expires_at) : null, eligible, writable, version: row?.version ?? 0, joinedCount: counts[0]?.total ?? 0,
    url: row?.enabled && row.active && eligible ? `/invitation/${row.public_token}` : null };
}
export async function saveOwnMemberInvitation(authUserId: string, value: MemberInvitationInput): Promise<MemberInvitationSnapshot> {
  const input = validateMemberInvitationInput(value);
  const { identity } = await owner(authUserId);
  await getApplicationDatabase().begin(async tx => {
    await tx`select id from ruined_members where id = ${identity.memberId}::uuid for update`;
    const [row] = await tx<InvitationRow[]>`select member_id, public_token, enabled, version, expires_at, expires_at > clock_timestamp() as active from member_invitations where member_id = ${identity.memberId}::uuid for update`;
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
    // A link gets one fixed 48-hour lifetime. Reading, copying, or redundant
    // enable requests never prolong it. A new invitation always gets a new token.
    const issue = input.enabled && (!row || !row.enabled || !row.active || input.renew === true);
    const token = issue ? randomBytes(32).toString("base64url") : row!.public_token;
    await tx`insert into member_invitations(member_id, public_token, enabled, issued_at, expires_at)
      values (${identity.memberId}::uuid, ${token}, ${input.enabled}, statement_timestamp(), statement_timestamp() + interval '48 hours')
      on conflict (member_id) do update set enabled = excluded.enabled, public_token = excluded.public_token,
        issued_at = case when ${issue} then excluded.issued_at else member_invitations.issued_at end,
        expires_at = case when ${issue} then excluded.expires_at else member_invitations.expires_at end,
        version = member_invitations.version + 1, updated_at = statement_timestamp()`;
  });
  return getOwnMemberInvitation(authUserId);
}
export async function getPublicMemberInvitation(token: string): Promise<PublicMemberInvitation | null> {
  if (!MEMBER_INVITATION_TOKEN.test(token)) return null;
  return withFreshApplicationDatabaseRead("member-invitations", async () => {
    const [row] = await getApplicationDatabase()<Array<{ member_id: string | null; origin: "member" | "ruined_direct"; name: string; member_tag: string | null; expires_at: Date | string; recipient_name: string | null;
      membership_type: "standard" | "complimentary"; complimentary_ends_at: Date | string | null }>>`
      select invitation.member_id, invitation.origin, invitation.expires_at, invitation.recipient_name,
        invitation.membership_type, invitation.complimentary_ends_at,
        case when invitation.origin = 'ruined_direct' then 'The Ruined Project'
          else coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(profile.preferred_name), ''), 'Member') end as name,
        case when invitation.origin = 'ruined_direct' then null else profile.member_tag end as member_tag
      from (
        select member_id, 'member'::text as origin, expires_at, null::text as recipient_name, 'standard'::text as membership_type, null::timestamptz as complimentary_ends_at from member_invitations
        where public_token = ${token} and enabled and expires_at > clock_timestamp()
        union all
        select member_id, origin, expires_at, recipient_name, membership_type, complimentary_ends_at from member_personal_invitations
        where public_token = ${token} and revoked_at is null and expires_at > clock_timestamp()
          and private.ruined_personal_invitation_benefit_available(id)
          and (origin = 'member' or (${getPlatformConfiguration().stripeCheckoutReady === true}
            and private.ruined_direct_invitation_available(id)))
      ) invitation left join ruined_members member on member.id = invitation.member_id
      left join person_profiles profile on profile.person_id = member.person_id
      where invitation.origin = 'ruined_direct'
        or (member.deleted_at is null and private.ruined_member_can_share_invitation(invitation.member_id))
      limit 1
    `;
    return row ? { card: invitationCard(row.name, wearSeed(row.member_id ?? "ruined-direct"), row.member_tag),
      ...(row.origin === "ruined_direct" ? { invitationSource: "ruined_direct" as const } : {}),
      expiresAt: expiresAt(row.expires_at),
      ...(row.recipient_name !== null ? { recipientName: row.recipient_name, membershipType: row.membership_type,
        complimentaryEndsAt: row.complimentary_ends_at ? expiresAt(row.complimentary_ends_at) : null } : {}) } : null;
  });
}
