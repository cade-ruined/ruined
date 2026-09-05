begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- The link is the current projection used by the operator application. Provider
-- responses and attendee reconciliation remain in the append-only ledgers below.
create table if not exists public.experience_calendar_links (
  id uuid primary key default gen_random_uuid(),
  experience_id uuid not null
    references public.experiences(id) on delete restrict,
  provider text not null default 'google'
    check (provider = 'google'),
  organizer_calendar_id text not null,
  provider_event_id text,
  provider_event_etag text,
  provider_ical_uid text,
  provider_html_url text,
  provider_conference_id text,
  meet_url text,
  status text not null default 'pending_create'
    check (status in (
      'pending_create', 'pending_update', 'pending_cancel',
      'active', 'cancelled', 'failed'
    )),
  desired_experience_version bigint not null check (desired_experience_version > 0),
  synced_experience_version bigint
    check (synced_experience_version is null or synced_experience_version > 0),
  desired_attendee_revision bigint not null default 1
    check (desired_attendee_revision > 0),
  synced_attendee_revision bigint
    check (synced_attendee_revision is null or synced_attendee_revision > 0),
  current_sync_request_id uuid,
  last_synced_at timestamptz,
  last_failed_at timestamptz,
  last_failure_code text,
  version bigint not null default 1 check (version > 0),
  created_by_auth_user_id uuid not null
    references public.platform_users(auth_user_id) on delete restrict,
  updated_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (experience_id, provider),
  unique (id, experience_id),
  check (char_length(btrim(organizer_calendar_id)) between 1 and 1024),
  check (
    provider_event_id is null
    or char_length(btrim(provider_event_id)) between 1 and 1024
  ),
  check (
    provider_event_etag is null
    or char_length(btrim(provider_event_etag)) between 1 and 1024
  ),
  check (
    provider_ical_uid is null
    or char_length(btrim(provider_ical_uid)) between 1 and 1024
  ),
  check (
    provider_html_url is null
    or (
      char_length(btrim(provider_html_url)) between 1 and 2048
      and provider_html_url ~ '^https://'
    )
  ),
  check (
    provider_conference_id is null
    or char_length(btrim(provider_conference_id)) between 1 and 1024
  ),
  check (meet_url is null or meet_url ~ '^https://meet\\.google\\.com/'),
  check (
    synced_experience_version is null
    or synced_experience_version <= desired_experience_version
  ),
  check (
    synced_attendee_revision is null
    or synced_attendee_revision <= desired_attendee_revision
  ),
  check (
    status not in ('pending_update', 'pending_cancel', 'active', 'cancelled')
    or provider_event_id is not null
  ),
  check (
    status <> 'active'
    or (
      last_synced_at is not null
      and synced_experience_version = desired_experience_version
      and synced_attendee_revision = desired_attendee_revision
    )
  ),
  check (
    status <> 'cancelled'
    or last_synced_at is not null
  ),
  check (
    status <> 'failed'
    or (last_failed_at is not null and last_failure_code is not null)
  ),
  check (
    last_failure_code is null
    or char_length(btrim(last_failure_code)) between 1 and 200
  ),
  check (updated_at >= created_at)
);

create unique index if not exists experience_calendar_links_provider_event_idx
  on public.experience_calendar_links(
    provider,
    organizer_calendar_id,
    provider_event_id
  )
  where provider_event_id is not null;
create index if not exists experience_calendar_links_status_idx
  on public.experience_calendar_links(status, updated_at)
  where status in ('pending_create', 'pending_update', 'pending_cancel', 'failed');
create index if not exists experience_calendar_links_creator_idx
  on public.experience_calendar_links(created_by_auth_user_id);
create index if not exists experience_calendar_links_updater_idx
  on public.experience_calendar_links(updated_by_auth_user_id);

