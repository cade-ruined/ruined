import "server-only";

import { randomUUID } from "node:crypto";
import postgres from "postgres";

import type {
  MemberFoundationEnrollmentStatus,
  MemberFoundationsState,
  MemberFoundationUnit,
  MemberFoundationUnitStatus,
} from "@/lib/foundations/model";
import type { PlatformViewer } from "@/lib/platform/model";
import { getApplicationDatabase } from "@/lib/database/server";

type FoundationTransaction = postgres.TransactionSql;

type LockedMember = {
  accountState: "active" | "closed" | "invited" | "provisional" | "suspended";
  billingState: "active" | "attention_required" | "ended" | "pending";
  foundationsState: "completed" | "in_progress" | "not_started";
  memberId: string;
  programState: "active" | "completed" | "onboarding" | "paused" | "prospect" | "withdrawn";
};

type EnrollmentRow = {
  foundation_version_id: string;
  id: string;
  progress_percent: number;
  status: MemberFoundationEnrollmentStatus;
};

type VersionRow = {
  id: string;
  title: string;
  version: number;
};

type UnitRow = {
  chapter_id: string | null;
  id: string;
  kind: string | null;
  label: string;
  position: number;
  stage: string | null;
  status: MemberFoundationUnitStatus | null;
  unit_slug: string;
};

export class FoundationAccessError extends Error {
  constructor(message = "Active membership access is required for Foundations.") {
    super(message);
    this.name = "FoundationAccessError";
  }
}

export class FoundationSequenceError extends Error {
  constructor(message = "Continue Foundations in order from your next unfinished moment.") {
    super(message);
    this.name = "FoundationSequenceError";
  }
}

export class FoundationUnavailableError extends Error {
  constructor(message = "A published Foundations version is not available yet.") {
    super(message);
    this.name = "FoundationUnavailableError";
  }
}

export class CircleRequiredForFoundationCompletionError extends Error {
  constructor() {
    super("An active Circle assignment is required before Foundations can be completed.");
    this.name = "CircleRequiredForFoundationCompletionError";
  }
}

function asProgress(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 10_000) / 100;
}

function canUseFoundations(member: LockedMember): boolean {
  return (
    member.accountState === "active" &&
    member.billingState === "active" &&
    (member.programState === "onboarding" || member.programState === "active")
  );
}

async function lockMemberForFoundations(
  tx: FoundationTransaction,
  viewer: PlatformViewer,
): Promise<LockedMember> {
  const links = await tx<Array<{ member_id: string }>>`
    select member_id
    from platform_users
    where auth_user_id = ${viewer.authUserId}::uuid
      and email_normalized = lower(btrim(${viewer.email}))
      and user_type = 'member'
      and status = 'active'
      and member_id is not null
    limit 1
  `;
  const memberId = links[0]?.member_id;
  if (!memberId) throw new FoundationAccessError();

  // Stripe locks ruined_members before member_lifecycle. Reuse that ordering so
  // billing webhooks and Foundation writes cannot deadlock one another.
  const members = await tx<Array<{ id: string }>>`
    select id
    from ruined_members
    where id = ${memberId}::uuid
    for update
  `;
  if (!members[0]) throw new FoundationAccessError();

  const lifecycleRows = await tx<
    Array<{
      account_state: LockedMember["accountState"];
      billing_state: LockedMember["billingState"];
      foundations_state: LockedMember["foundationsState"];
      program_state: LockedMember["programState"];
    }>
  >`
    select account_state, billing_state, foundations_state, program_state
    from member_lifecycle
    where member_id = ${memberId}::uuid
    for update
  `;
  const lifecycle = lifecycleRows[0];
  if (!lifecycle) throw new FoundationAccessError();

  const member: LockedMember = {
    accountState: lifecycle.account_state,
    billingState: lifecycle.billing_state,
    foundationsState: lifecycle.foundations_state,
    memberId,
    programState: lifecycle.program_state,
  };
  if (!canUseFoundations(member)) throw new FoundationAccessError();
  return member;
}

async function selectedEnrollment(
  tx: FoundationTransaction,
  memberId: string,
): Promise<EnrollmentRow | null> {
  const rows = await tx<Array<EnrollmentRow>>`
    select
      enrollment.id,
      enrollment.foundation_version_id,
      enrollment.progress_percent,
      enrollment.status
    from foundation_enrollments enrollment
    join foundation_versions version_record
      on version_record.id = enrollment.foundation_version_id
    join foundation_programs program_record
      on program_record.id = version_record.foundation_program_id
    where enrollment.member_id = ${memberId}::uuid
      and enrollment.status <> 'withdrawn'
      and program_record.slug = 'ruined-foundations'
    order by
      case enrollment.status when 'completed' then 1 else 0 end,
      enrollment.created_at desc
    limit 1
    for update
  `;
  return rows[0] ?? null;
}

