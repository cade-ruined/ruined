import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type postgres from "postgres";

import { getApplicationDatabase } from "@/lib/database/server";
import {
  cancelGoogleCalendarEvent,
  createGoogleCalendarEvent,
  getGoogleCalendarConfigurationStatus,
  getRuinedOwnedGoogleCalendarEventResult,
  GoogleCalendarApiError,
  GoogleCalendarConflictError,
  updateGoogleCalendarEvent,
} from "@/lib/google/calendar";
import { googleCalendarEventIdForRequestKey, type GoogleCalendarEventResult } from "@/lib/google/calendar-model";
import { googleCommunicationLivemode } from "@/lib/google/communications";
import type { OpsExperienceCalendarState } from "@/lib/platform/ops-experience-model";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";
import { memberEligibleForExperience } from "@/lib/platform/experience-member-access";
import { SITE_URL } from "@/lib/site";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{15,199}$/;

type CalendarIntent = "cancel" | "create" | "sync";
type CalendarPendingReason = "attendees" | "cancel" | "experience" | "publish";

type CalendarExperience = {
  cancelled_at: Date | string | null;
  block_id: string | null;
  circle_id: string | null;
  details: string | null;
  ends_at: Date | string;
  experience_id: string;
  location_label: string | null;
  starts_at: Date | string;
  state: string;
  summary: string | null;
  timezone: string;
  title: string;
  version: number;
  visibility: "all_members" | "block" | "circle" | "invite_only" | "public";
};

type CalendarAttendee = {
  assignmentSource: "all_active_members" | "block" | "circle" | "registration";
  displayName: string;
  email: string;
  memberId: string | null;
  personId: string;
  registrationId: string | null;
};

type CalendarLinkRow = {
  livemode: boolean | null;
  reconcile_attempt_count: number;
  next_reconcile_at: Date | string;
  current_sync_request_id: string | null;
  desired_attendee_revision: number;
  desired_experience_version: number;
  id: string;
  last_failed_at: Date | string | null;
  last_failure_code: string | null;
  last_synced_at: Date | string | null;
  meet_url: string | null;
  organizer_calendar_id: string;
  organizer_email: string;
  provider_event_etag: string | null;
  provider_event_id: string | null;
  provider_html_url: string | null;
  status: "active" | "cancelled" | "failed" | "pending_cancel" | "pending_create" | "pending_update";
  synced_attendee_revision: number | null;
  synced_experience_version: number | null;
  version: number;
};

type CalendarSnapshot = {
  attendees: CalendarAttendee[];
  description: string | null;
  end: string;
  location: string | null;
  sourceUrl: string;
  start: string;
  summary: string;
  timezone: string;
};

type ReservedSync = {
  action: "cancel" | "create" | "update";
  actorKind: "member" | "operator" | "worker";
  actorAuthUserId: string;
  livemode: boolean;
  organizerEmail: string;
  calendarId: string;
  recoverExistingCreate: boolean;
  attemptNumber: number;
  attendees: CalendarAttendee[];
  calendarLinkId: string;
  desiredAttendeeRevision: number;
  desiredExperienceVersion: number;
  expectedEtag: string | null;
  providerEventId: string | null;
  providerRequestKey: string;
  previousAttendees: CalendarAttendee[];
  requestId: string;
  snapshot: CalendarSnapshot;
};

type RecoverableCalendarRequestRow = {
  action: "cancel" | "create" | "reconcile" | "update";
  actor_auth_user_id: string | null;
  attempt_count: number;
  conference_request_key: string | null;
  desired_attendee_revision: number;
  desired_experience_version: number;
  event_snapshot: CalendarSnapshot;
  id: string;
  last_attempt_at: Date | string | null;
  status: "failed" | "processing" | "queued" | "succeeded" | "superseded";
};

function requireUuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} is invalid.`);
  }
  return normalized;
}

function requireRequestKey(value: string): string {
  const normalized = value.trim();
  if (!REQUEST_KEY_PATTERN.test(normalized)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Calendar request key is invalid.");
  }
  return normalized;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeFailureCopy(code: string | null): string | null {
  if (!code) return null;
  if (code === "calendar_conflict") return "The Google event changed elsewhere. Sync it again.";
  if (code === "calendar_not_found") return "The Google event could not be found. Create a new Experience if it was removed.";
  if (code === "calendar_meet_failed") return "The invitation was saved, but Google Meet could not be created. Sync it again.";
  if (code === "calendar_meet_pending") return "The invitation was saved while Google finishes creating its Meet room. Sync it again if this remains.";
  if (code === "calendar_organizer_mismatch") return "Google returned a different organizer account. Check the Workspace connection.";
  return "The last Google Calendar request did not finish. It is safe to try again.";
}

function calendarStatus(row: CalendarLinkRow | undefined): OpsExperienceCalendarState["status"] {
  if (!row) return "not_created";
  if (row.status === "active") return "synced";
  return row.status;
}

async function requireCalendarOperator(
  tx: postgres.TransactionSql,
  actorAuthUserIdValue: string,
  experienceId: string,
  lock = false,
): Promise<string> {
  const actorAuthUserId = requireUuid(actorAuthUserIdValue, "Operator identity");
  const rows = await tx<Array<{ allowed: boolean }>>`
    select exists (
      select 1
      from platform_users platform_user
      join platform_role_grants role_grant
        on role_grant.auth_user_id = platform_user.auth_user_id
       and role_grant.revoked_at is null
      left join experiences experience on experience.id = ${experienceId}::uuid
      where platform_user.auth_user_id = ${actorAuthUserId}::uuid
        and platform_user.status = 'active'
        and role_grant.role_slug in ('ops_admin', 'guide', 'circle_leader')
        and (
          role_grant.role_slug = 'ops_admin'
          or (
            experience.circle_id is not null
            and exists (
              select 1
              from circle_staff_assignments staff_assignment
              where staff_assignment.circle_id = experience.circle_id
                and staff_assignment.auth_user_id = platform_user.auth_user_id
                and staff_assignment.ended_at is null
                and staff_assignment.role_slug = role_grant.role_slug
            )
          )
        )
    ) as allowed
  `;
  if (!rows[0]?.allowed) {
    throw new OpsOperatingRepositoryError(
      "forbidden",
      "This Experience is outside the operator's current assignment.",
    );
  }
  if (lock) {
    await tx`
      select auth_user_id
      from platform_users
      where auth_user_id = ${actorAuthUserId}::uuid
      for update
    `;
  }
  return actorAuthUserId;
}

async function requireCalendarMemberSyncActor(
  tx: postgres.TransactionSql,
  actorAuthUserIdValue: string,
  experienceId: string,
  expectedRegistrationStatus: "cancelled" | "registered",
  lock = false,
): Promise<string> {
  const actorAuthUserId = requireUuid(actorAuthUserIdValue, "Member identity");
  const rows = await tx<Array<{ allowed: boolean }>>`
    select exists (
      select 1
      from platform_users platform_user
      join platform_role_grants role_grant
        on role_grant.auth_user_id = platform_user.auth_user_id
       and role_grant.role_slug = 'member'
       and role_grant.revoked_at is null
      join ruined_members member on member.person_id = platform_user.person_id
      join member_lifecycle lifecycle on lifecycle.member_id = member.id
      join experience_registrations registration
        on registration.experience_id = ${experienceId}::uuid
       and registration.person_id = member.person_id
       and registration.member_id = member.id
      where platform_user.auth_user_id = ${actorAuthUserId}::uuid
        and platform_user.status = 'active'
        and lifecycle.account_state = 'active'
        and lifecycle.billing_state = 'active'
        and lifecycle.standing_state in ('active', 'cancellation_requested')
        and registration.status = ${expectedRegistrationStatus}
    ) as allowed
  `;
  if (!rows[0]?.allowed) {
    throw new OpsOperatingRepositoryError(
      "forbidden",
      "This member registration cannot change that Calendar audience.",
    );
  }
  if (lock) {
    await tx`
      select auth_user_id
      from platform_users
      where auth_user_id = ${actorAuthUserId}::uuid
      for update
    `;
  }
  return actorAuthUserId;
}

async function getCalendarExperience(
  tx: postgres.TransactionSql,
  experienceId: string,
  lock = false,
): Promise<CalendarExperience> {
  const rows = lock
    ? await tx<CalendarExperience[]>`
        select
          id as experience_id,
          title,
          summary,
          details,
          starts_at,
          coalesce(ends_at, starts_at + interval '1 hour') as ends_at,
          timezone,
          location_label,
          visibility,
          circle_id,
          block_id,
          status as state,
          cancelled_at,
          version::int
        from experiences
        where id = ${experienceId}::uuid
        for update
      `
    : await tx<CalendarExperience[]>`
        select
          id as experience_id,
          title,
          summary,
          details,
          starts_at,
          coalesce(ends_at, starts_at + interval '1 hour') as ends_at,
          timezone,
          location_label,
          visibility,
          circle_id,
          block_id,
          status as state,
          cancelled_at,
          version::int
        from experiences
        where id = ${experienceId}::uuid
      `;
  const experience = rows[0];
  if (!experience) throw new OpsOperatingRepositoryError("not_found", "Experience not found.");
  return experience;
}

async function resolveCalendarAttendees(
  tx: postgres.TransactionSql,
  experience: CalendarExperience,
): Promise<CalendarAttendee[]> {
  const organizerEmail = getGoogleCalendarConfigurationStatus().organizerEmail;
  const rows = await tx<Array<{
    assignment_source: CalendarAttendee["assignmentSource"];
    display_name: string;
    email: string;
    member_id: string | null;
    person_id: string;
    registration_id: string | null;
  }>>`
    with member_audience as (
      select
        member.id as member_id,
        member.person_id,
        registration.id as registration_id,
        email_address.email_normalized as email,
        coalesce(profile.preferred_name, profile.display_name, 'Member') as display_name,
        case
          when registration.status = 'registered' then 'registration'
          when ${experience.visibility} = 'circle' then 'circle'
          when ${experience.visibility} = 'block' then 'block'
          else 'all_active_members'
        end as assignment_source
      from ruined_members member
      join people person on person.id = member.person_id and person.status = 'active'
      join member_lifecycle lifecycle on lifecycle.member_id = member.id
      join platform_users platform_user
        on platform_user.person_id = member.person_id
       and platform_user.status = 'active'
      join platform_role_grants role_grant
        on role_grant.auth_user_id = platform_user.auth_user_id
       and role_grant.role_slug = 'member'
       and role_grant.revoked_at is null
      join person_email_addresses email_address
        on email_address.person_id = member.person_id
       and email_address.is_primary
       and email_address.retired_at is null
       and email_address.verification_state = 'verified'
      left join person_profiles profile on profile.person_id = member.person_id
      left join experience_registrations registration
        on registration.experience_id = ${experience.experience_id}::uuid
       and registration.person_id = member.person_id
      left join circle_member_assignments circle_assignment
        on circle_assignment.member_id = member.id
       and circle_assignment.ended_at is null
      left join block_circle_assignments block_assignment
        on block_assignment.circle_id = circle_assignment.circle_id
       and block_assignment.ended_at is null
      where ${experience.visibility} in ('circle', 'block', 'all_members')
        and lifecycle.account_state = 'active'
        and lifecycle.billing_state = 'active'
        and lifecycle.administrative_onboarding_state = 'completed'
        and lifecycle.standing_state in ('active', 'cancellation_requested')
        and (
          lifecycle.standing_state = 'active'
          or lifecycle.cancellation_effective_at > statement_timestamp()
        )
        and (
          (${experience.visibility} = 'circle' and circle_assignment.circle_id = ${experience.circle_id}::uuid)
          or (${experience.visibility} = 'block' and block_assignment.block_id = ${experience.block_id}::uuid)
          or (${experience.visibility} = 'all_members')
        )
        and (registration.status is null or registration.status = 'registered')
    ),
    registration_audience as (
      select
        member.id as member_id,
        registration.person_id,
        registration.id as registration_id,
        email_address.email_normalized as email,
        coalesce(profile.preferred_name, profile.display_name, 'Guest') as display_name,
        'registration' as assignment_source
      from experience_registrations registration
      join people person
        on person.id = registration.person_id
       and person.status = 'active'
      join person_email_addresses email_address
        on email_address.person_id = registration.person_id
       and email_address.is_primary
       and email_address.retired_at is null
       and email_address.verification_state = 'verified'
      left join ruined_members member on member.person_id = registration.person_id
      left join person_profiles profile on profile.person_id = registration.person_id
      where ${experience.visibility} in ('public', 'invite_only')
        and registration.experience_id = ${experience.experience_id}::uuid
        and registration.status = 'registered'
    ),
    audience as (
      select * from member_audience
      union all
      select * from registration_audience
    )
    select distinct on (audience.email)
      audience.member_id,
      audience.person_id,
      audience.registration_id,
      audience.email,
      audience.display_name,
      audience.assignment_source
    from audience
    where ${organizerEmail}::text is null
       or audience.email <> ${organizerEmail}
    order by audience.email, audience.member_id nulls last, audience.person_id
  `;
  const eligible = [];
  for (const row of rows) {
    if (row.member_id && !(await memberEligibleForExperience(tx, experience, row.member_id))) continue;
    eligible.push(row);
  }
  return eligible.map((row) => ({
    assignmentSource: row.assignment_source,
    displayName: row.display_name,
    email: row.email,
    memberId: row.member_id,
    personId: row.person_id,
    registrationId: row.registration_id,
  }));
}

async function getCalendarLink(
  tx: postgres.TransactionSql,
  experienceId: string,
  lock = false,
): Promise<CalendarLinkRow | undefined> {
  const rows = lock
    ? await tx<CalendarLinkRow[]>`
        select
          id,
          livemode,
          reconcile_attempt_count,
          next_reconcile_at,
          current_sync_request_id,
          organizer_email,
          organizer_calendar_id,
          provider_event_id,
          provider_event_etag,
          provider_html_url,
          meet_url,
          status,
          desired_experience_version::int,
          synced_experience_version::int,
          desired_attendee_revision::int,
          synced_attendee_revision::int,
          last_synced_at,
          last_failed_at,
          last_failure_code,
          version::int
        from experience_calendar_links
        where experience_id = ${experienceId}::uuid and provider = 'google'
        for update
      `
    : await tx<CalendarLinkRow[]>`
        select
          id,
          livemode,
          reconcile_attempt_count,
          next_reconcile_at,
          current_sync_request_id,
          organizer_email,
          organizer_calendar_id,
          provider_event_id,
          provider_event_etag,
          provider_html_url,
          meet_url,
          status,
          desired_experience_version::int,
          synced_experience_version::int,
          desired_attendee_revision::int,
          synced_attendee_revision::int,
          last_synced_at,
          last_failed_at,
          last_failure_code,
          version::int
        from experience_calendar_links
        where experience_id = ${experienceId}::uuid and provider = 'google'
      `;
  return rows[0];
}

export async function getOpsExperienceCalendarStateForTx(
  tx: postgres.TransactionSql,
  experienceIdValue: string,
): Promise<OpsExperienceCalendarState> {
  const experienceId = requireUuid(experienceIdValue, "Experience");
  const configuration = getGoogleCalendarConfigurationStatus();
  const experience = await getCalendarExperience(tx, experienceId);
  const [link, attendees] = await Promise.all([
    getCalendarLink(tx, experienceId),
    resolveCalendarAttendees(tx, experience),
  ]);
  const organizerMatches = !link || (
    configuration.organizerEmail === link.organizer_email
    && configuration.calendarId === link.organizer_calendar_id
  );
  const mode = googleCommunicationLivemode();
  const modeMatches = mode !== null && (!link || link.livemode === mode);
  const automaticDeliveryPaused = experience.state === "published"
    && new Date(experience.ends_at).getTime() <= Date.now()
    && Boolean(link && ["pending_create", "pending_update", "failed"].includes(link.status));
  return {
    attendeeCount: attendees.length,
    configured: configuration.ready && organizerMatches && modeMatches,
    bindingRequired: Boolean(link && link.livemode === null),
    bindingMode: mode === null ? null : mode ? "live" : "test",
    canSendCancellation: Boolean(experience.cancelled_at && ["cancelled", "archived"].includes(experience.state)),
    automaticDeliveryPaused,
    googleEventId: link?.provider_event_id ?? null,
    googleEventUrl: link?.provider_html_url ?? null,
    lastError: !modeMatches
      ? "Calendar delivery mode needs review. An administrator must verify the existing Google organizer and explicitly bind this invitation to test or live before it can send."
      : organizerMatches
      ? automaticDeliveryPaused
        ? "This event has ended. Automatic Calendar delivery is paused; review the invitation before choosing an explicit Calendar action."
        : safeFailureCopy(link?.last_failure_code ?? null)
      : "The configured Google organizer does not match this existing invitation.",
    lastSyncedAt: asIso(link?.last_synced_at),
    meetingUrl: link?.meet_url ?? null,
    organizerEmail: configuration.organizerEmail,
    status: calendarStatus(link),
  };
}

export async function markOpsExperienceCalendarPending(
  tx: postgres.TransactionSql,
  input: {
    actorAuthUserId: string;
    experienceId: string;
    reason: CalendarPendingReason;
  },
): Promise<boolean> {
  const actorAuthUserId = requireUuid(input.actorAuthUserId, "Operator identity");
  const experienceId = requireUuid(input.experienceId, "Experience");
  const configuration = getGoogleCalendarConfigurationStatus();
  const mode = googleCommunicationLivemode();
  // Publishing is the authorization to invite. Create the durable intent in
  // this same transaction, not in a browser request after the save succeeds.
  if (input.reason === "publish" && mode !== null && configuration.ready) {
    await tx`
      insert into experience_calendar_links (
        experience_id, organizer_email, organizer_calendar_id, livemode,
        desired_experience_version, created_by_auth_user_id, updated_by_auth_user_id
      )
      select id, ${configuration.organizerEmail}, ${configuration.calendarId}, ${mode},
        version, ${actorAuthUserId}::uuid, ${actorAuthUserId}::uuid
      from experiences where id = ${experienceId}::uuid and status = 'published'
        and coalesce(ends_at, starts_at + interval '1 hour') > statement_timestamp()
      on conflict (experience_id, provider) do nothing
    `;
  }
  const rows = await tx<Array<{ id: string }>>`
    update experience_calendar_links calendar_link
    set
      status = case
        when ${input.reason} = 'cancel' and calendar_link.provider_event_id is not null
          then 'pending_cancel'
        when calendar_link.provider_event_id is null then 'pending_create'
        else 'pending_update'
      end,
      desired_experience_version = experience.version,
      desired_attendee_revision = calendar_link.desired_attendee_revision
        + case when ${input.reason} = 'attendees' then 1 else 0 end,
      reconcile_attempt_count = 0,
      next_reconcile_at = statement_timestamp(),
      updated_by_auth_user_id = ${actorAuthUserId}::uuid,
      version = calendar_link.version + 1,
      updated_at = statement_timestamp()
    from experiences experience
    where calendar_link.experience_id = ${experienceId}::uuid
      and experience.id = calendar_link.experience_id
      and calendar_link.provider = 'google'
      and calendar_link.status <> 'cancelled'
    returning calendar_link.id
  `;
  return rows.length > 0;
}

function eventSourceUrl(experienceId: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const base = configured?.startsWith("https://") ? configured.replace(/\/$/, "") : SITE_URL;
  return `${base}/my/experiences#experience-${encodeURIComponent(experienceId)}`;
}

