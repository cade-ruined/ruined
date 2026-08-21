begin;

-- Event registrations are written only by the guarded Next.js route through
-- the server-side Postgres connection. No Supabase Data API role receives
-- direct access to attendee names, email addresses, or acknowledgment records.
create table if not exists community_event_waiver_versions (
  event_key text not null,
  version text not null,
  title text not null,
  body text not null,
  content_sha256 text not null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (event_key, version),
  check (
    event_key = btrim(event_key)
    and char_length(event_key) between 1 and 80
    and event_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  check (
    version = btrim(version)
    and char_length(version) between 1 and 120
    and version ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  check (title = btrim(title) and char_length(title) between 1 and 160),
  check (body = btrim(body) and char_length(body) between 100 and 10000),
  check (content_sha256 ~ '^[0-9a-f]{64}$')
);

-- A registration covers one group roster, but the risk acknowledgment applies
-- only to the named registrant. Each guest must acknowledge participation risk
-- separately before taking part.
create table if not exists community_event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  registrant_name text not null,
  email_normalized text not null,
  instagram_handle text,
  waiver_version text not null,
  waiver_accepted_at timestamptz not null default now(),
  waiver_acceptance_evidence jsonb not null default '{}'::jsonb,
  status text not null default 'registered'
    check (status in ('registered', 'cancelled')),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_key, email_normalized),
  foreign key (event_key, waiver_version)
    references community_event_waiver_versions(event_key, version)
    on update restrict
    on delete restrict,
  check (
    event_key = btrim(event_key)
    and char_length(event_key) between 1 and 80
    and event_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  check (
    registrant_name = btrim(registrant_name)
    and char_length(registrant_name) between 1 and 120
  ),
  check (
    email_normalized = lower(btrim(email_normalized))
    and char_length(email_normalized) between 3 and 254
    and email_normalized like '%_@_%._%'
  ),
  check (
    instagram_handle is null
    or (
      instagram_handle = lower(btrim(instagram_handle))
      and char_length(instagram_handle) between 1 and 30
      and instagram_handle ~ '^[a-z0-9._]+$'
    )
  ),
  check (jsonb_typeof(waiver_acceptance_evidence) = 'object'),
  check (
    waiver_acceptance_evidence @> '{"affirmative_action":"required_checkbox","scope":"registrant_only"}'::jsonb
  ),
  check (
    (status = 'registered' and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
  )
);

create table if not exists community_event_registration_guests (
  registration_id uuid not null
    references community_event_registrations(id) on delete cascade,
  position smallint not null check (position between 1 and 24),
  guest_name text not null,
  created_at timestamptz not null default now(),
  primary key (registration_id, position),
  check (
    guest_name = btrim(guest_name)
    and char_length(guest_name) between 1 and 120
  )
);

-- Store only a keyed request fingerprint, never a raw IP address. The event key
-- and hour are included in the HMAC domain before this value reaches Postgres.
create table if not exists community_event_registration_rate_limits (
  event_key text not null,
  fingerprint_hash text not null
    check (fingerprint_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null default 1 check (attempts between 1 and 100),
  updated_at timestamptz not null default now(),
  primary key (event_key, fingerprint_hash, window_started_at),
  check (
    event_key = btrim(event_key)
    and char_length(event_key) between 1 and 80
    and event_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  check (window_started_at = date_trunc('hour', window_started_at))
);

create index if not exists community_event_registrations_event_status_idx
  on community_event_registrations(event_key, status, created_at desc);
create index if not exists community_event_registrations_waiver_idx
  on community_event_registrations(event_key, waiver_version);
create index if not exists community_event_registration_rate_limits_window_idx
  on community_event_registration_rate_limits(window_started_at);

drop trigger if exists community_event_waiver_versions_append_only
  on community_event_waiver_versions;
create trigger community_event_waiver_versions_append_only
before update or delete on community_event_waiver_versions
for each row execute function ruined_reject_append_only_mutation();

insert into community_event_waiver_versions (
  event_key,
  version,
  title,
  body,
  content_sha256
) values (
  'byob-02',
  'byob-02-risk-acknowledgment-v1',
  'Participation and risk acknowledgment',
  'BYOB Nº 02 is a voluntary physical gathering. I understand that participation may involve strenuous movement, uneven terrain, changing weather, equipment, and other risks of injury or property damage. I am responsible for deciding whether I can participate safely, using equipment responsibly, and stopping when needed. I knowingly accept these risks for my own participation. This acknowledgment applies only to me; every guest must complete their own acknowledgment before participating.',
  '856b80c11f6a063267063e8d4d2644882b6da9edfdebe733881e09e9f8102952'
)
on conflict (event_key, version) do nothing;

alter table community_event_waiver_versions enable row level security;
alter table community_event_registrations enable row level security;
alter table community_event_registration_guests enable row level security;
alter table community_event_registration_rate_limits enable row level security;

revoke all on table
  community_event_waiver_versions,
  community_event_registrations,
  community_event_registration_guests,
  community_event_registration_rate_limits
from public, anon, authenticated, service_role;

commit;