async function currentPublishedVersion(tx: FoundationTransaction): Promise<VersionRow> {
  const rows = await tx<Array<VersionRow>>`
    select version_record.id, version_record.title, version_record.version
    from foundation_versions version_record
    join foundation_programs program_record
      on program_record.id = version_record.foundation_program_id
    where version_record.status = 'published'
      and program_record.slug = 'ruined-foundations'
    order by version_record.published_at desc, version_record.version desc
    limit 1
  `;
  if (!rows[0]) throw new FoundationUnavailableError();
  return rows[0];
}

async function ensureEnrollment(
  tx: FoundationTransaction,
  memberId: string,
): Promise<EnrollmentRow> {
  const existing = await selectedEnrollment(tx, memberId);
  if (existing) return existing;

  const version = await currentPublishedVersion(tx);
  const rows = await tx<Array<EnrollmentRow>>`
    insert into foundation_enrollments (
      id,
      member_id,
      foundation_version_id,
      progress_percent,
      status,
      enrolled_at
    ) values (
      ${randomUUID()}::uuid,
      ${memberId}::uuid,
      ${version.id}::uuid,
      0,
      'not_started',
      now()
    )
    returning id, foundation_version_id, progress_percent, status
  `;
  if (!rows[0]) throw new FoundationUnavailableError();
  return rows[0];
}

async function unitRows(
  tx: FoundationTransaction,
  enrollment: EnrollmentRow,
): Promise<UnitRow[]> {
  return tx<Array<UnitRow>>`
    select
      unit.id,
      unit.unit_slug,
      unit.position,
      unit.title as label,
      unit.configuration ->> 'stage' as stage,
      unit.configuration ->> 'kind' as kind,
      unit.configuration ->> 'chapter' as chapter_id,
      progress.status
    from foundation_units unit
    left join foundation_unit_progress progress
      on progress.enrollment_id = ${enrollment.id}::uuid
      and progress.unit_id = unit.id
      and progress.foundation_version_id = ${enrollment.foundation_version_id}::uuid
    where unit.foundation_version_id = ${enrollment.foundation_version_id}::uuid
      and unit.is_required = true
    order by unit.position asc
  `;
}

