import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";

import { getApplicationDatabase } from "@/lib/database/server";
import type { PlatformViewer } from "@/lib/platform/model";
import { supportDeliveryNeedsReview, supportDeliveryState } from "@/lib/support/delivery-policy";
import {
  SupportError, supportCategory, supportStatus, supportText, supportUuid,
  type SupportCategory, type SupportMessage, type SupportStatus, type SupportEmailDelivery,
  type SupportTicket, type SupportTicketSummary,
} from "@/lib/support/model";

type Tx = postgres.TransactionSql;
type Actor = { auth_user_id: string; email_normalized: string; name: string };
type TicketRow = {
  id: string; ticket_number: string; requester_auth_user_id: string;
  requester_email: string; requester_name: string; subject: string;
  category: SupportCategory; status: SupportStatus;
  created_at: Date; updated_at: Date; version_at: string;
  request_fingerprint: string;
};

async function requireActor(tx: Tx, viewer: PlatformViewer, operator: boolean, write = false): Promise<Actor> {
  const id = supportUuid(viewer.authUserId);
  // Role revocation and identity changes cannot race a support mutation.
  const actors = await tx<Actor[]>`
    select account.auth_user_id, account.email_normalized,
      coalesce(nullif(profile.display_name, ''), account.email_normalized) as name
    from platform_users account
    left join user_profiles profile on profile.auth_user_id = account.auth_user_id
    where account.auth_user_id = ${id}::uuid and account.status = 'active'
      and account.email_normalized = ${viewer.email.trim().toLowerCase()}
      and exists (
        select 1 from person_email_addresses address
        join people person on person.id = address.person_id and person.status = 'active'
        where address.person_id = account.person_id
          and address.email_normalized = account.email_normalized
          and address.verification_state = 'verified' and address.retired_at is null
      )
    ${write ? tx`for share of account` : tx``}
  `;
  if (!actors[0]) throw new SupportError(403, "Sign in to your account to view support requests. You can also email connect@theruinedproject.com.");
  if (operator) {
    const grants = await tx`
      select id from platform_role_grants
      where auth_user_id = ${id}::uuid and role_slug = 'ops_admin' and revoked_at is null
      ${write ? tx`for share` : tx``}
    `;
    if (!grants[0]) throw new SupportError(403, "Support requests require administrator access.");
  }
  return actors[0];
}

function summary(row: TicketRow): SupportTicketSummary {
  return {
    id: row.id,
    number: `R-${String(row.ticket_number).padStart(6, "0")}`,
    subject: row.subject, category: row.category, status: row.status,
    requesterName: row.requester_name, requesterEmail: row.requester_email,
    createdAt: new Date(row.created_at).toISOString(),
    // Preserve microseconds for optimistic concurrency; Date would discard them.
    updatedAt: row.version_at,
  };
}

async function loadTicket(tx: Tx, actor: Actor, id: string, operator: boolean, lock = false): Promise<TicketRow> {
  const rows = await tx<TicketRow[]>`
    select *, to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as version_at
    from support_tickets
    where id = ${id}::uuid
      ${operator ? tx`` : tx`and requester_auth_user_id = ${actor.auth_user_id}::uuid`}
    ${lock ? tx`for update` : tx``}
  `;
  // Missing and someone else's request deliberately have the same response.
  if (!rows[0]) throw new SupportError(404, "That support request was not found.");
  return rows[0];
}

async function detail(tx: Tx, row: TicketRow, operator = false): Promise<SupportTicket> {
  const rows = await tx<Array<{ id: string; author_type: "member" | "operator"; body: string; created_at: Date }>>`
    select id, author_type, body, created_at from support_messages
    where ticket_id = ${row.id}::uuid order by created_at, id limit 500
  `;
  const messages: SupportMessage[] = rows.map((message) => ({
    id: message.id, authorType: message.author_type, body: message.body,
    createdAt: new Date(message.created_at).toISOString(),
  }));
  if (!operator) return { ...summary(row), messages };
  const deliveries = await tx<Array<Omit<SupportEmailDelivery, "created_at" | "sent_at"> & { created_at: Date; sent_at: Date | null }>>`
    select id, audience, status, attempts, first_attempt_at, available_at, locked_at, last_error, created_at, sent_at
    from support_email_deliveries where ticket_id = ${row.id}::uuid order by created_at desc, id
  `;
  return { ...summary(row), messages, emailDeliveries: deliveries.map((delivery) => ({
    ...delivery,
    created_at: new Date(delivery.created_at).toISOString(),
    sent_at: delivery.sent_at ? new Date(delivery.sent_at).toISOString() : null,
    first_attempt_at: delivery.first_attempt_at ? new Date(delivery.first_attempt_at).toISOString() : null,
    available_at: delivery.available_at ? new Date(delivery.available_at).toISOString() : null,
    locked_at: delivery.locked_at ? new Date(delivery.locked_at).toISOString() : null,
  })) };
}

