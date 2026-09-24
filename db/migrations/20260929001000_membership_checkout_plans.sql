begin;

-- Preserve existing attempts as legacy. Never infer a paid plan from a pilot price.
alter table public.stripe_checkout_attempts
  add column if not exists billing_plan text,
  add column if not exists stripe_price_id text,
  add column if not exists recurring_payment_accepted_at timestamptz,
  add column if not exists billing_consent_auth_user_id uuid,
  add column if not exists recurring_payment_terms jsonb;

alter table public.stripe_checkout_attempts
  drop constraint if exists stripe_checkout_attempts_billing_plan_check;
alter table public.stripe_checkout_attempts
  add constraint stripe_checkout_attempts_billing_plan_check check (
    (billing_plan is null and stripe_price_id is null)
    or (billing_plan is not null and billing_plan in ('monthly', 'annual')
      and stripe_price_id is not null and stripe_price_id like 'price_%'
      and recurring_payment_accepted_at is not null
      and billing_consent_auth_user_id is not null
      and recurring_payment_terms is not null)
  );

commit;
