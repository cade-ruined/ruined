begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- A Person is the durable identity above membership, authentication, events,
-- communications, and commerce. Existing member UUIDs become their Person UUID
-- so the backfill is deterministic and preserves every current relationship.
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active'
    check (status in ('active', 'merged', 'erased')),
  merged_into_person_id uuid
    references public.people(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (
    (status = 'merged' and merged_into_person_id is not null and merged_into_person_id <> id)
    or (status <> 'merged' and merged_into_person_id is null)
  )
);

create table if not exists public.person_email_addresses (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete restrict,
  email text not null,
  email_normalized text not null unique,
  verification_state text not null default 'unverified'
    check (verification_state in ('unverified', 'verified')),
  verified_at timestamptz,
  source text not null
    check (source in ('membership', 'platform_auth', 'member_onboarding', 'event', 'shopify', 'ops_import')),
  is_primary boolean not null default false,
  retired_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (
    email_normalized = lower(btrim(email_normalized))
    and char_length(email_normalized) between 3 and 254
    and email_normalized like '%_@_%._%'
  ),
  check (verification_state = 'unverified' or verified_at is not null),
  check (retired_at is null or retired_at >= created_at)
);

create unique index if not exists person_email_addresses_one_primary_idx
  on public.person_email_addresses(person_id)
  where is_primary and retired_at is null;
create index if not exists person_email_addresses_person_idx
  on public.person_email_addresses(person_id);

create table if not exists public.person_profiles (
  person_id uuid primary key references public.people(id) on delete restrict,
  display_name text,
  preferred_name text,
  avatar_storage_path text,
  timezone text,
  location_label text,
  bio text,
  building_now text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (display_name is null or char_length(btrim(display_name)) between 1 and 120),
  check (preferred_name is null or char_length(btrim(preferred_name)) between 1 and 120),
  check (location_label is null or char_length(btrim(location_label)) between 1 and 160),
  check (bio is null or char_length(bio) <= 1200),
  check (building_now is null or char_length(building_now) <= 500)
);

