begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Existing browser-approved attempts keep their original evidence. A newly
-- prepared Stripe form is not consent and is never marked accepted on creation.
alter table public.stripe_checkout_attempts
  add column billing_consent_source text not null default 'member',
  add column checkout_prepared_at timestamptz not null default clock_timestamp(),
  add column billing_consent_evidence jsonb;
alter table public.stripe_checkout_attempts add constraint stripe_checkout_consent_source check (
  billing_consent_source in ('member','stripe_checkout') and (
    (billing_consent_source='member' and billing_consent_evidence is null)
    or (billing_consent_source='stripe_checkout' and commercial_reservation_id is not null and (
      (recurring_payment_accepted_at is null and billing_consent_evidence is null)
      or (recurring_payment_accepted_at is not null and (
        billing_consent_evidence->>'source'='stripe_checkout'
        and billing_consent_evidence->>'termsOfService'='accepted'
        and billing_consent_evidence->>'sessionId'=stripe_session_id
        and billing_consent_evidence->>'subscriptionId'=stripe_subscription_id
        and billing_consent_evidence->>'memberId'=member_id::text
        and billing_consent_evidence->>'attemptId'=id::text
        and (billing_consent_evidence->>'verifiedAt')::timestamptz=recurring_payment_accepted_at
      ) is true)
    ))) is true
);

-- Preparation freezes the same disclosed price, actor and billing schedule.
-- The prepared timestamp only bounds offer eligibility; it is NOT the member's
-- consent timestamp. The latter is filled once when provider consent is verified.
alter table public.stripe_checkout_attempts drop constraint stripe_checkout_attempts_billing_plan_check;
alter table public.stripe_checkout_attempts
  add constraint stripe_checkout_attempts_billing_plan_check check (
    (billing_plan is null and stripe_price_id is null)
    or (billing_plan is not null and billing_plan in ('monthly', 'annual')
      and stripe_price_id is not null and stripe_price_id like 'price_%'
      and (recurring_payment_accepted_at is not null or billing_consent_source='stripe_checkout')
      and billing_consent_auth_user_id is not null
      and recurring_payment_terms is not null)
  );
alter table public.stripe_checkout_attempts drop constraint stripe_checkout_commercial_consent_check;
alter table public.stripe_checkout_attempts add constraint stripe_checkout_commercial_consent_check check ((
  (commercial_reservation_id is null and offer_id is null and recurring_payment_terms->>'version' is distinct from 'membership-billing-v2')
  or (commercial_reservation_id is not null and commercial_reservation_id = id
    and offer_id in ('individual_monthly', 'individual_annual', 'founding_individual_monthly', 'founding_individual_annual', 'couple_monthly', 'couple_annual')
    and recurring_payment_terms->>'version' = 'membership-billing-v2'
    and recurring_payment_terms->>'commercialReservationId' = commercial_reservation_id::text
    and recurring_payment_terms->>'offerId' = offer_id
    and recurring_payment_terms->>'plan' = billing_plan
    and recurring_payment_terms->>'currency' = 'usd'
    and recurring_payment_terms->>'taxBehavior' = 'exclusive'
    and recurring_payment_terms->>'initialTermMonths' = '12'
    and recurring_payment_terms->>'buyoutCap' = '150000'
    and recurring_payment_terms->>'buyoutReplacesRemainingInstallments' = 'true'
    and (recurring_payment_accepted_at is not null or billing_consent_source='stripe_checkout') and billing_consent_auth_user_id is not null)
) is true);
alter table public.stripe_checkout_attempts drop constraint stripe_checkout_prepaid_schedule;
alter table public.stripe_checkout_attempts add constraint stripe_checkout_prepaid_schedule check (
  private.ruined_valid_prepaid_schedule(billing_schedule,billing_plan)
  and (billing_schedule is null or (first_charge_at is null
    and recurring_payment_terms->>'firstPayment'='prepaid'
    and recurring_payment_terms->'billingSchedule'=billing_schedule
    and (case when billing_consent_source='stripe_checkout' then checkout_prepared_at else recurring_payment_accepted_at end)<(billing_schedule->>'cutoffAt')::timestamptz) is true));
alter table public.stripe_checkout_attempts drop constraint stripe_checkout_first_charge_consent;
alter table public.stripe_checkout_attempts add constraint stripe_checkout_first_charge_consent check (
  first_charge_at is null or (
    recurring_payment_terms->>'firstPayment'='scheduled'
    and (recurring_payment_terms->>'firstChargeAt')::timestamptz=first_charge_at
    and first_charge_at > (case when billing_consent_source='stripe_checkout' then checkout_prepared_at else recurring_payment_accepted_at end)
    and expires_at < first_charge_at
  ) is true
);

create or replace function private.ruined_preserve_checkout_billing_consent()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.billing_consent_source is distinct from old.billing_consent_source
    or new.checkout_prepared_at is distinct from old.checkout_prepared_at then
    raise exception 'Checkout consent source and preparation are immutable';
  end if;
  if (old.recurring_payment_accepted_at is not null or old.billing_consent_source='stripe_checkout') and (
    new.billing_plan is distinct from old.billing_plan or new.stripe_price_id is distinct from old.stripe_price_id
    or new.billing_consent_auth_user_id is distinct from old.billing_consent_auth_user_id
    or new.recurring_payment_terms is distinct from old.recurring_payment_terms
    or new.commercial_reservation_id is distinct from old.commercial_reservation_id
    or new.offer_id is distinct from old.offer_id
    or new.agreement_acceptance_id is distinct from old.agreement_acceptance_id
    or new.agreement_version is distinct from old.agreement_version
    or new.member_id is distinct from old.member_id or new.email_normalized is distinct from old.email_normalized
    or new.agreement_accepted_at is distinct from old.agreement_accepted_at
    or new.age_attested_at is distinct from old.age_attested_at
  ) then raise exception 'Stored billing consent is immutable'; end if;
  if old.recurring_payment_accepted_at is not null and (
    new.recurring_payment_accepted_at is distinct from old.recurring_payment_accepted_at
    or new.billing_consent_evidence is distinct from old.billing_consent_evidence
  ) then raise exception 'Stored billing consent is immutable'; end if;
  return new;
end $$;
commit;
