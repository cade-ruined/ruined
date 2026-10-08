import "server-only";

import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { Resend } from "resend";
import { getApplicationDatabase } from "@/lib/database/server";
import { SUPPORT_EMAIL } from "@/lib/support/model";
import { AdminEmailError, renderAdminEmail, type AdminEmailContent } from "./admin-email-model";
import { adminEmailEnvironmentValue as value, getAdminEmailDeliveryConfiguration, getAdminEmailSiteUrl } from "./admin-email-config";
import { requireAdminEmailActor, resolveAdminEmailRecipients } from "./admin-email-repository";

export { getAdminEmailDeliveryConfiguration } from "./admin-email-config";

const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const PROVIDER_TIMEOUT_MS = 6_000;
const BATCH_BUDGET_MS = 15_000;
type Payload = { from: string; to: string; replyTo: string; subject: string; html: string; text: string; headers?: Record<string, string> };
type Delivery = {
  id: string; draft_id: string; recipient_email: string; contact_id: string | null;
  purpose: AdminEmailContent["purpose"]; audience: AdminEmailContent["audience"];
  attempts: number; first_send_attempt_at: Date | string | null; delivery_payload: Payload | null;
  unsubscribe_token: string | null; actor: string; subject: string; preheader: string; body: string;
};
class DeliveryError extends Error {
  constructor(readonly reason: string, readonly terminal = false, readonly skip = false) { super(reason); }
}
function assertReplayWindow(delivery: Delivery) {
  if (delivery.attempts > MAX_ATTEMPTS) throw new DeliveryError("attempts_exhausted", true);
  if (delivery.first_send_attempt_at !== null) {
    const started = new Date(delivery.first_send_attempt_at).getTime();
    if (!Number.isFinite(started) || Date.now() - started >= REPLAY_WINDOW_MS) throw new DeliveryError("uncertain_delivery_requires_manual_review", true);
  }
}
async function withDelivery<T>(id: string, lease: string, action: (tx: TransactionSql, delivery: Delivery) => Promise<T>) {
  return getApplicationDatabase().begin(async tx => {
    const [hint] = await tx<Array<{ contact_id: string | null; actor: string }>>`
      select delivery.contact_id,draft.updated_by_auth_user_id as actor from admin_email_deliveries delivery
      join admin_email_drafts draft on draft.id=delivery.draft_id
      where delivery.id=${id}::uuid and delivery.status='sending' and delivery.lock_token=${lease}::uuid
    `;
    if (!hint) return false;
    try { await requireAdminEmailActor(tx, hint.actor, true); }
    catch (error) { if (error instanceof AdminEmailError) throw new DeliveryError("administrator_access_revoked", true, true); throw error; }
    // Match preference writes: lock the contact before subscriptions. A local
    // unsubscribe cannot commit between our final consent read and send.
    if (hint.contact_id) {
      await tx`select id from communication_contacts where id=${hint.contact_id}::uuid for share`;
      await tx`select id from communication_subscriptions where contact_id=${hint.contact_id}::uuid for share`;
    }
    const [delivery] = await tx<Delivery[]>`
      select delivery.*,draft.updated_by_auth_user_id as actor,draft.subject,draft.preheader,draft.body
      from admin_email_deliveries delivery join admin_email_drafts draft on draft.id=delivery.draft_id
      where delivery.id=${id}::uuid and delivery.status='sending' and delivery.lock_token=${lease}::uuid
      for update of delivery
    `;
    if (!delivery) return false;
    assertReplayWindow(delivery);
    const configuration = getAdminEmailDeliveryConfiguration();
    if (!configuration.ready || (delivery.purpose === "marketing" && !configuration.marketingReady)) throw new DeliveryError("sending_configuration_unavailable");
    const resolved = await resolveAdminEmailRecipients(tx, { purpose: delivery.purpose, audience: delivery.audience, recipients: [delivery.recipient_email] }, false);
    const current = resolved.recipients.find(recipient => recipient.email === delivery.recipient_email);
    if (!current || (delivery.purpose === "marketing" && current.contactId !== delivery.contact_id)) throw new DeliveryError("recipient_no_longer_eligible", true, true);
    await action(tx, delivery);
    return true;
  });
}