export async function getMemberFoundationsState(
  authUserId: string,
): Promise<MemberFoundationsState | null> {
  const sql = getApplicationDatabase();
  return sql.begin("isolation level repeatable read read only", async (tx) => {
  const memberRows = await tx<
    Array<{
      circle_name: string | null;
      circle_status: MemberFoundationsState["activeCircleStatus"];
      member_id: string;
    }>
  >`
    select
      platform_user.member_id,
      active_circle.name as circle_name,
      active_circle.status as circle_status
    from platform_users platform_user
    join ruined_members member on member.id = platform_user.member_id
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
    left join lateral (
      select circle.name, circle.status
      from circle_member_assignments assignment
      join circles circle on circle.id = assignment.circle_id
      where assignment.member_id = platform_user.member_id
        and assignment.ended_at is null
        and assignment.assigned_at <= now()
      order by assignment.assigned_at desc
      limit 1
    ) active_circle on true
    where platform_user.auth_user_id = ${authUserId}::uuid
      and platform_user.user_type = 'member'
      and platform_user.status = 'active'
      and platform_user.member_id is not null
      and lifecycle.account_state = 'active'
      and lifecycle.billing_state = 'active'
      and lifecycle.program_state in ('onboarding', 'active')
    limit 1
  `;
  const member = memberRows[0];
  if (!member?.member_id) return null;

  const enrollmentRows = await tx<Array<EnrollmentRow>>`
    select
      enrollment.id,
      enrollment.foundation_version_id,
      enrollment.progress_percent,
      enrollment.status
    from foundation_enrollments enrollment
    join foundation_versions version_record
      on version_record.id = enrollment.foundation_version_id
    join foundation_programs program_record
      on program_record.id = version_record.foundation_program_id
    where enrollment.member_id = ${member.member_id}::uuid
      and enrollment.status <> 'withdrawn'
      and program_record.slug = 'ruined-foundations'
    order by
      case enrollment.status when 'completed' then 1 else 0 end,
      enrollment.created_at desc
    limit 1
  `;
  const enrollment = enrollmentRows[0] ?? null;
  const versionRows = enrollment
    ? await tx<Array<VersionRow>>`
        select id, title, version
        from foundation_versions
        where id = ${enrollment.foundation_version_id}::uuid
        limit 1
      `
    : await tx<Array<VersionRow>>`
        select version_record.id, version_record.title, version_record.version
        from foundation_versions version_record
        join foundation_programs program_record
          on program_record.id = version_record.foundation_program_id
        where version_record.status = 'published'
          and program_record.slug = 'ruined-foundations'
        order by version_record.published_at desc, version_record.version desc
        limit 1
      `;
  const version = versionRows[0];
  if (!version) return null;

  const rows = await tx<Array<UnitRow>>`
    select
      unit.id,
      unit.unit_slug,
      unit.position,
      unit.title as label,
      unit.configuration ->> 'stage' as stage,
      unit.configuration ->> 'kind' as kind,
      unit.configuration ->> 'chapter' as chapter_id,
      progress.status
    from foundation_units unit
    left join foundation_unit_progress progress
      on progress.enrollment_id = ${enrollment?.id ?? null}::uuid
      and progress.unit_id = unit.id
      and progress.foundation_version_id = ${version.id}::uuid
    where unit.foundation_version_id = ${version.id}::uuid
      and unit.is_required = true
    order by unit.position asc
  `;
  const units: MemberFoundationUnit[] = rows.map((row) => ({
    chapterId: row.chapter_id,
    id: row.unit_slug,
    kind: row.kind ?? "moment",
    label: row.label,
    position: row.position,
    stage: row.stage ?? row.chapter_id ?? "entry",
    status: row.status ?? "not_started",
  }));
  const completedUnits = units.filter((unit) => unit.status === "completed").length;
  const totalUnits = units.length;
  const progressPercent = asProgress(completedUnits, totalUnits);
  const hasActiveCircle = member.circle_status === "active";
  const readyForCircle =
    totalUnits > 0 && completedUnits === totalUnits - 1 && !hasActiveCircle;

  return {
    activeCircleName: member.circle_name,
    activeCircleStatus: member.circle_status,
    completedUnits,
    completionAvailable:
      totalUnits > 0 && completedUnits === totalUnits - 1 && hasActiveCircle,
    enrollmentId: enrollment?.id ?? null,
    nextMomentId: units.find((unit) => unit.status !== "completed")?.id ?? null,
    progressPercent:
      enrollment?.status === "completed" ? 100 : Math.max(progressPercent, 0),
    readyForCircle,
    status: enrollment?.status ?? "not_started",
    totalUnits,
    units,
    version: version.version,
    versionTitle: version.title,
  };
  });
}

export async function startMemberFoundations(
  viewer: PlatformViewer,
): Promise<MemberFoundationsState> {
  const sql = getApplicationDatabase();
  await sql.begin(async (tx) => {
    const member = await lockMemberForFoundations(tx, viewer);
    const enrollment = await ensureEnrollment(tx, member.memberId);
    if (enrollment.status === "completed") return;

    const firstUnits = await tx<Array<{ id: string }>>`
      select id
      from foundation_units
      where foundation_version_id = ${enrollment.foundation_version_id}::uuid
        and is_required = true
      order by position asc
      limit 1
    `;
    const firstUnit = firstUnits[0];
    if (!firstUnit) throw new FoundationUnavailableError();

    await tx`
      insert into foundation_unit_progress (
        enrollment_id,
        unit_id,
        foundation_version_id,
        progress_percent,
        status,
        started_at
      ) values (
        ${enrollment.id}::uuid,
        ${firstUnit.id}::uuid,
        ${enrollment.foundation_version_id}::uuid,
        0,
        'in_progress',
        now()
      )
      on conflict (enrollment_id, unit_id) do update
      set
        status = case
          when foundation_unit_progress.status in ('not_started', 'blocked') then 'in_progress'
          else foundation_unit_progress.status
        end,
        started_at = coalesce(foundation_unit_progress.started_at, now()),
        updated_at = now()
    `;
    await tx`
      update foundation_enrollments
      set
        status = case when status in ('not_started', 'paused') then 'in_progress' else status end,
        started_at = coalesce(started_at, now()),
        updated_at = now()
      where id = ${enrollment.id}::uuid
    `;

    if (member.foundationsState === "not_started") {
      await tx`
        update member_lifecycle
        set foundations_state = 'in_progress', version = version + 1, updated_at = now()
        where member_id = ${member.memberId}::uuid
          and foundations_state = 'not_started'
      `;
      await tx`
        insert into member_state_history (
          member_id,
          dimension,
          previous_state,
          next_state,
          reason_code,
          source,
          actor_auth_user_id,
          dedupe_key,
          metadata
        ) values (
          ${member.memberId}::uuid,
          'foundations',
          'not_started',
          'in_progress',
          'member_started_foundations',
          'member',
          ${viewer.authUserId}::uuid,
          ${`foundation-started:${enrollment.id}`},
          jsonb_build_object('enrollment_id', ${enrollment.id})
        )
        on conflict (dedupe_key) do nothing
      `;
    }
  });

  const state = await getMemberFoundationsState(viewer.authUserId);
  if (!state) throw new FoundationUnavailableError();
  return state;
}

