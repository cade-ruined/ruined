begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

create table if not exists public.member_directory_preferences (
  member_id uuid primary key references public.ruined_members(id) on delete restrict,
  directory_status text not null default 'hidden'
    check (directory_status in ('hidden', 'circle_visible')),
  avatar_visible boolean not null default true,
  location_visible boolean not null default false,
  bio_visible boolean not null default false,
  building_visible boolean not null default false,
  email_scope text not null default 'none'
    check (email_scope in ('none', 'accountability_partner', 'circle')),
  phone_scope text not null default 'none'
    check (phone_scope in ('none', 'accountability_partner', 'circle')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

insert into public.member_directory_preferences (member_id)
select member.id
from public.ruined_members member
on conflict (member_id) do nothing;

create or replace function private.ruined_create_default_directory_preferences()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.member_directory_preferences (member_id)
  values (new.id)
  on conflict (member_id) do nothing;
  return new;
end;
$$;

drop trigger if exists ruined_members_90_default_directory_preferences
  on public.ruined_members;
create trigger ruined_members_90_default_directory_preferences
after insert on public.ruined_members
for each row execute function private.ruined_create_default_directory_preferences();

revoke all on function private.ruined_create_default_directory_preferences()
  from public, anon, authenticated;

create table if not exists public.member_directory_preference_events (
  id bigint generated always as identity primary key,
  member_id uuid not null
    references public.member_directory_preferences(member_id) on delete restrict,
  previous_preferences jsonb not null
    check (jsonb_typeof(previous_preferences) = 'object'),
  next_preferences jsonb not null
    check (jsonb_typeof(next_preferences) = 'object'),
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  source text not null check (source in ('member', 'ops', 'system')),
  dedupe_key text unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp()
);

create index if not exists member_directory_preference_events_member_idx
  on public.member_directory_preference_events(member_id, occurred_at desc);
create index if not exists member_directory_preference_events_actor_idx
  on public.member_directory_preference_events(actor_auth_user_id);

create table if not exists public.accountability_partner_assignments (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete restrict,
  member_one_id uuid not null references public.ruined_members(id) on delete restrict,
  member_two_id uuid not null references public.ruined_members(id) on delete restrict,
  assigned_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  assignment_reason text,
  assigned_at timestamptz not null default statement_timestamp(),
  ended_at timestamptz,
  ended_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  end_reason text,
  created_at timestamptz not null default statement_timestamp(),
  check (member_one_id < member_two_id),
  check (ended_at is null or ended_at >= assigned_at),
  check (assignment_reason is null or char_length(assignment_reason) <= 1000),
  check (end_reason is null or char_length(end_reason) <= 1000)
);

create unique index if not exists accountability_partner_assignments_active_pair_idx
  on public.accountability_partner_assignments(circle_id, member_one_id, member_two_id)
  where ended_at is null;
create index if not exists accountability_partner_assignments_circle_idx
  on public.accountability_partner_assignments(circle_id, ended_at, assigned_at desc);
create index if not exists accountability_partner_assignments_member_one_idx
  on public.accountability_partner_assignments(member_one_id, ended_at);
create index if not exists accountability_partner_assignments_member_two_idx
  on public.accountability_partner_assignments(member_two_id, ended_at);
create index if not exists accountability_partner_assignments_assigner_idx
  on public.accountability_partner_assignments(assigned_by_auth_user_id);
create index if not exists accountability_partner_assignments_ender_idx
  on public.accountability_partner_assignments(ended_by_auth_user_id);

create or replace function private.ruined_validate_accountability_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ended_at is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('ruined-accountability:' || new.member_one_id::text)
  );
  perform pg_advisory_xact_lock(
    hashtext('ruined-accountability:' || new.member_two_id::text)
  );

  if not exists (
    select 1 from public.circle_member_assignments assignment
    where assignment.circle_id = new.circle_id
      and assignment.member_id = new.member_one_id
      and assignment.ended_at is null
  ) or not exists (
    select 1 from public.circle_member_assignments assignment
    where assignment.circle_id = new.circle_id
      and assignment.member_id = new.member_two_id
      and assignment.ended_at is null
  ) then
    raise exception 'Both accountability partners must be active members of the Circle.';
  end if;

  if exists (
    select 1
    from public.accountability_partner_assignments assignment
    where assignment.ended_at is null
      and assignment.id is distinct from new.id
      and (
        new.member_one_id in (assignment.member_one_id, assignment.member_two_id)
        or new.member_two_id in (assignment.member_one_id, assignment.member_two_id)
      )
  ) then
    raise exception 'A member may have only one active accountability partner.';
  end if;

  return new;
end;
$$;

drop trigger if exists accountability_partner_assignments_validate
  on public.accountability_partner_assignments;
create trigger accountability_partner_assignments_validate
before insert or update of member_one_id, member_two_id, circle_id, ended_at
on public.accountability_partner_assignments
for each row execute function private.ruined_validate_accountability_assignment();

create or replace function private.ruined_guard_accountability_assignment_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Accountability assignment history cannot be deleted.';
  end if;
  if new.circle_id is distinct from old.circle_id
     or new.member_one_id is distinct from old.member_one_id
     or new.member_two_id is distinct from old.member_two_id
     or new.assigned_by_auth_user_id is distinct from old.assigned_by_auth_user_id
     or new.assignment_reason is distinct from old.assignment_reason
     or new.assigned_at is distinct from old.assigned_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Only accountability assignment closure fields may be updated.';
  end if;
  if old.ended_at is not null then
    raise exception 'A closed accountability assignment is immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists accountability_partner_assignments_guard
  on public.accountability_partner_assignments;
create trigger accountability_partner_assignments_guard
before update or delete on public.accountability_partner_assignments
for each row execute function private.ruined_guard_accountability_assignment_mutation();

create table if not exists public.experiences (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  kind text not null
    check (kind in ('public_event', 'member_event', 'weekly_call', 'circle_meeting', 'academy_session', 'challenge', 'retreat')),
  title text not null,
  summary text,
  details text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null default 'America/Denver',
  location_label text,
  visibility text not null default 'all_members'
    check (visibility in ('public', 'all_members', 'circle', 'block', 'progression', 'invite_only')),
  circle_id uuid references public.circles(id) on delete restrict,
  block_id uuid references public.membership_blocks(id) on delete restrict,
  progression_level_slug text
    references public.membership_progression_levels(slug) on delete restrict,
  registration_mode text not null default 'internal'
    check (registration_mode in ('none', 'internal', 'external')),
  external_registration_url text,
  capacity integer check (capacity is null or capacity > 0),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'cancelled', 'completed', 'archived')),
  published_at timestamptz,
  created_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  updated_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  check (char_length(btrim(title)) between 1 and 200),
  check (ends_at is null or ends_at >= starts_at),
  check (status = 'draft' or published_at is not null),
  check (
    (visibility = 'circle' and circle_id is not null and block_id is null and progression_level_slug is null)
    or (visibility = 'block' and circle_id is null and block_id is not null and progression_level_slug is null)
    or (visibility = 'progression' and circle_id is null and block_id is null and progression_level_slug is not null)
    or (visibility in ('public', 'all_members', 'invite_only') and circle_id is null and block_id is null and progression_level_slug is null)
  ),
  check (
    (registration_mode = 'external' and external_registration_url is not null)
    or registration_mode <> 'external'
  )
);