/** Frozen bytes and a stable recipient-specific key make retrying safe only
 * within the provider's retention window. After that, require human review. */
export async function processAdminEmailBatch(requestedLimit = 10) {
  const configuration = getAdminEmailDeliveryConfiguration();
  const result = { ...configuration, claimed: 0, sent: 0, failed: 0, skipped: 0, manualReview: 0, deferred: 0 };
  if (!configuration.ready) return result;
  const client = new Resend(value("RESEND_API_KEY"));
  const sql = getApplicationDatabase();
  const site = getAdminEmailSiteUrl()!;
  const lease = randomUUID();
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(25, Math.trunc(requestedLimit))) : 10;
  const startedAt = Date.now();
  let lastProviderCall = 0;
  async function providerCall<T>(action: () => Promise<T>): Promise<T> {
    const wait = 150 - (Date.now() - lastProviderCall);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    const remaining = BATCH_BUDGET_MS - (Date.now() - startedAt);
    if (remaining <= 0) throw new DeliveryError("delivery_budget");
    lastProviderCall = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([action(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeliveryError(remaining < PROVIDER_TIMEOUT_MS ? "delivery_budget" : "provider_timeout")), Math.min(PROVIDER_TIMEOUT_MS, remaining));
      })]);
    } finally { clearTimeout(timer); }
  }
  async function checkProviderPreferences(delivery: Delivery) {
    const contact = await providerCall(() => client.contacts.get({ email: delivery.recipient_email }));
    if (contact.error) {
      if (contact.error.statusCode === 404 && delivery.purpose === "service") return;
      if (contact.error.statusCode === 404) throw new DeliveryError("provider_contact_unavailable", true, true);
      throw new DeliveryError("provider_preferences_unavailable");
    }
    if (contact.data.unsubscribed) throw new DeliveryError("provider_unsubscribed", true, true);
    if (delivery.purpose === "marketing") {
      const topics = await providerCall(() => client.contacts.topics.list({ email: delivery.recipient_email, limit: 100 }));
      if (topics.error) throw new DeliveryError("provider_preferences_unavailable");
      const topic = topics.data.data.find(item => item.id === value("RESEND_TOPIC_UPDATES_ID"));
      if (topic?.subscription !== "opt_in") throw new DeliveryError("provider_topic_not_subscribed", true, true);
    }
  }
  try {
    for (let index = 0; index < limit && Date.now() - startedAt < BATCH_BUDGET_MS; index++) {
      const [claim] = await sql<Array<{ id: string }>>`
        with candidate as (
          select id from admin_email_deliveries
          where (purpose='service' or ${configuration.marketingReady}) and (
            (status in ('pending','failed') and attempts<${MAX_ATTEMPTS} and available_at<=clock_timestamp())
            or (status='sending' and locked_at<clock_timestamp()-interval '5 minutes'))
          order by available_at,created_at,id limit 1 for update skip locked
        )
        update admin_email_deliveries delivery set status='sending',attempts=least(attempts+1,6),
          locked_at=clock_timestamp(),lock_token=${lease}::uuid,updated_at=clock_timestamp()
        from candidate where delivery.id=candidate.id returning delivery.id
      `;
      if (!claim) break;
      result.claimed++;
      try {
        const prepared = await withDelivery(claim.id, lease, async (tx, delivery) => {
          let payload = delivery.delivery_payload;
          if (!payload) {
            const unsubscribe = delivery.purpose === "marketing" ? new URL("/communications/unsubscribe", site) : null;
            const oneClick = delivery.purpose === "marketing" ? new URL("/api/communications/unsubscribe", site) : null;
            if (unsubscribe && oneClick) {
              if (!delivery.unsubscribe_token) throw new DeliveryError("unsubscribe_token_unavailable", true);
              unsubscribe.searchParams.set("token", delivery.unsubscribe_token);
              oneClick.searchParams.set("token", delivery.unsubscribe_token);
            }
            payload = {
              from: value("RESEND_FROM_EMAIL"), to: delivery.recipient_email, replyTo: SUPPORT_EMAIL,
              ...renderAdminEmail(delivery, unsubscribe?.toString(), value("ADMIN_EMAIL_POSTAL_ADDRESS")),
              ...(oneClick ? { headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
            };
          }
          if (payload.to !== delivery.recipient_email) throw new DeliveryError("recipient_changed_requires_manual_review", true);
          // Commit immutable payload before any send. Preference reads happen
          // in the next transaction, before setting the uncertainty timestamp.
          await tx`update admin_email_deliveries set delivery_payload=${JSON.stringify(payload)}::jsonb,
            updated_at=clock_timestamp() where id=${delivery.id}::uuid`;
        });
        if (!prepared) { result.deferred++; continue; }

        // Persist the uncertainty fence separately from the network transaction.
        // Even a process crash immediately after sending leaves this evidence.
        const checked = await withDelivery(claim.id, lease, async (tx, delivery) => {
          await checkProviderPreferences(delivery);
          await tx`update admin_email_deliveries set first_send_attempt_at=coalesce(first_send_attempt_at,clock_timestamp()),
            last_error='send_in_flight',updated_at=clock_timestamp() where id=${delivery.id}::uuid`;
        });
        if (!checked) { result.deferred++; continue; }

        const sent = await withDelivery(claim.id, lease, async (tx, delivery) => {
          if (!delivery.first_send_attempt_at || !delivery.delivery_payload || delivery.delivery_payload.to !== delivery.recipient_email) throw new DeliveryError("saved_payload_unavailable", true);
          // Current provider preferences and local contact/subscription locks
          // protect consent independently from the earlier queue snapshot.
          await checkProviderPreferences(delivery);
          const response = await providerCall(() => client.emails.send(delivery.delivery_payload!, { idempotencyKey: `ruined-admin-email/${delivery.id}` }));
          if (response.error || !response.data?.id) {
            const status = response.error?.statusCode;
            const retryable = !status || status === 408 || status === 429 || status >= 500 || response.error?.name === "concurrent_idempotent_requests";
            throw new DeliveryError(status ? `provider_http_${status}` : "provider_unavailable", !retryable);
          }
          await tx`update admin_email_deliveries set status='sent',provider_email_id=${response.data.id},sent_at=clock_timestamp(),
            locked_at=null,lock_token=null,last_error=null,updated_at=clock_timestamp() where id=${delivery.id}::uuid`;
        });
        if (sent) result.sent++;
        else result.deferred++;
      } catch (error) {
        const reason = error instanceof DeliveryError ? error.reason : "delivery_unavailable";
        const [failed] = await sql<Array<{ status: string }>>`
          update admin_email_deliveries set
            status=case when ${error instanceof DeliveryError && error.skip} and first_send_attempt_at is null then 'skipped'
              when ${error instanceof DeliveryError && error.skip} then 'manual_review'
              when ${error instanceof DeliveryError && error.terminal} or attempts>=${MAX_ATTEMPTS} then 'manual_review' else 'failed' end,
            available_at=clock_timestamp()+(least(3600,60*power(2,least(attempts-1,5))) * interval '1 second'),
            last_error=${reason},locked_at=null,lock_token=null,updated_at=clock_timestamp()
          where id=${claim.id}::uuid and status='sending' and lock_token=${lease}::uuid returning status
        `;
        if (!failed) result.deferred++;
        else if (failed.status === "manual_review") result.manualReview++;
        else if (failed.status === "skipped") result.skipped++;
        else result.failed++;
        // Promise.race cannot cancel an accepted provider request. End the batch
        // and keep exactly the same payload/key on any subsequent attempt.
        if (reason === "provider_timeout" || reason === "delivery_budget") break;
      }
    }
  } catch {
    result.ready = false;
    result.missing = ["admin email database unavailable"];
  }
  return result;
}
