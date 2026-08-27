import "server-only";

import { markPersonEmailVerified } from "@/lib/identity/repository";
import { getBillingDatabase } from "@/lib/stripe/database";
import { normalizeEmail } from "@/lib/stripe/membership-state";
import {
  nextMemberAction,
  type AccountState,
  type ArtifactState,
  type BillingState,
  type FoundationsState,
  type MemberPlatformSnapshot,
  type OperatorDashboardSnapshot,
  type OperatorMemberSummary,
  type PlatformViewer,
  type ProgramState,
} from "@/lib/platform/model";

export type PlatformUserLink = {
  authUserId: string;
  memberId: string;
  personId: string;
};

export type OperatorRole = "circle_leader" | "guide" | "ops_admin";

export type OperatorMemberDirectoryFilter =
  | "all"
  | "attention"
  | "foundations"
  | "unassigned";

export type OperatorMemberDirectoryPage = {
  filter: OperatorMemberDirectoryFilter;
  members: OperatorMemberSummary[];
  page: number;
  pageCount: number;
  pageSize: number;
  query: string;
  totalResults: number;
};

export type PasswordlessAudience = "member" | "ops";
export type PasswordlessAccessEligibility = "invited" | "none" | "returning";

export class PlatformAccessDeniedError extends Error {
  constructor() {
    super("The verified identity is not linked to an active Ruined account.");
    this.name = "PlatformAccessDeniedError";
  }
}

export async function getPasswordlessAccessEligibility(
  email: string,
  audience: PasswordlessAudience,
): Promise<PasswordlessAccessEligibility> {
  const sql = getBillingDatabase();
  const emailNormalized = normalizeEmail(email);

  if (audience === "ops") {
    const rows = await sql<Array<{ eligible: boolean }>>`
      select exists (
        select 1
        from platform_users platform_user
        join platform_role_grants grant_row
          on grant_row.auth_user_id = platform_user.auth_user_id
        where platform_user.email_normalized = ${emailNormalized}
          and platform_user.status = 'active'
          and grant_row.role_slug in ('ops_admin', 'circle_leader', 'guide')
          and grant_row.revoked_at is null
      ) as eligible
    `;
    return rows[0]?.eligible ? "returning" : "none";
  }

  const rows = await sql<
    Array<{
      has_invite: boolean;
      is_returning: boolean;
    }>
  >`
    select
      exists (
        select 1
        from platform_users platform_user
        join platform_role_grants member_grant
          on member_grant.auth_user_id = platform_user.auth_user_id
          and member_grant.role_slug = 'member'
          and member_grant.revoked_at is null
        join ruined_members member on member.person_id = platform_user.person_id
        join member_lifecycle lifecycle on lifecycle.member_id = member.id
        where platform_user.email_normalized = ${emailNormalized}
          and platform_user.status = 'active'
          and lifecycle.account_state = 'active'
      ) as is_returning,
      exists (
        select 1
        from passwordless_account_invites invitation
        join ruined_members member on member.id = invitation.member_id
        where invitation.email_normalized = ${emailNormalized}
          and member.email_normalized = ${emailNormalized}
          and invitation.intended_user_type = 'member'
          and invitation.accepted_at is null
          and invitation.revoked_at is null
          and (invitation.expires_at is null or invitation.expires_at > statement_timestamp())
          and not exists (
            select 1
            from member_lifecycle lifecycle
            where lifecycle.member_id = invitation.member_id
              and lifecycle.account_state in ('suspended', 'closed')
          )
      ) as has_invite
  `;
  const eligibility = rows[0];
  if (eligibility?.is_returning) return "returning";
  return eligibility?.has_invite ? "invited" : "none";
}

