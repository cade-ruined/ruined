import "server-only";

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { getApplicationDatabase } from "@/lib/database/server";
import type { PlatformConfiguration } from "@/lib/platform/config";
import type {
  OpsAccessContext,
  OpsAccessRole,
  OpsAnnouncementSummary,
  OpsArtifactQueueItem,
  OpsCapability,
  OpsExperienceDirectoryItem,
  OpsHistoryEvent,
  OpsMemberRecord,
  OpsSystemHealth,
  OpsTaskSummary,
  OpsWorkItem,
  OpsWorkQueue,
} from "@/lib/platform/ops-model";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATOR_ROLES = new Set<OpsAccessRole>(["ops_admin", "guide", "circle_leader"]);
const NOTE_TYPES = new Set(["general", "outreach", "support", "risk", "logistics", "circle"]);
const OVERRIDE_VALUES: Record<string, Set<string>> = {
  account: new Set(["provisional", "invited", "active", "suspended", "closed"]),
  admission: new Set(["interested", "applied", "invited", "accepted", "declined", "withdrawn"]),
  administrative_onboarding: new Set(["not_started", "in_progress", "completed"]),
  artifact: new Set(["not_started", "collecting", "in_production", "fulfilled"]),
  progression: new Set(["member", "shaper", "builder", "author", "partner"]),
  standing: new Set(["pre_active", "active", "paused", "cancellation_requested", "inactive", "alumni"]),
};
const ARTIFACT_TRANSITIONS: Record<string, Set<string>> = {
  collecting: new Set(["ready_for_production", "canceled"]),
  in_production: new Set(["review", "canceled"]),
  ready: new Set(["fulfilled"]),
  ready_for_production: new Set(["in_production", "canceled"]),
  requested: new Set(["collecting", "canceled"]),
  review: new Set(["ready", "in_production", "canceled"]),
};

const ADMIN_CAPABILITIES: OpsCapability[] = [
  "accountability.manage",
  "announcement.manage",
  "artifact.manage",
  "experience.manage",
  "member.agreement_evidence.read",
  "member.billing_detail.read",
  "member.community.read",
  "member.journey.read",
  "member.note.write",
  "member.operational_contact.read",
  "member.override.write",
  "member.private_profile.read",
  "member.summary.read",
  "task.manage",
  "workflow.retry",
];
const ASSIGNED_CIRCLE_CAPABILITIES: OpsCapability[] = [
  "accountability.manage",
  "experience.manage",
  "member.community.read",
  "member.journey.read",
  "member.summary.read",
];

export type OpsOperatingRepositoryErrorCode =
  | "conflict"
  | "forbidden"
  | "invalid_request"
  | "not_found";

export class OpsOperatingRepositoryError extends Error {
  constructor(
    readonly code: OpsOperatingRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OpsOperatingRepositoryError";
  }
}

type OperatorAccessOptions = {
  lock?: boolean;
  memberId?: string;
  requireAdmin?: boolean;
};

function requireUuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} is invalid.`);
  }
  return normalized;
}

function normalizedText(value: string, label: string, minimum: number, maximum: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      `${label} must be between ${minimum} and ${maximum} characters.`,
    );
  }
  return normalized;
}

function normalizedBody(value: string, label: string, minimum: number, maximum: number) {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      `${label} must be between ${minimum} and ${maximum} characters.`,
    );
  }
  return normalized;
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function priorityWeight(priority: string): number {
  return priority === "urgent" ? 100 : priority === "high" ? 75 : priority === "low" ? 20 : 50;
}

async function requireOperatorAccess(
  tx: postgres.TransactionSql,
  actorAuthUserIdValue: string,
  options: OperatorAccessOptions = {},
): Promise<OpsAccessContext> {
  const actorAuthUserId = requireUuid(actorAuthUserIdValue, "Operator identity");
  const roleRows = options.lock
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
  const roles = roleRows
    .map((row) => row.role_slug)
    .filter((role): role is OpsAccessRole => OPERATOR_ROLES.has(role as OpsAccessRole));
  if (roles.length === 0 || (options.requireAdmin && !roles.includes("ops_admin"))) {
    throw new OpsOperatingRepositoryError("forbidden", "Operations access is required.");
  }

  if (options.memberId && !roles.includes("ops_admin")) {
    const memberId = requireUuid(options.memberId, "Member");
    const assignmentRows = await tx<Array<{ role_slug: string }>>`
      select staff_assignment.role_slug
      from circle_member_assignments member_assignment
      join circle_staff_assignments staff_assignment
        on staff_assignment.circle_id = member_assignment.circle_id
       and staff_assignment.auth_user_id = ${actorAuthUserId}::uuid
       and staff_assignment.ended_at is null
      where member_assignment.member_id = ${memberId}::uuid
        and member_assignment.ended_at is null
      order by staff_assignment.role_slug
    `;
    if (!assignmentRows.some((row) => roles.includes(row.role_slug as OpsAccessRole))) {
      throw new OpsOperatingRepositoryError(
        "forbidden",
        "This member is outside the operator's current Circle assignment.",
      );
    }
  }

  return {
    authUserId: actorAuthUserId,
    capabilities: roles.includes("ops_admin")
      ? ADMIN_CAPABILITIES
      : ASSIGNED_CIRCLE_CAPABILITIES,
    roles,
  };
}

async function writeAudit(
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
  const before = input.before === undefined || input.before === null
    ? null
    : tx.json(input.before);
  const after = input.after === undefined || input.after === null
    ? null
    : tx.json(input.after);
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
      ${before},
      ${after},
      ${tx.json(input.metadata ?? {})},
      ${randomUUID()}
    )
  `;
}

function nextDecision(input: {
  administrativeOnboarding: string;
  billing: string;
  circleId: string | null;
  foundations: string;
  standing: string;
}) {
  if (input.billing === "attention_required") return "Resolve payment standing without changing the member's history.";
  if (input.administrativeOnboarding !== "completed") return "Complete the remaining administrative onboarding requirements.";
  if (input.standing === "paused") return "Confirm the pause terms and protect private Circle participation.";
  if (!input.circleId) return "Place the member in an active Circle before Foundations can be completed.";
  if (input.foundations !== "completed") return "Review the next Foundations completion marker.";
  return "No immediate operator decision is required.";
}

type MemberBaseRow = {
  account_state: string;
  administrative_onboarding_state: string;
  admission_state: string;
  artifact_state: string;
  billing_state: string;
  block_id: string | null;
  block_name: string | null;
  block_state: string | null;
  circle_id: string | null;
  circle_name: string | null;
  circle_state: string | null;
  email_scope: string;
  foundations_state: string;
  lifecycle_version: number | string;
  member_id: string;
  person_id: string;
  phone_scope: string;
  preferred_name: string;
  primary_email: string | null;
  standing_state: string;
};