function eventSnapshot(
  experience: CalendarExperience,
  attendees: CalendarAttendee[],
): CalendarSnapshot {
  return {
    attendees,
    description: experience.details ?? experience.summary,
    end: asIso(experience.ends_at)!,
    location: experience.location_label,
    sourceUrl: eventSourceUrl(experience.experience_id),
    start: asIso(experience.starts_at)!,
    summary: experience.title,
    timezone: experience.timezone,
  };
}

function providerRequestKey(
  action: ReservedSync["action"],
  experienceId: string,
  experienceVersion: number,
  attendeeRevision: number,
): string {
  return action === "create"
    ? `experience:${experienceId}:calendar:create:v1`
    : `experience:${experienceId}:calendar:${action}:v${experienceVersion}:a${attendeeRevision}`;
}

async function previousCalendarAttendees(
  tx: postgres.TransactionSql,
  calendarLinkId: string,
): Promise<CalendarAttendee[]> {
  const rows = await tx<Array<{
    assignment_source: CalendarAttendee["assignmentSource"];
    display_name: string;
    email: string;
    member_id: string | null;
    person_id: string;
    registration_id: string | null;
  }>>`
    select
      attendee ->> 'assignmentSource' as assignment_source,
      attendee ->> 'displayName' as display_name,
      attendee ->> 'email' as email,
      attendee ->> 'memberId' as member_id,
      attendee ->> 'personId' as person_id,
      nullif(attendee ->> 'registrationId', '') as registration_id
    from experience_calendar_sync_requests sync_request
    cross join lateral jsonb_array_elements(sync_request.event_snapshot -> 'attendees') attendee
    where sync_request.calendar_link_id = ${calendarLinkId}::uuid
      and sync_request.status = 'succeeded'
      and sync_request.action in ('create', 'update', 'reconcile')
      and sync_request.id = (
        select previous_request.id
        from experience_calendar_sync_requests previous_request
        where previous_request.calendar_link_id = ${calendarLinkId}::uuid
          and previous_request.status = 'succeeded'
          and previous_request.action in ('create', 'update', 'reconcile')
        order by previous_request.completed_at desc, previous_request.created_at desc
        limit 1
      )
    order by email
  `;
  return rows.map((row) => ({
    assignmentSource: row.assignment_source,
    displayName: row.display_name,
    email: row.email,
    memberId: row.member_id,
    personId: row.person_id,
    registrationId: row.registration_id,
  }));
}

function requestActionForIntent(intent: CalendarIntent): ReservedSync["action"] {
  return intent === "sync" ? "update" : intent;
}

function recoverableSnapshot(value: CalendarSnapshot): CalendarSnapshot {
  if (
    !value
    || !Array.isArray(value.attendees)
    || typeof value.summary !== "string"
    || typeof value.start !== "string"
    || typeof value.end !== "string"
    || typeof value.timezone !== "string"
    || typeof value.sourceUrl !== "string"
  ) {
    throw new OpsOperatingRepositoryError(
      "conflict",
      "The interrupted Calendar request needs operator review.",
    );
  }
  return value;
}

