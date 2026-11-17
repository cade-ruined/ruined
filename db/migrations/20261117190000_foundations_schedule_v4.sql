begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- New offers follow the approved 2027 holiday calendar. Old versions remain
-- valid exactly as accepted; no reservations, contracts or assignments change.
create or replace function private.ruined_valid_prepaid_schedule(schedule jsonb, plan text)
returns boolean language plpgsql immutable set search_path='' as $$
declare call_at timestamptz; previous_call timestamptz; start_at timestamptz; through_at timestamptz;
  key text; value text; cohort_start date; first_thursday date; call_index integer:=0; expected_call_date date;
begin
  if schedule is null then return true; end if;
  if jsonb_typeof(schedule) is distinct from 'object' or (schedule->>'version' is null or schedule->>'version' not in ('foundations-prepaid-v1','foundations-prepaid-v2','foundations-prepaid-v3','foundations-prepaid-v4'))
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
      when call_index=3 and schedule->>'cohortMonth'='2026-12' then
        case when schedule->>'version'='foundations-prepaid-v2' then date '2026-12-31' else date '2026-12-30' end
      when call_index=3 and schedule->>'version'='foundations-prepaid-v4' and schedule->>'cohortMonth'='2027-11' then date '2027-11-29'
      when call_index=3 and schedule->>'version'='foundations-prepaid-v4' and schedule->>'cohortMonth'='2027-12' then date '2027-12-30'
      else first_thursday+call_index*7 end;
    if not isfinite(call_at) or call_at<start_at or (previous_call is not null and call_at<=previous_call)
      or call_at<>(expected_call_date+time '15:00') at time zone 'America/Denver' then return false; end if;
    previous_call:=call_at;call_index:=call_index+1;
  end loop;
  return true;
exception when others then return false;
end $$;

create or replace function private.ruined_complimentary_foundations_schedule(completed_at timestamptz, requested_month text default null)
returns jsonb language plpgsql immutable set search_path='' as $$
declare month_date date; first_day date; first_call timestamptz; calls jsonb:='[]'; call_day date;
  month_key text; i integer; through_at timestamptz;
begin
  if completed_at is null or not isfinite(completed_at) then return null; end if;
  if requested_month is not null and (requested_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or requested_month<'2026-11' or requested_month>'9998-12') then
    raise exception 'Invalid Foundations group.'; end if;
  month_date:=greatest(date '2026-11-01',coalesce((requested_month||'-01')::date,date_trunc('month',completed_at at time zone 'America/Denver')::date));
  first_day:=month_date+((4-extract(dow from month_date)::integer+7)%7);
  first_call:=(first_day+time '15:00') at time zone 'America/Denver';
  while requested_month is null and completed_at>=first_call-interval '24 hours' loop
    month_date:=(month_date+interval '1 month')::date;
    first_day:=month_date+((4-extract(dow from month_date)::integer+7)%7);
    first_call:=(first_day+time '15:00') at time zone 'America/Denver';
  end loop;
  month_key:=to_char(month_date,'YYYY-MM');
  for i in 0..3 loop
    call_day:=case when i=3 and month_key='2026-11' then date '2026-11-30'
      when i=3 and month_key='2026-12' then date '2026-12-30'
      when i=3 and month_key='2027-11' then date '2027-11-29'
      when i=3 and month_key='2027-12' then date '2027-12-30' else first_day+i*7 end;
    calls:=calls||jsonb_build_array(to_char(((call_day+time '15:00') at time zone 'America/Denver') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS".000Z"'));
  end loop;
  through_at:=((first_call at time zone 'UTC')+interval '1 month') at time zone 'UTC';
  return jsonb_build_object('version','foundations-prepaid-v4','cohortMonth',month_key,'timeZone','America/Denver','callStartsAt',calls,
    'cutoffAt',to_char((first_call-interval '24 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
    'serviceStartsAt',calls->>0,'prepaidThrough',to_char(through_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
    'nextChargeAt',to_char(through_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
    'initialTermEndsAt',to_char((first_call at time zone 'UTC')+interval '12 months','YYYY-MM-DD"T"HH24:MI:SS".000Z"'));
end $$;

-- Preserve pending v3 rollovers as well as newly calculated v4 rollovers.
create or replace function private.ruined_guard_cohort_rollover() returns trigger
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
    or new.effective_schedule->>'version' not in ('foundations-prepaid-v3','foundations-prepaid-v4')
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

-- CREATE OR REPLACE retains function privileges and all existing guards.
commit;
