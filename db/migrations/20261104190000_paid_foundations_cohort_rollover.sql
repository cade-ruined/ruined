begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

alter table public.membership_commercial_events drop constraint membership_commercial_events_event_type_check,
  add constraint membership_commercial_events_event_type_check check(event_type in (
    'reserved','activated','released','enrolled','ended','cancellation_scheduled','cancellation_withdrawn','billing_attention','billing_recovered','cohort_rolled'));

-- This cross-row date rule now belongs to the guarded effective-schedule
-- trigger below. Preserve all monetary/refund identity CHECK constraints.
do $$ declare constraint_name text; begin
  for constraint_name in select conname from pg_constraint
    where conrelid='public.stripe_membership_prepaid_proofs'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%provider_canceled_at%service_starts_at%'
  loop execute format('alter table public.stripe_membership_prepaid_proofs drop constraint %I',constraint_name); end loop;
end $$;

-- Original accepted schedules, agreements and invoice coverage stay immutable.
-- This separate ledger records the effective service/billing dates after a late
-- payment has been verified and the SAME Stripe subscription has been adjusted.
create table private.membership_cohort_rollovers (
  reservation_id uuid primary key references public.membership_commercial_reservations(id),
  contract_id uuid not null unique references public.stripe_membership_commitments(id),
  stripe_subscription_id text not null unique references public.stripe_subscriptions(id),
  stripe_invoice_id text not null references public.stripe_invoices(id),
  paid_at timestamptz not null,
  accepted_schedule jsonb not null,
  effective_schedule jsonb not null,
  status text not null default 'pending' check(status in ('pending','completed')),
  provider_evidence jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check((status='completed')=(completed_at is not null and provider_evidence is not null))
);
alter table private.membership_cohort_rollovers enable row level security;
revoke all on private.membership_cohort_rollovers from public,anon,authenticated;
grant select,insert,update on private.membership_cohort_rollovers to service_role;