async function recoverStaleCalendarReservation(
  tx: postgres.TransactionSql,
  input: {
    actorAuthUserId: string;
    actorKind: "member" | "operator" | "worker";
    experienceId: string;
    intent: CalendarIntent;
    link: CalendarLinkRow;
  },
): Promise<ReservedSync | null> {
  if (!input.link.current_sync_request_id) return null;
  const requestRows = await tx<RecoverableCalendarRequestRow[]>`
    select
      sync_request.id,
      sync_request.action,
      sync_request.status,
      sync_request.attempt_count::int,
      sync_request.last_attempt_at,
      sync_request.conference_request_key,
      sync_request.desired_experience_version::int,
      sync_request.desired_attendee_revision::int,
      sync_request.event_snapshot,
      audit_event.actor_auth_user_id
    from experience_calendar_sync_requests sync_request
    join operator_audit_events audit_event
      on audit_event.id = sync_request.operator_audit_event_id
    where sync_request.id = ${input.link.current_sync_request_id}::uuid
    for update
  `;
  const request = requestRows[0];
  if (!request || !["queued", "processing"].includes(request.status)) return null;
  if (
    (input.actorKind !== "operator" && input.actorKind !== "worker")
    || request.status !== "processing"
    || (input.actorKind !== "worker" && (
      request.action !== requestActionForIntent(input.intent)
      || request.actor_auth_user_id !== input.actorAuthUserId
    ))
  ) {
    throw new OpsOperatingRepositoryError(
      "conflict",
      "A Calendar sync is already in progress for this Experience.",
    );
  }

  const reclaimed = await tx<Array<{ attempt_count: number }>>`
    update experience_calendar_sync_requests
    set
      status = 'queued',
      next_attempt_at = statement_timestamp(),
      last_error_code = 'calendar_attempt_interrupted',
      last_error_message = 'The prior request ended before its provider result was recorded.',
      version = version + 1,
      updated_at = statement_timestamp()
    where id = ${request.id}::uuid
      and status = 'processing'
      and last_attempt_at <= statement_timestamp() - interval '10 minutes'
    returning attempt_count::int
  `;
  if (!reclaimed[0]) {
    throw new OpsOperatingRepositoryError(
      "conflict",
      "A Calendar sync is already in progress for this Experience.",
    );
  }
  const attemptNumber = reclaimed[0].attempt_count + 1;
  // A cancellation supersedes an interrupted create/update. Cancel the same
  // deterministic event ID; never retry a create just to cancel it afterward.
  if (
    (input.actorKind === "worker" && input.intent === "cancel" && request.action !== "cancel")
    || input.link.desired_experience_version !== request.desired_experience_version
    || input.link.desired_attendee_revision !== request.desired_attendee_revision
  ) {
    await tx`
      update experience_calendar_sync_requests
      set status = 'superseded', completed_at = statement_timestamp(), next_attempt_at = null,
        version = version + 1, updated_at = statement_timestamp()
      where id = ${request.id}::uuid and status = 'queued'
    `;
    await tx`
      insert into experience_calendar_sync_events (sync_request_id, calendar_link_id, experience_id,
        event_type, actor_auth_user_id, dedupe_key, metadata)
      values (${request.id}::uuid, ${input.link.id}::uuid, ${input.experienceId}::uuid,
        'superseded', ${input.actorAuthUserId}::uuid, ${`${request.id}:superseded`},
        ${tx.json({ reason: "desired_state_changed", desiredExperienceVersion: input.link.desired_experience_version, desiredAttendeeRevision: input.link.desired_attendee_revision })})
    `;
    return null;
  }
  await tx`
    insert into experience_calendar_sync_events (
      sync_request_id,
      calendar_link_id,
      experience_id,
      event_type,
      attempt_number,
      failure_code,
      failure_message,
      actor_auth_user_id,
      dedupe_key,
      metadata
    ) values (
      ${request.id}::uuid,
      ${input.link.id}::uuid,
      ${input.experienceId}::uuid,
      'retry_scheduled',
      ${attemptNumber},
      'calendar_attempt_interrupted',
      'The prior request ended before its provider result was recorded.',
      ${input.actorAuthUserId}::uuid,
      ${`${request.id}:retry:${attemptNumber}:scheduled`},
      ${tx.json({ recovery: "stale_processing" })}
    )
  `;
  const started = await tx<Array<{ attempt_count: number }>>`
    update experience_calendar_sync_requests
    set
      status = 'processing',
      attempt_count = attempt_count + 1,
      last_attempt_at = statement_timestamp(),
      next_attempt_at = null,
      version = version + 1,
      updated_at = statement_timestamp()
    where id = ${request.id}::uuid and status = 'queued'
    returning attempt_count::int
  `;
  if (started[0]?.attempt_count !== attemptNumber) {
    throw new OpsOperatingRepositoryError(
      "conflict",
      "Calendar recovery changed before it could start.",
    );
  }
  await tx`
    insert into experience_calendar_sync_events (
      sync_request_id,
      calendar_link_id,
      experience_id,
      event_type,
      attempt_number,
      actor_auth_user_id,
      dedupe_key,
      metadata
    ) values (
      ${request.id}::uuid,
      ${input.link.id}::uuid,
      ${input.experienceId}::uuid,
      'attempt_started',
      ${attemptNumber},
      ${input.actorAuthUserId}::uuid,
      ${`${request.id}:attempt:${attemptNumber}`},
      ${tx.json({ action: request.action, recovery: "stale_processing" })}
    )
  `;

  const snapshot = recoverableSnapshot(request.event_snapshot);
  await tx`
    update experience_calendar_links
    set reconcile_attempt_count = reconcile_attempt_count + 1,
      next_reconcile_at = statement_timestamp() + interval '10 minutes',
      version = version + 1, updated_at = statement_timestamp()
    where id = ${input.link.id}::uuid
  `;
  return {
    action: request.action === "reconcile" ? "update" : request.action,
    actorKind: input.actorKind,
    actorAuthUserId: request.actor_auth_user_id!,
    livemode: input.link.livemode!,
    organizerEmail: input.link.organizer_email,
    calendarId: input.link.organizer_calendar_id,
    recoverExistingCreate: request.action === "create",
    attemptNumber,
    attendees: snapshot.attendees,
    calendarLinkId: input.link.id,
    desiredAttendeeRevision: request.desired_attendee_revision,
    desiredExperienceVersion: request.desired_experience_version,
    expectedEtag: input.link.provider_event_etag,
    providerEventId: input.link.provider_event_id,
    providerRequestKey: request.conference_request_key ?? providerRequestKey(
      request.action === "reconcile" ? "update" : request.action,
      input.experienceId,
      request.desired_experience_version,
      request.desired_attendee_revision,
    ),
    previousAttendees: await previousCalendarAttendees(tx, input.link.id),
    requestId: request.id,
    snapshot,
  };
}

