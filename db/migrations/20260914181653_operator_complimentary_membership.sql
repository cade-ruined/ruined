begin;

-- Current canonical grants fund access. Invitations and payment history do not.
create or replace function private.ruined_member_has_operator_funding(requested_member_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.ruined_members member
    join public.people person on person.id = member.person_id and person.status = 'active'
    join public.platform_users account
      on account.member_id = member.id and account.person_id = member.person_id
      and account.status = 'active'
    where member.id = requested_member_id
      and exists (
        select 1 from public.platform_role_grants member_grant
        where member_grant.auth_user_id = account.auth_user_id
          and member_grant.role_slug = 'member' and member_grant.revoked_at is null
      )
      and exists (
        select 1 from public.platform_role_grants operator_grant
        where operator_grant.auth_user_id = account.auth_user_id
          and operator_grant.role_slug in ('ops_admin', 'circle_leader', 'guide')
          and operator_grant.revoked_at is null
      )
  )
$$;
revoke all on function private.ruined_member_has_operator_funding(uuid)
  from public, anon, authenticated;

-- Writers take this lock before member/lifecycle locks. Revocation takes the
-- same grants for update, so admission cannot finish using a revoked grant.
create or replace function private.ruined_lock_member_operator_funding(requested_member_id uuid)
returns boolean language plpgsql security invoker set search_path = ''
as $$
begin
  perform operator_grant.id
  from public.platform_role_grants operator_grant
  join public.platform_users account on account.auth_user_id = operator_grant.auth_user_id
  where account.member_id = requested_member_id
    and operator_grant.role_slug in ('ops_admin', 'circle_leader', 'guide')
    and operator_grant.revoked_at is null
  order by operator_grant.role_slug, operator_grant.id
  for share of operator_grant;
  return private.ruined_member_has_operator_funding(requested_member_id);
end;
$$;
revoke all on function private.ruined_lock_member_operator_funding(uuid)
  from public, anon, authenticated;

create or replace function private.ruined_validate_member_onboarding_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle_record public.member_lifecycle%rowtype;
  member_person_id uuid;
begin
  if new.state <> 'completed'
     or (tg_op = 'UPDATE' and old.state = 'completed') then
    return new;
  end if;

  select lifecycle.*
  into lifecycle_record
  from public.member_lifecycle lifecycle
  where lifecycle.member_id = new.member_id;

  select member.person_id
  into member_person_id
  from public.ruined_members member
  where member.id = new.member_id;

  if lifecycle_record.billing_state <> 'active'
     and not private.ruined_member_has_operator_funding(new.member_id) then
    raise exception 'Active billing or complimentary operator access is required to complete administrative onboarding.';
  end if;

  if new.profile_completed_at is null
     or new.agreement_completed_at is null
     or (new.billing_confirmed_at is null
       and not private.ruined_member_has_operator_funding(new.member_id)) then
    raise exception 'Profile, agreement, and billing checkpoints are required to complete administrative onboarding.';
  end if;

  if not exists (
    select 1
    from public.person_profiles profile
    where profile.person_id = member_person_id
      and coalesce(profile.preferred_name, profile.display_name) is not null
  ) then
    raise exception 'A named Person profile is required to complete administrative onboarding.';
  end if;

  if not exists (
    select 1
    from public.platform_users platform_user
    join public.platform_role_grants role_grant
      on role_grant.auth_user_id = platform_user.auth_user_id
      and role_grant.role_slug = 'member'
      and role_grant.revoked_at is null
    join public.person_email_addresses email_address
      on email_address.person_id = platform_user.person_id
      and email_address.verification_state = 'verified'
      and email_address.retired_at is null
    where platform_user.person_id = member_person_id
      and platform_user.status = 'active'
  ) then
    raise exception 'An active member login and verified email are required to complete administrative onboarding.';
  end if;

  if not exists (
    select 1
    from public.membership_agreement_acceptances acceptance
    where acceptance.member_id = new.member_id
      and acceptance.person_id = member_person_id
      and acceptance.accepted_at <= new.agreement_completed_at
  ) then
    raise exception 'A durable agreement acceptance is required to complete administrative onboarding.';
  end if;

  if new.started_at is null then
    new.started_at := statement_timestamp();
  end if;
  if new.completed_at is null then
    new.completed_at := statement_timestamp();
  end if;

  return new;
end;
$$;

create or replace function private.ruined_current_active_access_member_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select member.id
  from public.platform_users platform_user
  join public.ruined_members member on member.person_id = platform_user.person_id
  join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
  join public.platform_role_grants member_grant
    on member_grant.auth_user_id = platform_user.auth_user_id
    and member_grant.role_slug = 'member' and member_grant.revoked_at is null
  where platform_user.auth_user_id = private.ruined_current_auth_user_id()
    and platform_user.status = 'active'
    and lifecycle.account_state = 'active'
    and (lifecycle.billing_state = 'active' or private.ruined_member_has_operator_funding(member.id))
    and lifecycle.administrative_onboarding_state = 'completed'
    and (
      lifecycle.standing_state = 'active'
      or (lifecycle.standing_state = 'cancellation_requested'
          and lifecycle.cancellation_effective_at > statement_timestamp())
    )
  limit 1
$$;
revoke all on function private.ruined_current_active_access_member_id()
  from public, anon, authenticated;
grant execute on function private.ruined_current_active_access_member_id() to authenticated;

create or replace function private.ruined_current_updates_member_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select member.id
  from public.platform_users platform_user
  join public.ruined_members member on member.person_id = platform_user.person_id
  join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
  join public.platform_role_grants member_grant
    on member_grant.auth_user_id = platform_user.auth_user_id
    and member_grant.role_slug = 'member' and member_grant.revoked_at is null
  where platform_user.auth_user_id = private.ruined_current_auth_user_id()
    and platform_user.status = 'active'
    and lifecycle.account_state = 'active'
    and (lifecycle.billing_state = 'active' or private.ruined_member_has_operator_funding(member.id))
    and lifecycle.administrative_onboarding_state = 'completed'
    and (
      lifecycle.standing_state = 'active'
      or (lifecycle.standing_state = 'cancellation_requested'
          and lifecycle.cancellation_effective_at > statement_timestamp())
    )
  limit 1
$$;
revoke all on function private.ruined_current_updates_member_id()
  from public, anon, authenticated;
grant execute on function private.ruined_current_updates_member_id() to authenticated;

commit;
