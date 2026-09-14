import "server-only";

import { randomUUID } from "node:crypto";

import { getApplicationDatabase } from "@/lib/database/server";
import {
  getGoogleMembershipWaitlistSheetConfigurationStatus,
  getGoogleSheetValues,
  updateGoogleSheetValues,
} from "@/lib/google/sheets";
import {
  MEMBERSHIP_WAITLIST_SHEET_HEADERS,
  MEMBERSHIP_WAITLIST_SHEET_TAB,
  buildMembershipWaitlistSheetRow,
  isMembershipWaitlistId,
  membershipWaitlistSheetRowNumber,
  type CanonicalMembershipWaitlistEntry,
} from "@/lib/membership/waitlist-sheet-model";

export const MEMBERSHIP_WAITLIST_SHEET_EVENT_TYPE =
  "membership_waitlist.sheet_sync_requested";

const MAX_ATTEMPTS = 5;
const STALE_LOCK_MINUTES = 10;
const BATCH_BUDGET_MS = 25_000;

type MembershipWaitlistSheetOutboxEvent = {
  aggregateId: string;
  attempts: number;
  id: string;
};

export type MembershipWaitlistSheetWorkerResult = {
  claimed: number;
  deadLetter: number;
  failed: number;
  missing: string[];
  processed: number;
  ready: boolean;
  skipped: number;
};