async function reserveCalendarSync(input: {
  actorKind: "member" | "operator" | "worker";
  actorAuthUserId: string;
  expectedRegistrationStatus?: "cancelled" | "registered";
  experienceId: string;
  intent: CalendarIntent;
  requestKey: string;
}): Promise<ReservedSync | OpsExperienceCalendarState> {
  const configuration = getGoogleCalendarConfigurationStatus();
  const mode = googleCommunicationLivemode();
  if (!configuration.ready || mode === null) {
    throw new OpsOperatingRepositoryError(
      "conflict",
      "Connect the Ruined Google Workspace organizer before sending invitations.",
    );
  }
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${input.experienceId}), 49)`;
    const actorAuthUserId = input.actorKind === "worker"
      ? requireUuid(input.actorAuthUserId, "Original Calendar actor")
      : input.actorKind === "operator"
      ? await requireCalendarOperator(
          tx,
          input.actorAuthUserId,
          input.experienceId,
          true,
        )
      : await requireCalendarMemberSyncActor(
          tx,
          input.actorAuthUserId,
          input.experienceId,
          input.expectedRegistrationStatus ?? "registered",
          true,
        );
    if (input.actorKind === "member" && input.intent !== "sync") {
      throw new OpsOperatingRepositoryError(
        "forbidden",
        "Member registration can only reconcile an existing invitation.",
      );
    }
    const experience = await getCalendarExperience(tx, input.experienceId, true);
    if (input.intent === "cancel" && experience.state !== "cancelled" && !(experience.state === "archived" && experience.cancelled_at)) {
      throw new OpsOperatingRepositoryError("conflict", "Cancel the Experience before sending its Calendar cancellation.");
    }
    if (input.intent !== "cancel" && experience.state !== "published") {
      throw new OpsOperatingRepositoryError("conflict", "Publish the Experience before sending invitations.");
    }
    if (input.actorKind !== "operator" && input.intent !== "cancel" && new Date(experience.ends_at).getTime() <= Date.now()) {
      throw new OpsOperatingRepositoryError("conflict", "This event has ended. Automatic Calendar delivery is paused for operator review.");
    }

    const attendees = await resolveCalendarAttendees(tx, experience);
    const snapshot = eventSnapshot(experience, attendees);
    const attendeeSetSha256 = sha256(JSON.stringify(attendees));
    const requestFingerprint = sha256(JSON.stringify({ intent: input.intent, snapshot }));
    const priorRequests = await tx<Array<{
      request_fingerprint: string;
      status: string;
    }>>`
      select request_fingerprint, status
      from experience_calendar_sync_requests
      where request_key = ${input.requestKey}
      for update
    `;
    const prior = priorRequests[0];
    if (prior) {
      if (prior.request_fingerprint !== requestFingerprint) {
        throw new OpsOperatingRepositoryError(
          "conflict",
          "That Calendar request key was already used for a different change.",
        );
      }
      if (prior.status === "succeeded") {
        return getOpsExperienceCalendarStateForTx(tx, input.experienceId);
      }
      throw new OpsOperatingRepositoryError(
        "conflict",
        prior.status === "processing" || prior.status === "queued"
          ? "That Calendar request is still being processed."
          : "That Calendar attempt ended. Try again to create a new request.",
      );
    }

    let link = await getCalendarLink(tx, input.experienceId, true);
    if (link && (link.livemode !== mode
      || link.organizer_email !== configuration.organizerEmail
      || link.organizer_calendar_id !== configuration.calendarId)) {
      throw new OpsOperatingRepositoryError("conflict", "This Calendar invitation needs verified delivery-mode and organizer binding before it can send. No new event was created.");
    }
    if (input.actorKind === "worker" && (!link || ["active", "cancelled"].includes(link.status))) {
      return getOpsExperienceCalendarStateForTx(tx, input.experienceId);
    }
    if (input.actorKind === "worker" && link && new Date(link.next_reconcile_at).getTime() > Date.now()) {
      throw new OpsOperatingRepositoryError("conflict", "Calendar reconciliation is waiting for its retry time.");
    }
    if (
      input.actorKind === "member"
      && (!link?.provider_event_id || link.status === "cancelled")
    ) {
      return getOpsExperienceCalendarStateForTx(tx, input.experienceId);
    }
    if (link?.current_sync_request_id) {
      const recovered = await recoverStaleCalendarReservation(tx, {
        actorAuthUserId,
        actorKind: input.actorKind,
        experienceId: input.experienceId,
        intent: input.intent,
        link,
      });
      if (recovered) return recovered;
    }
    const previousAttendees = link
      ? await previousCalendarAttendees(tx, link.id)
      : [];
    const action: ReservedSync["action"] = input.intent === "sync" ? "update" : input.intent;
    if (action === "cancel" && link && !link.provider_event_id) {
      link.provider_event_id = googleCalendarEventIdForRequestKey(providerRequestKey("create", input.experienceId, 1, 1));
    }
    if (action === "create" && link?.provider_event_id) {
      throw new OpsOperatingRepositoryError("conflict", "This Experience already has a Google Calendar event. Sync it instead.");
    }
    if (action !== "create" && !link?.provider_event_id) {
      throw new OpsOperatingRepositoryError("conflict", "This Experience does not have a Google Calendar event yet.");
    }
    if (
      link
      && (
        link.organizer_email !== configuration.organizerEmail
        || link.organizer_calendar_id !== configuration.calendarId
      )
    ) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "The configured organizer account does not match this Experience.",
      );
    }

    if (!link) {
      const inserted = await tx<CalendarLinkRow[]>`
        insert into experience_calendar_links (
          experience_id,
          organizer_email,
          organizer_calendar_id,
          livemode,
          status,
          desired_experience_version,
          desired_attendee_revision,
          created_by_auth_user_id,
          updated_by_auth_user_id
        ) values (
          ${input.experienceId}::uuid,
          ${configuration.organizerEmail},
          ${configuration.calendarId},
          ${mode},
          'pending_create',
          ${experience.version},
          1,
          ${actorAuthUserId}::uuid,
          ${actorAuthUserId}::uuid
        )
        returning
          id,
          livemode,
          reconcile_attempt_count,
          next_reconcile_at,
          current_sync_request_id,
          organizer_email,
          organizer_calendar_id,
          provider_event_id,
          provider_event_etag,
          provider_html_url,
          meet_url,
          status,
          desired_experience_version::int,
          synced_experience_version::int,
          desired_attendee_revision::int,
          synced_attendee_revision::int,
          last_synced_at,
          last_failed_at,
          last_failure_code,
          version::int
      `;
      link = inserted[0]!;
    } else {
      const nextStatus = action === "cancel"
        ? "pending_cancel"
        : link.provider_event_id
          ? "pending_update"
          : "pending_create";
      const updated = await tx<CalendarLinkRow[]>`
        update experience_calendar_links
        set
          status = ${nextStatus},
          provider_event_id = ${link.provider_event_id},
          desired_experience_version = ${experience.version},
          reconcile_attempt_count = reconcile_attempt_count + 1,
          next_reconcile_at = statement_timestamp() + interval '10 minutes',
          updated_by_auth_user_id = ${actorAuthUserId}::uuid,
          version = version + 1,
          updated_at = statement_timestamp()
        where id = ${link.id}::uuid and version = ${link.version}
        returning
          id,
          livemode,
          reconcile_attempt_count,
          next_reconcile_at,
          current_sync_request_id,
          organizer_email,
          organizer_calendar_id,
          provider_event_id,
          provider_event_etag,
          provider_html_url,
          meet_url,
          status,
          desired_experience_version::int,
          synced_experience_version::int,
          desired_attendee_revision::int,
          synced_attendee_revision::int,
          last_synced_at,
          last_failed_at,
          last_failure_code,
          version::int
      `;
      link = updated[0];
      if (!link) throw new OpsOperatingRepositoryError("conflict", "Calendar state changed. Refresh and try again.");
    }

    const auditRows = await tx<Array<{ id: number | string }>>`
      insert into operator_audit_events (
        actor_auth_user_id,
        action,
        subject_type,
        subject_id,
        request_id,
        after_snapshot,
        metadata,
        dedupe_key
      ) values (
        ${actorAuthUserId}::uuid,
        ${`experience.calendar_${action}_requested`},
        'experience',
        ${input.experienceId},
        ${input.requestKey},
        ${tx.json({ action, attendeeCount: attendees.length })},
        ${tx.json({ sendUpdates: "all" })},
        ${`calendar:${input.requestKey}`}
      )
      returning id
    `;
    const requestId = randomUUID();
    const logicalProviderRequestKey = providerRequestKey(
      action,
      input.experienceId,
      experience.version,
      link.desired_attendee_revision,
    );
    const previousCreateRows = action === "create"
      ? await tx<Array<{ exists: boolean }>>`
          select exists (
            select 1 from experience_calendar_sync_requests
            where calendar_link_id = ${link.id}::uuid and action = 'create'
          ) as exists
        `
      : [];
    await tx`
      insert into experience_calendar_sync_requests (
        id,
        calendar_link_id,
        experience_id,
        operator_audit_event_id,
        action,
        request_key,
        request_fingerprint,
        conference_request_key,
        expected_link_version,
        desired_experience_version,
        desired_attendee_revision,
        attendee_set_sha256,
        event_snapshot,
        attendee_count,
        send_updates,
        status
      ) values (
        ${requestId}::uuid,
        ${link.id}::uuid,
        ${input.experienceId}::uuid,
        ${auditRows[0]!.id},
        ${action},
        ${input.requestKey},
        ${requestFingerprint},
        ${action === "create" && !previousCreateRows[0]?.exists ? logicalProviderRequestKey : null},
        ${link.version},
        ${experience.version},
        ${link.desired_attendee_revision},
        ${attendeeSetSha256},
        ${tx.json(snapshot)},
        ${attendees.length},
        'all',
        'queued'
      )
    `;
    await tx`
      insert into experience_calendar_sync_events (
        sync_request_id,
        calendar_link_id,
        experience_id,
        event_type,
        actor_auth_user_id,
        dedupe_key,
        metadata
      ) values (
        ${requestId}::uuid,
        ${link.id}::uuid,
        ${input.experienceId}::uuid,
        'requested',
        ${actorAuthUserId}::uuid,
        ${`${requestId}:requested`},
        ${tx.json({ attendeeCount: attendees.length, action })}
      )
    `;
    await tx`
      update experience_calendar_sync_requests
      set
        status = 'processing',
        attempt_count = attempt_count + 1,
        last_attempt_at = statement_timestamp(),
        version = version + 1,
        updated_at = statement_timestamp()
      where id = ${requestId}::uuid and status = 'queued'
    `;
    await tx`
      insert into experience_calendar_sync_events (
        sync_request_id,
        calendar_link_id,
        experience_id,
        event_type,
        attempt_number,
        actor_auth_user_id,
        dedupe_key,
        metadata
      ) values (
        ${requestId}::uuid,
        ${link.id}::uuid,
        ${input.experienceId}::uuid,
        'attempt_started',
        1,
        ${actorAuthUserId}::uuid,
        ${`${requestId}:attempt:1`},
        ${tx.json({ action })}
      )
    `;
    await tx`
      update experience_calendar_links
      set
        current_sync_request_id = ${requestId}::uuid,
        updated_by_auth_user_id = ${actorAuthUserId}::uuid,
        version = version + 1,
        updated_at = statement_timestamp()
      where id = ${link.id}::uuid and version = ${link.version}
    `;

    return {
      action,
      actorKind: input.actorKind,
      actorAuthUserId,
      livemode: mode,
      organizerEmail: configuration.organizerEmail!,
      calendarId: configuration.calendarId!,
      recoverExistingCreate: action === "create" && Boolean(previousCreateRows[0]?.exists),
      attemptNumber: 1,
      attendees,
      calendarLinkId: link.id,
      desiredAttendeeRevision: link.desired_attendee_revision,
      desiredExperienceVersion: experience.version,
      expectedEtag: link.provider_event_etag,
      providerEventId: link.provider_event_id,
      providerRequestKey: logicalProviderRequestKey,
      previousAttendees,
      requestId,
      snapshot,
    };
  });
}

function googleDraft(reservation: ReservedSync) {
  return {
    attendees: reservation.attendees.map((attendee) => ({
      displayName: attendee.displayName,
      email: attendee.email,
    })),
    description: reservation.snapshot.description,
    end: {
      dateTime: reservation.snapshot.end,
      timeZone: reservation.snapshot.timezone,
    },
    location: reservation.snapshot.location,
    requestKey: reservation.providerRequestKey,
    sourceUrl: reservation.snapshot.sourceUrl,
    start: {
      dateTime: reservation.snapshot.start,
      timeZone: reservation.snapshot.timezone,
    },
    summary: reservation.snapshot.summary,
  };
}

function conferenceId(meetUrl: string | null): string | null {
  if (!meetUrl) return null;
  try {
    const url = new URL(meetUrl);
    return url.hostname === "meet.google.com" ? url.pathname.replace(/^\//, "") || null : null;
  } catch {
    return null;
  }
}

function attendeeMutations(reservation: ReservedSync): Array<{
  action: "add" | "remove" | "update";
  attendee: CalendarAttendee;
}> {
  const previous = new Map(
    reservation.previousAttendees.map((attendee) => [attendee.email, attendee]),
  );
  const current = new Map(
    reservation.attendees.map((attendee) => [attendee.email, attendee]),
  );
  if (reservation.action === "cancel") {
    return [...(previous.size ? previous.values() : current.values())]
      .map((attendee) => ({ action: "remove" as const, attendee }));
  }
  if (reservation.action === "create") {
    return [...current.values()].map((attendee) => ({ action: "add" as const, attendee }));
  }
  return [
    ...[...current.values()].map((attendee) => ({
      action: previous.has(attendee.email) ? "update" as const : "add" as const,
      attendee,
    })),
    ...[...previous.values()]
      .filter((attendee) => !current.has(attendee.email))
      .map((attendee) => ({ action: "remove" as const, attendee })),
  ];
}

async function finalizeCalendarSuccess(
  input: {
    actorAuthUserId: string;
    experienceId: string;
    reservation: ReservedSync;
    result: GoogleCalendarEventResult | null;
  },
): Promise<OpsExperienceCalendarState> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${input.experienceId}), 49)`;
    const actorAuthUserId = requireUuid(input.actorAuthUserId, "Calendar actor");
    const requestRows = await tx<Array<{
      actor_auth_user_id: string;
      attempt_count: number;
      status: string;
    }>>`
      select audit_event.actor_auth_user_id, sync_request.status, sync_request.attempt_count::int
      from experience_calendar_sync_requests sync_request
      join operator_audit_events audit_event
        on audit_event.id = sync_request.operator_audit_event_id
      where sync_request.id = ${input.reservation.requestId}::uuid
      for update
    `;
    if (requestRows[0]?.actor_auth_user_id !== actorAuthUserId) {
      throw new OpsOperatingRepositoryError(
        "forbidden",
        "That Calendar result belongs to a different authorized request.",
      );
    }
    if (requestRows[0]?.status === "succeeded") {
      return getOpsExperienceCalendarStateForTx(tx, input.experienceId);
    }
    if (requestRows[0]?.status !== "processing" || requestRows[0]?.attempt_count !== input.reservation.attemptNumber) {
      throw new OpsOperatingRepositoryError("conflict", "That Calendar request is no longer active.");
    }
    const link = await getCalendarLink(tx, input.experienceId, true);
    if (!link || link.id !== input.reservation.calendarLinkId) {
      throw new OpsOperatingRepositoryError("conflict", "Calendar state changed before it could be recorded.");
    }
    const providerEventId = input.result?.eventId ?? input.reservation.providerEventId;
    if (!providerEventId) throw new Error("Google Calendar returned no event identity.");
    const cancelled = input.reservation.action === "cancel";
    if (
      input.result
      && (
        !input.result.organizerVerified
        || input.result.organizerEmail?.trim().toLowerCase() !== link.organizer_email
      )
    ) {
      const organizerError = new Error("Google returned a different Calendar organizer.");
      organizerError.name = "GoogleCalendarOrganizerMismatchError";
      throw organizerError;
    }
    const isCurrent =
      link.current_sync_request_id === input.reservation.requestId
      && link.desired_experience_version === input.reservation.desiredExperienceVersion
      && link.desired_attendee_revision === input.reservation.desiredAttendeeRevision;
    const conferenceReady = cancelled || Boolean(input.result?.meetReady);
    const conferenceFailureCode = input.result?.conferenceStatus === "failure"
      ? "calendar_meet_failed"
      : "calendar_meet_pending";
    const linkStatus = cancelled
      ? isCurrent ? "cancelled" : "pending_cancel"
      : isCurrent && conferenceReady ? "active" : "pending_update";
    await tx`
      update experience_calendar_links
      set
        provider_event_id = ${providerEventId},
        provider_event_etag = ${input.result?.etag ?? link.provider_event_etag},
        provider_ical_uid = ${input.result?.iCalUid ?? null},
        provider_html_url = ${input.result?.htmlUrl ?? link.provider_html_url},
        provider_conference_id = ${input.result?.conferenceId ?? conferenceId(input.result?.meetUrl ?? link.meet_url)},
        meet_url = ${input.result?.meetUrl ?? link.meet_url},
        status = ${linkStatus},
        reconcile_attempt_count = case when ${isCurrent && conferenceReady} then 0 else reconcile_attempt_count end,
        next_reconcile_at = statement_timestamp()
          + case when ${isCurrent && !conferenceReady} then interval '1 minute' else interval '0 seconds' end,
        synced_experience_version = ${input.reservation.desiredExperienceVersion},
        synced_attendee_revision = ${input.reservation.desiredAttendeeRevision},
        last_synced_at = statement_timestamp(),
        last_failed_at = case
          when not ${isCurrent} then last_failed_at
          when ${conferenceReady} then null
          else statement_timestamp()
        end,
        last_failure_code = case
          when not ${isCurrent} then last_failure_code
          when ${conferenceReady} then null
          else ${conferenceFailureCode}
        end,
        updated_by_auth_user_id = ${actorAuthUserId}::uuid,
        version = version + 1,
        updated_at = statement_timestamp()
      where id = ${link.id}::uuid and version = ${link.version}
    `;
    await tx`
      update experience_calendar_sync_requests
      set
        status = 'succeeded',
        completed_at = statement_timestamp(),
        next_attempt_at = null,
        version = version + 1,
        updated_at = statement_timestamp()
      where id = ${input.reservation.requestId}::uuid and status = 'processing'
    `;
    const providerEventType = cancelled
      ? "provider_cancelled"
      : input.reservation.action === "create"
        ? "provider_created"
        : "provider_updated";
    await tx`
      insert into experience_calendar_sync_events (
        sync_request_id,
        calendar_link_id,
        experience_id,
        event_type,
        attempt_number,
        provider_event_id,
        provider_event_etag,
        actor_auth_user_id,
        dedupe_key,
        metadata
      ) values (
        ${input.reservation.requestId}::uuid,
        ${link.id}::uuid,
        ${input.experienceId}::uuid,
        ${providerEventType},
        ${input.reservation.attemptNumber},
        ${providerEventId},
        ${input.result?.etag ?? link.provider_event_etag},
        ${actorAuthUserId}::uuid,
        ${`${input.reservation.requestId}:${providerEventType}`},
        ${tx.json({ sendUpdates: "all" })}
      )
    `;
    for (const mutation of attendeeMutations(input.reservation)) {
      const attendee = mutation.attendee;
      await tx`
        insert into experience_calendar_attendee_events (
          sync_request_id,
          calendar_link_id,
          experience_id,
          person_id,
          member_id,
          registration_id,
          attendee_email,
          assignment_source,
          action,
          outcome,
          provider_response_status,
          actor_auth_user_id,
          metadata,
          dedupe_key
        ) values (
          ${input.reservation.requestId}::uuid,
          ${link.id}::uuid,
          ${input.experienceId}::uuid,
          ${attendee.personId}::uuid,
          ${attendee.memberId}::uuid,
          ${attendee.registrationId}::uuid,
          ${attendee.email},
          ${attendee.assignmentSource},
          ${mutation.action},
          'applied',
          ${null},
          ${actorAuthUserId}::uuid,
          ${tx.json({ providerAccepted: true, inboxDeliveryUnconfirmed: true })},
          ${`${input.reservation.requestId}:${attendee.personId}:${mutation.action}:applied`}
        )
      `;
    }

    const livemode = input.reservation.livemode;
    const meetUrl = input.result?.meetUrl ?? link.meet_url;
    if (livemode !== null && meetUrl && !cancelled) {
      await tx`
        insert into integration_entity_links (
          provider,
          local_entity_type,
          local_entity_id,
          external_entity_type,
          external_entity_id,
          livemode,
          metadata
        ) values (
          'google',
          'experience',
          ${input.experienceId},
          'meet_space',
          ${conferenceId(meetUrl)},
          ${livemode},
          ${tx.json({
            calendarEventId: providerEventId,
            meetingUri: meetUrl,
            source: "google_calendar",
          })}
        )
        on conflict (
          provider,
          local_entity_type,
          local_entity_id,
          external_entity_type,
          livemode
        ) do update set
          external_entity_id = excluded.external_entity_id,
          metadata = excluded.metadata,
          updated_at = statement_timestamp()
      `;
    } else if (livemode !== null && cancelled) {
      await tx`
        delete from integration_entity_links
        where provider = 'google'
          and local_entity_type = 'experience'
          and local_entity_id = ${input.experienceId}
          and external_entity_type = 'meet_space'
          and livemode = ${livemode}
      `;
    }
    await tx`
      insert into operator_audit_events (
        actor_auth_user_id,
        action,
        subject_type,
        subject_id,
        request_id,
        after_snapshot,
        metadata,
        dedupe_key
      ) values (
        ${actorAuthUserId}::uuid,
        ${cancelled ? "experience.calendar_cancelled" : "experience.calendar_synced"},
        'experience',
        ${input.experienceId},
        ${input.reservation.requestId},
        ${tx.json({ attendeeCount: input.reservation.attendees.length, status: linkStatus })},
        ${tx.json({ sendUpdates: "all" })},
        ${`calendar:${input.reservation.requestId}:completed`}
      )
    `;
    return getOpsExperienceCalendarStateForTx(tx, input.experienceId);
  });
}