create function private.ruined_effective_prepaid_schedule(target_reservation_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(rollover.effective_schedule,reservation.billing_schedule)
  from public.membership_commercial_reservations reservation
  left join private.membership_cohort_rollovers rollover on rollover.reservation_id=reservation.id and rollover.status='completed'
  where reservation.id=target_reservation_id
$$;
create function private.ruined_effective_membership_terms(target_contract_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when rollover.status='completed' then contract.terms_snapshot || jsonb_build_object(
      'billingSchedule',rollover.effective_schedule,'startsAt',rollover.effective_schedule->>'serviceStartsAt',
      'initialTermEndsAt',rollover.effective_schedule->>'initialTermEndsAt') else contract.terms_snapshot end
  from public.stripe_membership_commitments contract
  left join private.membership_cohort_rollovers rollover on rollover.contract_id=contract.id
  where contract.id=target_contract_id
$$;

create function private.ruined_guard_cohort_rollover() returns trigger
language plpgsql set search_path='' as $$
declare reservation public.membership_commercial_reservations%rowtype;
  proof public.stripe_membership_prepaid_proofs%rowtype; invoice public.stripe_invoices%rowtype;
  month_start date; first_thursday date; expected_month text;
begin
  if tg_op='DELETE' then raise exception 'Cohort rollover evidence cannot be deleted.'; end if;
  if tg_op='UPDATE' and ((new.reservation_id,new.contract_id,new.stripe_subscription_id,new.stripe_invoice_id,new.paid_at,
      new.accepted_schedule,new.effective_schedule,new.created_at) is distinct from
      (old.reservation_id,old.contract_id,old.stripe_subscription_id,old.stripe_invoice_id,old.paid_at,
      old.accepted_schedule,old.effective_schedule,old.created_at)
      or (old.status='completed' and new is distinct from old)) then
    raise exception 'Cohort rollover identity and completed evidence are immutable.';
  end if;
  select * into reservation from public.membership_commercial_reservations where id=new.reservation_id;
  select * into proof from public.stripe_membership_prepaid_proofs where reservation_id=new.reservation_id;
  select * into invoice from public.stripe_invoices where id=new.stripe_invoice_id;
  if reservation.id is null or reservation.status<>'reserved' or proof.reservation_id is null
    or proof.contract_id<>new.contract_id or proof.stripe_subscription_id<>new.stripe_subscription_id
    or proof.stripe_invoice_id<>new.stripe_invoice_id or proof.activated_at is not null
    or proof.refund_state<>'review_required' or proof.review_reason<>'cohort_cutoff_missed'
    or proof.amount_refunded<>0 or proof.stripe_refund_id is not null or proof.cancellation_id is not null
    or proof.provider_canceled_at is not null or invoice.paid_at is distinct from new.paid_at
    or invoice.stripe_status<>'paid' or invoice.amount_paid<>proof.amount_paid or invoice.amount_due<>proof.amount_paid
    or new.paid_at>clock_timestamp() or new.accepted_schedule is distinct from reservation.billing_schedule
    or new.paid_at<(new.accepted_schedule->>'cutoffAt')::timestamptz
    or not exists(select 1 from public.stripe_membership_commitments contract where contract.id=new.contract_id and contract.terms_snapshot->>'agreementVersion' ~ '^ruined_membership-v([4-9]|[1-9][0-9]+)$')
    or not private.ruined_valid_prepaid_schedule(new.effective_schedule,reservation.billing_plan)
    or new.effective_schedule->>'version'<>'foundations-prepaid-v3'
    or new.effective_schedule->>'cohortMonth'<=new.accepted_schedule->>'cohortMonth'
    or exists(select 1 from public.stripe_membership_cancellations where contract_id=new.contract_id and status<>'abandoned')
  then raise exception 'Rollover requires the original settled, unrefunded, never-activated late payment.'; end if;
  month_start:=greatest(date_trunc('month',new.paid_at at time zone 'America/Denver')::date,date '2026-11-01');
  loop
    first_thursday:=month_start+((4-extract(dow from month_start)::integer+7)%7);
    exit when new.paid_at<((first_thursday+time '15:00') at time zone 'America/Denver')-interval '24 hours';
    month_start:=(month_start+interval '1 month')::date;
  end loop;
  expected_month:=to_char(month_start,'YYYY-MM');
  if new.effective_schedule->>'cohortMonth'<>expected_month then
    raise exception 'Rollover cohort must follow actual payment time, not webhook processing time.';
  end if;
  if new.status='completed' and (new.completed_at>clock_timestamp()+interval '1 second'
    or new.provider_evidence->>'subscriptionId' is distinct from new.stripe_subscription_id
    or new.provider_evidence->>'invoiceId' is distinct from new.stripe_invoice_id
    or new.provider_evidence->>'status' is distinct from 'trialing'
    or (new.provider_evidence->>'trialEnd')::timestamptz is distinct from (new.effective_schedule->>'prepaidThrough')::timestamptz
    or (new.provider_evidence->>'billingCycleAnchor')::timestamptz is distinct from (new.effective_schedule->>'nextChargeAt')::timestamptz
    or new.provider_evidence->>'noAdditionalCharges' is distinct from 'true'
    or new.provider_evidence->>'noPendingInvoiceItems' is distinct from 'true'
    or (new.provider_evidence->>'amountPaid')::bigint is distinct from proof.amount_paid
    or new.provider_evidence->>'paymentIntentId' is distinct from proof.stripe_payment_intent_id
    or new.provider_evidence->>'chargeId' is distinct from proof.stripe_charge_id)
  then raise exception 'Complete rollover requires verified provider billing dates and the unchanged original payment.'; end if;
  return new;
end $$;
create trigger membership_cohort_rollover_guard before insert or update or delete on private.membership_cohort_rollovers
  for each row execute function private.ruined_guard_cohort_rollover();

create or replace function private.ruined_guard_prepaid_proof() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Prepaid membership evidence cannot be deleted.'; end if;
  if tg_op='UPDATE' then
    if (new.reservation_id,new.contract_id,new.member_id,new.stripe_subscription_id,new.stripe_invoice_id,
        new.stripe_payment_intent_id,new.stripe_charge_id,new.service_starts_at,new.prepaid_through,
        new.dues_amount,new.amount_paid,new.currency,new.livemode,new.created_at)
      is distinct from
       (old.reservation_id,old.contract_id,old.member_id,old.stripe_subscription_id,old.stripe_invoice_id,
        old.stripe_payment_intent_id,old.stripe_charge_id,old.service_starts_at,old.prepaid_through,
        old.dues_amount,old.amount_paid,old.currency,old.livemode,old.created_at) then
      raise exception 'Prepaid membership payment identity is immutable.';
    end if;
    if new.verified_at<old.verified_at or new.amount_refunded<old.amount_refunded
      or (old.refund_state<>'none' and new.refund_state='none' and not (old.refund_state='review_required' and old.review_reason='cohort_cutoff_missed' and new.review_reason is null and exists(select 1 from private.membership_cohort_rollovers rollover where rollover.reservation_id=new.reservation_id and rollover.status='completed')))
      or (old.refund_state='refunded' and new.refund_state<>'refunded')
      or (old.stripe_refund_id is not null and new.stripe_refund_id is distinct from old.stripe_refund_id)
      or (old.cancellation_id is not null and new.cancellation_id is distinct from old.cancellation_id)
      or (old.refund_verified_at is not null and (new.refund_verified_at is null or new.refund_verified_at<old.refund_verified_at))
      or (old.provider_canceled_at is not null and new.provider_canceled_at is distinct from old.provider_canceled_at)
      or (old.activated_at is not null and new.activated_at is distinct from old.activated_at) then
      raise exception 'Prepaid membership evidence cannot regress or be rebound.';
    end if;
  end if;
  if new.verified_at>clock_timestamp()+interval '1 second' or
    (new.refund_verified_at is not null and new.refund_verified_at>clock_timestamp()+interval '1 second') or
    (new.provider_canceled_at is not null and new.provider_canceled_at>clock_timestamp()) then
    raise exception 'Prepaid membership evidence cannot be future dated.';
  end if;
  if not exists(select 1 from public.membership_commercial_reservations reservation
    join public.stripe_checkout_attempts attempt on attempt.id=reservation.id and attempt.commercial_reservation_id=reservation.id
    join public.stripe_membership_commitments contract on contract.id=new.contract_id and contract.checkout_attempt_id=attempt.id
    join public.stripe_subscriptions subscription on subscription.id=new.stripe_subscription_id
    join public.stripe_invoices invoice on invoice.id=new.stripe_invoice_id
    where reservation.id=new.reservation_id and reservation.payer_member_id=new.member_id and reservation.billing_schedule is not null
      and attempt.member_id=new.member_id and attempt.billing_schedule=reservation.billing_schedule
      and attempt.recurring_payment_terms->'billingSchedule'=reservation.billing_schedule
      and contract.member_id=new.member_id and contract.stripe_subscription_id=new.stripe_subscription_id and contract.livemode=new.livemode
      and contract.terms_snapshot->'billingSchedule'=reservation.billing_schedule
      and (contract.terms_snapshot->>'startsAt')::timestamptz=new.service_starts_at
      and (contract.terms_snapshot->>'installmentDues')::bigint=new.dues_amount
      and (reservation.billing_schedule->>'serviceStartsAt')::timestamptz=new.service_starts_at
      and (reservation.billing_schedule->>'prepaidThrough')::timestamptz=new.prepaid_through
      and subscription.member_id=new.member_id and subscription.price_id=reservation.stripe_price_id
      and invoice.member_id=new.member_id and invoice.stripe_subscription_id=new.stripe_subscription_id
      and subscription.stripe_customer_id=contract.stripe_customer_id and invoice.stripe_customer_id=contract.stripe_customer_id
      and invoice.paid_at is not null and invoice.paid_at<=clock_timestamp() and invoice.purpose='membership' and invoice.stripe_status='paid' and invoice.currency=new.currency
      and invoice.amount_paid=new.amount_paid and invoice.amount_due=new.amount_paid) then
    raise exception 'Prepaid proof must match the accepted schedule, contract and verified invoice.';
  end if;
  if tg_op='INSERT' and exists(select 1 from public.stripe_invoices invoice
    join public.membership_commercial_reservations reservation on reservation.id=new.reservation_id
    where invoice.id=new.stripe_invoice_id and invoice.paid_at>=(reservation.billing_schedule->>'cutoffAt')::timestamptz) then
    new.refund_state:='review_required';new.review_reason:='cohort_cutoff_missed';
  end if;
  if new.cancellation_id is not null and not exists(select 1 from public.stripe_membership_cancellations cancellation
    where cancellation.id=new.cancellation_id and cancellation.contract_id=new.contract_id
      and cancellation.requested_by_member_id=new.member_id and cancellation.intent='cancel_before_start'
      and cancellation.status in ('billing_stopped','collection_in_flight','completed','manual_review')
      and cancellation.billing_stopped_at is not null) then
    raise exception 'Prepaid refund must belong to its stopped prestart cancellation.';
  end if;
  if new.provider_canceled_at>=(private.ruined_effective_prepaid_schedule(new.reservation_id)->>'serviceStartsAt')::timestamptz and not (
    new.review_reason='cohort_cutoff_missed' and new.activated_at is null and exists(
      select 1 from public.stripe_membership_cancellations cancellation
      join public.stripe_invoices invoice on invoice.id=new.stripe_invoice_id
      join public.membership_commercial_reservations reservation on reservation.id=new.reservation_id
      where cancellation.id=new.cancellation_id and cancellation.quote_snapshot->>'invalidEnrollmentReason'='cohort_cutoff_missed'
        and invoice.paid_at>=(reservation.billing_schedule->>'cutoffAt')::timestamptz)) then
    raise exception 'After-start cancellation requires verified invalid-cohort enrollment and no prior activation.';
  end if;
  if new.activated_at is not null and (new.activated_at<(private.ruined_effective_prepaid_schedule(new.reservation_id)->>'serviceStartsAt')::timestamptz or new.activated_at>clock_timestamp()) then
    raise exception 'Prepaid membership access cannot begin before service starts.';
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;

create or replace function private.ruined_activate_commercial_membership(reservation_id uuid, subscription_id text)
returns void language plpgsql security invoker set search_path='' as $$
declare reservation public.membership_commercial_reservations%rowtype; proof public.stripe_membership_prepaid_proofs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  select * into reservation from public.membership_commercial_reservations where id=reservation_id;
  if reservation.id is null or reservation.status='released' then
    raise exception using errcode='P4201',message='Membership reservation is unavailable.'; end if;
  if reservation.billing_schedule is not null then
    select * into proof from public.stripe_membership_prepaid_proofs where stripe_membership_prepaid_proofs.reservation_id=reservation.id for update;
    if proof.reservation_id is null or proof.stripe_subscription_id<>subscription_id or proof.refund_state<>'none'
      or clock_timestamp()<(private.ruined_effective_prepaid_schedule(proof.reservation_id)->>'serviceStartsAt')::timestamptz or proof.verified_at<clock_timestamp()-interval '5 minutes'
      or proof.verified_at>clock_timestamp()+interval '1 second'
      or not exists(select 1 from public.stripe_subscriptions subscription
        join public.stripe_invoices invoice on invoice.id=subscription.latest_invoice_id
          and invoice.stripe_subscription_id=subscription.id and invoice.member_id=reservation.payer_member_id
          and invoice.purpose='membership' and invoice.stripe_status='paid' and ((invoice.amount_paid>0 and invoice.amount_paid=invoice.amount_due) or (invoice.amount_paid=0 and invoice.amount_due=0 and exists(select 1 from private.membership_cohort_rollovers rollover where rollover.reservation_id=reservation.id and rollover.status='completed' and rollover.provider_evidence->>'adjustmentInvoiceId'=invoice.id)))
        where subscription.id=subscription_id and subscription.member_id=reservation.payer_member_id
          and subscription.price_id=reservation.stripe_price_id
          and ((clock_timestamp()<(private.ruined_effective_prepaid_schedule(proof.reservation_id)->>'prepaidThrough')::timestamptz and subscription.stripe_status in ('active','trialing') and (invoice.id=proof.stripe_invoice_id or (invoice.amount_paid=0 and invoice.amount_due=0 and exists(select 1 from private.membership_cohort_rollovers rollover where rollover.reservation_id=reservation.id and rollover.status='completed' and rollover.provider_evidence->>'adjustmentInvoiceId'=invoice.id))))
            or (clock_timestamp()>=(private.ruined_effective_prepaid_schedule(proof.reservation_id)->>'prepaidThrough')::timestamptz and subscription.stripe_status='active' and invoice.id<>proof.stripe_invoice_id and invoice.amount_paid>0 and invoice.amount_paid=invoice.amount_due)))
    then raise exception using errcode='P4203',message='Verified, unrefunded prepayment and current service-period billing are required.'; end if;
  end if;
  if reservation.status='activated' then
    if reservation.stripe_subscription_id<>subscription_id then raise exception using errcode='P4201',message='Membership subscription conflicts.'; end if;
    perform private.ruined_reconcile_commercial_memberships();return;
  end if;
  if not exists(select 1 from public.stripe_subscriptions subscription
    join public.stripe_invoices invoice on invoice.id=subscription.latest_invoice_id
      and invoice.stripe_subscription_id=subscription.id and invoice.member_id=reservation.payer_member_id
      and invoice.purpose='membership' and invoice.stripe_status='paid' and (invoice.amount_paid>0 or (invoice.amount_paid=0 and invoice.amount_due=0 and exists(select 1 from private.membership_cohort_rollovers rollover where rollover.reservation_id=reservation.id and rollover.status='completed' and rollover.provider_evidence->>'adjustmentInvoiceId'=invoice.id)))
    where subscription.id=subscription_id and subscription.member_id=reservation.payer_member_id
      and subscription.price_id=reservation.stripe_price_id and reservation.stripe_price_id is not null
      and subscription.stripe_status in ('active','trialing'))
  then raise exception using errcode='P4203',message='Verified paid membership billing is required.'; end if;
  update public.membership_commercial_reservations set status='activated',activated_at=clock_timestamp(),stripe_subscription_id=subscription_id where id=reservation_id;
  if reservation.billing_schedule is not null then
    update public.stripe_membership_prepaid_proofs set activated_at=coalesce(activated_at,clock_timestamp()) where stripe_membership_prepaid_proofs.reservation_id=reservation.id;
  end if;
  insert into public.membership_commercial_events(member_id,reservation_id,event_type,evidence)
    values(reservation.payer_member_id,reservation.id,'activated',jsonb_build_object('subscriptionId',subscription_id,'billingSchedule',reservation.billing_schedule));
  perform private.ruined_reconcile_commercial_memberships();
end $$;

create or replace function private.ruined_release_prepaid_membership(reservation_id uuid, subscription_id text, provider_canceled_at timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
declare reservation public.membership_commercial_reservations%rowtype; proof public.stripe_membership_prepaid_proofs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  select * into reservation from public.membership_commercial_reservations where id=reservation_id;
  if reservation.id is null then return; end if;
  select * into proof from public.stripe_membership_prepaid_proofs where stripe_membership_prepaid_proofs.reservation_id=reservation.id for update;
  if reservation.billing_schedule is null or proof.reservation_id is null or proof.stripe_subscription_id<>subscription_id
    or reservation.stripe_subscription_id is distinct from subscription_id or proof.activated_at is not null
    or provider_canceled_at is null or provider_canceled_at>clock_timestamp()
    or (provider_canceled_at>=(private.ruined_effective_prepaid_schedule(proof.reservation_id)->>'serviceStartsAt')::timestamptz and not (
      proof.review_reason='cohort_cutoff_missed' and exists(select 1 from public.stripe_membership_cancellations cancellation
        join public.stripe_invoices invoice on invoice.id=proof.stripe_invoice_id
        where cancellation.id=proof.cancellation_id and cancellation.quote_snapshot->>'invalidEnrollmentReason'='cohort_cutoff_missed'
          and invoice.paid_at>=(reservation.billing_schedule->>'cutoffAt')::timestamptz)))
    or proof.provider_canceled_at is distinct from provider_canceled_at or proof.refund_state<>'refunded'
    or proof.amount_refunded<>proof.amount_paid or proof.refund_verified_at is null
    or not exists(select 1 from public.stripe_subscriptions where id=subscription_id and member_id=reservation.payer_member_id and stripe_status='canceled')
    or exists(select 1 from public.stripe_invoices invoice where invoice.stripe_subscription_id=subscription_id and invoice.id<>proof.stripe_invoice_id
      and not (invoice.amount_paid=0 and invoice.amount_due=0 and exists(select 1 from private.membership_cohort_rollovers rollover where rollover.reservation_id=reservation.id and rollover.status='completed' and rollover.provider_evidence->>'adjustmentInvoiceId'=invoice.id)))
    or exists(select 1 from public.membership_enrollment_episodes where membership_enrollment_episodes.reservation_id=reservation.id)
  then raise exception using errcode='P4201',message='Confirm the full prestart refund and canceled subscription before releasing its place.'; end if;
  if reservation.status='released' then return; end if;
  if reservation.status<>'reserved' then raise exception using errcode='P4201',message='Active prepaid membership cannot use prestart release.'; end if;
  update public.membership_commercial_reservations set status='released',released_at=clock_timestamp(),release_reason='prepaid_cancelled_and_refunded'
    where id=reservation.id;
  insert into public.membership_commercial_events(member_id,reservation_id,event_type,evidence)
    values(reservation.payer_member_id,reservation.id,'released',jsonb_build_object('reason','prepaid_cancelled_and_refunded','subscriptionId',subscription_id,'canceledAt',provider_canceled_at,'refundId',proof.stripe_refund_id));
end $$;

create or replace function private.ruined_paid_registration_never_started(target_member_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.member_registration_access registration
    join public.ruined_members member on member.id=registration.member_id
    join public.stripe_membership_prepaid_proofs original on original.reservation_id=registration.payment_reservation_id
    where registration.member_id=target_member_id and registration.registered_at is not null
      and registration.completion_basis='paid_membership'
      and not exists(select 1 from public.membership_enrollment_episodes episode
        where episode.person_id=member.person_id and episode.started_at>=registration.registered_at)
      and not exists(select 1 from public.membership_commercial_participants participant
        join public.stripe_membership_prepaid_proofs proof on proof.reservation_id=participant.reservation_id
        where participant.person_id=member.person_id
          and (proof.reservation_id=original.reservation_id or proof.created_at>=registration.registered_at)
          and (proof.activated_at is not null or ((private.ruined_effective_prepaid_schedule(proof.reservation_id)->>'serviceStartsAt')::timestamptz<=clock_timestamp()
            and (proof.provider_canceled_at is null or proof.provider_canceled_at>=(private.ruined_effective_prepaid_schedule(proof.reservation_id)->>'serviceStartsAt')::timestamptz)))))
$$;

create or replace function private.ruined_paid_registration_refund_reserved(target_member_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.ruined_paid_registration_never_started(target_member_id) and exists(
    select 1 from public.member_registration_access registration
    join public.ruined_members member on member.id=registration.member_id
    join public.stripe_membership_prepaid_proofs original on original.reservation_id=registration.payment_reservation_id
    where registration.member_id=target_member_id
      and not exists(select 1 from public.membership_commercial_participants participant
        join public.stripe_membership_prepaid_proofs proof on proof.reservation_id=participant.reservation_id
        join public.membership_commercial_reservations reservation on reservation.id=proof.reservation_id
        left join public.stripe_membership_cancellations cancellation on cancellation.id=proof.cancellation_id
        left join public.stripe_subscriptions subscription on subscription.id=proof.stripe_subscription_id
        where participant.person_id=member.person_id
          and (proof.reservation_id=original.reservation_id or proof.created_at>=registration.registered_at)
          and not (proof.refund_state='refunded' and proof.amount_refunded=proof.amount_paid
            and proof.stripe_refund_id is not null and proof.refund_verified_at is not null
            and proof.provider_canceled_at is not null and proof.provider_canceled_at<(private.ruined_effective_prepaid_schedule(proof.reservation_id)->>'serviceStartsAt')::timestamptz
            and proof.activated_at is null and reservation.status='released'
            and reservation.release_reason='prepaid_cancelled_and_refunded'
            and coalesce(cancellation.status='completed' and cancellation.intent='cancel_before_start'
              and cancellation.billing_stopped_at is not null,false)
            and coalesce(subscription.stripe_status='canceled',false))))
$$;

revoke all on function private.ruined_effective_prepaid_schedule(uuid),private.ruined_effective_membership_terms(uuid),
  private.ruined_guard_cohort_rollover() from public,anon,authenticated;
grant execute on function private.ruined_effective_prepaid_schedule(uuid),private.ruined_effective_membership_terms(uuid) to service_role;
commit;
