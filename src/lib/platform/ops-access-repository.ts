import "server-only";

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import {
  ensurePersonForEmail,
  markPersonEmailVerified,
  PersonIdentityConflictError,
} from "@/lib/identity/repository";
import { PlatformAccessDeniedError } from "@/lib/platform/repository";
import { getBillingDatabase } from "@/lib/stripe/database";
import { isPlausibleEmail, normalizeEmail } from "@/lib/stripe/membership-state";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EMAIL_LENGTH = 254;
const MAX_DISPLAY_NAME_LENGTH = 120;

export type OperatorAccessRole = "circle_leader" | "guide" | "ops_admin";
export type OperatorAccessStatus = "active" | "expired" | "invited" | "suspended";

export type OperatorAccessCircle = {
  id: string;
  name: string;
};

export type OperatorAccessEntry = {
  authUserId: string | null;
  circles: OperatorAccessCircle[];
  displayName: string;
  email: string;
  id: string;
  invitedAt: string | null;
  lastSignedInAt: string | null;
  role: OperatorAccessRole;
  status: OperatorAccessStatus;
};

export type OperatorInvitationResult = {
  entry: OperatorAccessEntry;
  expiresAt: string;
  reissued: boolean;
};

export class OpsAccessRepositoryError extends Error {
  constructor(
    readonly code: "conflict" | "forbidden" | "invalid_request" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "OpsAccessRepositoryError";
  }
}

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function parseTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function requireOpsAdmin(
  tx: postgres.TransactionSql,
  actorAuthUserId: string,
): Promise<void> {
  const rows = await tx<Array<{ authorized: boolean }>>`
    select exists (
      select 1
      from platform_users platform_user
      join platform_role_grants role_grant
        on role_grant.auth_user_id = platform_user.auth_user_id
       and role_grant.role_slug = 'ops_admin'
       and role_grant.revoked_at is null
      where platform_user.auth_user_id = ${actorAuthUserId}::uuid
        and platform_user.status = 'active'
    ) as authorized
  `;

  if (!rows[0]?.authorized) {
    throw new OpsAccessRepositoryError("forbidden", "Administrator access is required.");
  }
}

async function writeAudit(
  tx: postgres.TransactionSql,
  input: {
    action: string;
    actorAuthUserId: string;
    after?: postgres.JSONValue;
    before?: postgres.JSONValue;
    reason?: string;
    subjectId: string;
    subjectType: string;
  },
): Promise<void> {
  const before = input.before === undefined ? null : tx.json(input.before);
  const after = input.after === undefined ? null : tx.json(input.after);
  await tx`
    insert into operator_audit_events (
      actor_auth_user_id,
      action,
      subject_type,
      subject_id,
      reason,
      before_snapshot,
      after_snapshot,
      metadata,
      dedupe_key
    ) values (
      ${input.actorAuthUserId}::uuid,
      ${input.action},
      ${input.subjectType},
      ${input.subjectId},
      ${input.reason ?? null},
      ${before},
      ${after},
      '{}'::jsonb,
      ${randomUUID()}
    )
  `;
}