export async function getOpsMemberOperatingRecord(
  actorAuthUserId: string,
  memberIdValue: string,
): Promise<OpsMemberRecord | null> {
  const memberId = requireUuid(memberIdValue, "Member");
  const sql = getApplicationDatabase();

  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const access = await requireOperatorAccess(tx, actorAuthUserId, { memberId });
    const isAdmin = access.roles.includes("ops_admin");

    const baseRows = await tx<Array<MemberBaseRow>>`
      select
        member.id as member_id,
        member.person_id,
        coalesce(profile.preferred_name, profile.display_name, 'Member') as preferred_name,
        coalesce(primary_email.email, member.email) as primary_email,
        coalesce(directory.email_scope, 'none') as email_scope,
        coalesce(directory.phone_scope, 'none') as phone_scope,
        lifecycle.account_state,
        lifecycle.billing_state,
        lifecycle.foundations_state,
        lifecycle.artifact_state,
        lifecycle.admission_state,
        lifecycle.administrative_onboarding_state,
        lifecycle.standing_state,
        lifecycle.version as lifecycle_version,
        current_circle.circle_id,
        current_circle.circle_name,
        current_circle.circle_state,
        current_circle.block_id,
        current_circle.block_name,
        current_circle.block_state
      from ruined_members member
      join member_lifecycle lifecycle on lifecycle.member_id = member.id
      left join person_profiles profile on profile.person_id = member.person_id
      left join member_directory_preferences directory on directory.member_id = member.id
      left join lateral (
        select email_address.email
        from person_email_addresses email_address
        where email_address.person_id = member.person_id
          and email_address.is_primary
          and email_address.retired_at is null
        order by email_address.verified_at desc nulls last, email_address.created_at
        limit 1
      ) primary_email on true
      left join lateral (
        select
          circle.id as circle_id,
          circle.name as circle_name,
          circle.status as circle_state,
          membership_block.id as block_id,
          membership_block.name as block_name,
          membership_block.status as block_state
        from circle_member_assignments circle_assignment
        join circles circle on circle.id = circle_assignment.circle_id
        left join block_circle_assignments block_assignment
          on block_assignment.circle_id = circle.id
         and block_assignment.ended_at is null
        left join membership_blocks membership_block
          on membership_block.id = block_assignment.block_id
        where circle_assignment.member_id = member.id
          and circle_assignment.ended_at is null
        order by circle_assignment.assigned_at desc
        limit 1
      ) current_circle on true
      where member.id = ${memberId}::uuid
      limit 1
    `;
    const base = baseRows[0];
    if (!base) return null;

    const onboardingRows = await tx<Array<{
      agreement_completed_at: Date | string | null;
      billing_confirmed_at: Date | string | null;
      completed_at: Date | string | null;
      profile_completed_at: Date | string | null;
      state: string;
    }>>`
      select
        state,
        profile_completed_at,
        agreement_completed_at,
        billing_confirmed_at,
        completed_at
      from member_onboardings
      where member_id = ${memberId}::uuid
      limit 1
    `;
    const onboarding = onboardingRows[0];
    const verifiedRows = await tx<Array<{ verified_at: Date | string | null }>>`
      select verified_at
      from person_email_addresses
      where person_id = ${base.person_id}::uuid
        and verification_state = 'verified'
        and retired_at is null
      order by verified_at desc
      limit 1
    `;

    const contactRows = isAdmin
      ? await tx<Array<{ legal_name: string | null; mobile_e164: string | null }>>`
          select legal_name, mobile_e164
          from person_private_profiles
          where person_id = ${base.person_id}::uuid
          limit 1
        `
      : await tx<Array<{ legal_name: null; mobile_e164: string | null }>>`
          select
            null::text as legal_name,
            case when directory.phone_scope = 'circle' then private_profile.mobile_e164 end as mobile_e164
          from member_directory_preferences directory
          left join person_private_profiles private_profile
            on private_profile.person_id = ${base.person_id}::uuid
          where directory.member_id = ${memberId}::uuid
          limit 1
        `;

    const agreementRows = isAdmin
      ? await tx<Array<{
          accepted_at: Date | string;
          agreement_content_sha256: string;
          agreement_version_snapshot: number | string;
          receipt_id: string | null;
        }>>`
          select
            acceptance.accepted_at,
            acceptance.agreement_version_snapshot,
            acceptance.agreement_content_sha256,
            receipt.id as receipt_id
          from membership_agreement_acceptances acceptance
          left join membership_agreement_receipts receipt
            on receipt.acceptance_id = acceptance.id
          where acceptance.member_id = ${memberId}::uuid
          order by acceptance.accepted_at desc
          limit 1
        `
      : [];

    const billingRows = isAdmin
      ? await tx<Array<{
          amount_paid: number | string | null;
          cancel_at_period_end: boolean;
          currency: string | null;
          current_period_end: Date | string | null;
          invoice_state: string | null;
          stripe_state: string;
        }>>`
          select
            subscription.stripe_status as stripe_state,
            subscription.current_period_end,
            subscription.cancel_at_period_end,
            latest_invoice.stripe_status as invoice_state,
            latest_invoice.amount_paid,
            latest_invoice.currency
          from stripe_subscriptions subscription
          left join lateral (
            select invoice.stripe_status, invoice.amount_paid, invoice.currency
            from stripe_invoices invoice
            where invoice.member_id = subscription.member_id
              and invoice.purpose = 'membership'
            order by invoice.updated_at desc
            limit 1
          ) latest_invoice on true
          where subscription.member_id = ${memberId}::uuid
          order by subscription.updated_at desc
          limit 1
        `
      : [];

    const cancellationRows = isAdmin
      ? await tx<Array<{
          requested_at: Date | string;
          requested_effective_at: Date | string | null;
          state: string;
        }>>`
          select state, requested_at, requested_effective_at
          from membership_cancellation_requests
          where member_id = ${memberId}::uuid
          order by requested_at desc
          limit 1
        `
      : [];

    const enrollmentRows = await tx<Array<{
      completed_at: Date | string | null;
      id: string;
      progress_percent: number | string;
      started_at: Date | string | null;
      status: string;
    }>>`
      select id, status, progress_percent, started_at, completed_at
      from foundation_enrollments
      where member_id = ${memberId}::uuid
      order by
        case when status in ('not_started', 'in_progress', 'paused') then 0 else 1 end,
        enrolled_at desc
      limit 1
    `;
    const enrollment = enrollmentRows[0];
    const stageRows = enrollment
      ? await tx<Array<{
          completed: number | string;
          key: string;
          label: string;
          total: number | string;
        }>>`
          select
            unit.unit_slug as key,
            unit.title as label,
            count(*) filter (where progress.status = 'completed') as completed,
            count(*) as total
          from foundation_units unit
          join foundation_enrollments enrollment
            on enrollment.foundation_version_id = unit.foundation_version_id
          left join foundation_unit_progress progress
            on progress.enrollment_id = enrollment.id
           and progress.unit_id = unit.id
          where enrollment.id = ${enrollment.id}::uuid
          group by unit.unit_slug, unit.title, unit.position
          order by unit.position
        `
      : [];
    const requirementRows = enrollment
      ? await tx<Array<{ completed_at: Date | string; requirement_slug: string }>>`
          select distinct on (completion.requirement_slug)
            completion.requirement_slug,
            completion.completed_at
          from member_foundation_requirement_completions completion
          where completion.foundation_enrollment_id = ${enrollment.id}::uuid
            and completion.member_id = ${memberId}::uuid
            and completion.state = 'completed'
            and not exists (
              select 1
              from member_foundation_requirement_completions revocation
              where revocation.supersedes_completion_id = completion.id
                and revocation.state = 'revoked'
            )
          order by completion.requirement_slug, completion.completion_version desc
        `
      : [];

    const progressionRows = isAdmin
      ? await tx<Array<{
          assigned_at: Date | string;
          display_name: string;
        }>>`
          select level_record.display_name, assignment.assigned_at
          from member_progression_assignments assignment
          join membership_progression_levels level_record
            on level_record.slug = assignment.progression_level_slug
          where assignment.member_id = ${memberId}::uuid
            and assignment.ended_at is null
          order by assignment.assigned_at desc
          limit 1
        `
      : [];

    const artifactRows = isAdmin
      ? await tx<Array<{
          artifact_award_id: string;
          artifact_job_id: string | null;
          award_name: string;
          award_reason: string | null;
          awarded_at: Date | string;
          state: string;
        }>>`
          select
            award.id as artifact_award_id,
            job.id as artifact_job_id,
            award.award_name,
            award.award_reason,
            award.awarded_at,
            coalesce(job.status, award.status) as state
          from artifact_awards award
          left join artifact_jobs job on job.artifact_award_id = award.id
          where award.member_id = ${memberId}::uuid
          order by award.awarded_at desc
          limit 30
        `
      : [];

    const experienceRows = isAdmin
      ? await tx<Array<{
          completed_at: Date | string | null;
          experience_id: string;
          kind: string;
          occurred_at: Date | string;
          state: string;
          title: string;
        }>>`
          select
            experience.id as experience_id,
            experience.title,
            experience.kind,
            experience.starts_at as occurred_at,
            coalesce(attendance.event_type, registration.status) as state,
            case when attendance.event_type in ('attended', 'credited') then attendance.occurred_at end as completed_at
          from experience_registrations registration
          join experiences experience on experience.id = registration.experience_id
          left join lateral (
            select attendance_event.event_type, attendance_event.occurred_at
            from experience_attendance_events attendance_event
            where attendance_event.registration_id = registration.id
            order by attendance_event.occurred_at desc
            limit 1
          ) attendance on true
          where registration.member_id = ${memberId}::uuid
          order by experience.starts_at desc
          limit 50
        `
      : [];

    const circleMembers = base.circle_id
      ? await tx<Array<{ member_id: string; preferred_name: string }>>`
          select
            circle_member.id as member_id,
            coalesce(profile.preferred_name, profile.display_name, 'Member') as preferred_name
          from circle_member_assignments assignment
          join ruined_members circle_member on circle_member.id = assignment.member_id
          left join person_profiles profile on profile.person_id = circle_member.person_id
          left join member_directory_preferences directory on directory.member_id = circle_member.id
          where assignment.circle_id = ${base.circle_id}::uuid
            and assignment.ended_at is null
            and (${isAdmin} or directory.directory_status = 'circle_visible')
          order by preferred_name, circle_member.id
        `
      : [];
    const staffRows = base.circle_id
      ? await tx<Array<{ preferred_name: string; role_slug: string }>>`
          select
            coalesce(profile.preferred_name, profile.display_name, staff_assignment.role_slug) as preferred_name,
            staff_assignment.role_slug
          from circle_staff_assignments staff_assignment
          join platform_users platform_user
            on platform_user.auth_user_id = staff_assignment.auth_user_id
          left join person_profiles profile on profile.person_id = platform_user.person_id
          where staff_assignment.circle_id = ${base.circle_id}::uuid
            and staff_assignment.ended_at is null
          order by staff_assignment.role_slug, preferred_name
        `
      : [];
    const accountabilityRows = base.circle_id
      ? await tx<Array<{
          assigned_at: Date | string;
          assignment_id: string;
          partner_member_id: string;
          preferred_name: string;
        }>>`
          select
            assignment.id as assignment_id,
            assignment.assigned_at,
            partner.id as partner_member_id,
            coalesce(profile.preferred_name, profile.display_name, 'Member') as preferred_name
          from accountability_partner_assignments assignment
          join ruined_members partner
            on partner.id = case
              when assignment.member_one_id = ${memberId}::uuid then assignment.member_two_id
              else assignment.member_one_id
            end
          left join person_profiles profile on profile.person_id = partner.person_id
          where assignment.circle_id = ${base.circle_id}::uuid
            and assignment.ended_at is null
            and ${memberId}::uuid in (assignment.member_one_id, assignment.member_two_id)
          order by assignment.assigned_at desc
          limit 1
        `
      : [];
    const meetingRows = base.circle_id
      ? await tx<Array<{
          experience_id: string;
          kind: string;
          occurred_at: Date | string;
          state: string;
          title: string;
        }>>`
          select
            id as experience_id,
            title,
            kind,
            starts_at as occurred_at,
            status as state
          from experiences
          where circle_id = ${base.circle_id}::uuid
            and kind = 'circle_meeting'
          order by starts_at desc
          limit 20
        `
      : [];
    const resourceRows = base.circle_id
      ? await tx<Array<{ label: string; resource_id: string; url: string | null }>>`
          select
            circle_resource.id as resource_id,
            resource.title as label,
            version_record.external_url as url
          from circle_resources circle_resource
          join learning_resource_versions version_record
            on version_record.id = circle_resource.learning_resource_version_id
          join learning_resources resource
            on resource.id = version_record.learning_resource_id
          where circle_resource.circle_id = ${base.circle_id}::uuid
          order by circle_resource.is_pinned desc, circle_resource.position, resource.title
        `
      : [];

    const noteRows = isAdmin
      ? await tx<Array<{
          body_text: string;
          note_id: string;
          note_type: string;
          occurred_at: Date | string;
          preferred_name: string;
          replacement_text: string | null;
        }>>`
          select
            note.id as note_id,
            note.note_type,
            note.body_text,
            note.occurred_at,
            coalesce(profile.preferred_name, profile.display_name, 'Operator') as preferred_name,
            redaction.replacement_text
          from operator_member_notes note
          join platform_users author on author.auth_user_id = note.authored_by_auth_user_id
          left join person_profiles profile on profile.person_id = author.person_id
          left join operator_member_note_redactions redaction
            on redaction.operator_member_note_id = note.id
          where note.member_id = ${memberId}::uuid
          order by note.occurred_at desc
          limit 100
        `
      : [];

    const taskRows = isAdmin
      ? await tx<Array<{
          assigned_to: string | null;
          completed_at: Date | string | null;
          due_at: Date | string | null;
          priority: string;
          state: string;
          task_id: string;
          title: string;
        }>>`
          select
            task.id as task_id,
            task.title,
            task.priority,
            task.status as state,
            task.due_at,
            task.completed_at,
            coalesce(assignee_profile.preferred_name, assignee_profile.display_name) as assigned_to
          from operator_tasks task
          left join platform_users assignee on assignee.auth_user_id = task.assigned_to_auth_user_id
          left join person_profiles assignee_profile on assignee_profile.person_id = assignee.person_id
          where task.member_id = ${memberId}::uuid
          order by
            case task.status when 'open' then 0 when 'in_progress' then 1 when 'blocked' then 2 else 3 end,
            task.due_at nulls last,
            task.created_at desc
          limit 100
        `
      : [];

    const overrideRows = isAdmin
      ? await tx<Array<{
          dimension: string;
          next_state: string;
          occurred_at: Date | string;
          operator_name: string;
          reason: string;
        }>>`
          select
            state_override.dimension,
            state_override.override_value as next_state,
            state_override.reason,
            state_override.occurred_at,
            coalesce(profile.preferred_name, profile.display_name, 'Operator') as operator_name
          from member_state_overrides state_override
          join platform_users actor on actor.auth_user_id = state_override.actor_auth_user_id
          left join person_profiles profile on profile.person_id = actor.person_id
          where state_override.member_id = ${memberId}::uuid
            and state_override.action = 'applied'
          order by state_override.occurred_at desc
          limit 50
        `
      : [];

    const onboardingHistoryRows = isAdmin
      ? await tx<Array<{
          actor_name: string | null;
          event_type: string;
          field_name: string | null;
          next_state: string | null;
          occurred_at: Date | string;
        }>>`
          select
            onboarding_event.event_type,
            onboarding_event.field_name,
            onboarding_event.next_state,
            onboarding_event.occurred_at,
            coalesce(profile.preferred_name, profile.display_name) as actor_name
          from member_onboarding_events onboarding_event
          left join platform_users actor
            on actor.auth_user_id = onboarding_event.actor_auth_user_id
          left join person_profiles profile on profile.person_id = actor.person_id
          where onboarding_event.member_id = ${memberId}::uuid
          order by onboarding_event.occurred_at desc
          limit 100
        `
      : [];

    const experienceHistoryRows = isAdmin
      ? await tx<Array<{
          actor_name: string | null;
          occurred_at: Date | string;
          source: string;
          summary: string;
        }>>`
          select
            registration.registered_at as occurred_at,
            registration.source,
            null::text as actor_name,
            'Registered for ' || experience.title || ' as ' || replace(registration.status, '_', ' ') || '.' as summary
          from experience_registrations registration
          join experiences experience on experience.id = registration.experience_id
          where registration.member_id = ${memberId}::uuid
          union all
          select
            attendance.occurred_at,
            attendance.source,
            coalesce(profile.preferred_name, profile.display_name) as actor_name,
            experience.title || ' attendance marked ' || replace(attendance.event_type, '_', ' ') || '.' as summary
          from experience_attendance_events attendance
          join experiences experience on experience.id = attendance.experience_id
          left join platform_users actor on actor.auth_user_id = attendance.actor_auth_user_id
          left join person_profiles profile on profile.person_id = actor.person_id
          where attendance.member_id = ${memberId}::uuid
          order by occurred_at desc
          limit 150
        `
      : [];

    const artifactHistoryRows = isAdmin
      ? await tx<Array<{
          actor_name: string | null;
          next_status: string;
          occurred_at: Date | string;
          previous_status: string | null;
        }>>`
          select
            artifact_event.previous_status,
            artifact_event.next_status,
            artifact_event.occurred_at,
            coalesce(profile.preferred_name, profile.display_name) as actor_name
          from artifact_job_events artifact_event
          join artifact_jobs job on job.id = artifact_event.artifact_job_id
          left join platform_users actor on actor.auth_user_id = artifact_event.actor_auth_user_id
          left join person_profiles profile on profile.person_id = actor.person_id
          where job.member_id = ${memberId}::uuid
          order by artifact_event.occurred_at desc
          limit 100
        `
      : [];

    const historyRows = await tx<Array<{
      actor_name: string | null;
      next_state: string;
      occurred_at: Date | string;
      source: string;
      dimension: string;
    }>>`
      select
        history.dimension,
        history.next_state,
        history.source,
        history.occurred_at,
        coalesce(profile.preferred_name, profile.display_name) as actor_name
      from member_state_history history
      left join platform_users actor on actor.auth_user_id = history.actor_auth_user_id
      left join person_profiles profile on profile.person_id = actor.person_id
      where history.member_id = ${memberId}::uuid
        and (${isAdmin} or history.dimension in ('foundations', 'program'))
      order by history.occurred_at desc
      limit 100
    `;

    const openWorkCount = taskRows.filter((task) => !["completed", "cancelled"].includes(task.state)).length
      + artifactRows.filter((artifact) => !["fulfilled", "canceled", "revoked"].includes(artifact.state)).length;
    const agreement = agreementRows[0];
    const billing = billingRows[0];
    const cancellation = cancellationRows[0];
    const privateContact = contactRows[0];
    const timeline = requirementRows.find((row) => row.requirement_slug === "timeline");
    const futureLetter = requirementRows.find((row) => row.requirement_slug === "future_letter");
    const accountability = accountabilityRows[0];
    const primaryEmail = isAdmin || base.email_scope === "circle" ? base.primary_email : null;
    const combinedHistory: OpsHistoryEvent[] = [
      ...historyRows.map((row) => ({
        actor: row.actor_name,
        occurredAt: asIso(row.occurred_at)!,
        source: row.source,
        summary: `${row.dimension.replaceAll("_", " ")} changed to ${row.next_state.replaceAll("_", " ")}.`,
      })),
      ...onboardingHistoryRows.map((row) => ({
        actor: row.actor_name,
        occurredAt: asIso(row.occurred_at)!,
        source: "onboarding",
        summary: row.field_name
          ? `${row.field_name.replaceAll("_", " ")} recorded.`
          : `Onboarding ${row.event_type.replaceAll("_", " ")}${row.next_state ? ` · ${row.next_state.replaceAll("_", " ")}` : ""}.`,
      })),
      ...experienceHistoryRows.map((row) => ({
        actor: row.actor_name,
        occurredAt: asIso(row.occurred_at)!,
        source: row.source,
        summary: row.summary,
      })),
      ...artifactHistoryRows.map((row) => ({
        actor: row.actor_name,
        occurredAt: asIso(row.occurred_at)!,
        source: "artifact",
        summary: `Artifact moved${row.previous_status ? ` from ${row.previous_status.replaceAll("_", " ")}` : ""} to ${row.next_status.replaceAll("_", " ")}.`,
      })),
      ...(agreement
        ? [{
            actor: base.preferred_name,
            occurredAt: asIso(agreement.accepted_at)!,
            source: "agreement",
            summary: `Membership agreement version ${String(agreement.agreement_version_snapshot)} accepted.`,
          }]
        : []),
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 200);

    return {
      access,
      community: {
        accountabilityPartner: accountability
          ? {
              assignedAt: asIso(accountability.assigned_at)!,
              assignmentId: accountability.assignment_id,
              memberId: accountability.partner_member_id,
              preferredName: accountability.preferred_name,
            }
          : null,
        block: base.block_id
          ? { blockId: base.block_id, name: base.block_name ?? "Block", state: base.block_state ?? "forming" }
          : null,
        circle: base.circle_id
          ? {
              circleId: base.circle_id,
              guides: staffRows.filter((row) => row.role_slug === "guide").map((row) => row.preferred_name),
              leaderName: staffRows.find((row) => row.role_slug === "circle_leader")?.preferred_name ?? null,
              members: circleMembers.map((row) => ({ memberId: row.member_id, preferredName: row.preferred_name })),
              name: base.circle_name ?? "Circle",
              state: base.circle_state ?? "forming",
            }
          : null,
        meetings: meetingRows.map((row) => ({
          completedAt: null,
          experienceId: row.experience_id,
          kind: row.kind,
          occurredAt: asIso(row.occurred_at),
          state: row.state,
          title: row.title,
        })),
        resources: resourceRows.map((row) => ({
          label: row.label,
          resourceId: row.resource_id,
          url: row.url ?? "#",
        })),
      },
      header: {
        blockName: base.block_name,
        circleName: base.circle_name,
        lifecycleVersion: Number(base.lifecycle_version),
        memberId: base.member_id,
        nextDecision: nextDecision({
          administrativeOnboarding: base.administrative_onboarding_state,
          billing: base.billing_state,
          circleId: base.circle_id,
          foundations: base.foundations_state,
          standing: base.standing_state,
        }),
        openWorkCount,
        personId: base.person_id,
        preferredName: base.preferred_name,
        primaryEmail,
        states: {
          account: base.account_state,
          administrativeOnboarding: base.administrative_onboarding_state,
          admission: base.admission_state,
          artifact: base.artifact_state,
          billing: base.billing_state,
          foundations: base.foundations_state,
          standing: base.standing_state,
        },
      },
      journey: {
        artifacts: artifactRows.map((row) => ({
          artifactAwardId: row.artifact_award_id,
          artifactJobId: row.artifact_job_id,
          earnedAt: asIso(row.awarded_at)!,
          name: row.award_name,
          reason: row.award_reason ?? "Recorded award",
          state: row.state,
        })),
        experiences: experienceRows.map((row) => ({
          completedAt: asIso(row.completed_at),
          experienceId: row.experience_id,
          kind: row.kind,
          occurredAt: asIso(row.occurred_at),
          state: row.state,
          title: row.title,
        })),
        foundations: {
          activeCircleRequired: true,
          completedAt: asIso(enrollment?.completed_at),
          futureLetterCompletedAt: asIso(futureLetter?.completed_at),
          progressPercent: Number(enrollment?.progress_percent ?? 0),
          stages: stageRows.map((row) => ({
            completed: Number(row.completed),
            key: row.key,
            label: row.label,
            total: Number(row.total),
          })),
          startedAt: asIso(enrollment?.started_at),
          state: enrollment?.status ?? "not_started",
          timelineCompletedAt: asIso(timeline?.completed_at),
        },
        progression: progressionRows[0]
          ? {
              assignedAt: asIso(progressionRows[0].assigned_at)!,
              levelName: progressionRows[0].display_name,
            }
          : null,
      },
      membership: {
        agreement: {
          acceptedAt: asIso(agreement?.accepted_at),
          contentSha256: agreement?.agreement_content_sha256 ?? null,
          receiptId: agreement?.receipt_id ?? null,
          receiptState: agreement?.receipt_id ? "generated" : "not_recorded",
          version: agreement ? String(agreement.agreement_version_snapshot) : null,
        },
        billing: billing
          ? {
              cancelAtPeriodEnd: billing.cancel_at_period_end,
              currentPeriodEnd: asIso(billing.current_period_end),
              latestInvoiceAmountPaid: billing.amount_paid === null ? null : Number(billing.amount_paid),
              latestInvoiceCurrency: billing.currency,
              latestInvoiceState: billing.invoice_state,
              stripeState: billing.stripe_state,
            }
          : null,
        cancellation: cancellation
          ? {
              effectiveAt: asIso(cancellation.requested_effective_at),
              requestedAt: asIso(cancellation.requested_at)!,
              state: cancellation.state,
            }
          : null,
        contact: {
          email: primaryEmail,
          legalName: isAdmin ? privateContact?.legal_name ?? null : null,
          phone: privateContact?.mobile_e164 ?? null,
          preferredName: base.preferred_name,
        },
        onboarding: {
          completedAt: asIso(onboarding?.completed_at),
          requirements: [
            {
              completedAt: asIso(verifiedRows[0]?.verified_at),
              key: "verified_email",
              label: "Verified email",
              required: true,
              state: verifiedRows[0] ? "complete" : "missing",
            },
            {
              completedAt: asIso(onboarding?.profile_completed_at),
              key: "private_profile",
              label: "Legal name, mobile, and age attestation",
              required: true,
              state: onboarding?.profile_completed_at ? "complete" : "missing",
            },
            {
              completedAt: asIso(onboarding?.agreement_completed_at),
              key: "agreement",
              label: "Membership agreement",
              required: true,
              state: onboarding?.agreement_completed_at ? "complete" : "missing",
            },
            {
              completedAt: asIso(onboarding?.billing_confirmed_at),
              key: "billing",
              label: "Membership payment",
              required: true,
              state: onboarding?.billing_confirmed_at ? "complete" : "missing",
            },
          ],
          state: onboarding?.state ?? base.administrative_onboarding_state,
        },
      },
      operational: {
        history: combinedHistory,
        notes: noteRows.map((row) => ({
          body: row.replacement_text ?? row.body_text,
          category: row.note_type,
          createdAt: asIso(row.occurred_at)!,
          createdBy: row.preferred_name,
          noteId: row.note_id,
          visibility: "ops_admin",
        })),
        overrides: overrideRows.map((row) => ({
          dimension: row.dimension,
          nextState: row.next_state,
          occurredAt: asIso(row.occurred_at)!,
          operator: row.operator_name,
          reason: row.reason,
        })),
        tasks: taskRows.map<OpsTaskSummary>((row) => ({
          assignedTo: row.assigned_to,
          completedAt: asIso(row.completed_at),
          dueAt: asIso(row.due_at),
          priority: priorityWeight(row.priority),
          state: row.state,
          taskId: row.task_id,
          title: row.title,
        })),
      },
    };
  });
}

