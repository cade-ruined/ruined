import "server-only";

import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { zonedDateTimeLocalValue } from "@/lib/datetime/zoned-date-time";
import {
  dueWorkQueueDigestSlots, WORK_QUEUE_DIGEST_RECIPIENT,
  type WorkQueueDigestClaim, type WorkQueueDigestPayload, type WorkQueueDigestTimezone,
} from "./work-queue-digest-model";

type DeliveryRow = {
  id: string; recipient_auth_user_id: string | null; recipient_email_normalized: string;
  local_date: string; local_hour: 10 | 15; time_zone: WorkQueueDigestTimezone; scheduled_for: Date | string;
  attempts: number; first_send_attempt_at: Date | string | null; delivery_payload: WorkQueueDigestPayload | null;
};
const delivery = (row: DeliveryRow): WorkQueueDigestClaim => ({
  id: row.id, recipientAuthUserId: row.recipient_auth_user_id, recipientEmail: row.recipient_email_normalized,
  attempts: row.attempts, firstSendAttemptAt: row.first_send_attempt_at, payload: row.delivery_payload,
  slot: { localDate: row.local_date, localHour: row.local_hour, timeZone: row.time_zone, scheduledFor: new Date(row.scheduled_for).toISOString() },
});

/** The recipient is resolved only from a currently verified administrator. */
export async function enqueueWorkQueueDigests(timeZone: WorkQueueDigestTimezone, now: Date) {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const recipients = await tx<Array<{ auth_user_id: string }>>`
      select account.auth_user_id from platform_users account
      join people person on person.id=account.person_id and person.status='active'
      where account.email_normalized=${WORK_QUEUE_DIGEST_RECIPIENT} and account.status='active'
        and exists(select 1 from platform_role_grants grant_record where grant_record.auth_user_id=account.auth_user_id
          and grant_record.role_slug='ops_admin' and grant_record.revoked_at is null)
        and exists(select 1 from person_email_addresses email where email.person_id=account.person_id
          and email.email_normalized=${WORK_QUEUE_DIGEST_RECIPIENT} and email.verification_state='verified' and email.retired_at is null)
      order by account.auth_user_id limit 2
    `;
    if (recipients.length !== 1) return { queued: 0, recipientReady: false };
    let queued = 0;
    for (const slot of dueWorkQueueDigestSlots(now, timeZone)) {
      const rows = await tx`
        insert into operator_work_queue_digest_deliveries(recipient_auth_user_id,recipient_email_normalized,
          local_date,local_hour,time_zone,scheduled_for,available_at)
        values(${recipients[0].auth_user_id}::uuid,${WORK_QUEUE_DIGEST_RECIPIENT},${slot.localDate}::date,
          ${slot.localHour},${slot.timeZone},${slot.scheduledFor}::timestamptz,${now}::timestamptz)
        on conflict(recipient_email_normalized,local_date,local_hour) do nothing returning id
      `;
      queued += rows.length;
    }
    return { queued, recipientReady: true };
  });
}

export async function claimWorkQueueDigest(lease: string, now: Date): Promise<WorkQueueDigestClaim | null> {
  const sql = getApplicationDatabase();
  const [row] = await sql<DeliveryRow[]>`
    with candidate as (
      select id from operator_work_queue_digest_deliveries
      where scheduled_for<=${now}::timestamptz and ((status in ('pending','failed') and available_at<=${now}::timestamptz)
        or (status='processing' and locked_at<${now}::timestamptz-interval '5 minutes'))
      order by scheduled_for,id limit 1 for update skip locked
    )
    update operator_work_queue_digest_deliveries digest
    set status='processing',attempts=attempts+1,locked_at=${now}::timestamptz,lock_token=${lease}::uuid,updated_at=${now}::timestamptz
    from candidate where digest.id=candidate.id
    returning digest.*,digest.local_date::text as local_date
  `;
  return row ? delivery(row) : null;
}

async function lockEligibleRecipient(tx: TransactionSql, authUserId: string | null): Promise<boolean> {
  if (!authUserId) return false;
  // Access changes use this same advisory lock. The final send holds the
  // identity/grant locks so revocation either wins first or waits for the send.
  await tx`select pg_advisory_xact_lock(hashtext('ruined-operator-admins'),1)`;
  const [account] = await tx<Array<{ person_id: string }>>`
    select person_id from platform_users where auth_user_id=${authUserId}::uuid
      and email_normalized=${WORK_QUEUE_DIGEST_RECIPIENT} and status='active' for update
  `;
  if (!account) return false;
  const roles = await tx`
    select auth_user_id from platform_role_grants where auth_user_id=${authUserId}::uuid
      and role_slug='ops_admin' and revoked_at is null for share
  `;
  const people = await tx`select id from people where id=${account.person_id}::uuid and status='active' for share`;
  const emails = await tx`
    select id from person_email_addresses where person_id=${account.person_id}::uuid
      and email_normalized=${WORK_QUEUE_DIGEST_RECIPIENT} and verification_state='verified' and retired_at is null for share
  `;
  return roles.length > 0 && people.length > 0 && emails.length > 0;
}

