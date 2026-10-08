import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { classifyMemberSegment, readMemberSegmentSource } from "./member-segment-sync";
import { getAdminEmailDeliveryConfiguration } from "./admin-email-config";
import {
  ADMIN_EMAIL_DELIVERY_STATUSES, ADMIN_EMAIL_MAX_RECIPIENTS, AdminEmailError,
  normalizeAdminEmailContent, type AdminEmailContent, type AdminEmailDraft, type AdminEmailPreview,
} from "./admin-email-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const iso = (value: Date | string) => new Date(value).toISOString();
function requireUuid(value: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new AdminEmailError(400, "That email record is invalid.");
  return value;
}
function requireVersion(value: number | undefined) {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) throw new AdminEmailError(400, "Reload and review the current email version.");
}

/** The route's session check is not authorization. Every read/write checks live grants. */
export async function requireAdminEmailActor(tx: TransactionSql, actor: string, lock = false): Promise<void> {
  requireUuid(actor);
  const rows = lock ? await tx`
    select account.auth_user_id from platform_users account
    join platform_role_grants grant_row on grant_row.auth_user_id=account.auth_user_id
    where account.auth_user_id=${actor}::uuid and account.status='active'
      and grant_row.role_slug='ops_admin' and grant_row.revoked_at is null
    for share of account,grant_row
  ` : await tx`
    select account.auth_user_id from platform_users account
    join platform_role_grants grant_row on grant_row.auth_user_id=account.auth_user_id
    where account.auth_user_id=${actor}::uuid and account.status='active'
      and grant_row.role_slug='ops_admin' and grant_row.revoked_at is null
  `;
  if (!rows.length) throw new AdminEmailError(403, "Email creation and sending require administrator access.");
}
export async function assertAdminEmailAccess(actorAuthUserId: string): Promise<void> {
  await getApplicationDatabase().begin(tx => requireAdminEmailActor(tx, actorAuthUserId));
}
export async function consumeAdminEmailGeneration(actorAuthUserId: string): Promise<boolean> {
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actorAuthUserId, true);
    const rows = await tx`
      insert into admin_email_generation_limits(actor_auth_user_id,window_started_at,attempts)
      values(${actorAuthUserId}::uuid,date_trunc('hour',clock_timestamp()),1)
      on conflict(actor_auth_user_id,window_started_at) do update
        set attempts=admin_email_generation_limits.attempts+1
        where admin_email_generation_limits.attempts<30 returning attempts
    `;
    return rows.length > 0;
  });
}

