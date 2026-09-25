import "server-only";

import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase, withFreshApplicationDatabaseRead } from "@/lib/database/server";
import { ensurePersonForEmail, PersonIdentityConflictError } from "@/lib/identity/repository";
import type { PlatformViewer } from "@/lib/platform/model";
import { getPlatformConfiguration } from "@/lib/platform/config";
import type { MembershipBillingPlan } from "@/lib/membership/pricing";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export class PersonalInvitationAdmissionDeniedError extends Error {
  constructor() { super("Invitation unavailable."); this.name = "PersonalInvitationAdmissionDeniedError"; }
}
const deny = () => { throw new PersonalInvitationAdmissionDeniedError(); };

export type PersonalInvitationClaim = {
  id: string; member_id: string | null; origin: "member" | "ruined_direct"; billing_plan: MembershipBillingPlan | null; recipient_name: string; recipient_email_normalized: string;
  issued_at: Date; expires_at: Date; accepted_at: Date | null;
  accepted_by_auth_user_id: string | null; accepted_member_id: string | null;
};

/** Read-only preflight. Only verification and the subsequent claim can grant access. */
export async function getPersonalInvitationAdmissionEligibility(email: string, token: string): Promise<boolean> {
  if (!TOKEN.test(token)) return false;
  const normalized = email.trim().toLowerCase();
  return withFreshApplicationDatabaseRead("member-invitations", async () => {
    const sql = getApplicationDatabase();
    const [row] = await sql<Array<{ eligible: boolean }>>`select exists (
      select 1 from member_personal_invitations invitation
      left join ruined_members inviter on inviter.id = invitation.member_id and inviter.deleted_at is null
      where invitation.public_token = ${token} and invitation.recipient_email_normalized = ${normalized}
        and invitation.revoked_at is null and invitation.expires_at > clock_timestamp()
        and private.ruined_personal_invitation_benefit_available(invitation.id)
        and ((invitation.origin = 'ruined_direct' and ${getPlatformConfiguration().stripeCheckoutReady === true}
          and private.ruined_direct_invitation_available(invitation.id))
          or (invitation.origin = 'member' and private.ruined_member_can_share_invitation(invitation.member_id)
            and inviter.email_normalized <> ${normalized}
            and not exists (select 1 from person_email_addresses address
              where address.person_id = inviter.person_id and address.email_normalized = ${normalized} and address.retired_at is null)))
        and not exists (select 1 from platform_users viewer where viewer.email_normalized = ${normalized}
          and (viewer.status in ('disabled','suspended') or (
            exists(select 1 from platform_role_grants g where g.auth_user_id = viewer.auth_user_id and g.role_slug = 'member' and g.revoked_at is not null)
            and not exists(select 1 from platform_role_grants g where g.auth_user_id = viewer.auth_user_id and g.role_slug = 'member' and g.revoked_at is null))))
        and not exists (select 1 from ruined_members member left join member_lifecycle lifecycle on lifecycle.member_id = member.id
          where (member.email_normalized = ${normalized} or member.person_id in (
            select person_id from person_email_addresses where email_normalized = ${normalized} and retired_at is null))
            and (member.deleted_at is not null or lifecycle.account_state in ('suspended','closed')))
        and not exists (select 1 from people person where person.status <> 'active' and (
          person.id in (select person_id from person_email_addresses where email_normalized = ${normalized} and retired_at is null)
          or person.id in (select person_id from platform_users where email_normalized = ${normalized})))
    ) as eligible`;
    return row?.eligible ?? false;
  });
}