create table if not exists public.person_private_profiles (
  person_id uuid primary key references public.people(id) on delete restrict,
  legal_name text,
  mobile_e164 text,
  birth_date date,
  default_fulfillment_address jsonb,
  apparel_sizing jsonb,
  accessibility_notes text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (legal_name is null or char_length(btrim(legal_name)) between 1 and 180),
  check (mobile_e164 is null or mobile_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  check (birth_date is null or birth_date >= date '1900-01-01'),
  check (
    default_fulfillment_address is null
    or jsonb_typeof(default_fulfillment_address) = 'object'
  ),
  check (apparel_sizing is null or jsonb_typeof(apparel_sizing) = 'object'),
  check (accessibility_notes is null or char_length(accessibility_notes) <= 2000)
);

create table if not exists public.person_merge_events (
  id bigint generated always as identity primary key,
  source_person_id uuid not null references public.people(id) on delete restrict,
  target_person_id uuid not null references public.people(id) on delete restrict,
  actor_auth_user_id uuid not null
    references public.platform_users(auth_user_id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  dedupe_key text not null unique,
  occurred_at timestamptz not null default statement_timestamp(),
  check (source_person_id <> target_person_id)
);

create index if not exists people_merged_into_idx
  on public.people(merged_into_person_id);
create index if not exists person_merge_events_source_idx
  on public.person_merge_events(source_person_id, occurred_at desc);
create index if not exists person_merge_events_target_idx
  on public.person_merge_events(target_person_id, occurred_at desc);
create index if not exists person_merge_events_actor_idx
  on public.person_merge_events(actor_auth_user_id);

-- Expand existing records first. These bridges remain nullable through the
-- dual-write release so an older application process cannot be broken by the
-- schema deploy. A later contract migration may enforce NOT NULL after every
-- writer has been observed writing Person IDs.
alter table public.ruined_members add column if not exists person_id uuid;
alter table public.platform_users add column if not exists person_id uuid;
alter table public.communication_contacts add column if not exists person_id uuid;
alter table public.community_event_registrations add column if not exists person_id uuid;

create temporary table ruined_person_identity_seed (
  email_normalized text primary key,
  person_id uuid not null unique
) on commit drop;

insert into ruined_person_identity_seed (email_normalized, person_id)
select
  identity_record.email_normalized,
  coalesce(
    (
      select member.id
      from public.ruined_members member
      where member.email_normalized = identity_record.email_normalized
      limit 1
    ),
    (
      select platform_user.auth_user_id
      from public.platform_users platform_user
      where platform_user.email_normalized = identity_record.email_normalized
      order by platform_user.created_at, platform_user.auth_user_id
      limit 1
    )
  )
from (
  select member.email_normalized from public.ruined_members member
  union
  select platform_user.email_normalized from public.platform_users platform_user
) identity_record;

insert into public.people (id)
select seed.person_id
from ruined_person_identity_seed seed
on conflict (id) do nothing;

insert into public.person_email_addresses (
  person_id,
  email,
  email_normalized,
  verification_state,
  verified_at,
  source,
  is_primary
)
select
  seed.person_id,
  coalesce(member.email, platform_user.email_normalized, seed.email_normalized),
  seed.email_normalized,
  case
    when platform_user.activated_at is not null then 'verified'
    else 'unverified'
  end,
  platform_user.activated_at,
  case when member.id is not null then 'membership' else 'platform_auth' end,
  true
from ruined_person_identity_seed seed
left join public.ruined_members member
  on member.email_normalized = seed.email_normalized
left join public.platform_users platform_user
  on platform_user.email_normalized = seed.email_normalized
on conflict (email_normalized) do nothing;

update public.ruined_members member
set person_id = seed.person_id
from ruined_person_identity_seed seed
where seed.email_normalized = member.email_normalized
  and member.person_id is null;

update public.platform_users platform_user
set person_id = seed.person_id
from ruined_person_identity_seed seed
where seed.email_normalized = platform_user.email_normalized
  and platform_user.person_id is null;

-- Public signups and registrations are linked only to an email that the
-- platform has actually verified. Unverified submissions never merge people.
update public.communication_contacts contact
set person_id = email_address.person_id
from public.person_email_addresses email_address
where email_address.email_normalized = contact.email_normalized
  and email_address.verification_state = 'verified'
  and email_address.retired_at is null
  and contact.person_id is null;

update public.community_event_registrations registration
set person_id = email_address.person_id
from public.person_email_addresses email_address
where email_address.email_normalized = registration.email_normalized
  and email_address.verification_state = 'verified'
  and email_address.retired_at is null
  and registration.person_id is null;

insert into public.person_profiles (
  person_id,
  display_name,
  preferred_name,
  avatar_storage_path,
  timezone,
  created_at,
  updated_at
)
select
  platform_user.person_id,
  profile.display_name,
  coalesce(private_profile.preferred_name, profile.display_name),
  profile.avatar_storage_path,
  profile.timezone,
  least(profile.created_at, platform_user.created_at),
  greatest(profile.updated_at, platform_user.updated_at)
from public.platform_users platform_user
join public.user_profiles profile
  on profile.auth_user_id = platform_user.auth_user_id
left join public.ruined_members member
  on member.person_id = platform_user.person_id
left join public.member_private_profiles private_profile
  on private_profile.member_id = member.id
where platform_user.person_id is not null
on conflict (person_id) do nothing;

insert into public.person_profiles (person_id, preferred_name, display_name)
select
  member.person_id,
  private_profile.preferred_name,
  private_profile.preferred_name
from public.ruined_members member
join public.member_private_profiles private_profile
  on private_profile.member_id = member.id
where member.person_id is not null
on conflict (person_id) do update
set
  preferred_name = coalesce(public.person_profiles.preferred_name, excluded.preferred_name),
  display_name = coalesce(public.person_profiles.display_name, excluded.display_name),
  updated_at = statement_timestamp();

insert into public.person_private_profiles (
  person_id,
  legal_name,
  mobile_e164,
  default_fulfillment_address,
  accessibility_notes,
  created_at,
  updated_at
)
select
  member.person_id,
  private_profile.legal_name,
  private_profile.phone_e164,
  private_profile.default_fulfillment_address,
  private_profile.accessibility_notes,
  private_profile.created_at,
  private_profile.updated_at
from public.ruined_members member
join public.member_private_profiles private_profile
  on private_profile.member_id = member.id
where member.person_id is not null
on conflict (person_id) do nothing;

create unique index if not exists ruined_members_person_idx
  on public.ruined_members(person_id)
  where person_id is not null;
create unique index if not exists ruined_members_id_person_idx
  on public.ruined_members(id, person_id);
create unique index if not exists platform_users_person_idx
  on public.platform_users(person_id)
  where person_id is not null;
create index if not exists communication_contacts_person_idx
  on public.communication_contacts(person_id);
create index if not exists community_event_registrations_person_idx
  on public.community_event_registrations(person_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ruined_members'::regclass
      and conname = 'ruined_members_person_id_fkey'
  ) then
    alter table public.ruined_members
      add constraint ruined_members_person_id_fkey
      foreign key (person_id) references public.people(id)
      on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.platform_users'::regclass
      and conname = 'platform_users_person_id_fkey'
  ) then
    alter table public.platform_users
      add constraint platform_users_person_id_fkey
      foreign key (person_id) references public.people(id)
      on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.communication_contacts'::regclass
      and conname = 'communication_contacts_person_id_fkey'
  ) then
    alter table public.communication_contacts
      add constraint communication_contacts_person_id_fkey
      foreign key (person_id) references public.people(id)
      on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.community_event_registrations'::regclass
      and conname = 'community_event_registrations_person_id_fkey'
  ) then
    alter table public.community_event_registrations
      add constraint community_event_registrations_person_id_fkey
      foreign key (person_id) references public.people(id)
      on delete set null not valid;
  end if;
