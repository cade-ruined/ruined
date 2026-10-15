begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Early Circle access is an explicit placement decision, never evidence that
-- the member completed Foundations or their private exercises.
create table public.member_circle_reveal_grants (
  id uuid primary key default gen_random_uuid(),
  circle_member_assignment_id bigint not null references public.circle_member_assignments(id) on delete restrict,
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  circle_id uuid not null references public.circles(id) on delete restrict,
  granted_by_auth_user_id uuid not null references public.platform_users(auth_user_id) on delete restrict,
  granted_at timestamptz not null default statement_timestamp(),
  reason text not null check (length(btrim(reason)) between 12 and 2000),
  revoked_at timestamptz,
  revoked_by_auth_user_id uuid references public.platform_users(auth_user_id) on delete restrict,
  revoke_reason text,
  check ((revoked_at is null and revoked_by_auth_user_id is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by_auth_user_id is not null
      and revoke_reason is not null and length(btrim(revoke_reason)) between 12 and 2000
      and revoked_at >= granted_at))
);
create unique index member_circle_reveal_grants_active_assignment
  on public.member_circle_reveal_grants(circle_member_assignment_id) where revoked_at is null;
create index member_circle_reveal_grants_member on public.member_circle_reveal_grants(member_id);
alter table public.member_circle_reveal_grants enable row level security;
revoke all on public.member_circle_reveal_grants from public, anon, authenticated;

create or replace function private.ruined_guard_circle_reveal_grant()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  placement record;
  actor uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'Circle access grant history cannot be deleted.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.revoked_at is not null or new.id is distinct from old.id
      or new.circle_member_assignment_id is distinct from old.circle_member_assignment_id
      or new.member_id is distinct from old.member_id or new.circle_id is distinct from old.circle_id
      or new.granted_by_auth_user_id is distinct from old.granted_by_auth_user_id
      or new.granted_at is distinct from old.granted_at or new.reason is distinct from old.reason
      or new.revoked_at is null then
      raise exception 'Circle access grant evidence is immutable; record a revocation instead.' using errcode = '23514';
    end if;
    actor := new.revoked_by_auth_user_id;
  else
    if new.revoked_at is not null or new.revoked_by_auth_user_id is not null or new.revoke_reason is not null then
      raise exception 'A new Circle access grant cannot already be revoked.' using errcode = '23514';
    end if;
    select assignment.member_id, assignment.circle_id into placement
    from public.circle_member_assignments assignment
    join public.circles circle on circle.id = assignment.circle_id
    where assignment.id = new.circle_member_assignment_id
      and assignment.ended_at is null and assignment.assigned_at <= statement_timestamp()
      and circle.status = 'active' and circle.activated_at <= statement_timestamp()
      and (circle.ends_at is null or circle.ends_at >= statement_timestamp());
    if not found then
      raise exception 'Early Circle access requires a current placement in an active Circle.' using errcode = '23514';
    end if;
    if (new.member_id is not null and new.member_id <> placement.member_id)
      or (new.circle_id is not null and new.circle_id <> placement.circle_id) then
      raise exception 'The Circle access grant must match its placement.' using errcode = '23514';
    end if;
    new.member_id := placement.member_id;
    new.circle_id := placement.circle_id;
    actor := new.granted_by_auth_user_id;
  end if;
  if not exists (
    select 1 from public.platform_users account
    join public.platform_role_grants role_grant on role_grant.auth_user_id = account.auth_user_id
    where account.auth_user_id = actor and account.status = 'active'
      and role_grant.role_slug = 'ops_admin' and role_grant.revoked_at is null
  ) then
    raise exception 'Active Administrator access is required for Circle access decisions.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.ruined_guard_circle_reveal_grant() from public, anon, authenticated;
create trigger member_circle_reveal_grants_guard before insert or update or delete
  on public.member_circle_reveal_grants for each row execute function private.ruined_guard_circle_reveal_grant();

-- This answers only the reveal question. Existing account, billing, released
-- profile and audience predicates remain responsible for baseline access.
create or replace function private.ruined_member_circle_is_revealed(requested_member_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.member_lifecycle lifecycle
    where lifecycle.member_id = requested_member_id and lifecycle.foundations_state = 'completed'
  ) or exists (
    select 1 from public.member_circle_reveal_grants access_grant
    join public.circle_member_assignments assignment
      on assignment.id = access_grant.circle_member_assignment_id
      and assignment.member_id = access_grant.member_id and assignment.circle_id = access_grant.circle_id
    join public.circles circle on circle.id = assignment.circle_id
    where access_grant.member_id = requested_member_id
      and access_grant.revoked_at is null and access_grant.granted_at <= statement_timestamp()
      and assignment.ended_at is null and assignment.assigned_at <= statement_timestamp()
      and circle.status = 'active' and circle.activated_at <= statement_timestamp()
      and (circle.ends_at is null or circle.ends_at >= statement_timestamp())
  );
$$;
revoke all on function private.ruined_member_circle_is_revealed(uuid) from public, anon, authenticated;

-- Authenticated callers can ask about themselves only; they cannot enumerate
-- another member's grant or write a grant through the public client.
create or replace function private.ruined_current_circle_is_revealed()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.ruined_member_circle_is_revealed(private.ruined_current_membership_id());
$$;
revoke all on function private.ruined_current_circle_is_revealed() from public, anon, authenticated;
grant execute on function private.ruined_current_circle_is_revealed() to authenticated;

commit;