export async function listSupportTickets(viewer: PlatformViewer, operator = false): Promise<SupportTicketSummary[]> {
  return getApplicationDatabase().begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const actor = await requireActor(tx, viewer, operator);
    const rows = await tx<TicketRow[]>`
      select *, to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as version_at
      from support_tickets
      ${operator ? tx`` : tx`where requester_auth_user_id = ${actor.auth_user_id}::uuid`}
      order by updated_at desc, id limit 200
    `;
    if (!operator || !rows.length) return rows.map(summary);
    const deliveries = await tx<Array<SupportEmailDelivery & { ticket_id: string }>>`
      select ticket_id, status, attempts, first_attempt_at, available_at, locked_at, last_error
      from support_email_deliveries
      where ticket_id = any(${rows.map((row) => row.id)}::uuid[]) and status <> 'sent'
    `;
    return rows.map((row) => ({ ...summary(row), emailAttentionCount: deliveries.filter((delivery) =>
      delivery.ticket_id === row.id && supportDeliveryNeedsReview(delivery)).length }));
  });
}

export async function getSupportTicket(viewer: PlatformViewer, ticketId: string, operator = false): Promise<SupportTicket> {
  const id = supportUuid(ticketId);
  return getApplicationDatabase().begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const actor = await requireActor(tx, viewer, operator);
    return detail(tx, await loadTicket(tx, actor, id, operator), operator);
  });
}

async function queueEmail(tx: Tx, ticketId: string, messageId: string, audience: "member" | "operator") {
  await tx`
    insert into support_email_deliveries (ticket_id, message_id, audience)
    values (${ticketId}::uuid, ${messageId}::uuid, ${audience})
    on conflict (message_id, audience) do nothing
  `;
}

async function audit(tx: Tx, actor: Actor, ticketId: string, action: string, metadata: Record<string, string>) {
  await tx`
    insert into operator_audit_events (actor_auth_user_id, action, subject_type, subject_id, metadata)
    values (${actor.auth_user_id}::uuid, ${action}, 'support_ticket', ${ticketId}, ${tx.json(metadata)})
  `;
}

export async function createSupportTicket(viewer: PlatformViewer, input: {
  category: unknown; subject: unknown; message: unknown; requestKey: unknown;
}): Promise<SupportTicket> {
  const category = supportCategory(input.category);
  const subject = supportText(input.subject, "Subject", 3, 120);
  const message = supportText(input.message, "Message", 10, 5000);
  const requestKey = supportUuid(input.requestKey);
  const fingerprint = createHash("sha256").update(JSON.stringify({ category, subject, message })).digest("hex");
  return getApplicationDatabase().begin(async (tx) => {
    const actor = await requireActor(tx, viewer, false, true);
    await tx`select pg_advisory_xact_lock(hashtext('support-create'), hashtext(${actor.auth_user_id}))`;
    const existing = await tx<Array<{ id: string; request_fingerprint: string }>>`
      select id, request_fingerprint from support_tickets
      where requester_auth_user_id = ${actor.auth_user_id}::uuid and request_key = ${requestKey}::uuid
    `;
    if (existing[0]) {
      if (existing[0].request_fingerprint !== fingerprint) throw new SupportError(409, "This request changed. Refresh before sending again.");
      return detail(tx, await loadTicket(tx, actor, existing[0].id, false));
    }
    const counts = await tx<Array<{ count: number }>>`
      select count(*)::integer as count from support_tickets
      where requester_auth_user_id = ${actor.auth_user_id}::uuid and created_at > now() - interval '1 hour'
    `;
    if (counts[0].count >= 6) throw new SupportError(429, "You have sent several requests. Add a reply to an existing request, or try again in an hour.");
    const ticketId = randomUUID();
    const messageId = randomUUID();
    await tx`
      insert into support_tickets (id, requester_auth_user_id, requester_email, requester_name, category, subject, request_key, request_fingerprint)
      values (${ticketId}::uuid, ${actor.auth_user_id}::uuid, ${actor.email_normalized}, ${actor.name.slice(0, 254)}, ${category}, ${subject}, ${requestKey}::uuid, ${fingerprint})
    `;
    await tx`
      insert into support_messages (id, ticket_id, author_auth_user_id, author_type, body, request_key)
      values (${messageId}::uuid, ${ticketId}::uuid, ${actor.auth_user_id}::uuid, 'member', ${message}, ${requestKey}::uuid)
    `;
    await queueEmail(tx, ticketId, messageId, "operator");
    await queueEmail(tx, ticketId, messageId, "member");
    return detail(tx, await loadTicket(tx, actor, ticketId, false));
  });
}