function calendarFailure(error: unknown): { code: string; providerStatus: number | null } {
  if (error instanceof Error && error.name === "GoogleCalendarOrganizerMismatchError") {
    return { code: "calendar_organizer_mismatch", providerStatus: null };
  }
  if (error instanceof GoogleCalendarConflictError) {
    return { code: "calendar_conflict", providerStatus: 412 };
  }
  if (error instanceof GoogleCalendarApiError) {
    return {
      code: error.status === 404 ? "calendar_not_found" : "calendar_provider_failed",
      providerStatus: error.status,
    };
  }
  return { code: "calendar_request_failed", providerStatus: null };
}

async function finalizeCalendarFailure(
  input: {
    actorAuthUserId: string;
    error: unknown;
    experienceId: string;
    reservation: ReservedSync;
  },
): Promise<void> {
  const failure = calendarFailure(input.error);
  const failureMessage = "Google Calendar did not accept the request.";
  const sql = getApplicationDatabase();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${input.experienceId}), 49)`;
    const link = await getCalendarLink(tx, input.experienceId, true);
    if (!link || link.id !== input.reservation.calendarLinkId) return;
    const requestRows = await tx<Array<{ status: string; attempt_count: number }>>`
      select status, attempt_count::int
      from experience_calendar_sync_requests
      where id = ${input.reservation.requestId}::uuid
      for update
    `;
    if (requestRows[0]?.status !== "processing" || requestRows[0]?.attempt_count !== input.reservation.attemptNumber) return;
    const isCurrent =
      link.current_sync_request_id === input.reservation.requestId
      && link.desired_experience_version === input.reservation.desiredExperienceVersion
      && link.desired_attendee_revision === input.reservation.desiredAttendeeRevision;
    if (isCurrent) {
      await tx`
        update experience_calendar_links
        set
          status = 'failed',
          last_failed_at = statement_timestamp(),
          last_failure_code = ${failure.code},
          next_reconcile_at = statement_timestamp()
            + make_interval(secs => least(3600, 30 * power(2, greatest(0, least(reconcile_attempt_count - 1, 7))))),
          updated_by_auth_user_id = ${input.actorAuthUserId}::uuid,
          version = version + 1,
          updated_at = statement_timestamp()
        where id = ${link.id}::uuid and version = ${link.version}
      `;
    }
    await tx`
      update experience_calendar_sync_requests
      set
        status = 'failed',
        completed_at = statement_timestamp(),
        next_attempt_at = null,
        last_error_code = ${failure.code},
        last_error_message = ${failureMessage},
        version = version + 1,
        updated_at = statement_timestamp()
      where id = ${input.reservation.requestId}::uuid and status = 'processing'
    `;
    await tx`
      insert into experience_calendar_sync_events (
        sync_request_id,
        calendar_link_id,
        experience_id,
        event_type,
        attempt_number,
        provider_http_status,
        failure_code,
        failure_message,
        actor_auth_user_id,
        dedupe_key,
        metadata
      ) values (
        ${input.reservation.requestId}::uuid,
        ${link.id}::uuid,
        ${input.experienceId}::uuid,
        'failed',
        ${input.reservation.attemptNumber},
        ${failure.providerStatus},
        ${failure.code},
        ${failureMessage},
        ${input.actorAuthUserId}::uuid,
        ${`${input.reservation.requestId}:failed`},
        ${tx.json({ retryable: true })}
      )
    `;
    for (const mutation of attendeeMutations(input.reservation)) {
      const attendee = mutation.attendee;
      await tx`
        insert into experience_calendar_attendee_events (
          sync_request_id,
          calendar_link_id,
          experience_id,
          person_id,
          member_id,
          registration_id,
          attendee_email,
          assignment_source,
          action,
          outcome,
          failure_code,
          failure_message,
          actor_auth_user_id,
          metadata,
          dedupe_key
        ) values (
          ${input.reservation.requestId}::uuid,
          ${link.id}::uuid,
          ${input.experienceId}::uuid,
          ${attendee.personId}::uuid,
          ${attendee.memberId}::uuid,
          ${attendee.registrationId}::uuid,
          ${attendee.email},
          ${attendee.assignmentSource},
          ${mutation.action},
          'failed',
          ${failure.code},
          ${failureMessage},
          ${input.actorAuthUserId}::uuid,
          ${tx.json({ inboxDeliveryUnconfirmed: true })},
          ${`${input.reservation.requestId}:${attendee.personId}:${mutation.action}:failed`}
        )
      `;
    }
  });
}

async function performReservedCalendarSync(input: {
  actorAuthUserId: string;
  experienceId: string;
  reservation: ReservedSync;
}): Promise<OpsExperienceCalendarState> {
  const { reservation } = input;
  const actorAuthUserId = reservation.actorAuthUserId;
  let result: GoogleCalendarEventResult | null;
  try {
    const configuration = getGoogleCalendarConfigurationStatus();
    if (googleCommunicationLivemode() !== reservation.livemode
      || configuration.organizerEmail !== reservation.organizerEmail
      || configuration.calendarId !== reservation.calendarId) {
      throw new Error("Calendar delivery environment changed after reservation.");
    }
    if (reservation.action === "cancel") {
      await cancelGoogleCalendarEvent(reservation.providerEventId!);
      result = null;
    } else {
      const draft = googleDraft(reservation);
      result = reservation.action === "create"
        ? await createGoogleCalendarEvent({ ...draft, recoverExisting: reservation.recoverExistingCreate })
        : await updateGoogleCalendarEvent({
            ...draft,
            eventId: reservation.providerEventId!,
            expectedEtag: reservation.expectedEtag,
          });
    }
  } catch (error) {
    await finalizeCalendarFailure({
      actorAuthUserId,
      error,
      experienceId: input.experienceId,
      reservation,
    });
    const syncError = new Error("Google Calendar could not complete the request.");
    syncError.name = "GoogleCalendarSyncError";
    throw syncError;
  }

  // Google may have accepted and emailed the change even if the database is
  // temporarily unable to record it. Keep that durable request processing so
  // the stale-attempt recovery path can reconcile the deterministic provider
  // event; do not mislabel a local finalize failure as a provider rejection.
  return finalizeCalendarSuccess({
    actorAuthUserId,
    experienceId: input.experienceId,
    reservation,
    result,
  });
}

export async function syncOpsExperienceCalendar(input: {
  actorAuthUserId: string;
  experienceId: string;
  intent: CalendarIntent;
  requestKey: string;
}): Promise<OpsExperienceCalendarState> {
  const experienceId = requireUuid(input.experienceId, "Experience");
  const requestKey = requireRequestKey(input.requestKey);
  const reservation = await reserveCalendarSync({
    ...input,
    actorKind: "operator",
    experienceId,
    requestKey,
  });
  if (!("requestId" in reservation)) return reservation;
  return performReservedCalendarSync({
    actorAuthUserId: input.actorAuthUserId,
    experienceId,
    reservation,
  });
}

async function requireCalendarBindingAdmin(tx: postgres.TransactionSql, actor: string) {
  const rows = await tx`
    select account.auth_user_id from platform_users account
    join platform_role_grants role_grant on role_grant.auth_user_id = account.auth_user_id
    where account.auth_user_id = ${requireUuid(actor, "Operator")}::uuid
      and account.status = 'active' and role_grant.role_slug = 'ops_admin'
      and role_grant.revoked_at is null
    for share of account, role_grant
  `;
  if (!rows.length) throw new OpsOperatingRepositoryError("forbidden", "An active administrator must verify the Calendar delivery mode.");
}

export async function bindLegacyExperienceCalendar(input: { actorAuthUserId: string; experienceId: string; livemode: boolean }) {
  const id = requireUuid(input.experienceId, "Experience");
  const configuration = getGoogleCalendarConfigurationStatus();
  if (!configuration.ready || googleCommunicationLivemode() !== input.livemode) {
    throw new OpsOperatingRepositoryError("conflict", "Choose the explicitly configured Calendar environment.");
  }
  const sql = getApplicationDatabase();
  const before = await sql.begin(async (tx) => {
    await requireCalendarBindingAdmin(tx, input.actorAuthUserId);
    const link = await getCalendarLink(tx, id);
    if (!link || link.livemode !== null || !link.provider_event_id
      || link.organizer_email !== configuration.organizerEmail || link.organizer_calendar_id !== configuration.calendarId
      || link.provider_event_id !== googleCalendarEventIdForRequestKey(providerRequestKey("create", id, 1, 1))) {
      throw new OpsOperatingRepositoryError("conflict", "This legacy invitation has no verifiable saved Google event. No replacement was created; the owner must review its provider record.");
    }
    return link;
  });
  // Read-only provider verification, with no database locks held and no invite.
  const verified = await getRuinedOwnedGoogleCalendarEventResult(before.provider_event_id!);
  if (!verified.organizerVerified || verified.organizerEmail !== before.organizer_email
    || verified.eventId !== before.provider_event_id || verified.status === "cancelled") {
    throw new OpsOperatingRepositoryError("conflict", "Google did not verify the saved invitation and organizer. Nothing was bound or sent.");
  }
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${id}), 49)`;
    await requireCalendarBindingAdmin(tx, input.actorAuthUserId);
    const link = await getCalendarLink(tx, id, true);
    const current = getGoogleCalendarConfigurationStatus();
    if (!link || link.version !== before.version || link.livemode !== null
      || link.provider_event_id !== verified.eventId || !current.ready || googleCommunicationLivemode() !== input.livemode
      || current.organizerEmail !== before.organizer_email || current.calendarId !== before.organizer_calendar_id) {
      throw new OpsOperatingRepositoryError("conflict", "Calendar authorization or state changed during verification. Nothing was bound or sent.");
    }
    await tx`
      update experience_calendar_links set livemode = ${input.livemode},
        next_reconcile_at = 'infinity'::timestamptz,
        updated_by_auth_user_id = ${input.actorAuthUserId}::uuid,
        version = version + 1, updated_at = statement_timestamp()
      where id = ${link.id}::uuid
    `;
    await tx`
      insert into operator_audit_events (actor_auth_user_id, action, subject_type, subject_id, metadata, dedupe_key)
      values (${input.actorAuthUserId}::uuid, 'experience.calendar_mode_verified', 'experience', ${id},
        ${tx.json({ livemode: input.livemode, providerEventId: verified.eventId, organizerEmail: verified.organizerEmail, providerReadOnly: true })},
        ${`calendar-mode:${link.id}`})
    `;
    return getOpsExperienceCalendarStateForTx(tx, id);
  });
}

