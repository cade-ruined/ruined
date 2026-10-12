begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Capacity is the exception-review boundary. The healthy operating band is
-- independently 7–13 participants, including the Circle leader once.
alter table public.circles alter column capacity set default 20;
update public.circles set capacity = 20
where capacity = 10 and status in ('forming', 'active');
comment on column public.circles.capacity is 'Placement exception-review boundary, including the Circle leader once. Default 20; healthy operating band 7–13.';

create or replace function public.ruined_enforce_circle_capacity()
returns trigger language plpgsql set search_path = '' as $$
declare projected integer; allowed_capacity integer; already_counted boolean; approval_id uuid;
begin
  if new.ended_at is not null then return new; end if;
  update public.circles set updated_at = statement_timestamp() where id = new.circle_id
  returning capacity into allowed_capacity;
  if not found then raise exception 'Circle does not exist.'; end if;
  select exists (
    select 1 from public.circle_member_assignments assignment
    where assignment.circle_id = new.circle_id and assignment.member_id = new.member_id and assignment.ended_at is null
    union all
    select 1 from public.circle_staff_assignments staff
    join public.platform_users platform_user on platform_user.auth_user_id = staff.auth_user_id
    join public.ruined_members member on member.person_id = platform_user.person_id
    where staff.circle_id = new.circle_id and staff.ended_at is null and staff.role_slug = 'circle_leader' and member.id = new.member_id
  ) into already_counted;
  projected := private.ruined_circle_participant_count(new.circle_id) + case when already_counted then 0 else 1 end;
  if projected > allowed_capacity and not already_counted then
    select review.id into approval_id from public.circle_placement_reviews review
    where review.member_id = new.member_id and review.circle_id = new.circle_id and review.status = 'approved'
      and review.reviewed_by_auth_user_id = new.assigned_by_auth_user_id
      and review.projected_count = projected
      and review.reviewed_at >= statement_timestamp() - interval '5 minutes'
      and private.ruined_has_leadership_responsibility(review.reviewed_by_auth_user_id, 'circle_exception')
    order by review.reviewed_at desc limit 1 for update;
    if approval_id is null then raise exception 'Placement above % requires a current exception review.', allowed_capacity; end if;
    update public.circle_placement_reviews set status = 'placed' where id = approval_id;
  end if;
  return new;
end
$$;

-- This registry tracks a continuous size issue even if an operator completes
-- its task manually. A fresh task requires recovery followed by a new breach.
create table public.circle_size_work (
  circle_id uuid primary key references public.circles(id) on delete restrict,
  size_state text check (size_state in ('low', 'high')),
  episode bigint not null default 0 check (episode >= 0),
  operator_task_id uuid unique references public.operator_tasks(id) on delete restrict,
  routed_to_auth_user_id uuid references public.platform_users(auth_user_id) on delete set null,
  updated_at timestamptz not null default statement_timestamp(),
  check ((size_state is null) = (operator_task_id is null))
);
alter table public.circle_size_work enable row level security;
revoke all on public.circle_size_work from public, anon, authenticated;

create or replace function private.ruined_reconcile_circle_size_work(target_circle_id uuid)
returns void language plpgsql set search_path = '' as $$
declare
  circle_record record;
  registry public.circle_size_work%rowtype;
  task_record public.operator_tasks%rowtype;
  participant_count integer;
  next_size_state text;
  libby_id uuid;
  eligible_libby_id uuid;
  desired_assignee uuid;
  next_task_id uuid;
  next_description text;
  next_title text;
  resolution text;
  resolved_status text;
  refreshed_status text;
