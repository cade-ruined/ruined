import "server-only";

import type postgres from "postgres";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import type { MemberIdentity } from "@/lib/membership/model";

export type ExperienceMemberAudience = {
  id?: string;
  experience_id?: string;
  block_id: string | null;
  circle_id: string | null;
  progression_level_slug?: string | null;
  registration_mode?: string;
  visibility: string;
};

/** An explicit operator invitation grants only its call, never general membership or Circle access. */
async function explicitInvitationMember(
  tx: postgres.Sql | postgres.TransactionSql,
  memberId: string,
  lockEvidence: boolean,
): Promise<{ person_id: string } | null> {
  const funding = await tx<Array<{ complimentary: boolean; operator: boolean }>>`
    select ${lockEvidence
      ? tx`private.ruined_lock_member_complimentary_funding(${memberId}::uuid)`
      : tx`private.ruined_member_has_complimentary_funding(${memberId}::uuid)`} as complimentary,
      ${lockEvidence
      ? tx`private.ruined_lock_member_operator_funding(${memberId}::uuid)`
      : tx`private.ruined_member_has_operator_funding(${memberId}::uuid)`} as operator
  `;
  const rows = await tx<Array<{
    person_id: string; billing_state: string; standing_state: string;
    cancellation_effective_at: Date | string | null;
  }>>`
    select member.person_id, lifecycle.billing_state, lifecycle.standing_state,
      lifecycle.cancellation_effective_at
    from ruined_members member
    join people person on person.id = member.person_id and person.status = 'active'
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
    join platform_users account on account.member_id = member.id
      and account.person_id = member.person_id and account.status = 'active'
    join platform_role_grants member_grant on member_grant.auth_user_id = account.auth_user_id
      and member_grant.role_slug = 'member' and member_grant.revoked_at is null
    join person_email_addresses email_address on email_address.person_id = member.person_id
      and email_address.is_primary and email_address.retired_at is null
      and email_address.verification_state = 'verified'
    where member.id = ${memberId}::uuid and member.deleted_at is null
      and lifecycle.account_state = 'active'
      and lifecycle.standing_state in ('pre_active', 'active', 'cancellation_requested')
      and (lifecycle.standing_state <> 'cancellation_requested'
        or lifecycle.cancellation_effective_at > statement_timestamp())
    limit 1
    ${lockEvidence ? tx`for share of member, person, lifecycle, account, member_grant, email_address` : tx``}
  `;
  const member = rows[0];
  if (!member) return null;
  if (funding[0]?.complimentary || funding[0]?.operator) return member;
  if (member.billing_state === "active" && member.standing_state !== "pre_active") return member;
  // Saved cards and accepted terms are not payment. Reuse the provider-verified,
  // nonrefunded reservation evidence used by registration and fulfillment.
  let paid = await tx<Array<{ reservation_id: string | null }>>`
    select private.ruined_member_paid_reservation(${memberId}::uuid) as reservation_id
  `;
  if (!paid[0]?.reservation_id) return null;
  if (lockEvidence) {
    await tx`select proof.reservation_id from stripe_membership_prepaid_proofs proof
      join membership_commercial_reservations reservation on reservation.id = proof.reservation_id
      join stripe_membership_commitments contract on contract.id = proof.contract_id
      join stripe_invoices invoice on invoice.id = proof.stripe_invoice_id
      join stripe_subscriptions subscription on subscription.id = proof.stripe_subscription_id
      where proof.reservation_id = ${paid[0].reservation_id}::uuid
      for share of proof, reservation, contract, invoice, subscription`;
    paid = await tx<Array<{ reservation_id: string | null }>>`
      select private.ruined_member_paid_reservation(${memberId}::uuid) as reservation_id
    `;
  }
  return paid[0]?.reservation_id ? member : null;
}

async function eligibleExplicitInvitation(
  tx: postgres.TransactionSql,
  experience: ExperienceMemberAudience,
  memberId: string,
  lockEvidence: boolean,
  operatorEnrollment = false,
): Promise<boolean> {
  if (experience.visibility !== "invite_only" || experience.registration_mode !== "internal") return false;
  const member = await explicitInvitationMember(tx, memberId, lockEvidence);
  if (!member) return false;
  if (operatorEnrollment) return true;
  const experienceId = experience.id ?? experience.experience_id;
  if (!experienceId) return false;
  const registrations = await tx`
    select registration.id from experience_registrations registration
    where registration.experience_id = ${experienceId}::uuid
      and registration.member_id = ${memberId}::uuid and registration.person_id = ${member.person_id}::uuid
      and registration.status = 'registered' and registration.source = 'ops'
    ${lockEvidence ? tx`for share of registration` : tx``}
  `;
  return registrations.length > 0;
}