create index if not exists experiences_schedule_idx
  on public.experiences(status, starts_at);
create index if not exists experiences_kind_idx
  on public.experiences(kind, starts_at desc);
create index if not exists experiences_circle_idx
  on public.experiences(circle_id, starts_at desc);
create index if not exists experiences_block_idx
  on public.experiences(block_id, starts_at desc);
create index if not exists experiences_progression_idx
  on public.experiences(progression_level_slug, starts_at desc);
create index if not exists experiences_creator_idx
  on public.experiences(created_by_auth_user_id);
create index if not exists experiences_updater_idx
  on public.experiences(updated_by_auth_user_id);

create table if not exists public.experience_registrations (
  id uuid primary key default gen_random_uuid(),
  experience_id uuid not null references public.experiences(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  member_id uuid references public.ruined_members(id) on delete restrict,
  community_event_registration_id uuid
    references public.community_event_registrations(id) on delete set null,
  status text not null default 'registered'
    check (status in ('external_pending', 'registered', 'waitlisted', 'cancelled')),
  source text not null
    check (source in ('member', 'ops', 'public_site', 'external', 'import')),
  external_reference text,
  registered_at timestamptz not null default statement_timestamp(),
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (experience_id, person_id),
  unique (community_event_registration_id),
  foreign key (member_id, person_id)
    references public.ruined_members(id, person_id) on delete restrict,
  check (status = 'cancelled' or cancelled_at is null),
  check (status <> 'cancelled' or cancelled_at is not null)
);

create index if not exists experience_registrations_experience_idx
  on public.experience_registrations(experience_id, status, registered_at);
create index if not exists experience_registrations_person_idx
  on public.experience_registrations(person_id, registered_at desc);
create index if not exists experience_registrations_member_idx
  on public.experience_registrations(member_id, registered_at desc);
create index if not exists experience_registrations_external_idx
  on public.experience_registrations(external_reference)
  where external_reference is not null;

alter table public.community_event_registrations
  add column if not exists experience_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.community_event_registrations'::regclass
      and conname = 'community_event_registrations_experience_id_fkey'
  ) then
    alter table public.community_event_registrations
      add constraint community_event_registrations_experience_id_fkey
      foreign key (experience_id) references public.experiences(id)
      on delete set null not valid;
  end if;