type DraftRow = {
  id: string; subject: string; preheader: string; body: string;
  purpose: AdminEmailContent["purpose"]; audience: AdminEmailContent["audience"]; recipients: string[];
  version: number; status: "draft" | "queued"; created_at: Date | string; updated_at: Date | string;
  queued_at: Date | string | null; recipient_count: number;
  reviewed_recipient_hash: string | null; reviewed_recipient_count: number | null;
  reviewed_by_auth_user_id: string | null; reviewed_at: Date | string | null;
};
function draftFromRow(row: DraftRow, counts: Record<string, number | string> = {}): AdminEmailDraft {
  return {
    id: row.id, subject: row.subject, preheader: row.preheader, body: row.body,
    purpose: row.purpose, audience: row.audience, recipients: row.recipients,
    version: Number(row.version), status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    queuedAt: row.queued_at ? iso(row.queued_at) : null, recipientCount: Number(row.recipient_count),
    deliveryCounts: Object.fromEntries(ADMIN_EMAIL_DELIVERY_STATUSES.map(status => [status, Number(counts[status] ?? 0)])) as AdminEmailDraft["deliveryCounts"],
  };
}
async function draftById(tx: TransactionSql, id: string, lock = false): Promise<DraftRow> {
  requireUuid(id);
  const rows = lock ? await tx<DraftRow[]>`select * from admin_email_drafts where id=${id}::uuid for update`
    : await tx<DraftRow[]>`select * from admin_email_drafts where id=${id}::uuid`;
  if (!rows[0]) throw new AdminEmailError(404, "Email draft not found.");
  return rows[0];
}
async function draftWithCounts(tx: TransactionSql, row: DraftRow): Promise<AdminEmailDraft> {
  const counts = await tx<Array<{ status: string; count: string }>>`
    select status,count(*)::text from admin_email_deliveries where draft_id=${row.id}::uuid group by status
  `;
  return draftFromRow(row, Object.fromEntries(counts.map(item => [item.status, item.count])));
}
async function audit(tx: TransactionSql, actor: string, action: string, id: string, metadata: Record<string, unknown>) {
  await tx`
    insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
    values(${actor}::uuid,${action},'admin_email',${id},${JSON.stringify(metadata)}::jsonb)
  `;
}
export async function getAdminEmailCenter(actorAuthUserId: string): Promise<{ drafts: AdminEmailDraft[] }> {
  return getApplicationDatabase().begin(async tx => {
    await tx`set transaction isolation level repeatable read read only`;
    await requireAdminEmailActor(tx, actorAuthUserId);
    const rows = await tx<DraftRow[]>`select * from admin_email_drafts order by updated_at desc,id desc limit 100`;
    const drafts = [];
    for (const row of rows) drafts.push(await draftWithCounts(tx, row));
    return { drafts };
  });
}
export async function saveAdminEmailDraft(input: AdminEmailContent & {
  actorAuthUserId: string; draftId?: string; expectedVersion?: number;
}): Promise<AdminEmailDraft> {
  const content = normalizeAdminEmailContent(input);
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, input.actorAuthUserId, true);
    let row: DraftRow;
    if (input.draftId) {
      requireVersion(input.expectedVersion);
      const before = await draftById(tx, input.draftId, true);
      if (before.status !== "draft" || Number(before.version) !== input.expectedVersion) throw new AdminEmailError(409, "This email changed or was already queued. Reload before editing.");
      [row] = await tx<DraftRow[]>`
        update admin_email_drafts set subject=${content.subject},preheader=${content.preheader},body=${content.body},
          purpose=${content.purpose},audience=${content.audience},recipients=${JSON.stringify(content.recipients)}::jsonb,
          version=version+1,updated_by_auth_user_id=${input.actorAuthUserId}::uuid,updated_at=clock_timestamp(),
          reviewed_recipient_hash=null,reviewed_recipient_count=null,reviewed_by_auth_user_id=null,reviewed_at=null
        where id=${input.draftId}::uuid returning *
      `;
    } else {
      [row] = await tx<DraftRow[]>`
        insert into admin_email_drafts(created_by_auth_user_id,updated_by_auth_user_id,subject,preheader,body,purpose,audience,recipients)
        values(${input.actorAuthUserId}::uuid,${input.actorAuthUserId}::uuid,${content.subject},${content.preheader},${content.body},
          ${content.purpose},${content.audience},${JSON.stringify(content.recipients)}::jsonb) returning *
      `;
    }
    await audit(tx, input.actorAuthUserId, input.draftId ? "admin_email.draft_updated" : "admin_email.draft_created", row.id, { version: row.version });
    return draftFromRow(row);
  });
}

