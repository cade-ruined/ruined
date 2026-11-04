import "server-only";

import type postgres from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { isFoundationsAvailableToMember, isFoundationsLaunched } from "@/lib/foundations/availability";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { lockBadgeOwner } from "@/lib/membership/badge-repository";
import type { MemberIdentity } from "@/lib/membership/model";
import { getMemberIdentity, readTimelineRecord, requireLockedMemberWriteAccess, validateTimelineInput, writeLegacyTimelineEntry } from "@/lib/membership/repository";
import { PracticeError, parsePracticeAction, type PracticeAction, type PracticeBadge, type PracticeCategory, type PracticeCourse, type PracticeSnapshot, type PracticeTimelineDraft } from "./model";

type Query = postgres.Sql | postgres.TransactionSql;
type WorkRow = {
  revision: string; timeline_draft: PracticeTimelineDraft | null; last_timeline_entry_id: string | null;
  letter_body: string; letter_kept_at: Date | string | null;
  time_action: string; time_category: PracticeCategory | ""; time_minutes: number;
  time_source_category: PracticeCategory | ""; time_source_minutes: number; time_kept_at: Date | string | null;
};
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const emptyWork = (): WorkRow => ({ revision: "0", timeline_draft: null, last_timeline_entry_id: null, letter_body: "", letter_kept_at: null,
  time_action: "", time_category: "", time_minutes: 0, time_source_category: "", time_source_minutes: 0, time_kept_at: null });

/** Called independently by both deck documents and protected asset handlers. */
export async function isPracticeCourseReleased(course: PracticeCourse, authUserId?: string | null): Promise<boolean> {
  if (course === "f1") return isFoundationsAvailableToMember(authUserId);
  const [row] = await getApplicationDatabase()<Array<{ released: boolean }>>`
    select private.ruined_practice_course_released(${course}) as released
  `;
  return row?.released === true;
}

async function releases(sql: Query, f1: boolean): Promise<PracticeSnapshot["releases"]> {
  const rows = await sql<Array<{ course: Exclude<PracticeCourse, "f1">; released: boolean }>>`
    select course, release_at is not null and release_at <= statement_timestamp() as released from member_practice_releases
  `;
  const result = { f1, f2: false, f3: false, f4: false, time: false };
  for (const row of rows) if (Object.hasOwn(result, row.course)) result[row.course] = row.released;
  return result;
}

async function readWork(sql: Query, memberId: string): Promise<WorkRow> {
  const [row] = await sql<WorkRow[]>`
    select revision::text, timeline_draft, last_timeline_entry_id, letter_body, letter_kept_at,
      time_action,time_category,time_minutes,time_source_category,time_source_minutes,time_kept_at
    from member_practice_work where member_id = ${memberId}::uuid
  `;
  return row ?? emptyWork();
}

async function owner(authUserId: string): Promise<MemberIdentity> {
  const identity = await getMemberIdentity(authUserId);
  if (!identity) throw new PracticeError(403, "The Work is unavailable.");
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, "foundations.write") && !memberCan(access, "foundations.revisit")) {
    throw new PracticeError(403, "Your membership does not currently include access to The Work.");
  }
  return identity;
}