end;
$$;

alter table public.community_event_registrations
  validate constraint community_event_registrations_experience_id_fkey;
create index if not exists community_event_registrations_experience_idx
  on public.community_event_registrations(experience_id, created_at desc);

create table if not exists public.experience_attendance_events (
  id bigint generated always as identity primary key,
  experience_id uuid not null references public.experiences(id) on delete restrict,
  registration_id uuid
    references public.experience_registrations(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  member_id uuid references public.ruined_members(id) on delete restrict,
  event_type text not null
    check (event_type in ('checked_in', 'attended', 'no_show', 'credited', 'revoked')),
  source text not null
    check (source in ('member', 'ops', 'system', 'import', 'external')),
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  occurred_at timestamptz not null default statement_timestamp(),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  dedupe_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (member_id, person_id)
    references public.ruined_members(id, person_id) on delete restrict
);

create index if not exists experience_attendance_events_experience_idx
  on public.experience_attendance_events(experience_id, occurred_at desc);
create index if not exists experience_attendance_events_registration_idx
  on public.experience_attendance_events(registration_id, occurred_at desc);
create index if not exists experience_attendance_events_person_idx
  on public.experience_attendance_events(person_id, occurred_at desc);
create index if not exists experience_attendance_events_member_idx
  on public.experience_attendance_events(member_id, occurred_at desc);
create index if not exists experience_attendance_events_actor_idx
  on public.experience_attendance_events(actor_auth_user_id);

create table if not exists public.learning_collections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  summary text,
  position integer not null default 1 check (position > 0),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  check (char_length(btrim(name)) between 1 and 160),
  check (status = 'draft' or published_at is not null)
);

create table if not exists public.learning_resources (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid references public.learning_collections(id) on delete set null,
  slug text not null unique,
  title text not null,
  summary text,
  content_type text not null
    check (content_type in ('article', 'video', 'audio', 'pdf', 'link', 'download')),
  position integer not null default 1 check (position > 0),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  current_version_id uuid,
  published_at timestamptz,
  created_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  check (char_length(btrim(title)) between 1 and 200),
  check (status = 'draft' or (published_at is not null and current_version_id is not null))
);

