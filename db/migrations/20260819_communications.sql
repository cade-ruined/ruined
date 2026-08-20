begin;

-- Supabase is the canonical audience and consent store. These tables are
-- intentionally server-only: anonymous visitors submit through the guarded
-- Next.js route, while neither anon nor authenticated Data API roles receive
-- direct table access.
create table if not exists communication_contacts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid unique references ruined_members(id) on delete set null,
  email_normalized text not null unique,
  resend_contact_id text unique,
  resend_preferences_synced_at timestamptz,
  resend_preferences_snapshot jsonb,
  resend_sync_started_at timestamptz,
  resend_sync_locked_by text,
  resend_sync_snapshot jsonb,
  delivery_state text not null default 'active'
    check (delivery_state in ('active', 'bounced', 'complained', 'suppressed')),
  delivery_state_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    email_normalized = lower(btrim(email_normalized))
    and char_length(email_normalized) between 3 and 254
    and email_normalized like '%_@_%._%'
  )
);

alter table communication_contacts
  add column if not exists delivery_state_updated_at timestamptz;
alter table communication_contacts
  add column if not exists resend_preferences_synced_at timestamptz;
alter table communication_contacts
  add column if not exists resend_preferences_snapshot jsonb;
alter table communication_contacts
  add column if not exists resend_sync_started_at timestamptz;
alter table communication_contacts
  add column if not exists resend_sync_locked_by text;
alter table communication_contacts
  add column if not exists resend_sync_snapshot jsonb;

alter table communication_contacts
  drop constraint if exists communication_contacts_resend_preferences_snapshot_check;
alter table communication_contacts
  add constraint communication_contacts_resend_preferences_snapshot_check
  check (
    resend_preferences_snapshot is null
    or jsonb_typeof(resend_preferences_snapshot) = 'object'
  );

alter table communication_contacts
  drop constraint if exists communication_contacts_resend_sync_lease_check;
alter table communication_contacts
  add constraint communication_contacts_resend_sync_lease_check
  check (
    (
      resend_sync_started_at is null
      and resend_sync_locked_by is null
      and resend_sync_snapshot is null
    )
    or (
      resend_sync_started_at is not null
      and resend_sync_locked_by is not null
      and jsonb_typeof(resend_sync_snapshot) = 'object'
    )
  );

create table if not exists communication_subscriptions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references communication_contacts(id) on delete cascade,
  channel text not null check (channel = 'email'),
  topic text not null check (topic in ('store', 'artifacts', 'about')),
  status text not null
    check (status in ('pending_confirmation', 'subscribed', 'unsubscribed')),
  consent_version text not null,
  last_state_source text not null
    check (last_state_source in ('store', 'artifacts', 'about', 'resend')),
  requested_at timestamptz not null,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  state_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contact_id, channel, topic),
  check (
    (status = 'pending_confirmation' and confirmed_at is null and unsubscribed_at is null)
    or (status = 'subscribed' and confirmed_at is not null and unsubscribed_at is null)
    or (status = 'unsubscribed' and unsubscribed_at is not null)
  )
);

alter table communication_subscriptions
  add column if not exists state_changed_at timestamptz not null default now();

create table if not exists communication_consent_events (
  id bigint generated always as identity primary key,
  subscription_id uuid not null references communication_subscriptions(id) on delete cascade,
  decision text not null
    check (decision in ('pending_confirmation', 'subscribed', 'unsubscribed')),
  consent_version text not null,
  source text not null check (source in ('store', 'artifacts', 'about', 'resend')),
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

-- Confirmation links are one-time credentials. Only their SHA-256 digest is
-- retained after the queued email has been delivered.
create table if not exists communication_confirmation_tokens (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null
    references communication_subscriptions(id) on delete cascade,
  subscription_version bigint not null check (subscription_version > 0),
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, subscription_version),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

-- Store only a keyed request fingerprint, never a raw IP address. Hourly
-- buckets keep the public confirmation form useful without becoming a mail
-- harassment endpoint.
create table if not exists communication_signup_rate_limits (
  fingerprint_hash text not null
    check (fingerprint_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null default 1 check (attempts between 1 and 100),
  updated_at timestamptz not null default now(),
  primary key (fingerprint_hash, window_started_at),
  check (window_started_at = date_trunc('hour', window_started_at))
);

-- Resend delivers webhooks at least once. Keep a minimal, PII-free receipt so
-- replayed svix IDs can be acknowledged without applying consent twice.
create table if not exists communication_webhook_events (
  svix_id text primary key check (char_length(svix_id) between 1 and 255),
  event_type text not null check (char_length(event_type) between 1 and 100),
  external_object_id text,
  event_created_at timestamptz not null,
  processed_at timestamptz not null default now()
);

create index if not exists communication_subscriptions_audience_idx
  on communication_subscriptions(channel, topic, status, updated_at desc);
create index if not exists communication_consent_events_subscription_idx
  on communication_consent_events(subscription_id, occurred_at desc);
create index if not exists communication_confirmation_tokens_expires_idx
  on communication_confirmation_tokens(expires_at)
  where consumed_at is null;
create index if not exists communication_webhook_events_processed_idx
  on communication_webhook_events(processed_at desc);

-- Retained decisions cannot be rewritten. Deletion remains available only via
-- the server-side contact erasure path, whose cascade removes the related
-- consent history instead of leaving personal data behind.
drop trigger if exists communication_consent_events_no_update
  on communication_consent_events;
create trigger communication_consent_events_no_update
before update on communication_consent_events
for each row execute function ruined_reject_append_only_mutation();

-- Resend is a delivery destination, not the contact source of truth. The
-- durable outbox lets a later worker synchronize contacts without making the
-- public signup depend on a network call.
alter table integration_outbox
  drop constraint if exists integration_outbox_destination_check;
alter table integration_outbox
  add constraint integration_outbox_destination_check
  check (destination in ('shopify', 'stripe', 'google', 'resend'));

alter table communication_contacts enable row level security;
alter table communication_subscriptions enable row level security;
alter table communication_consent_events enable row level security;
alter table communication_confirmation_tokens enable row level security;
alter table communication_signup_rate_limits enable row level security;
alter table communication_webhook_events enable row level security;

revoke all on table
  communication_contacts,
  communication_subscriptions,
  communication_consent_events,
  communication_confirmation_tokens,
  communication_signup_rate_limits,
  communication_webhook_events
from anon, authenticated;

revoke all on sequence communication_consent_events_id_seq
from anon, authenticated;

commit;
