import "server-only";

import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import type { TransactionSql } from "postgres";

import { getApplicationDatabase } from "@/lib/database/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { SUPPORT_EMAIL } from "@/lib/support/model";
import { createPersonalInvitationEmail } from "./personal-invitation-email";

const MAX_ATTEMPTS = 5;
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 6_000;
const BATCH_BUDGET_MS = 15_000;
type Database = ReturnType<typeof getApplicationDatabase>;
type EmailPayload = { from: string; to: string; replyTo: string; subject: string; html: string; text: string };
type Delivery = {
  id: string; member_id: string | null; origin: "member" | "ruined_direct"; public_token: string;
  recipient_name: string; recipient_email_normalized: string;
  inviter_name: string; inviter_tag: string | null;
  email_requested: boolean;
  expires_at: Date | string; revoked_at: Date | string | null; accepted_at: Date | string | null;
  delivery_attempts: number; first_attempt_at: Date | string | null;
  delivery_payload: EmailPayload | null; active: boolean; eligible: boolean;
  membership_type: "standard" | "complimentary"; complimentary_ends_at: Date | string | null;
};
type Claimed = { id: string; member_id: string | null; delivery_attempts: number; first_attempt_at: Date | string | null };
type BatchResult = { ready: boolean; claimed: number; sent: number; failed: number; cancelled: number; deferred: number };

function environmentValue(name: string): string { return process.env[name]?.trim() ?? ""; }
function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}
function validFrom(value: string): boolean {
  if (!value || /[\r\n]/.test(value)) return false;
  return validEmail((value.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? value).trim());
}
function configuredSiteUrl(): URL | null {
  try {
    const url = new URL(environmentValue("NEXT_PUBLIC_SITE_URL"));
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    if (process.env.NODE_ENV === "production" && local) return null;
    return url;
  } catch { return null; }
}

/** Transactional invitations do not require or change any marketing subscription. */
export function getPersonalInvitationEmailReady(): boolean {
  return getPlatformConfiguration().mode === "connected"
    && Boolean(environmentValue("RESEND_API_KEY"))
    && validFrom(environmentValue("RESEND_FROM_EMAIL"))
    && configuredSiteUrl() !== null;
}

function replayExpired(delivery: Pick<Delivery, "first_attempt_at">): boolean {
  const first = delivery.first_attempt_at === null ? NaN : new Date(delivery.first_attempt_at).getTime();
  return !Number.isFinite(first) || Date.now() - first >= REPLAY_WINDOW_MS;
}

class DeliveryError extends Error {
  constructor(readonly code: string, readonly terminal = false) { super(code); }
}

async function sendWithTimeout(client: Resend, payload: EmailPayload, id: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.emails.send(payload, { idempotencyKey: `ruined-personal-invitation/${id}` }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeliveryError("provider_timeout")), PROVIDER_TIMEOUT_MS);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

async function fail(sql: Database, delivery: Claimed, lease: string, error: unknown) {
  const code = error instanceof DeliveryError ? error.code : "delivery_unavailable";
  const terminal = (error instanceof DeliveryError && error.terminal)
    || delivery.delivery_attempts >= MAX_ATTEMPTS || replayExpired(delivery);
  const delay = Math.min(3600, 60 * 2 ** Math.min(delivery.delivery_attempts - 1, MAX_ATTEMPTS));
  const rows = await sql`
    update member_personal_invitations
    set delivery_status = 'failed', last_error_code = ${code},
        next_attempt_at = case when ${terminal} then null else clock_timestamp() + ${delay} * interval '1 second' end,
        delivery_locked_at = null, delivery_lock_token = null
    where id = ${delivery.id}::uuid and delivery_status = 'sending' and delivery_lock_token = ${lease}::uuid
    returning id
  `;
  return { updated: rows.length > 0, timedOut: code === "provider_timeout" };
}

async function withLockedDelivery<T>(sql: Database, claim: Claimed, lease: string,
  operation: (tx: TransactionSql, delivery: Delivery) => Promise<T>) {
  return sql.begin(async tx => {
    // Match revoke/deletion order. A concurrent revoke either wins before this
    // lock (and prevents sending), or waits until the provider call completes.
    if (claim.member_id !== null) {
      await tx`select private.ruined_lock_member_complimentary_funding(${claim.member_id}::uuid)`;
      await tx`select id from ruined_members where id = ${claim.member_id}::uuid for update`;
      await tx`select member_id from member_lifecycle where member_id = ${claim.member_id}::uuid for share`;
    }
    const [delivery] = await tx<Delivery[]>`
      select invitation.*, expires_at > clock_timestamp() as active,
             (case when origin = 'ruined_direct' then
               ${getPlatformConfiguration().stripeCheckoutReady === true} and private.ruined_direct_invitation_available(id)
               else private.ruined_member_can_share_invitation(member_id) end
               and private.ruined_personal_invitation_benefit_available(id)) as eligible
      from member_personal_invitations invitation
      where id = ${claim.id}::uuid and delivery_status = 'sending' and delivery_lock_token = ${lease}::uuid
      for update
    `;
    if (!delivery) return { kind: "deferred" as const };
    if (!delivery.email_requested || delivery.revoked_at || delivery.accepted_at || !delivery.active || !delivery.eligible) {
      await tx`update member_personal_invitations
        set delivery_status = 'cancelled', last_error_code = 'invitation_unavailable', next_attempt_at = null,
            delivery_locked_at = null, delivery_lock_token = null
        where id = ${claim.id}::uuid`;
      return { kind: "cancelled" as const };
    }
    if (replayExpired(delivery)) throw new DeliveryError("retry_window_exhausted", true);
    if (delivery.delivery_attempts > MAX_ATTEMPTS) throw new DeliveryError("attempts_exhausted", true);
    return { kind: "ok" as const, value: await operation(tx, delivery) };
  });
}

