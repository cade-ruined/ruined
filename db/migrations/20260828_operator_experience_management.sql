begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

alter table public.experiences
  add column if not exists registration_opens_at timestamptz,
  add column if not exists registration_closes_at timestamptz,
  add column if not exists waitlist_enabled boolean not null default true,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists completed_at timestamptz,
  add column if not exists archived_at timestamptz;

update public.experiences
set
  cancelled_at = coalesce(cancelled_at, updated_at, statement_timestamp()),
  cancellation_reason = coalesce(
    nullif(btrim(cancellation_reason), ''),
    'Imported cancellation.'
  )
where status = 'cancelled'
  and (cancelled_at is null or cancellation_reason is null or btrim(cancellation_reason) = '');

update public.experiences
set completed_at = coalesce(completed_at, ends_at, updated_at, statement_timestamp())
where status = 'completed' and completed_at is null;

update public.experiences
set archived_at = coalesce(archived_at, updated_at, statement_timestamp())
where status = 'archived' and archived_at is null;

do $$
declare
  legacy_constraint record;
begin
  for legacy_constraint in
    select constraint_record.conname
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.experiences'::regclass
      and constraint_record.contype = 'c'
      and position('status' in pg_get_constraintdef(constraint_record.oid)) > 0
      and position('draft' in pg_get_constraintdef(constraint_record.oid)) > 0
      and position('published_at' in pg_get_constraintdef(constraint_record.oid)) > 0
  loop
    execute format(
      'alter table public.experiences drop constraint %I',
      legacy_constraint.conname
    );
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.experiences'::regclass
      and conname = 'experiences_published_evidence_check'
  ) then
    alter table public.experiences
      add constraint experiences_published_evidence_check
      check (status <> 'published' or published_at is not null);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.experiences'::regclass
      and conname = 'experiences_registration_window_check'
  ) then
    alter table public.experiences
      add constraint experiences_registration_window_check
      check (
        registration_opens_at is null
        or registration_closes_at is null
        or registration_closes_at >= registration_opens_at
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.experiences'::regclass
      and conname = 'experiences_lifecycle_evidence_check'
  ) then
    alter table public.experiences
      add constraint experiences_lifecycle_evidence_check
      check (
        (status = 'cancelled' and cancelled_at is not null and cancellation_reason is not null)
        or (status = 'completed' and completed_at is not null)
        or (status = 'archived' and archived_at is not null)
        or status in ('draft', 'published')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.experiences'::regclass
      and conname = 'experiences_cancellation_reason_check'
  ) then
    alter table public.experiences
      add constraint experiences_cancellation_reason_check
      check (
        cancellation_reason is null
        or char_length(btrim(cancellation_reason)) between 3 and 1000
      );
  end if;
end;
$$;

alter table public.experience_registrations
  add column if not exists waitlisted_at timestamptz,
  add column if not exists promoted_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists version bigint not null default 1;

update public.experience_registrations
set waitlisted_at = coalesce(waitlisted_at, registered_at)
where status = 'waitlisted' and waitlisted_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.experience_registrations'::regclass
      and conname = 'experience_registrations_version_check'
  ) then
    alter table public.experience_registrations
      add constraint experience_registrations_version_check
      check (version > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.experience_registrations'::regclass
      and conname = 'experience_registrations_waitlist_evidence_check'
  ) then
    alter table public.experience_registrations
      add constraint experience_registrations_waitlist_evidence_check
      check (status <> 'waitlisted' or waitlisted_at is not null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.experience_registrations'::regclass
      and conname = 'experience_registrations_cancellation_reason_check'
  ) then
    alter table public.experience_registrations
      add constraint experience_registrations_cancellation_reason_check
      check (
        cancellation_reason is null
        or char_length(btrim(cancellation_reason)) between 3 and 1000
      );
  end if;
end;
$$;