export async function replySupportTicket(viewer: PlatformViewer, ticketId: string, input: {
  message: unknown; requestKey: unknown;
}, operator = false): Promise<SupportTicket> {
  const id = supportUuid(ticketId);
  const body = supportText(input.message, "Reply", 1, 5000);
  const requestKey = supportUuid(input.requestKey);
  return getApplicationDatabase().begin(async (tx) => {
    const actor = await requireActor(tx, viewer, operator, true);
    await tx`select pg_advisory_xact_lock(hashtext('support-reply'), hashtext(${actor.auth_user_id}))`;
    const ticket = await loadTicket(tx, actor, id, operator, true);
    const existing = await tx<Array<{ body: string; author_type: string }>>`
      select body, author_type from support_messages
      where ticket_id = ${id}::uuid and author_auth_user_id = ${actor.auth_user_id}::uuid and request_key = ${requestKey}::uuid
    `;
    if (existing[0]) {
      if (existing[0].body !== body || existing[0].author_type !== (operator ? "operator" : "member")) {
        throw new SupportError(409, "This reply changed. Refresh before sending again.");
      }
      return detail(tx, ticket, operator);
    }
    const counts = await tx<Array<{ recent: number; total: number }>>`
      select
        (select count(*)::integer from support_messages where author_auth_user_id = ${actor.auth_user_id}::uuid and created_at > now() - interval '1 hour') as recent,
        (select count(*)::integer from support_messages where ticket_id = ${id}::uuid) as total
    `;
    if (counts[0].recent >= (operator ? 200 : 50)) throw new SupportError(429, "Too many replies. Please try again later.");
    if (counts[0].total >= 500) throw new SupportError(409, "This conversation is full. Please start a new request and include this request number.");
    const messageId = randomUUID();
    await tx`
      insert into support_messages (id, ticket_id, author_auth_user_id, author_type, body, request_key)
      values (${messageId}::uuid, ${id}::uuid, ${actor.auth_user_id}::uuid, ${operator ? "operator" : "member"}, ${body}, ${requestKey}::uuid)
    `;
    const status = operator ? "waiting_on_member" : ticket.status === "in_progress" ? "in_progress" : "open";
    await tx`update support_tickets set status = ${status}, updated_at = clock_timestamp() where id = ${id}::uuid`;
    await queueEmail(tx, id, messageId, operator ? "member" : "operator");
    if (operator) {
      await audit(tx, actor, id, "support.replied", { messageId });
      // Use the existing notification center when this account has a member profile.
      // No support message content is copied into the notification feed.
      await tx`
        insert into member_notifications (person_id, member_id, notification_type, title_snapshot, body_snapshot,
          action_label_snapshot, action_url_snapshot, status, sent_at, delivered_at, dedupe_key)
        select account.person_id, account.member_id, 'system', 'A reply from Ruined',
          ${`Your support request R-${String(ticket.ticket_number).padStart(6, "0")} has a reply.`},
          'View request', ${`/my/support/${id}`}, 'delivered', statement_timestamp(), statement_timestamp(), ${`support-reply:${messageId}`}
        from platform_users account
        join ruined_members member on member.id = account.member_id and member.person_id = account.person_id
        where account.auth_user_id = ${ticket.requester_auth_user_id}::uuid
        on conflict (dedupe_key) do nothing
      `;
    }
    return detail(tx, await loadTicket(tx, actor, id, operator), operator);
  });
}

export async function updateSupportTicketStatus(viewer: PlatformViewer, ticketId: string, input: {
  status: unknown; expectedUpdatedAt: unknown;
}): Promise<SupportTicket> {
  const id = supportUuid(ticketId);
  const status = supportStatus(input.status);
  const expected = supportText(input.expectedUpdatedAt, "Request version", 20, 40);
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(expected) || !Number.isFinite(Date.parse(expected))) {
    throw new SupportError(400, "Refresh this request before updating it.");
  }
  return getApplicationDatabase().begin(async (tx) => {
    const actor = await requireActor(tx, viewer, true, true);
    const ticket = await loadTicket(tx, actor, id, true, true);
    if (ticket.version_at !== expected) throw new SupportError(409, "This request has changed. Refresh to see the latest reply before updating its status.");
    if (ticket.status !== status) {
      await tx`update support_tickets set status = ${status}, updated_at = clock_timestamp() where id = ${id}::uuid`;
      await audit(tx, actor, id, "support.status_changed", { from: ticket.status, to: status });
    }
    return detail(tx, await loadTicket(tx, actor, id, true), true);
  });
}

export async function retrySupportEmailDelivery(viewer: PlatformViewer, ticketId: string, deliveryId: unknown): Promise<SupportTicket> {
  const id = supportUuid(ticketId);
  const emailId = supportUuid(deliveryId);
  return getApplicationDatabase().begin(async (tx) => {
    const actor = await requireActor(tx, viewer, true, true);
    const ticket = await loadTicket(tx, actor, id, true, true);
    const [delivery] = await tx<SupportEmailDelivery[]>`
      select id, status, attempts, first_attempt_at, available_at, locked_at, last_error
      from support_email_deliveries where id = ${emailId}::uuid and ticket_id = ${id}::uuid for update
    `;
    if (!delivery) throw new SupportError(404, "That notification was not found.");
    if (!supportDeliveryState(delivery).canRetry) {
      throw new SupportError(409, "This email cannot be safely resent. Review its delivery in Resend before contacting the recipient again.");
    }
    await tx`
      update support_email_deliveries set status = 'pending', attempts = 0, available_at = now(),
        first_attempt_at = null, locked_at = null, locked_by = null
      where id = ${emailId}::uuid
    `;
    await audit(tx, actor, id, "support.email_retry_queued", { deliveryId: emailId, previousStatus: delivery.status });
    return detail(tx, ticket, true);
  });
}