export async function requireActivePlatformMemberLink(
  viewer: PlatformViewer,
): Promise<PlatformUserLink> {
  const sql = getBillingDatabase();
  const emailNormalized = normalizeEmail(viewer.email);

  const rows = await sql<Array<{ member_id: string; person_id: string }>>`
    select member.id as member_id, platform_user.person_id
    from platform_users platform_user
    join platform_role_grants member_grant
      on member_grant.auth_user_id = platform_user.auth_user_id
      and member_grant.role_slug = 'member'
      and member_grant.revoked_at is null
    join ruined_members member on member.person_id = platform_user.person_id
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
    where platform_user.auth_user_id = ${viewer.authUserId}::uuid
      and platform_user.email_normalized = ${emailNormalized}
      and platform_user.status = 'active'
      and lifecycle.account_state = 'active'
    limit 1
  `;
  const link = rows[0];
  if (!link) throw new PlatformAccessDeniedError();

  return {
    authUserId: viewer.authUserId,
    memberId: link.member_id,
    personId: link.person_id,
  };
}

export async function claimPlatformMemberForViewer(
  viewer: PlatformViewer,
): Promise<PlatformUserLink> {
  const sql = getBillingDatabase();
  const emailNormalized = normalizeEmail(viewer.email);

  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${emailNormalized}), 1)`;

    const existingLinks = await tx<
      Array<{
        email_normalized: string;
        member_id: string | null;
        person_id: string | null;
        status: "active" | "disabled" | "invited" | "suspended";
      }>
    >`
      select email_normalized, member_id, person_id, status
      from platform_users
      where auth_user_id = ${viewer.authUserId}::uuid
      limit 1
      for update
    `;
    const existingLink = existingLinks[0];

    if (existingLink?.status === "active" && existingLink.member_id) {
      if (existingLink.email_normalized !== emailNormalized) {
        throw new PlatformAccessDeniedError();
      }

      const memberRows = await tx<
        Array<{ account_state: AccountState; person_id: string }>
      >`
        select member.person_id, lifecycle.account_state
        from ruined_members member
        join member_lifecycle lifecycle on lifecycle.member_id = member.id
        join platform_role_grants member_grant
          on member_grant.auth_user_id = ${viewer.authUserId}::uuid
          and member_grant.role_slug = 'member'
          and member_grant.revoked_at is null
        where member.id = ${existingLink.member_id}::uuid
        limit 1
        for update of member, lifecycle
      `;
      if (
        memberRows[0]?.person_id !== existingLink.person_id ||
        memberRows[0]?.account_state !== "active"
      ) {
        throw new PlatformAccessDeniedError();
      }

      await tx`
        update platform_users
        set last_signed_in_at = now(), updated_at = now()
        where auth_user_id = ${viewer.authUserId}::uuid
      `;
      await markPersonEmailVerified(tx, {
        email: viewer.email,
        emailNormalized,
        personId: memberRows[0].person_id,
      });
      return {
        authUserId: viewer.authUserId,
        memberId: existingLink.member_id,
        personId: memberRows[0].person_id,
      };
    }

    if (
      existingLink &&
      (!["active", "invited"].includes(existingLink.status) ||
        existingLink.email_normalized !== emailNormalized)
    ) {
      throw new PlatformAccessDeniedError();
    }

    const conflictingEmailLinks = await tx<Array<{ auth_user_id: string }>>`
      select auth_user_id
      from platform_users
      where email_normalized = ${emailNormalized}
        and auth_user_id <> ${viewer.authUserId}::uuid
      limit 1
      for update
    `;
    if (conflictingEmailLinks.length > 0) throw new PlatformAccessDeniedError();

    const invitationRows = await tx<
      Array<{
        id: string;
        invited_at: Date;
        member_id: string;
      }>
    >`
      select id, invited_at, member_id
      from passwordless_account_invites
      where email_normalized = ${emailNormalized}
        and intended_user_type = 'member'
        and member_id is not null
        and accepted_at is null
        and revoked_at is null
        and (expires_at is null or expires_at > statement_timestamp())
      order by invited_at desc
      limit 1
      for update
    `;
    const invitation = invitationRows[0];
    if (!invitation) throw new PlatformAccessDeniedError();

    if (existingLink?.member_id && existingLink.member_id !== invitation.member_id) {
      throw new PlatformAccessDeniedError();
    }

    const memberRows = await tx<
      Array<{ id: string; membership_state: BillingState; person_id: string }>
    >`
      select id, membership_state, person_id
      from ruined_members
      where id = ${invitation.member_id}::uuid
        and email_normalized = ${emailNormalized}
      limit 1
      for update
    `;
    const member = memberRows[0];
    if (!member) throw new PlatformAccessDeniedError();
    if (existingLink?.person_id && existingLink.person_id !== member.person_id) {
      throw new PlatformAccessDeniedError();
    }

    const conflictingMemberLinks = await tx<Array<{ auth_user_id: string }>>`
      select auth_user_id
      from platform_users
      where member_id = ${member.id}::uuid
        and auth_user_id <> ${viewer.authUserId}::uuid
      limit 1
      for update
    `;
    if (conflictingMemberLinks.length > 0) throw new PlatformAccessDeniedError();

    const lifecycleRows = await tx<Array<{ account_state: AccountState }>>`
      select account_state
      from member_lifecycle
      where member_id = ${member.id}::uuid
      for update
    `;
    const existingLifecycle = lifecycleRows[0];
    if (
      existingLifecycle?.account_state === "suspended" ||
      existingLifecycle?.account_state === "closed"
    ) {
      throw new PlatformAccessDeniedError();
    }

    if (existingLink) {
      const updatedLinks = await tx<Array<{ member_id: string }>>`
        update platform_users
        set
          member_id = ${member.id}::uuid,
          person_id = ${member.person_id}::uuid,
          status = 'active',
          activated_at = coalesce(activated_at, now()),
          last_signed_in_at = now(),
          updated_at = now()
        where auth_user_id = ${viewer.authUserId}::uuid
          and email_normalized = ${emailNormalized}
          and status in ('invited', 'active')
        returning member_id
      `;
      if (!updatedLinks[0]) throw new PlatformAccessDeniedError();
    } else {
      await tx`
        insert into platform_users (
          auth_user_id,
          member_id,
          person_id,
          email_normalized,
          user_type,
          status,
          invited_at,
          activated_at,
          last_signed_in_at
        ) values (
          ${viewer.authUserId}::uuid,
          ${member.id}::uuid,
          ${member.person_id}::uuid,
          ${emailNormalized},
          'member',
          'active',
          ${invitation.invited_at},
          now(),
          now()
        )
      `;
    }

    const accountChanged = existingLifecycle?.account_state !== "active";

    if (!existingLifecycle) {
      await tx`
        insert into member_lifecycle (
          member_id,
          account_state,
          billing_state,
          program_state,
          admission_state,
          administrative_onboarding_state,
          standing_state
        )
        values (
          ${member.id}::uuid,
          'active',
          ${member.membership_state},
          'prospect',
          'accepted',
          'in_progress',
          'pre_active'
        )
      `;
    } else if (accountChanged) {
      await tx`
        update member_lifecycle
        set
          account_state = 'active',
          admission_state = case
            when admission_state in ('interested', 'applied', 'invited') then 'accepted'
            else admission_state
          end,
          administrative_onboarding_state = case
            when administrative_onboarding_state = 'not_started' then 'in_progress'
            else administrative_onboarding_state
          end,
          version = version + 1,
          updated_at = now()
        where member_id = ${member.id}::uuid
      `;
    }

    await tx`
      insert into member_onboardings (
        member_id,
        state,
        form_version,
        requirements_snapshot,
        started_at
      ) values (
        ${member.id}::uuid,
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
      on conflict (member_id) do update
      set
        state = case
          when member_onboardings.state = 'not_started' then 'in_progress'
          else member_onboardings.state
        end,
        started_at = coalesce(member_onboardings.started_at, excluded.started_at),
        updated_at = statement_timestamp()
    `;

    if (accountChanged) {
      await tx`
        insert into member_state_history (
          member_id,
          dimension,
          previous_state,
          next_state,
          reason_code,
          source,
          actor_auth_user_id,
          dedupe_key
        ) values (
          ${member.id}::uuid,
          'account',
          ${existingLifecycle?.account_state ?? null},
          'active',
          'verified_passwordless_access',
          'system',
          ${viewer.authUserId}::uuid,
          ${`platform-account-activated:${viewer.authUserId}`}
        )
        on conflict (dedupe_key) do nothing
      `;
    }

    const acceptedInvitations = await tx<Array<{ id: string }>>`
      update passwordless_account_invites
      set
        accepted_by_auth_user_id = ${viewer.authUserId}::uuid,
        accepted_at = statement_timestamp()
      where id = ${invitation.id}::bigint
        and accepted_at is null
        and revoked_at is null
        and (expires_at is null or expires_at > statement_timestamp())
      returning id
    `;
    if (!acceptedInvitations[0]) throw new PlatformAccessDeniedError();

    await tx`
      update passwordless_account_invites
      set
        revoked_at = statement_timestamp(),
        revoked_by_auth_user_id = ${viewer.authUserId}::uuid
      where email_normalized = ${emailNormalized}
        and id <> ${invitation.id}::bigint
        and accepted_at is null
        and revoked_at is null
    `;

    await tx`
      insert into platform_role_grants (auth_user_id, role_slug, granted_at)
      select ${viewer.authUserId}::uuid, 'member', now()
      where not exists (
        select 1
        from platform_role_grants
        where auth_user_id = ${viewer.authUserId}::uuid
          and role_slug = 'member'
          and revoked_at is null
      )
    `;

    await markPersonEmailVerified(tx, {
      email: viewer.email,
      emailNormalized,
      personId: member.person_id,
    });

    return {
      authUserId: viewer.authUserId,
      memberId: member.id,
      personId: member.person_id,
    };
  });
}

type MemberSnapshotRow = {
  account_state: AccountState;
  artifact_state: ArtifactState;
  billing_state: BillingState;
  block_name: string | null;
  block_status: MemberPlatformSnapshot["blockStatus"];
  circle_name: string | null;
  circle_status: MemberPlatformSnapshot["circleStatus"];
  display_name: string | null;
  email: string;
  foundations_progress: number | null;
  foundations_state: FoundationsState;
  member_id: string;
  program_state: ProgramState;
};

export async function getMemberPlatformSnapshot(
  authUserId: string,
): Promise<MemberPlatformSnapshot | null> {
  const sql = getBillingDatabase();
  const rows = await sql<Array<MemberSnapshotRow>>`
    select
      member.id as member_id,
      member.email,
      profile.display_name,
      lifecycle.account_state,
      lifecycle.billing_state,
      lifecycle.program_state,
      lifecycle.foundations_state,
      lifecycle.artifact_state,
      membership_block.name as block_name,
      membership_block.status as block_status,
      circle.name as circle_name,
      circle.status as circle_status,
      enrollment.progress_percent as foundations_progress
    from platform_users platform_user
    join platform_role_grants member_grant
      on member_grant.auth_user_id = platform_user.auth_user_id
      and member_grant.role_slug = 'member'
      and member_grant.revoked_at is null
    join ruined_members member on member.person_id = platform_user.person_id
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
    left join user_profiles profile on profile.auth_user_id = platform_user.auth_user_id
    left join lateral (
      select assignment.circle_id
      from circle_member_assignments assignment
      where assignment.member_id = member.id and assignment.ended_at is null
      order by assignment.assigned_at desc
      limit 1
    ) active_circle on true
    left join circles circle on circle.id = active_circle.circle_id
    left join block_circle_assignments block_assignment
      on block_assignment.circle_id = active_circle.circle_id
      and block_assignment.ended_at is null
    left join membership_blocks membership_block
      on membership_block.id = block_assignment.block_id
    left join lateral (
      select foundation_enrollment.progress_percent
      from foundation_enrollments foundation_enrollment
      join foundation_versions foundation_version
        on foundation_version.id = foundation_enrollment.foundation_version_id
      join foundation_programs foundation_program
        on foundation_program.id = foundation_version.foundation_program_id
      where foundation_enrollment.member_id = member.id
        and foundation_program.slug = 'ruined-foundations'
      order by foundation_enrollment.created_at desc
      limit 1
    ) enrollment on true
    where platform_user.auth_user_id = ${authUserId}::uuid
      and platform_user.status = 'active'
      and lifecycle.account_state = 'active'
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  const foundationsProgress = Math.min(100, Math.max(0, Number(row.foundations_progress ?? 0)));
  return {
    accountState: row.account_state,
    artifactState: row.artifact_state,
    billingState: row.billing_state,
    blockName: row.block_name,
    blockStatus: row.block_status,
    circleName: row.circle_name,
    circleStatus: row.circle_status,
    email: row.email,
    foundationsProgress,
    foundationsState: row.foundations_state,
    memberId: row.member_id,
    name: row.display_name?.trim() || "Member",
    nextAction: nextMemberAction({
      artifactState: row.artifact_state,
      billingState: row.billing_state,
      foundationsState: row.foundations_state,
      hasCircle: row.circle_status === "active",
    }),
    programState: row.program_state,
  };
}

