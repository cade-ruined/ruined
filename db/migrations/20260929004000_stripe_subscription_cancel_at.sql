begin;

-- Flexible billing can schedule an end using cancel_at while keeping
-- cancel_at_period_end=false. Preserve Stripe's canonical timestamp.
alter table public.stripe_subscriptions
  add column if not exists cancel_at timestamptz;

commit;
