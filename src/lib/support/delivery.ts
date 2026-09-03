import "server-only";

import { randomUUID } from "node:crypto";
import { Resend } from "resend";

import { getApplicationDatabase } from "@/lib/database/server";
import { createSupportNotificationEmail } from "@/lib/support/email-model";
import { SUPPORT_EMAIL } from "@/lib/support/model";

const MAX_ATTEMPTS = 5;
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const BATCH_BUDGET_MS = 15_000;
const PROVIDER_TIMEOUT_MS = 6_000;

type ClaimedDelivery = {
  id: string;
  ticket_id: string;
  message_id: string;
  audience: "operator" | "member";
  attempts: number;
  previous_attempts: number;
  first_attempt_at: Date | string;
};

type DeliveryContext = {
  ticket_id: string;
  ticket_number: string;
  author_type: "member" | "operator";
  member_email: string | null;
};

export type SupportEmailConfiguration = {
  enabled: boolean;
  ready: boolean;
  missing: string[];
};

export type SupportEmailBatchResult = SupportEmailConfiguration & {
  claimed: number;
  sent: number;
  failed: number;
  deadLetter: number;
  deferred: number;
};

function environmentValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}

function validFrom(value: string): boolean {
  if (!value || /[\r\n]/.test(value)) return false;
  const address = value.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? value;
  return validEmail(address.trim());
}

function configuredSiteUrl(): URL | null {
  try {
    const url = new URL(environmentValue("NEXT_PUBLIC_SITE_URL"));
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    if (process.env.NODE_ENV === "production" && local) return null;
    return url;
  } catch {
    return null;
  }
}

export function getSupportEmailConfiguration(): SupportEmailConfiguration {
  const enabled = environmentValue("SUPPORT_EMAIL_ENABLED") === "true";
  const missing = [
    ...(!enabled ? ["SUPPORT_EMAIL_ENABLED=true"] : []),
    ...(!environmentValue("RESEND_API_KEY") ? ["RESEND_API_KEY"] : []),
    ...(!validFrom(environmentValue("RESEND_FROM_EMAIL")) ? ["RESEND_FROM_EMAIL"] : []),
    ...(!configuredSiteUrl() ? ["NEXT_PUBLIC_SITE_URL"] : []),
  ];
  return { enabled, ready: missing.length === 0, missing };
}

class SafeDeliveryError extends Error {
  constructor(public readonly label: string, public readonly terminal = false) {
    super(label);
  }
}

function databaseFailureLabel(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code === "42P01" || code === "42703" ? "support database migration" : "support database unavailable";
}