begin
  -- A row write serializes with placements and forces a retry for stale
  -- repeatable-read snapshots. Deferred triggers evaluate the final roster.
  update public.circles set updated_at = statement_timestamp()
  where id = target_circle_id returning name, status into circle_record;
  if not found then return; end if;
  participant_count := private.ruined_circle_participant_count(target_circle_id);
  next_size_state := case when circle_record.status <> 'active' then null
    when participant_count < 7 then 'low' when participant_count > 13 then 'high' else null end;

  select * into registry from public.circle_size_work where circle_id = target_circle_id for update;
  if not found then
    if next_size_state is null then return; end if;
    insert into public.circle_size_work(circle_id) values (target_circle_id) returning * into registry;
  end if;

  if registry.size_state is distinct from next_size_state and registry.operator_task_id is not null then
    resolution := case when circle_record.status <> 'active' then 'circle_inactive'
      when next_size_state is null then 'healthy_size' else 'size_band_changed' end;
    resolved_status := case when circle_record.status <> 'active' then 'cancelled' else 'completed' end;
    select * into task_record from public.operator_tasks where id = registry.operator_task_id for update;
    if task_record.status in ('open', 'in_progress', 'blocked') then
      update public.operator_tasks set status = resolved_status,
        completed_at = case when resolved_status = 'completed' then statement_timestamp() else null end,
        blocked_reason = null, version = version + 1, updated_at = statement_timestamp()
      where id = task_record.id;
      insert into public.operator_task_events(operator_task_id, event_type, previous_status, next_status, actor_type, evidence)
      values (task_record.id, resolved_status, task_record.status, resolved_status, 'system',
        jsonb_build_object('circle_id', target_circle_id, 'participant_count', participant_count, 'reason', resolution));
    end if;
  end if;

  if next_size_state is null then
    if registry.size_state is not null then
      update public.circle_size_work set size_state = null, operator_task_id = null,
        routed_to_auth_user_id = null, updated_at = statement_timestamp()
      where circle_id = target_circle_id;
    end if;
    return;
  end if;

  select account.auth_user_id into libby_id from public.platform_users account
  where account.email_normalized = 'libby@theruinedproject.com';
  select account.auth_user_id into eligible_libby_id from public.platform_users account
  where account.auth_user_id = libby_id and account.status = 'active' and exists (
    select 1 from public.platform_role_grants grant_record
    where grant_record.auth_user_id = account.auth_user_id and grant_record.role_slug = 'ops_admin'
      and grant_record.revoked_at is null
  );
  next_title := left(circle_record.name, 140) || case when next_size_state = 'low' then ': below 7 participants' else ': above 13 participants' end;
  next_description := format('%s has %s participants, including the Circle Supporter once. The healthy range is 7–13. %s',
    circle_record.name, participant_count, case when next_size_state = 'low'
      then 'Review placement, recruitment, or combining Circles.'
      else 'Review moving participants or forming another Circle.' end)
    || case when eligible_libby_id is null then ' Libby needs active Administrator access before this task can be assigned to her.' else '' end;

  if registry.size_state is distinct from next_size_state then
    next_task_id := gen_random_uuid();
    insert into public.operator_tasks(id, circle_id, task_type, title, description, priority,
      assigned_to_auth_user_id, created_by_type, idempotency_key)
    values (next_task_id, target_circle_id, 'circle.size_' || next_size_state, next_title, next_description, 'high',
      eligible_libby_id, 'system', 'circle-size:' || target_circle_id::text || ':' || (registry.episode + 1)::text);
    insert into public.operator_task_events(operator_task_id, event_type, next_status, actor_type, evidence)
    values (next_task_id, 'created', 'open', 'system', jsonb_build_object('circle_id', target_circle_id,
      'participant_count', participant_count, 'size_state', next_size_state, 'assigned_to_auth_user_id', eligible_libby_id));
    update public.circle_size_work set size_state = next_size_state, episode = episode + 1,
      operator_task_id = next_task_id, routed_to_auth_user_id = eligible_libby_id,
      updated_at = statement_timestamp() where circle_id = target_circle_id;
  else
    select * into task_record from public.operator_tasks where id = registry.operator_task_id for update;
    -- Respect completed work and another operator's existing claim.
    if task_record.status not in ('open', 'in_progress', 'blocked') then return; end if;
    desired_assignee := case when task_record.assigned_to_auth_user_id is null
      or task_record.assigned_to_auth_user_id = registry.routed_to_auth_user_id then eligible_libby_id
      else task_record.assigned_to_auth_user_id end;
    refreshed_status := case when desired_assignee is null and task_record.status = 'in_progress'
      then 'open' else task_record.status end;
    if task_record.assigned_to_auth_user_id is null
      or task_record.assigned_to_auth_user_id = registry.routed_to_auth_user_id then
      update public.circle_size_work set routed_to_auth_user_id = eligible_libby_id
      where circle_id = target_circle_id and routed_to_auth_user_id is distinct from eligible_libby_id;
    end if;
    if (task_record.title, task_record.description, task_record.assigned_to_auth_user_id, task_record.status)
      is distinct from (next_title, next_description, desired_assignee, refreshed_status) then
      update public.operator_tasks set title = next_title, description = next_description,
        assigned_to_auth_user_id = desired_assignee, status = refreshed_status,
        version = version + 1, updated_at = statement_timestamp()
      where id = task_record.id;
      if task_record.status is distinct from refreshed_status then
        insert into public.operator_task_events(operator_task_id, event_type, previous_status, next_status, actor_type, evidence)
        values (task_record.id, 'state_changed', task_record.status, refreshed_status, 'system',
          jsonb_build_object('reason', 'circle_size_owner_unavailable'));
      end if;
      if task_record.assigned_to_auth_user_id is distinct from desired_assignee then
        insert into public.operator_task_events(operator_task_id, event_type, actor_type, evidence)
        values (task_record.id, 'assigned', 'system', jsonb_build_object('previous_assignee', task_record.assigned_to_auth_user_id,
          'assigned_to_auth_user_id', desired_assignee, 'reason', 'circle_size_owner_eligibility'));
      end if;
    end if;
  end if;
