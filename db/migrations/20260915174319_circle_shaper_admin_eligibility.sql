begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Being a Circle's Shaper is an assignment, not an Administrator downgrade.
-- Preserve the existing private trigger and every check; permit an active
-- Administrator grant only when the requested Circle staff role is Shaper.
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
     and (
       role_grant.role_slug = new.role_slug
       or (new.role_slug = 'circle_leader' and role_grant.role_slug = 'ops_admin')
     )
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

revoke all on function private.ruined_validate_circle_staff_assignment()
  from public, anon, authenticated;

commit;