/** Only a currently authorized administrator can create this narrowly scoped invitation. */
export async function memberEligibleForOperatorInvitation(
  tx: postgres.TransactionSql,
  experience: ExperienceMemberAudience,
  memberId: string | null,
  actorAuthUserId: string,
  lockEvidence = true,
): Promise<boolean> {
  if (!memberId || experience.visibility !== "invite_only" || experience.registration_mode !== "internal") return false;
  const operators = await tx`select account.auth_user_id from platform_users account
    join platform_role_grants admin_grant on admin_grant.auth_user_id = account.auth_user_id
      and admin_grant.role_slug = 'ops_admin' and admin_grant.revoked_at is null
    where account.auth_user_id = ${actorAuthUserId}::uuid and account.status = 'active'
    ${lockEvidence ? tx`for share of account, admin_grant` : tx``}`;
  return operators.length > 0 && eligibleExplicitInvitation(tx, experience, memberId, lockEvidence, true);
}

/** Read-only allowlist for Calendar/Meet while the rest of a member's profile remains held. */
export async function getEligibleExplicitExperienceInvitationIds(authUserId: string): Promise<string[]> {
  const { getApplicationDatabase } = await import("@/lib/database/server");
  // This allowlist is read-only and does not lock evidence. Keep it on the
  // caller's scoped read pool; READ COMMITTED adds no cross-query snapshot.
  const tx = getApplicationDatabase();
  const accounts = await tx<Array<{ member_id: string }>>`select member_id from platform_users
    where auth_user_id = ${authUserId}::uuid and status = 'active' and member_id is not null`;
  const memberId = accounts[0]?.member_id;
  if (!memberId) return [];
  const invitations = await tx<Array<{ id: string }>>`select experience.id
    from experiences experience join experience_registrations registration on registration.experience_id = experience.id
    join ruined_members member on member.id = registration.member_id and member.person_id = registration.person_id
    where experience.visibility = 'invite_only' and experience.registration_mode = 'internal'
      and experience.status in ('published', 'completed')
      and registration.member_id = ${memberId}::uuid
      and registration.status = 'registered' and registration.source = 'ops'
    order by experience.starts_at, experience.id`;
  if (!invitations.length || !await explicitInvitationMember(tx, memberId, false)) return [];
  return invitations.map(invitation => invitation.id);
}

export async function hasEligibleExplicitExperienceInvitations(authUserId: string): Promise<boolean> {
  return (await getEligibleExplicitExperienceInvitationIds(authUserId)).length > 0;
}

// A scoped event does not authorize an arbitrary member ID supplied by a client.
// Lock the entitlement and audience evidence until this transaction commits so
// membership or assignment revocation cannot race a new admission/promotion.
export async function memberEligibleForExperience(
  tx: postgres.TransactionSql,
  experience: ExperienceMemberAudience,
  memberId: string | null,
): Promise<boolean> {
  return evaluateExperienceMemberAccess(tx, experience, memberId, true);
}

// Display-only snapshot. The same policy and audience checks apply, but no
// evidence is locked. Never use this result to authorize an admission or send;
// mutation paths must recheck with memberEligibleForExperience above.
export async function memberEligibleForExperienceSnapshot(
  tx: postgres.TransactionSql,
  experience: ExperienceMemberAudience,
  memberId: string | null,
): Promise<boolean> {
  return evaluateExperienceMemberAccess(tx, experience, memberId, false);
}