-- One row represents one logical operator request. The unique request key and
-- fingerprint make an HTTP retry resolve to this row rather than a second
-- Google event. Status is a current projection; every transition is also
-- written to experience_calendar_sync_events.
create table if not exists public.experience_calendar_sync_requests (
  id uuid primary key default gen_random_uuid(),
  calendar_link_id uuid not null,
  experience_id uuid not null,
  operator_audit_event_id bigint not null
    references public.operator_audit_events(id) on delete restrict,
  action text not null check (action in ('create', 'update', 'cancel', 'reconcile')),
  request_key text not null unique,
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  conference_request_key text unique,
  expected_link_version bigint not null check (expected_link_version > 0),
  desired_experience_version bigint not null check (desired_experience_version > 0),
  desired_attendee_revision bigint not null check (desired_attendee_revision > 0),
  attendee_set_sha256 text not null
    check (attendee_set_sha256 ~ '^[0-9a-f]{64}$'),
  event_snapshot jsonb not null
    check (jsonb_typeof(event_snapshot) = 'object'),
  attendee_count integer not null default 0 check (attendee_count >= 0),
  send_updates text not null default 'all' check (send_updates = 'all'),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'succeeded', 'failed', 'superseded')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (id, calendar_link_id, experience_id),
  foreign key (calendar_link_id, experience_id)
    references public.experience_calendar_links(id, experience_id)
    on delete restrict,
  check (char_length(request_key) between 16 and 200),
  check (
    conference_request_key is null
    or char_length(conference_request_key) between 16 and 200
  ),
  check (jsonb_typeof(event_snapshot -> 'attendees') in ('array', 'null')),
  check (
    status <> 'processing'
    or (attempt_count > 0 and last_attempt_at is not null)
  ),
  check (
    status not in ('succeeded', 'failed', 'superseded')
    or (completed_at is not null and next_attempt_at is null)
  ),
  check (
    status in ('succeeded', 'failed', 'superseded')
    or completed_at is null
  ),
  check (
    status <> 'failed'
    or last_error_code is not null
  ),
  check (
    last_error_code is null
    or char_length(btrim(last_error_code)) between 1 and 200
  ),
  check (
    last_error_message is null
    or char_length(btrim(last_error_message)) between 1 and 2000
  ),
  check (last_attempt_at is null or last_attempt_at >= created_at),
  check (completed_at is null or completed_at >= created_at),
  check (updated_at >= created_at)
);

create index if not exists experience_calendar_sync_requests_link_idx
  on public.experience_calendar_sync_requests(calendar_link_id, created_at desc);
create index if not exists experience_calendar_sync_requests_experience_idx
  on public.experience_calendar_sync_requests(experience_id, created_at desc);
create index if not exists experience_calendar_sync_requests_audit_idx
  on public.experience_calendar_sync_requests(operator_audit_event_id);
create index if not exists experience_calendar_sync_requests_status_idx
  on public.experience_calendar_sync_requests(status, next_attempt_at, created_at)
  where status in ('queued', 'processing');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.experience_calendar_links'::regclass
      and conname = 'experience_calendar_links_current_request_fkey'
  ) then
    alter table public.experience_calendar_links
      add constraint experience_calendar_links_current_request_fkey
      foreign key (current_sync_request_id, id, experience_id)
      references public.experience_calendar_sync_requests(
        id,
        calendar_link_id,
        experience_id
      )
      on delete restrict
      deferrable initially deferred
      not valid;
  end if;
end;
$$;

alter table public.experience_calendar_links
  validate constraint experience_calendar_links_current_request_fkey;

create index if not exists experience_calendar_links_current_request_idx
  on public.experience_calendar_links(current_sync_request_id)
  where current_sync_request_id is not null;

create table if not exists public.experience_calendar_sync_events (
  id bigint generated always as identity primary key,
  sync_request_id uuid not null,
  calendar_link_id uuid not null,
  experience_id uuid not null,
  event_type text not null
    check (event_type in (
      'requested', 'attempt_started', 'retry_scheduled',
      'provider_created', 'provider_updated', 'provider_cancelled',
      'provider_observed', 'failed', 'superseded'
    )),
  attempt_number integer not null default 0 check (attempt_number >= 0),
  provider_http_status integer
    check (provider_http_status is null or provider_http_status between 100 and 599),
  provider_event_id text,
  provider_event_etag text,
  failure_code text,
  failure_message text,
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  dedupe_key text not null unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (sync_request_id, calendar_link_id, experience_id)
    references public.experience_calendar_sync_requests(
      id,
      calendar_link_id,
      experience_id
    )
    on delete restrict,
  check (char_length(dedupe_key) between 16 and 300),
  check (
    event_type not in ('attempt_started', 'retry_scheduled', 'provider_created',
      'provider_updated', 'provider_cancelled', 'provider_observed', 'failed')
    or attempt_number > 0
  ),
  check (
    event_type not in (
      'provider_created', 'provider_updated', 'provider_cancelled', 'provider_observed'
    )
    or provider_event_id is not null
  ),
  check (
    event_type not in ('retry_scheduled', 'failed')
    or failure_code is not null
  ),
  check (
    failure_code is null
    or char_length(btrim(failure_code)) between 1 and 200
  ),
  check (
    failure_message is null
    or char_length(btrim(failure_message)) between 1 and 2000
  )
);

