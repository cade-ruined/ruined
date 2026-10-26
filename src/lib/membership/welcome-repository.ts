import "server-only";

import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { BadgeNotificationError, lockBadgeOwner } from "./badge-repository";
import { MemberWelcomeError, type MemberWelcomeAction, type MemberWelcomeSnapshot } from "./welcome-model";

async function welcomeOwner(tx: TransactionSql, authUserId: string): Promise<string> {
  try { return await lockBadgeOwner(tx, authUserId); }
  catch (error) {
    if (error instanceof BadgeNotificationError) throw new MemberWelcomeError(error.status, "Your member welcome is unavailable.");
    throw error;
  }
}

async function readWelcome(tx: TransactionSql, memberId: string, authUserId: string): Promise<MemberWelcomeSnapshot> {
  const [row] = await tx<Array<{
    dismissed_at: Date | null; calendar_viewed_at: Date | null; has_journal_entry: boolean;
  }>>`
    select welcome.dismissed_at, welcome.calendar_viewed_at,
      exists (
        select 1 from member_journal_entries entry
        where entry.member_id = ${memberId}::uuid
          and not (entry.visibility = 'public' and entry.include_on_timeline)
          and entry.deleted_at is null and entry.created_at <= statement_timestamp()
      ) as has_journal_entry
    from (select ${memberId}::uuid as member_id) owner
    left join member_welcome_state welcome on welcome.member_id = owner.member_id
  `;
  return {
    ownerId: authUserId,
    dismissedAt: row.dismissed_at ? new Date(row.dismissed_at).toISOString() : null,
    calendarViewedAt: row.calendar_viewed_at ? new Date(row.calendar_viewed_at).toISOString() : null,
    hasJournalEntry: row.has_journal_entry,
  };
}

/** Optional profile data: reading it never creates state or exposes Journal content. */
export async function getMemberWelcome(authUserId: string): Promise<MemberWelcomeSnapshot> {
  return getApplicationDatabase().begin(async tx => {
    const memberId = await welcomeOwner(tx, authUserId);
    return readWelcome(tx, memberId, authUserId);
  });
}

export async function updateMemberWelcome(authUserId: string, action: MemberWelcomeAction): Promise<MemberWelcomeSnapshot> {
  if (!["dismiss", "resume", "calendar_viewed"].includes(action)) throw new MemberWelcomeError(400, "Choose a valid welcome action.");
  return getApplicationDatabase().begin(async tx => {
    const memberId = await welcomeOwner(tx, authUserId);
    if (action === "dismiss") {
      await tx`
        insert into member_welcome_state(member_id, dismissed_at)
        values (${memberId}::uuid, statement_timestamp())
        on conflict(member_id) do update
          set dismissed_at = coalesce(member_welcome_state.dismissed_at, excluded.dismissed_at)
      `;
    } else if (action === "calendar_viewed") {
      await tx`
        insert into member_welcome_state(member_id, calendar_viewed_at)
        values (${memberId}::uuid, statement_timestamp())
        on conflict(member_id) do update
          set calendar_viewed_at = coalesce(member_welcome_state.calendar_viewed_at, excluded.calendar_viewed_at)
      `;
    } else {
      await tx`update member_welcome_state set dismissed_at = null where member_id = ${memberId}::uuid and dismissed_at is not null`;
    }
    return readWelcome(tx, memberId, authUserId);
  });
}