export async function getOperatorAccessDirectory(
  actorAuthUserId: string,
): Promise<OperatorAccessEntry[]> {
  const sql = getBillingDatabase();
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    await requireOpsAdmin(tx, actorAuthUserId);

    const activeRows = await tx<
      Array<{
        auth_user_id: string;
        circle_ids: unknown;
        circle_names: unknown;
        display_name: string | null;
        email_normalized: string;
        last_signed_in_at: Date | string | null;
        role_slug: OperatorAccessRole;
        status: "active" | "disabled" | "invited" | "suspended";
      }>
    >`
      select
        platform_user.auth_user_id,
        platform_user.email_normalized,
        platform_user.status,
        platform_user.last_signed_in_at,
        coalesce(
          person_profile.preferred_name,
          person_profile.display_name,
          legacy_profile.display_name
        ) as display_name,
        active_role.role_slug,
        coalesce(scope.circle_ids, array[]::text[]) as circle_ids,
        coalesce(scope.circle_names, array[]::text[]) as circle_names
      from platform_users platform_user
      join lateral (
        select role_grant.role_slug::text as role_slug
        from platform_role_grants role_grant
        where role_grant.auth_user_id = platform_user.auth_user_id
          and role_grant.role_slug in ('ops_admin', 'circle_leader', 'guide')
          and role_grant.revoked_at is null
        order by case role_grant.role_slug
          when 'ops_admin' then 1
          when 'circle_leader' then 2
          else 3
        end
        limit 1
      ) active_role on true
      left join person_profiles person_profile
        on person_profile.person_id = platform_user.person_id
      left join user_profiles legacy_profile
        on legacy_profile.auth_user_id = platform_user.auth_user_id
      left join lateral (
        select
          array_agg(circle_record.id::text order by circle_record.name) as circle_ids,
          array_agg(circle_record.name order by circle_record.name) as circle_names
        from circle_staff_assignments assignment
        join circles circle_record on circle_record.id = assignment.circle_id
        where assignment.auth_user_id = platform_user.auth_user_id
          and assignment.role_slug = active_role.role_slug
          and assignment.ended_at is null
      ) scope on true
      order by
        case platform_user.status when 'active' then 1 else 2 end,
        coalesce(person_profile.preferred_name, person_profile.display_name, legacy_profile.display_name),
        platform_user.email_normalized
    `;

    const pendingRows = await tx<
      Array<{
        circle_ids: unknown;
        circle_names: unknown;
        display_name: string;
        email_normalized: string;
        expires_at: Date | string | null;
        id: string;
        invited_at: Date | string;
        role_slug: OperatorAccessRole;
      }>
    >`
      select distinct on (invitation.email_normalized)
        invitation.id::text,
        invitation.email_normalized,
        invitation.invited_at,
        invitation.expires_at,
        config.display_name,
        config.role_slug,
        coalesce(scope.circle_ids, array[]::text[]) as circle_ids,
        coalesce(scope.circle_names, array[]::text[]) as circle_names
      from passwordless_account_invites invitation
      join operator_invitation_configs config on config.invitation_id = invitation.id
      left join lateral (
        select
          array_agg(circle_record.id::text order by circle_record.name) as circle_ids,
          array_agg(circle_record.name order by circle_record.name) as circle_names
        from operator_invitation_circles invitation_circle
        join circles circle_record on circle_record.id = invitation_circle.circle_id
        where invitation_circle.invitation_id = invitation.id
      ) scope on true
      where invitation.intended_user_type = 'staff'
        and invitation.accepted_at is null
        and invitation.revoked_at is null
        and not exists (
          select 1
          from platform_users platform_user
          join platform_role_grants role_grant
            on role_grant.auth_user_id = platform_user.auth_user_id
           and role_grant.role_slug in ('ops_admin', 'circle_leader', 'guide')
           and role_grant.revoked_at is null
          where platform_user.email_normalized = invitation.email_normalized
        )
      order by invitation.email_normalized, invitation.invited_at desc, invitation.id desc
    `;

    const active = activeRows.map((row): OperatorAccessEntry => {
      const ids = parseTextArray(row.circle_ids);
      const names = parseTextArray(row.circle_names);
      return {
        authUserId: row.auth_user_id,
        circles: ids.map((id, index) => ({ id, name: names[index] ?? "Circle" })),
        displayName: row.display_name?.trim() || row.email_normalized.split("@")[0],
        email: row.email_normalized,
        id: `operator:${row.auth_user_id}`,
        invitedAt: null,
        lastSignedInAt: asIso(row.last_signed_in_at),
        role: row.role_slug,
        status: row.status === "active" ? "active" : "suspended",
      };
    });

    const pending = pendingRows.map((row): OperatorAccessEntry => {
      const ids = parseTextArray(row.circle_ids);
      const names = parseTextArray(row.circle_names);
      const expiresAt = asIso(row.expires_at);
      return {
        authUserId: null,
        circles: ids.map((id, index) => ({ id, name: names[index] ?? "Circle" })),
        displayName: row.display_name,
        email: row.email_normalized,
        id: `invitation:${row.id}`,
        invitedAt: asIso(row.invited_at),
        lastSignedInAt: null,
        role: row.role_slug,
        status: expiresAt && new Date(expiresAt).getTime() <= Date.now() ? "expired" : "invited",
      };
    });

    return [...active, ...pending];
  });
}

