begin;

-- Transactional billing notices are independent of marketing subscriptions.
-- Each environment, subscription period, and notice has one durable delivery.
create table if not exists public.stripe_membership_renewal_notices (
  id uuid primary key default gen_random_uuid(),
  subscription_id text not null references public.stripe_subscriptions(id) on delete restrict,
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  livemode boolean not null,
  renews_at timestamptz not null,
  lead_days integer not null check (lead_days in (40, 20)),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'failed', 'sent', 'cancelled', 'manual_review')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null,
  locked_at timestamptz,
  locked_by uuid,
  delivery_payload jsonb,
  invoice_preview jsonb,
  member_email_snapshot text,
  first_send_attempt_at timestamptz,
  sent_at timestamptz,
  resend_email_id text,
  last_error_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (livemode, subscription_id, renews_at, lead_days),
  check ((delivery_payload is null) = (invoice_preview is null)),
  check (status <> 'sent' or (sent_at is not null and resend_email_id is not null))
);

create index if not exists stripe_membership_renewal_notices_due_idx
  on public.stripe_membership_renewal_notices(livemode, available_at)
  where status in ('pending', 'processing', 'failed');
alter table public.stripe_membership_renewal_notices enable row level security;
revoke all on public.stripe_membership_renewal_notices from public, anon, authenticated;

commit;