export async function getOpsWorkQueue(actorAuthUserId: string): Promise<OpsWorkQueue> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const access = await requireOperatorAccess(tx, actorAuthUserId);
    const isAdmin = access.roles.includes("ops_admin");
    const taskRows = isAdmin ? await tx<Array<{
      due_at: Date | string | null;
      member_id: string | null;
      member_name: string | null;
      priority: string;
      state: string;
      task_id: string;
      title: string;
    }>>`
      select
        task.id as task_id,
        task.title,
        task.priority,
        task.status as state,
        task.due_at,
        task.member_id,
        coalesce(profile.preferred_name, profile.display_name) as member_name
      from operator_tasks task
      left join ruined_members member on member.id = task.member_id
      left join person_profiles profile on profile.person_id = member.person_id
      where task.status in ('open', 'in_progress', 'blocked')
        and (
          ${isAdmin}
          or exists (
            select 1
            from circle_staff_assignments staff_assignment
            join platform_role_grants role_grant
              on role_grant.auth_user_id = staff_assignment.auth_user_id
             and role_grant.role_slug = staff_assignment.role_slug
             and role_grant.revoked_at is null
            left join circle_member_assignments member_assignment
              on member_assignment.circle_id = staff_assignment.circle_id
             and member_assignment.member_id = task.member_id
             and member_assignment.ended_at is null
            where staff_assignment.auth_user_id = ${access.authUserId}::uuid
              and staff_assignment.ended_at is null
              and (
                task.circle_id = staff_assignment.circle_id
                or member_assignment.id is not null
              )
          )
        )
      order by
        case task.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
        task.due_at nulls last,
        task.created_at
      limit 200
    ` : [];

    const artifactRows = isAdmin
      ? await tx<Array<{
          artifact_job_id: string;
          due_at: Date | string | null;
          member_id: string;
          member_name: string;
          priority: number | string;
          state: string;
          title: string;
        }>>`
          select
            job.id as artifact_job_id,
            job.member_id,
            coalesce(profile.preferred_name, profile.display_name, 'Member') as member_name,
            coalesce(award.award_name, template_version.name) as title,
            job.status as state,
            job.priority,
            job.due_at
          from artifact_jobs job
          join ruined_members member on member.id = job.member_id
          left join person_profiles profile on profile.person_id = member.person_id
          left join artifact_awards award on award.id = job.artifact_award_id
          join artifact_template_versions template_version
            on template_version.id = job.artifact_template_version_id
          where job.status not in ('fulfilled', 'canceled')
          order by job.priority desc, job.due_at nulls last, job.requested_at
          limit 200
        `
      : [];

    const workflowRows = isAdmin
      ? await tx<Array<{
          action_id: string;
          action_type: string;
          error_code: string | null;
          member_id: string | null;
          member_name: string | null;
          state: string;
          updated_at: Date | string;
        }>>`
          select
            action.id as action_id,
            action.action_type,
            action.status as state,
            action.updated_at,
            event.member_id,
            coalesce(profile.preferred_name, profile.display_name) as member_name,
            latest_attempt.error_code
          from workflow_actions action
          join domain_events event on event.id = action.domain_event_id
          left join ruined_members member on member.id = event.member_id
          left join person_profiles profile on profile.person_id = member.person_id
          left join lateral (
            select attempt.error_code
            from workflow_action_attempts attempt
            where attempt.workflow_action_id = action.id
            order by attempt.occurred_at desc
            limit 1
          ) latest_attempt on true
          where action.status in ('failed', 'dead_letter')
          order by action.updated_at, action.created_at
          limit 200
        `
      : [];

    const items: OpsWorkItem[] = [
      ...taskRows.map((row): OpsWorkItem => ({
        dueAt: asIso(row.due_at),
        kind: "task",
        label: row.title,
        memberId: row.member_id,
        memberName: row.member_name,
        priority: priorityWeight(row.priority),
        state: row.state,
        workId: row.task_id,
      })),
      ...artifactRows.map((row): OpsWorkItem => ({
        dueAt: asIso(row.due_at),
        kind: "artifact",
        label: row.title,
        memberId: row.member_id,
        memberName: row.member_name,
        priority: Number(row.priority),
        state: row.state,
        workId: row.artifact_job_id,
      })),
      ...workflowRows.map((row): OpsWorkItem => ({
        dueAt: asIso(row.updated_at),
        errorCode: row.error_code ?? "unknown_failure",
        kind: "workflow_failure",
        label: row.action_type.replaceAll("_", " "),
        memberId: row.member_id,
        memberName: row.member_name,
        priority: row.state === "dead_letter" ? 100 : 80,
        state: row.state,
        workId: row.action_id,
      })),
    ].sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      if (!left.dueAt) return 1;
      if (!right.dueAt) return -1;
      return left.dueAt.localeCompare(right.dueAt);
    });

    return {
      items,
      totals: {
        artifacts: artifactRows.length,
        failures: workflowRows.length,
        tasks: taskRows.length,
      },
    };
  });
}