async function snapshot(tx: postgres.TransactionSql, identity: MemberIdentity, f1: boolean): Promise<PracticeSnapshot> {
  const work = await readWork(tx, identity.memberId);
  const timeline = await readTimelineRecord(tx, identity.memberId);
  const completeEntries = await tx<Array<{ id: string }>>`
    select id from private.ruined_complete_practice_timeline_entries(${identity.memberId}::uuid)
  `;
  const releaseState = await releases(tx, f1);
  // Only server-verified saved records can grant awards. Reading a deck grants nothing.
  await tx`
    insert into member_badge_awards(member_id,badge_key,earned_at,source_event_id,rule_version,public_visible)
    select ${identity.memberId}::uuid,badge_key,earned_at,source_event_id,2,badge_key = 'your-story'
    from private.ruined_practice_badge_progress(${identity.memberId}::uuid)
    where progress >= target and earned_at is not null and earned_at <= statement_timestamp()
      and private.ruined_member_profile_released(${identity.memberId}::uuid)
    on conflict(member_id,badge_key) do nothing
  `;
  const rows = await tx<Array<{ badge_key: string; progress: number; target: number; earned_at: Date | null }>>`
    select progress.badge_key,progress.progress,progress.target,
      case when progress.progress >= progress.target and progress.earned_at <= statement_timestamp() then award.earned_at else null end as earned_at
    from private.ruined_practice_badge_progress(${identity.memberId}::uuid) progress
    left join member_badge_awards award on award.member_id = ${identity.memberId}::uuid and award.badge_key = progress.badge_key
  `;
  const badge = (key: string, target: number): PracticeBadge => {
    const row = rows.find(item => item.badge_key === key);
    return { earned: Boolean(row?.earned_at), earnedAt: iso(row?.earned_at), completed: Math.min(target, row?.progress ?? 0), target };
  };
  return {
    ownerId: identity.authUserId, revision: work.revision,
    canWrite: memberCan(deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt), "foundations.write"),
    releases: releaseState, timeline: { ...timeline, completeEntryIds: completeEntries.map(entry => entry.id) }, timelineDraft: work.timeline_draft, lastTimelineEntryId: work.last_timeline_entry_id,
    letter: { body: work.letter_body, keptAt: iso(work.letter_kept_at) },
    time: { action: work.time_action, category: work.time_category, minutes: work.time_minutes,
      sourceCategory: work.time_source_category, sourceMinutes: work.time_source_minutes, keptAt: iso(work.time_kept_at) },
    badges: { f1: badge("your-story", 3), f4: badge("foundations-4", 1), time: badge("time-2026-12", 2) },
  };
}

export async function getMemberPracticeSnapshot(authUserId: string): Promise<PracticeSnapshot> {
  const identity = await owner(authUserId);
  const f1 = await isFoundationsAvailableToMember(authUserId);
  return getApplicationDatabase().begin(async tx => {
    const memberId = await lockBadgeOwner(tx, authUserId);
    if (memberId !== identity.memberId) throw new PracticeError(409, "Your member account changed. Reload before continuing.", "account_changed");
    return snapshot(tx, identity, f1);
  });
}

function actionCourse(action: PracticeAction): PracticeCourse {
  if (action.action === "save_timeline_draft" || action.action === "keep_timeline_entry") return "f1";
  return action.action === "save_letter" || action.action === "keep_letter" ? "f4" : "time";
}

