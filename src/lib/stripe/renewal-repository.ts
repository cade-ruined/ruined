import "server-only";

import { getApplicationDatabase } from "@/lib/database/server";
import type { RenewalInvoicePreview, RenewalNoticeIdentity } from "./renewal-policy";
import type { MembershipPriceConfiguration } from "./price-policy";

export type RenewalEmailPayload = { from: string; to: string; replyTo: string; subject: string; html: string; text: string };
export type RenewalDelivery = RenewalNoticeIdentity & {
  id: string;
  attempts: number;
  email: string;
  firstSendAttemptAt: string | Date | null;
  payload: RenewalEmailPayload | null;
  preview: RenewalInvoicePreview | null;
  savedMemberEmail: string | null;
};

export async function enqueueMembershipRenewalNotices(configuration: string | MembershipPriceConfiguration, livemode: boolean, now: Date): Promise<number> {
  const sql = getApplicationDatabase();
  const annualPriceId = typeof configuration === "string" ? configuration : configuration.annual;
  const rows = await sql`
    insert into stripe_membership_renewal_notices (subscription_id, member_id, livemode, renews_at, lead_days, status, available_at, last_error_code)
    select subscription.id, subscription.member_id, ${livemode}, subscription.current_period_end, notice.lead_days,
      case when subscription.current_period_end < ${now}::timestamptz + notice.minimum_days * interval '1 day' then 'manual_review' else 'pending' end,
      subscription.current_period_end - notice.lead_days * interval '1 day',
      case when subscription.current_period_end < ${now}::timestamptz + notice.minimum_days * interval '1 day' then 'notice_window_missed' else null end
    from stripe_subscriptions subscription
    join ruined_members member on member.id = subscription.member_id and member.stripe_customer_id = subscription.stripe_customer_id
    cross join (values (40, 30), (20, 15)) as notice(lead_days, minimum_days)
    where subscription.price_id = ${annualPriceId}
      and subscription.stripe_status in ('active', 'past_due') and not subscription.cancel_at_period_end
      and (subscription.cancel_at is null or subscription.cancel_at > subscription.current_period_end)
      and subscription.current_period_end > ${now}::timestamptz - interval '7 days'
      and subscription.current_period_end - notice.lead_days * interval '1 day' <= ${now}::timestamptz
      and not exists (select 1 from stripe_membership_commitments contract where contract.stripe_subscription_id = subscription.id and contract.livemode = ${livemode})
    on conflict (livemode, subscription_id, renews_at, lead_days) do update
    set status=excluded.status, attempts=0, available_at=excluded.available_at,
      delivery_payload=null, invoice_preview=null, member_email_snapshot=null,
      last_error_code=excluded.last_error_code, locked_by=null, locked_at=null, updated_at=${now}::timestamptz
    where stripe_membership_renewal_notices.status='cancelled'
      and stripe_membership_renewal_notices.first_send_attempt_at is null
      and stripe_membership_renewal_notices.sent_at is null
      and stripe_membership_renewal_notices.resend_email_id is null
    returning id
  `;
  if (typeof configuration === "string" || !configuration.offers) return rows.length;
  const commercial = await sql`
    insert into stripe_membership_renewal_notices(subscription_id, member_id, livemode, renews_at, lead_days, status,
      available_at, last_error_code, notice_kind, contract_id, offer_id)
    select candidate.subscription_id, candidate.member_id, ${livemode}, candidate.renews_at, notice.lead_days,
      case when candidate.renews_at < ${now}::timestamptz + notice.minimum_days * interval '1 day' then 'manual_review' else 'pending' end,
      candidate.renews_at - notice.lead_days * interval '1 day',
      case when candidate.renews_at < ${now}::timestamptz + notice.minimum_days * interval '1 day' then 'notice_window_missed' else null end,
      candidate.notice_kind, candidate.contract_id, candidate.offer_id
    from (
      select subscription.id as subscription_id, subscription.member_id, contract.id as contract_id,
        contract.terms_snapshot->>'offerId' as offer_id,
        case when contract.terms_snapshot->>'billingPlan'='monthly' then 'initial_term_end' else 'annual_renewal' end as notice_kind,
        case when contract.terms_snapshot->>'billingPlan'='monthly'
          then (contract.terms_snapshot->>'initialTermEndsAt')::timestamptz else subscription.current_period_end end as renews_at,
        subscription.cancel_at, subscription.cancel_at_period_end
      from stripe_membership_commitments contract
      join stripe_subscriptions subscription on subscription.id=contract.stripe_subscription_id
        and subscription.member_id=contract.member_id and subscription.stripe_customer_id=contract.stripe_customer_id
      join ruined_members member on member.id=contract.member_id and member.stripe_customer_id=contract.stripe_customer_id
      join jsonb_each_text(${sql.json(configuration.offers)}::jsonb) configured on configured.key=contract.terms_snapshot->>'offerId'
        and configured.value=contract.terms_snapshot->>'priceId' and configured.value=subscription.price_id
      where contract.livemode=${livemode} and contract.status='active'
        and subscription.stripe_status in ('active','past_due')
    ) candidate
    cross join (values (40,30),(20,15)) notice(lead_days,minimum_days)
    where not candidate.cancel_at_period_end and (candidate.cancel_at is null or candidate.cancel_at > candidate.renews_at)
      and candidate.renews_at > ${now}::timestamptz - interval '7 days'
      and candidate.renews_at - notice.lead_days * interval '1 day' <= ${now}::timestamptz
    on conflict (livemode,subscription_id,renews_at,lead_days) do update
      set status=excluded.status, attempts=0, available_at=excluded.available_at,
        delivery_payload=null,invoice_preview=null,member_email_snapshot=null,last_error_code=excluded.last_error_code,
        locked_by=null,locked_at=null,updated_at=${now}::timestamptz
      where stripe_membership_renewal_notices.status='cancelled'
        and stripe_membership_renewal_notices.first_send_attempt_at is null
        and stripe_membership_renewal_notices.sent_at is null and stripe_membership_renewal_notices.resend_email_id is null
        and stripe_membership_renewal_notices.contract_id=excluded.contract_id
        and stripe_membership_renewal_notices.offer_id=excluded.offer_id
        and stripe_membership_renewal_notices.notice_kind=excluded.notice_kind
    returning id
  `;
  return rows.length + commercial.length;
}