create index if not exists experience_calendar_sync_events_request_idx
  on public.experience_calendar_sync_events(sync_request_id, occurred_at desc, id desc);
create index if not exists experience_calendar_sync_events_link_idx
  on public.experience_calendar_sync_events(calendar_link_id, occurred_at desc, id desc);
create index if not exists experience_calendar_sync_events_experience_idx
  on public.experience_calendar_sync_events(experience_id, occurred_at desc, id desc);
create index if not exists experience_calendar_sync_events_actor_idx
  on public.experience_calendar_sync_events(actor_auth_user_id, occurred_at desc);

-- Google acknowledges an attendee mutation, but it does not provide an inbox
-- delivery receipt. These rows deliberately record requested/applied/failed
-- provider outcomes instead of claiming an email was delivered.
create table if not exists public.experience_calendar_attendee_events (
  id bigint generated always as identity primary key,
  sync_request_id uuid not null,
  calendar_link_id uuid not null,
  experience_id uuid not null,
  person_id uuid not null references public.people(id) on delete restrict,
  member_id uuid references public.ruined_members(id) on delete restrict,
  registration_id uuid
    references public.experience_registrations(id) on delete restrict,
  attendee_email text not null,
  assignment_source text not null
    check (assignment_source in (
      'registration', 'circle', 'block', 'all_active_members',
      'direct', 'waitlist_promotion', 'system_reconciliation'
    )),
  action text not null check (action in ('add', 'update', 'remove', 'observe')),
  outcome text not null check (outcome in ('requested', 'applied', 'failed', 'skipped')),
  provider_response_status text
    check (provider_response_status in (
      'needs_action', 'accepted', 'declined', 'tentative', 'unknown'
    )),
  failure_code text,
  failure_message text,
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  dedupe_key text not null unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (sync_request_id, calendar_link_id, experience_id)
    references public.experience_calendar_sync_requests(
      id,
      calendar_link_id,
      experience_id
    )
    on delete restrict,
  foreign key (member_id, person_id)
    references public.ruined_members(id, person_id) on delete restrict,
  check (char_length(btrim(attendee_email)) between 3 and 320),
  check (position('@' in attendee_email) > 1),
  check (
    outcome <> 'failed'
    or failure_code is not null
  ),
  check (
    failure_code is null
    or char_length(btrim(failure_code)) between 1 and 200
  ),
  check (
    failure_message is null
    or char_length(btrim(failure_message)) between 1 and 2000
  ),
  check (outcome = 'failed' or failure_code is null)
);

create index if not exists experience_calendar_attendee_events_request_idx
  on public.experience_calendar_attendee_events(sync_request_id, occurred_at desc, id desc);
create index if not exists experience_calendar_attendee_events_link_person_idx
  on public.experience_calendar_attendee_events(
    calendar_link_id,
    person_id,
    occurred_at desc,
    id desc
  );
create index if not exists experience_calendar_attendee_events_experience_idx
  on public.experience_calendar_attendee_events(experience_id, occurred_at desc, id desc);
create index if not exists experience_calendar_attendee_events_person_idx
  on public.experience_calendar_attendee_events(person_id, occurred_at desc, id desc);
create index if not exists experience_calendar_attendee_events_member_idx
  on public.experience_calendar_attendee_events(member_id, occurred_at desc, id desc)
  where member_id is not null;
create index if not exists experience_calendar_attendee_events_registration_idx
  on public.experience_calendar_attendee_events(registration_id, occurred_at desc, id desc)
  where registration_id is not null;
create index if not exists experience_calendar_attendee_events_actor_idx
  on public.experience_calendar_attendee_events(actor_auth_user_id, occurred_at desc);
create index if not exists experience_calendar_attendee_events_failures_idx
  on public.experience_calendar_attendee_events(experience_id, occurred_at desc)
  where outcome = 'failed';

create or replace function private.ruined_guard_experience_calendar_link_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Experience calendar links cannot be deleted.';
  end if;

  if new.id is distinct from old.id
     or new.experience_id is distinct from old.experience_id
     or new.provider is distinct from old.provider
     or new.organizer_calendar_id is distinct from old.organizer_calendar_id
     or new.created_by_auth_user_id is distinct from old.created_by_auth_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Experience calendar link identity is immutable.';
  end if;

  if new.version <> old.version + 1 then
    raise exception 'Experience calendar link version must increase by exactly one.';
  end if;

  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'A cancelled Google Calendar link cannot be reactivated.';
  end if;

  return new;
end;
$$;

