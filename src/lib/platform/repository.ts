import "server-only";

import { randomUUID } from "node:crypto";

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
};

export type OperatorRole = "circle_leader" | "guide" | "ops_admin";

export async function ensurePlatformMemberForViewer(
  viewer: PlatformViewer,
): Promise<PlatformUserLink> {
  const sql = getBillingDatabase();
  const emailNormalized = normalizeEmail(viewer.email);

  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${emailNormalized}), 1)`;

    const existingLinks = await tx<
      Array<{
        member_id: string | null;
        status: "active" | "disabled" | "invited" | "suspended";
      }>
    >`
      select member_id, status
      from platform_users
      where auth_user_id = ${viewer.authUserId}::uuid
      limit 1
      for update
    `;
    const existingLink = existingLinks[0];

    if (existingLink?.status === "suspended" || existingLink?.status === "disabled") {
      throw new Error("This platform account is not active.");
    }

    const memberRows = existingLink?.member_id
      ? await tx<Array<{ id: string; membership_state: BillingState }>>`
          select id, membership_state
          from ruined_members
          where id = ${existingLink.member_id}::uuid
          limit 1
          for update
        `
      : await tx<Array<{ id: string; membership_state: BillingState }>>`
          select id, membership_state
          from ruined_members
          where email_normalized = ${emailNormalized}
          limit 1
          for update
        `;
    let member = memberRows[0];

    if (!member) {
      const inserted = await tx<Array<{ id: string; membership_state: BillingState }>>`
        insert into ruined_members (id, email, email_normalized)
        values (${randomUUID()}::uuid, ${viewer.email}, ${emailNormalized})
        returning id, membership_state
      `;
      member = inserted[0];
    }

    if (!member) throw new Error("A platform member record could not be created.");

    if (!existingLink?.member_id) {
      const conflictingLinks = await tx<Array<{ auth_user_id: string }>>`
        select auth_user_id
        from platform_users
        where member_id = ${member.id}::uuid
          and auth_user_id <> ${viewer.authUserId}::uuid
        limit 1
        for update
      `;
      if (conflictingLinks.length > 0) {
        throw new Error("This member is already linked to another verified identity.");
      }
    }

    await tx`
      insert into platform_users (
        auth_user_id,
        member_id,
        email_normalized,
        user_type,
        status,
        activated_at,
        last_signed_in_at
      ) values (
        ${viewer.authUserId}::uuid,
        ${member.id}::uuid,
        ${emailNormalized},
        'member',
        'active',
        now(),
        now()
      )
      on conflict (auth_user_id) do update
      set
        member_id = excluded.member_id,
        email_normalized = excluded.email_normalized,
        status = case
          when platform_users.status = 'invited' then 'active'
          else platform_users.status
        end,
        activated_at = case
          when platform_users.status = 'invited' then coalesce(platform_users.activated_at, now())
          else platform_users.activated_at
        end,
        last_signed_in_at = now(),
        updated_at = now()
    `;

    const lifecycleRows = await tx<
      Array<{ account_state: AccountState; program_state: ProgramState }>
    >`
      select account_state, program_state
      from member_lifecycle
      where member_id = ${member.id}::uuid
      for update
    `;
    const existingLifecycle = lifecycleRows[0];
    const nextAccountState: AccountState =
      !existingLifecycle ||
      existingLifecycle.account_state === "provisional" ||
      existingLifecycle.account_state === "invited"
        ? "active"
        : existingLifecycle.account_state;
    const nextProgramState: ProgramState =
      existingLifecycle?.program_state ?? "prospect";
    const accountChanged =
      !existingLifecycle || existingLifecycle.account_state !== nextAccountState;
    const programChanged =
      !existingLifecycle || existingLifecycle.program_state !== nextProgramState;

    if (!existingLifecycle) {
      await tx`
        insert into member_lifecycle (member_id, account_state, billing_state, program_state)
        values (
          ${member.id}::uuid,
          ${nextAccountState},
          ${member.membership_state},
          ${nextProgramState}
        )
      `;
    } else if (accountChanged || programChanged) {
      await tx`
        update member_lifecycle
        set
          account_state = ${nextAccountState},
          program_state = ${nextProgramState},
          version = version + 1,
          updated_at = now()
        where member_id = ${member.id}::uuid
      `;
    }

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
          ${nextAccountState},
          'verified_passwordless_access',
          'system',
          ${viewer.authUserId}::uuid,
          ${`platform-account-activated:${viewer.authUserId}`}
        )
        on conflict (dedupe_key) do nothing
      `;
    }

    await tx`
      insert into platform_role_grants (auth_user_id, role_slug, granted_at)
      select ${viewer.authUserId}::uuid, 'member', now()
      where not exists (
        select 1
        from platform_role_grants
        where auth_user_id = ${viewer.authUserId}::uuid
          and role_slug = 'member'
      )
    `;

    return { authUserId: viewer.authUserId, memberId: member.id };
  });
}