async function evaluateExperienceMemberAccess(
  tx: postgres.TransactionSql,
  experience: ExperienceMemberAudience,
  memberId: string | null,
  lockEvidence: boolean,
): Promise<boolean> {
  if (!memberId) return false;
  if (experience.visibility === "invite_only" && experience.registration_mode === "internal"
    && await eligibleExplicitInvitation(tx, experience, memberId, lockEvidence)) return true;
  // Preserve the existing completed-member policy (including waitlists). The
  // invitation is an additional call-only path for funded onboarding members.
  const funding = lockEvidence
    ? await tx<Array<{ complimentary_funded: boolean }>>`
        select private.ruined_lock_member_complimentary_funding(${memberId}::uuid) as complimentary_funded
      `
    : await tx<Array<{ complimentary_funded: boolean }>>`
        select private.ruined_member_has_complimentary_funding(${memberId}::uuid) as complimentary_funded
      `;
  const rows = await tx<Array<{
    account_state: MemberIdentity["accountState"];
    administrative_onboarding_state: MemberIdentity["administrativeOnboardingState"];
    auth_user_id: string;
    billing_state: MemberIdentity["billingState"];
    cancellation_effective_at: Date | string | null;
    email_normalized: string;
    foundations_state: MemberIdentity["foundationsState"];
    circle_revealed: boolean;
    registration_held: boolean;
    person_id: string;
    current_progression_level_slug: string | null;
    program_state: MemberIdentity["programState"];
    standing_state: MemberIdentity["standingState"];
  }>>`
    select member.person_id, account.auth_user_id, account.email_normalized,
      lifecycle.account_state, lifecycle.administrative_onboarding_state,
      lifecycle.billing_state, lifecycle.cancellation_effective_at,
      lifecycle.foundations_state, lifecycle.program_state, lifecycle.standing_state,
      private.ruined_member_circle_is_revealed(member.id) as circle_revealed,
      not private.ruined_member_profile_released(member.id) as registration_held,
      lifecycle.current_progression_level_slug
    from ruined_members member
    join people person on person.id = member.person_id and person.status = 'active'
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
    join platform_users account
      on account.member_id = member.id and account.person_id = member.person_id
      and account.status = 'active'
    join platform_role_grants member_grant
      on member_grant.auth_user_id = account.auth_user_id
      and member_grant.role_slug = 'member' and member_grant.revoked_at is null
    where member.id = ${memberId}::uuid
    limit 1
    ${lockEvidence ? tx`for share of member, person, lifecycle, account, member_grant` : tx``}
  `;
  const row = rows[0];
  if (!row) return false;
  const access = deriveMemberAccessPolicy({
    registrationHeld: row.registration_held,
    membershipFunding: funding[0]?.complimentary_funded ? "complimentary" : "self",
    accountState: row.account_state,
    administrativeOnboardingState: row.administrative_onboarding_state,
    authUserId: row.auth_user_id,
    billingState: row.billing_state,
    cancellationEffectiveAt: row.cancellation_effective_at ? new Date(row.cancellation_effective_at).toISOString() : null,
    email: row.email_normalized,
    foundationsState: row.foundations_state,
    memberId,
    personId: row.person_id,
    programState: row.program_state,
    standingState: row.standing_state,
  });
  // Circle reveal requires completed Foundations or a grant for the current placement.
  if (!memberCan(access, "experiences.member") && !(
    experience.visibility === "circle" && memberCan(access, "circle.read")
  )) return false;

  if (["circle", "block"].includes(experience.visibility) && !row.circle_revealed) return false;

  if (experience.visibility === "circle") {
    const assignments = await tx`
      select assignment.id
      from circle_member_assignments assignment
      join circles circle on circle.id = assignment.circle_id and circle.status = 'active'
      where assignment.member_id = ${memberId}::uuid
        and private.ruined_member_circle_is_revealed(assignment.member_id)
        and assignment.circle_id = ${experience.circle_id}::uuid
        and assignment.ended_at is null
        and assignment.assigned_at <= statement_timestamp()
        and circle.activated_at <= statement_timestamp()
        and (circle.ends_at is null or circle.ends_at >= statement_timestamp())
      ${lockEvidence ? tx`for share of assignment, circle` : tx``}
    `;
    return assignments.length > 0;
  }
  if (experience.visibility === "block") {
    const assignments = await tx`
      select member_assignment.id
      from circle_member_assignments member_assignment
      join circles circle on circle.id = member_assignment.circle_id and circle.status = 'active'
      join block_circle_assignments block_assignment
        on block_assignment.circle_id = circle.id and block_assignment.ended_at is null
      join membership_blocks block on block.id = block_assignment.block_id and block.status = 'active'
      where member_assignment.member_id = ${memberId}::uuid
        and private.ruined_member_circle_is_revealed(member_assignment.member_id)
        and member_assignment.ended_at is null
        and member_assignment.assigned_at <= statement_timestamp()
        and circle.activated_at <= statement_timestamp()
        and (circle.ends_at is null or circle.ends_at >= statement_timestamp())
        and block_assignment.assigned_at <= statement_timestamp()
        and block.activated_at <= statement_timestamp()
        and (block.ends_at is null or block.ends_at >= statement_timestamp())
        and block_assignment.block_id = ${experience.block_id}::uuid
      ${lockEvidence ? tx`for share of member_assignment, circle, block_assignment, block` : tx``}
    `;
    return assignments.length > 0;
  }
  // Retain access for existing legacy-targeted events without introducing new
  // progression controls or presenting these statuses as promotions.
  if (experience.visibility === "progression") {
    return Boolean(experience.progression_level_slug)
      && experience.progression_level_slug === row.current_progression_level_slug;
  }
  return ["public", "all_members", "invite_only"].includes(experience.visibility);
}