export async function claimRenewalNotice(livemode: boolean, lease: string, now: Date): Promise<RenewalDelivery | null> {
  const sql = getApplicationDatabase();
  const rows = await sql<Array<Omit<RenewalDelivery, "renewsAt"> & { renewsAt: string | Date }>>`
    with candidate as (
      select id from stripe_membership_renewal_notices
      where livemode = ${livemode} and ((status in ('pending', 'failed') and available_at <= ${now}::timestamptz)
        or (status = 'processing' and locked_at < ${now}::timestamptz - interval '5 minutes'))
      order by available_at, id limit 1 for update skip locked
    ), claimed as (
      update stripe_membership_renewal_notices notice
      set status = 'processing', attempts = attempts + 1, locked_by = ${lease}::uuid, locked_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
      from candidate where notice.id = candidate.id returning notice.*
    )
    select notice.id, notice.subscription_id as "subscriptionId", notice.member_id as "memberId",
      subscription.stripe_customer_id as "customerId", notice.livemode, notice.renews_at as "renewsAt",
      notice.lead_days as "leadDays", notice.attempts, member.email_normalized as email,
      notice.notice_kind as "noticeKind", notice.offer_id as "offerId", notice.contract_id as "commitmentId",
      contract.checkout_attempt_id as "commercialReservationId", contract.terms_snapshot->>'initialTermEndsAt' as "commitmentInitialTermEndsAt",
      contract.status as "commitmentStatus", contract.terms_snapshot->>'priceId' as "boundPriceId",
      notice.first_send_attempt_at as "firstSendAttemptAt", notice.delivery_payload as payload, notice.invoice_preview as preview,
      notice.member_email_snapshot as "savedMemberEmail"
    from claimed notice
    join stripe_subscriptions subscription on subscription.id = notice.subscription_id and subscription.member_id = notice.member_id
    join ruined_members member on member.id = notice.member_id and member.stripe_customer_id = subscription.stripe_customer_id
    left join stripe_membership_commitments contract on contract.id=notice.contract_id and contract.livemode=notice.livemode
  `;
  const row = rows[0];
  // A removed identity must be visible operationally rather than left processing.
  await sql`
    update stripe_membership_renewal_notices set status='manual_review', last_error_code='member_identity_unavailable',
      locked_by=null, locked_at=null, updated_at=${now}::timestamptz
    where status='processing' and locked_by=${lease}::uuid and id <> coalesce(${row?.id ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
  `;
  return row ? { ...row, renewsAt: new Date(row.renewsAt).toISOString() } : null;
}

