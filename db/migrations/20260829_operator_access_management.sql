begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- The passwordless invitation remains the account-access record. These tables
-- add only the approved operator responsibility and Circle scope; no auth token
-- or provider secret is copied into the application database.
create table if not exists public.operator_invitation_configs (
  invitation_id bigint primary key
    references public.passwordless_account_invites(id) on delete restrict,
  role_slug text not null
    references public.platform_roles(role_slug) on delete restrict,
  display_name text not null,
  created_at timestamptz not null default statement_timestamp(),
  check (role_slug in ('ops_admin', 'circle_leader', 'guide')),
  check (char_length(btrim(display_name)) between 1 and 120)
);

create table if not exists public.operator_invitation_circles (
  invitation_id bigint not null
    references public.operator_invitation_configs(invitation_id) on delete restrict,
  circle_id uuid not null references public.circles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key (invitation_id, circle_id)
);

create index if not exists operator_invitation_circles_circle_idx
  on public.operator_invitation_circles(circle_id, invitation_id);

create or replace function private.ruined_validate_operator_invitation_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.passwordless_account_invites invitation
    where invitation.id = new.invitation_id
      and invitation.intended_user_type = 'staff'
      and invitation.member_id is null
  ) then
    raise exception 'Operator configuration requires a staff invitation.';
  end if;

  return new;
end;
$$;

create or replace function private.ruined_validate_operator_invitation_circle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.operator_invitation_configs config
    join public.circles circle_record on circle_record.id = new.circle_id
    where config.invitation_id = new.invitation_id
      and config.role_slug in ('circle_leader', 'guide')
      and circle_record.status in ('forming', 'active')
  ) then
    raise exception 'Only a Shaper or Guide invitation may receive an active Circle.';
  end if;

  return new;
end;
$$;

create or replace function private.ruined_reject_operator_invitation_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Operator invitation configuration is immutable.';
end;
$$;

drop trigger if exists operator_invitation_configs_validate
  on public.operator_invitation_configs;
create trigger operator_invitation_configs_validate
before insert on public.operator_invitation_configs
for each row execute function private.ruined_validate_operator_invitation_config();

drop trigger if exists operator_invitation_configs_immutable
  on public.operator_invitation_configs;
create trigger operator_invitation_configs_immutable
before update or delete on public.operator_invitation_configs
for each row execute function private.ruined_reject_operator_invitation_mutation();

drop trigger if exists operator_invitation_circles_validate
  on public.operator_invitation_circles;
create trigger operator_invitation_circles_validate
before insert on public.operator_invitation_circles
for each row execute function private.ruined_validate_operator_invitation_circle();

drop trigger if exists operator_invitation_circles_immutable
  on public.operator_invitation_circles;
create trigger operator_invitation_circles_immutable
before update or delete on public.operator_invitation_circles
for each row execute function private.ruined_reject_operator_invitation_mutation();

revoke all on function private.ruined_validate_operator_invitation_config()
  from public, anon, authenticated;
revoke all on function private.ruined_validate_operator_invitation_circle()
  from public, anon, authenticated;
revoke all on function private.ruined_reject_operator_invitation_mutation()
  from public, anon, authenticated;

alter table public.operator_invitation_configs enable row level security;
alter table public.operator_invitation_circles enable row level security;

revoke all on table
  public.operator_invitation_configs,
  public.operator_invitation_circles
from public, anon, authenticated;

comment on table public.operator_invitation_configs is
  'Immutable responsibility approved for one staff passwordless invitation.';
comment on table public.operator_invitation_circles is
  'Immutable Circle scope approved for a Shaper or Guide staff invitation.';

commit;