export async function getOpsArtifactQueue(actorAuthUserId: string): Promise<OpsArtifactQueueItem[]> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    await requireOperatorAccess(tx, actorAuthUserId, { requireAdmin: true });
    const rows = await tx<Array<{
      artifact_award_id: string;
      artifact_job_id: string | null;
      award_name: string;
      award_reason: string | null;
      awarded_at: Date | string;
      due_at: Date | string | null;
      member_id: string;
      member_name: string;
      priority: number | string;
      state: string;
    }>>`
      select
        award.id as artifact_award_id,
        job.id as artifact_job_id,
        award.member_id,
        coalesce(profile.preferred_name, profile.display_name, 'Member') as member_name,
        award.award_name,
        award.award_reason,
        award.awarded_at,
        coalesce(job.status, award.status) as state,
        coalesce(job.priority, 0) as priority,
        job.due_at
      from artifact_awards award
      join ruined_members member on member.id = award.member_id
      left join person_profiles profile on profile.person_id = member.person_id
      left join artifact_jobs job on job.artifact_award_id = award.id
      where award.status <> 'revoked'
        and (job.id is null or job.status not in ('fulfilled', 'canceled'))
      order by coalesce(job.priority, 0) desc, job.due_at nulls last, award.awarded_at
      limit 300
    `;
    return rows.map((row) => ({
      artifactAwardId: row.artifact_award_id,
      artifactJobId: row.artifact_job_id,
      dueAt: asIso(row.due_at),
      earnedAt: asIso(row.awarded_at)!,
      memberId: row.member_id,
      memberName: row.member_name,
      name: row.award_name,
      priority: Number(row.priority),
      reason: row.award_reason ?? "Recorded award",
      state: row.state,
    }));
  });
}

