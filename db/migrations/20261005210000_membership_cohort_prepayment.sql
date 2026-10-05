begin;

-- Existing purchases retain their null schedule and original first-charge date.
alter table public.membership_commercial_reservations add column billing_schedule jsonb;
alter table public.stripe_checkout_attempts add column billing_schedule jsonb;

create function private.ruined_valid_prepaid_schedule(schedule jsonb, plan text)
returns boolean language plpgsql immutable set search_path='' as $$
declare call_at timestamptz; previous_call timestamptz; start_at timestamptz; through_at timestamptz;
  key text; value text; cohort_start date; first_thursday date; call_index integer:=0; expected_call_date date;
begin
  if schedule is null then return true; end if;
  if jsonb_typeof(schedule) is distinct from 'object' or schedule->>'version' is distinct from 'foundations-prepaid-v1'
    or schedule->>'timeZone' is distinct from 'America/Denver' or schedule->>'cohortMonth' is null or schedule->>'cohortMonth' !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or (select count(*) from jsonb_object_keys(schedule))<>9
    or jsonb_typeof(schedule->'callStartsAt') is distinct from 'array' or jsonb_array_length(schedule->'callStartsAt')<>4
    or plan is null or plan not in ('monthly','annual') or schedule->>'cohortMonth'<'2026-11' or schedule->>'cohortMonth'>'9998-12' then return false; end if;
  foreach key in array array['cutoffAt','serviceStartsAt','prepaidThrough','nextChargeAt','initialTermEndsAt'] loop
    value:=schedule->>key;
    if value is null or value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.000)?Z$' or not isfinite(value::timestamptz) then return false; end if;
  end loop;
  start_at:=(schedule->>'serviceStartsAt')::timestamptz;
  through_at:=(schedule->>'prepaidThrough')::timestamptz;
  if (schedule->>'cutoffAt')::timestamptz>=start_at or through_at<=start_at
    or (schedule->>'nextChargeAt')::timestamptz<>through_at
    or (schedule->>'initialTermEndsAt')::timestamptz<=start_at
    or through_at>(schedule->>'initialTermEndsAt')::timestamptz
    or start_at<>(schedule->'callStartsAt'->>0)::timestamptz
    or (schedule->>'cutoffAt')::timestamptz<>start_at-interval '24 hours'
    or through_at<>((start_at at time zone 'UTC')+case when plan='annual' then interval '12 months' else interval '1 month' end) at time zone 'UTC'
    or (schedule->>'initialTermEndsAt')::timestamptz<>((start_at at time zone 'UTC')+interval '12 months') at time zone 'UTC'
  then return false; end if;
  cohort_start:=((schedule->>'cohortMonth')||'-01')::date;
  first_thursday:=cohort_start+((4-extract(dow from cohort_start)::integer+7)%7);
  for value in select jsonb_array_elements_text(schedule->'callStartsAt') loop
    if value is null or value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.000)?Z$' then return false; end if;
    call_at:=value::timestamptz;
    expected_call_date:=case when call_index=3 and schedule->>'cohortMonth'='2026-11' then date '2026-11-30'
      when call_index=3 and schedule->>'cohortMonth'='2026-12' then date '2026-12-30' else first_thursday+call_index*7 end;
    if not isfinite(call_at) or call_at<start_at or (previous_call is not null and call_at<=previous_call)
      or call_at<>(expected_call_date+time '15:00') at time zone 'America/Denver' then return false; end if;
    previous_call:=call_at;call_index:=call_index+1;
  end loop;
  return true;
exception when others then return false;
end $$;
alter table public.membership_commercial_reservations add constraint membership_commercial_prepaid_schedule check (
  private.ruined_valid_prepaid_schedule(billing_schedule,billing_plan)
  and (billing_schedule is null or (first_charge_at is null and billing_schedule_bound_at is not null)));
alter table public.stripe_checkout_attempts add constraint stripe_checkout_prepaid_schedule check (
  private.ruined_valid_prepaid_schedule(billing_schedule,billing_plan)
  and (billing_schedule is null or (first_charge_at is null
    and recurring_payment_terms->>'firstPayment'='prepaid'
    and recurring_payment_terms->'billingSchedule'=billing_schedule
    and recurring_payment_accepted_at<(billing_schedule->>'cutoffAt')::timestamptz) is true));

