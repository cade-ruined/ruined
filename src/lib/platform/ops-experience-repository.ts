import "server-only";

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { getApplicationDatabase } from "@/lib/database/server";
import {
  googleCommunicationLivemode,
  googleCommunicationUrlFromMetadata,
} from "@/lib/google/communications";
import { memberEligibleForExperience } from "@/lib/platform/experience-member-access";
import {
  OpsOperatingRepositoryError,
} from "@/lib/platform/ops-operating-repository";
import {
  getOpsExperienceCalendarStateForTx,
  markOpsExperienceCalendarPending,
} from "@/lib/platform/ops-calendar-repository";
import type {
  OpsExperienceDirectory,
  OpsExperienceDraftInput,
  OpsExperienceLifecycleState,
  OpsExperienceRecord,
} from "@/lib/platform/ops-experience-model";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPERIENCE_KINDS = new Set([
  "public_event",
  "member_event",
  "weekly_call",
  "circle_meeting",
  "academy_session",
  "challenge",
  "retreat",
]);
const EXPERIENCE_VISIBILITIES = new Set([
  "public",
  "all_members",
  "circle",
  "block",
  "invite_only",
]);
const REGISTRATION_MODES = new Set(["none", "internal", "external"]);
const ATTENDANCE_EVENTS = new Set([
  "checked_in",
  "attended",
  "no_show",
  "credited",
  "revoked",
]);

type EventOperatorAccess = {
  authUserId: string;
  isAdmin: boolean;
  roles: Set<string>;
};

type ExperienceAccessRow = {
  block_id: string | null;
  circle_id: string | null;
  ends_at: Date | string | null;
  id: string;
  progression_level_slug: string | null;
  starts_at: Date | string;
  status: OpsExperienceLifecycleState;
  title: string;
  visibility: OpsExperienceDraftInput["visibility"] | "progression";
};

function requireUuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} is invalid.`);
  }
  return normalized;
}

function normalizedText(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      `${label} must be between ${minimum} and ${maximum} characters.`,
    );
  }
  return normalized;
}

function optionalText(value: string, maximum: number): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      `That field must be ${maximum} characters or fewer.`,
    );
  }
  return normalized;
}

function optionalUuid(value: string | null, label: string): string | null {
  return value ? requireUuid(value, label) : null;
}

function isoDate(value: string | null, label: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} is invalid.`);
  }
  return date.toISOString();
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validateTimezone(value: string): string {
  const normalized = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
  } catch {
    throw new OpsOperatingRepositoryError("invalid_request", "Timezone is invalid.");
  }
  return normalized;
}

function slugBase(value: string): string {
  const base = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/g, "");
  return base || "experience";
}

function normalizeDraft(input: OpsExperienceDraftInput) {
  const title = normalizedText(input.title, "Title", 1, 200);
  const kind = input.kind.trim();
  const visibility = input.visibility;
  const registrationMode = input.registrationMode;
  if (!EXPERIENCE_KINDS.has(kind)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Experience type is invalid.");
  }
  if (!EXPERIENCE_VISIBILITIES.has(visibility)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Audience is invalid.");
  }
  if (!REGISTRATION_MODES.has(registrationMode)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Registration mode is invalid.");
  }

  const startsAt = isoDate(input.startsAt, "Start time");
  const endsAt = isoDate(input.endsAt, "End time");
  const registrationOpensAt = isoDate(input.registrationOpensAt, "Registration opening time");
  const registrationClosesAt = isoDate(input.registrationClosesAt, "Registration closing time");
  if (!startsAt) {
    throw new OpsOperatingRepositoryError("invalid_request", "A start time is required.");
  }
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new OpsOperatingRepositoryError("invalid_request", "End time must be after start time.");
  }
  if (
    registrationOpensAt &&
    registrationClosesAt &&
    Date.parse(registrationClosesAt) < Date.parse(registrationOpensAt)
  ) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      "Registration cannot close before it opens.",
    );
  }

  const circleId = optionalUuid(input.circleId, "Circle");
  const blockId = optionalUuid(input.blockId, "Block");
  if (visibility === "circle" && (!circleId || blockId)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Choose one Circle audience.");
  }
  if (visibility === "block" && (!blockId || circleId)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Choose one Block audience.");
  }
  if (!["circle", "block"].includes(visibility) && (circleId || blockId)) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      "Circle and Block targets must match the selected audience.",
    );
  }

  const externalRegistrationUrl = optionalText(input.externalRegistrationUrl ?? "", 2000);
  if (registrationMode === "external") {
    try {
      const url = new URL(externalRegistrationUrl ?? "");
      if (url.protocol !== "https:") throw new Error("invalid");
    } catch {
      throw new OpsOperatingRepositoryError(
        "invalid_request",
        "External registration requires a full HTTPS link.",
      );
    }
  } else if (externalRegistrationUrl) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      "Remove the external link or choose external registration.",
    );
  }

  const capacity = input.capacity;
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000)) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      "Capacity must be a whole number between 1 and 100,000.",
    );
  }
  if (registrationMode !== "internal" && capacity !== null) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      "Capacity is managed here only for internal registration.",
    );
  }

  return {
    blockId,
    capacity,
    circleId,
    details: optionalText(input.details, 20000),
    endsAt,
    externalRegistrationUrl,
    kind,
    locationLabel: optionalText(input.locationLabel, 500),
    registrationClosesAt,
    registrationMode,
    registrationOpensAt,
    startsAt,
    summary: optionalText(input.summary, 2000),
    timezone: validateTimezone(input.timezone || "America/Denver"),
    title,
    visibility,
    waitlistEnabled: Boolean(input.waitlistEnabled),
  };
}