export async function getOpsExperienceDirectory(
  actorAuthUserId: string,
): Promise<OpsExperienceDirectoryItem[]> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const access = await requireOperatorAccess(tx, actorAuthUserId);
    const isAdmin = access.roles.includes("ops_admin");
    const rows = await tx<Array<{
      ends_at: Date | string | null;
      experience_id: string;
      kind: string;
      registered_count: number | string;
      scope_label: string;
      starts_at: Date | string;
      state: string;
      title: string;
    }>>`
      select
        experience.id as experience_id,
        experience.title,
        experience.kind,
        experience.starts_at,
        experience.ends_at,
        experience.status as state,
        case
          when experience.visibility = 'circle' then coalesce(circle.name, 'Circle')
          when experience.visibility = 'block' then coalesce(membership_block.name, 'Block')
          when experience.visibility = 'progression' then coalesce(level_record.display_name, 'Progression')
          when experience.visibility = 'public' then 'Public'
          when experience.visibility = 'invite_only' then 'Invite only'
          else 'All active members'
        end as scope_label,
        count(registration.id) filter (where registration.status in ('registered', 'waitlisted')) as registered_count
      from experiences experience
      left join circles circle on circle.id = experience.circle_id
      left join membership_blocks membership_block on membership_block.id = experience.block_id
      left join membership_progression_levels level_record
        on level_record.slug = experience.progression_level_slug
      left join experience_registrations registration on registration.experience_id = experience.id
      where (
        ${isAdmin}
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
      group by
        experience.id,
        circle.name,
        membership_block.name,
        level_record.display_name
      order by experience.starts_at desc
      limit 300
    `;
    return rows.map((row) => ({
      endsAt: asIso(row.ends_at),
      experienceId: row.experience_id,
      kind: row.kind,
      registeredCount: Number(row.registered_count),
      scope: row.scope_label,
      startsAt: asIso(row.starts_at),
      state: row.state,
      title: row.title,
    }));
  });
}

export async function getOpsAnnouncements(actorAuthUserId: string): Promise<{
  announcements: OpsAnnouncementSummary[];
  canManage: boolean;
}> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    await requireOperatorAccess(tx, actorAuthUserId, { requireAdmin: true });
    const rows = await tx<Array<{
      announcement_id: string;
      body_text: string;
      published_at: Date | string | null;
      state: string;
      target_label: string;
      title: string;
    }>>`
      select
        announcement.id as announcement_id,
        announcement.title,
        announcement.body_text,
        announcement.status as state,
        announcement.published_at,
        coalesce(
          string_agg(
            distinct case target.target_type
              when 'all_active_members' then 'All active members'
              when 'circle' then coalesce(circle.name, 'Circle')
              when 'block' then coalesce(membership_block.name, 'Block')
              when 'progression' then coalesce(level_record.display_name, 'Progression')
              else coalesce(profile.preferred_name, profile.display_name, 'Member')
            end,
            ', '
          ),
          'No audience'
        ) as target_label
      from member_announcements announcement
      left join member_announcement_targets target
        on target.announcement_id = announcement.id
      left join circles circle on circle.id = target.circle_id
      left join membership_blocks membership_block on membership_block.id = target.block_id
      left join membership_progression_levels level_record
        on level_record.slug = target.progression_level_slug
      left join ruined_members member on member.id = target.member_id
      left join person_profiles profile on profile.person_id = member.person_id
      group by announcement.id
      order by announcement.created_at desc
      limit 200
    `;
    return {
      announcements: rows.map((row) => ({
        announcementId: row.announcement_id,
        body: row.body_text,
        publishedAt: asIso(row.published_at),
        state: row.state,
        targetLabel: row.target_label,
        title: row.title,
      })),
      canManage: true,
    };
  });
}

export async function getOpsSystemHealth(
  actorAuthUserId: string,
  configuration: PlatformConfiguration,
): Promise<{ canRetry: boolean; health: OpsSystemHealth }> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    await requireOperatorAccess(tx, actorAuthUserId, { requireAdmin: true });
    const timestampRows = await tx<Array<{
      database_checked_at: Date | string;
      last_identity_at: Date | string | null;
      last_notification_at: Date | string | null;
      last_stripe_at: Date | string | null;
    }>>`
      select
        statement_timestamp() as database_checked_at,
        (select max(last_signed_in_at) from platform_users) as last_identity_at,
        (select max(coalesce(delivered_at, sent_at)) from member_notifications) as last_notification_at,
        (select max(processed_at) from stripe_webhook_events where status = 'processed') as last_stripe_at
    `;
    const failureRows = await tx<Array<{
      action_id: string;
      action_type: string;
      attempts: number | string;
      error_code: string | null;
      failed_at: Date | string;
      state: string;
    }>>`
      select
        action.id as action_id,
        action.action_type,
        action.attempts,
        action.status as state,
        action.updated_at as failed_at,
        latest_attempt.error_code
      from workflow_actions action
      left join lateral (
        select attempt.error_code
        from workflow_action_attempts attempt
        where attempt.workflow_action_id = action.id
        order by attempt.occurred_at desc
        limit 1
      ) latest_attempt on true
      where action.status in ('failed', 'dead_letter')
      order by action.updated_at
      limit 200
    `;
    const timestamps = timestampRows[0];
    const services: OpsSystemHealth["services"] = [
      {
        detail: "Identity and passwordless access",
        label: "Supabase",
        lastSucceededAt: asIso(timestamps?.last_identity_at),
        state: configuration.supabase === "connected" ? "connected" : "unavailable",
      },
      {
        detail: "Membership operating record",
        label: "Postgres",
        lastSucceededAt: asIso(timestamps?.database_checked_at),
        state: configuration.database === "connected" ? "connected" : "unavailable",
      },
      {
        detail: "Read-only billing projection",
        label: "Stripe",
        lastSucceededAt: asIso(timestamps?.last_stripe_at),
        state: configuration.stripe === "connected" ? "connected" : "unavailable",
      },
      {
        detail: "Member notification delivery",
        label: "Notifications",
        lastSucceededAt: asIso(timestamps?.last_notification_at),
        state: failureRows.some((row) => row.action_type === "send_notification") ? "attention" : "connected",
      },
    ];
    return {
      canRetry: true,
      health: {
        services,
        workflowFailures: failureRows.map((row) => ({
          actionId: row.action_id,
          actionType: row.action_type,
          attempts: Number(row.attempts),
          errorCode: row.error_code ?? "unknown_failure",
          failedAt: asIso(row.failed_at)!,
          state: row.state,
        })),
      },
    };
  });
}

