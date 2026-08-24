import "server-only";

import { randomUUID } from "node:crypto";

import { getApplicationDatabase } from "@/lib/database/server";
import { BYOB_02_EVENT_KEY } from "@/lib/events/byob-registration-model";
import {
  REGISTRATION_ID_COLUMN_INDEX,
  REGISTRATION_SHEET_HEADERS,
  REGISTRATION_SHEET_TAB,
  buildRegistrationSheetRow,
  findRegistrationSheetRowNumber,
  isRegistrationId,
  type CanonicalRegistration,
  type RegistrationSheetRow,
} from "@/lib/events/registration-sheet-model";
import {
  appendGoogleSheetValues,
  clearGoogleSheetValues,
  configureGoogleRegistrationSheet,
  extendGoogleSheetTableToRow,
  getGoogleRegistrationSheetConfigurationStatus,
  getGoogleRegistrationSpreadsheetId,
  getGoogleSheetValues,
  hideGoogleSheetColumn,
  updateGoogleSheetValues,
} from "@/lib/google/sheets";

export const REGISTRATION_SHEET_EVENT_TYPE =
  "community_event_registration.sheet_sync_requested";

const MAX_ATTEMPTS = 5;
const STALE_LOCK_MINUTES = 10;

type RegistrationSheetOutboxEvent = {
  aggregateId: string;
  attempts: number;
  id: string;
};

export type RegistrationSheetWorkerResult = {
  claimed: number;
  failed: number;
  missing: string[];
  processed: number;
  ready: boolean;
  skipped: number;
};

export type RegistrationSheetReconciliationResult = {
  clearedRows: number;
  rows: number;
};

async function getCanonicalRegistration(
  registrationId: string,
): Promise<CanonicalRegistration | null> {
  if (!isRegistrationId(registrationId)) return null;

  const sql = getApplicationDatabase();
  const rows = await sql<Array<CanonicalRegistration>>`
    select
      id::text as id,
      event_key as "eventKey",
      registrant_name as "registrantName",
      registrant_first_name as "firstName",
      registrant_last_name as "lastName",
      email_normalized as email,
      instagram_handle as instagram,
      status,
      waiver_version as "waiverVersion",
      waiver_accepted_at as "waiverAcceptedAt",
      created_at as "registeredAt"
    from community_event_registrations
    where id = ${registrationId}::uuid
      and event_key = ${BYOB_02_EVENT_KEY}
    limit 1
  `;
  return rows[0] ?? null;
}

async function listCanonicalRegistrations(): Promise<CanonicalRegistration[]> {
  const sql = getApplicationDatabase();
  return sql<Array<CanonicalRegistration>>`
    select
      id::text as id,
      event_key as "eventKey",
      registrant_name as "registrantName",
      registrant_first_name as "firstName",
      registrant_last_name as "lastName",
      email_normalized as email,
      instagram_handle as instagram,
      status,
      waiver_version as "waiverVersion",
      waiver_accepted_at as "waiverAcceptedAt",
      created_at as "registeredAt"
    from community_event_registrations
    where event_key = ${BYOB_02_EVENT_KEY}
    order by created_at, id
  `;
}

async function ensureRegistrationSheetStructure(
  spreadsheetId: string,
): Promise<void> {
  await updateGoogleSheetValues(
    spreadsheetId,
    `${REGISTRATION_SHEET_TAB}!A1:I1`,
    [[...REGISTRATION_SHEET_HEADERS]],
  );
  await configureGoogleRegistrationSheet(
    spreadsheetId,
    REGISTRATION_SHEET_TAB,
  );
  await hideGoogleSheetColumn(
    spreadsheetId,
    REGISTRATION_SHEET_TAB,
    REGISTRATION_ID_COLUMN_INDEX,
  );
}

function appendedSheetRowNumber(updatedRange: string | null): number | null {
  if (!updatedRange) return null;
  const match = updatedRange.match(/!A(\d+):I\1$/);
  if (!match) return null;
  const rowNumber = Number(match[1]);
  return Number.isSafeInteger(rowNumber) && rowNumber >= 2 ? rowNumber : null;
}

async function upsertRegistrationSheetRow(
  spreadsheetId: string,
  row: RegistrationSheetRow,
): Promise<void> {
  const idRows = await getGoogleSheetValues(
    spreadsheetId,
    `${REGISTRATION_SHEET_TAB}!I2:I`,
  );
  const sheetRow = findRegistrationSheetRowNumber(
    idRows,
    row[REGISTRATION_ID_COLUMN_INDEX],
  );
  if (sheetRow !== null) {
    await updateGoogleSheetValues(
      spreadsheetId,
      `${REGISTRATION_SHEET_TAB}!A${sheetRow}:I${sheetRow}`,
      [row],
    );
    await extendGoogleSheetTableToRow(
      spreadsheetId,
      REGISTRATION_SHEET_TAB,
      sheetRow,
    );
    return;
  }

  const updatedRange = await appendGoogleSheetValues(
    spreadsheetId,
    `${REGISTRATION_SHEET_TAB}!A:I`,
    [row],
  );
  const appendedRow = appendedSheetRowNumber(updatedRange);
  if (!appendedRow) {
    throw new Error("Google registration sheet append range is invalid.");
  }
  await extendGoogleSheetTableToRow(
    spreadsheetId,
    REGISTRATION_SHEET_TAB,
    appendedRow,
  );
}

function createRegistrationSheetWorkerId(): string {
  return `registration-sheet-${randomUUID()}`;
}