async function sendWithTimeout(client: Resend, payload: Parameters<Resend["emails"]["send"]>[0], key: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.emails.send(payload, { idempotencyKey: key }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SafeDeliveryError("provider_timeout")), PROVIDER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function processSupportEmailBatch(requestedLimit = 10): Promise<SupportEmailBatchResult> {
  const configuration = getSupportEmailConfiguration();
  const result: SupportEmailBatchResult = {
    ...configuration, claimed: 0, sent: 0, failed: 0, deadLetter: 0, deferred: 0,
  };
  // This is intentionally independent of marketing opt-in/topic configuration.
  // Disabled delivery must not claim rows or consume their retry allowance.
  if (!configuration.ready) return result;

  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(25, Math.trunc(requestedLimit))) : 10;
  const workerId = randomUUID();
  const startedAt = Date.now();
  const siteUrl = configuredSiteUrl()!;
  const client = new Resend(environmentValue("RESEND_API_KEY"));

  try {
    const sql = getApplicationDatabase();
    for (let index = 0; index < limit && Date.now() - startedAt < BATCH_BUDGET_MS; index += 1) {
      const [delivery] = await sql<ClaimedDelivery[]>`
        with next_delivery as (
          select id, attempts from support_email_deliveries
          where (status in ('pending', 'failed') and available_at <= now())
            or (status = 'processing' and locked_at < now() - interval '5 minutes')
          order by created_at, id
          limit 1 for update skip locked
        )
        update support_email_deliveries delivery
        set status = 'processing', attempts = least(delivery.attempts + 1, ${MAX_ATTEMPTS}),
            locked_by = ${workerId}, locked_at = now(),
            first_attempt_at = coalesce(first_attempt_at, now())
        from next_delivery
        where delivery.id = next_delivery.id
        returning delivery.id, delivery.ticket_id, delivery.message_id,
                  delivery.audience, delivery.attempts, delivery.first_attempt_at,
                  next_delivery.attempts as previous_attempts
      `;
      if (!delivery) break;
      result.claimed += 1;

      try {
        const firstAttempt = new Date(delivery.first_attempt_at).getTime();
        if (delivery.previous_attempts >= MAX_ATTEMPTS || !Number.isFinite(firstAttempt)
          || Date.now() - firstAttempt >= RETRY_WINDOW_MS) {
          throw new SafeDeliveryError("retry_window_exhausted_manual_review", true);
        }

        const [context] = await sql<DeliveryContext[]>`
          select ticket.id as ticket_id, ticket.ticket_number::text,
                 message.author_type,
                 case when email_address.id is not null
                      then account.email_normalized else null end as member_email
          from support_tickets ticket
          join support_messages message
            on message.ticket_id = ticket.id and message.id = ${delivery.message_id}::uuid
          left join platform_users account
            on account.auth_user_id = ticket.requester_auth_user_id
              and account.status = 'active'
              and account.email_normalized = ticket.requester_email
              and exists (select 1 from people where people.id = account.person_id and people.status = 'active')
          left join person_email_addresses email_address
            on email_address.person_id = account.person_id
              and email_address.email_normalized = ticket.requester_email
              and email_address.verification_state = 'verified'
              and email_address.retired_at is null
          where ticket.id = ${delivery.ticket_id}::uuid
          limit 1
        `;
        if (!context) throw new SafeDeliveryError("request_unavailable", true);
        const to = delivery.audience === "operator" ? SUPPORT_EMAIL : context.member_email;
        if (!to || !validEmail(to)) throw new SafeDeliveryError("recipient_unavailable_manual_review", true);

        const email = createSupportNotificationEmail({
          audience: delivery.audience,
          authorType: context.author_type,
          ticketId: context.ticket_id,
          ticketNumber: context.ticket_number,
          siteUrl,
        });
        const response = await sendWithTimeout(client, {
          from: environmentValue("RESEND_FROM_EMAIL"),
          to,
          replyTo: SUPPORT_EMAIL,
          ...email,
        }, `ruined-support/${delivery.id}`);
        if (response.error || !response.data?.id) {
          const status = response.error?.statusCode;
          const retryable = !status || status === 408 || status === 429 || status >= 500
            || response.error?.name === "concurrent_idempotent_requests";
          // Never store provider messages: they may contain an address or secret.
          throw new SafeDeliveryError(status ? `provider_http_${status}` : "provider_unavailable", !retryable);
        }

        const updated = await sql`
          update support_email_deliveries
          set status = 'sent', sent_at = now(), last_error = null, locked_by = null, locked_at = null
          where id = ${delivery.id}::uuid and status = 'processing' and locked_by = ${workerId}
          returning id
        `;
        if (updated.length) result.sent += 1;
        else result.deferred += 1;
      } catch (error) {
        const label = error instanceof SafeDeliveryError ? error.label : "delivery_unavailable";
        const terminal = (error instanceof SafeDeliveryError && error.terminal) || delivery.attempts >= MAX_ATTEMPTS;
        const delaySeconds = Math.min(3600, 60 * 2 ** Math.min(delivery.attempts - 1, MAX_ATTEMPTS));
        const updated = await sql`
          update support_email_deliveries
          set status = ${terminal ? "dead_letter" : "failed"}, last_error = ${label},
              available_at = now() + ${delaySeconds} * interval '1 second',
              locked_by = null, locked_at = null
          where id = ${delivery.id}::uuid and status = 'processing' and locked_by = ${workerId}
          returning id
        `;
        if (updated.length) result[terminal ? "deadLetter" : "failed"] += 1;
        else result.deferred += 1;
        // The original timed-out request may still settle. Stop this batch and
        // let a later worker reuse its key, safely inside the 23-hour window.
        if (label === "provider_timeout") break;
      }
    }
  } catch (error) {
    result.ready = false;
    result.missing = [databaseFailureLabel(error)];
  }
  return result;
}