export async function getOperatorRole(authUserId: string): Promise<OperatorRole | null> {
  const sql = getBillingDatabase();
  const rows = await sql<Array<{ role_slug: OperatorRole }>>`
    select grant_row.role_slug
    from platform_role_grants grant_row
    join platform_users platform_user
      on platform_user.auth_user_id = grant_row.auth_user_id
    where grant_row.auth_user_id = ${authUserId}::uuid
      and grant_row.role_slug in ('ops_admin', 'circle_leader', 'guide')
      and grant_row.revoked_at is null
      and platform_user.status = 'active'
    order by case grant_row.role_slug
      when 'ops_admin' then 1
      when 'circle_leader' then 2
      else 3
    end
    limit 1
  `;
  return rows[0]?.role_slug ?? null;
}

type OperatorMemberRow = {
  account_state: AccountState;
  artifact_state: ArtifactState;
  billing_state: BillingState;
  block_name: string | null;
  block_status: OperatorMemberSummary["blockStatus"];
  circle_name: string | null;
  circle_status: OperatorMemberSummary["circleStatus"];
  display_name: string | null;
  email: string;
  foundations_progress: number | null;
  foundations_state: FoundationsState;
  member_id: string;
  program_state: ProgramState;
};

const OPERATOR_MEMBER_DIRECTORY_PAGE_SIZE = 25;