export async function persistRenewalNoticePayload(id: string, lease: string, payload: RenewalEmailPayload, preview: RenewalInvoicePreview, memberEmail: string): Promise<boolean> {
  const sql = getApplicationDatabase();
  const rows = await sql`
    update stripe_membership_renewal_notices set delivery_payload=${sql.json(payload)}::jsonb,
      invoice_preview=${sql.json(preview)}::jsonb, member_email_snapshot=${memberEmail}, updated_at=clock_timestamp()
    where id=${id}::uuid and status='processing' and locked_by=${lease}::uuid and delivery_payload is null
    returning id
  `;
  return rows.length === 1;
}

/** Commit before the provider call so a crash cannot erase delivery uncertainty. */
export async function fenceRenewalNoticeSend(id: string, lease: string): Promise<boolean> {
  const sql = getApplicationDatabase();
  const rows = await sql`
    update stripe_membership_renewal_notices notice set first_send_attempt_at=coalesce(first_send_attempt_at, clock_timestamp()),
      last_error_code='send_in_flight', updated_at=clock_timestamp()
    where notice.id=${id}::uuid and status='processing' and locked_by=${lease}::uuid
      and delivery_payload is not null
      and exists (select 1 from stripe_subscriptions subscription join ruined_members member on member.id=subscription.member_id
        where subscription.id=notice.subscription_id and subscription.member_id=notice.member_id
          and member.stripe_customer_id=subscription.stripe_customer_id and member.email_normalized=notice.member_email_snapshot
          and subscription.stripe_status='active' and not subscription.cancel_at_period_end
          and (subscription.cancel_at is null or subscription.cancel_at > notice.renews_at)
          and ((notice.notice_kind='annual_renewal' and subscription.current_period_end=notice.renews_at)
            or (notice.notice_kind='initial_term_end' and exists(select 1 from stripe_membership_commitments contract
              where contract.id=notice.contract_id and contract.status='active' and contract.livemode=notice.livemode
                and (contract.terms_snapshot->>'initialTermEndsAt')::timestamptz=notice.renews_at)))
          and (notice.contract_id is null or exists(select 1 from stripe_membership_commitments contract
            where contract.id=notice.contract_id and contract.status='active' and contract.livemode=notice.livemode
              and contract.terms_snapshot->>'offerId'=notice.offer_id and contract.terms_snapshot->>'priceId'=subscription.price_id)))
    returning id
  `;
  return rows.length === 1;
}

export async function finishRenewalNotice(id: string, lease: string, status: "sent" | "cancelled" | "manual_review" | "failed",
  code: string | null, providerId: string | null = null, retryDelaySeconds = 60, clearSendFence = false): Promise<boolean> {
  const sql = getApplicationDatabase();
  const rows = await sql`
    update stripe_membership_renewal_notices set status=${status}, last_error_code=${code},
      resend_email_id=coalesce(${providerId},resend_email_id), sent_at=case when ${status}='sent' then clock_timestamp() else sent_at end,
      available_at=case when ${status}='failed' then clock_timestamp()+${retryDelaySeconds}*interval '1 second' else available_at end,
      first_send_attempt_at=case when ${clearSendFence} then null else first_send_attempt_at end,
      locked_by=null, locked_at=null, updated_at=clock_timestamp()
    where id=${id}::uuid and status='processing' and locked_by=${lease}::uuid returning id
  `;
  return rows.length === 1;
}

export async function getRenewalNoticeHealth(livemode: boolean): Promise<{ manualReview: number; remainingDue: number }> {
  const [row] = await getApplicationDatabase()<Array<{ manual_review: string | number; remaining_due: string | number }>>`
    select count(*) filter (where status='manual_review') as manual_review,
      count(*) filter (where status in ('pending','failed','processing') and available_at <= clock_timestamp()) as remaining_due
    from stripe_membership_renewal_notices where livemode=${livemode}
  `;
  return { manualReview: Number(row?.manual_review ?? 0), remainingDue: Number(row?.remaining_due ?? 0) };
}