create table if not exists public.experience_events (
  id bigint generated always as identity primary key,
  experience_id uuid not null references public.experiences(id) on delete restrict,
  event_type text not null
    check (event_type in (
      'created', 'updated', 'published', 'cancelled', 'completed', 'archived',
      'capacity_changed'
    )),
  source text not null check (source in ('ops', 'system', 'import')),
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  reason text,
  previous_state jsonb,
  next_state jsonb,
  dedupe_key text not null unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  check (reason is null or char_length(btrim(reason)) between 3 and 2000),
  check (previous_state is null or jsonb_typeof(previous_state) = 'object'),
  check (next_state is null or jsonb_typeof(next_state) = 'object')
);

create table if not exists public.experience_registration_events (
  id bigint generated always as identity primary key,
  registration_id uuid not null
    references public.experience_registrations(id) on delete restrict,
  experience_id uuid not null references public.experiences(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  previous_status text,
  next_status text not null
    check (next_status in ('external_pending', 'registered', 'waitlisted', 'cancelled')),
  source text not null check (source in ('member', 'ops', 'system', 'import', 'public_site', 'external')),
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  reason text,
  dedupe_key text not null unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  check (
    previous_status is null
    or previous_status in ('external_pending', 'registered', 'waitlisted', 'cancelled')
  ),
  check (reason is null or char_length(btrim(reason)) between 3 and 2000)
);

create index if not exists experience_events_experience_idx
  on public.experience_events(experience_id, occurred_at desc, id desc);
create index if not exists experience_events_actor_idx
  on public.experience_events(actor_auth_user_id, occurred_at desc);
create index if not exists experience_registration_events_registration_idx
  on public.experience_registration_events(registration_id, occurred_at desc, id desc);
create index if not exists experience_registration_events_experience_idx
  on public.experience_registration_events(experience_id, occurred_at desc, id desc);
create index if not exists experience_registration_events_person_idx
  on public.experience_registration_events(person_id, occurred_at desc, id desc);
create index if not exists experience_registration_events_actor_idx
  on public.experience_registration_events(actor_auth_user_id, occurred_at desc);
create index if not exists experience_registrations_registered_queue_idx
  on public.experience_registrations(experience_id, registered_at, id)
  where status = 'registered';
create index if not exists experience_registrations_waitlist_queue_idx
  on public.experience_registrations(experience_id, waitlisted_at, registered_at, id)
  where status = 'waitlisted';
create index if not exists experience_attendance_events_latest_idx
  on public.experience_attendance_events(experience_id, person_id, occurred_at desc, id desc);

insert into public.experience_events (
  experience_id,
  event_type,
  source,
  next_state,
  dedupe_key,
  occurred_at
)
select
  experience.id,
  case experience.status
    when 'published' then 'published'
    when 'cancelled' then 'cancelled'
    when 'completed' then 'completed'
    when 'archived' then 'archived'
    else 'created'
  end,
  'import',
  jsonb_build_object(
    'status', experience.status,
    'capacity', experience.capacity,
    'version', experience.version
  ),
  'experience-import:' || experience.id::text || ':v1',
  experience.created_at
from public.experiences experience
on conflict (dedupe_key) do nothing;

insert into public.experience_registration_events (
  registration_id,
  experience_id,
  person_id,
  previous_status,
  next_status,
  source,
  dedupe_key,
  occurred_at
)
select
  registration.id,
  registration.experience_id,
  registration.person_id,
  null,
  registration.status,
  'import',
  'experience-registration-import:' || registration.id::text || ':v1',
  registration.registered_at
from public.experience_registrations registration
on conflict (dedupe_key) do nothing;

drop trigger if exists experience_events_append_only on public.experience_events;
create trigger experience_events_append_only
before update or delete on public.experience_events
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists experience_registration_events_append_only
  on public.experience_registration_events;
create trigger experience_registration_events_append_only
before update or delete on public.experience_registration_events
for each row execute function public.ruined_reject_append_only_mutation();

alter table public.experience_events enable row level security;
alter table public.experience_registration_events enable row level security;

revoke all on table
  public.experience_events,
  public.experience_registration_events
from public, anon, authenticated;

comment on table public.experience_events is
  'Append-only Experience lifecycle and configuration history. Experiences are archived instead of deleted.';
comment on table public.experience_registration_events is
  'Append-only registration, waitlist, promotion, and cancellation history.';

commit;