export async function saveMemberPractice(authUserId: string, input: unknown): Promise<PracticeSnapshot> {
  const action = parsePracticeAction(input);
  if (action.ownerId !== authUserId) throw new PracticeError(409, "The signed-in account changed. Reload before continuing.", "account_changed");
  const identity = await owner(authUserId);
  const course = actionCourse(action);
  const f1 = await isFoundationsAvailableToMember(authUserId);
  if (course === "f1" && !f1) throw new PracticeError(403, "Foundations 1 is not open yet.", "course_locked");
  return getApplicationDatabase().begin(async tx => {
    // Match the canonical timeline lock order before taking the member writer lock.
    if (action.action === "keep_timeline_entry") await tx`select pg_advisory_xact_lock(hashtext(${identity.memberId}),45)`;
    const currentIdentity = await requireLockedMemberWriteAccess(tx, identity);
    if (course === "f1" && !isFoundationsLaunched()) {
      const [administrator] = await tx<Array<{ role_slug: string }>>`
        select role_slug from platform_role_grants where auth_user_id=${authUserId}::uuid
          and role_slug='ops_admin' and revoked_at is null for share
      `;
      if (!administrator) throw new PracticeError(403, "Foundations 1 is not open yet.", "course_locked");
    }
    if (course !== "f1") {
      const [release] = await tx<Array<{ released: boolean }>>`
        select release_at is not null and release_at <= statement_timestamp() as released
        from member_practice_releases where course = ${course} for share
      `;
      if (!release?.released) throw new PracticeError(403, "This assignment has not been released yet.", "course_locked");
    }
    const current = await readWork(tx, identity.memberId);
    if (current.revision !== action.expectedRevision) throw new PracticeError(409, "Your saved work changed in another tab. Load the latest saved work before continuing.", "revision_conflict");
    const next: WorkRow = { ...current };
    const [clock] = await tx<Array<{ now: Date }>>`select statement_timestamp() as now`;
    const now = iso(clock!.now)!;
    if (action.action === "save_timeline_draft") {
      next.timeline_draft = action.fields;
    } else if (action.action === "keep_timeline_entry") {
      const timeline = await readTimelineRecord(tx, identity.memberId);
      if (timeline.revision !== action.expectedTimelineRevision) throw new PracticeError(409, "Your timeline changed in another tab. Load the latest saved entries before continuing.", "timeline_revision_conflict");
      const [entry] = validateTimelineInput([{ ...action.fields, year: action.fields.year! }]);
      await tx`select set_config('app.journal_actor_auth_user_id',${authUserId},true)`;
      next.last_timeline_entry_id = await writeLegacyTimelineEntry(tx, currentIdentity, entry!);
      next.timeline_draft = null;
    } else if (action.action === "save_letter" || action.action === "keep_letter") {
      next.letter_body = action.fields.body;
      if (current.letter_body.trim() !== next.letter_body.trim()) next.letter_kept_at = null;
      if (action.action === "keep_letter") next.letter_kept_at = next.letter_kept_at ?? now;
    } else if (action.action === "save_time" || action.action === "keep_time") {
      const fields = action.fields;
      const changed = current.time_action.trim() !== fields.action.trim() || current.time_category !== fields.category
        || current.time_minutes !== fields.minutes || current.time_source_category !== fields.sourceCategory || current.time_source_minutes !== fields.sourceMinutes;
      next.time_action = fields.action; next.time_category = fields.category; next.time_minutes = fields.minutes;
      next.time_source_category = fields.sourceCategory; next.time_source_minutes = fields.sourceMinutes;
      if (changed) next.time_kept_at = null;
      if (action.action === "keep_time") next.time_kept_at = next.time_kept_at ?? now;
    }
    const changed = JSON.stringify(current) !== JSON.stringify(next);
    if (changed) {
      const draft = next.timeline_draft === null ? null : tx.json(next.timeline_draft);
      if (current.revision === "0") {
        await tx`
          insert into member_practice_work(member_id,timeline_draft,last_timeline_entry_id,letter_body,letter_kept_at,
            time_action,time_category,time_minutes,time_source_category,time_source_minutes,time_kept_at,updated_by_auth_user_id)
          values (${identity.memberId}::uuid,${draft}::jsonb,${next.last_timeline_entry_id}::uuid,${next.letter_body},${iso(next.letter_kept_at)}::timestamptz,
            ${next.time_action},${next.time_category},${next.time_minutes},${next.time_source_category},${next.time_source_minutes},${iso(next.time_kept_at)}::timestamptz,${authUserId}::uuid)
        `;
      } else {
        await tx`
          update member_practice_work set timeline_draft=${draft}::jsonb,last_timeline_entry_id=${next.last_timeline_entry_id}::uuid,
            letter_body=${next.letter_body},letter_kept_at=${iso(next.letter_kept_at)}::timestamptz,
            time_action=${next.time_action},time_category=${next.time_category},time_minutes=${next.time_minutes},
            time_source_category=${next.time_source_category},time_source_minutes=${next.time_source_minutes},time_kept_at=${iso(next.time_kept_at)}::timestamptz,
            updated_by_auth_user_id=${authUserId}::uuid where member_id=${identity.memberId}::uuid and revision=${current.revision}::bigint
        `;
      }
    }
    return snapshot(tx, currentIdentity, f1);
  });
}
