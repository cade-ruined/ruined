import "server-only";

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { getBillingDatabase } from "@/lib/stripe/database";
import { isPlausibleEmail, normalizeEmail } from "@/lib/stripe/membership-state";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EMAIL_LENGTH = 254;
const MAX_CIRCLE_NAME_LENGTH = 80;

export type OpsRepositoryErrorCode =
  | "conflict"
  | "forbidden"
  | "invalid_request"
  | "not_found";

export class OpsRepositoryError extends Error {
  constructor(
    readonly code: OpsRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OpsRepositoryError";
  }
}

export type OpsInvitationResult = {
  email: string;
  expiresAt: string;
  id: string;
  reissued: boolean;
};

export type OpsInvitationRevocationResult = {
  email: string;
  revoked: number;
};

export type OpsCircleSummary = {
  activeMembers: number;
  capacity: number;
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived" | "completed" | "forming";
};

export type OpsCircleAssignmentResult = {
  assignedAt: string;
  circleId: string;
  created: boolean;
  id: string;
  memberId: string;
};

export type OpsCircleAssignmentEndResult = {
  circleId: string;
  circleStatus: OpsCircleSummary["status"];
  endedAt: string;
  id: string;
  memberId: string;
};

export type OpsCircleActivationResult = OpsCircleSummary & {
  activated: boolean;
};

async function requireOpsAdmin(
  tx: postgres.TransactionSql,
  actorAuthUserId: string,
): Promise<void> {
  const authorizedRows = await tx<Array<{ auth_user_id: string }>>`
    select platform_user.auth_user_id
    from platform_users platform_user
    join platform_role_grants grant_row
      on grant_row.auth_user_id = platform_user.auth_user_id
    where platform_user.auth_user_id = ${actorAuthUserId}::uuid
      and platform_user.user_type = 'staff'
      and platform_user.status = 'active'
      and grant_row.role_slug = 'ops_admin'
      and grant_row.revoked_at is null
    limit 1
    for update of platform_user, grant_row
  `;

  if (!authorizedRows[0]) {
    throw new OpsRepositoryError("forbidden", "Operations administrator access is required.");
  }
}

