import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase, withFreshApplicationDatabaseRead } from "@/lib/database/server";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { getMemberIdentity } from "@/lib/membership/repository";
import { invitationCard, MemberInvitationError } from "./invitation-model";
import {
  PERSONAL_INVITATION_DAILY_LIMIT, PERSONAL_INVITATION_UUID, validateCreatePersonalMemberInvitationInput,
  validatePersonalMemberInvitationVersionInput, type CreatePersonalMemberInvitationInput,
  type PersonalInvitationDeliveryStatus, type PersonalMemberInvitationsSnapshot, type PersonalMemberInvitationVersionInput,
} from "./personal-invitation-model";

type InvitationRow = {
  id: string; recipient_name: string; recipient_email_normalized: string; public_token: string;
  issued_at: Date | string; expires_at: Date | string; revoked_at: Date | string | null;
  submitted_at: Date | string | null; accepted_at: Date | string | null; joined_at: Date | string | null; active: boolean;
  delivery_status: PersonalInvitationDeliveryStatus; sent_at: Date | string | null; version: number;
  email_requested: boolean; first_attempt_at: Date | string | null; delivery_attempts: number; retry_safe: boolean;
  membership_type: "standard" | "complimentary"; complimentary_reason: string | null; complimentary_ends_at: Date | string | null;
  grant_id: string | null; grant_starts_at: Date | string | null; grant_ends_at: Date | string | null; grant_revoked_at: Date | string | null;
  benefit_available: boolean; expired: boolean;
};
type Snapshot = Omit<PersonalMemberInvitationsSnapshot, "emailReady">;
const date = (value: Date | string) => new Date(value).toISOString();
const nullableDate = (value: Date | string | null) => value ? date(value) : null;

async function owner(authUserId: string) {
  const identity = await getMemberIdentity(authUserId);
  if (!identity) throw new MemberInvitationError(403, "Member access is required.");
  const policy = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(policy, "profile.read") && !memberCan(policy, "account.read")) throw new MemberInvitationError(403, "Member access is required.");
  return { identity, writable: memberCan(policy, "profile.write") };
}

async function authorizeWrite(tx: TransactionSql, authUserId: string, memberId: string, personId: string) {
  await tx`select private.ruined_lock_member_complimentary_funding(${memberId}::uuid)`;
  await tx`select id from ruined_members where id = ${memberId}::uuid for update`;
  const [authorized] = await tx<Array<{ active: boolean }>>`select exists (
    select 1 from platform_users viewer join platform_role_grants grant_row on grant_row.auth_user_id = viewer.auth_user_id
      and grant_row.role_slug = 'member' and grant_row.revoked_at is null
    join ruined_members member on member.person_id = viewer.person_id and member.id = ${memberId}::uuid and member.deleted_at is null
    where viewer.auth_user_id = ${authUserId}::uuid and viewer.person_id = ${personId}::uuid and viewer.status = 'active'
  ) as active`;
  if (!authorized?.active) throw new MemberInvitationError(403, "Member access is required.");
}

async function requireComplimentaryAdministrator(tx: TransactionSql, authUserId: string, memberId: string) {
  // Hold the issuing authority through the write, before member/invitation locks.
  await tx`select grant_row.auth_user_id from platform_role_grants grant_row
    where grant_row.auth_user_id = ${authUserId}::uuid and grant_row.role_slug = 'ops_admin' and grant_row.revoked_at is null
    for share`;
  await tx`select auth_user_id from platform_users where auth_user_id = ${authUserId}::uuid for share`;
  const [row] = await tx<Array<{ allowed: boolean }>>`
    select private.ruined_can_authorize_complimentary_invitation(${memberId}::uuid, ${authUserId}::uuid) as allowed`;
  if (!row?.allowed) throw new MemberInvitationError(403, "Only an administrator can grant or end complimentary membership.");
}

