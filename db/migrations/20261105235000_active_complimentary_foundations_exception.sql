begin;

-- Late entry is an explicit administrator exception, only while this group
-- still has a real, published remaining call. Completed groups stay closed.
create function private.ruined_complimentary_foundations_group_open(schedule jsonb, evaluated_at timestamptz)
returns boolean language sql stable set search_path='' as $$
  select (schedule->>'serviceStartsAt')::timestamptz>evaluated_at or exists(
    select 1 from public.experiences event
    join private.member_email_cadence_event_bindings binding on binding.experience_id=event.id
    where binding.track='members' and binding.cohort_month=schedule->>'cohortMonth'
      and binding.kind in ('foundations_02','foundations_03','foundations_04')
      and event.status='published' and event.cancelled_at is null
      and event.visibility='invite_only' and event.registration_mode='internal'
      and event.starts_at>evaluated_at
      and event.starts_at=(schedule->'callStartsAt'->>(right(binding.kind,2)::integer-1))::timestamptz
  );
$$;
revoke all on function private.ruined_complimentary_foundations_group_open(jsonb,timestamptz) from public,anon,authenticated;
grant execute on function private.ruined_complimentary_foundations_group_open(jsonb,timestamptz) to service_role;

create or replace function private.ruined_guard_complimentary_foundations_override() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op<>'INSERT' then raise exception 'Foundations placement exceptions are append-only.'; end if;
  if not exists(select 1 from public.platform_users actor join public.platform_role_grants role_grant on role_grant.auth_user_id=actor.auth_user_id
    where actor.auth_user_id=new.actor_auth_user_id and actor.status='active' and role_grant.role_slug='ops_admin' and role_grant.revoked_at is null)
    then raise exception 'An active administrator is required for a Foundations exception.'; end if;
  if not private.ruined_member_registration_ready(new.member_id)
    or not (private.ruined_member_has_complimentary_funding(new.member_id) or private.ruined_member_has_operator_funding(new.member_id))
    or not private.ruined_complimentary_foundations_group_open(new.schedule,clock_timestamp()) then
    raise exception 'A ready complimentary member and an upcoming group or a published remaining Foundations call are required.'; end if;
  return new;
end $$;

commit;