export async function createOrReissueOperatorInvitation(input: {
  actorAuthUserId: string;
  circleIds: string[];
  displayName: string;
  email: string;
  role: OperatorAccessRole;
}): Promise<OperatorInvitationResult> {
  const email = normalizeEmail(input.email);
  const displayName = normalizeDisplayName(input.displayName);
  const circleIds = [...new Set(input.circleIds.map((value) => value.trim()).filter(Boolean))];
  const sql = getBillingDatabase();

  return sql.begin(async (tx) => {
    await requireOpsAdmin(tx, input.actorAuthUserId);
    if (email.length > MAX_EMAIL_LENGTH || !isPlausibleEmail(email)) {
      throw new OpsAccessRepositoryError("invalid_request", "Enter a valid email address.");
    }
    if (!displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new OpsAccessRepositoryError(
        "invalid_request",
        `Enter a name between 1 and ${MAX_DISPLAY_NAME_LENGTH} characters.`,
      );
    }
    if (!new Set<OperatorAccessRole>(["ops_admin", "circle_leader", "guide"]).has(input.role)) {
      throw new OpsAccessRepositoryError("invalid_request", "Choose an operator responsibility.");
    }
    if (input.role === "ops_admin" && circleIds.length > 0) {
      throw new OpsAccessRepositoryError(
        "invalid_request",
        "Administrators already have access to every Circle.",
      );
    }
    if (input.role !== "ops_admin" && circleIds.length === 0) {
      throw new OpsAccessRepositoryError("invalid_request", "Choose at least one Circle.");
    }
    if (circleIds.some((circleId) => !UUID_PATTERN.test(circleId))) {
      throw new OpsAccessRepositoryError("invalid_request", "Choose valid Circles.");
    }

    await tx`select pg_advisory_xact_lock(hashtext(${email}), 2)`;

    const identityRows = await tx<
      Array<{ auth_user_id: string; status: "active" | "disabled" | "invited" | "suspended" }>
    >`
      select auth_user_id, status
      from platform_users
      where email_normalized = ${email}
      limit 1
      for update
    `;
    const identity = identityRows[0];
    if (identity?.status === "suspended" || identity?.status === "disabled") {
      throw new OpsAccessRepositoryError(
        "conflict",
        "That account is suspended. Restore it before changing operator access.",
      );
    }
    if (identity) {
      const roleRows = await tx<Array<{ role_slug: string }>>`
        select role_slug
        from platform_role_grants
        where auth_user_id = ${identity.auth_user_id}::uuid
          and role_slug in ('ops_admin', 'circle_leader', 'guide')
          and revoked_at is null
        limit 1
      `;
      if (roleRows[0]) {
        throw new OpsAccessRepositoryError("conflict", "That person already has operator access.");
      }
    }

    let selectedCircles: OperatorAccessCircle[] = [];
    if (circleIds.length > 0) {
      const circleRows = await tx<Array<{ id: string; name: string }>>`
        select id, name
        from circles
        where id = any(${circleIds}::uuid[])
          and status in ('forming', 'active')
        order by name
        for update
      `;
      if (circleRows.length !== circleIds.length) {
        throw new OpsAccessRepositoryError(
          "conflict",
          "One of those Circles is no longer available. Refresh and choose again.",
        );
      }
      selectedCircles = circleRows;
    }

    const revokedRows = await tx<Array<{ id: string }>>`
      update passwordless_account_invites
      set
        revoked_at = statement_timestamp(),
        revoked_by_auth_user_id = ${input.actorAuthUserId}::uuid
      where email_normalized = ${email}
        and intended_user_type = 'staff'
        and accepted_at is null
        and revoked_at is null
      returning id::text
    `;

    if (input.role === "circle_leader") {
      const conflicts = await tx<Array<{ circle_name: string }>>`
        select circle_record.name as circle_name
        from circles circle_record
        where circle_record.id = any(${circleIds}::uuid[])
          and (
            exists (
              select 1
              from circle_staff_assignments assignment
              where assignment.circle_id = circle_record.id
                and assignment.role_slug = 'circle_leader'
                and assignment.ended_at is null
            )
            or exists (
              select 1
              from operator_invitation_circles invitation_circle
              join operator_invitation_configs config
                on config.invitation_id = invitation_circle.invitation_id
               and config.role_slug = 'circle_leader'
              join passwordless_account_invites invitation
                on invitation.id = config.invitation_id
              where invitation_circle.circle_id = circle_record.id
                and invitation.accepted_at is null
                and invitation.revoked_at is null
                and (invitation.expires_at is null or invitation.expires_at > statement_timestamp())
            )
          )
        order by circle_record.name
        limit 1
      `;
      if (conflicts[0]) {
        throw new OpsAccessRepositoryError(
          "conflict",
          `${conflicts[0].circle_name} already has a Shaper or a pending Shaper invitation.`,
        );
      }
    }

    const invitationRows = await tx<
      Array<{ expires_at: Date; id: string; invited_at: Date }>
    >`
      insert into passwordless_account_invites (
        member_id,
        email_normalized,
        intended_user_type,
        invited_by_auth_user_id,
        invited_at,
        expires_at
      ) values (
        null,
        ${email},
        'staff',
        ${input.actorAuthUserId}::uuid,
        statement_timestamp(),
        statement_timestamp() + interval '7 days'
      )
      returning id::text, invited_at, expires_at
    `;
    const invitation = invitationRows[0];
    if (!invitation) throw new Error("The operator invitation could not be recorded.");

    await tx`
      insert into operator_invitation_configs (
        invitation_id,
        role_slug,
        display_name
      ) values (
        ${invitation.id}::bigint,
        ${input.role},
        ${displayName}
      )
    `;

    if (selectedCircles.length > 0) {
      await tx`
        insert into operator_invitation_circles (invitation_id, circle_id)
        select ${invitation.id}::bigint, selected_circle.id
        from unnest(${selectedCircles.map((circle) => circle.id)}::uuid[]) as selected_circle(id)
      `;
    }

    await writeAudit(tx, {
      action: revokedRows.length > 0 ? "operator_invitation.reissued" : "operator_invitation.created",
      actorAuthUserId: input.actorAuthUserId,
      after: {
        circleIds: selectedCircles.map((circle) => circle.id),
        displayName,
        email,
        role: input.role,
      },
      subjectId: invitation.id,
      subjectType: "operator_invitation",
    });

    return {
      entry: {
        authUserId: null,
        circles: selectedCircles,
        displayName,
        email,
        id: `invitation:${invitation.id}`,
        invitedAt: invitation.invited_at.toISOString(),
        lastSignedInAt: null,
        role: input.role,
        status: "invited",
      },
      expiresAt: invitation.expires_at.toISOString(),
      reissued: revokedRows.length > 0,
    };
  });
}