export async function appendOpsMemberNote(input: {
  actorAuthUserId: string;
  body: string;
  category: string;
  memberId: string;
}) {
  const memberId = requireUuid(input.memberId, "Member");
  const body = normalizedBody(input.body, "Note", 3, 10_000);
  const noteType = input.category.trim();
  if (!NOTE_TYPES.has(noteType)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Choose a valid note type.");
  }
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const access = await requireOperatorAccess(tx, input.actorAuthUserId, {
      lock: true,
      memberId,
      requireAdmin: true,
    });
    const memberRows = await tx<Array<{ id: string }>>`
      select id
      from ruined_members
      where id = ${memberId}::uuid
      for update
    `;
    if (!memberRows[0]) throw new OpsOperatingRepositoryError("not_found", "Member not found.");
    const rows = await tx<Array<{ id: string; occurred_at: Date | string }>>`
      insert into operator_member_notes (
        member_id,
        note_type,
        body_text,
        authored_by_auth_user_id,
        source,
        dedupe_key
      ) values (
        ${memberId}::uuid,
        ${noteType},
        ${body},
        ${access.authUserId}::uuid,
        'operator',
        ${randomUUID()}
      )
      returning id, occurred_at
    `;
    const note = rows[0];
    await writeAudit(tx, {
      action: "member.note_added",
      actorAuthUserId: access.authUserId,
      after: { noteType },
      memberId,
      subjectId: note.id,
      subjectType: "operator_member_note",
    });
    return { createdAt: asIso(note.occurred_at), id: note.id, noteType };
  });
}

type LifecycleOverrideRow = {
  account_state: string;
  administrative_onboarding_state: string;
  admission_state: string;
  artifact_state: string;
  current_progression_level_slug: string;
  standing_state: string;
  version: number | string;
};

export async function recordOpsMemberStateOverride(input: {
  actorAuthUserId: string;
  dimension: string;
  expectedLifecycleVersion: number;
  memberId: string;
  nextState: string;
  reason: string;
  reasonCode: string;
}) {
  const memberId = requireUuid(input.memberId, "Member");
  const dimension = input.dimension.trim();
  const nextState = input.nextState.trim();
  const allowedValues = OVERRIDE_VALUES[dimension];
  if (!allowedValues?.has(nextState)) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      "That state correction is not allowed. Billing, agreements, and Foundations completion cannot be overridden.",
    );
  }
  if (!Number.isSafeInteger(input.expectedLifecycleVersion) || input.expectedLifecycleVersion < 1) {
    throw new OpsOperatingRepositoryError("invalid_request", "The member record version is invalid.");
  }
  const reason = normalizedBody(input.reason, "Written reason", 12, 2_000);
  const reasonCode = normalizedText(input.reasonCode, "Reason code", 3, 80)
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, "_");
  const sql = getApplicationDatabase();

  return sql.begin(async (tx) => {
    const access = await requireOperatorAccess(tx, input.actorAuthUserId, {
      lock: true,
      memberId,
      requireAdmin: true,
    });
    const lifecycleRows = await tx<Array<LifecycleOverrideRow>>`
      select
        account_state,
        admission_state,
        administrative_onboarding_state,
        standing_state,
        artifact_state,
        current_progression_level_slug,
        version
      from member_lifecycle
      where member_id = ${memberId}::uuid
      for update
    `;
    const lifecycle = lifecycleRows[0];
    if (!lifecycle) throw new OpsOperatingRepositoryError("not_found", "Member not found.");
    if (Number(lifecycle.version) !== input.expectedLifecycleVersion) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "The member record changed. Refresh it before recording this correction.",
      );
    }
    const priorValues: Record<string, string> = {
      account: lifecycle.account_state,
      admission: lifecycle.admission_state,
      administrative_onboarding: lifecycle.administrative_onboarding_state,
      artifact: lifecycle.artifact_state,
      progression: lifecycle.current_progression_level_slug,
      standing: lifecycle.standing_state,
    };
    const previousValue = priorValues[dimension];
    if (previousValue === nextState) {
      throw new OpsOperatingRepositoryError("conflict", "The member is already in that state.");
    }

    if (dimension === "administrative_onboarding") {
      const onboardingRows = await tx<Array<{ member_id: string }>>`
        update member_onboardings
        set
          state = ${nextState},
          version = version + 1,
          updated_at = statement_timestamp()
        where member_id = ${memberId}::uuid
        returning member_id
      `;
      if (!onboardingRows[0]) {
        throw new OpsOperatingRepositoryError(
          "conflict",
          "The administrative onboarding record must exist before it can be corrected.",
        );
      }
    }

    if (dimension === "progression") {
      const currentAssignments = await tx<Array<{ id: string; progression_level_slug: string }>>`
        select id, progression_level_slug
        from member_progression_assignments
        where member_id = ${memberId}::uuid
          and ended_at is null
        order by id
        for update
      `;
      await tx`
        update member_progression_assignments
        set
          ended_at = statement_timestamp(),
          ended_by_auth_user_id = ${access.authUserId}::uuid,
          end_reason = ${reason}
        where member_id = ${memberId}::uuid
          and ended_at is null
      `;
      await tx`
        insert into member_progression_assignments (
          member_id,
          progression_level_slug,
          assigned_by_auth_user_id,
          assignment_reason
        ) values (
          ${memberId}::uuid,
          ${nextState},
          ${access.authUserId}::uuid,
          ${reason}
        )
      `;
      void currentAssignments;
    }

    const updateRows = dimension === "account"
      ? await tx<Array<{ version: number | string }>>`
          update member_lifecycle
          set account_state = ${nextState}, version = version + 1, updated_at = statement_timestamp()
          where member_id = ${memberId}::uuid and version = ${input.expectedLifecycleVersion}
          returning version
        `
      : dimension === "admission"
        ? await tx<Array<{ version: number | string }>>`
            update member_lifecycle
            set admission_state = ${nextState}, version = version + 1, updated_at = statement_timestamp()
            where member_id = ${memberId}::uuid and version = ${input.expectedLifecycleVersion}
            returning version
          `
        : dimension === "administrative_onboarding"
          ? await tx<Array<{ version: number | string }>>`
              update member_lifecycle
              set administrative_onboarding_state = ${nextState}, version = version + 1, updated_at = statement_timestamp()
              where member_id = ${memberId}::uuid and version = ${input.expectedLifecycleVersion}
              returning version
            `
          : dimension === "standing"
            ? await tx<Array<{ version: number | string }>>`
                update member_lifecycle
                set standing_state = ${nextState}, version = version + 1, updated_at = statement_timestamp()
                where member_id = ${memberId}::uuid and version = ${input.expectedLifecycleVersion}
                returning version
              `
            : dimension === "artifact"
              ? await tx<Array<{ version: number | string }>>`
                  update member_lifecycle
                  set artifact_state = ${nextState}, version = version + 1, updated_at = statement_timestamp()
                  where member_id = ${memberId}::uuid and version = ${input.expectedLifecycleVersion}
                  returning version
                `
              : await tx<Array<{ version: number | string }>>`
                  update member_lifecycle
                  set current_progression_level_slug = ${nextState}, version = version + 1, updated_at = statement_timestamp()
                  where member_id = ${memberId}::uuid and version = ${input.expectedLifecycleVersion}
                  returning version
                `;
    if (!updateRows[0]) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "The member record changed. Refresh it before recording this correction.",
      );
    }

    const overrideId = randomUUID();
    const correlationId = randomUUID();
    await tx`
      insert into member_state_overrides (
        id,
        member_id,
        action,
        dimension,
        previous_value,
        override_value,
        reason,
        actor_auth_user_id,
        correlation_id,
        evidence,
        dedupe_key
      ) values (
        ${overrideId}::uuid,
        ${memberId}::uuid,
        'applied',
        ${dimension},
        ${previousValue},
        ${nextState},
        ${reason},
        ${access.authUserId}::uuid,
        ${correlationId},
        ${tx.json({ expectedLifecycleVersion: input.expectedLifecycleVersion, reasonCode })},
        ${randomUUID()}
      )
    `;
    await tx`
      insert into member_state_history (
        member_id,
        dimension,
        previous_state,
        next_state,
        reason_code,
        source,
        source_event_id,
        actor_auth_user_id,
        correlation_id,
        metadata,
        dedupe_key
      ) values (
        ${memberId}::uuid,
        ${dimension},
        ${previousValue},
        ${nextState},
        ${reasonCode},
        'ops',
        ${overrideId},
        ${access.authUserId}::uuid,
        ${correlationId},
        ${tx.json({ reason })},
        ${randomUUID()}
      )
    `;
    await writeAudit(tx, {
      action: "member.state_override_applied",
      actorAuthUserId: access.authUserId,
      after: { dimension, value: nextState, version: Number(updateRows[0].version) },
      before: { dimension, value: previousValue, version: input.expectedLifecycleVersion },
      memberId,
      metadata: { correlationId, reasonCode },
      reason,
      subjectId: overrideId,
      subjectType: "member_state_override",
    });
    return {
      dimension,
      id: overrideId,
      nextState,
      previousState: previousValue,
      version: Number(updateRows[0].version),
    };
  });
}

