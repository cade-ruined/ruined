import "server-only";

import { createHash } from "node:crypto";
import { getApplicationDatabase } from "@/lib/database/server";
import { isFoundationsAvailableToMember } from "@/lib/foundations/availability";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { getJournalEntry } from "@/lib/membership/journal-repository";
import { type JournalEntry, JOURNAL_UUID } from "@/lib/membership/journal-model";
import { getMemberIdentity, requireLockedMemberWriteAccess } from "@/lib/membership/repository";
import { PracticeError, parsePracticeAction, validPracticeRevision, type PracticeTimelineDraft } from "./model";

type WorkDraftRow = { revision: string; timeline_draft: PracticeTimelineDraft | null; updated_at: Date | string };
export type PracticeTimelineResume = {
  draft: PracticeTimelineDraft;
  revision: string;
  entryId: string;
  sourceEntry: JournalEntry | null;
  savedEntry: JournalEntry | null;
};

/** A retry after a lost save response must reopen the same entry, not create another. */
export function practiceTimelineDraftId(memberId: string, draft: PracticeTimelineDraft): string {
  if (draft.id) return draft.id;
  // Work's revision also changes when a letter or TIME draft autosaves. Base the
  // identity on this source draft alone so those unrelated saves cannot turn a
  // lost cleanup response into a second Timeline entry.
  const fingerprint = JSON.stringify([draft.year, draft.month ?? null, draft.title.trim(), draft.details.trim(),
    draft.meaning.trim(), draft.belief?.trim() || null, draft.presentImpact.trim(), draft.perspective?.trim() || null]);
  const hex = createHash("sha256").update(`ruined:practice-timeline:${memberId}:${fingerprint}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function owner(authUserId: string, write = false) {
  const identity = await getMemberIdentity(authUserId);
  if (!identity) throw new PracticeError(403, "Your work is unavailable.");
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, write ? "profile.write" : "profile.read")
    || !(memberCan(access, "foundations.write") || (!write && memberCan(access, "foundations.revisit")))) {
    throw new PracticeError(403, "Your membership does not currently include access to this work.");
  }
  if (!await isFoundationsAvailableToMember(authUserId)) throw new PracticeError(403, "Foundations 1 is not open yet.", "course_locked");
  return identity;
}

function checkedDraft(authUserId: string, row: WorkDraftRow): PracticeTimelineDraft | null {
  if (!row.timeline_draft) return null;
  const action = parsePracticeAction({ action: "save_timeline_draft", ownerId: authUserId, expectedRevision: row.revision, fields: row.timeline_draft });
  if (action.action !== "save_timeline_draft") return null;
  const draft = action.fields;
  return draft.id || draft.year || [draft.title, draft.details, draft.meaning, draft.presentImpact, draft.belief, draft.perspective].some(value => value?.trim()) ? draft : null;
}

/** Read only: the private Work draft remains intact until an owner confirms a canonical save. */
export async function getPracticeTimelineResume(authUserId: string): Promise<PracticeTimelineResume | null> {
  const identity = await owner(authUserId);
  const sql = getApplicationDatabase();
  const [work] = await sql<WorkDraftRow[]>`
    select revision::text, timeline_draft, updated_at from member_practice_work where member_id=${identity.memberId}::uuid
  `;
  if (!work) return null;
  const draft = checkedDraft(authUserId, work);
  if (!draft) return null;
  const entryId = practiceTimelineDraftId(identity.memberId, draft);
  const [stored] = await sql<Array<{ updated_at: Date | string }>>`
    select updated_at from member_journal_entries where id=${entryId}::uuid and member_id=${identity.memberId}::uuid and deleted_at is null
  `;
  if (draft.id && !stored) throw new PracticeError(409, "This saved entry is no longer available. Your unfinished work is still safe in The Work.", "source_unavailable");
  const sourceEntry = stored ? await getJournalEntry(authUserId, entryId) : null;
  // The owner-only content read is separate from the timestamp lookup. Bind the
  // timestamp to its exact version so a racing edit cannot be covered by an old
  // Work draft while carrying the newer entry's write version.
  const [matched] = sourceEntry ? await sql<Array<{ updated_at: Date | string }>>`
    select updated_at from member_journal_entries where id=${entryId}::uuid and member_id=${identity.memberId}::uuid
      and deleted_at is null and current_version=${sourceEntry.version}::bigint
  ` : [];
  if (sourceEntry && !matched) throw new PracticeError(409, "This entry changed while opening it. Your unfinished work is safe. Reload to review the latest version.", "entry_changed");
  // If the saved entry changed after this Work draft, never cover the newer work
  // with the older draft. The owner may have already published it in another tab.
  const savedEntry = sourceEntry && (!draft.id || sourceEntry.visibility === "public" || Boolean(sourceEntry.timelineReflection)
    || new Date(matched!.updated_at).getTime() >= new Date(work.updated_at).getTime()) ? sourceEntry : null;
  return { draft, revision: work.revision, entryId, sourceEntry, savedEntry };
}

const normalized = (value: string | null | undefined) => value?.trim() || null;
function matchesDraft(entry: JournalEntry, draft: PracticeTimelineDraft): boolean {
  const reflection = entry.timelineReflection;
  return entry.eventYear === draft.year && entry.eventMonth === (draft.month ?? null)
    && normalized(entry.title) === normalized(draft.title) && normalized(entry.body) === normalized(draft.details)
    && normalized(reflection?.meaning) === normalized(draft.meaning)
    && normalized(reflection?.belief) === normalized(draft.belief)
    && normalized(reflection?.presentImpact) === normalized(draft.presentImpact)
    && normalized(reflection?.perspective) === normalized(draft.perspective);
}

/** Clear only the source revision that was handed off; never clear newer writing. */
export async function completePracticeTimelineResume(authUserId: string, value: unknown): Promise<{ cleared: true }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PracticeError(400, "A saved entry is required.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["expectedPracticeRevision", "entryId"].includes(key))
    || !validPracticeRevision(input.expectedPracticeRevision) || typeof input.entryId !== "string" || !JOURNAL_UUID.test(input.entryId)) {
    throw new PracticeError(400, "A valid saved entry and work revision are required.");
  }
  const { expectedPracticeRevision, entryId } = input as { expectedPracticeRevision: string; entryId: string };
  const identity = await owner(authUserId, true);
  // Resolve only the current owner's entry, including its canonical reflections.
  const entry = await getJournalEntry(authUserId, entryId);
  return getApplicationDatabase().begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtext(${identity.memberId}),45)`;
    await requireLockedMemberWriteAccess(tx, identity, "profile.write");
    const [work] = await tx<WorkDraftRow[]>`
      select revision::text,timeline_draft,updated_at from member_practice_work where member_id=${identity.memberId}::uuid for update
    `;
    if (!work?.timeline_draft) return { cleared: true };
    if (work.revision !== expectedPracticeRevision) throw new PracticeError(409, "Your Timeline was saved. Newer unfinished work is still safe in The Work.", "revision_conflict");
    const draft = checkedDraft(authUserId, work);
    if (!draft || practiceTimelineDraftId(identity.memberId, draft) !== entryId) throw new PracticeError(409, "This saved entry does not match the unfinished work.", "draft_mismatch");
    const [stored] = await tx<Array<{ updated_at: Date | string; current_version: number }>>`
      select updated_at,current_version from member_journal_entries where id=${entryId}::uuid and member_id=${identity.memberId}::uuid and deleted_at is null for update
    `;
    if (!stored || String(stored.current_version) !== entry.version) throw new PracticeError(409, "The saved entry changed. Your unfinished work is still safe.", "entry_changed");
    if (!entry.includeOnTimeline || (draft.id && new Date(stored.updated_at).getTime() < new Date(work.updated_at).getTime() && !matchesDraft(entry, draft))) {
      throw new PracticeError(409, "Save your Timeline draft before finishing this handoff.", "entry_not_saved");
    }
    await tx`
      update member_practice_work set timeline_draft=null,last_timeline_entry_id=${entryId}::uuid,updated_by_auth_user_id=${authUserId}::uuid
      where member_id=${identity.memberId}::uuid and revision=${expectedPracticeRevision}::bigint
    `;
    return { cleared: true };
  });
}
