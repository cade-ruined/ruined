import "server-only";

import type postgres from "postgres";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import type { MemberIdentity } from "@/lib/membership/model";

export type ExperienceMemberAudience = {
  block_id: string | null;
  circle_id: string | null;
  progression_level_slug?: string | null;
  visibility: string;
};

// A scoped event does not authorize an arbitrary member ID supplied by a client.
// Lock the entitlement and audience evidence until this transaction commits so
// membership or assignment revocation cannot race a new admission/promotion.
export async function memberEligibleForExperience(
  tx: postgres.TransactionSql,
  experience: ExperienceMemberAudience,
  memberId: string | null,
): Promise<boolean> {
  if (!memberId) return false;
  const rows = await tx<Array<{
    account_state: MemberIdentity["accountState"];
    administrative_onboarding_state: MemberIdentity["administrativeOnboardingState"];
    auth_user_id: string;
    billing_state: MemberIdentity["billingState"];
    cancellation_effective_at: Date | string | null;
    email_normalized: string;
    foundations_state: MemberIdentity["foundationsState"];
    person_id: string;
    current_progression_level_slug: string | null;
    program_state: MemberIdentity["programState"];
    standing_state: MemberIdentity["standingState"];
  }>>`
    select member.person_id, account.auth_user_id, account.email_normalized,
      lifecycle.account_state, lifecycle.administrative_onboarding_state,
      lifecycle.billing_state, lifecycle.cancellation_effective_at,
      lifecycle.foundations_state, lifecycle.program_state, lifecycle.standing_state,
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
    for share of member, person, lifecycle, account, member_grant
  `;
  const row = rows[0];
  if (!row) return false;
  const access = deriveMemberAccessPolicy({
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
  // Paid Foundations members can attend their own Circle while completing the
  // program; that exception must not grant general Experience access.
  if (!memberCan(access, "experiences.member") && !(
    experience.visibility === "circle" && memberCan(access, "circle.read")
  )) return false;

  if (experience.visibility === "circle") {
    const assignments = await tx`
      select assignment.id
      from circle_member_assignments assignment
      join circles circle on circle.id = assignment.circle_id and circle.status = 'active'
      where assignment.member_id = ${memberId}::uuid
        and assignment.circle_id = ${experience.circle_id}::uuid
        and assignment.ended_at is null
        and assignment.assigned_at <= statement_timestamp()
        and circle.activated_at <= statement_timestamp()
        and (circle.ends_at is null or circle.ends_at >= statement_timestamp())
      for share of assignment, circle
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
        and member_assignment.ended_at is null
        and member_assignment.assigned_at <= statement_timestamp()
        and circle.activated_at <= statement_timestamp()
        and (circle.ends_at is null or circle.ends_at >= statement_timestamp())
        and block_assignment.assigned_at <= statement_timestamp()
        and block.activated_at <= statement_timestamp()
        and (block.ends_at is null or block.ends_at >= statement_timestamp())
        and block_assignment.block_id = ${experience.block_id}::uuid
      for share of member_assignment, circle, block_assignment, block
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