export async function recordMemberFoundationProgress(
  viewer: PlatformViewer,
  momentId: string,
): Promise<MemberFoundationsState> {
  const sql = getApplicationDatabase();
  await sql.begin(async (tx) => {
    const member = await lockMemberForFoundations(tx, viewer);
    const enrollment = await selectedEnrollment(tx, member.memberId);
    if (!enrollment || enrollment.status === "not_started") {
      throw new FoundationSequenceError("Begin Foundations before saving progress.");
    }
    if (enrollment.status === "completed") return;

    const units = await unitRows(tx, enrollment);
    const target = units.find((unit) => unit.unit_slug === momentId);
    if (!target) throw new FoundationSequenceError("That Foundations moment is not part of this version.");

    const firstIncomplete = units.find((unit) => unit.status !== "completed");
    if (!firstIncomplete) return;
    if (target.position < firstIncomplete.position) return;
    if (target.position > firstIncomplete.position) throw new FoundationSequenceError();
    if (target.id === units.at(-1)?.id) {
      throw new FoundationSequenceError("Use the final completion step for the last Foundations moment.");
    }

    await tx`
      insert into foundation_unit_progress (
        enrollment_id,
        unit_id,
        foundation_version_id,
        progress_percent,
        status,
        started_at,
        completed_at,
        updated_at
      ) values (
        ${enrollment.id}::uuid,
        ${target.id}::uuid,
        ${enrollment.foundation_version_id}::uuid,
        100,
        'completed',
        now(),
        now(),
        now()
      )
      on conflict (enrollment_id, unit_id) do update
      set
        progress_percent = 100,
        status = 'completed',
        started_at = coalesce(foundation_unit_progress.started_at, now()),
        completed_at = coalesce(foundation_unit_progress.completed_at, now()),
        updated_at = now()
      where foundation_unit_progress.status <> 'completed'
    `;

    const targetIndex = units.findIndex((unit) => unit.id === target.id);
    const nextUnit = units[targetIndex + 1];
    if (nextUnit) {
      await tx`
        insert into foundation_unit_progress (
          enrollment_id,
          unit_id,
          foundation_version_id,
          progress_percent,
          status,
          started_at
        ) values (
          ${enrollment.id}::uuid,
          ${nextUnit.id}::uuid,
          ${enrollment.foundation_version_id}::uuid,
          0,
          'in_progress',
          now()
        )
        on conflict (enrollment_id, unit_id) do update
        set
          status = case
            when foundation_unit_progress.status in ('not_started', 'blocked') then 'in_progress'
            else foundation_unit_progress.status
          end,
          started_at = coalesce(foundation_unit_progress.started_at, now()),
          updated_at = now()
      `;
    }

    const completed = units.filter((unit) => unit.status === "completed").length + 1;
    await tx`
      update foundation_enrollments
      set
        progress_percent = ${asProgress(completed, units.length)},
        status = 'in_progress',
        started_at = coalesce(started_at, now()),
        updated_at = now()
      where id = ${enrollment.id}::uuid
        and status <> 'completed'
    `;
  });

  const state = await getMemberFoundationsState(viewer.authUserId);
  if (!state) throw new FoundationUnavailableError();
  return state;
}

export function isCircleCompletionConstraint(error: unknown): boolean {
  const databaseError = error as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
  const constraint = databaseError.constraint ?? databaseError.constraint_name;
  return (
    databaseError.code === "23514" &&
    typeof constraint === "string" &&
    constraint.includes("foundation_completion_requires_circle")
  );
}