export async function assignOpsAccountabilityPartner(input: {
  actorAuthUserId: string;
  circleId: string;
  memberId: string;
  partnerMemberId: string;
}) {
  const circleId = requireUuid(input.circleId, "Circle");
  const memberId = requireUuid(input.memberId, "Member");
  const partnerMemberId = requireUuid(input.partnerMemberId, "Partner member");
  if (memberId === partnerMemberId) {
    throw new OpsOperatingRepositoryError("invalid_request", "Choose a different Circle member.");
  }
  const [memberOneId, memberTwoId] = [memberId, partnerMemberId].sort();
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const access = await requireOperatorAccess(tx, input.actorAuthUserId, {
      lock: true,
      memberId,
    });
    if (!access.roles.includes("ops_admin")) {
      await requireOperatorAccess(tx, input.actorAuthUserId, { memberId: partnerMemberId });
    }
    const membershipRows = await tx<Array<{ member_id: string }>>`
      select assignment.member_id
      from circle_member_assignments assignment
      where assignment.circle_id = ${circleId}::uuid
        and assignment.member_id in (${memberId}::uuid, ${partnerMemberId}::uuid)
        and assignment.ended_at is null
      order by assignment.member_id
      for update
    `;
    if (membershipRows.length !== 2) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "Both accountability partners must be current members of the same Circle.",
      );
    }
    const existingRows = await tx<Array<{ id: string }>>`
      select id
      from accountability_partner_assignments
      where ended_at is null
        and (
          ${memberId}::uuid in (member_one_id, member_two_id)
          or ${partnerMemberId}::uuid in (member_one_id, member_two_id)
        )
      order by id
      for update
    `;
    if (existingRows.length > 0) {
      await tx`
        update accountability_partner_assignments
        set
          ended_at = statement_timestamp(),
          ended_by_auth_user_id = ${access.authUserId}::uuid,
          end_reason = 'Replaced by a new operator assignment'
        where id in ${tx(existingRows.map((row) => row.id))}
      `;
    }
    const assignmentRows = await tx<Array<{ assigned_at: Date | string; id: string }>>`
      insert into accountability_partner_assignments (
        circle_id,
        member_one_id,
        member_two_id,
        assigned_by_auth_user_id,
        assignment_reason
      ) values (
        ${circleId}::uuid,
        ${memberOneId}::uuid,
        ${memberTwoId}::uuid,
        ${access.authUserId}::uuid,
        'Operator assignment'
      )
      returning id, assigned_at
    `;
    const assignment = assignmentRows[0];
    await writeAudit(tx, {
      action: "circle.accountability_partner_assigned",
      actorAuthUserId: access.authUserId,
      after: { circleId, memberOneId, memberTwoId },
      memberId,
      metadata: { endedAssignmentIds: existingRows.map((row) => row.id) },
      subjectId: assignment.id,
      subjectType: "accountability_partner_assignment",
    });
    return { assignedAt: asIso(assignment.assigned_at), id: assignment.id };
  });
}

export async function createOpsTask(input: {
  actorAuthUserId: string;
  description: string;
  dueAt: string;
  memberId: string;
  priority: string;
  title: string;
}) {
  const memberId = requireUuid(input.memberId, "Member");
  const title = normalizedText(input.title, "Task title", 3, 200);
  const description = input.description.trim()
    ? normalizedBody(input.description, "Task context", 1, 5_000)
    : null;
  const priority = input.priority.trim();
  if (!new Set(["low", "normal", "high", "urgent"]).has(priority)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Choose a valid task priority.");
  }
  const dueAt = input.dueAt.trim() ? new Date(`${input.dueAt.trim()}T23:59:59.000Z`) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    throw new OpsOperatingRepositoryError("invalid_request", "Choose a valid due date.");
  }
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const access = await requireOperatorAccess(tx, input.actorAuthUserId, {
      lock: true,
      memberId,
      requireAdmin: true,
    });
    const memberRows = await tx<Array<{
      block_id: string | null;
      circle_id: string | null;
      person_id: string;
    }>>`
      select
        member.person_id,
        current_circle.circle_id,
        current_circle.block_id
      from ruined_members member
      left join lateral (
        select
          circle_assignment.circle_id,
          block_assignment.block_id
        from circle_member_assignments circle_assignment
        left join block_circle_assignments block_assignment
          on block_assignment.circle_id = circle_assignment.circle_id
         and block_assignment.ended_at is null
        where circle_assignment.member_id = member.id
          and circle_assignment.ended_at is null
        order by circle_assignment.assigned_at desc
        limit 1
      ) current_circle on true
      where member.id = ${memberId}::uuid
      for update of member
    `;
    const member = memberRows[0];
    if (!member) throw new OpsOperatingRepositoryError("not_found", "Member not found.");
    const taskId = randomUUID();
    const taskRows = await tx<Array<{ created_at: Date | string }>>`
      insert into operator_tasks (
        id,
        member_id,
        person_id,
        circle_id,
        block_id,
        task_type,
        title,
        description,
        priority,
        status,
        created_by_auth_user_id,
        due_at
      ) values (
        ${taskId}::uuid,
        ${memberId}::uuid,
        ${member.person_id}::uuid,
        ${member.circle_id}::uuid,
        ${member.block_id}::uuid,
        'member_follow_up',
        ${title},
        ${description},
        ${priority},
        'open',
        ${access.authUserId}::uuid,
        ${dueAt}
      )
      returning created_at
    `;
    await tx`
      insert into operator_task_events (
        operator_task_id,
        event_type,
        next_status,
        actor_auth_user_id,
        evidence,
        dedupe_key
      ) values (
        ${taskId}::uuid,
        'created',
        'open',
        ${access.authUserId}::uuid,
        ${tx.json({ priority })},
        ${randomUUID()}
      )
    `;
    await writeAudit(tx, {
      action: "task.created",
      actorAuthUserId: access.authUserId,
      after: { dueAt: asIso(dueAt), priority, state: "open", title },
      memberId,
      subjectId: taskId,
      subjectType: "operator_task",
    });
    return { createdAt: asIso(taskRows[0].created_at), id: taskId, state: "open" };
  });
}

export async function transitionOpsTask(input: {
  action: string;
  actorAuthUserId: string;
  taskId: string;
}) {
  const taskId = requireUuid(input.taskId, "Task");
  if (!new Set(["claim", "complete", "reopen"]).has(input.action)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Choose a valid task action.");
  }
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const access = await requireOperatorAccess(tx, input.actorAuthUserId, {
      lock: true,
      requireAdmin: true,
    });
    const taskRows = await tx<Array<{
      circle_id: string | null;
      member_id: string | null;
      status: string;
      version: number | string;
    }>>`
      select member_id, circle_id, status, version
      from operator_tasks
      where id = ${taskId}::uuid
      for update
    `;
    const task = taskRows[0];
    if (!task) throw new OpsOperatingRepositoryError("not_found", "Task not found.");
    const nextState = input.action === "claim" ? "in_progress" : input.action === "complete" ? "completed" : "open";
    const valid = input.action === "claim"
      ? task.status === "open"
      : input.action === "complete"
        ? new Set(["open", "in_progress"]).has(task.status)
        : task.status === "completed";
    if (!valid) {
      throw new OpsOperatingRepositoryError("conflict", "That task action is not available from its current state.");
    }

    const updatedRows = await tx<Array<{ completed_at: Date | string | null; version: number | string }>>`
      update operator_tasks
      set
        status = ${nextState},
        assigned_to_auth_user_id = case
          when ${input.action} = 'claim' then ${access.authUserId}::uuid
          else assigned_to_auth_user_id
        end,
        completed_at = case
          when ${nextState} = 'completed' then statement_timestamp()
          when ${nextState} = 'open' then null
          else completed_at
        end,
        version = version + 1,
        updated_at = statement_timestamp()
      where id = ${taskId}::uuid
        and version = ${Number(task.version)}
      returning completed_at, version
    `;
    if (!updatedRows[0]) throw new OpsOperatingRepositoryError("conflict", "The task changed. Refresh and try again.");
    const eventType = input.action === "claim" ? "assigned" : input.action === "complete" ? "completed" : "state_changed";
    await tx`
      insert into operator_task_events (
        operator_task_id,
        event_type,
        previous_status,
        next_status,
        actor_auth_user_id,
        evidence,
        dedupe_key
      ) values (
        ${taskId}::uuid,
        ${eventType},
        ${task.status},
        ${nextState},
        ${access.authUserId}::uuid,
        ${tx.json({ action: input.action })},
        ${randomUUID()}
      )
    `;
    await writeAudit(tx, {
      action: `task.${input.action}`,
      actorAuthUserId: access.authUserId,
      after: { state: nextState, version: Number(updatedRows[0].version) },
      before: { state: task.status, version: Number(task.version) },
      memberId: task.member_id,
      subjectId: taskId,
      subjectType: "operator_task",
    });
    return {
      completedAt: asIso(updatedRows[0].completed_at),
      id: taskId,
      state: nextState,
      version: Number(updatedRows[0].version),
    };
  });
}

export async function retryOpsWorkflowAction(input: {
  actorAuthUserId: string;
  workflowActionId: string;
}) {
  const workflowActionId = requireUuid(input.workflowActionId, "Workflow action");
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const access = await requireOperatorAccess(tx, input.actorAuthUserId, {
      lock: true,
      requireAdmin: true,
    });
    const rows = await tx<Array<{ attempts: number | string; status: string }>>`
      select status, attempts
      from workflow_actions
      where id = ${workflowActionId}::uuid
      for update
    `;
    const action = rows[0];
    if (!action) throw new OpsOperatingRepositoryError("not_found", "Workflow action not found.");
    if (action.status === "dead_letter") {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "This action exhausted its retry allowance and needs a new operator task.",
      );
    }
    if (action.status !== "failed") {
      throw new OpsOperatingRepositoryError("conflict", "Only failed actions can be retried.");
    }
    await tx`
      update workflow_actions
      set
        status = 'pending',
        available_at = statement_timestamp(),
        locked_at = null,
        locked_by = null,
        last_error = null,
        updated_at = statement_timestamp()
      where id = ${workflowActionId}::uuid
    `;
    await writeAudit(tx, {
      action: "workflow.retry_queued",
      actorAuthUserId: access.authUserId,
      after: { attempts: Number(action.attempts), state: "pending" },
      before: { attempts: Number(action.attempts), state: action.status },
      subjectId: workflowActionId,
      subjectType: "workflow_action",
    });
    return { id: workflowActionId, state: "pending" };
  });
}