async function requireEventOperator(
  tx: postgres.TransactionSql,
  actorAuthUserIdValue: string,
  lock = false,
): Promise<EventOperatorAccess> {
  const actorAuthUserId = requireUuid(actorAuthUserIdValue, "Operator identity");
  const rows = lock
    ? await tx<Array<{ role_slug: string }>>`
        select role_grant.role_slug
        from platform_users platform_user
        join platform_role_grants role_grant
          on role_grant.auth_user_id = platform_user.auth_user_id
        where platform_user.auth_user_id = ${actorAuthUserId}::uuid
          and platform_user.status = 'active'
          and role_grant.revoked_at is null
          and role_grant.role_slug in ('ops_admin', 'guide', 'circle_leader')
        order by role_grant.role_slug
        for update of platform_user, role_grant
      `
    : await tx<Array<{ role_slug: string }>>`
        select role_grant.role_slug
        from platform_users platform_user
        join platform_role_grants role_grant
          on role_grant.auth_user_id = platform_user.auth_user_id
        where platform_user.auth_user_id = ${actorAuthUserId}::uuid
          and platform_user.status = 'active'
          and role_grant.revoked_at is null
          and role_grant.role_slug in ('ops_admin', 'guide', 'circle_leader')
        order by role_grant.role_slug
      `;
  const roles = new Set(rows.map((row) => row.role_slug));
  if (roles.size === 0) {
    throw new OpsOperatingRepositoryError("forbidden", "Operations access is required.");
  }
  return { authUserId: actorAuthUserId, isAdmin: roles.has("ops_admin"), roles };
}

async function hasAssignedCircle(
  tx: postgres.TransactionSql,
  access: EventOperatorAccess,
  circleId: string,
  roles: Array<"circle_leader" | "guide">,
  lock = false,
): Promise<boolean> {
  if (access.isAdmin) return true;
  const rows = await tx<Array<{ id: string }>>`
    select assignment.id
    from circle_staff_assignments assignment
    join platform_role_grants role_grant
      on role_grant.auth_user_id = assignment.auth_user_id
      and role_grant.role_slug = assignment.role_slug
      and role_grant.revoked_at is null
    where assignment.circle_id = ${circleId}::uuid
      and assignment.auth_user_id = ${access.authUserId}::uuid
      and assignment.ended_at is null
      and assignment.assigned_at <= statement_timestamp()
      and assignment.role_slug = any(${tx.array(roles)}::text[])
    limit 1
    ${lock ? tx`for share of assignment` : tx``}
  `;
  return rows.length > 0;
}

async function requireExperienceAccess(
  tx: postgres.TransactionSql,
  access: EventOperatorAccess,
  experienceId: string,
  intent: "define" | "read" | "roster",
): Promise<ExperienceAccessRow> {
  const rows = await tx<ExperienceAccessRow[]>`
    select id, title, circle_id, block_id, visibility, progression_level_slug, starts_at, ends_at, status
    from experiences
    where id = ${experienceId}::uuid
    for update
  `;
  const experience = rows[0];
  if (!experience) {
    throw new OpsOperatingRepositoryError("not_found", "Experience not found.");
  }
  if (access.isAdmin) return experience;
  if (!experience.circle_id) {
    throw new OpsOperatingRepositoryError(
      "forbidden",
      "Only an operations administrator can manage a non-Circle Experience.",
    );
  }
  const allowedRoles: Array<"circle_leader" | "guide"> = intent === "define"
    ? ["circle_leader"]
    : ["circle_leader", "guide"];
  if (!(await hasAssignedCircle(tx, access, experience.circle_id, allowedRoles, true))) {
    throw new OpsOperatingRepositoryError(
      "forbidden",
      "This Experience is outside the operator's current Circle assignment.",
    );
  }
  return experience;
}

async function requireEligibleExperienceMember(
  tx: postgres.TransactionSql,
  experience: ExperienceAccessRow,
  memberId: string | null,
): Promise<void> {
  if (!(await memberEligibleForExperience(tx, experience, memberId))) {
    throw new OpsOperatingRepositoryError(
      "forbidden",
      "This member does not currently have access to the Experience audience.",
    );
  }
}

async function writeOperatorAudit(
  tx: postgres.TransactionSql,
  input: {
    action: string;
    actorAuthUserId: string;
    after?: postgres.JSONValue;
    before?: postgres.JSONValue;
    memberId?: string | null;
    metadata?: postgres.JSONValue;
    reason?: string | null;
    subjectId: string;
    subjectType: string;
  },
) {
  await tx`
    insert into operator_audit_events (
      actor_auth_user_id,
      action,
      subject_type,
      subject_id,
      member_id,
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
      ${input.memberId ?? null}::uuid,
      ${input.reason ?? null},
      ${input.before === undefined ? null : tx.json(input.before)},
      ${input.after === undefined ? null : tx.json(input.after)},
      ${tx.json(input.metadata ?? {})},
      ${randomUUID()}
    )
  `;
}

async function writeExperienceEvent(
  tx: postgres.TransactionSql,
  input: {
    actorAuthUserId: string;
    eventType: string;
    experienceId: string;
    next?: postgres.JSONValue;
    previous?: postgres.JSONValue;
    reason?: string | null;
  },
) {
  await tx`
    insert into experience_events (
      experience_id,
      event_type,
      source,
      actor_auth_user_id,
      reason,
      previous_state,
      next_state,
      dedupe_key
    ) values (
      ${input.experienceId}::uuid,
      ${input.eventType},
      'ops',
      ${input.actorAuthUserId}::uuid,
      ${input.reason ?? null},
      ${input.previous === undefined ? null : tx.json(input.previous)},
      ${input.next === undefined ? null : tx.json(input.next)},
      ${randomUUID()}
    )
  `;
}

async function writeRegistrationEvent(
  tx: postgres.TransactionSql,
  input: {
    actorAuthUserId?: string | null;
    experienceId: string;
    nextStatus: string;
    personId: string;
    previousStatus: string | null;
    reason?: string | null;
    registrationId: string;
    source: "ops" | "system";
  },
) {
  await tx`
    insert into experience_registration_events (
      registration_id,
      experience_id,
      person_id,
      previous_status,
      next_status,
      source,
      actor_auth_user_id,
      reason,
      dedupe_key
    ) values (
      ${input.registrationId}::uuid,
      ${input.experienceId}::uuid,
      ${input.personId}::uuid,
      ${input.previousStatus},
      ${input.nextStatus},
      ${input.source},
      ${input.actorAuthUserId ?? null}::uuid,
      ${input.reason ?? null},
      ${randomUUID()}
    )
  `;
}

