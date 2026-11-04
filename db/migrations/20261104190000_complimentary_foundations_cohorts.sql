begin;

-- Assignment is based on completed registration, never when a reminder worker
-- happens to run. Invitation expiry and the accepted complimentary grant do not change.
create function private.ruined_complimentary_foundations_schedule(completed_at timestamptz, requested_month text default null)
returns jsonb language plpgsql immutable set search_path='' as $$
declare month_date date; first_day date; first_call timestamptz; calls jsonb:='[]'; call_day date;
  month_key text; i integer; through_at timestamptz;
begin
  if completed_at is null or not isfinite(completed_at) then return null; end if;
  if requested_month is not null and (requested_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or requested_month<'2026-11' or requested_month>'9998-12') then
    raise exception 'Invalid Foundations group.'; end if;
  month_date:=greatest(date '2026-11-01',coalesce((requested_month||'-01')::date,date_trunc('month',completed_at at time zone 'America/Denver')::date));
  first_day:=month_date+((4-extract(dow from month_date)::integer+7)%7);
  first_call:=(first_day+time '15:00') at time zone 'America/Denver';
  while requested_month is null and completed_at>=first_call-interval '24 hours' loop
    month_date:=(month_date+interval '1 month')::date;
    first_day:=month_date+((4-extract(dow from month_date)::integer+7)%7);
    first_call:=(first_day+time '15:00') at time zone 'America/Denver';
  end loop;
  month_key:=to_char(month_date,'YYYY-MM');
  for i in 0..3 loop
    call_day:=case when i=3 and month_key='2026-11' then date '2026-11-30'
      when i=3 and month_key='2026-12' then date '2026-12-30' else first_day+i*7 end;
    calls:=calls||jsonb_build_array(to_char(((call_day+time '15:00') at time zone 'America/Denver') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS".000Z"'));
  end loop;
  through_at:=((first_call at time zone 'UTC')+interval '1 month') at time zone 'UTC';
  return jsonb_build_object('version','foundations-prepaid-v3','cohortMonth',month_key,'timeZone','America/Denver','callStartsAt',calls,
    'cutoffAt',to_char((first_call-interval '24 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
    'serviceStartsAt',calls->>0,'prepaidThrough',to_char(through_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
    'nextChargeAt',to_char(through_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS".000Z"'),
    'initialTermEndsAt',to_char((first_call at time zone 'UTC')+interval '12 months','YYYY-MM-DD"T"HH24:MI:SS".000Z"'));
end $$;

create table private.member_complimentary_foundations_cohorts (
  member_id uuid primary key references public.member_registration_access(member_id) on delete restrict,
  registered_at timestamptz not null,
  schedule jsonb not null check(private.ruined_valid_prepaid_schedule(schedule,'monthly')),
  source text not null check(source in ('registration','existing_roster')),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.member_complimentary_foundations_cohorts enable row level security;
revoke all on private.member_complimentary_foundations_cohorts from public,anon,authenticated;
grant select,insert on private.member_complimentary_foundations_cohorts to service_role;

create table private.member_complimentary_foundations_overrides (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references private.member_complimentary_foundations_cohorts(member_id),
  schedule jsonb not null check(private.ruined_valid_prepaid_schedule(schedule,'monthly')),
  actor_auth_user_id uuid not null references public.platform_users(auth_user_id),
  reason text not null check(length(btrim(reason)) between 10 and 1000),
  created_at timestamptz not null default clock_timestamp()
);
create index member_complimentary_foundations_override_latest on private.member_complimentary_foundations_overrides(member_id,created_at desc,id desc);
alter table private.member_complimentary_foundations_overrides enable row level security;
revoke all on private.member_complimentary_foundations_overrides from public,anon,authenticated;
grant select,insert on private.member_complimentary_foundations_overrides to service_role;

create function private.ruined_guard_complimentary_foundations_override() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op<>'INSERT' then raise exception 'Foundations placement exceptions are append-only.'; end if;
  if not exists(select 1 from public.platform_users actor join public.platform_role_grants role_grant on role_grant.auth_user_id=actor.auth_user_id
    where actor.auth_user_id=new.actor_auth_user_id and actor.status='active' and role_grant.role_slug='ops_admin' and role_grant.revoked_at is null)
    then raise exception 'An active administrator is required for a Foundations exception.'; end if;
  if not private.ruined_member_registration_ready(new.member_id)
    or not (private.ruined_member_has_complimentary_funding(new.member_id) or private.ruined_member_has_operator_funding(new.member_id))
    or (new.schedule->>'serviceStartsAt')::timestamptz<=clock_timestamp() then
    raise exception 'A ready complimentary member and an upcoming Foundations group are required.'; end if;
  return new;
end $$;
create trigger member_complimentary_foundations_override_guard before insert or update or delete
  on private.member_complimentary_foundations_overrides for each row execute function private.ruined_guard_complimentary_foundations_override();

create function private.ruined_guard_complimentary_foundations_cohort() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op<>'INSERT' then raise exception 'Completed Foundations assignments are immutable.'; end if;
  if not exists(select 1 from public.member_registration_access registration
    where registration.member_id=new.member_id and registration.registered_at=new.registered_at
      and registration.completion_basis='complimentary' and private.ruined_member_registration_ready(new.member_id)
      and (private.ruined_member_has_complimentary_funding(new.member_id) or private.ruined_member_has_operator_funding(new.member_id))) then
    raise exception 'A completed, eligible complimentary registration is required.'; end if;
  if new.source='registration' and new.schedule is distinct from private.ruined_complimentary_foundations_schedule(new.registered_at,null) then
    raise exception 'The assigned Foundations group must follow the registration cutoff.'; end if;
  if new.source='existing_roster' and not exists(select 1 from public.experience_registrations roster
    join private.member_email_cadence_event_bindings binding on binding.experience_id=roster.experience_id
    join public.experiences event on event.id=roster.experience_id
    where roster.member_id=new.member_id and roster.status='registered' and roster.source='ops'
      and binding.kind='foundations_01' and binding.track='members' and binding.cohort_month=new.schedule->>'cohortMonth'
      and event.status in ('published','completed') and event.cancelled_at is null and event.visibility='invite_only' and event.registration_mode='internal') then
    raise exception 'An existing explicit Foundations group invitation is required.'; end if;
  return new;
end $$;
create trigger member_complimentary_foundations_cohort_guard before insert or update or delete
  on private.member_complimentary_foundations_cohorts for each row execute function private.ruined_guard_complimentary_foundations_cohort();

create function private.ruined_assign_complimentary_foundations(target_member_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare registration public.member_registration_access%rowtype; assigned jsonb; existing_months text[]; month_key text;
begin
  select * into registration from public.member_registration_access where member_id=target_member_id for update;
  if registration.member_id is null or registration.registered_at is null or registration.completion_basis<>'complimentary'
    or not private.ruined_member_registration_ready(target_member_id)
    or not (private.ruined_member_has_complimentary_funding(target_member_id) or private.ruined_member_has_operator_funding(target_member_id)) then return null; end if;
  select coalesce((select exception.schedule from private.member_complimentary_foundations_overrides exception
    where exception.member_id=target_member_id order by exception.created_at desc,exception.id desc limit 1),cohort.schedule)
    into assigned from private.member_complimentary_foundations_cohorts cohort where cohort.member_id=target_member_id;
  if assigned is not null then return assigned; end if;
  -- Existing explicit member-group invitations remain authoritative. Founder
  -- practice calls never classify the member's Foundations group.
  select array_agg(distinct binding.cohort_month) into existing_months
    from public.experience_registrations roster
    join public.experiences event on event.id=roster.experience_id
    join private.member_email_cadence_event_bindings binding on binding.experience_id=event.id
    where roster.member_id=target_member_id and roster.source='ops' and roster.status='registered'
      and binding.kind='foundations_01' and binding.track='members' and binding.cohort_month is not null
      and event.visibility='invite_only' and event.registration_mode='internal'
      and event.status in ('published','completed') and event.cancelled_at is null;
  if cardinality(existing_months)>1 then return null; end if;
  month_key:=existing_months[1];
  assigned:=private.ruined_complimentary_foundations_schedule(registration.registered_at,month_key);
  insert into private.member_complimentary_foundations_cohorts(member_id,registered_at,schedule,source)
    values(target_member_id,registration.registered_at,assigned,case when month_key is null then 'registration' else 'existing_roster' end)
    on conflict(member_id) do nothing;
  select schedule into assigned from private.member_complimentary_foundations_cohorts where member_id=target_member_id;
  return assigned;
end $$;

create function private.ruined_override_complimentary_foundations(target_member_id uuid,target_month text,actor_id uuid,override_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare assigned jsonb; desired jsonb; completed_at timestamptz;
begin
  assigned:=private.ruined_assign_complimentary_foundations(target_member_id);
  if assigned is null then raise exception 'A completed complimentary Foundations assignment is required.'; end if;
  select registered_at into completed_at from public.member_registration_access where member_id=target_member_id;
  desired:=private.ruined_complimentary_foundations_schedule(completed_at,target_month);
  if assigned=desired then return assigned; end if;
  insert into private.member_complimentary_foundations_overrides(member_id,schedule,actor_auth_user_id,reason)
    values(target_member_id,desired,actor_id,override_reason);
  return desired;
end $$;

create function private.ruined_complete_complimentary_foundations_assignment() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.registered_at is not null and new.completion_basis='complimentary' then
    perform private.ruined_assign_complimentary_foundations(new.member_id);
  end if;
  return new;
end $$;
create trigger member_registration_complimentary_foundations_assignment after insert or update of registered_at,completion_basis
  on public.member_registration_access for each row execute function private.ruined_complete_complimentary_foundations_assignment();

revoke all on function private.ruined_complimentary_foundations_schedule(timestamptz,text),
  private.ruined_assign_complimentary_foundations(uuid),private.ruined_complete_complimentary_foundations_assignment(),private.ruined_guard_complimentary_foundations_cohort() from public,anon,authenticated;
grant execute on function private.ruined_complimentary_foundations_schedule(timestamptz,text),
  private.ruined_assign_complimentary_foundations(uuid),private.ruined_complete_complimentary_foundations_assignment(),private.ruined_guard_complimentary_foundations_cohort() to service_role;
revoke all on function private.ruined_override_complimentary_foundations(uuid,text,uuid,text),private.ruined_guard_complimentary_foundations_override() from public,anon,authenticated;
grant execute on function private.ruined_override_complimentary_foundations(uuid,text,uuid,text),private.ruined_guard_complimentary_foundations_override() to service_role;
commit;