function normalizedCircleName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function circleSlug(name: string): string {
  const stem = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${stem || "circle"}-${randomUUID().slice(0, 8)}`;
}

export async function createOrReissueMemberInvitation({
  actorAuthUserId,
  email: emailValue,
}: {
  actorAuthUserId: string;
  email: string;
}): Promise<OpsInvitationResult> {
  const email = normalizeEmail(emailValue);
  const sql = getBillingDatabase();
  return sql.begin(async (tx) => {
    await requireOpsAdmin(tx, actorAuthUserId);
    if (email.length > MAX_EMAIL_LENGTH || !isPlausibleEmail(email)) {
      throw new OpsRepositoryError("invalid_request", "Enter a valid email address.");
    }

    // Use the same email-scoped lock as passwordless identity claiming so an
    // invitation can never race the member record it authorizes.
    await tx`select pg_advisory_xact_lock(hashtext(${email}), 1)`;

    const identityRows = await tx<
      Array<{
        member_id: string | null;
        status: "active" | "disabled" | "invited" | "suspended";
        user_type: "member" | "staff";
      }>
    >`
      select member_id, status, user_type
      from platform_users
      where email_normalized = ${email}
      limit 1
      for update
    `;
    const identity = identityRows[0];
    if (identity?.user_type === "staff") {
      throw new OpsRepositoryError("conflict", "That email belongs to an operator account.");
    }
    if (identity?.status === "active") {
      throw new OpsRepositoryError("conflict", "That member already has active access.");
    }
    if (identity?.status === "suspended" || identity?.status === "disabled") {
      throw new OpsRepositoryError(
        "conflict",
        "That member needs account recovery, not a new invitation.",
      );
    }

    const memberRows = await tx<Array<{ id: string; membership_state: string }>>`
      select id, membership_state
      from ruined_members
      where email_normalized = ${email}
      limit 1
      for update
    `;
    let member = memberRows[0];

    if (!member) {
      const insertedRows = await tx<Array<{ id: string; membership_state: string }>>`
        insert into ruined_members (id, email, email_normalized)
        values (${randomUUID()}::uuid, ${emailValue.trim()}, ${email})
        returning id, membership_state
      `;
      member = insertedRows[0];
    }
    if (!member) throw new Error("The invited member record could not be created.");
    if (identity?.member_id && identity.member_id !== member.id) {
      throw new OpsRepositoryError(
        "conflict",
        "That invited identity is linked to a different member record.",
      );
    }

    await tx`
      insert into member_lifecycle (
        member_id,
        account_state,
        billing_state,
        program_state
      ) values (
        ${member.id}::uuid,
        'invited',
        ${member.membership_state},
        'prospect'
      )
      on conflict (member_id) do nothing
    `;

    const lifecycleRows = await tx<Array<{ account_state: string }>>`
      select account_state
      from member_lifecycle
      where member_id = ${member.id}::uuid
      for update
    `;
    const lifecycle = lifecycleRows[0];
    if (!lifecycle) throw new Error("The invited member lifecycle could not be created.");
    if (lifecycle.account_state === "suspended" || lifecycle.account_state === "closed") {
      throw new OpsRepositoryError("conflict", "That member account cannot be invited.");
    }

    const revokedRows = await tx<Array<{ id: string }>>`
      update passwordless_account_invites
      set
        revoked_at = statement_timestamp(),
        revoked_by_auth_user_id = ${actorAuthUserId}::uuid
      where email_normalized = ${email}
        and accepted_at is null
        and revoked_at is null
      returning id::text
    `;

    const invitationRows = await tx<
      Array<{
        email_normalized: string;
        expires_at: Date;
        id: string;
      }>
    >`
      insert into passwordless_account_invites (
        member_id,
        email_normalized,
        intended_user_type,
        invited_by_auth_user_id,
        invited_at,
        expires_at
      ) values (
        ${member.id}::uuid,
        ${email},
        'member',
        ${actorAuthUserId}::uuid,
        statement_timestamp(),
        statement_timestamp() + interval '7 days'
      )
      returning id::text, email_normalized, expires_at
    `;
    const invitation = invitationRows[0];
    if (!invitation) {
      throw new Error("The invitation audit record could not be created.");
    }

    return {
      email: invitation.email_normalized,
      expiresAt: invitation.expires_at.toISOString(),
      id: invitation.id,
      reissued: revokedRows.length > 0,
    };
  });
}

export async function revokeLiveMemberInvitations({
  actorAuthUserId,
  email: emailValue,
}: {
  actorAuthUserId: string;
  email: string;
}): Promise<OpsInvitationRevocationResult> {
  const email = normalizeEmail(emailValue);
  const sql = getBillingDatabase();
  return sql.begin(async (tx) => {
    await requireOpsAdmin(tx, actorAuthUserId);
    if (email.length > MAX_EMAIL_LENGTH || !isPlausibleEmail(email)) {
      throw new OpsRepositoryError("invalid_request", "Enter a valid email address.");
    }

    await tx`select pg_advisory_xact_lock(hashtext(${email}), 1)`;
    const revokedRows = await tx<Array<{ id: string }>>`
      update passwordless_account_invites
      set
        revoked_at = statement_timestamp(),
        revoked_by_auth_user_id = ${actorAuthUserId}::uuid
      where email_normalized = ${email}
        and intended_user_type = 'member'
        and accepted_at is null
        and revoked_at is null
        and (expires_at is null or expires_at > statement_timestamp())
      returning id::text
    `;
    if (revokedRows.length === 0) {
      throw new OpsRepositoryError("not_found", "No live invitation exists for that email.");
    }

    return { email, revoked: revokedRows.length };
  });
}

export async function createCircle({
  actorAuthUserId,
  name: nameValue,
}: {
  actorAuthUserId: string;
  name: string;
}): Promise<OpsCircleSummary> {
  const name = normalizedCircleName(nameValue);
  const sql = getBillingDatabase();
  return sql.begin(async (tx) => {
    await requireOpsAdmin(tx, actorAuthUserId);
    if (name.length < 2 || name.length > MAX_CIRCLE_NAME_LENGTH) {
      throw new OpsRepositoryError(
        "invalid_request",
        `Circle names must be between 2 and ${MAX_CIRCLE_NAME_LENGTH} characters.`,
      );
    }

    const circleRows = await tx<
      Array<{
        capacity: number;
        id: string;
        name: string;
        slug: string;
        status: OpsCircleSummary["status"];
      }>
    >`
      insert into circles (id, name, slug)
      values (${randomUUID()}::uuid, ${name}, ${circleSlug(name)})
      returning id, name, slug, capacity, status
    `;
    const circle = circleRows[0];
    if (!circle) throw new Error("The Circle could not be created.");

    return {
      activeMembers: 0,
      capacity: Number(circle.capacity),
      id: circle.id,
      name: circle.name,
      slug: circle.slug,
      status: circle.status,
    };
  });
}

export async function activateCircle({
  actorAuthUserId,
  circleId,
}: {
  actorAuthUserId: string;
  circleId: string;
}): Promise<OpsCircleActivationResult> {
  const sql = getBillingDatabase();
  return sql.begin(async (tx) => {
    await requireOpsAdmin(tx, actorAuthUserId);
    if (!UUID_PATTERN.test(circleId)) {
      throw new OpsRepositoryError("invalid_request", "Choose a valid Circle.");
    }

    const circleRows = await tx<
      Array<{
        capacity: number;
        id: string;
        name: string;
        slug: string;
        status: OpsCircleSummary["status"];
      }>
    >`
      select id, name, slug, capacity, status
      from circles
      where id = ${circleId}::uuid
      limit 1
      for update
    `;
    const circle = circleRows[0];
    if (!circle) {
      throw new OpsRepositoryError("not_found", "That Circle could not be found.");
    }

    const countRows = await tx<Array<{ active_members: number | string }>>`
      select count(*) as active_members
      from circle_member_assignments
      where circle_id = ${circleId}::uuid
        and ended_at is null
    `;
    const activeMembers = Number(countRows[0]?.active_members ?? 0);

    if (circle.status === "active") {
      return { ...circle, activated: false, activeMembers };
    }
    if (circle.status !== "forming") {
      throw new OpsRepositoryError(
        "conflict",
        "Only a forming Circle can be activated.",
      );
    }
    if (activeMembers < 1) {
      throw new OpsRepositoryError(
        "conflict",
        "Assign at least one eligible member before activating the Circle.",
      );
    }

    const activatedRows = await tx<Array<{ status: OpsCircleSummary["status"] }>>`
      update circles
      set
        status = 'active',
        starts_at = coalesce(starts_at, statement_timestamp()),
        activated_by_auth_user_id = ${actorAuthUserId}::uuid,
        updated_at = statement_timestamp()
      where id = ${circleId}::uuid
        and status = 'forming'
      returning status
    `;
    if (activatedRows[0]?.status !== "active") {
      throw new OpsRepositoryError("conflict", "That Circle could not be activated.");
    }

    return {
      ...circle,
      activated: true,
      activeMembers,
      status: "active",
    };
  });
}

export async function getOpsCircleSummaries(
  actorAuthUserId: string,
): Promise<OpsCircleSummary[]> {
  const sql = getBillingDatabase();
  return sql.begin(async (tx) => {
    await requireOpsAdmin(tx, actorAuthUserId);

    const rows = await tx<
      Array<{
        active_members: number | string;
        capacity: number;
        id: string;
        name: string;
        slug: string;
        status: OpsCircleSummary["status"];
      }>
    >`
      select
        circle.id,
        circle.name,
        circle.slug,
        circle.capacity,
        circle.status,
        count(assignment.id) filter (where assignment.ended_at is null) as active_members
      from circles circle
      left join circle_member_assignments assignment on assignment.circle_id = circle.id
      group by circle.id
      order by
        case circle.status
          when 'active' then 1
          when 'forming' then 2
          when 'completed' then 3
          else 4
        end,
        circle.created_at asc
    `;

    return rows.map((row) => ({
      activeMembers: Number(row.active_members),
      capacity: Number(row.capacity),
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
    }));
  });
}

export async function assignMemberToCircle({
  actorAuthUserId,
  circleId,
  memberId,
}: {
  actorAuthUserId: string;
  circleId: string;
  memberId: string;
}): Promise<OpsCircleAssignmentResult> {
  const sql = getBillingDatabase();
  return sql.begin(async (tx) => {
    await requireOpsAdmin(tx, actorAuthUserId);
    if (!UUID_PATTERN.test(memberId) || !UUID_PATTERN.test(circleId)) {
      throw new OpsRepositoryError("invalid_request", "Choose a valid member and Circle.");
    }

    // Member-scoped serialization makes the eligibility check and active
    // assignment decision atomic even when two operators act concurrently.
    await tx`select pg_advisory_xact_lock(hashtext(${memberId}), 2)`;

    const memberRows = await tx<
      Array<{
        account_state: string;
        billing_state: string;
        membership_state: string;
        program_state: string;
      }>
    >`
      select
        lifecycle.account_state,
        lifecycle.billing_state,
        lifecycle.program_state,
        member.membership_state
      from ruined_members member
      join member_lifecycle lifecycle on lifecycle.member_id = member.id
      where member.id = ${memberId}::uuid
      limit 1
      for update of member, lifecycle
    `;
    const member = memberRows[0];
    if (!member) {
      throw new OpsRepositoryError("not_found", "That member could not be found.");
    }

    const eligible =
      member.account_state === "active" &&
      member.billing_state === "active" &&
      member.membership_state === "active" &&
      (member.program_state === "onboarding" || member.program_state === "active");
    if (!eligible) {
      throw new OpsRepositoryError(
        "conflict",
        "Only active, paid members in onboarding or the active program can enter a Circle.",
      );
    }

    const existingRows = await tx<
      Array<{ assigned_at: Date; circle_id: string; id: string }>
    >`
      select id::text, circle_id, assigned_at
      from circle_member_assignments
      where member_id = ${memberId}::uuid
        and ended_at is null
      limit 1
      for update
    `;
    const existing = existingRows[0];
    if (existing?.circle_id === circleId) {
      return {
        assignedAt: existing.assigned_at.toISOString(),
        circleId: existing.circle_id,
        created: false,
        id: existing.id,
        memberId,
      };
    }
    if (existing) {
      throw new OpsRepositoryError("conflict", "That member already has an active Circle.");
    }

    const circleRows = await tx<
      Array<{ capacity: number; id: string; status: OpsCircleSummary["status"] }>
    >`
      select id, capacity, status
      from circles
      where id = ${circleId}::uuid
      limit 1
      for update
    `;
    const circle = circleRows[0];
    if (!circle) {
      throw new OpsRepositoryError("not_found", "That Circle could not be found.");
    }
    if (circle.status !== "forming" && circle.status !== "active") {
      throw new OpsRepositoryError("conflict", "That Circle is not accepting members.");
    }

    const countRows = await tx<Array<{ active_members: number | string }>>`
      select count(*) as active_members
      from circle_member_assignments
      where circle_id = ${circleId}::uuid
        and ended_at is null
    `;
    if (Number(countRows[0]?.active_members ?? 0) >= Number(circle.capacity)) {
      throw new OpsRepositoryError("conflict", "That Circle has reached capacity.");
    }

    const assignmentRows = await tx<
      Array<{ assigned_at: Date; circle_id: string; id: string; member_id: string }>
    >`
      insert into circle_member_assignments (
        circle_id,
        member_id,
        assigned_by_auth_user_id
      ) values (
        ${circleId}::uuid,
        ${memberId}::uuid,
        ${actorAuthUserId}::uuid
      )
      returning id::text, circle_id, member_id, assigned_at
    `;
    const assignment = assignmentRows[0];
    if (!assignment) throw new Error("The Circle assignment could not be created.");

    return {
      assignedAt: assignment.assigned_at.toISOString(),
      circleId: assignment.circle_id,
      created: true,
      id: assignment.id,
      memberId: assignment.member_id,
    };
  });
}

export async function endMemberCircleAssignment({
  actorAuthUserId,
  memberId,
}: {
  actorAuthUserId: string;
  memberId: string;
}): Promise<OpsCircleAssignmentEndResult> {
  const sql = getBillingDatabase();
  return sql.begin(async (tx) => {
    await requireOpsAdmin(tx, actorAuthUserId);
    if (!UUID_PATTERN.test(memberId)) {
      throw new OpsRepositoryError("invalid_request", "Choose a valid assigned member.");
    }

    await tx`select pg_advisory_xact_lock(hashtext(${memberId}), 2)`;
    const memberRows = await tx<Array<{ id: string }>>`
      select id
      from ruined_members
      where id = ${memberId}::uuid
      limit 1
      for update
    `;
    if (!memberRows[0]) {
      throw new OpsRepositoryError("not_found", "That member could not be found.");
    }

    const assignmentRows = await tx<
      Array<{ circle_id: string; id: string; member_id: string }>
    >`
      select id::text, circle_id, member_id
      from circle_member_assignments
      where member_id = ${memberId}::uuid
        and ended_at is null
      limit 1
      for update
    `;
    const assignment = assignmentRows[0];
    if (!assignment) {
      throw new OpsRepositoryError("not_found", "That member has no active Circle assignment.");
    }

    const circleRows = await tx<Array<{ status: OpsCircleSummary["status"] }>>`
      select status
      from circles
      where id = ${assignment.circle_id}::uuid
      limit 1
      for update
    `;
    const circle = circleRows[0];
    if (!circle) {
      throw new OpsRepositoryError("not_found", "That Circle could not be found.");
    }
    const activeCountRows = await tx<Array<{ active_members: number | string }>>`
      select count(*) as active_members
      from circle_member_assignments
      where circle_id = ${assignment.circle_id}::uuid
        and ended_at is null
    `;
    const activeMembers = Number(activeCountRows[0]?.active_members ?? 0);

    const endedRows = await tx<Array<{ ended_at: Date }>>`
      update circle_member_assignments
      set
        ended_at = statement_timestamp(),
        end_reason = 'ops_ended_assignment',
        ended_by_auth_user_id = ${actorAuthUserId}::uuid
      where id = ${assignment.id}::bigint
        and ended_at is null
      returning ended_at
    `;
    const ended = endedRows[0];
    if (!ended) {
      throw new OpsRepositoryError("conflict", "That Circle assignment is no longer active.");
    }

    const archiveCircle =
      circle.status === "active" && activeMembers === 1;
    if (archiveCircle) {
      await tx`
        update circles
        set
          status = 'archived',
          ends_at = statement_timestamp(),
          updated_at = statement_timestamp()
        where id = ${assignment.circle_id}::uuid
          and status = 'active'
      `;
    }

    return {
      circleId: assignment.circle_id,
      circleStatus: archiveCircle ? "archived" : circle.status,
      endedAt: ended.ended_at.toISOString(),
      id: assignment.id,
      memberId: assignment.member_id,
    };
  });
}