/** Acquire the parent/source locks before the recipient-email advisory lock. */
export async function lockPersonalInvitationClaim(tx: TransactionSql, viewer: PlatformViewer, token: string): Promise<PersonalInvitationClaim> {
  if (!TOKEN.test(token)) return deny();
  const [source] = await tx<Array<{ member_id: string | null; origin: string }>>`select member_id, origin from member_personal_invitations where public_token = ${token}`;
  if (!source) return deny();
  if (source.origin === "ruined_direct" && !getPlatformConfiguration().stripeCheckoutReady) return deny();
  if (source.member_id !== null) {
    // Current staff or independent complimentary funding is locked before the
    // source member, preventing a concurrent revocation from approving admission.
    await tx`select private.ruined_lock_member_complimentary_funding(${source.member_id}::uuid)`;
    await tx`select id from ruined_members where id = ${source.member_id}::uuid for update`;
    await tx`select person.id from people person join ruined_members member on member.person_id = person.id
      where member.id = ${source.member_id}::uuid for share of person`;
    await tx`select member_id from member_lifecycle where member_id = ${source.member_id}::uuid for share`;
    await tx`select viewer.auth_user_id from platform_users viewer
      join ruined_members member on member.person_id = viewer.person_id
      join platform_role_grants grant_row on grant_row.auth_user_id = viewer.auth_user_id and grant_row.role_slug = 'member'
      where member.id = ${source.member_id}::uuid for share of viewer, grant_row`;
  }
  const [invitation] = await tx<PersonalInvitationClaim[]>`select * from member_personal_invitations where public_token = ${token} for update`;
  if (!invitation || invitation.recipient_email_normalized !== viewer.email.trim().toLowerCase()
      || (invitation.accepted_by_auth_user_id && invitation.accepted_by_auth_user_id !== viewer.authUserId)) return deny();
  await requireCurrentPersonalInvitation(tx, invitation);
  return invitation;
}

async function requireCurrentPersonalInvitation(tx: TransactionSql, invitation: PersonalInvitationClaim) {
  if (invitation.origin === "ruined_direct") {
    if (!getPlatformConfiguration().stripeCheckoutReady) return deny();
    const [direct] = await tx<Array<{ eligible: boolean }>>`select exists (
      select 1 from member_personal_invitations where id = ${invitation.id}::uuid and origin = 'ruined_direct'
        and member_id is null and membership_type = 'standard' and revoked_at is null and expires_at > clock_timestamp()
        and private.ruined_direct_invitation_available(id)
    ) as eligible`;
    if (!direct?.eligible) deny();
    return;
  }
  const [row] = await tx<Array<{ eligible: boolean }>>`select exists (
    select 1 from member_personal_invitations invitation join ruined_members inviter on inviter.id = invitation.member_id
    where invitation.id = ${invitation.id}::uuid and invitation.revoked_at is null and invitation.expires_at > clock_timestamp()
      and private.ruined_personal_invitation_benefit_available(invitation.id)
      and inviter.deleted_at is null and private.ruined_member_can_share_invitation(inviter.id)
      and inviter.email_normalized <> invitation.recipient_email_normalized
      and not exists (select 1 from person_email_addresses address where address.person_id = inviter.person_id
        and address.email_normalized = invitation.recipient_email_normalized and address.retired_at is null)
  ) as eligible`;
  if (!row?.eligible) deny();
}