export type AdminEmailResolvedRecipient = { email: string; name: string; contactId: string | null };
/** Resolve from canonical app records, never provider segments or browser-supplied recipients. */
export async function resolveAdminEmailRecipients(tx: TransactionSql, content: Pick<AdminEmailContent, "purpose" | "audience" | "recipients">, enforceLimit = true) {
  const contacts = await tx<Array<{ id: string; email: string; delivery_state: string; subscribed: boolean }>>`
    select contact.id,contact.email_normalized as email,contact.delivery_state,
      exists(select 1 from communication_subscriptions subscription where subscription.contact_id=contact.id
        and subscription.channel='email' and subscription.topic='about' and subscription.status='subscribed') as subscribed
    from communication_contacts contact
  `;
  const contactByEmail = new Map(contacts.map(contact => [contact.email, contact]));
  const members = content.audience === "members" || content.purpose === "service"
    ? (await readMemberSegmentSource(tx)).filter(member => ["waiting", "open"].includes(classifyMemberSegment(member))) : [];
  const memberByEmail = new Map(members.map(member => [member.email.trim().toLowerCase(), member]));
  const candidates = content.audience === "individual" ? content.recipients
    : content.audience === "members" ? [...memberByEmail.keys()] : contacts.filter(contact => contact.subscribed).map(contact => contact.email);
  const recipients: AdminEmailResolvedRecipient[] = [];
  for (const email of [...new Set(candidates)].sort()) {
    const contact = contactByEmail.get(email);
    if (contact && contact.delivery_state !== "active") continue;
    if (content.purpose === "marketing" && !contact?.subscribed) continue;
    if ((content.purpose === "service" || content.audience === "members") && !memberByEmail.has(email)) continue;
    recipients.push({ email, name: memberByEmail.get(email)?.name ?? "", contactId: contact?.id ?? null });
  }
  if (enforceLimit && recipients.length > ADMIN_EMAIL_MAX_RECIPIENTS) throw new AdminEmailError(400, `This audience exceeds the ${ADMIN_EMAIL_MAX_RECIPIENTS}-recipient limit. Split it before sending.`);
  return { recipients, excludedCount: candidates.length - recipients.length };
}
function recipientHash(row: DraftRow, recipients: AdminEmailResolvedRecipient[]) {
  return hash(JSON.stringify({ draftId: row.id, version: Number(row.version), subject: row.subject, preheader: row.preheader,
    body: row.body, purpose: row.purpose, audience: row.audience, recipients }));
}
export async function previewAdminEmailDraft(input: { actorAuthUserId: string; draftId: string; expectedVersion: number }): Promise<AdminEmailPreview> {
  requireVersion(input.expectedVersion);
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, input.actorAuthUserId, true);
    const row = await draftById(tx, input.draftId, true);
    if (row.status !== "draft" || Number(row.version) !== input.expectedVersion) throw new AdminEmailError(409, "Reload and save the current email before reviewing recipients.");
    const resolved = await resolveAdminEmailRecipients(tx, row);
    const digest = recipientHash(row, resolved.recipients);
    await tx`update admin_email_drafts set reviewed_recipient_hash=${digest},reviewed_recipient_count=${resolved.recipients.length},
      reviewed_by_auth_user_id=${input.actorAuthUserId}::uuid,reviewed_at=clock_timestamp() where id=${row.id}::uuid`;
    return { draftId: row.id, version: Number(row.version), recipientHash: digest, recipientCount: resolved.recipients.length,
      recipients: resolved.recipients.map(({ email, name }) => ({ email, name })), excludedCount: resolved.excludedCount };
  });
}
export async function queueAdminEmailDraft(input: {
  actorAuthUserId: string; draftId: string; expectedVersion: number; recipientHash: string; recipientCount: number;
}): Promise<AdminEmailDraft> {
  requireVersion(input.expectedVersion);
  if (!/^[0-9a-f]{64}$/.test(input.recipientHash) || !Number.isSafeInteger(input.recipientCount) || input.recipientCount < 1) throw new AdminEmailError(400, "Review a nonempty recipient list before sending.");
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, input.actorAuthUserId, true);
    const row = await draftById(tx, input.draftId, true);
    // A retry of the exact approved request returns the original delivery set.
    if (row.status === "queued" && Number(row.version) === input.expectedVersion && row.reviewed_recipient_hash === input.recipientHash
      && row.recipient_count === input.recipientCount) return draftWithCounts(tx, row);
    const configuration = getAdminEmailDeliveryConfiguration();
    if (!configuration.ready || (row.purpose === "marketing" && !configuration.marketingReady)) throw new AdminEmailError(503, "Sending is not configured for this email purpose.");
    if (row.status !== "draft" || Number(row.version) !== input.expectedVersion || row.reviewed_recipient_hash !== input.recipientHash
      || row.reviewed_recipient_count !== input.recipientCount || row.reviewed_by_auth_user_id !== input.actorAuthUserId
      || !row.reviewed_at || Date.now() - new Date(row.reviewed_at).getTime() > 30 * 60_000) throw new AdminEmailError(409, "Review this email and its latest recipient list again before sending.");
    const resolved = await resolveAdminEmailRecipients(tx, row);
    if (recipientHash(row, resolved.recipients) !== input.recipientHash) throw new AdminEmailError(409, "The recipient list changed. Review the current audience before sending.");
    for (const recipient of resolved.recipients) {
      const token = row.purpose === "marketing" ? randomBytes(32).toString("base64url") : null;
      if (token && recipient.contactId) await tx`insert into admin_email_unsubscribe_tokens(token_hash,contact_id)
        values(${hash(token)},${recipient.contactId}::uuid)`;
      await tx`insert into admin_email_deliveries(draft_id,recipient_email,recipient_name,contact_id,purpose,audience,unsubscribe_token)
        values(${row.id}::uuid,${recipient.email},${recipient.name},${recipient.contactId}::uuid,${row.purpose},${row.audience},${token})`;
    }
    const [queued] = await tx<DraftRow[]>`update admin_email_drafts set status='queued',queued_at=clock_timestamp(),
      recipient_count=${resolved.recipients.length},updated_at=clock_timestamp(),updated_by_auth_user_id=${input.actorAuthUserId}::uuid
      where id=${row.id}::uuid returning *`;
    await audit(tx, input.actorAuthUserId, "admin_email.queued", row.id, { version: row.version, recipientCount: resolved.recipients.length,
      recipientHash: input.recipientHash, purpose: row.purpose, audience: row.audience });
    return draftWithCounts(tx, queued);
  });
}