export async function revokeOperatorInvitation(input: {
  actorAuthUserId: string;
  email: string;
}): Promise<{ email: string; revoked: number }> {
  const email = normalizeEmail(input.email);
  const sql = getBillingDatabase();
  return sql.begin(async (tx) => {
    await requireOpsAdmin(tx, input.actorAuthUserId);
    if (email.length > MAX_EMAIL_LENGTH || !isPlausibleEmail(email)) {
      throw new OpsAccessRepositoryError("invalid_request", "Enter a valid email address.");
    }
    await tx`select pg_advisory_xact_lock(hashtext(${email}), 2)`;
    const revoked = await tx<Array<{ id: string }>>`
      update passwordless_account_invites
      set
        revoked_at = statement_timestamp(),
        revoked_by_auth_user_id = ${input.actorAuthUserId}::uuid
      where email_normalized = ${email}
        and intended_user_type = 'staff'
        and accepted_at is null
        and revoked_at is null
      returning id::text
    `;
    if (revoked.length === 0) {
      throw new OpsAccessRepositoryError("not_found", "No pending invitation exists for that email.");
    }
    await writeAudit(tx, {
      action: "operator_invitation.revoked",
      actorAuthUserId: input.actorAuthUserId,
      after: { email, invitationIds: revoked.map((row) => row.id) },
      subjectId: revoked[0].id,
      subjectType: "operator_invitation",
    });
    return { email, revoked: revoked.length };
  });
}

