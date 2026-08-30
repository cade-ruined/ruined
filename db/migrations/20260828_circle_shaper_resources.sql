begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Keep the stable role slug for authorization compatibility while presenting
-- the Circle role in the language members and operators actually use.
update public.platform_roles
set display_name = 'Shaper'
where role_slug = 'circle_leader'
  and display_name is distinct from 'Shaper';

-- Accountability pairing is retired. Preserve every assignment as history,
-- close any active records, and fail closed for contact sharing that depended
-- on the retired relationship.
update public.accountability_partner_assignments
set
  ended_at = statement_timestamp(),
  end_reason = 'Accountability pairing retired'
where ended_at is null;

insert into public.member_directory_preference_events (
  member_id,
  previous_preferences,
  next_preferences,
  source,
  dedupe_key
)
select
  preference.member_id,
  jsonb_build_object(
    'directoryStatus', preference.directory_status,
    'avatarVisible', preference.avatar_visible,
    'locationVisible', preference.location_visible,
    'bioVisible', preference.bio_visible,
    'buildingVisible', preference.building_visible,
    'emailScope', preference.email_scope,
    'phoneScope', preference.phone_scope,
    'version', preference.version
  ),
  jsonb_build_object(
    'directoryStatus', preference.directory_status,
    'avatarVisible', preference.avatar_visible,
    'locationVisible', preference.location_visible,
    'bioVisible', preference.bio_visible,
    'buildingVisible', preference.building_visible,
    'emailScope', case when preference.email_scope = 'accountability_partner' then 'none' else preference.email_scope end,
    'phoneScope', case when preference.phone_scope = 'accountability_partner' then 'none' else preference.phone_scope end,
    'version', preference.version + 1
  ),
  'system',
  'retire-accountability-contact-scope:' || preference.member_id::text
from public.member_directory_preferences preference
where preference.email_scope = 'accountability_partner'
   or preference.phone_scope = 'accountability_partner'
on conflict (dedupe_key) do nothing;

update public.member_directory_preferences
set
  email_scope = case when email_scope = 'accountability_partner' then 'none' else email_scope end,
  phone_scope = case when phone_scope = 'accountability_partner' then 'none' else phone_scope end,
  version = version + 1,
  updated_at = statement_timestamp()
where email_scope = 'accountability_partner'
   or phone_scope = 'accountability_partner';

alter table public.member_directory_preferences
  drop constraint if exists member_directory_preferences_email_scope_check;
alter table public.member_directory_preferences
  add constraint member_directory_preferences_email_scope_check
  check (email_scope in ('none', 'circle'));

alter table public.member_directory_preferences
  drop constraint if exists member_directory_preferences_phone_scope_check;
alter table public.member_directory_preferences
  add constraint member_directory_preferences_phone_scope_check
  check (phone_scope in ('none', 'circle'));

create or replace function private.ruined_reject_retired_accountability_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Accountability partner assignments are retired.';
end;
$$;

drop trigger if exists accountability_partner_assignments_retired
  on public.accountability_partner_assignments;
create trigger accountability_partner_assignments_retired
before insert on public.accountability_partner_assignments
for each row execute function private.ruined_reject_retired_accountability_assignment();

revoke all on function private.ruined_reject_retired_accountability_assignment()
  from public, anon, authenticated;
revoke select on public.accountability_partner_assignments from authenticated;
drop policy if exists accountability_partner_assignments_select_self
  on public.accountability_partner_assignments;

-- Shaper assignments use the existing append-preserving Circle staff ledger.
-- Only closure metadata may change after assignment.
alter table public.circle_staff_assignments
  add column if not exists ended_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null;

create index if not exists circle_staff_assignments_ended_by_idx
  on public.circle_staff_assignments(ended_by_auth_user_id)
  where ended_by_auth_user_id is not null;

create or replace function private.ruined_validate_circle_staff_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ended_at is not null then
    return new;
  end if;

  if not exists (
    select 1
    from public.platform_users platform_user
    join public.platform_role_grants role_grant
      on role_grant.auth_user_id = platform_user.auth_user_id
     and role_grant.role_slug = new.role_slug
     and role_grant.revoked_at is null
    where platform_user.auth_user_id = new.auth_user_id
      and platform_user.status = 'active'
      and new.role_slug in ('guide', 'circle_leader')
  ) then
    raise exception 'Circle staff must have an active matching platform role.';
  end if;

  return new;
end;
$$;

create or replace function private.ruined_guard_circle_staff_assignment_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Circle staff assignment history cannot be deleted.';
  end if;
  if new.circle_id is distinct from old.circle_id
     or new.auth_user_id is distinct from old.auth_user_id
     or new.role_slug is distinct from old.role_slug
     or new.assigned_by_auth_user_id is distinct from old.assigned_by_auth_user_id
     or new.assigned_at is distinct from old.assigned_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Only Circle staff assignment closure fields may be updated.';
  end if;
  if old.ended_at is not null then
    raise exception 'A closed Circle staff assignment is immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists circle_staff_assignments_validate
  on public.circle_staff_assignments;
create trigger circle_staff_assignments_validate
before insert or update of circle_id, auth_user_id, role_slug, ended_at
on public.circle_staff_assignments
for each row execute function private.ruined_validate_circle_staff_assignment();