/** Tokens grant only revocation, never enrollment; GET landing pages must not call this. */
export async function unsubscribeAdminEmail(token: string): Promise<boolean> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return getApplicationDatabase().begin(async tx => {
    const [record] = await tx<Array<{ contact_id: string }>>`select contact_id from admin_email_unsubscribe_tokens where token_hash=${hash(token)}`;
    if (!record) return false;
    await tx`select id from communication_contacts where id=${record.contact_id}::uuid for update`;
    const changed = await tx<Array<{ id: string; consent_version: string; version: string }>>`
      update communication_subscriptions set status='unsubscribed',unsubscribed_at=clock_timestamp(),
        last_state_source='about',version=version+1,state_changed_at=clock_timestamp(),updated_at=clock_timestamp()
      where contact_id=${record.contact_id}::uuid and channel='email' and topic='about' and status<>'unsubscribed'
      returning id,consent_version,version::text
    `;
    for (const subscription of changed) await tx`
      insert into communication_consent_events(subscription_id,decision,consent_version,source,evidence)
      values(${subscription.id}::uuid,'unsubscribed',${subscription.consent_version},'about','{"action":"admin_email_unsubscribe"}'::jsonb)
    `;
    await tx`update admin_email_unsubscribe_tokens set used_at=coalesce(used_at,clock_timestamp()) where token_hash=${hash(token)}`;
    if (changed.length) await tx`
      insert into integration_outbox(destination,event_type,aggregate_type,aggregate_id,dedupe_key,payload)
      values('resend','communication.contact.sync_requested','communication_contact',${record.contact_id},
        ${`admin-email-unsubscribe:${record.contact_id}:${changed.map(item => `${item.id}:${item.version}`).join(":")}`},'{}'::jsonb) on conflict(dedupe_key) do nothing
    `;
    return true;
  });
}