export async function transitionOpsArtifactJob(input: {
  actorAuthUserId: string;
  artifactJobId: string;
  nextState: string;
  reason: string;
}) {
  const artifactJobId = requireUuid(input.artifactJobId, "Artifact job");
  const nextState = input.nextState.trim();
  const reason = normalizedBody(input.reason, "Reason", 3, 500);
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const access = await requireOperatorAccess(tx, input.actorAuthUserId, {
      lock: true,
      requireAdmin: true,
    });
    const jobRows = await tx<Array<{
      artifact_award_id: string | null;
      member_id: string;
      status: string;
    }>>`
      select member_id, artifact_award_id, status
      from artifact_jobs
      where id = ${artifactJobId}::uuid
      for update
    `;
    const job = jobRows[0];
    if (!job) throw new OpsOperatingRepositoryError("not_found", "Artifact job not found.");
    if (!ARTIFACT_TRANSITIONS[job.status]?.has(nextState)) {
      throw new OpsOperatingRepositoryError("conflict", "That Artifact transition is not available.");
    }

    const lifecycleRows = await tx<Array<{ artifact_state: string; version: number | string }>>`
      select artifact_state, version
      from member_lifecycle
      where member_id = ${job.member_id}::uuid
      for update
    `;
    const updatedRows = await tx<Array<{ completed_at: Date | string | null }>>`
      update artifact_jobs
      set
        status = ${nextState},
        assigned_to_auth_user_id = coalesce(assigned_to_auth_user_id, ${access.authUserId}::uuid),
        production_started_at = case
          when ${nextState} = 'in_production' then coalesce(production_started_at, statement_timestamp())
          else production_started_at
        end,
        completed_at = case when ${nextState} = 'fulfilled' then statement_timestamp() else completed_at end,
        updated_at = statement_timestamp()
      where id = ${artifactJobId}::uuid
      returning completed_at
    `;
    await tx`
      insert into artifact_job_events (
        artifact_job_id,
        previous_status,
        next_status,
        reason_code,
        actor_auth_user_id,
        metadata
      ) values (
        ${artifactJobId}::uuid,
        ${job.status},
        ${nextState},
        'operator_transition',
        ${access.authUserId}::uuid,
        ${tx.json({ reason })}
      )
    `;

    if (job.artifact_award_id && nextState !== "canceled") {
      const awardRows = await tx<Array<{ status: string }>>`
        select status
        from artifact_awards
        where id = ${job.artifact_award_id}::uuid
        for update
      `;
      const award = awardRows[0];
      const awardState = nextState === "fulfilled" ? "fulfilled" : "in_fulfillment";
      if (award && award.status !== awardState && award.status !== "revoked") {
        await tx`
          update artifact_awards
          set status = ${awardState}, version = version + 1, updated_at = statement_timestamp()
          where id = ${job.artifact_award_id}::uuid
        `;
        await tx`
          insert into artifact_award_events (
            artifact_award_id,
            event_type,
            previous_status,
            next_status,
            actor_auth_user_id,
            evidence,
            dedupe_key
          ) values (
            ${job.artifact_award_id}::uuid,
            ${awardState === "fulfilled" ? "fulfilled" : "fulfillment_started"},
            ${award.status},
            ${awardState},
            ${access.authUserId}::uuid,
            ${tx.json({ artifactJobId, reason })},
            ${randomUUID()}
          )
        `;
      }
    }

    const lifecycle = lifecycleRows[0];
    const projectedArtifactState = nextState === "fulfilled"
      ? "fulfilled"
      : new Set(["in_production", "review", "ready"]).has(nextState)
        ? "in_production"
        : nextState === "canceled"
          ? lifecycle?.artifact_state
          : "collecting";
    if (lifecycle && projectedArtifactState && lifecycle.artifact_state !== projectedArtifactState) {
      await tx`
        update member_lifecycle
        set
          artifact_state = ${projectedArtifactState},
          version = version + 1,
          updated_at = statement_timestamp()
        where member_id = ${job.member_id}::uuid
          and version = ${Number(lifecycle.version)}
      `;
      await tx`
        insert into member_state_history (
          member_id,
          dimension,
          previous_state,
          next_state,
          reason_code,
          source,
          source_event_id,
          actor_auth_user_id,
          metadata,
          dedupe_key
        ) values (
          ${job.member_id}::uuid,
          'artifact',
          ${lifecycle.artifact_state},
          ${projectedArtifactState},
          'artifact_job_transition',
          'ops',
          ${artifactJobId},
          ${access.authUserId}::uuid,
          ${tx.json({ reason })},
          ${randomUUID()}
        )
      `;
    }
    await writeAudit(tx, {
      action: "artifact.job_transitioned",
      actorAuthUserId: access.authUserId,
      after: { state: nextState },
      before: { state: job.status },
      memberId: job.member_id,
      reason,
      subjectId: artifactJobId,
      subjectType: "artifact_job",
    });
    return { completedAt: asIso(updatedRows[0]?.completed_at), id: artifactJobId, state: nextState };
  });
}

export async function createOpsAnnouncement(input: {
  actorAuthUserId: string;
  body: string;
  targetKind: string;
  title: string;
}) {
  const title = normalizedText(input.title, "Title", 3, 200);
  const body = normalizedBody(input.body, "Announcement", 3, 10_000);
  if (input.targetKind !== "all_active_members") {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      "This draft form currently supports the all-active-members audience only.",
    );
  }
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const access = await requireOperatorAccess(tx, input.actorAuthUserId, {
      lock: true,
      requireAdmin: true,
    });
    const announcementId = randomUUID();
    await tx`
      insert into member_announcements (
        id,
        title,
        body_text,
        status,
        created_by_auth_user_id,
        updated_by_auth_user_id
      ) values (
        ${announcementId}::uuid,
        ${title},
        ${body},
        'draft',
        ${access.authUserId}::uuid,
        ${access.authUserId}::uuid
      )
    `;
    await tx`
      insert into member_announcement_targets (
        announcement_id,
        target_type,
        created_by_auth_user_id
      ) values (
        ${announcementId}::uuid,
        'all_active_members',
        ${access.authUserId}::uuid
      )
    `;
    await writeAudit(tx, {
      action: "announcement.draft_created",
      actorAuthUserId: access.authUserId,
      after: { state: "draft", targetType: "all_active_members", title },
      subjectId: announcementId,
      subjectType: "member_announcement",
    });
    return { id: announcementId, state: "draft" };
  });
}

export async function publishOpsAnnouncement(input: {
  actorAuthUserId: string;
  announcementId: string;
}) {
  const announcementId = requireUuid(input.announcementId, "Announcement");
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const access = await requireOperatorAccess(tx, input.actorAuthUserId, {
      lock: true,
      requireAdmin: true,
    });
    const rows = await tx<Array<{ status: string; title: string; version: number | string }>>`
      select title, status, version
      from member_announcements
      where id = ${announcementId}::uuid
      for update
    `;
    const announcement = rows[0];
    if (!announcement) {
      throw new OpsOperatingRepositoryError("not_found", "Announcement not found.");
    }
    if (announcement.status !== "draft") {
      throw new OpsOperatingRepositoryError("conflict", "Only a draft announcement can be published.");
    }
    const targetRows = await tx<Array<{ id: string }>>`
      select id
      from member_announcement_targets
      where announcement_id = ${announcementId}::uuid
      order by id
      for update
    `;
    if (targetRows.length === 0) {
      throw new OpsOperatingRepositoryError("conflict", "Choose an audience before publishing.");
    }
    const publishedRows = await tx<Array<{ published_at: Date | string; version: number | string }>>`
      update member_announcements
      set
        status = 'published',
        published_at = statement_timestamp(),
        updated_by_auth_user_id = ${access.authUserId}::uuid,
        version = version + 1,
        updated_at = statement_timestamp()
      where id = ${announcementId}::uuid
        and version = ${Number(announcement.version)}
      returning published_at, version
    `;
    if (!publishedRows[0]) {
      throw new OpsOperatingRepositoryError("conflict", "The announcement changed. Refresh and try again.");
    }

    const eventRows = await tx<Array<{ id: string }>>`
      insert into domain_events (
        aggregate_type,
        aggregate_id,
        event_type,
        actor_auth_user_id,
        payload,
        dedupe_key
      ) values (
        'member_announcement',
        ${announcementId},
        'announcement.published',
        ${access.authUserId}::uuid,
        ${tx.json({ announcementId, targetCount: targetRows.length })},
        ${`announcement-published:${announcementId}:${Number(publishedRows[0].version)}`}
      )
      returning id
    `;
    await tx`
      insert into workflow_actions (
        domain_event_id,
        action_type,
        target_type,
        target_id,
        payload,
        idempotency_key
      ) values (
        ${eventRows[0].id}::uuid,
        'send_notification',
        'member_announcement',
        ${announcementId},
        ${tx.json({ announcementId })},
        ${`send-announcement:${announcementId}:${Number(publishedRows[0].version)}`}
      )
    `;
    await writeAudit(tx, {
      action: "announcement.published",
      actorAuthUserId: access.authUserId,
      after: { state: "published", version: Number(publishedRows[0].version) },
      before: { state: announcement.status, version: Number(announcement.version) },
      subjectId: announcementId,
      subjectType: "member_announcement",
    });
    return {
      id: announcementId,
      publishedAt: asIso(publishedRows[0].published_at),
      state: "published",
    };
  });
}