end;
$$;

alter table public.ruined_members validate constraint ruined_members_person_id_fkey;
alter table public.platform_users validate constraint platform_users_person_id_fkey;
alter table public.communication_contacts validate constraint communication_contacts_person_id_fkey;
alter table public.community_event_registrations
  validate constraint community_event_registrations_person_id_fkey;

-- Preserve compatibility during the expand/dual-write release. Older Stripe
-- and invitation code may still insert a member or platform user without first
-- creating a Person. These triggers resolve by normalized email and create the
-- bridge atomically. A conflicting email-to-Person pairing fails closed: only
-- an explicit, audited merge operation may join identities.
create or replace function private.ruined_link_member_person_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_person_id uuid;
  linked_email_retired_at timestamptz;
  canonical_person_id uuid;
begin
  new.email_normalized := lower(btrim(new.email_normalized));

  select email_address.person_id, email_address.retired_at
  into linked_person_id, linked_email_retired_at
  from public.person_email_addresses email_address
  where email_address.email_normalized = new.email_normalized;

  if linked_email_retired_at is not null then
    raise exception 'The normalized email is retired and requires operator review.';
  end if;

  if new.person_id is not null
     and linked_person_id is not null
     and new.person_id <> linked_person_id then
    raise exception 'The normalized email is already linked to another Person.';
  end if;

  new.person_id := coalesce(new.person_id, linked_person_id, new.id);

  insert into public.people (id)
  values (new.person_id)
  on conflict (id) do nothing;

  insert into public.person_email_addresses (
    person_id,
    email,
    email_normalized,
    verification_state,
    source,
    is_primary
  ) values (
    new.person_id,
    new.email,
    new.email_normalized,
    'unverified',
    'membership',
    not exists (
      select 1
      from public.person_email_addresses primary_email
      where primary_email.person_id = new.person_id
        and primary_email.is_primary
        and primary_email.retired_at is null
    )
  )
  on conflict (email_normalized) do update
  set updated_at = public.person_email_addresses.updated_at
  returning person_id into canonical_person_id;

  if canonical_person_id <> new.person_id then
    raise exception 'The normalized email was concurrently linked to another Person.';
  end if;

  return new;
end;
$$;

create or replace function private.ruined_link_platform_user_person_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_person_id uuid;
  linked_person_id uuid;
  linked_email_retired_at timestamptz;
  canonical_person_id uuid;