async function auditComplimentary(tx: TransactionSql, authUserId: string, invitationId: string, action: string, reason: string, details: Record<string, string | null>) {
  await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,reason,after_snapshot,metadata,dedupe_key)
    values(${authUserId}::uuid,${action},'member_personal_invitation',${invitationId},${reason},${tx.json(details)}::jsonb,'{}'::jsonb,
      ${`${action}:${invitationId}`})`;
}

async function requireEligible(tx: TransactionSql, memberId: string) {
  await tx`select member_id from member_lifecycle where member_id = ${memberId}::uuid for share`;
  const [row] = await tx<Array<{ eligible: boolean }>>`select private.ruined_member_can_share_invitation(${memberId}::uuid) as eligible`;
  if (!row?.eligible) throw new MemberInvitationError(403, "Complete your membership before sending an invitation.");
}

export async function getOwnPersonalInvitations(authUserId: string): Promise<Snapshot> {
  return withFreshApplicationDatabaseRead("member-invitations", async () => {
    const { identity, writable } = await owner(authUserId);
    const sql = getApplicationDatabase();
    const [names] = await sql<Array<{ name: string; member_tag: string | null; eligible: boolean; can_grant_complimentary: boolean }>>`
      select coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(profile.preferred_name), ''), 'Member') as name,
        profile.member_tag, private.ruined_member_can_share_invitation(member.id) as eligible,
        private.ruined_can_authorize_complimentary_invitation(member.id, ${authUserId}::uuid) as can_grant_complimentary
      from ruined_members member left join person_profiles profile on profile.person_id = member.person_id
      where member.id = ${identity.memberId}::uuid and member.deleted_at is null`;
    if (!names) throw new MemberInvitationError(403, "Member access is required.");
    const rows = await sql<InvitationRow[]>`select invitation.*, referral.joined_at,
      private.ruined_personal_invitation_benefit_available(invitation.id) as benefit_available, invitation.expires_at <= clock_timestamp() as expired,
      funding.id as grant_id, funding.starts_at as grant_starts_at, funding.ends_at as grant_ends_at, funding.revoked_at as grant_revoked_at,
      invitation.revoked_at is null and invitation.accepted_at is null and invitation.expires_at > clock_timestamp()
        and private.ruined_personal_invitation_benefit_available(invitation.id) as active
      from member_personal_invitations invitation left join member_referrals referral on referral.personal_invitation_id = invitation.id
      left join member_complimentary_grants funding on funding.source_invitation_id = invitation.id
      where invitation.member_id = ${identity.memberId}::uuid order by invitation.issued_at desc, invitation.id desc`;
    const [counts] = await sql<Array<{ joined: number; recent: number }>>`select
      (select count(*)::integer from member_referrals where inviter_member_id = ${identity.memberId}::uuid and joined_at is not null) as joined,
      (select count(*)::integer from member_personal_invitations where member_id = ${identity.memberId}::uuid and issued_at > clock_timestamp() - interval '24 hours') as recent`;
    const [legacy] = await sql<Array<{ public_token: string; issued_at: Date | string; expires_at: Date | string; enabled: boolean; version: number; active: boolean }>>`
      select public_token, issued_at, expires_at, enabled, version, expires_at > clock_timestamp() as active
      from member_invitations where member_id = ${identity.memberId}::uuid`;
    return {
      card: invitationCard(names.name, createHash("sha256").update(`ruined-invitation:${identity.memberId}`).digest("hex").slice(0, 24), names.member_tag),
      eligible: names.eligible, writable, canGrantComplimentary: names.can_grant_complimentary,
      invitations: rows.map(row => ({ id: row.id, recipientName: row.recipient_name, recipientEmail: row.recipient_email_normalized,
        url: row.active && names.eligible ? `/invitation/${row.public_token}` : null,
        issuedAt: date(row.issued_at), expiresAt: date(row.expires_at), revokedAt: nullableDate(row.revoked_at),
        submittedAt: nullableDate(row.submitted_at), acceptedAt: nullableDate(row.accepted_at), joinedAt: nullableDate(row.joined_at),
        deliveryStatus: row.delivery_status, sentAt: nullableDate(row.sent_at), version: row.version,
        membershipType: row.membership_type, complimentaryReason: row.complimentary_reason, complimentaryEndsAt: nullableDate(row.complimentary_ends_at),
        available: row.benefit_available,
        complimentaryGrant: row.grant_id && row.grant_starts_at ? { id: row.grant_id, startsAt: date(row.grant_starts_at),
          endsAt: nullableDate(row.grant_ends_at), revokedAt: nullableDate(row.grant_revoked_at) } : null })),
      counts: { created: rows.length, active: rows.filter(row => row.active && !row.submitted_at && !row.joined_at).length,
        expired: rows.filter(row => row.expired && !row.revoked_at && !row.submitted_at && !row.accepted_at).length,
        submitted: rows.filter(row => row.submitted_at).length, accepted: rows.filter(row => row.accepted_at).length, joined: counts?.joined ?? 0 },
      dailyLimit: PERSONAL_INVITATION_DAILY_LIMIT, remainingToday: Math.max(0, PERSONAL_INVITATION_DAILY_LIMIT - (counts?.recent ?? 0)),
      legacyInvitation: legacy ? { url: legacy.enabled && legacy.active && names.eligible ? `/invitation/${legacy.public_token}` : null,
        issuedAt: date(legacy.issued_at), expiresAt: date(legacy.expires_at), enabled: legacy.enabled, version: legacy.version } : null,
    };
  });
}

export async function createOwnPersonalInvitation(authUserId: string, value: CreatePersonalMemberInvitationInput): Promise<Snapshot> {
  const input = validateCreatePersonalMemberInvitationInput(value);
  const { identity } = await owner(authUserId);
  await getApplicationDatabase().begin(async tx => {
    if (input.membershipType === "complimentary") await requireComplimentaryAdministrator(tx, authUserId, identity.memberId);
    await authorizeWrite(tx, authUserId, identity.memberId, identity.personId);
    // Parent serialization makes retries, duplicate-recipient checks and the
    // rolling daily cap atomic even when several tabs create at once.
    const [existing] = await tx<InvitationRow[]>`select * from member_personal_invitations
      where member_id = ${identity.memberId}::uuid and request_id = ${input.requestId}::uuid`;
    if (existing) {
      if (existing.recipient_name !== input.recipientName || existing.recipient_email_normalized !== input.recipientEmail || existing.email_requested !== input.sendEmail
          || existing.membership_type !== input.membershipType || existing.complimentary_reason !== input.complimentaryReason
          || nullableDate(existing.complimentary_ends_at) !== input.complimentaryEndsAt) {
        throw new MemberInvitationError(409, "This request already created a different invitation. Start a new invitation.");
      }
      return;
    }
    if (input.complimentaryEndsAt) {
      const [duration] = await tx<Array<{ valid: boolean }>>`select ${input.complimentaryEndsAt}::timestamptz > clock_timestamp() as valid`;
      if (!duration?.valid) throw new MemberInvitationError(400, "Choose a future end date, or leave membership ongoing.");
    }
    if (input.membershipType === "complimentary") {
      const [billing] = await tx<Array<{ paid: boolean }>>`select exists (
        select 1 from ruined_members member left join member_lifecycle lifecycle on lifecycle.member_id=member.id
        where (member.email_normalized=${input.recipientEmail} or member.person_id in (
          select person_id from person_email_addresses where email_normalized=${input.recipientEmail} and retired_at is null))
        and (lifecycle.billing_state='active' or exists(select 1 from stripe_subscriptions subscription
          where subscription.member_id=member.id and subscription.stripe_status not in ('canceled','incomplete_expired'))
          or exists(select 1 from stripe_checkout_attempts attempt where attempt.member_id=member.id and attempt.status not in ('completed','expired','failed'))
          or exists(select 1 from stripe_checkout_sessions checkout where checkout.member_id=member.id
            and (checkout.session_status is null or checkout.session_status not in ('complete','expired'))))
      ) as paid`;
      if (billing?.paid) throw new MemberInvitationError(409, "This person already has membership billing. Resolve their existing subscription before offering complimentary membership.");
    }
    await requireEligible(tx, identity.memberId);
    const [check] = await tx<Array<{ duplicate: boolean; self: boolean; recent: number }>>`select
      exists(select 1 from member_personal_invitations where member_id = ${identity.memberId}::uuid
        and recipient_email_normalized = ${input.recipientEmail} and revoked_at is null and accepted_at is null
        and expires_at > clock_timestamp() and private.ruined_personal_invitation_benefit_available(id)) as duplicate,
      (exists(select 1 from person_email_addresses where person_id = ${identity.personId}::uuid
        and email_normalized = ${input.recipientEmail} and retired_at is null)
        or exists(select 1 from ruined_members where id = ${identity.memberId}::uuid and email_normalized = ${input.recipientEmail})) as self,
      (select count(*)::integer from member_personal_invitations where member_id = ${identity.memberId}::uuid
        and issued_at > clock_timestamp() - interval '24 hours') as recent`;
    if (check?.self) throw new MemberInvitationError(400, "Choose someone else's email for this invitation.");
    if (check?.duplicate) throw new MemberInvitationError(409, "You already have an active invitation for this email. Use it or revoke it first.");
    if ((check?.recent ?? 0) >= PERSONAL_INVITATION_DAILY_LIMIT) throw new MemberInvitationError(429, "You've reached 20 invitations in 24 hours. Please try again later.");
    const [profile] = await tx<Array<{ name: string; member_tag: string | null }>>`select
      coalesce(nullif(btrim(display_name), ''), nullif(btrim(preferred_name), ''), 'Member') as name, member_tag
      from person_profiles where person_id = ${identity.personId}::uuid`;
    const [created] = await tx<Array<{ id: string }>>`insert into member_personal_invitations(member_id, request_id, public_token, recipient_name, recipient_email_normalized,
      inviter_name, inviter_tag, email_requested, delivery_status, next_attempt_at,
      membership_type,complimentary_reason,complimentary_ends_at,complimentary_authorized_by_auth_user_id)
      values(${identity.memberId}::uuid, ${input.requestId}::uuid, ${randomBytes(32).toString("base64url")}, ${input.recipientName},
        ${input.recipientEmail}, ${profile?.name ?? "Member"}, ${profile?.member_tag ?? null}, ${input.sendEmail},
        ${input.sendEmail ? "queued" : "not_requested"}, case when ${input.sendEmail} then statement_timestamp() else null end,
        ${input.membershipType},${input.complimentaryReason},${input.complimentaryEndsAt}::timestamptz,
        ${input.membershipType === "complimentary" ? authUserId : null}::uuid) returning id`;
    if (input.membershipType === "complimentary") await auditComplimentary(tx, authUserId, created.id,
      "complimentary_invitation.created", input.complimentaryReason!, { membershipType: input.membershipType, endsAt: input.complimentaryEndsAt });
  });
  return getOwnPersonalInvitations(authUserId);
}

export async function endOwnInvitationComplimentaryAccess(authUserId: string, id: string, value: PersonalMemberInvitationVersionInput): Promise<Snapshot> {
  const input = validatePersonalMemberInvitationVersionInput(value);
  if (!PERSONAL_INVITATION_UUID.test(id)) throw new MemberInvitationError(404, "Invitation not found.");
  const { identity } = await owner(authUserId);
  await getApplicationDatabase().begin(async tx => {
    await requireComplimentaryAdministrator(tx, authUserId, identity.memberId);
    await authorizeWrite(tx, authUserId, identity.memberId, identity.personId);
    const [invitation] = await tx<InvitationRow[]>`select * from member_personal_invitations
      where id = ${id}::uuid and member_id = ${identity.memberId}::uuid for update`;
    if (!invitation) throw new MemberInvitationError(404, "Invitation not found.");
    if (invitation.version !== input.version) throw new MemberInvitationError(409, "This invitation changed in another tab. Reload before saving.");
    if (!invitation.accepted_at || invitation.membership_type !== "complimentary") throw new MemberInvitationError(409, "This invitation has no accepted complimentary membership.");
    const [grant] = await tx<Array<{ id: string; revoked_at: Date | null }>>`select id,revoked_at from member_complimentary_grants
      where source_invitation_id = ${id}::uuid for update`;
    if (!grant) throw new MemberInvitationError(409, "Complimentary access is unavailable. Refresh and try again.");
    if (grant.revoked_at) return;
    await tx`update member_complimentary_grants set revoked_at=clock_timestamp(),revoked_by_auth_user_id=${authUserId}::uuid
      where id=${grant.id}::uuid`;
    await tx`update member_personal_invitations set version=version+1,updated_at=clock_timestamp() where id=${id}::uuid`;
    await auditComplimentary(tx, authUserId, id, "complimentary_invitation.ended", "Complimentary access ended by administrator.", { grantId: grant.id });
  });
  return getOwnPersonalInvitations(authUserId);
}

export async function revokeOwnPersonalInvitation(authUserId: string, id: string, value: PersonalMemberInvitationVersionInput): Promise<Snapshot> {
  const input = validatePersonalMemberInvitationVersionInput(value);
  if (!PERSONAL_INVITATION_UUID.test(id)) throw new MemberInvitationError(404, "Invitation not found.");
  const { identity } = await owner(authUserId);
  await getApplicationDatabase().begin(async tx => {
    await authorizeWrite(tx, authUserId, identity.memberId, identity.personId);
    const [row] = await tx<InvitationRow[]>`select * from member_personal_invitations where id = ${id}::uuid and member_id = ${identity.memberId}::uuid for update`;
    if (!row) throw new MemberInvitationError(404, "Invitation not found.");
    if (row.version !== input.version) throw new MemberInvitationError(409, "This invitation changed in another tab. Reload before saving.");
    if (row.accepted_at) throw new MemberInvitationError(409, "This invitation has already been accepted.");
    if (row.revoked_at) return;
    await tx`update member_personal_invitations set revoked_at = statement_timestamp(), version = version + 1, updated_at = statement_timestamp(),
      delivery_status = case when delivery_status in ('queued','sending','failed') then 'cancelled' else delivery_status end,
      next_attempt_at = null, delivery_locked_at = null, delivery_lock_token = null
      where id = ${id}::uuid and member_id = ${identity.memberId}::uuid`;
  });
  return getOwnPersonalInvitations(authUserId);
}

export async function retryOwnPersonalInvitationEmail(authUserId: string, id: string, value: PersonalMemberInvitationVersionInput): Promise<Snapshot> {
  const input = validatePersonalMemberInvitationVersionInput(value);
  if (!PERSONAL_INVITATION_UUID.test(id)) throw new MemberInvitationError(404, "Invitation not found.");
  const { identity } = await owner(authUserId);
  await getApplicationDatabase().begin(async tx => {
    await authorizeWrite(tx, authUserId, identity.memberId, identity.personId);
    await requireEligible(tx, identity.memberId);
    const [row] = await tx<InvitationRow[]>`select *, (expires_at > clock_timestamp() and private.ruined_personal_invitation_benefit_available(id)) as active,
      ((first_attempt_at is null and delivery_attempts = 0) or first_attempt_at > clock_timestamp() - interval '23 hours') as retry_safe
      from member_personal_invitations where id = ${id}::uuid and member_id = ${identity.memberId}::uuid for update`;
    if (!row) throw new MemberInvitationError(404, "Invitation not found.");
    if (row.version !== input.version) throw new MemberInvitationError(409, "This invitation changed in another tab. Reload before saving.");
    if (row.accepted_at) throw new MemberInvitationError(409, "This invitation has already been accepted.");
    if (!row.active || row.revoked_at) throw new MemberInvitationError(409, "Create a new invitation to send a fresh link.");
    if (!row.retry_safe || row.delivery_attempts >= 5) throw new MemberInvitationError(409, "The email cannot safely be retried. Share this invitation link instead.");
    if (!["failed", "queued"].includes(row.delivery_status)) throw new MemberInvitationError(409, "This email is already sent or being sent.");
    await tx`update member_personal_invitations set delivery_status = 'queued', next_attempt_at = statement_timestamp(),
      delivery_locked_at = null, delivery_lock_token = null, last_error_code = null, version = version + 1, updated_at = statement_timestamp()
      where id = ${id}::uuid and member_id = ${identity.memberId}::uuid`;
  });
  return getOwnPersonalInvitations(authUserId);
}