async function promoteWaitlist(
  tx: postgres.TransactionSql,
  experienceId: string,
  actorAuthUserId: string | null,
): Promise<number> {
  const capacityRows = await tx<Array<{
    block_id: string | null;
    capacity: number | null;
    circle_id: string | null;
    registered_count: number;
    progression_level_slug: string | null;
    visibility: string;
    waitlisted_count: number;
  }>>`
    select
      experience.capacity,
      experience.circle_id,
      experience.block_id,
      experience.visibility,
      experience.progression_level_slug,
      count(registration.id) filter (where registration.status = 'registered')::int as registered_count,
      count(registration.id) filter (where registration.status = 'waitlisted')::int as waitlisted_count
    from experiences experience
    left join experience_registrations registration
      on registration.experience_id = experience.id
    where experience.id = ${experienceId}::uuid
    group by experience.id
  `;
  const capacity = capacityRows[0]?.capacity;
  const registeredCount = Number(capacityRows[0]?.registered_count ?? 0);
  const waitlistedCount = Number(capacityRows[0]?.waitlisted_count ?? 0);
  const available = capacity === null
    ? waitlistedCount
    : Math.min(waitlistedCount, Math.max(0, capacity - registeredCount));
  if (available === 0) return 0;

  const candidates = await tx<Array<{
    id: string;
    member_id: string | null;
    person_id: string;
  }>>`
    select registration.id, registration.member_id, registration.person_id
    from experience_registrations registration
    where registration.experience_id = ${experienceId}::uuid
      and registration.status = 'waitlisted'
    order by registration.waitlisted_at, registration.registered_at, registration.id
    for update
  `;
  let promoted = 0;
  for (const registration of candidates) {
    if (promoted >= available) break;
    if (!(await memberEligibleForExperience(tx, capacityRows[0]!, registration.member_id))) continue;
    await tx`
      update experience_registrations registration
      set status = 'registered', promoted_at = statement_timestamp(),
        cancelled_at = null, cancellation_reason = null,
        version = registration.version + 1, updated_at = statement_timestamp()
      where registration.id = ${registration.id}::uuid
        and registration.status = 'waitlisted'
    `;
    await writeRegistrationEvent(tx, {
      actorAuthUserId,
      experienceId,
      nextStatus: "registered",
      personId: registration.person_id,
      previousStatus: "waitlisted",
      reason: "Promoted when a place became available.",
      registrationId: registration.id,
      source: "system",
    });
    promoted += 1;
  }
  return promoted;
}

export async function getOpsExperienceManagementDirectory(
  actorAuthUserId: string,
): Promise<OpsExperienceDirectory> {
  const sql = getApplicationDatabase();
  const googleLivemode = googleCommunicationLivemode();
  const googleCommunicationsConfigured = googleLivemode !== null;
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const access = await requireEventOperator(tx, actorAuthUserId);
    const rows = await tx<Array<{
      capacity: number | null;
      ends_at: Date | string | null;
      experience_id: string;
      kind: string;
      meeting_metadata: unknown;
      registered_count: number | string;
      scope_label: string;
      starts_at: Date | string;
      state: OpsExperienceLifecycleState;
      title: string;
      waitlisted_count: number | string;
    }>>`
      select
        experience.id as experience_id,
        experience.title,
        experience.kind,
        experience.starts_at,
        experience.ends_at,
        experience.capacity,
        experience.status as state,
        communication_link.metadata as meeting_metadata,
        case
          when experience.visibility = 'circle' then coalesce(circle.name, 'Circle')
          when experience.visibility = 'block' then coalesce(membership_block.name, 'Block')
          when experience.visibility = 'public' then 'Public'
          when experience.visibility = 'invite_only' then 'Invite only'
          else 'All active members'
        end as scope_label,
        count(registration.id) filter (where registration.status = 'registered') as registered_count,
        count(registration.id) filter (where registration.status = 'waitlisted') as waitlisted_count
      from experiences experience
      left join circles circle on circle.id = experience.circle_id
      left join membership_blocks membership_block on membership_block.id = experience.block_id
      left join experience_registrations registration on registration.experience_id = experience.id
      left join integration_entity_links communication_link
        on communication_link.provider = 'google'
       and communication_link.local_entity_type = 'experience'
       and communication_link.local_entity_id = experience.id::text
       and communication_link.external_entity_type = 'meet_space'
       and communication_link.livemode = ${googleLivemode}
      where (
        ${access.isAdmin}
        or (
          experience.circle_id is not null
          and exists (
            select 1
            from circle_staff_assignments staff_assignment
            join platform_role_grants role_grant
              on role_grant.auth_user_id = staff_assignment.auth_user_id
             and role_grant.role_slug = staff_assignment.role_slug
             and role_grant.revoked_at is null
            where staff_assignment.circle_id = experience.circle_id
              and staff_assignment.auth_user_id = ${access.authUserId}::uuid
              and staff_assignment.ended_at is null
          )
        )
      )
      group by experience.id, circle.name, membership_block.name, communication_link.metadata
      order by
        case experience.status
          when 'published' then 1
          when 'draft' then 2
          when 'completed' then 3
          when 'cancelled' then 4
          else 5
        end,
        experience.starts_at desc
      limit 500
    `;
    const circles = await tx<Array<{ id: string; name: string }>>`
      select circle.id, circle.name
      from circles circle
      where circle.status in ('forming', 'active')
        and (
          ${access.isAdmin}
          or exists (
            select 1
            from circle_staff_assignments staff_assignment
            join platform_role_grants role_grant
              on role_grant.auth_user_id = staff_assignment.auth_user_id
             and role_grant.role_slug = staff_assignment.role_slug
             and role_grant.revoked_at is null
            where staff_assignment.circle_id = circle.id
              and staff_assignment.auth_user_id = ${access.authUserId}::uuid
              and staff_assignment.role_slug = 'circle_leader'
              and staff_assignment.ended_at is null
          )
        )
      order by circle.name
    `;
    const blocks = access.isAdmin
      ? await tx<Array<{ id: string; name: string }>>`
          select id, name
          from membership_blocks
          where status in ('forming', 'active')
          order by name
        `
      : [];
    return {
      blocks,
      canCreate: access.isAdmin || access.roles.has("circle_leader"),
      canManageGlobal: access.isAdmin,
      circles,
      experiences: rows.map((row) => ({
        capacity: row.capacity,
        endsAt: asIso(row.ends_at),
        experienceId: row.experience_id,
        googleCommunicationsConfigured,
        kind: row.kind,
        meetingUrl: googleCommunicationsConfigured
          ? googleCommunicationUrlFromMetadata("meet", row.meeting_metadata)
          : null,
        registeredCount: Number(row.registered_count),
        scope: row.scope_label,
        startsAt: asIso(row.starts_at)!,
        state: row.state,
        title: row.title,
        waitlistedCount: Number(row.waitlisted_count),
      })),
    };
  });
}