export async function removeOperatorAccess(input: {
  actorAuthUserId: string;
  targetAuthUserId: string;
}): Promise<{ authUserId: string; removedRoles: number }> {
  if (!UUID_PATTERN.test(input.targetAuthUserId)) {
    throw new OpsAccessRepositoryError("invalid_request", "Choose a valid operator.");
  }
  if (input.actorAuthUserId === input.targetAuthUserId) {
    throw new OpsAccessRepositoryError(
      "conflict",
      "Ask another administrator to remove your access.",
    );
  }

  const sql = getBillingDatabase();
  return sql.begin(async (tx) => {
    await requireOpsAdmin(tx, input.actorAuthUserId);
    await tx`select pg_advisory_xact_lock(hashtext('ruined-operator-admins'), 1)`;

    const roles = await tx<Array<{ role_slug: OperatorAccessRole }>>`
      select role_slug
      from platform_role_grants
      where auth_user_id = ${input.targetAuthUserId}::uuid
        and role_slug in ('ops_admin', 'circle_leader', 'guide')
        and revoked_at is null
      order by role_slug
      for update
    `;
    if (roles.length === 0) {
      throw new OpsAccessRepositoryError("not_found", "That person has no active operator access.");
    }

    if (roles.some((role) => role.role_slug === "ops_admin")) {
      const adminRows = await tx<Array<{ active_admins: number }>>`
        select count(distinct role_grant.auth_user_id)::integer as active_admins
        from platform_role_grants role_grant
        join platform_users platform_user
          on platform_user.auth_user_id = role_grant.auth_user_id
        where role_grant.role_slug = 'ops_admin'
          and role_grant.revoked_at is null
          and platform_user.status = 'active'
      `;
      if ((adminRows[0]?.active_admins ?? 0) <= 1) {
        throw new OpsAccessRepositoryError(
          "conflict",
          "Ruined must keep at least one active administrator.",
        );
      }
    }

    await tx`
      update circle_staff_assignments
      set
        ended_at = statement_timestamp(),
        ended_by_auth_user_id = ${input.actorAuthUserId}::uuid,
        end_reason = 'Operator access removed'
      where auth_user_id = ${input.targetAuthUserId}::uuid
        and ended_at is null
    `;

    const revokedRoles = await tx<Array<{ role_slug: string }>>`
      update platform_role_grants
      set
        revoked_at = statement_timestamp(),
        revoke_reason = 'Operator access removed'
      where auth_user_id = ${input.targetAuthUserId}::uuid
        and role_slug in ('ops_admin', 'circle_leader', 'guide')
        and revoked_at is null
      returning role_slug
    `;

    await writeAudit(tx, {
      action: "operator_access.removed",
      actorAuthUserId: input.actorAuthUserId,
      after: { revokedRoles: revokedRoles.map((row) => row.role_slug) },
      before: { roles: roles.map((row) => row.role_slug) },
      reason: "Operator access removed",
      subjectId: input.targetAuthUserId,
      subjectType: "platform_user",
    });

    return { authUserId: input.targetAuthUserId, removedRoles: revokedRoles.length };
  });
}