/** Caller already holds the source and recipient-email locks after provider verification. */
export async function preparePersonalInvitationClaim(tx: TransactionSql, viewer: PlatformViewer, invitation: PersonalInvitationClaim): Promise<string | null> {
  if (invitation.origin === "ruined_direct") return deny();
  const email = viewer.email.trim().toLowerCase();
  const identities = await tx<Array<{ auth_user_id: string; person_id: string | null; member_id: string | null; status: string; email_normalized: string }>>`
    select auth_user_id, person_id, member_id, status, email_normalized from platform_users
    where auth_user_id = ${viewer.authUserId}::uuid or email_normalized = ${email} order by auth_user_id for update`;
  if (identities.length > 1) return deny();
  const identity = identities[0];
  if (identity && (identity.auth_user_id !== viewer.authUserId || identity.email_normalized !== email
      || !['active','invited'].includes(identity.status))) return deny();
  const grants = await tx<Array<{ revoked_at: Date | null }>>`select revoked_at from platform_role_grants
    where auth_user_id = ${viewer.authUserId}::uuid and role_slug = 'member' for update`;
  if (grants.some(row => row.revoked_at) && !grants.some(row => !row.revoked_at)) return deny();
  const addresses = await tx<Array<{ person_id: string }>>`select person_id from person_email_addresses
    where email_normalized = ${email} and retired_at is null for update`;
  const personHint = identity?.person_id ?? addresses[0]?.person_id ?? null;
  if (identity?.person_id && addresses[0] && identity.person_id !== addresses[0].person_id) return deny();
  const members = await tx<Array<{ id: string; person_id: string; email_normalized: string; deleted_at: Date | null }>>`
    select id, person_id, email_normalized, deleted_at from ruined_members
    where email_normalized = ${email} or (${personHint}::uuid is not null and person_id = ${personHint}::uuid)
      or (${identity?.member_id ?? null}::uuid is not null and id = ${identity?.member_id ?? null}::uuid)
    order by id for update`;
  if (members.length > 1) return deny();
  let member = members[0];
  if (member && (member.deleted_at || member.email_normalized !== email || member.id === invitation.member_id
      || (personHint && member.person_id !== personHint))) return deny();
  if (identity?.member_id && identity.member_id !== member?.id) return deny();
  if (member) {
    const [lifecycle] = await tx<Array<{ account_state: string }>>`select account_state from member_lifecycle where member_id = ${member.id}::uuid for update`;
    if (lifecycle && ['suspended','closed'].includes(lifecycle.account_state)) return deny();
    const [person] = await tx<Array<{ status: string }>>`select status from people where id = ${member.person_id}::uuid for update`;
    if (!person || person.status !== 'active') return deny();
  }
  if (invitation.accepted_at) {
    if (!member || invitation.accepted_member_id !== member.id || identity?.member_id !== member.id
        || identity.status !== 'active' || !grants.some(row => !row.revoked_at)) return deny();
    return null;
  }
  let personId: string;
  try {
    personId = await ensurePersonForEmail(tx, { email, emailNormalized: email, preferredPersonId: personHint ?? member?.person_id,
      source: 'membership', verified: false });
  } catch (error) { if (error instanceof PersonIdentityConflictError) return deny(); throw error; }
  const [person] = await tx<Array<{ status: string }>>`select status from people where id = ${personId}::uuid for update`;
  if (!person || person.status !== 'active') return deny();
  if (!member) {
    if (grants.some(row => !row.revoked_at)) return deny();
    [member] = await tx<typeof members>`insert into ruined_members(id,person_id,email,email_normalized,membership_state)
      values(${randomUUID()}::uuid,${personId}::uuid,${email},${email},'pending') returning id,person_id,email_normalized,deleted_at`;
    if (!member) return deny();
  }

  // Referral attribution still uses its canonical first-interest row, but
  // accepting an invitation does not join a waitlist or queue marketing/sheet work.
  const [newEntry] = await tx<Array<{ id: string }>>`insert into membership_waitlist(name,email_normalized)
    values(${invitation.recipient_name},${email}) on conflict(email_normalized) do nothing returning id`;
  const [entry] = newEntry ? [newEntry] : await tx<Array<{ id: string }>>`select id from membership_waitlist where email_normalized = ${email}`;
  if (entry) {
    // Existing attribution is immutable; only an un-attributed verified joining
    // can establish its first inviter here.
    await tx`select private.ruined_capture_member_referral(${entry.id}::uuid,
      (select public_token from member_personal_invitations where id = ${invitation.id}::uuid))`;
  }
  if (identity?.status === 'active' && identity.member_id === member.id && grants.some(row => !row.revoked_at)) return null;
  const [allowance] = await tx<Array<{ id: string }>>`insert into passwordless_account_invites(
    member_id,email_normalized,intended_user_type,invited_at,expires_at,provider_reference)
    values(${member.id}::uuid,${email},'member',${invitation.issued_at},${invitation.expires_at},${`personal-invitation:${invitation.id}`})
    returning id::text`;
  return allowance?.id ?? deny();
}

export async function completePersonalInvitationClaim(tx: TransactionSql, viewer: PlatformViewer, invitation: PersonalInvitationClaim, memberId: string): Promise<void> {
  await requireCurrentPersonalInvitation(tx, invitation);
  if (invitation.accepted_at) {
    if (invitation.accepted_by_auth_user_id !== viewer.authUserId || invitation.accepted_member_id !== memberId) deny();
    return;
  }
  const [accepted] = await tx<Array<{ id: string }>>`update member_personal_invitations
    set accepted_at = clock_timestamp(), accepted_by_auth_user_id = ${viewer.authUserId}::uuid,
      accepted_member_id = ${memberId}::uuid, version = version + 1, updated_at = clock_timestamp(),
      delivery_status = case when delivery_status in ('queued','sending','failed') then 'cancelled' else delivery_status end,
      next_attempt_at = null, delivery_locked_at = null, delivery_lock_token = null
    where id = ${invitation.id}::uuid and accepted_at is null and revoked_at is null and expires_at > clock_timestamp()
    returning id`;
  if (!accepted) deny();
  if (invitation.origin !== "ruined_direct") await tx`select private.ruined_redeem_complimentary_invitation(${invitation.id}::uuid, ${memberId}::uuid, ${viewer.authUserId}::uuid)`;
}