end
$$;
revoke all on function private.ruined_reconcile_circle_size_work(uuid) from public, anon, authenticated;

create or replace function private.ruined_circle_size_roster_changed()
returns trigger language plpgsql set search_path = '' as $$
declare target_id uuid; old_id uuid; new_id uuid;
begin
  if tg_op <> 'INSERT' then old_id := old.circle_id; end if;
  if tg_op <> 'DELETE' then new_id := new.circle_id; end if;
  for target_id in select distinct id from unnest(array[old_id, new_id]) id where id is not null order by id loop
    perform private.ruined_reconcile_circle_size_work(target_id);
  end loop;
  return null;
end
$$;
revoke all on function private.ruined_circle_size_roster_changed() from public, anon, authenticated;
create constraint trigger circle_member_assignments_size_work
after insert or update of circle_id, member_id, ended_at or delete on public.circle_member_assignments
deferrable initially deferred for each row execute function private.ruined_circle_size_roster_changed();
create constraint trigger circle_staff_assignments_size_work
after insert or update of circle_id, auth_user_id, role_slug, ended_at or delete on public.circle_staff_assignments
deferrable initially deferred for each row execute function private.ruined_circle_size_roster_changed();

create or replace function private.ruined_circle_size_circle_changed()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform private.ruined_reconcile_circle_size_work(new.id);
  return null;
end
$$;
revoke all on function private.ruined_circle_size_circle_changed() from public, anon, authenticated;
create constraint trigger circles_size_work
after insert or update of status, name on public.circles
deferrable initially deferred for each row execute function private.ruined_circle_size_circle_changed();

-- Account/role restoration must route pending work even if the roster is quiet.
create or replace function private.ruined_circle_size_owner_changed()
returns trigger language plpgsql set search_path = '' as $$
declare affected_id uuid; target_id uuid; relevant boolean;
begin
  if tg_op = 'DELETE' then affected_id := old.auth_user_id; else affected_id := new.auth_user_id; end if;
  select exists (select 1 from public.platform_users where auth_user_id = affected_id
    and email_normalized = 'libby@theruinedproject.com') into relevant;
  if tg_table_name = 'platform_users' and tg_op <> 'INSERT' then
    relevant := relevant or old.email_normalized = 'libby@theruinedproject.com';
  end if;
  if relevant then
    for target_id in select circle.id from public.circles circle
      where circle.status = 'active' or exists (select 1 from public.circle_size_work work
        where work.circle_id = circle.id and work.size_state is not null) order by circle.id loop
      perform private.ruined_reconcile_circle_size_work(target_id);
    end loop;
  end if;
  return null;
end
$$;
revoke all on function private.ruined_circle_size_owner_changed() from public, anon, authenticated;
create constraint trigger platform_users_circle_size_owner
after insert or update of status, email_normalized on public.platform_users
deferrable initially deferred for each row execute function private.ruined_circle_size_owner_changed();
create constraint trigger platform_role_grants_circle_size_owner
after insert or update of revoked_at, role_slug or delete on public.platform_role_grants
deferrable initially deferred for each row execute function private.ruined_circle_size_owner_changed();

-- Identity linking can change the deduplicated count without moving a roster
-- row, for example when a legacy Supporter is linked to an existing member.
create or replace function private.ruined_circle_size_person_changed()
returns trigger language plpgsql set search_path = '' as $$
declare target_id uuid;
begin
  if new.person_id is not distinct from old.person_id then return null; end if;
  if tg_table_name = 'platform_users' then
    for target_id in select distinct circle_id from public.circle_staff_assignments
      where auth_user_id = new.auth_user_id and role_slug = 'circle_leader' and ended_at is null order by circle_id loop
      perform private.ruined_reconcile_circle_size_work(target_id);
    end loop;
  else
    for target_id in select distinct circle_id from public.circle_member_assignments
      where member_id = new.id and ended_at is null order by circle_id loop
      perform private.ruined_reconcile_circle_size_work(target_id);
    end loop;
  end if;
  return null;
end
$$;
revoke all on function private.ruined_circle_size_person_changed() from public, anon, authenticated;
create constraint trigger platform_users_circle_size_person
after update of person_id on public.platform_users
deferrable initially deferred for each row execute function private.ruined_circle_size_person_changed();
create constraint trigger ruined_members_circle_size_person
after update of person_id on public.ruined_members
deferrable initially deferred for each row execute function private.ruined_circle_size_person_changed();

-- Existing unhealthy active Circles enter the same audited, assigned workflow.
do $$
declare target_id uuid;
begin
  for target_id in select id from public.circles where status = 'active' order by id loop
    perform private.ruined_reconcile_circle_size_work(target_id);
  end loop;
end
$$;

commit;
