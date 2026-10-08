begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- One durable operator obligation per registration checkpoint. A payment
-- obligation exists before a saved-card attempt, and replacing a card cannot
-- recreate work an operator already completed. The old consent-based registry
-- remains untouched audit history; the server adopts its existing task IDs.
create table if not exists public.registration_checkpoint_work (
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  checkpoint text not null check (checkpoint in ('email','information','payment','profile','review')),
  operator_task_id uuid not null unique references public.operator_tasks(id) on delete restrict,
  resolution_reason text check (resolution_reason in ('checkpoint_satisfied','next_step_changed','member_no_longer_eligible')),
  resolved_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (member_id, checkpoint),
  check ((resolved_at is null) = (resolution_reason is null))
);
alter table public.registration_checkpoint_work enable row level security;
revoke all on public.registration_checkpoint_work from public, anon, authenticated;

create or replace function private.ruined_guard_registration_checkpoint_work()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Registration checkpoint history must be retained.'; end if;
  if tg_op = 'UPDATE' and (new.member_id is distinct from old.member_id
    or new.checkpoint is distinct from old.checkpoint
    or new.operator_task_id is distinct from old.operator_task_id
    or new.created_at is distinct from old.created_at) then
    raise exception 'Registration checkpoint identity is immutable.';
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from public.operator_tasks task
    where task.id = new.operator_task_id and task.member_id = new.member_id
      and task.created_by_type = 'system'
      and (task.task_type = 'registration.checkpoint.' || new.checkpoint
        or (new.checkpoint = 'payment' and task.task_type = 'registration.billing_review'
          and exists (select 1 from public.registration_operator_work legacy
            where legacy.operator_task_id = task.id and legacy.member_id = new.member_id)))
  ) then raise exception 'Registration checkpoint work must match its member and system task.'; end if;
  return new;
end
$$;
drop trigger if exists registration_checkpoint_work_identity on public.registration_checkpoint_work;
create trigger registration_checkpoint_work_identity before insert or update or delete on public.registration_checkpoint_work
  for each row execute function private.ruined_guard_registration_checkpoint_work();
revoke all on function private.ruined_guard_registration_checkpoint_work() from public, anon, authenticated;

comment on table public.registration_checkpoint_work is 'Private, durable enrollment follow-ups from canonical member checkpoints. Worker adoption preserves task IDs, claims and completion history. This migration does not backfill tasks, charge members, grant profiles or send messages.';
commit;