export async function getOpsExperienceRecord(
  actorAuthUserId: string,
  experienceIdValue: string,
): Promise<OpsExperienceRecord | null> {
  const experienceId = requireUuid(experienceIdValue, "Experience");
  const sql = getApplicationDatabase();
  const googleLivemode = googleCommunicationLivemode();
  const googleCommunicationsConfigured = googleLivemode !== null;
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const access = await requireEventOperator(tx, actorAuthUserId);
    const eventRows = await tx<Array<{
      archived_at: Date | string | null;
      block_id: string | null;
      cancellation_reason: string | null;
      cancelled_at: Date | string | null;
      capacity: number | null;
      circle_id: string | null;
      completed_at: Date | string | null;
      details: string | null;
      ends_at: Date | string | null;
      external_registration_url: string | null;
      experience_id: string;
      kind: string;
      location_label: string | null;
      meeting_metadata: unknown;
      registered_count: number | string;
      registration_closes_at: Date | string | null;
      registration_mode: "external" | "internal" | "none";
      registration_opens_at: Date | string | null;
      scope_label: string;
      starts_at: Date | string;
      state: OpsExperienceLifecycleState;
      summary: string | null;
      timezone: string;
      title: string;
      version: number | string;
      visibility: "all_members" | "block" | "circle" | "invite_only" | "public";
      waitlist_enabled: boolean;
      waitlisted_count: number | string;
    }>>`
      select
        experience.id as experience_id,
        experience.title,
        experience.kind,
        experience.summary,
        experience.details,
        experience.starts_at,
        experience.ends_at,
        experience.timezone,
        experience.location_label,
        experience.visibility,
        experience.circle_id,
        experience.block_id,
        experience.registration_mode,
        experience.external_registration_url,
        experience.registration_opens_at,
        experience.registration_closes_at,
        experience.capacity,
        experience.waitlist_enabled,
        experience.status as state,
        experience.cancelled_at,
        experience.cancellation_reason,
        experience.completed_at,
        experience.archived_at,
        experience.version,
        communication_link.metadata as meeting_metadata,
        case
          when experience.visibility = 'circle' then coalesce(circle.name, 'Circle')
          when experience.visibility = 'block' then coalesce(membership_block.name, 'Block')
          when experience.visibility = 'public' then 'Public'
          when experience.visibility = 'invite_only' then 'Invite only'
          else 'All active members'
        end as scope_label,
        count(registration.id) filter (where registration.status = 'registered') as registered_count,
        count(registration.id) filter (where registration.status = 'waitlisted') as waitlisted_count
      from experiences experience
      left join circles circle on circle.id = experience.circle_id
      left join membership_blocks membership_block on membership_block.id = experience.block_id
      left join experience_registrations registration on registration.experience_id = experience.id
      left join integration_entity_links communication_link
        on communication_link.provider = 'google'
       and communication_link.local_entity_type = 'experience'
       and communication_link.local_entity_id = experience.id::text
       and communication_link.external_entity_type = 'meet_space'
       and communication_link.livemode = ${googleLivemode}
      where experience.id = ${experienceId}::uuid
        and (
          ${access.isAdmin}
          or (
            experience.circle_id is not null
            and exists (
              select 1
              from circle_staff_assignments staff_assignment
              join platform_role_grants role_grant
                on role_grant.auth_user_id = staff_assignment.auth_user_id
               and role_grant.role_slug = staff_assignment.role_slug
               and role_grant.revoked_at is null
              where staff_assignment.circle_id = experience.circle_id
                and staff_assignment.auth_user_id = ${access.authUserId}::uuid
                and staff_assignment.ended_at is null
            )
          )
        )
      group by experience.id, circle.name, membership_block.name, communication_link.metadata
    `;
    const event = eventRows[0];
    if (!event) return null;

    const canDefine = access.isAdmin || Boolean(
      event.circle_id && await hasAssignedCircle(tx, access, event.circle_id, ["circle_leader"]),
    );
    const rosterRows = await tx<Array<{
      attendance_state: string | null;
      avatar_storage_path: string | null;
      cancelled_at: Date | string | null;
      member_id: string | null;
      person_id: string;
      preferred_name: string;
      registered_at: Date | string;
      registration_id: string;
      status: "cancelled" | "external_pending" | "registered" | "waitlisted";
      waitlist_position: number | string | null;
    }>>`
      with ranked_roster as (
        select
          registration.*,
          case when registration.status = 'waitlisted' then
            row_number() over (
              partition by registration.experience_id, registration.status
              order by registration.waitlisted_at, registration.registered_at, registration.id
            )
          end as waitlist_position
        from experience_registrations registration
        where registration.experience_id = ${experienceId}::uuid
      )
      select
        registration.id as registration_id,
        registration.person_id,
        registration.member_id,
        coalesce(profile.preferred_name, profile.display_name, 'Participant') as preferred_name,
        profile.avatar_storage_path,
        registration.status,
        registration.registered_at,
        registration.cancelled_at,
        registration.waitlist_position,
        case when attendance.event_type = 'revoked' then null else attendance.event_type end
          as attendance_state
      from ranked_roster registration
      left join person_profiles profile on profile.person_id = registration.person_id
      left join lateral (
        select attendance_event.event_type
        from experience_attendance_events attendance_event
        where attendance_event.experience_id = registration.experience_id
          and attendance_event.person_id = registration.person_id
        order by attendance_event.occurred_at desc, attendance_event.id desc
        limit 1
      ) attendance on true
      order by
        case registration.status
          when 'registered' then 1
          when 'waitlisted' then 2
          when 'external_pending' then 3
          else 4
        end,
        coalesce(registration.waitlisted_at, registration.registered_at),
        registration.id
    `;
    const historyRows = await tx<Array<{
      actor: string | null;
      event_type: string;
      occurred_at: Date | string;
      reason: string | null;
    }>>`
      select
        activity.event_type,
        activity.reason,
        activity.occurred_at,
        coalesce(profile.display_name, platform_user.email_normalized) as actor
      from (
        select
          event.event_type,
          event.reason,
          event.occurred_at,
          event.actor_auth_user_id,
          event.id * 3 as sequence
        from experience_events event
        where event.experience_id = ${experienceId}::uuid
        union all
        select
          'registration_' || registration_event.next_status,
          registration_event.reason,
          registration_event.occurred_at,
          registration_event.actor_auth_user_id,
          registration_event.id * 3 + 1 as sequence
        from experience_registration_events registration_event
        where registration_event.experience_id = ${experienceId}::uuid
        union all
        select
          'attendance_' || attendance_event.event_type,
          nullif(attendance_event.evidence ->> 'reason', ''),
          attendance_event.occurred_at,
          attendance_event.actor_auth_user_id,
          attendance_event.id * 3 + 2 as sequence
        from experience_attendance_events attendance_event
        where attendance_event.experience_id = ${experienceId}::uuid
      ) activity
      left join platform_users platform_user
        on platform_user.auth_user_id = activity.actor_auth_user_id
      left join user_profiles profile
        on profile.auth_user_id = activity.actor_auth_user_id
      order by activity.occurred_at desc, activity.sequence desc
      limit 100
    `;
    const memberOptions = await tx<Array<{ id: string; name: string }>>`
      select
        member.id,
        coalesce(profile.preferred_name, profile.display_name, member.email_normalized) as name
      from ruined_members member
      join member_lifecycle lifecycle on lifecycle.member_id = member.id
      left join person_profiles profile on profile.person_id = member.person_id
      where lifecycle.account_state = 'active'
        and lifecycle.standing_state in ('active', 'paused')
        and (
          ${access.isAdmin}
          or exists (
            select 1
            from circle_member_assignments member_assignment
            where member_assignment.member_id = member.id
              and member_assignment.circle_id = ${event.circle_id}::uuid
              and member_assignment.ended_at is null
          )
        )
      order by name
      limit 1000
    `;
    const calendar = await getOpsExperienceCalendarStateForTx(tx, experienceId);

    return {
      archivedAt: asIso(event.archived_at),
      blockId: event.block_id,
      canEdit: canDefine,
      canManageAttendance: true,
      canManageCommunication: true,
      canManageGlobal: access.isAdmin,
      canManageRoster: true,
      calendar,
      cancellationReason: event.cancellation_reason,
      cancelledAt: asIso(event.cancelled_at),
      circleId: event.circle_id,
      capacity: event.capacity,
      completedAt: asIso(event.completed_at),
      details: event.details,
      endsAt: asIso(event.ends_at),
      experienceId: event.experience_id,
      externalRegistrationUrl: event.external_registration_url,
      googleCommunicationsConfigured,
      history: historyRows.map((row) => ({
        actor: row.actor,
        eventType: row.event_type,
        occurredAt: asIso(row.occurred_at)!,
        reason: row.reason,
      })),
      kind: event.kind,
      locationLabel: event.location_label,
      memberOptions: memberOptions.map((member) => ({ id: member.id, name: member.name })),
      meetingUrl: googleCommunicationsConfigured
        ? googleCommunicationUrlFromMetadata("meet", event.meeting_metadata)
        : null,
      registeredCount: Number(event.registered_count),
      registrationClosesAt: asIso(event.registration_closes_at),
      registrationMode: event.registration_mode,
      registrationOpensAt: asIso(event.registration_opens_at),
      roster: rosterRows.map((row) => ({
        attendanceState: row.attendance_state,
        avatarStoragePath: row.avatar_storage_path,
        cancelledAt: asIso(row.cancelled_at),
        memberId: row.member_id,
        personId: row.person_id,
        preferredName: row.preferred_name,
        registeredAt: asIso(row.registered_at)!,
        registrationId: row.registration_id,
        status: row.status,
        waitlistPosition: row.waitlist_position === null ? null : Number(row.waitlist_position),
      })),
      scope: event.scope_label,
      startsAt: asIso(event.starts_at)!,
      state: event.state,
      summary: event.summary,
      timezone: event.timezone,
      title: event.title,
      version: Number(event.version),
      visibility: event.visibility,
      waitlistEnabled: event.waitlist_enabled,
      waitlistedCount: Number(event.waitlisted_count),
    };
  });
}