create or replace function private.ruined_preserve_membership_billing_schedule() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='membership_commercial_reservations' then
    if old.billing_schedule_bound_at is not null and
      (new.first_charge_at is distinct from old.first_charge_at or
       new.billing_schedule is distinct from old.billing_schedule or
       new.billing_schedule_bound_at is distinct from old.billing_schedule_bound_at) then
      raise exception 'The disclosed membership billing schedule is immutable.';
    end if;
  elsif new.first_charge_at is distinct from old.first_charge_at or new.billing_schedule is distinct from old.billing_schedule then
    raise exception 'The accepted membership billing schedule is immutable.';
  end if;
  return new;
end $$;

create function private.ruined_bind_checkout_prepaid_schedule() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.commercial_reservation_id is not null and not exists(
    select 1 from public.membership_commercial_reservations reservation
    where reservation.id=new.commercial_reservation_id and reservation.payer_member_id=new.member_id
      and reservation.billing_schedule is not distinct from new.billing_schedule
      and reservation.first_charge_at is not distinct from new.first_charge_at) then
    raise exception 'Checkout must preserve the exact commercial billing schedule.';
  end if;
  return new;
end $$;
create trigger stripe_checkout_prepaid_schedule_binding before insert or update on public.stripe_checkout_attempts
  for each row execute function private.ruined_bind_checkout_prepaid_schedule();

-- Provider evidence is written only after server-side verification of the paid
-- invoice, PaymentIntent and Charge. Browser and member roles have no privileges.
create table public.stripe_membership_prepaid_proofs (
  reservation_id uuid primary key references public.membership_commercial_reservations(id) on delete restrict,
  contract_id uuid not null unique references public.stripe_membership_commitments(id) on delete restrict,
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  stripe_subscription_id text not null unique references public.stripe_subscriptions(id) on delete restrict,
  stripe_invoice_id text not null unique references public.stripe_invoices(id) on delete restrict,
  stripe_payment_intent_id text not null unique check(stripe_payment_intent_id ~ '^pi_'),
  stripe_charge_id text not null unique check(stripe_charge_id ~ '^ch_'),
  service_starts_at timestamptz not null,
  prepaid_through timestamptz not null check(prepaid_through>service_starts_at),
  dues_amount bigint not null check(dues_amount>0),
  amount_paid bigint not null check(amount_paid>=dues_amount),
  currency text not null check(currency='usd'),
  livemode boolean not null,
  verified_at timestamptz not null,
  refund_state text not null default 'none' check(refund_state in ('none','pending','partial','refunded','review_required')),
  amount_refunded bigint not null default 0 check(amount_refunded>=0 and amount_refunded<=amount_paid),
  stripe_refund_id text unique check(stripe_refund_id is null or stripe_refund_id ~ '^re_'),
  cancellation_id uuid references public.stripe_membership_cancellations(id) on delete restrict,
  refund_verified_at timestamptz,
  provider_canceled_at timestamptz,
  review_reason text,
  activated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(refund_state<>'refunded' or (amount_refunded=amount_paid and stripe_refund_id is not null and refund_verified_at is not null and cancellation_id is not null)),
  check(refund_state<>'none' or (amount_refunded=0 and stripe_refund_id is null and cancellation_id is null)),
  check(provider_canceled_at is null or provider_canceled_at<service_starts_at or (review_reason='cohort_cutoff_missed' and activated_at is null))
);
create index stripe_membership_prepaid_activation_due on public.stripe_membership_prepaid_proofs(service_starts_at,reservation_id)
  where activated_at is null and refund_state='none';
alter table public.stripe_membership_prepaid_proofs enable row level security;
revoke all on public.stripe_membership_prepaid_proofs from public,anon,authenticated;