begin
  new.email_normalized := lower(btrim(new.email_normalized));

  if new.member_id is not null then
    select member.person_id
    into member_person_id
    from public.ruined_members member
    where member.id = new.member_id;
  end if;

  select email_address.person_id, email_address.retired_at
  into linked_person_id, linked_email_retired_at
  from public.person_email_addresses email_address
  where email_address.email_normalized = new.email_normalized;

  if linked_email_retired_at is not null then
    raise exception 'The normalized email is retired and requires operator review.';
  end if;

  if member_person_id is not null
     and linked_person_id is not null
     and member_person_id <> linked_person_id then
    raise exception 'The member and normalized email belong to different People.';
  end if;

  if new.person_id is not null
     and coalesce(member_person_id, linked_person_id) is not null
     and new.person_id <> coalesce(member_person_id, linked_person_id) then
    raise exception 'The platform user is linked to a conflicting Person.';
  end if;

  new.person_id := coalesce(
    new.person_id,
    member_person_id,
    linked_person_id,
    new.auth_user_id
  );

  insert into public.people (id)
  values (new.person_id)
  on conflict (id) do nothing;

  insert into public.person_email_addresses (
    person_id,
    email,
    email_normalized,
    verification_state,
    verified_at,
    source,
    is_primary
  ) values (
    new.person_id,
    new.email_normalized,
    new.email_normalized,
    case when new.activated_at is null then 'unverified' else 'verified' end,
    new.activated_at,
    'platform_auth',
    not exists (
      select 1
      from public.person_email_addresses primary_email
      where primary_email.person_id = new.person_id
        and primary_email.is_primary
        and primary_email.retired_at is null
    )
  )
  on conflict (email_normalized) do update
  set
    verification_state = case
      when excluded.verification_state = 'verified' then 'verified'
      else public.person_email_addresses.verification_state
    end,
    verified_at = coalesce(
      public.person_email_addresses.verified_at,
      excluded.verified_at
    ),
    updated_at = statement_timestamp()
  returning person_id into canonical_person_id;

  if canonical_person_id <> new.person_id then
    raise exception 'The normalized email was concurrently linked to another Person.';
  end if;

  return new;
end;
$$;

revoke all on function private.ruined_link_member_person_on_insert()
  from public, anon, authenticated;
revoke all on function private.ruined_link_platform_user_person_on_insert()
  from public, anon, authenticated;

drop trigger if exists ruined_members_00_link_person
  on public.ruined_members;
create trigger ruined_members_00_link_person
before insert on public.ruined_members
for each row execute function private.ruined_link_member_person_on_insert();

drop trigger if exists platform_users_00_link_person
  on public.platform_users;
create trigger platform_users_00_link_person
before insert on public.platform_users
for each row execute function private.ruined_link_platform_user_person_on_insert();

-- One authentication identity may carry member and operator role grants at the
-- same time. Membership state no longer disables the entire credential.
drop trigger if exists member_lifecycle_00_sync_revoked_platform_access
  on public.member_lifecycle;
alter table public.platform_users
  drop constraint if exists platform_users_staff_has_no_member_check;

create or replace function private.ruined_current_person_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select platform_user.person_id
  from public.platform_users platform_user
  where platform_user.auth_user_id = private.ruined_current_auth_user_id()
    and platform_user.status = 'active'
    and platform_user.person_id is not null
  limit 1
$$;

create or replace function private.ruined_has_active_role(requested_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_users platform_user
    join public.platform_role_grants role_grant
      on role_grant.auth_user_id = platform_user.auth_user_id
      and role_grant.role_slug = requested_role
      and role_grant.revoked_at is null
    where platform_user.auth_user_id = private.ruined_current_auth_user_id()
      and platform_user.status = 'active'
  )
$$;

create or replace function private.ruined_current_membership_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select member.id
  from public.platform_users platform_user
  join public.ruined_members member
    on member.person_id = platform_user.person_id
  join public.platform_role_grants role_grant
    on role_grant.auth_user_id = platform_user.auth_user_id
    and role_grant.role_slug = 'member'
    and role_grant.revoked_at is null
  where platform_user.auth_user_id = private.ruined_current_auth_user_id()
    and platform_user.status = 'active'
  limit 1