create table if not exists public.learning_resource_versions (
  id uuid primary key default gen_random_uuid(),
  learning_resource_id uuid not null
    references public.learning_resources(id) on delete restrict,
  version integer not null check (version > 0),
  body_text text,
  external_url text,
  storage_bucket text,
  storage_path text,
  content_sha256 text
    check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (learning_resource_id, version),
  unique (id, learning_resource_id),
  check (
    body_text is not null
    or external_url is not null
    or (storage_bucket is not null and storage_path is not null)
  ),
  check ((storage_bucket is null) = (storage_path is null))
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_resources'::regclass
      and conname = 'learning_resources_current_version_fkey'
  ) then
    alter table public.learning_resources
      add constraint learning_resources_current_version_fkey
      foreign key (current_version_id, id)
      references public.learning_resource_versions(id, learning_resource_id)
      on delete restrict not valid;
  end if;
end;
$$;

alter table public.learning_resources
  validate constraint learning_resources_current_version_fkey;

create index if not exists learning_collections_status_idx
  on public.learning_collections(status, position);
create index if not exists learning_collections_creator_idx
  on public.learning_collections(created_by_auth_user_id);
create index if not exists learning_resources_collection_idx
  on public.learning_resources(collection_id, status, position);
create index if not exists learning_resources_current_version_idx
  on public.learning_resources(current_version_id);
create index if not exists learning_resources_creator_idx
  on public.learning_resources(created_by_auth_user_id);
create index if not exists learning_resource_versions_resource_idx
  on public.learning_resource_versions(learning_resource_id, version desc);
create index if not exists learning_resource_versions_creator_idx
  on public.learning_resource_versions(created_by_auth_user_id);

create table if not exists public.learning_resource_targets (
  id uuid primary key default gen_random_uuid(),
  learning_resource_id uuid not null
    references public.learning_resources(id) on delete restrict,
  audience_type text not null
    check (audience_type in ('all_members', 'circle', 'block', 'progression')),
  circle_id uuid references public.circles(id) on delete restrict,
  block_id uuid references public.membership_blocks(id) on delete restrict,
  progression_level_slug text
    references public.membership_progression_levels(slug) on delete restrict,
  created_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  check (
    (audience_type = 'all_members' and circle_id is null and block_id is null and progression_level_slug is null)
    or (audience_type = 'circle' and circle_id is not null and block_id is null and progression_level_slug is null)
    or (audience_type = 'block' and circle_id is null and block_id is not null and progression_level_slug is null)
    or (audience_type = 'progression' and circle_id is null and block_id is null and progression_level_slug is not null)
  )
);

create unique index if not exists learning_resource_targets_scope_idx
  on public.learning_resource_targets(
    learning_resource_id,
    audience_type,
    coalesce(circle_id::text, block_id::text, progression_level_slug, '*')
  );
create index if not exists learning_resource_targets_circle_idx
  on public.learning_resource_targets(circle_id, learning_resource_id);
create index if not exists learning_resource_targets_block_idx
  on public.learning_resource_targets(block_id, learning_resource_id);
create index if not exists learning_resource_targets_progression_idx
  on public.learning_resource_targets(progression_level_slug, learning_resource_id);
create index if not exists learning_resource_targets_creator_idx
  on public.learning_resource_targets(created_by_auth_user_id);

create table if not exists public.circle_resources (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete restrict,
  learning_resource_version_id uuid not null
    references public.learning_resource_versions(id) on delete restrict,
  position integer not null default 1 check (position > 0),
  is_pinned boolean not null default false,
  shared_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  unique (circle_id, learning_resource_version_id)
);

create index if not exists circle_resources_circle_idx
  on public.circle_resources(circle_id, is_pinned desc, position);
create index if not exists circle_resources_version_idx
  on public.circle_resources(learning_resource_version_id);
create index if not exists circle_resources_sharer_idx
  on public.circle_resources(shared_by_auth_user_id);

create table if not exists public.member_saved_learning_resources (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  learning_resource_id uuid not null
    references public.learning_resources(id) on delete restrict,
  saved_at timestamptz not null default statement_timestamp(),
  removed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  check (removed_at is null or removed_at >= saved_at)
);