async function getCanonicalWaitlistEntry(
  waitlistId: string,
): Promise<CanonicalMembershipWaitlistEntry | null> {
  if (!isMembershipWaitlistId(waitlistId)) return null;
  const sql = getApplicationDatabase();
  const rows = await sql<Array<CanonicalMembershipWaitlistEntry>>`
    select
      id::text as id,
      name,
      email_normalized as email,
      phone,
      created_at as "joinedAt",
      sheet_row as "sheetRow"
    from public.membership_waitlist
    where id = ${waitlistId}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

async function writeWaitlistSheetEntry(
  spreadsheetId: string,
  entry: CanonicalMembershipWaitlistEntry,
): Promise<void> {
  const rowNumber = membershipWaitlistSheetRowNumber(entry.sheetRow);
  const row = buildMembershipWaitlistSheetRow(entry);
  const existing = await getGoogleSheetValues(
    spreadsheetId,
    `${MEMBERSHIP_WAITLIST_SHEET_TAB}!A${rowNumber}:F${rowNumber}`,
  );
  const existingRow = existing[0] ?? [];
  const existingId = existingRow[5];
  const occupied = existingRow.some((cell) => cell !== "");
  if (occupied
    && (typeof existingId !== "string" || existingId.toLowerCase() !== entry.id.toLowerCase())) {
    // A manual sort or inserted row must never overwrite a different person.
    throw new Error("Membership waitlist sheet row identity has changed.");
  }

  // The immutable database allocation makes retry writes identical, including
  // when Google accepted a write but the worker lost its response or lease.
  // A:F is canonical; any operator notes in G onwards remain untouched.
  await updateGoogleSheetValues(
    spreadsheetId,
    `${MEMBERSHIP_WAITLIST_SHEET_TAB}!A${rowNumber}:F${rowNumber}`,
    [row],
  );
}

async function claimNextWaitlistSheetEvent(
  workerId: string,
): Promise<MembershipWaitlistSheetOutboxEvent | null> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`
      update integration_outbox
      set status = 'dead_letter', locked_at = null, locked_by = null,
        last_error = 'Worker lease expired at the retry limit.', updated_at = now()
      where destination = 'google'
        and aggregate_type = 'membership_waitlist'
        and event_type = ${MEMBERSHIP_WAITLIST_SHEET_EVENT_TYPE}
        and status = 'processing'
        and attempts >= ${MAX_ATTEMPTS}
        and locked_at < now() - (${STALE_LOCK_MINUTES} * interval '1 minute')
    `;
    const rows = await tx<Array<MembershipWaitlistSheetOutboxEvent>>`
      with candidate as (
        select id
        from integration_outbox
        where destination = 'google'
          and aggregate_type = 'membership_waitlist'
          and event_type = ${MEMBERSHIP_WAITLIST_SHEET_EVENT_TYPE}
          and attempts < ${MAX_ATTEMPTS}
          and (
            (status in ('pending', 'failed') and available_at <= now())
            or (
              status = 'processing'
              and locked_at < now() - (${STALE_LOCK_MINUTES} * interval '1 minute')
            )
          )
        order by available_at, id
        limit 1
        for update skip locked
      )
      update integration_outbox outbox
      set status = 'processing', attempts = outbox.attempts + 1,
        locked_at = now(), locked_by = ${workerId}, last_error = null, updated_at = now()
      from candidate
      where outbox.id = candidate.id
      returning outbox.id::text as id,
        outbox.aggregate_id as "aggregateId", outbox.attempts
    `;
    return rows[0] ?? null;
  });
}

async function markWaitlistSheetEventSucceeded(
  eventId: string,
  workerId: string,
): Promise<boolean> {
  const sql = getApplicationDatabase();
  const rows = await sql<Array<{ id: string }>>`
    update integration_outbox
    set status = 'succeeded', processed_at = now(), locked_at = null,
      locked_by = null, last_error = null, updated_at = now()
    where id = ${eventId}::bigint
      and destination = 'google'
      and aggregate_type = 'membership_waitlist'
      and event_type = ${MEMBERSHIP_WAITLIST_SHEET_EVENT_TYPE}
      and status = 'processing'
      and locked_by = ${workerId}
    returning id::text as id
  `;
  return rows.length === 1;
}

async function markWaitlistSheetEventFailed(
  event: MembershipWaitlistSheetOutboxEvent,
  workerId: string,
): Promise<boolean> {
  const sql = getApplicationDatabase();
  const terminal = event.attempts >= MAX_ATTEMPTS;
  const backoffSeconds = Math.min(3_600, 30 * (2 ** Math.max(0, event.attempts - 1)));
  const rows = await sql<Array<{ id: string }>>`
    update integration_outbox
    set
      status = ${terminal ? "dead_letter" : "failed"},
      available_at = case when ${terminal} then available_at
        else now() + (${backoffSeconds} * interval '1 second') end,
      locked_at = null, locked_by = null,
      last_error = 'Membership waitlist sheet sync failed.', updated_at = now()
    where id = ${event.id}::bigint
      and destination = 'google'
      and aggregate_type = 'membership_waitlist'
      and event_type = ${MEMBERSHIP_WAITLIST_SHEET_EVENT_TYPE}
      and status = 'processing'
      and locked_by = ${workerId}
    returning id::text as id
  `;
  return rows.length === 1;
}

export async function processMembershipWaitlistSheetOutboxBatch(
  requestedLimit = 10,
): Promise<MembershipWaitlistSheetWorkerResult> {
  const startedAt = Date.now();
  const configuration = getGoogleMembershipWaitlistSheetConfigurationStatus();
  const result: MembershipWaitlistSheetWorkerResult = {
    claimed: 0, deadLetter: 0, failed: 0, missing: configuration.missing,
    processed: 0, ready: configuration.ready, skipped: 0,
  };
  if (!configuration.ready || !configuration.spreadsheetId) return result;
  const spreadsheetId = configuration.spreadsheetId;

  // Verify authentication/tab access before consuming any queued attempt.
  await updateGoogleSheetValues(
    spreadsheetId,
    `${MEMBERSHIP_WAITLIST_SHEET_TAB}!A1:F1`,
    [[...MEMBERSHIP_WAITLIST_SHEET_HEADERS]],
  );

  const workerId = `membership-waitlist-sheet-${randomUUID()}`;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(25, Math.trunc(requestedLimit))) : 10;
  for (let index = 0; index < limit && Date.now() - startedAt < BATCH_BUDGET_MS; index += 1) {
    const event = await claimNextWaitlistSheetEvent(workerId);
    if (!event) break;
    result.claimed += 1;
    try {
      const entry = await getCanonicalWaitlistEntry(event.aggregateId);
      if (!entry) {
        await markWaitlistSheetEventSucceeded(event.id, workerId);
        result.skipped += 1;
        continue;
      }
      await writeWaitlistSheetEntry(spreadsheetId, entry);
      const completed = await markWaitlistSheetEventSucceeded(event.id, workerId);
      if (completed) result.processed += 1;
      else result.skipped += 1;
    } catch {
      const failed = await markWaitlistSheetEventFailed(event, workerId);
      if (failed) result.failed += 1;
      else result.skipped += 1;
    }
  }
  // Keep exhausted deliveries visible on later runs, even when nothing can
  // be claimed. Recovery requires an operator to fix the cause and replay.
  const sql = getApplicationDatabase();
  const counts = await sql<Array<{ deadLetter: number }>>`
    select count(*)::integer as "deadLetter"
    from integration_outbox
    where destination = 'google'
      and aggregate_type = 'membership_waitlist'
      and event_type = ${MEMBERSHIP_WAITLIST_SHEET_EVENT_TYPE}
      and status = 'dead_letter'
  `;
  result.deadLetter = counts[0]?.deadLetter ?? 0;
  return result;
}
