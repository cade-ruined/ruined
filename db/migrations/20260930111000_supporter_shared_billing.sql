begin;

-- A couple's second adult follows canonical shared billing. A stale local
-- active projection must not permit service after the payer's funding ends.
-- Preserve readiness, completed Foundations and current Circle membership.
create or replace function private.ruined_guard_new_supporter_service()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.role_slug <> 'circle_leader' then return new; end if;
  if not private.ruined_has_leadership_responsibility(new.assigned_by_auth_user_id,'supporter_readiness') then
    raise exception 'Configure Supporter readiness responsibility before starting service.';
  end if;
  if not exists (select 1 from public.supporter_readiness_approvals ready
    where ready.auth_user_id = new.auth_user_id and ready.circle_id = new.circle_id) then
    raise exception 'Approve this Circle member readiness before starting service.';
  end if;
  if not exists (select 1 from public.platform_users account
    join public.circle_member_assignments placement on placement.member_id = account.member_id
    join public.ruined_members member on member.id = account.member_id and member.person_id = account.person_id
    join public.people person on person.id = member.person_id
    join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
    join public.circles circle on circle.id = placement.circle_id
    where account.status = 'active' and person.status = 'active' and circle.status in ('active','forming')
      and lifecycle.account_state = 'active' and lifecycle.administrative_onboarding_state = 'completed'
      and lifecycle.program_state in ('active','onboarding') and lifecycle.foundations_state = 'completed'
      and (lifecycle.standing_state = 'active' or (lifecycle.standing_state = 'cancellation_requested' and lifecycle.cancellation_effective_at > statement_timestamp()))
      and ((coalesce(private.ruined_member_shared_billing_state(member.id), lifecycle.billing_state) = 'active'
        and member.membership_state = 'active') or private.ruined_member_has_complimentary_funding(member.id))
      and exists(select 1 from public.platform_role_grants access where access.auth_user_id = account.auth_user_id and access.role_slug = 'member' and access.revoked_at is null)
      and account.auth_user_id = new.auth_user_id and placement.circle_id = new.circle_id
      and placement.ended_at is null and placement.assigned_at <= statement_timestamp()) then
    raise exception 'A Circle Supporter must be an eligible current member of that Circle who has completed Foundations.';
  end if;
  return new;
end;
$$;
revoke all on function private.ruined_guard_new_supporter_service() from public,anon,authenticated;

commit;