create unique index if not exists member_saved_learning_resources_active_idx
  on public.member_saved_learning_resources(member_id, learning_resource_id)
  where removed_at is null;
create index if not exists member_saved_learning_resources_member_idx
  on public.member_saved_learning_resources(member_id, saved_at desc);
create index if not exists member_saved_learning_resources_resource_idx
  on public.member_saved_learning_resources(learning_resource_id, saved_at desc);

drop trigger if exists member_directory_preference_events_append_only
  on public.member_directory_preference_events;
create trigger member_directory_preference_events_append_only
before update or delete on public.member_directory_preference_events
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists experience_attendance_events_append_only
  on public.experience_attendance_events;
create trigger experience_attendance_events_append_only
before update or delete on public.experience_attendance_events
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists learning_resource_versions_append_only
  on public.learning_resource_versions;
create trigger learning_resource_versions_append_only
before update or delete on public.learning_resource_versions
for each row execute function public.ruined_reject_append_only_mutation();

revoke all on function private.ruined_validate_accountability_assignment()
  from public, anon, authenticated;
revoke all on function private.ruined_guard_accountability_assignment_mutation()
  from public, anon, authenticated;

create or replace function private.ruined_can_access_learning_resource(
  requested_learning_resource_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.learning_resources resource
    where resource.id = requested_learning_resource_id
      and resource.status = 'published'
      and (
        exists (
          select 1
          from public.learning_resource_targets target
          where target.learning_resource_id = resource.id
            and (
              (target.audience_type = 'all_members'
                and private.ruined_current_active_access_member_id() is not null)
              or (target.audience_type = 'circle' and exists (
                select 1 from public.circle_member_assignments assignment
                where assignment.circle_id = target.circle_id
                  and assignment.member_id = private.ruined_current_active_access_member_id()
                  and assignment.ended_at is null
              ))
              or (target.audience_type = 'block' and exists (
                select 1 from public.circle_member_assignments circle_assignment
                join public.block_circle_assignments block_assignment
                  on block_assignment.circle_id = circle_assignment.circle_id
                  and block_assignment.ended_at is null
                where block_assignment.block_id = target.block_id
                  and circle_assignment.member_id = private.ruined_current_active_access_member_id()
                  and circle_assignment.ended_at is null
              ))
              or (target.audience_type = 'progression' and exists (
                select 1 from public.member_lifecycle lifecycle
                where lifecycle.member_id = private.ruined_current_active_access_member_id()
                  and lifecycle.current_progression_level_slug = target.progression_level_slug
              ))
            )
        )
        or exists (
          select 1
          from public.circle_resources circle_resource
          join public.learning_resource_versions version_record
            on version_record.id = circle_resource.learning_resource_version_id
          join public.circle_member_assignments assignment
            on assignment.circle_id = circle_resource.circle_id
            and assignment.ended_at is null
          where version_record.learning_resource_id = resource.id
            and assignment.member_id = private.ruined_current_active_access_member_id()
        )
      )
  )
$$;

revoke all on function private.ruined_can_access_learning_resource(uuid)
  from public, anon, authenticated;
grant execute on function private.ruined_can_access_learning_resource(uuid)
  to authenticated;

alter table public.member_directory_preferences enable row level security;
alter table public.member_directory_preference_events enable row level security;
alter table public.accountability_partner_assignments enable row level security;
alter table public.experiences enable row level security;
alter table public.experience_registrations enable row level security;
alter table public.experience_attendance_events enable row level security;
alter table public.learning_collections enable row level security;
alter table public.learning_resources enable row level security;
alter table public.learning_resource_versions enable row level security;
alter table public.learning_resource_targets enable row level security;
alter table public.circle_resources enable row level security;
alter table public.member_saved_learning_resources enable row level security;

revoke all on table
  public.member_directory_preferences,
  public.member_directory_preference_events,
  public.accountability_partner_assignments,
  public.experiences,
  public.experience_registrations,
  public.experience_attendance_events,
  public.learning_collections,
  public.learning_resources,
  public.learning_resource_versions,
  public.learning_resource_targets,
  public.circle_resources,
  public.member_saved_learning_resources
