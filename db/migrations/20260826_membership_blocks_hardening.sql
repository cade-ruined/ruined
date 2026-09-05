begin;

-- The migration runner must preserve authenticated USAGE after the original
-- platform migration grants access to the private RLS helpers. Public and anon
-- remain unable to resolve anything in the private schema.
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- Every current-assignment writer uses Circle then Block lock order. Keeping
-- the database guard in the same order avoids a trusted direct writer racing
-- an operator correction into a deadlock.
create or replace function private.ruined_guard_block_circle_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  block_status text;
  circle_status text;
begin
  if new.ended_at is not null then
    return new;
  end if;

  select circle.status
  into circle_status
  from public.circles circle
  where circle.id = new.circle_id
  for update;

  if circle_status is null then
    raise exception 'Circle % does not exist.', new.circle_id;
  end if;
  if circle_status not in ('forming', 'active') then
    raise exception 'Circle % is not current.', new.circle_id;
  end if;

  select block_record.status
  into block_status
  from public.membership_blocks block_record
  where block_record.id = new.block_id
  for update;

  if block_status is null then
    raise exception 'Block % does not exist.', new.block_id;
  end if;
  if block_status not in ('forming', 'active') then
    raise exception 'Block % is not accepting Circles.', new.block_id;
  end if;

  return new;
end;
$$;

-- Creating an already-active Block must obey the same two-Circle rule as an
-- activation update. In practice a new Block cannot have assignments yet, so
-- direct active inserts fail closed.
create or replace function private.ruined_enforce_block_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_circle_count integer;
begin
  if new.status <> 'active' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

  select count(*)
  into current_circle_count
  from public.block_circle_assignments assignment
  join public.circles circle on circle.id = assignment.circle_id
  where assignment.block_id = new.id
    and assignment.ended_at is null
    and circle.status in ('forming', 'active');

  if current_circle_count < 2 then
    raise exception 'A Block needs at least two current Circles before activation.';
  end if;

  return new;
end;
$$;

drop trigger if exists membership_blocks_activation_guard
  on public.membership_blocks;
create trigger membership_blocks_activation_guard
before insert or update of status
on public.membership_blocks
for each row execute function private.ruined_enforce_block_activation();

-- A Block stops being active when it no longer contains multiple current
-- Circles. The historical Block and Circle relationships remain intact.
create or replace function private.ruined_reconcile_active_block(
  affected_block_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  block_status text;
  current_circle_count integer;
begin
  if affected_block_id is null then
    return;
  end if;

  select membership_block.status
  into block_status
  from public.membership_blocks membership_block
  where membership_block.id = affected_block_id
  for update;

  if block_status is distinct from 'active' then
    return;
  end if;

  select count(*)
  into current_circle_count
  from public.block_circle_assignments assignment
  join public.circles circle on circle.id = assignment.circle_id
  where assignment.block_id = affected_block_id
    and assignment.ended_at is null
    and circle.status in ('forming', 'active');

  if current_circle_count < 2 then
    update public.membership_blocks
    set
      status = 'archived',
      ends_at = coalesce(ends_at, statement_timestamp()),
      updated_at = statement_timestamp()
    where id = affected_block_id
      and status = 'active';
  end if;
end;
$$;

create or replace function private.ruined_reconcile_block_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.ended_at is null and (
    new.ended_at is not null
    or new.block_id is distinct from old.block_id
  ) then
    perform private.ruined_reconcile_active_block(old.block_id);
  end if;

  return new;
end;
$$;

drop trigger if exists block_circle_assignments_active_block_reconcile
  on public.block_circle_assignments;
create trigger block_circle_assignments_active_block_reconcile
after update of block_id, ended_at
on public.block_circle_assignments
for each row execute function private.ruined_reconcile_block_assignment_change();

-- Circle completion or archival also changes whether it counts as a current
-- Circle, even when its temporal Block assignment remains open.
create or replace function private.ruined_reconcile_block_circle_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_block_id uuid;
begin
  if old.status in ('forming', 'active')
    and new.status not in ('forming', 'active')
  then
    select assignment.block_id
    into affected_block_id
    from public.block_circle_assignments assignment
    where assignment.circle_id = new.id
      and assignment.ended_at is null
    order by assignment.assigned_at desc
    limit 1;

    perform private.ruined_reconcile_active_block(affected_block_id);
  end if;

  return new;
end;
$$;

drop trigger if exists circles_active_block_reconcile on public.circles;
create trigger circles_active_block_reconcile
after update of status
on public.circles
for each row execute function private.ruined_reconcile_block_circle_status();

-- Temporal assignment rows are evidence. Corrections end the relationship;
-- they never erase it.
create or replace function private.ruined_preserve_block_assignment_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Block assignment history cannot be deleted.';
  end if;

  if old.ended_at is not null and new is distinct from old then
    raise exception 'Ended Block assignment history is immutable.';
  end if;

  if new.block_id is distinct from old.block_id
    or new.circle_id is distinct from old.circle_id
    or new.assigned_by_auth_user_id is distinct from old.assigned_by_auth_user_id
    or new.assigned_at is distinct from old.assigned_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'End the current Block assignment before creating a replacement.';
  end if;

  return new;
end;
$$;

drop trigger if exists block_circle_assignments_preserve_history
  on public.block_circle_assignments;
create trigger block_circle_assignments_preserve_history
before update or delete
on public.block_circle_assignments
for each row execute function private.ruined_preserve_block_assignment_history();

revoke all on function private.ruined_enforce_block_activation()
  from public, anon, authenticated;
revoke all on function private.ruined_guard_block_circle_assignment()
  from public, anon, authenticated;
revoke all on function private.ruined_reconcile_active_block(uuid)
  from public, anon, authenticated;
revoke all on function private.ruined_reconcile_block_assignment_change()
  from public, anon, authenticated;
revoke all on function private.ruined_reconcile_block_circle_status()
  from public, anon, authenticated;
revoke all on function private.ruined_preserve_block_assignment_history()
  from public, anon, authenticated;

commit;
