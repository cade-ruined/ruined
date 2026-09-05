import "server-only";

import { randomUUID } from "node:crypto";

import { PlatformAccessDeniedError } from "@/lib/platform/repository";
import { getBillingDatabase } from "@/lib/stripe/database";
import { isPlausibleEmail, normalizeEmail } from "@/lib/stripe/membership-state";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EMAIL_LENGTH = 254;

type MemberAccountState = "active" | "closed" | "invited" | "provisional" | "suspended";
type MemberBillingState = "active" | "attention_required" | "ended" | "pending";

export type OperatorMemberProfileResult = {
  memberAccess: boolean;
};

/**
 * Gives a verified operator a basic member profile without granting paid
 * membership benefits. Existing member state is canonical: revoked member
 * roles and suspended or closed accounts are never restored here.
 */
export async function ensureOperatorMemberProfile(input: {
  authUserId: string;
  email: string;
}): Promise<OperatorMemberProfileResult> {
  const authUserId = input.authUserId.trim();
  const email = input.email.trim();
  const emailNormalized = normalizeEmail(email);

  if (
    !UUID_PATTERN.test(authUserId) ||
    emailNormalized.length > MAX_EMAIL_LENGTH ||
    !isPlausibleEmail(emailNormalized)
  ) {
    throw new PlatformAccessDeniedError();
  }

  const sql = getBillingDatabase();
  return sql.begin(async (tx) => {
    // Match the shared passwordless claim lock so member and operator claims
    // cannot create competing identities for the same verified email.
    await tx`select pg_advisory_xact_lock(hashtext(${emailNormalized}), 1)`;

    const operatorRows = await tx<
      Array<{
        email_normalized: string;
        member_id: string | null;
        person_id: string | null;
        status: "active" | "disabled" | "invited" | "suspended";
      }>
    >`
      select
        platform_user.email_normalized,
        platform_user.member_id,
        platform_user.person_id,
        platform_user.status
      from platform_users platform_user
      where platform_user.auth_user_id = ${authUserId}::uuid
        and exists (
          select 1
          from platform_role_grants operator_grant
          where operator_grant.auth_user_id = platform_user.auth_user_id
            and operator_grant.role_slug in ('ops_admin', 'circle_leader', 'guide')
            and operator_grant.revoked_at is null
        )
      limit 1
      for update of platform_user
    `;
    const operator = operatorRows[0];
    if (
      !operator ||
      operator.status !== "active" ||
      operator.email_normalized !== emailNormalized ||
      !operator.person_id
    ) {
      throw new PlatformAccessDeniedError();
    }

    const verifiedIdentityRows = await tx<Array<{ person_id: string }>>`
      select person.id as person_id
      from people person
      join person_email_addresses email_address
        on email_address.person_id = person.id
      where person.id = ${operator.person_id}::uuid
        and person.status = 'active'
        and email_address.email_normalized = ${emailNormalized}
        and email_address.verification_state = 'verified'
        and email_address.retired_at is null
      limit 1
      for key share of person, email_address
    `;
    if (!verifiedIdentityRows[0]) throw new PlatformAccessDeniedError();

    const memberGrantRows = await tx<Array<{ revoked_at: Date | string | null }>>`
      select revoked_at
      from platform_role_grants
      where auth_user_id = ${authUserId}::uuid
        and role_slug = 'member'
      order by granted_at, id
      for update
    `;
    const hasActiveMemberRole = memberGrantRows.some((row) => row.revoked_at === null);
    const hasRevokedMemberRole = memberGrantRows.some((row) => row.revoked_at !== null);

    const memberRows = await tx<
      Array<{
        email_normalized: string;
        id: string;
        membership_state: MemberBillingState;
        person_id: string | null;
      }>
    >`
      select id, person_id, email_normalized, membership_state
      from ruined_members
      where person_id = ${operator.person_id}::uuid
        or email_normalized = ${emailNormalized}
      order by id
      for update
    `;

    // Two partial records, or one record owned by a different Person, requires
    // explicit identity resolution rather than an automatic merge at sign-in.
    if (memberRows.length > 1) throw new PlatformAccessDeniedError();
    let member = memberRows[0];
    if (
      member &&
      (member.email_normalized !== emailNormalized ||
        (member.person_id !== null && member.person_id !== operator.person_id))
    ) {
      throw new PlatformAccessDeniedError();
    }
    if (operator.member_id && (!member || operator.member_id !== member.id)) {
      throw new PlatformAccessDeniedError();
    }

    const lifecycleRows = member
      ? await tx<
          Array<{
            account_state: MemberAccountState;
            billing_state: MemberBillingState;
          }>
        >`
          select account_state, billing_state
          from member_lifecycle
          where member_id = ${member.id}::uuid
          limit 1
          for update
        `
      : [];
    const lifecycle = lifecycleRows[0];

    // A prior member revocation is intentional. Operator permissions remain
    // valid, but this helper must not quietly recreate personal access.
    if (!hasActiveMemberRole && hasRevokedMemberRole) {
      return { memberAccess: false };
    }
    if (lifecycle?.account_state === "suspended" || lifecycle?.account_state === "closed") {
      return { memberAccess: false };
    }
    // An active grant with no membership record is inconsistent data. Do not
    // attach it to a newly generated member behind the operator's back.
    if (!member && hasActiveMemberRole) throw new PlatformAccessDeniedError();

    const priorAccountState = lifecycle?.account_state ?? null;
    const priorPlatformMemberId = operator.member_id;
    const createdMember = !member;
    const memberId = member?.id ?? randomUUID();

    if (!member) {
      const insertedMembers = await tx<
        Array<{
          email_normalized: string;
          id: string;
          membership_state: MemberBillingState;
          person_id: string;
        }>
      >`
        insert into ruined_members (
          id,
          person_id,
          email,
          email_normalized,
          membership_state
        ) values (
          ${memberId}::uuid,
          ${operator.person_id}::uuid,
          ${email},
          ${emailNormalized},
          'pending'
        )
        returning id, person_id, email_normalized, membership_state
      `;
      member = insertedMembers[0];
      if (!member) throw new Error("The operator member profile could not be created.");

      // Insert the concrete onboarding record before lifecycle triggers create
      // their generic fallback. This is the same intake shape members use.
      await tx`
        insert into member_onboardings (
          member_id,
          state,
          form_version,
          requirements_snapshot,
          started_at
        ) values (
          ${memberId}::uuid,
          'in_progress',
          'administrative-v1',
          jsonb_build_object(
            'legal_name', true,
            'preferred_name', true,
            'mobile', true,
            'birth_date_or_age_attestation', true,
            'shipping_address', true,
            'apparel_sizing', true,
            'profile_photo', 'progressive'
          ),
          statement_timestamp()
        )
      `;

      await tx`
        insert into member_lifecycle (
          member_id,
          account_state,
          billing_state,
          program_state,
          admission_state,
          administrative_onboarding_state,
          standing_state
        ) values (
          ${memberId}::uuid,
          'active',
          'pending',
          'prospect',
          'accepted',
          'in_progress',
          'pre_active'
        )
      `;
    } else {
      if (!member.person_id) {
        const linkedMembers = await tx<Array<{ id: string }>>`
          update ruined_members
          set person_id = ${operator.person_id}::uuid, updated_at = statement_timestamp()
          where id = ${memberId}::uuid
            and person_id is null
            and email_normalized = ${emailNormalized}
          returning id
        `;
        if (!linkedMembers[0]) throw new PlatformAccessDeniedError();
      }

      if (!lifecycle) {
        await tx`
          insert into member_lifecycle (
            member_id,
            account_state,
            billing_state,
            program_state,
            admission_state,
            administrative_onboarding_state,
            standing_state
          ) values (
            ${memberId}::uuid,
            'active',
            ${member.membership_state},
            'prospect',
            'accepted',
            'in_progress',
            'pre_active'
          )
        `;
      } else if (lifecycle.account_state === "provisional" || lifecycle.account_state === "invited") {
        await tx`
          update member_lifecycle
          set account_state = 'active', version = version + 1, updated_at = statement_timestamp()
          where member_id = ${memberId}::uuid
            and account_state in ('provisional', 'invited')
        `;
      }
    }

    const conflictingMemberLinks = await tx<Array<{ auth_user_id: string }>>`
      select auth_user_id
      from platform_users
      where member_id = ${memberId}::uuid
        and auth_user_id <> ${authUserId}::uuid
      order by auth_user_id
      limit 1
      for update
    `;
    if (conflictingMemberLinks[0]) throw new PlatformAccessDeniedError();

    const linkedPlatformUsers = await tx<Array<{ auth_user_id: string }>>`
      update platform_users
      set
        member_id = ${memberId}::uuid,
        user_type = 'member',
        updated_at = statement_timestamp()
      where auth_user_id = ${authUserId}::uuid
        and person_id = ${operator.person_id}::uuid
        and email_normalized = ${emailNormalized}
        and status = 'active'
        and (member_id is null or member_id = ${memberId}::uuid)
      returning auth_user_id
    `;
    if (!linkedPlatformUsers[0]) throw new PlatformAccessDeniedError();

    const insertedProfiles = await tx<Array<{ person_id: string }>>`
      insert into person_profiles (person_id)
      values (${operator.person_id}::uuid)
      on conflict (person_id) do nothing
      returning person_id
    `;

    let grantedMemberRole = false;
    if (!hasActiveMemberRole) {
      const grantedRows = await tx<Array<{ id: string }>>`
        insert into platform_role_grants (
          auth_user_id,
          role_slug,
          granted_at
        ) values (
          ${authUserId}::uuid,
          'member',
          statement_timestamp()
        )
        returning id::text
      `;
      if (!grantedRows[0]) throw new Error("Member profile access could not be recorded.");
      grantedMemberRole = true;
    }

    const activatedAccount = priorAccountState !== "active";
    if (activatedAccount) {
      await tx`
        insert into member_state_history (
          member_id,
          dimension,
          previous_state,
          next_state,
          reason_code,
          source,
          actor_auth_user_id,
          metadata,
          dedupe_key
        ) values (
          ${memberId}::uuid,
          'account',
          ${priorAccountState},
          'active',
          'operator_member_profile_provisioned',
          'system',
          ${authUserId}::uuid,
          jsonb_build_object('paid_benefits_granted', false),
          ${`operator-member-profile-account:${authUserId}:${memberId}`}
        )
        on conflict (dedupe_key) do nothing
      `;
    }

    const changed =
      createdMember ||
      activatedAccount ||
      grantedMemberRole ||
      priorPlatformMemberId !== memberId ||
      insertedProfiles.length > 0;

    if (changed) {
      const beforeSnapshot = tx.json({
        accountState: priorAccountState,
        activeMemberRole: hasActiveMemberRole,
        platformMemberLinked: priorPlatformMemberId === memberId,
      });
      const afterSnapshot = tx.json({
        accountState: "active",
        activeMemberRole: true,
        billingState: member.membership_state,
        memberCreated: createdMember,
        paidBenefitsGranted: false,
        platformMemberLinked: true,
      });
      await tx`
        insert into operator_audit_events (
          actor_auth_user_id,
          action,
          subject_type,
          subject_id,
          member_id,
          before_snapshot,
          after_snapshot,
          metadata,
          dedupe_key
        ) values (
          ${authUserId}::uuid,
          'operator_member_profile.provisioned',
          'member_profile',
          ${memberId},
          ${memberId}::uuid,
          ${beforeSnapshot},
          ${afterSnapshot},
          jsonb_build_object(
            'source', 'unified_passwordless_sign_in',
            'access_tier', 'entry_profile_only'
          ),
          ${`operator-member-profile:${authUserId}:${memberId}`}
        )
        on conflict (dedupe_key) do nothing
      `;
    }

    return { memberAccess: true };
  });
}