create or replace function private.ruined_guard_experience_calendar_sync_request_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Experience calendar sync requests cannot be deleted.';
  end if;

  if new.id is distinct from old.id
     or new.calendar_link_id is distinct from old.calendar_link_id
     or new.experience_id is distinct from old.experience_id
     or new.operator_audit_event_id is distinct from old.operator_audit_event_id
     or new.action is distinct from old.action
     or new.request_key is distinct from old.request_key
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.conference_request_key is distinct from old.conference_request_key
     or new.expected_link_version is distinct from old.expected_link_version
     or new.desired_experience_version is distinct from old.desired_experience_version
     or new.desired_attendee_revision is distinct from old.desired_attendee_revision
     or new.attendee_set_sha256 is distinct from old.attendee_set_sha256
     or new.event_snapshot is distinct from old.event_snapshot
     or new.attendee_count is distinct from old.attendee_count
     or new.send_updates is distinct from old.send_updates
     or new.created_at is distinct from old.created_at then
    raise exception 'Experience calendar sync request intent is immutable.';
  end if;

  if new.version <> old.version + 1 then
    raise exception 'Experience calendar sync request version must increase by exactly one.';
  end if;

  if old.status in ('succeeded', 'failed', 'superseded') then
    raise exception 'A completed Experience calendar sync request is immutable.';
  end if;

  if old.status = 'queued' and new.status not in ('processing', 'superseded') then
    raise exception 'A queued calendar sync request may only start or be superseded.';
  end if;

  if old.status = 'processing'
     and new.status not in ('queued', 'succeeded', 'failed', 'superseded') then
    raise exception 'Invalid Experience calendar sync request transition.';
  end if;

  if old.status = 'queued'
     and new.status = 'processing'
     and new.attempt_count <> old.attempt_count + 1 then
    raise exception 'Starting a calendar sync attempt must increment its attempt count.';
  end if;

  if old.status = 'processing'
     and new.status = 'queued'
     and (new.next_attempt_at is null or new.last_error_code is null) then
    raise exception 'A retried calendar sync request needs retry timing and failure evidence.';
  end if;

  return new;
end;
$$;

drop trigger if exists experience_calendar_links_guard
  on public.experience_calendar_links;
create trigger experience_calendar_links_guard
before update or delete on public.experience_calendar_links
for each row execute function private.ruined_guard_experience_calendar_link_mutation();

drop trigger if exists experience_calendar_sync_requests_guard
  on public.experience_calendar_sync_requests;
create trigger experience_calendar_sync_requests_guard
before update or delete on public.experience_calendar_sync_requests
for each row execute function private.ruined_guard_experience_calendar_sync_request_mutation();

drop trigger if exists experience_calendar_sync_events_append_only
  on public.experience_calendar_sync_events;
create trigger experience_calendar_sync_events_append_only
before update or delete on public.experience_calendar_sync_events
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists experience_calendar_attendee_events_append_only
  on public.experience_calendar_attendee_events;
create trigger experience_calendar_attendee_events_append_only
before update or delete on public.experience_calendar_attendee_events
for each row execute function public.ruined_reject_append_only_mutation();

revoke all on function private.ruined_guard_experience_calendar_link_mutation()
  from public, anon, authenticated;
revoke all on function private.ruined_guard_experience_calendar_sync_request_mutation()
  from public, anon, authenticated;

alter table public.experience_calendar_links enable row level security;
alter table public.experience_calendar_sync_requests enable row level security;
alter table public.experience_calendar_sync_events enable row level security;
alter table public.experience_calendar_attendee_events enable row level security;

revoke all on table
  public.experience_calendar_links,
  public.experience_calendar_sync_requests,
  public.experience_calendar_sync_events,
  public.experience_calendar_attendee_events
from public, anon, authenticated;

revoke all on sequence
  public.experience_calendar_sync_events_id_seq,
  public.experience_calendar_attendee_events_id_seq
from public, anon, authenticated;

comment on table public.experience_calendar_links is
  'Private current projection linking one Ruined Experience to its Google Calendar event. Server-side operator code only.';
comment on table public.experience_calendar_sync_requests is
  'Retry-safe operator intent ledger for Google Calendar create, update, cancel, and attendee reconciliation requests. Every request references its operator audit event.';
comment on table public.experience_calendar_sync_events is
  'Append-only Google Calendar sync attempt and provider-result evidence.';
comment on table public.experience_calendar_attendee_events is
  'Append-only per-person attendee reconciliation evidence. Applied means Google accepted the event mutation; it is not an inbox delivery receipt.';

commit;
