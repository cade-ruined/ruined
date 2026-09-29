begin;

-- Older accepted purchases remain v1. Only an explicit new quote/consent may
-- acquire these references and initial-commitment terms.
alter table public.stripe_checkout_attempts
  add column commercial_reservation_id uuid references public.membership_commercial_reservations(id) on delete restrict,
  add column offer_id text;

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
    and recurring_payment_accepted_at is not null and billing_consent_auth_user_id is not null)
) is true);

-- Consent is evidence, not a mutable reflection of current catalog configuration.
create function private.ruined_preserve_checkout_billing_consent()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.recurring_payment_accepted_at is not null and (
    new.billing_plan is distinct from old.billing_plan or new.stripe_price_id is distinct from old.stripe_price_id
    or new.recurring_payment_accepted_at is distinct from old.recurring_payment_accepted_at
    or new.billing_consent_auth_user_id is distinct from old.billing_consent_auth_user_id
    or new.recurring_payment_terms is distinct from old.recurring_payment_terms
    or new.commercial_reservation_id is distinct from old.commercial_reservation_id
    or new.offer_id is distinct from old.offer_id
    or new.agreement_acceptance_id is distinct from old.agreement_acceptance_id
    or new.agreement_version is distinct from old.agreement_version
  ) then raise exception 'Stored billing consent is immutable'; end if;
  return new;
end
$$;
create trigger stripe_checkout_preserve_billing_consent before update on public.stripe_checkout_attempts
  for each row execute function private.ruined_preserve_checkout_billing_consent();
revoke all on function private.ruined_preserve_checkout_billing_consent() from public, anon, authenticated;

commit;
