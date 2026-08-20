import "server-only";

import { randomUUID } from "node:crypto";

import type { CommunicationSource } from "@/lib/communications/model";
import { getApplicationDatabase } from "@/lib/database/server";

const MAX_ATTEMPTS = 5;
const STALE_LOCK_MINUTES = 10;

export type ResendOutboxEvent = {
  id: string;
  eventType: string;
  aggregateId: string;
  dedupeKey: string;
  attempts: number;
  payload: Record<string, unknown>;
};

export type ConfirmationDeliveryContext = {
  email: string;
  topic: CommunicationSource;
  subscriptionVersion: string;
};

export type ContactSyncContext = {
  contactId: string;
  email: string;
  topics: Record<CommunicationSource, "opt_in" | "opt_out">;
};

export type ContactSyncLease =
  | { status: "acquired"; context: ContactSyncContext }
  | { status: "busy" | "missing" };

export function createCommunicationsWorkerId(): string {
  return `communications-${randomUUID()}`;
}

export async function claimNextResendOutboxEvent(
  workerId: string,
): Promise<ResendOutboxEvent | null> {
  const sql = getApplicationDatabase();

  return sql.begin(async (tx) => {
    await tx`
      with stale_events as (
        select id, locked_by
        from integration_outbox
        where destination = 'resend'
          and status = 'processing'
          and attempts >= ${MAX_ATTEMPTS}
          and locked_at < now() - (${STALE_LOCK_MINUTES} * interval '1 minute')
        for update
      ), dead_lettered as (
        update integration_outbox outbox
        set
          status = 'dead_letter',
          payload = case
            when outbox.event_type = 'communication.confirmation.requested'
              then outbox.payload - 'confirmation_token'
            else outbox.payload
          end,
          locked_at = null,
          locked_by = null,
          last_error = 'Worker lease expired at the retry limit.',
          updated_at = now()
        from stale_events
        where outbox.id = stale_events.id
        returning
          outbox.id,
          outbox.event_type,
          outbox.aggregate_id,
          stale_events.locked_by as worker_id
      )
      update communication_contacts contact
      set
        resend_sync_started_at = null,
        resend_sync_locked_by = null,
        resend_sync_snapshot = null,
        updated_at = now()
      from dead_lettered
      where dead_lettered.event_type = 'communication.contact.sync_requested'
        and contact.id::text = dead_lettered.aggregate_id
        and contact.resend_sync_locked_by = (
          dead_lettered.worker_id || ':' || dead_lettered.id::text
        )
    `;

    const rows = await tx<Array<{
      id: string;
      eventType: string;
      aggregateId: string;
      dedupeKey: string;
      attempts: number;
      payload: Record<string, unknown>;
    }>>`
      with candidate as (
        select id
        from integration_outbox
        where destination = 'resend'
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
        outbox.event_type as "eventType",
        outbox.aggregate_id as "aggregateId",
        outbox.dedupe_key as "dedupeKey",
        outbox.attempts,
        outbox.payload
    `;

    return rows[0] ?? null;
  });
}

export async function markResendOutboxEventSucceeded(
  eventId: string,
  workerId: string,
): Promise<void> {
  const sql = getApplicationDatabase();
  await sql`
    update integration_outbox
    set
      status = 'succeeded',
      payload = case
        when event_type = 'communication.confirmation.requested'
          then payload - 'confirmation_token'
        else payload
      end,
      processed_at = now(),
      locked_at = null,
      locked_by = null,
      last_error = null,
      updated_at = now()
    where id = ${eventId}::bigint
      and status = 'processing'
      and locked_by = ${workerId}
  `;
}

export async function markResendOutboxEventFailed(
  event: Pick<ResendOutboxEvent, "id" | "attempts">,
  workerId: string,
  safeError: string,
): Promise<void> {
  const sql = getApplicationDatabase();
  const terminal = event.attempts >= MAX_ATTEMPTS;
  const backoffSeconds = Math.min(3_600, 30 * (2 ** Math.max(0, event.attempts - 1)));

  await sql`
    update integration_outbox
    set
      status = ${terminal ? "dead_letter" : "failed"},
      payload = case
        when ${terminal}
          and event_type = 'communication.confirmation.requested'
          then payload - 'confirmation_token'
        else payload
      end,
      available_at = case
        when ${terminal} then available_at
        else now() + (${backoffSeconds} * interval '1 second')
      end,
      locked_at = null,
      locked_by = null,
      last_error = ${safeError.slice(0, 500)},
      updated_at = now()
    where id = ${event.id}::bigint
      and status = 'processing'
      and locked_by = ${workerId}
  `;
}