function operatorMemberSummary(
  row: OperatorMemberRow,
  includeOperationalContact = true,
): OperatorMemberSummary {
  const foundationsProgress = Math.min(100, Math.max(0, Number(row.foundations_progress ?? 0)));
  return {
    accountState: row.account_state,
    artifactState: row.artifact_state,
    billingState: row.billing_state,
    blockName: row.block_name,
    blockStatus: row.block_status,
    circleName: row.circle_name,
    circleStatus: row.circle_status,
    email: includeOperationalContact ? row.email : "",
    foundationsProgress,
    foundationsState: row.foundations_state,
    memberId: row.member_id,
    name: row.display_name?.trim()
      || (includeOperationalContact ? row.email.split("@")[0] : "Member")
      || "Member",
    nextAction: nextMemberAction({
      artifactState: row.artifact_state,
      billingState: row.billing_state,
      foundationsState: row.foundations_state,
      hasCircle: row.circle_status === "active",
    }),
    programState: row.program_state,
  };
}

function normalizeOperatorMemberDirectoryFilter(
  filter: string | undefined,
): OperatorMemberDirectoryFilter {
  if (
    filter === "attention" ||
    filter === "foundations" ||
    filter === "unassigned"
  ) {
    return filter;
  }
  return "all";
}

function normalizeOperatorMemberDirectoryPage(page: number | undefined): number {
  if (!Number.isSafeInteger(page) || !page || page < 1) return 1;
  return page;
}

