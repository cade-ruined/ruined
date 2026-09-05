import "server-only";
import type postgres from "postgres";
import type { OpsOverviewData, OpsSystemHealth } from "./ops-model";
import { supportDeliveryNeedsReview, type SupportDeliveryRow } from "@/lib/support/delivery-policy";

type Database = postgres.TransactionSql;
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;

// Called only after the enclosing repository has verified operator access.
// No support content or identities leave this aggregate; scoped staff never
// receive even a count of the admin-only support queue.
export async function readOpsDeliveryAttention(tx: Database, access: { authUserId: string; isAdmin: boolean }): Promise<OpsOverviewData["attention"]> {
  const rows = await tx<Array<{ count: number; kind: string; oldest_at: Date | string | null }>>`
    select 'support'::text as kind, count(*)::int as count, min(updated_at) as oldest_at
    from support_tickets
    where ${access.isAdmin} and status in ('open', 'in_progress')
    union all
    select 'calendar', count(*)::int, min(link.updated_at)
    from experience_calendar_links link
    join experiences experience on experience.id = link.experience_id
    where (link.status in ('pending_create','pending_update','pending_cancel','failed')
      or (link.status = 'active' and to_jsonb(link)->>'livemode' is null))
      and (${access.isAdmin} or exists (
        select 1 from circle_staff_assignments assignment
        join platform_role_grants role_grant on role_grant.auth_user_id=assignment.auth_user_id
          and role_grant.role_slug=assignment.role_slug and role_grant.revoked_at is null
        where assignment.auth_user_id=${access.authUserId}::uuid
          and assignment.circle_id=experience.circle_id
          and assignment.role_slug in ('guide','circle_leader')
          and assignment.ended_at is null and assignment.assigned_at <= statement_timestamp()
      ))
  `;
  return rows.filter(row => Number(row.count) > 0).map(row => ({
    count: Number(row.count), oldestAt: iso(row.oldest_at),
    href: row.kind === "support" ? "/ops/support" : "/ops/experiences",
    label: row.kind === "support" ? "Support needs a reply" : "Calendar updates need attention",
  }));
}

export type DeliveryHealthSnapshot = {
  checked_at: Date | string;
  last_identity_at: Date | string | null;
  last_stripe_at: Date | string | null;
  stripe_failed: number;
  stripe_pending: number;
  stripe_oldest: Date | string | null;
  last_notification_at: Date | string | null;
  notification_failed: number;
  notification_pending: number;
  notification_oldest: Date | string | null;
  last_support_at: Date | string | null;
  support_failed: number;
  support_pending: number;
  support_oldest: Date | string | null;
  last_calendar_at: Date | string | null;
  calendar_failed: number;
  calendar_pending: number;
  calendar_oldest: Date | string | null;
  calendar_unbound: number;
};

export async function readOpsDeliveryHealth(tx: Database, modes: { calendar: boolean | null; stripe: boolean | null }) {
  const rows = await tx<Array<Omit<DeliveryHealthSnapshot, "support_failed" | "support_pending" | "support_oldest">>>`
    select statement_timestamp() as checked_at,
      (select max(last_signed_in_at) from platform_users) as last_identity_at,
      (select max(processed_at) from stripe_webhook_events where status='processed' and livemode=${modes.stripe}::boolean) as last_stripe_at,
      (select count(*)::int from stripe_webhook_events where status='failed' and livemode=${modes.stripe}::boolean) as stripe_failed,
      (select count(*)::int from stripe_webhook_events where status='processing' and livemode=${modes.stripe}::boolean) as stripe_pending,
      (select min(updated_at) from stripe_webhook_events where status='processing' and livemode=${modes.stripe}::boolean) as stripe_oldest,
      (select max(coalesce(delivered_at,sent_at)) from member_notifications where channel='in_app') as last_notification_at,
      (select count(*)::int from member_notifications where status='failed' and channel='in_app') as notification_failed,
      (select count(*)::int from member_notifications where status='queued' and channel='in_app') as notification_pending,
      (select min(scheduled_for) from member_notifications where status='queued' and channel='in_app' and scheduled_for <= statement_timestamp()) as notification_oldest,
      (select max(sent_at) from support_email_deliveries where status='sent') as last_support_at,
      (select max(last_synced_at) from experience_calendar_links link where (to_jsonb(link)->>'livemode')::boolean=${modes.calendar}) as last_calendar_at,
      (select count(*)::int from experience_calendar_links link where status='failed' and (to_jsonb(link)->>'livemode')::boolean=${modes.calendar}) as calendar_failed,
      (select count(*)::int from experience_calendar_links link where status in ('pending_create','pending_update','pending_cancel') and (to_jsonb(link)->>'livemode')::boolean=${modes.calendar}) as calendar_pending,
      (select min(updated_at) from experience_calendar_links link where status in ('pending_create','pending_update','pending_cancel') and (to_jsonb(link)->>'livemode')::boolean=${modes.calendar}) as calendar_oldest,
      (select count(*)::int from experience_calendar_links link where status <> 'cancelled' and to_jsonb(link)->>'livemode' is null) as calendar_unbound
  `;
  const supportRows = await tx<SupportDeliveryRow[]>`
    select status, attempts, first_attempt_at, available_at, locked_at, last_error
    from support_email_deliveries where status <> 'sent'
  `;
  const checkedAt = new Date(rows[0].checked_at).getTime();
  const supportPending = supportRows.filter(row => !supportDeliveryNeedsReview(row, checkedAt));
  const readyAt = supportPending.map(row => row.status === "processing" ? row.locked_at : row.available_at)
    .filter((value): value is Date | string => value != null)
    .map(value => new Date(value).getTime()).filter(value => value <= checkedAt);
  return {
    ...rows[0],
    support_failed: supportRows.length - supportPending.length,
    support_pending: supportPending.length,
    support_oldest: readyAt.length ? new Date(Math.min(...readyAt)) : null,
  };
}