/** Sends only durable invitations queued by authorized member actions or launch-gated self signup. */
export async function processPersonalInvitationEmailBatch(requestedLimit = 10,
  options: { invitationId?: string } = {}): Promise<BatchResult> {
  const result: BatchResult = { ready: getPersonalInvitationEmailReady(), claimed: 0, sent: 0, failed: 0, cancelled: 0, deferred: 0 };
  if (!result.ready) return result;
  const sql = getApplicationDatabase();
  const site = configuredSiteUrl()!;
  const client = new Resend(environmentValue("RESEND_API_KEY"));
  const lease = randomUUID();
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(25, Math.trunc(requestedLimit))) : 10;
  const started = Date.now();
  try {
    for (let index = 0; index < limit && Date.now() - started < BATCH_BUDGET_MS; index += 1) {
      const [claim] = await sql<Claimed[]>`
        with candidate as (
          select id from member_personal_invitations
          where (${options.invitationId ?? null}::uuid is null or id = ${options.invitationId ?? null}::uuid)
            and (origin = 'member' or ${getPlatformConfiguration().stripeCheckoutReady === true})
            and ((delivery_status in ('queued', 'failed') and next_attempt_at <= clock_timestamp())
              or (delivery_status = 'sending' and delivery_locked_at < clock_timestamp() - interval '5 minutes'))
          order by issued_at, id limit 1 for update skip locked
        )
        update member_personal_invitations invitation
        set delivery_status = 'sending', delivery_attempts = delivery_attempts + 1,
            first_attempt_at = case when delivery_attempts = 0 and delivery_status = 'queued'
              then coalesce(first_attempt_at, clock_timestamp()) else first_attempt_at end,
            delivery_locked_at = clock_timestamp(), delivery_lock_token = ${lease}::uuid
        from candidate where invitation.id = candidate.id
        returning invitation.id, member_id, delivery_attempts, first_attempt_at
      `;
      if (!claim) break;
      result.claimed += 1;
      try {
        // Persist the complete immutable provider payload and an attempt fence
        // BEFORE the network call. A crash cannot turn an uncertain send into a
        // fresh email after Resend's 24-hour idempotency retention has elapsed.
        const prepared = await withLockedDelivery(sql, claim, lease, async (tx, delivery) => {
          let payload = delivery.delivery_payload;
          if (!payload) {
            payload = {
              from: environmentValue("RESEND_FROM_EMAIL"), to: delivery.recipient_email_normalized, replyTo: SUPPORT_EMAIL,
              ...createPersonalInvitationEmail({
                invitationSource: delivery.origin, recipientName: delivery.recipient_name, inviterName: delivery.inviter_name, inviterTag: delivery.inviter_tag,
                invitationUrl: new URL(`/invitation/${delivery.public_token}`, site).toString(),
                membershipType: delivery.membership_type,
                complimentaryEndsAt: delivery.complimentary_ends_at ? new Date(delivery.complimentary_ends_at).toISOString() : null,
                expiresAt: new Date(delivery.expires_at).toISOString(), siteUrl: site,
              }),
            };
            await tx`update member_personal_invitations set delivery_payload = ${sql.json(payload)}::jsonb
              where id = ${claim.id}::uuid`;
          }
          if (payload.to !== delivery.recipient_email_normalized || !validEmail(payload.to)) {
            throw new DeliveryError("recipient_unavailable", true);
          }
          return payload;
        });
        if (prepared.kind !== "ok") { result[prepared.kind] += 1; continue; }
        const sent = await withLockedDelivery(sql, claim, lease, async (tx, delivery) => {
          // The second lock catches withdrawal/expiry during preparation. Use
          // only the saved recipient/payload, never a client-supplied address.
          if (!delivery.delivery_payload || delivery.delivery_payload.to !== delivery.recipient_email_normalized) {
            throw new DeliveryError("recipient_unavailable", true);
          }
          const response = await sendWithTimeout(client, delivery.delivery_payload, delivery.id);
          if (response.error || !response.data?.id) {
            const status = response.error?.statusCode;
            const retryable = !status || status === 408 || status === 429 || status >= 500
              || response.error?.name === "concurrent_idempotent_requests";
            throw new DeliveryError(status ? `provider_http_${status}` : "provider_unavailable", !retryable);
          }
          await tx`update member_personal_invitations
            set delivery_status = 'sent', sent_at = clock_timestamp(), resend_email_id = ${response.data.id},
                last_error_code = null, next_attempt_at = null, delivery_locked_at = null, delivery_lock_token = null
            where id = ${delivery.id}::uuid`;
        });
        if (sent.kind === "ok") result.sent += 1;
        else result[sent.kind] += 1;
      } catch (error) {
        const failure = await fail(sql, claim, lease, error);
        result[failure.updated ? "failed" : "deferred"] += 1;
        // The timed-out request may still complete. A later attempt reuses the
        // same provider key and payload; do not run another send in this batch.
        if (failure.timedOut) break;
      }
    }
  } catch {
    // Keep recipient details, tokens, provider responses and configuration out
    // of logs and readiness responses. The durable queue remains recoverable.
    result.ready = false;
  }
  return result;
}