export async function completeMemberFoundations(
  viewer: PlatformViewer,
): Promise<MemberFoundationsState> {
  const sql = getApplicationDatabase();
  try {
    await sql.begin(async (tx) => {
      const member = await lockMemberForFoundations(tx, viewer);
      const enrollment = await selectedEnrollment(tx, member.memberId);
      if (!enrollment) throw new FoundationSequenceError("Begin Foundations before completing it.");
      if (enrollment.status === "completed") return;

      const units = await unitRows(tx, enrollment);
      const finalUnit = units.at(-1);
      if (!finalUnit || units.length === 0) throw new FoundationUnavailableError();
      const incompleteBeforeFinal = units.filter(
        (unit) => unit.position < finalUnit.position && unit.status !== "completed",
      );
      if (incompleteBeforeFinal.length > 0) throw new FoundationSequenceError();

      const circleRows = await tx<
        Array<{ assignment_id: string; circle_id: string; circle_name: string }>
      >`
        select
          assignment.id as assignment_id,
          circle.id as circle_id,
          circle.name as circle_name
        from circle_member_assignments assignment
        join circles circle on circle.id = assignment.circle_id
        where assignment.member_id = ${member.memberId}::uuid
          and assignment.ended_at is null
          and assignment.assigned_at <= statement_timestamp()
          and circle.status = 'active'
          and circle.activated_at is not null
          and circle.activated_at <= statement_timestamp()
          and (circle.ends_at is null or circle.ends_at >= statement_timestamp())
        order by assignment.assigned_at desc
        limit 1
        for no key update of circle
      `;
      const circle = circleRows[0];
      if (!circle) throw new CircleRequiredForFoundationCompletionError();

      await tx`
        insert into foundation_unit_progress (
          enrollment_id,
          unit_id,
          foundation_version_id,
          progress_percent,
          status,
          started_at,
          completed_at,
          updated_at
        ) values (
          ${enrollment.id}::uuid,
          ${finalUnit.id}::uuid,
          ${enrollment.foundation_version_id}::uuid,
          100,
          'completed',
          statement_timestamp(),
          statement_timestamp(),
          statement_timestamp()
        )
        on conflict (enrollment_id, unit_id) do update
        set
          progress_percent = 100,
          status = 'completed',
          started_at = coalesce(foundation_unit_progress.started_at, statement_timestamp()),
          completed_at = coalesce(foundation_unit_progress.completed_at, statement_timestamp()),
          updated_at = statement_timestamp()
      `;
      const completedRows = await tx<
        Array<{ completed_at: Date; completion_circle_assignment_id: string }>
      >`
        update foundation_enrollments
        set
          progress_percent = 100,
          status = 'completed',
          completed_at = coalesce(completed_at, statement_timestamp()),
          updated_at = statement_timestamp()
        where id = ${enrollment.id}::uuid
        returning completed_at, completion_circle_assignment_id
      `;
      const completion = completedRows[0];
      const completionProof = completion?.completion_circle_assignment_id;
      if (!completion || !completionProof) {
        throw new CircleRequiredForFoundationCompletionError();
      }

      await tx`
        update member_lifecycle
        set
          foundations_state = 'completed',
          program_state = case when program_state = 'onboarding' then 'active' else program_state end,
          version = version + 1,
          updated_at = ${completion.completed_at}
        where member_id = ${member.memberId}::uuid
      `;
      await tx`
        insert into member_state_history (
          member_id,
          dimension,
          previous_state,
          next_state,
          reason_code,
          source,
          actor_auth_user_id,
          dedupe_key,
          occurred_at,
          metadata
        ) values (
          ${member.memberId}::uuid,
          'foundations',
          ${member.foundationsState},
          'completed',
          'member_completed_foundations_with_circle',
          'member',
          ${viewer.authUserId}::uuid,
          ${`foundation-completed:${enrollment.id}`},
          ${completion.completed_at},
          jsonb_build_object(
            'enrollment_id', ${enrollment.id},
            'circle_id', ${circle.circle_id},
            'circle_assignment_id', ${completionProof}
          )
        )
        on conflict (dedupe_key) do nothing
      `;
      if (member.programState === "onboarding") {
        await tx`
          insert into member_state_history (
            member_id,
            dimension,
            previous_state,
            next_state,
            reason_code,
            source,
            actor_auth_user_id,
            dedupe_key,
            occurred_at,
            metadata
          ) values (
            ${member.memberId}::uuid,
            'program',
            'onboarding',
            'active',
            'foundations_completed_with_circle',
            'system',
            ${viewer.authUserId}::uuid,
            ${`program-activated-after-foundations:${enrollment.id}`},
            ${completion.completed_at},
            jsonb_build_object(
              'enrollment_id', ${enrollment.id},
              'circle_id', ${circle.circle_id},
              'circle_assignment_id', ${completionProof}
            )
          )
          on conflict (dedupe_key) do nothing
        `;
      }
    });
  } catch (error) {
    if (isCircleCompletionConstraint(error)) {
      throw new CircleRequiredForFoundationCompletionError();
    }
    throw error;
  }

  const state = await getMemberFoundationsState(viewer.authUserId);
  if (!state) throw new FoundationUnavailableError();
  return state;
}