export async function withWorkQueueDigest<T>(claim: WorkQueueDigestClaim, lease: string, timeZone: WorkQueueDigestTimezone, now: Date,
  action: (tx: TransactionSql, current: WorkQueueDigestClaim) => Promise<T>) {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const eligible = await lockEligibleRecipient(tx, claim.recipientAuthUserId);
    const [row] = await tx<DeliveryRow[]>`
      select digest.*,digest.local_date::text as local_date from operator_work_queue_digest_deliveries digest
      where id=${claim.id}::uuid and status='processing' and lock_token=${lease}::uuid for update
    `;
    if (!row) return { kind: "deferred" as const };
    const current = delivery(row);
    const wrongIdentity = current.recipientAuthUserId !== claim.recipientAuthUserId || current.recipientEmail !== WORK_QUEUE_DIGEST_RECIPIENT;
    const staleDay = !current.firstSendAttemptAt && current.slot.localDate !== zonedDateTimeLocalValue(now.toISOString(), timeZone).slice(0, 10);
    if (!eligible || wrongIdentity || current.slot.timeZone !== timeZone || staleDay) {
      const code = !eligible || wrongIdentity ? "recipient_unavailable" : staleDay ? "digest_day_expired" : "schedule_changed";
      await tx`update operator_work_queue_digest_deliveries set status='cancelled',last_error_code=${code},
        lock_token=null,locked_at=null,updated_at=${now}::timestamptz where id=${claim.id}::uuid`;
      return { kind: "cancelled" as const };
    }
    return { kind: "ok" as const, value: await action(tx, current) };
  });
}

/** Commit identical provider bytes and uncertainty evidence before networking. */
export async function preserveWorkQueueDigest(tx: TransactionSql, id: string, payload: WorkQueueDigestPayload, now: Date) {
  await tx`update operator_work_queue_digest_deliveries
    set delivery_payload=coalesce(delivery_payload,${tx.json(payload)}::jsonb),
      first_send_attempt_at=coalesce(first_send_attempt_at,${now}::timestamptz),
      last_error_code='send_in_flight',updated_at=${now}::timestamptz where id=${id}::uuid`;
}

export async function completeWorkQueueDigest(tx: TransactionSql, id: string, providerId: string, now: Date) {
  await tx`update operator_work_queue_digest_deliveries set status='sent',sent_at=${now}::timestamptz,
    provider_message_id=${providerId},last_error_code=null,locked_at=null,lock_token=null,updated_at=${now}::timestamptz where id=${id}::uuid`;
}

export async function failWorkQueueDigest(claim: WorkQueueDigestClaim, lease: string, code: string, terminal: boolean, now: Date) {
  const sql = getApplicationDatabase();
  const delay = Math.min(3600, 60 * 2 ** Math.min(claim.attempts - 1, 5));
  const [row] = await sql<Array<{ status: string }>>`
    update operator_work_queue_digest_deliveries
    set status=case when ${terminal} or attempts>=5 or first_send_attempt_at<=${now}::timestamptz-interval '23 hours'
        then 'manual_review' else 'failed' end,
      available_at=${now}::timestamptz+${delay}*interval '1 second',last_error_code=${code},
      locked_at=null,lock_token=null,updated_at=${now}::timestamptz
    where id=${claim.id}::uuid and status='processing' and lock_token=${lease}::uuid returning status
  `;
  return !row ? "deferred" : row.status === "manual_review" ? "manualReview" : "failed";
}

export async function getWorkQueueDigestHealth(now: Date) {
  const sql = getApplicationDatabase();
  const [row] = await sql<Array<{ manual_review: number; remaining_due: number }>>`
    select count(*) filter(where status='manual_review')::integer as manual_review,
      count(*) filter(where status in ('pending','failed','processing') and available_at<=${now}::timestamptz)::integer as remaining_due
    from operator_work_queue_digest_deliveries
  `;
  return { manualReview: row?.manual_review ?? 0, remainingDue: row?.remaining_due ?? 0 };
}