type Service = OpsSystemHealth["services"][number];
export function serviceHealthState(configured: boolean, failures: number, oldest: Service["oldestPendingAt"], checkedAt: Date | string): Service["state"] {
  if (!configured) return "unavailable";
  if (failures > 0) return "failed";
  if (oldest && new Date(checkedAt).getTime() - new Date(oldest).getTime() > 15 * 60_000) return "delayed";
  return "configured";
}

export function buildOpsHealthServices(snapshot: DeliveryHealthSnapshot, config: {
  supabase: boolean; stripe: boolean; stripeMode: boolean | null;
  calendar: boolean; calendarMode: boolean | null; support: boolean;
}): Service[] {
  const service = (input: Omit<Service, "state"> & { configured: boolean }): Service => {
    const { configured, ...rest } = input;
    return { ...rest, state: serviceHealthState(configured, input.failureCount, input.oldestPendingAt, snapshot.checked_at) };
  };
  const empty = { failureCount: 0, pendingCount: 0, oldestPendingAt: null, mode: null };
  return [
    service({ ...empty, configured: config.supabase, label: "Member sign-in", detail: "Configured access is not proof that a new email code was delivered.", evidenceLabel: "Last recorded sign-in", lastSucceededAt: iso(snapshot.last_identity_at), href: "/ops/operators" }),
    { ...empty, label: "Postgres", detail: "This page successfully read the operating database.", state: "verified", evidenceLabel: "Read verified", lastSucceededAt: iso(snapshot.checked_at), href: null },
    service({ configured: config.stripe && config.stripeMode !== null, label: "Stripe", detail: "Billing activates from verified payment events, not the checkout return page.", evidenceLabel: "Last processed webhook", lastSucceededAt: iso(snapshot.last_stripe_at), mode: config.stripeMode === null ? null : config.stripeMode ? "live" : "test", pendingCount: snapshot.stripe_pending, failureCount: snapshot.stripe_failed, oldestPendingAt: iso(snapshot.stripe_oldest), href: "/ops/members?filter=attention" }),
    service({ configured: true, label: "In-app notifications", detail: "Member inbox records only. This is not email-delivery evidence.", evidenceLabel: "Last recorded publication", lastSucceededAt: iso(snapshot.last_notification_at), mode: null, pendingCount: snapshot.notification_pending, failureCount: snapshot.notification_failed, oldestPendingAt: iso(snapshot.notification_oldest), href: "/ops/notifications" }),
    service({ configured: config.support, label: "Support email", detail: "Sent means the email provider accepted it; inbox delivery is not confirmed here.", evidenceLabel: "Last provider acceptance", lastSucceededAt: iso(snapshot.last_support_at), mode: null, pendingCount: snapshot.support_pending, failureCount: snapshot.support_failed, oldestPendingAt: iso(snapshot.support_oldest), href: "/ops/support" }),
    service({ configured: config.calendar && config.calendarMode !== null, label: "Google Calendar", detail: snapshot.calendar_unbound > 0 ? `${snapshot.calendar_unbound} existing Calendar link(s) need their environment verified before automatic sync.` : "Recorded syncs are historical evidence, not a live provider connection check.", evidenceLabel: "Last recorded sync", lastSucceededAt: iso(snapshot.last_calendar_at), mode: config.calendarMode === null ? null : config.calendarMode ? "live" : "test", pendingCount: snapshot.calendar_pending, failureCount: snapshot.calendar_failed + snapshot.calendar_unbound, oldestPendingAt: iso(snapshot.calendar_oldest), href: "/ops/experiences" }),
  ];
}