export async function getConfirmationDeliveryContext(
  subscriptionId: string,
  expectedVersion: string,
): Promise<ConfirmationDeliveryContext | null> {
  const sql = getApplicationDatabase();
  const rows = await sql<Array<ConfirmationDeliveryContext>>`
    select
      contact.email_normalized as email,
      subscription.topic,
      subscription.version::text as "subscriptionVersion"
    from communication_subscriptions subscription
    join communication_contacts contact on contact.id = subscription.contact_id
    where subscription.id = ${subscriptionId}::uuid
      and subscription.status = 'pending_confirmation'
      and subscription.version = ${expectedVersion}::bigint
    limit 1
  `;
  return rows[0] ?? null;
}

export async function beginResendContactSync(
  contactId: string,
  leaseId: string,
  startedAt: Date,
): Promise<ContactSyncLease> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const contacts = await tx<Array<{
      contactId: string;
      email: string;
      topics: ContactSyncContext["topics"];
    }>>`
      update communication_contacts
      set
        resend_sync_started_at = ${startedAt},
        resend_sync_locked_by = ${leaseId},
        resend_sync_snapshot = (
          select jsonb_build_object(
            'store', case when bool_or(topic = 'store' and status = 'subscribed') then 'opt_in' else 'opt_out' end,
            'artifacts', case when bool_or(topic = 'artifacts' and status = 'subscribed') then 'opt_in' else 'opt_out' end,
            'about', case when bool_or(topic = 'about' and status = 'subscribed') then 'opt_in' else 'opt_out' end
          )
          from communication_subscriptions
          where contact_id = ${contactId}::uuid
        ),
        updated_at = now()
      where id = ${contactId}::uuid
        and (
          resend_sync_started_at is null
          or resend_sync_started_at < now() - (${STALE_LOCK_MINUTES} * interval '1 minute')
        )
      returning
        id as "contactId",
        email_normalized as email,
        resend_sync_snapshot as topics
    `;
    const contact = contacts[0];
    if (!contact) {
      const rows = await tx<Array<{ exists: boolean }>>`
        select exists (
          select 1
          from communication_contacts
          where id = ${contactId}::uuid
        ) as exists
      `;
      return { status: rows[0]?.exists ? "busy" : "missing" };
    }

    return { status: "acquired", context: contact };
  });
}

export async function completeResendContactSync(
  contactId: string,
  leaseId: string,
  resendContactId: string,
  topics: ContactSyncContext["topics"],
  completedAt: Date,
): Promise<void> {
  const sql = getApplicationDatabase();
  const rows = await sql<Array<{ id: string }>>`
    update communication_contacts
    set
      resend_contact_id = ${resendContactId},
      resend_preferences_snapshot = ${JSON.stringify(topics)}::jsonb,
      resend_preferences_synced_at = case
        when resend_preferences_synced_at is null
          or resend_preferences_synced_at < ${completedAt}
          then ${completedAt}
        else resend_preferences_synced_at
      end,
      resend_sync_started_at = null,
      resend_sync_locked_by = null,
      resend_sync_snapshot = null,
      updated_at = now()
    where id = ${contactId}::uuid
      and resend_sync_locked_by = ${leaseId}
    returning id
  `;
  if (!rows[0]) throw new Error("Resend contact sync lease was lost.");
}

export async function releaseResendContactSync(
  contactId: string,
  leaseId: string,
): Promise<void> {
  const sql = getApplicationDatabase();
  await sql`
    update communication_contacts
    set
      resend_sync_started_at = null,
      resend_sync_locked_by = null,
      resend_sync_snapshot = null,
      updated_at = now()
    where id = ${contactId}::uuid
      and resend_sync_locked_by = ${leaseId}
  `;
}
