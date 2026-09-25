begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

alter table public.member_onboardings
  add column billing_plan text check (billing_plan in ('monthly', 'annual'));

comment on column public.member_onboardings.billing_plan is
  'Verified member signup selection. This is not a billing entitlement; Checkout maps the plan to its configured Stripe price and payment is confirmed by webhook.';

create table public.member_signup_rate_limits (
  fingerprint_hash text not null check (fingerprint_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 8),
  primary key (fingerprint_hash, window_started_at)
);
alter table public.member_signup_rate_limits enable row level security;
revoke all on public.member_signup_rate_limits from public, anon, authenticated;

commit;