from public, anon, authenticated;

grant select on table
  public.member_directory_preferences,
  public.accountability_partner_assignments,
  public.experiences,
  public.experience_registrations,
  public.experience_attendance_events,
  public.learning_collections,
  public.learning_resources,
  public.learning_resource_versions,
  public.learning_resource_targets,
  public.circle_resources,
  public.member_saved_learning_resources
to authenticated;

create policy member_directory_preferences_select_self
on public.member_directory_preferences for select
to authenticated
using (member_id = private.ruined_current_membership_id());

create policy accountability_partner_assignments_select_self
on public.accountability_partner_assignments for select
to authenticated
using (
  private.ruined_current_active_access_member_id()
    in (member_one_id, member_two_id)
);

create policy experiences_select_entitled
on public.experiences for select
to authenticated
using (
  status in ('published', 'completed')
  and (
    visibility = 'public'
    or (
      private.ruined_current_active_access_member_id() is not null
      and visibility = 'all_members'
    )
    or (
      visibility = 'invite_only'
      and exists (
        select 1
        from public.experience_registrations registration
        where registration.experience_id = experiences.id
          and registration.person_id = private.ruined_current_person_id()
          and registration.status in ('external_pending', 'registered', 'waitlisted')
      )
    )
    or (
      visibility = 'circle'
      and exists (
        select 1 from public.circle_member_assignments assignment
        where assignment.circle_id = experiences.circle_id
          and assignment.member_id = private.ruined_current_active_access_member_id()
          and assignment.ended_at is null
      )
    )
    or (
      visibility = 'block'
      and exists (
        select 1 from public.circle_member_assignments circle_assignment
        join public.block_circle_assignments block_assignment
          on block_assignment.circle_id = circle_assignment.circle_id
          and block_assignment.ended_at is null
        where block_assignment.block_id = experiences.block_id
          and circle_assignment.member_id = private.ruined_current_active_access_member_id()
          and circle_assignment.ended_at is null
      )
    )
    or (
      visibility = 'progression'
      and exists (
        select 1 from public.member_lifecycle lifecycle
        where lifecycle.member_id = private.ruined_current_active_access_member_id()
          and lifecycle.current_progression_level_slug = experiences.progression_level_slug
      )
    )
  )
);

create policy experience_registrations_select_self
on public.experience_registrations for select
to authenticated
using (person_id = private.ruined_current_person_id());

create policy experience_attendance_events_select_self
on public.experience_attendance_events for select
to authenticated
using (person_id = private.ruined_current_person_id());

create policy learning_collections_select_published
on public.learning_collections for select
to authenticated
using (
  status = 'published'
  and private.ruined_current_active_access_member_id() is not null
);

create policy learning_resources_select_entitled
on public.learning_resources for select
to authenticated
using (private.ruined_can_access_learning_resource(id));

create policy learning_resource_versions_select_entitled
on public.learning_resource_versions for select
to authenticated
using (
  private.ruined_can_access_learning_resource(learning_resource_id)
);

create policy learning_resource_targets_select_entitled
on public.learning_resource_targets for select
to authenticated
using (
  private.ruined_can_access_learning_resource(learning_resource_id)
);

create policy circle_resources_select_assigned
on public.circle_resources for select
to authenticated
using (
  exists (
    select 1 from public.circle_member_assignments assignment
    where assignment.circle_id = circle_resources.circle_id
      and assignment.member_id = private.ruined_current_active_access_member_id()
      and assignment.ended_at is null
  )
);

create policy member_saved_learning_resources_select_self
on public.member_saved_learning_resources for select
to authenticated
using (member_id = private.ruined_current_membership_id());

comment on table public.member_directory_preferences is
  'Contact sharing defaults closed. Server directory queries must mask every field according to its explicit scope.';
comment on table public.learning_resource_versions is
  'Append-only content versions; learning_resources.current_version_id is the published projection.';

commit;