type MemberSnapshotRow = {
  account_state: AccountState;
  artifact_state: ArtifactState;
  billing_state: BillingState;
  circle_name: string | null;
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
      circle.name as circle_name,
      enrollment.progress_percent as foundations_progress
    from platform_users platform_user
    join ruined_members member on member.id = platform_user.member_id
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
    left join lateral (
      select foundation_enrollment.progress_percent
      from foundation_enrollments foundation_enrollment
      where foundation_enrollment.member_id = member.id
      order by foundation_enrollment.created_at desc
      limit 1
    ) enrollment on true
    where platform_user.auth_user_id = ${authUserId}::uuid
      and platform_user.status = 'active'
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  const foundationsProgress = Math.min(100, Math.max(0, Number(row.foundations_progress ?? 0)));
  return {
    accountState: row.account_state,
    artifactState: row.artifact_state,
    billingState: row.billing_state,
    circleName: row.circle_name,
    email: row.email,
    foundationsProgress,
    foundationsState: row.foundations_state,
    memberId: row.member_id,
    name: row.display_name?.trim() || "Member",
    nextAction: nextMemberAction({
      artifactState: row.artifact_state,
      billingState: row.billing_state,
      foundationsState: row.foundations_state,
      hasCircle: Boolean(row.circle_name),
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
      and platform_user.user_type = 'staff'
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
  artifact_state: ArtifactState;
  billing_state: BillingState;
  circle_name: string | null;
  display_name: string | null;
  email: string;
  foundations_progress: number | null;
  foundations_state: FoundationsState;
  member_id: string;
  program_state: ProgramState;
};

export async function getOperatorDashboard(
  authUserId: string,
  role: OperatorRole,
): Promise<OperatorDashboardSnapshot> {
  const sql = getBillingDatabase();
  const rows = await sql<Array<OperatorMemberRow>>`
    select
      member.id as member_id,
      member.email,
      profile.display_name,
      lifecycle.billing_state,
      lifecycle.program_state,
      lifecycle.foundations_state,
      lifecycle.artifact_state,
      circle.name as circle_name,
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
    left join lateral (
      select foundation_enrollment.progress_percent
      from foundation_enrollments foundation_enrollment
      where foundation_enrollment.member_id = member.id
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

  const members: OperatorMemberSummary[] = rows.map((row) => {
    const foundationsProgress = Math.min(100, Math.max(0, Number(row.foundations_progress ?? 0)));
    return {
      artifactState: row.artifact_state,
      billingState: row.billing_state,
      circleName: row.circle_name,
      foundationsProgress,
      memberId: row.member_id,
      name: row.display_name?.trim() || row.email.split("@")[0] || "Member",
      nextAction: nextMemberAction({
        artifactState: row.artifact_state,
        billingState: row.billing_state,
        foundationsState: row.foundations_state,
        hasCircle: Boolean(row.circle_name),
      }),
      programState: row.program_state,
    };
  });

  return {
    activeMembers: members.filter(
      (member) =>
        member.billingState === "active" &&
        (member.programState === "onboarding" || member.programState === "active"),
    ).length,
    attentionRequired: members.filter((member) => member.billingState === "attention_required").length,
    members,
    unassignedMembers: members.filter((member) => !member.circleName).length,
  };
}
