begin;

create table if not exists ruined_members (
  id uuid primary key,
  email text not null,
  email_normalized text not null unique,
  stripe_customer_id text unique,
  membership_state text not null default 'pending'
    check (membership_state in ('pending', 'active', 'attention_required', 'ended')),
  membership_activated_at timestamptz,
  membership_ended_at timestamptz,
  billing_attention_at timestamptz,
  agreement_version text,
  agreement_accepted_at timestamptz,
  age_attested_at timestamptz,
  billing_last_event_created bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists stripe_checkout_sessions (
  id text primary key,
  member_id uuid not null references ruined_members(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  payment_status text,
  session_status text,
  livemode boolean not null,
  last_event_created bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists stripe_customer_links (
  stripe_customer_id text primary key,
  member_id uuid not null references ruined_members(id) on delete cascade,
  email_normalized text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_customer_links_member_idx
  on stripe_customer_links(member_id);

create index if not exists stripe_checkout_sessions_member_idx
  on stripe_checkout_sessions(member_id);

create table if not exists stripe_checkout_attempts (
  id uuid primary key,
  member_id uuid not null references ruined_members(id) on delete cascade,
  email_normalized text not null,
  status text not null default 'creating'
    check (status in ('creating', 'open', 'completed', 'expired', 'failed')),
  stripe_session_id text unique,
  stripe_subscription_id text,
  agreement_version text not null,
  agreement_accepted_at timestamptz not null,
  age_attested_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table stripe_checkout_attempts
  add column if not exists stripe_subscription_id text;

update stripe_checkout_attempts attempt
set stripe_subscription_id = session.stripe_subscription_id
from stripe_checkout_sessions session
where attempt.stripe_session_id = session.id
  and attempt.stripe_subscription_id is null
  and session.stripe_subscription_id is not null;

create unique index if not exists stripe_checkout_attempts_one_open_idx
  on stripe_checkout_attempts(member_id)
  where status in ('creating', 'open');

create index if not exists stripe_checkout_attempts_member_idx
  on stripe_checkout_attempts(member_id);

create index if not exists stripe_checkout_attempts_expiry_idx
  on stripe_checkout_attempts(status, expires_at);

create table if not exists stripe_subscriptions (
  id text primary key,
  member_id uuid not null references ruined_members(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_status text not null,
  price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  automatic_tax_enabled boolean not null default false,
  automatic_tax_disabled_reason text,
  cancel_at_period_end boolean not null default false,
  latest_invoice_id text,
  last_event_created bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_subscriptions_member_idx
  on stripe_subscriptions(member_id);

create index if not exists stripe_subscriptions_customer_idx
  on stripe_subscriptions(stripe_customer_id);

create table if not exists stripe_invoices (
  id text primary key,
  member_id uuid references ruined_members(id) on delete set null,
  stripe_customer_id text,
  stripe_subscription_id text,
  purpose text not null
    check (purpose in ('membership', 'membership_price_mismatch', 'consulting', 'unclassified')),
  stripe_status text,
  billing_reason text,
  amount_due bigint not null default 0,
  amount_paid bigint not null default 0,
  currency text not null,
  last_event_created bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_invoices_customer_idx
  on stripe_invoices(stripe_customer_id);

create index if not exists stripe_invoices_subscription_idx
  on stripe_invoices(stripe_subscription_id);

create index if not exists stripe_invoices_member_idx
  on stripe_invoices(member_id);

create table if not exists stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  object_id text,
  livemode boolean not null,
  stripe_created bigint not null,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists stripe_webhook_events_status_idx
  on stripe_webhook_events(status, updated_at);

-- These tables hold billing identity and entitlement-adjacent state. With no
-- policies, Supabase's anonymous/authenticated REST roles cannot read them;
-- the trusted server connection remains the only intended access path.
alter table ruined_members enable row level security;
alter table stripe_checkout_sessions enable row level security;
alter table stripe_checkout_attempts enable row level security;
alter table stripe_customer_links enable row level security;
alter table stripe_subscriptions enable row level security;
alter table stripe_invoices enable row level security;
alter table stripe_webhook_events enable row level security;

revoke all on table
  ruined_members,
  stripe_checkout_sessions,
  stripe_checkout_attempts,
  stripe_customer_links,
  stripe_subscriptions,
  stripe_invoices,
  stripe_webhook_events
from anon, authenticated;

commit;