export async function getOperatorMemberDirectoryPage(
  authUserId: string,
  input: {
    filter?: string;
    page?: number;
    query?: string;
  } = {},
): Promise<OperatorMemberDirectoryPage | null> {
  const sql = getBillingDatabase();
  const filter = normalizeOperatorMemberDirectoryFilter(input.filter);
  const query = (input.query ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const requestedPage = normalizeOperatorMemberDirectoryPage(input.page);

  return sql.begin("isolation level repeatable read read only", async (tx) => {
    const roleRows = await tx<Array<{ role_slug: OperatorRole }>>`
      select grant_row.role_slug
      from platform_role_grants grant_row
      join platform_users platform_user
        on platform_user.auth_user_id = grant_row.auth_user_id
      where grant_row.auth_user_id = ${authUserId}::uuid
        and grant_row.role_slug in ('ops_admin', 'circle_leader', 'guide')
        and grant_row.revoked_at is null
        and platform_user.status = 'active'
      order by case grant_row.role_slug
        when 'ops_admin' then 1
        when 'circle_leader' then 2
        else 3
      end
      limit 1
    `;
    const role = roleRows[0]?.role_slug;
    if (!role) return null;

    const countRows = await tx<Array<{ total_results: number | string }>>`
      select count(*) as total_results
      from ruined_members member
      join member_lifecycle lifecycle on lifecycle.member_id = member.id
      left join platform_users platform_user on platform_user.member_id = member.id
      left join user_profiles profile on profile.auth_user_id = platform_user.auth_user_id
      left join lateral (
        select assignment.circle_id
        from circle_member_assignments assignment
        where assignment.member_id = member.id and assignment.ended_at is null
        order by assignment.assigned_at desc
        limit 1
      ) active_circle on true
      left join circles circle on circle.id = active_circle.circle_id
      left join block_circle_assignments block_assignment
        on block_assignment.circle_id = active_circle.circle_id
        and block_assignment.ended_at is null
      left join membership_blocks membership_block
        on membership_block.id = block_assignment.block_id
      where (
        ${role} = 'ops_admin'
        or exists (
          select 1
          from circle_staff_assignments staff_assignment
          join circle_member_assignments member_assignment
            on member_assignment.circle_id = staff_assignment.circle_id
            and member_assignment.member_id = member.id
            and member_assignment.ended_at is null
          where staff_assignment.auth_user_id = ${authUserId}::uuid
            and staff_assignment.ended_at is null
        )
      )
        and (
          ${query}::text = ''
          or strpos(lower(coalesce(profile.display_name, '')), lower(${query}::text)) > 0
          or (${role} = 'ops_admin' and strpos(lower(member.email), lower(${query}::text)) > 0)
          or strpos(lower(coalesce(circle.name, '')), lower(${query}::text)) > 0
          or strpos(lower(coalesce(membership_block.name, '')), lower(${query}::text)) > 0
        )
        and (
          ${filter}::text = 'all'
          or (
            ${filter}::text = 'attention'
            and (
              lifecycle.billing_state = 'attention_required'
              or lifecycle.account_state = 'suspended'
              or lifecycle.standing_state in ('paused', 'cancellation_requested')
            )
          )
          or (${filter}::text = 'foundations' and lifecycle.foundations_state <> 'completed')
          or (
            ${filter}::text = 'unassigned'
            and lifecycle.account_state = 'active'
            and lifecycle.billing_state = 'active'
            and lifecycle.standing_state = 'active'
            and lifecycle.program_state in ('onboarding', 'active')
            and (active_circle.circle_id is null or circle.status <> 'active')
          )
        )
    `;
    const totalResults = Number(countRows[0]?.total_results ?? 0);
    const pageCount = Math.max(1, Math.ceil(totalResults / OPERATOR_MEMBER_DIRECTORY_PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);
    const offset = (page - 1) * OPERATOR_MEMBER_DIRECTORY_PAGE_SIZE;

    const rows = await tx<Array<OperatorMemberRow>>`
      select
        member.id as member_id,
        member.email,
        profile.display_name,
        lifecycle.account_state,
        lifecycle.billing_state,
        lifecycle.program_state,
        lifecycle.foundations_state,
        lifecycle.artifact_state,
        membership_block.name as block_name,
        membership_block.status as block_status,
        circle.name as circle_name,
        circle.status as circle_status,
        enrollment.progress_percent as foundations_progress
      from ruined_members member
      join member_lifecycle lifecycle on lifecycle.member_id = member.id
      left join platform_users platform_user on platform_user.member_id = member.id
      left join user_profiles profile on profile.auth_user_id = platform_user.auth_user_id
      left join lateral (
        select assignment.circle_id
        from circle_member_assignments assignment
        where assignment.member_id = member.id and assignment.ended_at is null
        order by assignment.assigned_at desc
        limit 1
      ) active_circle on true
      left join circles circle on circle.id = active_circle.circle_id
      left join block_circle_assignments block_assignment
        on block_assignment.circle_id = active_circle.circle_id
        and block_assignment.ended_at is null
      left join membership_blocks membership_block
        on membership_block.id = block_assignment.block_id
      left join lateral (
        select foundation_enrollment.progress_percent
        from foundation_enrollments foundation_enrollment
        join foundation_versions foundation_version
          on foundation_version.id = foundation_enrollment.foundation_version_id
        join foundation_programs foundation_program
          on foundation_program.id = foundation_version.foundation_program_id
        where foundation_enrollment.member_id = member.id
          and foundation_program.slug = 'ruined-foundations'
        order by foundation_enrollment.created_at desc
        limit 1
      ) enrollment on true
      where (
        ${role} = 'ops_admin'
        or exists (
          select 1
          from circle_staff_assignments staff_assignment
          join circle_member_assignments member_assignment
            on member_assignment.circle_id = staff_assignment.circle_id
            and member_assignment.member_id = member.id
            and member_assignment.ended_at is null
          where staff_assignment.auth_user_id = ${authUserId}::uuid
            and staff_assignment.ended_at is null
        )
      )
        and (
          ${query}::text = ''
          or strpos(lower(coalesce(profile.display_name, '')), lower(${query}::text)) > 0
          or (${role} = 'ops_admin' and strpos(lower(member.email), lower(${query}::text)) > 0)
          or strpos(lower(coalesce(circle.name, '')), lower(${query}::text)) > 0
          or strpos(lower(coalesce(membership_block.name, '')), lower(${query}::text)) > 0
        )
        and (
          ${filter}::text = 'all'
          or (
            ${filter}::text = 'attention'
            and (
              lifecycle.billing_state = 'attention_required'
              or lifecycle.account_state = 'suspended'
              or lifecycle.standing_state in ('paused', 'cancellation_requested')
            )
          )
          or (${filter}::text = 'foundations' and lifecycle.foundations_state <> 'completed')
          or (
            ${filter}::text = 'unassigned'
            and lifecycle.account_state = 'active'
            and lifecycle.billing_state = 'active'
            and lifecycle.standing_state = 'active'
            and lifecycle.program_state in ('onboarding', 'active')
            and (active_circle.circle_id is null or circle.status <> 'active')
          )
        )
      order by
        case lifecycle.billing_state when 'attention_required' then 0 else 1 end,
        member.created_at asc,
        member.id asc
      limit ${OPERATOR_MEMBER_DIRECTORY_PAGE_SIZE}
      offset ${offset}
    `;

    return {
      filter,
      members: rows.map((row) => operatorMemberSummary(row, role === "ops_admin")),
      page,
      pageCount,
      pageSize: OPERATOR_MEMBER_DIRECTORY_PAGE_SIZE,
      query,
      totalResults,
    };
  });
}

export async function getOperatorDashboard(
  authUserId: string,
): Promise<{ dashboard: OperatorDashboardSnapshot; role: OperatorRole } | null> {
  const sql = getBillingDatabase();
  return sql.begin("isolation level repeatable read read only", async (tx) => {
  const roleRows = await tx<Array<{ role_slug: OperatorRole }>>`
    select grant_row.role_slug
    from platform_role_grants grant_row
    join platform_users platform_user
      on platform_user.auth_user_id = grant_row.auth_user_id
    where grant_row.auth_user_id = ${authUserId}::uuid
      and grant_row.role_slug in ('ops_admin', 'circle_leader', 'guide')
      and grant_row.revoked_at is null
      and platform_user.status = 'active'
    order by case grant_row.role_slug
      when 'ops_admin' then 1
      when 'circle_leader' then 2
      else 3
    end
    limit 1
  `;
  const role = roleRows[0]?.role_slug;
  if (!role) return null;

  const rows = await tx<Array<OperatorMemberRow>>`
    select
      member.id as member_id,
      member.email,
      profile.display_name,
      lifecycle.account_state,
      lifecycle.billing_state,
      lifecycle.program_state,
      lifecycle.foundations_state,
      lifecycle.artifact_state,
      membership_block.name as block_name,
      membership_block.status as block_status,
      circle.name as circle_name,
      circle.status as circle_status,
      enrollment.progress_percent as foundations_progress
    from ruined_members member
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
    left join platform_users platform_user on platform_user.member_id = member.id
    left join user_profiles profile on profile.auth_user_id = platform_user.auth_user_id
    left join lateral (
      select assignment.circle_id
      from circle_member_assignments assignment
      where assignment.member_id = member.id and assignment.ended_at is null
      order by assignment.assigned_at desc
      limit 1
    ) active_circle on true
    left join circles circle on circle.id = active_circle.circle_id
    left join block_circle_assignments block_assignment
      on block_assignment.circle_id = active_circle.circle_id
      and block_assignment.ended_at is null
    left join membership_blocks membership_block
      on membership_block.id = block_assignment.block_id
    left join lateral (
      select foundation_enrollment.progress_percent
      from foundation_enrollments foundation_enrollment
      join foundation_versions foundation_version
        on foundation_version.id = foundation_enrollment.foundation_version_id
      join foundation_programs foundation_program
        on foundation_program.id = foundation_version.foundation_program_id
      where foundation_enrollment.member_id = member.id
        and foundation_program.slug = 'ruined-foundations'
      order by foundation_enrollment.created_at desc
      limit 1
    ) enrollment on true
    where ${role} = 'ops_admin'
      or exists (
        select 1
        from circle_staff_assignments staff_assignment
        join circle_member_assignments member_assignment
          on member_assignment.circle_id = staff_assignment.circle_id
          and member_assignment.member_id = member.id
          and member_assignment.ended_at is null
        where staff_assignment.auth_user_id = ${authUserId}::uuid
          and staff_assignment.ended_at is null
      )
    order by
      case lifecycle.billing_state when 'attention_required' then 0 else 1 end,
      member.created_at asc
    limit 100
  `;

  const aggregateRows = await tx<
    Array<{
      active_members: number | string;
      attention_required: number | string;
      total_members: number | string;
      unassigned_members: number | string;
    }>
  >`
    with scoped_members as (
      select
        member.id,
        lifecycle.account_state,
        lifecycle.billing_state,
        lifecycle.program_state
      from ruined_members member
      join member_lifecycle lifecycle on lifecycle.member_id = member.id
      where ${role} = 'ops_admin'
        or exists (
          select 1
          from circle_staff_assignments staff_assignment
          join circle_member_assignments member_assignment
            on member_assignment.circle_id = staff_assignment.circle_id
            and member_assignment.member_id = member.id
            and member_assignment.ended_at is null
          where staff_assignment.auth_user_id = ${authUserId}::uuid
            and staff_assignment.ended_at is null
        )
    )
    select
      count(*) as total_members,
      count(*) filter (
        where scoped_member.billing_state = 'active'
          and scoped_member.account_state = 'active'
          and scoped_member.program_state in ('onboarding', 'active')
      ) as active_members,
      count(*) filter (
        where scoped_member.billing_state = 'attention_required'
      ) as attention_required,
      count(*) filter (
        where scoped_member.account_state = 'active'
          and scoped_member.billing_state = 'active'
          and scoped_member.program_state in ('onboarding', 'active')
          and not exists (
          select 1
          from circle_member_assignments assignment
          where assignment.member_id = scoped_member.id
            and assignment.ended_at is null
        )
      ) as unassigned_members
    from scoped_members scoped_member
  `;
  const aggregates = aggregateRows[0];

  const members = rows.map((row) => operatorMemberSummary(row, role === "ops_admin"));

  return {
    dashboard: {
      activeMembers: Number(aggregates?.active_members ?? 0),
      attentionRequired: Number(aggregates?.attention_required ?? 0),
      members,
      totalMembers: Number(aggregates?.total_members ?? 0),
      unassignedMembers: Number(aggregates?.unassigned_members ?? 0),
    },
    role,
  };
  });
}