/** Server-only worker discovery. The durable request lease is claimed again
 * under the same per-Experience lock used by manual sync before any HTTP call. */
export async function getPendingCalendarReconciliations(limit: number) {
  const configuration = getGoogleCalendarConfigurationStatus();
  const mode = googleCommunicationLivemode();
  if (!configuration.ready || mode === null) return [];
  const sql = getApplicationDatabase();
  return sql<Array<{ experience_id: string; actor_auth_user_id: string; intent: CalendarIntent }>>`
    select link.experience_id,
      coalesce(link.updated_by_auth_user_id, link.created_by_auth_user_id) as actor_auth_user_id,
      case when experience.status = 'cancelled' or (experience.status = 'archived' and experience.cancelled_at is not null) then 'cancel'
        when link.provider_event_id is null then 'create' else 'sync' end as intent
    from experience_calendar_links link
    join experiences experience on experience.id = link.experience_id
    left join experience_calendar_sync_requests request on request.id = link.current_sync_request_id
    where link.livemode = ${mode}
      and link.organizer_email = ${configuration.organizerEmail}
      and link.organizer_calendar_id = ${configuration.calendarId}
      and link.status in ('pending_create', 'pending_update', 'pending_cancel', 'failed')
      and (experience.status in ('published', 'cancelled') or (experience.status = 'archived' and experience.cancelled_at is not null))
      and (experience.status <> 'published' or coalesce(experience.ends_at, experience.starts_at + interval '1 hour') > statement_timestamp())
      and link.next_reconcile_at <= statement_timestamp()
      and (request.id is null or request.status not in ('processing', 'queued')
        or (request.status = 'processing' and request.last_attempt_at <= statement_timestamp() - interval '10 minutes'))
    order by link.next_reconcile_at, link.id
    limit ${Math.max(1, Math.min(3, Math.trunc(limit) || 1))}
  `;
}