export async function createOpsExperience(input: {
  actorAuthUserId: string;
  draft: OpsExperienceDraftInput;
}): Promise<{ experienceId: string }> {
  const draft = normalizeDraft(input.draft);
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const access = await requireEventOperator(tx, input.actorAuthUserId, true);
    if (!access.isAdmin) {
      if (
        !access.roles.has("circle_leader") ||
        draft.kind !== "circle_meeting" ||
        draft.visibility !== "circle" ||
        !draft.circleId ||
        !(await hasAssignedCircle(tx, access, draft.circleId, ["circle_leader"]))
      ) {
        throw new OpsOperatingRepositoryError(
          "forbidden",
          "A Shaper may create only a meeting for their assigned Circle.",
        );
      }
    }
    const experienceId = randomUUID();
    const base = slugBase(draft.title);
    await tx`select pg_advisory_xact_lock(hashtext(${base}), 49)`;
    const slugRows = await tx<Array<{ exists: boolean }>>`
      select exists(select 1 from experiences where slug = ${base}) as exists
    `;
    const slug = slugRows[0]?.exists ? `${base}-${experienceId.slice(0, 8)}` : base;
    await tx`
      insert into experiences (
        id,
        slug,
        kind,
        title,
        summary,
        details,
        starts_at,
        ends_at,
        timezone,
        location_label,
        visibility,
        circle_id,
        block_id,
        registration_mode,
        external_registration_url,
        registration_opens_at,
        registration_closes_at,
        capacity,
        waitlist_enabled,
        status,
        created_by_auth_user_id,
        updated_by_auth_user_id
      ) values (
        ${experienceId}::uuid,
        ${slug},
        ${draft.kind},
        ${draft.title},
        ${draft.summary},
        ${draft.details},
        ${draft.startsAt}::timestamptz,
        ${draft.endsAt}::timestamptz,
        ${draft.timezone},
        ${draft.locationLabel},
        ${draft.visibility},
        ${draft.circleId}::uuid,
        ${draft.blockId}::uuid,
        ${draft.registrationMode},
        ${draft.externalRegistrationUrl},
        ${draft.registrationOpensAt}::timestamptz,
        ${draft.registrationClosesAt}::timestamptz,
        ${draft.capacity},
        ${draft.waitlistEnabled},
        'draft',
        ${access.authUserId}::uuid,
        ${access.authUserId}::uuid
      )
    `;
    const snapshot = { status: "draft", title: draft.title, version: 1 };
    await writeExperienceEvent(tx, {
      actorAuthUserId: access.authUserId,
      eventType: "created",
      experienceId,
      next: snapshot,
    });
    await writeOperatorAudit(tx, {
      action: "experience.created",
      actorAuthUserId: access.authUserId,
      after: snapshot,
      subjectId: experienceId,
      subjectType: "experience",
    });
    return { experienceId };
  });
}