$$;

create or replace function private.ruined_current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select member.id
  from public.platform_users platform_user
  join public.ruined_members member
    on member.person_id = platform_user.person_id
  join public.member_lifecycle lifecycle
    on lifecycle.member_id = member.id
  join public.platform_role_grants role_grant
    on role_grant.auth_user_id = platform_user.auth_user_id
    and role_grant.role_slug = 'member'
    and role_grant.revoked_at is null
  where platform_user.auth_user_id = private.ruined_current_auth_user_id()
    and platform_user.status = 'active'
    and lifecycle.account_state = 'active'
  limit 1
$$;

create or replace function private.ruined_current_active_access_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select member.id
  from public.platform_users platform_user
  join public.ruined_members member
    on member.person_id = platform_user.person_id
  join public.member_lifecycle lifecycle
    on lifecycle.member_id = member.id
  join public.platform_role_grants role_grant
    on role_grant.auth_user_id = platform_user.auth_user_id
    and role_grant.role_slug = 'member'
    and role_grant.revoked_at is null
  where platform_user.auth_user_id = private.ruined_current_auth_user_id()
    and platform_user.status = 'active'
    and lifecycle.account_state = 'active'
    and lifecycle.billing_state = 'active'
    and lifecycle.program_state in ('onboarding', 'active')
  limit 1
$$;

revoke all on function private.ruined_current_person_id()
  from public, anon, authenticated;
revoke all on function private.ruined_has_active_role(text)
  from public, anon, authenticated;
revoke all on function private.ruined_current_membership_id()
  from public, anon, authenticated;
revoke all on function private.ruined_current_member_id()
  from public, anon, authenticated;
revoke all on function private.ruined_current_active_access_member_id()
  from public, anon, authenticated;
grant execute on function private.ruined_current_person_id() to authenticated;
grant execute on function private.ruined_has_active_role(text) to authenticated;
grant execute on function private.ruined_current_membership_id()
  to authenticated;
grant execute on function private.ruined_current_member_id() to authenticated;
grant execute on function private.ruined_current_active_access_member_id()
  to authenticated;

alter table public.people enable row level security;
alter table public.person_email_addresses enable row level security;
alter table public.person_profiles enable row level security;
alter table public.person_private_profiles enable row level security;
alter table public.person_merge_events enable row level security;

revoke all on table
  public.people,
  public.person_email_addresses,
  public.person_profiles,
  public.person_private_profiles,
  public.person_merge_events
from public, anon, authenticated;

grant select on table
  public.people,
  public.person_email_addresses,
  public.person_profiles,
  public.person_private_profiles
to authenticated;

drop policy if exists people_select_self on public.people;
create policy people_select_self
on public.people for select
to authenticated
using (id = private.ruined_current_person_id());

drop policy if exists person_email_addresses_select_self
  on public.person_email_addresses;
create policy person_email_addresses_select_self
on public.person_email_addresses for select
to authenticated
using (person_id = private.ruined_current_person_id());

drop policy if exists person_profiles_select_self on public.person_profiles;
create policy person_profiles_select_self
on public.person_profiles for select
to authenticated
using (person_id = private.ruined_current_person_id());

drop policy if exists person_private_profiles_select_self
  on public.person_private_profiles;
create policy person_private_profiles_select_self
on public.person_private_profiles for select
to authenticated
using (person_id = private.ruined_current_person_id());

drop trigger if exists person_merge_events_append_only
  on public.person_merge_events;
create trigger person_merge_events_append_only
before update or delete on public.person_merge_events
for each row execute function public.ruined_reject_append_only_mutation();

comment on table public.people is
  'Canonical identity above authentication, membership, events, communications, and commerce.';
comment on column public.platform_users.user_type is
  'Legacy compatibility only. Active platform_role_grants authorize member and operator surfaces.';
comment on column public.platform_users.member_id is
  'Legacy compatibility bridge. Membership resolves through platform_users.person_id and ruined_members.person_id.';

commit;