create function private.ruined_guard_prepaid_proof() returns trigger
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
      or (old.refund_state<>'none' and new.refund_state='none')
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
  if new.provider_canceled_at>=new.service_starts_at and not (
    new.review_reason='cohort_cutoff_missed' and new.activated_at is null and exists(
      select 1 from public.stripe_membership_cancellations cancellation
      join public.stripe_invoices invoice on invoice.id=new.stripe_invoice_id
      join public.membership_commercial_reservations reservation on reservation.id=new.reservation_id
      where cancellation.id=new.cancellation_id and cancellation.quote_snapshot->>'invalidEnrollmentReason'='cohort_cutoff_missed'
        and invoice.paid_at>=(reservation.billing_schedule->>'cutoffAt')::timestamptz)) then
    raise exception 'After-start cancellation requires verified invalid-cohort enrollment and no prior activation.';
  end if;
  if new.activated_at is not null and (new.activated_at<new.service_starts_at or new.activated_at>clock_timestamp()) then
    raise exception 'Prepaid membership access cannot begin before service starts.';
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
create trigger stripe_membership_prepaid_proof_guard before insert or update or delete on public.stripe_membership_prepaid_proofs
  for each row execute function private.ruined_guard_prepaid_proof();

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
      or clock_timestamp()<proof.service_starts_at or proof.verified_at<clock_timestamp()-interval '5 minutes'
      or proof.verified_at>clock_timestamp()+interval '1 second'
      or not exists(select 1 from public.stripe_subscriptions subscription
        join public.stripe_invoices invoice on invoice.id=subscription.latest_invoice_id
          and invoice.stripe_subscription_id=subscription.id and invoice.member_id=reservation.payer_member_id
          and invoice.purpose='membership' and invoice.stripe_status='paid' and invoice.amount_paid>0 and invoice.amount_paid=invoice.amount_due
        where subscription.id=subscription_id and subscription.member_id=reservation.payer_member_id
          and subscription.price_id=reservation.stripe_price_id
          and ((clock_timestamp()<proof.prepaid_through and subscription.stripe_status in ('active','trialing') and invoice.id=proof.stripe_invoice_id)
            or (clock_timestamp()>=proof.prepaid_through and subscription.stripe_status='active' and invoice.id<>proof.stripe_invoice_id)))
    then raise exception using errcode='P4203',message='Verified, unrefunded prepayment and current service-period billing are required.'; end if;
  end if;
  if reservation.status='activated' then
    if reservation.stripe_subscription_id<>subscription_id then raise exception using errcode='P4201',message='Membership subscription conflicts.'; end if;
    perform private.ruined_reconcile_commercial_memberships();return;
  end if;
  if not exists(select 1 from public.stripe_subscriptions subscription
    join public.stripe_invoices invoice on invoice.id=subscription.latest_invoice_id
      and invoice.stripe_subscription_id=subscription.id and invoice.member_id=reservation.payer_member_id
      and invoice.purpose='membership' and invoice.stripe_status='paid' and invoice.amount_paid>0
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

create function private.ruined_release_prepaid_membership(reservation_id uuid, subscription_id text, provider_canceled_at timestamptz)
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
    or (provider_canceled_at>=proof.service_starts_at and not (
      proof.review_reason='cohort_cutoff_missed' and exists(select 1 from public.stripe_membership_cancellations cancellation
        join public.stripe_invoices invoice on invoice.id=proof.stripe_invoice_id
        where cancellation.id=proof.cancellation_id and cancellation.quote_snapshot->>'invalidEnrollmentReason'='cohort_cutoff_missed'
          and invoice.paid_at>=(reservation.billing_schedule->>'cutoffAt')::timestamptz)))
    or proof.provider_canceled_at is distinct from provider_canceled_at or proof.refund_state<>'refunded'
    or proof.amount_refunded<>proof.amount_paid or proof.refund_verified_at is null
    or not exists(select 1 from public.stripe_subscriptions where id=subscription_id and member_id=reservation.payer_member_id and stripe_status='canceled')
    or exists(select 1 from public.stripe_invoices where stripe_subscription_id=subscription_id and id<>proof.stripe_invoice_id)
    or exists(select 1 from public.membership_enrollment_episodes where membership_enrollment_episodes.reservation_id=reservation.id)
  then raise exception using errcode='P4201',message='Confirm the full prestart refund and canceled subscription before releasing its place.'; end if;
  if reservation.status='released' then return; end if;
  if reservation.status<>'reserved' then raise exception using errcode='P4201',message='Active prepaid membership cannot use prestart release.'; end if;
  update public.membership_commercial_reservations set status='released',released_at=clock_timestamp(),release_reason='prepaid_cancelled_and_refunded'
    where id=reservation.id;
  insert into public.membership_commercial_events(member_id,reservation_id,event_type,evidence)
    values(reservation.payer_member_id,reservation.id,'released',jsonb_build_object('reason','prepaid_cancelled_and_refunded','subscriptionId',subscription_id,'canceledAt',provider_canceled_at,'refundId',proof.stripe_refund_id));
end $$;

revoke all on function private.ruined_valid_prepaid_schedule(jsonb,text),private.ruined_bind_checkout_prepaid_schedule(),
  private.ruined_guard_prepaid_proof(),private.ruined_release_prepaid_membership(uuid,text,timestamptz) from public,anon,authenticated;
commit;