export async function updateOpsExperience(input: {
  actorAuthUserId: string;
  draft: OpsExperienceDraftInput;
  experienceId: string;
}): Promise<{ experienceId: string; promotedCount: number }> {
  const experienceId = requireUuid(input.experienceId, "Experience");
  const draft = normalizeDraft(input.draft);
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${experienceId}), 48)`;
    const access = await requireEventOperator(tx, input.actorAuthUserId, true);
    const existing = await requireExperienceAccess(tx, access, experienceId, "define");
    if (!["draft", "published"].includes(existing.status)) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "Cancelled, completed, and archived Experiences cannot be edited.",
      );
    }
    if (!access.isAdmin && (draft.circleId !== existing.circle_id || draft.visibility !== "circle")) {
      throw new OpsOperatingRepositoryError(
        "forbidden",
        "A Shaper cannot move an Experience outside their assigned Circle.",
      );
    }
    const countRows = await tx<Array<{
      registered_count: number;
      waitlisted_count: number;
    }>>`
      select
        count(*) filter (where status = 'registered')::int as registered_count,
        count(*) filter (where status = 'waitlisted')::int as waitlisted_count
      from experience_registrations
      where experience_id = ${experienceId}::uuid
    `;
    const registeredCount = Number(countRows[0]?.registered_count ?? 0);
    const waitlistedCount = Number(countRows[0]?.waitlisted_count ?? 0);
    if (draft.capacity !== null && draft.capacity < registeredCount) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        `Capacity cannot be lower than the ${registeredCount} confirmed registrations.`,
      );
    }
    if (draft.registrationMode !== "internal" && registeredCount + waitlistedCount > 0) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "Resolve the current roster before changing how registration is managed.",
      );
    }
    if (!draft.waitlistEnabled && waitlistedCount > 0) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "Resolve the current waitlist before turning it off.",
      );
    }
    const beforeRows = await tx<Array<{ capacity: number | null; title: string; version: number }>>`
      select capacity, title, version from experiences where id = ${experienceId}::uuid
    `;
    const before = beforeRows[0]!;
    await tx`
      update experiences
      set
        kind = ${draft.kind},
        title = ${draft.title},
        summary = ${draft.summary},
        details = ${draft.details},
        starts_at = ${draft.startsAt}::timestamptz,
        ends_at = ${draft.endsAt}::timestamptz,
        timezone = ${draft.timezone},
        location_label = ${draft.locationLabel},
        visibility = ${draft.visibility},
        circle_id = ${draft.circleId}::uuid,
        block_id = ${draft.blockId}::uuid,
        progression_level_slug = null,
        registration_mode = ${draft.registrationMode},
        external_registration_url = ${draft.externalRegistrationUrl},
        registration_opens_at = ${draft.registrationOpensAt}::timestamptz,
        registration_closes_at = ${draft.registrationClosesAt}::timestamptz,
        capacity = ${draft.capacity},
        waitlist_enabled = ${draft.waitlistEnabled},
        updated_by_auth_user_id = ${access.authUserId}::uuid,
        version = version + 1,
        updated_at = statement_timestamp()
      where id = ${experienceId}::uuid
    `;
    const promotedCount = await promoteWaitlist(tx, experienceId, access.authUserId);
    const after = {
      capacity: draft.capacity,
      status: existing.status,
      title: draft.title,
      version: Number(before.version) + 1,
    };
    await writeExperienceEvent(tx, {
      actorAuthUserId: access.authUserId,
      eventType: before.capacity === draft.capacity ? "updated" : "capacity_changed",
      experienceId,
      next: after,
      previous: before,
    });
    await writeOperatorAudit(tx, {
      action: "experience.updated",
      actorAuthUserId: access.authUserId,
      after,
      before,
      metadata: { promotedCount },
      subjectId: experienceId,
      subjectType: "experience",
    });
    await markOpsExperienceCalendarPending(tx, {
      actorAuthUserId: access.authUserId,
      experienceId,
      reason: "experience",
    });
    if (promotedCount > 0) {
      await markOpsExperienceCalendarPending(tx, {
        actorAuthUserId: access.authUserId,
        experienceId,
        reason: "attendees",
      });
    }
    return { experienceId, promotedCount };
  });
}

export async function transitionOpsExperience(input: {
  actorAuthUserId: string;
  experienceId: string;
  intent: "archive" | "cancel" | "complete" | "publish";
  reason?: string;
}): Promise<{ state: OpsExperienceLifecycleState }> {
  const experienceId = requireUuid(input.experienceId, "Experience");
  const reason = input.intent === "cancel"
    ? normalizedText(input.reason ?? "", "Cancellation reason", 3, 1000)
    : optionalText(input.reason ?? "", 2000);
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${experienceId}), 48)`;
    const access = await requireEventOperator(tx, input.actorAuthUserId, true);
    const experience = await requireExperienceAccess(tx, access, experienceId, "define");
    const allowed: Record<typeof input.intent, OpsExperienceLifecycleState[]> = {
      archive: ["draft", "cancelled", "completed"],
      cancel: ["published"],
      complete: ["published"],
      publish: ["draft"],
    };
    if (!allowed[input.intent].includes(experience.status)) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        `A ${experience.status} Experience cannot be ${input.intent}ed.`,
      );
    }
    if (input.intent === "complete") {
      const startedRows = await tx<Array<{ started: boolean }>>`
        select starts_at <= statement_timestamp() as started
        from experiences where id = ${experienceId}::uuid
      `;
      if (!startedRows[0]?.started) {
        throw new OpsOperatingRepositoryError(
          "conflict",
          "An Experience cannot be completed before it begins.",
        );
      }
    }

    const state: OpsExperienceLifecycleState = input.intent === "publish"
      ? "published"
      : input.intent === "cancel"
        ? "cancelled"
        : input.intent === "complete"
          ? "completed"
          : "archived";
    await tx`
      update experiences
      set
        status = ${state},
        published_at = case when ${state} = 'published' then statement_timestamp() else published_at end,
        cancelled_at = case when ${state} = 'cancelled' then statement_timestamp() else cancelled_at end,
        cancellation_reason = case when ${state} = 'cancelled' then ${reason} else cancellation_reason end,
        completed_at = case when ${state} = 'completed' then statement_timestamp() else completed_at end,
        archived_at = case when ${state} = 'archived' then statement_timestamp() else archived_at end,
        updated_by_auth_user_id = ${access.authUserId}::uuid,
        version = version + 1,
        updated_at = statement_timestamp()
      where id = ${experienceId}::uuid
    `;
    const before = { status: experience.status };
    const after = { status: state };
    await writeExperienceEvent(tx, {
      actorAuthUserId: access.authUserId,
      eventType: state,
      experienceId,
      next: after,
      previous: before,
      reason,
    });
    await writeOperatorAudit(tx, {
      action: `experience.${state}`,
      actorAuthUserId: access.authUserId,
      after,
      before,
      reason,
      subjectId: experienceId,
      subjectType: "experience",
    });
    if (input.intent === "publish" || input.intent === "cancel") {
      await markOpsExperienceCalendarPending(tx, {
        actorAuthUserId: access.authUserId,
        experienceId,
        reason: input.intent === "cancel" ? "cancel" : "publish",
      });
    }
    return { state };
  });
}