async function claimNextRegistrationSheetEvent(
  workerId: string,
): Promise<RegistrationSheetOutboxEvent | null> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`
      update integration_outbox
      set
        status = 'dead_letter',
        locked_at = null,
        locked_by = null,
        last_error = 'Worker lease expired at the retry limit.',
        updated_at = now()
      where destination = 'google'
        and event_type = ${REGISTRATION_SHEET_EVENT_TYPE}
        and status = 'processing'
        and attempts >= ${MAX_ATTEMPTS}
        and locked_at < now() - (${STALE_LOCK_MINUTES} * interval '1 minute')
    `;

    const rows = await tx<Array<RegistrationSheetOutboxEvent>>`
      with candidate as (
        select id
        from integration_outbox
        where destination = 'google'
          and event_type = ${REGISTRATION_SHEET_EVENT_TYPE}
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
      set
        status = 'processing',
        attempts = outbox.attempts + 1,
        locked_at = now(),
        locked_by = ${workerId},
        last_error = null,
        updated_at = now()
      from candidate
      where outbox.id = candidate.id
      returning
        outbox.id::text as id,
        outbox.aggregate_id as "aggregateId",
        outbox.attempts
    `;
    return rows[0] ?? null;
  });
}

async function markRegistrationSheetEventSucceeded(
  eventId: string,
  workerId: string,
): Promise<void> {
  const sql = getApplicationDatabase();
  await sql`
    update integration_outbox
    set
      status = 'succeeded',
      processed_at = now(),
      locked_at = null,
      locked_by = null,
      last_error = null,
      updated_at = now()
    where id = ${eventId}::bigint
      and destination = 'google'
      and event_type = ${REGISTRATION_SHEET_EVENT_TYPE}
      and status = 'processing'
      and locked_by = ${workerId}
  `;
}

async function markRegistrationSheetEventFailed(
  event: RegistrationSheetOutboxEvent,
  workerId: string,
  error: unknown,
): Promise<void> {
  const sql = getApplicationDatabase();
  const terminal = event.attempts >= MAX_ATTEMPTS;
  const backoffSeconds = Math.min(
    3_600,
    30 * (2 ** Math.max(0, event.attempts - 1)),
  );
  const errorName = error instanceof Error && error.name ? error.name : "Error";
  const safeError = `Registration sheet sync failed (${errorName})`;

  await sql`
    update integration_outbox
    set
      status = ${terminal ? "dead_letter" : "failed"},
      available_at = case
        when ${terminal} then available_at
        else now() + (${backoffSeconds} * interval '1 second')
      end,
      locked_at = null,
      locked_by = null,
      last_error = ${safeError},
      updated_at = now()
    where id = ${event.id}::bigint
      and destination = 'google'
      and event_type = ${REGISTRATION_SHEET_EVENT_TYPE}
      and status = 'processing'
      and locked_by = ${workerId}
  `;
}

export async function processRegistrationSheetOutboxBatch(
  requestedLimit = 10,
): Promise<RegistrationSheetWorkerResult> {
  const configuration = getGoogleRegistrationSheetConfigurationStatus();
  const result: RegistrationSheetWorkerResult = {
    claimed: 0,
    failed: 0,
    missing: configuration.missing,
    processed: 0,
    ready: configuration.ready,
    skipped: 0,
  };
  if (!configuration.ready) return result;

  const spreadsheetId = getGoogleRegistrationSpreadsheetId();
  await ensureRegistrationSheetStructure(spreadsheetId);

  const workerId = createRegistrationSheetWorkerId();
  const limit = Math.max(1, Math.min(25, Math.trunc(requestedLimit)));
  for (let index = 0; index < limit; index += 1) {
    const event = await claimNextRegistrationSheetEvent(workerId);
    if (!event) break;
    result.claimed += 1;

    try {
      const registration = await getCanonicalRegistration(event.aggregateId);
      if (!registration) {
        await markRegistrationSheetEventSucceeded(event.id, workerId);
        result.skipped += 1;
        continue;
      }

      await upsertRegistrationSheetRow(
        spreadsheetId,
        buildRegistrationSheetRow(registration),
      );
      await markRegistrationSheetEventSucceeded(event.id, workerId);
      result.processed += 1;
    } catch (error) {
      await markRegistrationSheetEventFailed(event, workerId, error);
      result.failed += 1;
    }
  }

  return result;
}

export async function reconcileRegistrationSheet(): Promise<RegistrationSheetReconciliationResult> {
  const configuration = getGoogleRegistrationSheetConfigurationStatus();
  if (!configuration.ready) {
    throw new Error("Google registration sheet sync is not configured.");
  }

  const spreadsheetId = getGoogleRegistrationSpreadsheetId();
  const [registrations, existingRows] = await Promise.all([
    listCanonicalRegistrations(),
    getGoogleSheetValues(spreadsheetId, `${REGISTRATION_SHEET_TAB}!A2:I`),
  ]);
  const rows = registrations.map(buildRegistrationSheetRow);

  await ensureRegistrationSheetStructure(spreadsheetId);
  if (rows.length > 0) {
    await updateGoogleSheetValues(
      spreadsheetId,
      `${REGISTRATION_SHEET_TAB}!A2:I${rows.length + 1}`,
      rows,
    );
    await extendGoogleSheetTableToRow(
      spreadsheetId,
      REGISTRATION_SHEET_TAB,
      rows.length + 1,
    );
  }

  const clearedRows = Math.max(0, existingRows.length - rows.length);
  if (existingRows.length > rows.length) {
    await clearGoogleSheetValues(
      spreadsheetId,
      `${REGISTRATION_SHEET_TAB}!A${rows.length + 2}:I${existingRows.length + 1}`,
    );
  }

  return { clearedRows, rows: rows.length };
}