export async function claimPlatformOperatorForViewer(input: {
  authUserId: string;
  email: string;
}): Promise<{ authUserId: string; role: OperatorAccessRole }> {
  const email = normalizeEmail(input.email);
  const sql = getBillingDatabase();

  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${email}), 2)`;

    const existingRows = await tx<
      Array<{
        auth_user_id: string;
        email_normalized: string;
        person_id: string | null;
        status: "active" | "disabled" | "invited" | "suspended";
      }>
    >`
      select auth_user_id, email_normalized, person_id, status
      from platform_users
      where auth_user_id = ${input.authUserId}::uuid
      limit 1
      for update
    `;
    const existing = existingRows[0];
    if (existing && (existing.email_normalized !== email || existing.status === "disabled" || existing.status === "suspended")) {
      throw new PlatformAccessDeniedError();
    }

    if (existing?.status === "active") {
      const currentRoleRows = await tx<Array<{ role_slug: OperatorAccessRole }>>`
        select role_slug
        from platform_role_grants
        where auth_user_id = ${input.authUserId}::uuid
          and role_slug in ('ops_admin', 'circle_leader', 'guide')
          and revoked_at is null
        order by case role_slug when 'ops_admin' then 1 when 'circle_leader' then 2 else 3 end
        limit 1
      `;
      if (currentRoleRows[0]) {
        await tx`
          update platform_users
          set last_signed_in_at = statement_timestamp(), updated_at = statement_timestamp()
          where auth_user_id = ${input.authUserId}::uuid
        `;
        return { authUserId: input.authUserId, role: currentRoleRows[0].role_slug };
      }
    }

    const conflicts = await tx<Array<{ auth_user_id: string }>>`
      select auth_user_id
      from platform_users
      where email_normalized = ${email}
        and auth_user_id <> ${input.authUserId}::uuid
      limit 1
      for update
    `;
    if (conflicts[0]) throw new PlatformAccessDeniedError();

    const invitationRows = await tx<
      Array<{
        display_name: string;
        id: string;
        invited_at: Date;
        invited_by_auth_user_id: string | null;
        role_slug: OperatorAccessRole;
      }>
    >`
      select
        invitation.id::text,
        invitation.invited_at,
        invitation.invited_by_auth_user_id,
        config.display_name,
        config.role_slug
      from passwordless_account_invites invitation
      join operator_invitation_configs config on config.invitation_id = invitation.id
      where invitation.email_normalized = ${email}
        and invitation.intended_user_type = 'staff'
        and invitation.accepted_at is null
        and invitation.revoked_at is null
        and (invitation.expires_at is null or invitation.expires_at > statement_timestamp())
      order by invitation.invited_at desc, invitation.id desc
      limit 1
      for update of invitation
    `;
    const invitation = invitationRows[0];
    if (!invitation) throw new PlatformAccessDeniedError();

    const circleRows = await tx<Array<{ id: string; name: string }>>`
      select circle_record.id, circle_record.name
      from operator_invitation_circles invitation_circle
      join circles circle_record on circle_record.id = invitation_circle.circle_id
      where invitation_circle.invitation_id = ${invitation.id}::bigint
        and circle_record.status in ('forming', 'active')
      order by circle_record.name
      for update of circle_record
    `;
    if (invitation.role_slug !== "ops_admin" && circleRows.length === 0) {
      throw new PlatformAccessDeniedError();
    }

    let personId: string;
    try {
      personId = await ensurePersonForEmail(tx, {
        email: input.email,
        emailNormalized: email,
        preferredPersonId: existing?.person_id,
        source: "platform_auth",
        verified: true,
      });
    } catch (error) {
      if (error instanceof PersonIdentityConflictError) throw new PlatformAccessDeniedError();
      throw error;
    }

    if (existing) {
      const updated = await tx<Array<{ auth_user_id: string }>>`
        update platform_users
        set
          person_id = ${personId}::uuid,
          user_type = case when user_type = 'member' then user_type else 'staff' end,
          status = 'active',
          invited_at = coalesce(invited_at, ${invitation.invited_at}),
          activated_at = coalesce(activated_at, statement_timestamp()),
          last_signed_in_at = statement_timestamp(),
          updated_at = statement_timestamp()
        where auth_user_id = ${input.authUserId}::uuid
          and email_normalized = ${email}
          and status in ('active', 'invited')
        returning auth_user_id
      `;
      if (!updated[0]) throw new PlatformAccessDeniedError();
    } else {
      await tx`
        insert into platform_users (
          auth_user_id,
          person_id,
          email_normalized,
          user_type,
          status,
          invited_at,
          activated_at,
          last_signed_in_at
        ) values (
          ${input.authUserId}::uuid,
          ${personId}::uuid,
          ${email},
          'staff',
          'active',
          ${invitation.invited_at},
          statement_timestamp(),
          statement_timestamp()
        )
      `;
    }

    await tx`
      insert into person_profiles (person_id, display_name, preferred_name)
      values (${personId}::uuid, ${invitation.display_name}, ${invitation.display_name})
      on conflict (person_id) do update
      set
        display_name = coalesce(person_profiles.display_name, excluded.display_name),
        preferred_name = coalesce(person_profiles.preferred_name, excluded.preferred_name),
        updated_at = statement_timestamp()
    `;

    await tx`
      insert into platform_role_grants (
        auth_user_id,
        role_slug,
        granted_by_auth_user_id,
        granted_at
      ) values (
        ${input.authUserId}::uuid,
        ${invitation.role_slug},
        ${invitation.invited_by_auth_user_id}::uuid,
        statement_timestamp()
      )
    `;

    if (circleRows.length > 0) {
      if (invitation.role_slug === "circle_leader") {
        const shaperConflict = await tx<Array<{ name: string }>>`
          select circle_record.name
          from circles circle_record
          where circle_record.id = any(${circleRows.map((circle) => circle.id)}::uuid[])
            and exists (
              select 1
              from circle_staff_assignments assignment
              where assignment.circle_id = circle_record.id
                and assignment.role_slug = 'circle_leader'
                and assignment.ended_at is null
            )
          limit 1
        `;
        if (shaperConflict[0]) throw new PlatformAccessDeniedError();
      }

      await tx`
        insert into circle_staff_assignments (
          circle_id,
          auth_user_id,
          role_slug,
          assigned_by_auth_user_id,
          assigned_at
        )
        select
          selected_circle.id,
          ${input.authUserId}::uuid,
          ${invitation.role_slug},
          ${invitation.invited_by_auth_user_id}::uuid,
          statement_timestamp()
        from unnest(${circleRows.map((circle) => circle.id)}::uuid[]) as selected_circle(id)
      `;
    }

    const accepted = await tx<Array<{ id: string }>>`
      update passwordless_account_invites
      set
        accepted_by_auth_user_id = ${input.authUserId}::uuid,
        accepted_at = statement_timestamp()
      where id = ${invitation.id}::bigint
        and accepted_at is null
        and revoked_at is null
        and (expires_at is null or expires_at > statement_timestamp())
      returning id::text
    `;
    if (!accepted[0]) throw new PlatformAccessDeniedError();

    await markPersonEmailVerified(tx, {
      email: input.email,
      emailNormalized: email,
      personId,
    });
    await writeAudit(tx, {
      action: "operator_invitation.accepted",
      actorAuthUserId: input.authUserId,
      after: {
        circleIds: circleRows.map((circle) => circle.id),
        role: invitation.role_slug,
      },
      subjectId: invitation.id,
      subjectType: "operator_invitation",
    });

    return { authUserId: input.authUserId, role: invitation.role_slug };
  });
}