export async function setOpsExperienceRegistration(input: {
  action: "cancel" | "promote" | "register" | "waitlist";
  actorAuthUserId: string;
  experienceId: string;
  memberId?: string | null;
  reason?: string;
  registrationId?: string | null;
}): Promise<{ promotedCount: number; registrationId: string; status: string }> {
  const experienceId = requireUuid(input.experienceId, "Experience");
  const registrationId = input.registrationId
    ? requireUuid(input.registrationId, "Registration")
    : null;
  const memberId = input.memberId ? requireUuid(input.memberId, "Member") : null;
  if (
    (input.action === "register" && (!memberId || registrationId)) ||
    (input.action !== "register" && (!registrationId || memberId))
  ) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      input.action === "register"
        ? "Choose exactly one member to register."
        : "Choose exactly one existing registration.",
    );
  }
  const reason = ["cancel", "waitlist"].includes(input.action)
    ? normalizedText(input.reason ?? "", "Reason", 3, 1000)
    : optionalText(input.reason ?? "", 1000);
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${experienceId}), 48)`;
    const access = await requireEventOperator(tx, input.actorAuthUserId, true);
    const experience = await requireExperienceAccess(tx, access, experienceId, "roster");
    if (!["draft", "published", "completed"].includes(experience.status)) {
      throw new OpsOperatingRepositoryError("conflict", "This roster is closed.");
    }
    const experienceRows = await tx<Array<{
      capacity: number | null;
      registration_mode: string;
      waitlist_enabled: boolean;
    }>>`
      select capacity, registration_mode, waitlist_enabled
      from experiences where id = ${experienceId}::uuid
      for update
    `;
    const config = experienceRows[0]!;
    if (config.registration_mode !== "internal") {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "Roster controls are available only for internal registration.",
      );
    }

    const memberRows = memberId
      ? await tx<Array<{ member_id: string; person_id: string }>>`
          select id as member_id, person_id
          from ruined_members
          where id = ${memberId}::uuid
            and person_id is not null
          for update
        `
      : [];
    const member = memberRows[0];
    if (memberId && !member) {
      throw new OpsOperatingRepositoryError("not_found", "Member not found.");
    }

    const existingRows = registrationId
      ? await tx<Array<{
          id: string;
          member_id: string | null;
          person_id: string;
          status: string;
        }>>`
          select id, member_id, person_id, status
          from experience_registrations
          where id = ${registrationId}::uuid
            and experience_id = ${experienceId}::uuid
          for update
        `
      : await tx<Array<{
          id: string;
          member_id: string | null;
          person_id: string;
          status: string;
        }>>`
          select id, member_id, person_id, status
          from experience_registrations
          where experience_id = ${experienceId}::uuid
            and person_id = ${member?.person_id ?? null}::uuid
          for update
        `;
    let current = existingRows[0];
    if (!current && registrationId) {
      throw new OpsOperatingRepositoryError("not_found", "Registration not found.");
    }
    const previousStatus = current?.id ? current.status : null;
    if (input.action === "cancel" && (!current?.id || current.status === "cancelled")) {
      throw new OpsOperatingRepositoryError("conflict", "There is no active registration to cancel.");
    }
    if (input.action === "promote" && current?.status !== "waitlisted") {
      throw new OpsOperatingRepositoryError("conflict", "Only a waitlisted registration can be promoted.");
    }
    if (input.action === "waitlist" && !config.waitlist_enabled) {
      throw new OpsOperatingRepositoryError("conflict", "This Experience does not use a waitlist.");
    }
    // Cancellation and reducing an existing confirmed place to the waitlist are
    // cleanup, not new admission. Keep those available for stale registrations.
    if (input.action === "register" || input.action === "promote" || (
      input.action === "waitlist" && !["registered", "waitlisted"].includes(current?.status ?? "")
    )) {
      await requireEligibleExperienceMember(tx, experience, memberId ?? current?.member_id ?? null);
    }

    const countRows = await tx<Array<{ registered_count: number }>>`
      select count(*)::int as registered_count
      from experience_registrations
      where experience_id = ${experienceId}::uuid and status = 'registered'
    `;
    const registeredCount = Number(countRows[0]?.registered_count ?? 0);
    const placeAvailable = config.capacity === null || registeredCount < config.capacity;
    let nextStatus = input.action === "cancel"
      ? "cancelled"
      : input.action === "waitlist"
        ? "waitlisted"
        : "registered";
    if (input.action === "register" && !placeAvailable) {
      if (!config.waitlist_enabled) {
        throw new OpsOperatingRepositoryError("conflict", "The Experience is full and has no waitlist.");
      }
      nextStatus = "waitlisted";
    }
    if (input.action === "promote" && !placeAvailable) {
      throw new OpsOperatingRepositoryError("conflict", "No confirmed place is available.");
    }
    if (current?.id && current.status === nextStatus) {
      return { promotedCount: 0, registrationId: current.id, status: nextStatus };
    }

    if (!current?.id) {
      if (!member) {
        throw new OpsOperatingRepositoryError("not_found", "Member not found.");
      }
      const inserted = await tx<Array<{ id: string }>>`
        insert into experience_registrations (
          experience_id,
          person_id,
          member_id,
          status,
          source,
          registered_at,
          waitlisted_at,
          cancelled_at,
          cancellation_reason
        ) values (
          ${experienceId}::uuid,
          ${member.person_id}::uuid,
          ${member.member_id}::uuid,
          ${nextStatus},
          'ops',
          statement_timestamp(),
          case when ${nextStatus} = 'waitlisted' then statement_timestamp() end,
          case when ${nextStatus} = 'cancelled' then statement_timestamp() end,
          case when ${nextStatus} = 'cancelled' then ${reason} end
        )
        returning id
      `;
      current = {
        id: inserted[0]!.id,
        member_id: member.member_id,
        person_id: member.person_id,
        status: nextStatus,
      };
    } else {
      await tx`
        update experience_registrations
        set
          status = ${nextStatus},
          waitlisted_at = case
            when ${nextStatus} = 'waitlisted' then statement_timestamp()
            else waitlisted_at
          end,
          promoted_at = case
            when ${nextStatus} = 'registered' and status = 'waitlisted' then statement_timestamp()
            else promoted_at
          end,
          cancelled_at = case when ${nextStatus} = 'cancelled' then statement_timestamp() end,
          cancellation_reason = case when ${nextStatus} = 'cancelled' then ${reason} end,
          source = 'ops',
          version = version + 1,
          updated_at = statement_timestamp()
        where id = ${current.id}::uuid
      `;
    }
    await writeRegistrationEvent(tx, {
      actorAuthUserId: access.authUserId,
      experienceId,
      nextStatus,
      personId: current.person_id,
      previousStatus,
      reason,
      registrationId: current.id,
      source: "ops",
    });
    let promotedCount = 0;
    if (nextStatus === "cancelled" && previousStatus === "registered") {
      promotedCount = await promoteWaitlist(tx, experienceId, access.authUserId);
    }
    await writeOperatorAudit(tx, {
      action: `experience.registration_${nextStatus}`,
      actorAuthUserId: access.authUserId,
      after: { status: nextStatus },
      before: previousStatus ? { status: previousStatus } : undefined,
      memberId: current.member_id,
      metadata: { experienceId, promotedCount },
      reason,
      subjectId: current.id,
      subjectType: "experience_registration",
    });
    await markOpsExperienceCalendarPending(tx, {
      actorAuthUserId: access.authUserId,
      experienceId,
      reason: "attendees",
    });
    return { promotedCount, registrationId: current.id, status: nextStatus };
  });
}

export async function recordOpsExperienceAttendance(input: {
  actorAuthUserId: string;
  eventType: string;
  experienceId: string;
  reason?: string;
  registrationId: string;
}): Promise<{ attendanceState: string }> {
  const experienceId = requireUuid(input.experienceId, "Experience");
  const registrationId = requireUuid(input.registrationId, "Registration");
  if (!ATTENDANCE_EVENTS.has(input.eventType)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Attendance state is invalid.");
  }
  const reason = input.eventType === "revoked"
    ? normalizedText(input.reason ?? "", "Reason", 3, 1000)
    : optionalText(input.reason ?? "", 1000);
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${experienceId}), 48)`;
    const access = await requireEventOperator(tx, input.actorAuthUserId, true);
    const experience = await requireExperienceAccess(tx, access, experienceId, "roster");
    if (!["published", "completed"].includes(experience.status)) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "Attendance can be recorded only for a published or completed Experience.",
      );
    }
    if (
      ["attended", "credited", "no_show"].includes(input.eventType) &&
      new Date(experience.starts_at).getTime() > Date.now()
    ) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "Final attendance cannot be recorded before the Experience begins.",
      );
    }
    const rows = await tx<Array<{
      member_id: string | null;
      person_id: string;
      status: string;
    }>>`
      select member_id, person_id, status
      from experience_registrations
      where id = ${registrationId}::uuid
        and experience_id = ${experienceId}::uuid
      for update
    `;
    const registration = rows[0];
    if (!registration) {
      throw new OpsOperatingRepositoryError("not_found", "Registration not found.");
    }
    if (registration.status !== "registered") {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "Attendance can be recorded only for a confirmed registration.",
      );
    }
    const historical = new Date(experience.ends_at ?? experience.starts_at).getTime() <= Date.now();
    if (!historical && ["checked_in", "attended", "credited"].includes(input.eventType)) {
      await requireEligibleExperienceMember(tx, experience, registration.member_id);
    }
    // A later membership/Circle change must not prevent truthful attendance on
    // an existing confirmed past-event registration. Revocation/no-show marks
    // likewise remain available to an operator who still owns the event scope.
    const previousRows = await tx<Array<{ event_type: string }>>`
      select event_type
      from experience_attendance_events
      where experience_id = ${experienceId}::uuid
        and person_id = ${registration.person_id}::uuid
      order by occurred_at desc, id desc
      limit 1
    `;
    const previous = previousRows[0]?.event_type ?? null;
    if (previous === input.eventType) {
      return { attendanceState: input.eventType };
    }
    if (input.eventType === "revoked" && !previous) {
      throw new OpsOperatingRepositoryError("conflict", "There is no attendance mark to revoke.");
    }
    await tx`
      insert into experience_attendance_events (
        experience_id,
        registration_id,
        person_id,
        member_id,
        event_type,
        source,
        actor_auth_user_id,
        evidence,
        dedupe_key
      ) values (
        ${experienceId}::uuid,
        ${registrationId}::uuid,
        ${registration.person_id}::uuid,
        ${registration.member_id}::uuid,
        ${input.eventType},
        'ops',
        ${access.authUserId}::uuid,
        jsonb_build_object('reason', ${reason}::text),
        ${randomUUID()}
      )
    `;
    await writeOperatorAudit(tx, {
      action: `experience.attendance_${input.eventType}`,
      actorAuthUserId: access.authUserId,
      after: { state: input.eventType },
      before: previous ? { state: previous } : undefined,
      memberId: registration.member_id,
      metadata: { experienceId },
      reason,
      subjectId: registrationId,
      subjectType: "experience_attendance",
    });
    return { attendanceState: input.eventType };
  });
}