drop trigger if exists circle_staff_assignments_guard
  on public.circle_staff_assignments;
create trigger circle_staff_assignments_guard
before update or delete on public.circle_staff_assignments
for each row execute function private.ruined_guard_circle_staff_assignment_mutation();

revoke all on function private.ruined_validate_circle_staff_assignment()
  from public, anon, authenticated;
revoke all on function private.ruined_guard_circle_staff_assignment_mutation()
  from public, anon, authenticated;

-- A Circle resource is an exact, immutable content version. Adding the parent
-- resource id prevents two active versions of one resource being assigned at
-- the same time, while closure preserves what the Circle previously received.
alter table public.circle_resources
  add column if not exists learning_resource_id uuid;
alter table public.circle_resources
  add column if not exists ended_at timestamptz;
alter table public.circle_resources
  add column if not exists ended_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null;
alter table public.circle_resources
  add column if not exists end_reason text;

update public.circle_resources circle_resource
set learning_resource_id = version_record.learning_resource_id
from public.learning_resource_versions version_record
where version_record.id = circle_resource.learning_resource_version_id
  and circle_resource.learning_resource_id is null;

alter table public.circle_resources
  alter column learning_resource_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.circle_resources'::regclass
      and conname = 'circle_resources_version_resource_fkey'
  ) then
    alter table public.circle_resources
      add constraint circle_resources_version_resource_fkey
      foreign key (learning_resource_version_id, learning_resource_id)
      references public.learning_resource_versions(id, learning_resource_id)
      on delete restrict not valid;
  end if;
end;
$$;

alter table public.circle_resources
  validate constraint circle_resources_version_resource_fkey;

alter table public.circle_resources
  drop constraint if exists circle_resources_circle_id_learning_resource_version_id_key;

with ranked_resources as (
  select
    circle_resource.id,
    row_number() over (
      partition by circle_resource.circle_id, circle_resource.learning_resource_id
      order by
        circle_resource.is_pinned desc,
        circle_resource.created_at desc,
        circle_resource.id desc
    ) as resource_rank
  from public.circle_resources circle_resource
  where circle_resource.ended_at is null
)
update public.circle_resources circle_resource
set
  ended_at = statement_timestamp(),
  end_reason = 'Superseded while versioned Circle resources were activated'
from ranked_resources ranked
where ranked.id = circle_resource.id
  and ranked.resource_rank > 1;

create unique index if not exists circle_resources_one_active_resource_idx
  on public.circle_resources(circle_id, learning_resource_id)
  where ended_at is null;
create unique index if not exists circle_resources_one_active_version_idx
  on public.circle_resources(circle_id, learning_resource_version_id)
  where ended_at is null;
create index if not exists circle_resources_active_circle_idx
  on public.circle_resources(circle_id, is_pinned desc, position, created_at)
  where ended_at is null;
create index if not exists circle_resources_resource_idx
  on public.circle_resources(learning_resource_id, ended_at);
create index if not exists circle_resources_ended_by_idx
  on public.circle_resources(ended_by_auth_user_id)
  where ended_by_auth_user_id is not null;

create or replace function private.ruined_guard_circle_resource_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Circle resource history cannot be deleted.';
  end if;
  if new.circle_id is distinct from old.circle_id
     or new.learning_resource_id is distinct from old.learning_resource_id
     or new.learning_resource_version_id is distinct from old.learning_resource_version_id
     or new.shared_by_auth_user_id is distinct from old.shared_by_auth_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Circle resource identity cannot be changed; end and reassign it.';
  end if;
  if old.ended_at is not null then
    raise exception 'A closed Circle resource assignment is immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists circle_resources_guard
  on public.circle_resources;
create trigger circle_resources_guard
before update or delete on public.circle_resources
for each row execute function private.ruined_guard_circle_resource_mutation();

revoke all on function private.ruined_guard_circle_resource_mutation()
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
          join public.circle_member_assignments assignment
            on assignment.circle_id = circle_resource.circle_id
            and assignment.ended_at is null
          where circle_resource.learning_resource_id = resource.id
            and circle_resource.ended_at is null
            and assignment.member_id = private.ruined_current_active_access_member_id()
        )
      )
  )
$$;

revoke all on function private.ruined_can_access_learning_resource(uuid)
  from public, anon, authenticated;
grant execute on function private.ruined_can_access_learning_resource(uuid)
  to authenticated;

drop policy if exists circle_resources_select_assigned
  on public.circle_resources;
create policy circle_resources_select_assigned
on public.circle_resources for select
to authenticated
using (
  ended_at is null
  and exists (
    select 1 from public.circle_member_assignments assignment
    where assignment.circle_id = circle_resources.circle_id
      and assignment.member_id = private.ruined_current_active_access_member_id()
      and assignment.ended_at is null
  )
);

comment on table public.accountability_partner_assignments is
  'Retired relationship history. Active inserts are rejected; records are retained for audit only.';
comment on table public.circle_staff_assignments is
  'Append-preserving Circle staff ledger. The stable circle_leader role slug is presented as Shaper.';
comment on table public.circle_resources is
  'Append-preserving exact-version Circle resource assignments. End a row before assigning a newer version.';

commit;
