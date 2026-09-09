begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));
lock table public.circles in share row exclusive mode;

-- Permit retirement of an empty, never-activated Circle without fake activation.
-- Retain the activation audit and Foundation completion-proof checks verbatim.
-- All assignment, event, resource, invitation and audit history stays intact.
-- Existing circles_active_block_reconcile handles parent Block status changes.
create or replace function private.ruined_guard_circle_activation_audit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invalidates_completion_proof boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'forming' then
      raise exception 'A Circle must be created as forming before activation.'
        using errcode = '23514';
    end if;

    if new.activated_by_auth_user_id is not null or new.activated_at is not null then
      raise exception 'A forming Circle cannot carry activation evidence.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  -- A retirement is not a member removal. Circle-row serialization matches
  -- assignment capacity guards, so no current roster may be stranded.
  if new.status = 'archived' and old.status <> 'archived' and exists (
    select 1 from public.circle_member_assignments
    where circle_id = old.id and ended_at is null
  ) then
    raise exception 'Move all members before archiving a Circle.' using errcode = '23514';
  end if;

  if old.status = 'forming' then
    if new.status not in ('forming', 'active', 'archived') then
      raise exception 'A forming Circle may only remain forming, become active, or be archived.'
        using errcode = '23514';
    end if;

    if new.status = 'forming' then
      if new.activated_by_auth_user_id is not null or new.activated_at is not null then
        raise exception 'A forming Circle cannot carry activation evidence.'
          using errcode = '23514';
      end if;

      return new;
    end if;

    if new.status = 'archived' then
      -- ruined_circle_retirement_v1: never invent activation to retire a draft.
      if new.id is distinct from old.id
        or new.starts_at is distinct from old.starts_at
        or old.activated_at is not null
        or old.activated_by_auth_user_id is not null
        or new.activated_at is not null
        or new.activated_by_auth_user_id is not null
      then
        raise exception 'Archiving a forming Circle must preserve its identity and unactivated history.'
          using errcode = '23514';
      end if;
    else
      if new.starts_at is null
        or new.starts_at > statement_timestamp()
        or new.activated_by_auth_user_id is null
      then
        raise exception 'Circle activation requires a start time and activation actor.'
          using errcode = '23514';
      end if;

      new.activated_at := statement_timestamp();
    end if;
  else
    if not (
      (old.status = 'active' and new.status in ('active', 'completed', 'archived'))
      or (old.status = 'completed' and new.status in ('completed', 'archived'))
      or (old.status = 'archived' and new.status = 'archived')
    ) then
      raise exception 'That Circle status transition is not allowed.'
        using errcode = '23514';
    end if;

    if new.activated_by_auth_user_id is distinct from old.activated_by_auth_user_id then
      raise exception 'Circle activation attribution is immutable.'
        using errcode = '23514';
    end if;

    if new.activated_at is distinct from old.activated_at then
      raise exception 'Circle activation time is immutable.'
        using errcode = '23514';
    end if;

    if new.starts_at is distinct from old.starts_at then
      raise exception 'A Circle start time is immutable after activation.'
        using errcode = '23514';
    end if;

    if old.status in ('completed', 'archived')
      and new.ends_at is distinct from old.ends_at
    then
      raise exception 'A completed Circle end time is immutable.'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'active'
    and new.ends_at is not null
    and new.ends_at < statement_timestamp()
  then
    raise exception 'An active Circle cannot have an elapsed end time.'
      using errcode = '23514';
  end if;

  if new.status in ('completed', 'archived') and (
    new.ends_at is null
    or new.ends_at > statement_timestamp()
    or new.ends_at < new.activated_at
  ) then
    raise exception 'A completed Circle requires a trustworthy end time.'
      using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.circle_member_assignments assignment
    join public.foundation_enrollments enrollment
      on enrollment.completion_circle_assignment_id = assignment.id
    where assignment.circle_id = old.id
      and enrollment.status = 'completed'
      and (
        new.id is distinct from old.id
        or new.starts_at is null
        or new.starts_at > enrollment.completed_at
        or new.activated_at is null
        or new.activated_at > enrollment.completed_at
        or not (
          (
            new.status = 'active'
            and (
              new.ends_at is null
              or new.ends_at >= enrollment.completed_at
            )
          )
          or (
            new.status in ('completed', 'archived')
            and new.ends_at is not null
            and new.ends_at >= enrollment.completed_at
          )
        )
      )
  ) into invalidates_completion_proof;

  if invalidates_completion_proof then
    raise exception 'A Circle cannot invalidate Foundation completion proof.'
      using
        errcode = '23514',
        constraint = 'foundation_enrollments_completion_proof_check';
  end if;

  return new;
end;
$$;

revoke all on function private.ruined_guard_circle_activation_audit()
  from public, anon, authenticated;

commit;