export async function reconcilePendingExperienceCalendar(input: {
  actor_auth_user_id: string;
  experience_id: string;
  intent: CalendarIntent;
}): Promise<boolean> {
  // No browser can choose actorKind=worker. The protected worker obtains these
  // IDs from already-authorized durable mutations, not from request bodies.
  const reservation = await reserveCalendarSync({
    actorAuthUserId: input.actor_auth_user_id,
    actorKind: "worker",
    experienceId: input.experience_id,
    intent: input.intent,
    requestKey: `calendar-worker:${randomUUID()}`,
  });
  if (!("requestId" in reservation)) return false;
  await performReservedCalendarSync({
    actorAuthUserId: reservation.actorAuthUserId,
    experienceId: input.experience_id,
    reservation,
  });
  return true;
}

/**
 * Registration changes reconcile an already-published Google event after the
 * membership transaction commits. With no configured Workspace organizer or
 * no existing event, the durable pending marker remains for an operator retry.
 */
export async function syncMemberExperienceCalendar(input: {
  actorAuthUserId: string;
  expectedRegistrationStatus: "cancelled" | "registered";
  experienceId: string;
  requestKey: string;
}): Promise<OpsExperienceCalendarState | null> {
  if (!getGoogleCalendarConfigurationStatus().ready) return null;
  const experienceId = requireUuid(input.experienceId, "Experience");
  const requestKey = requireRequestKey(input.requestKey);
  const reservation = await reserveCalendarSync({
    actorAuthUserId: input.actorAuthUserId,
    actorKind: "member",
    expectedRegistrationStatus: input.expectedRegistrationStatus,
    experienceId,
    intent: "sync",
    requestKey,
  });
  if (!("requestId" in reservation)) return reservation;
  return performReservedCalendarSync({
    actorAuthUserId: input.actorAuthUserId,
    experienceId,
    reservation,
  });
}
