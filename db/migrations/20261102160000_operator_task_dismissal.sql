begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Dismissal only suppresses operator attention. Keep the underlying obligation,
-- ownership and idempotency key intact so system reconciliation still works.
alter table public.operator_tasks
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete restrict;
alter table public.operator_tasks
  drop constraint if exists operator_tasks_dismissal_actor_check;
alter table public.operator_tasks
  add constraint operator_tasks_dismissal_actor_check
  check ((dismissed_at is null) = (dismissed_by_auth_user_id is null));

create index if not exists operator_tasks_dismissed_queue_idx
  on public.operator_tasks(dismissed_at desc, id)
  where dismissed_at is not null and status in ('open', 'in_progress', 'blocked');

-- A registration checkpoint can reopen the same task after system resolution.
-- That is fresh work; ordinary active-state refreshes must stay dismissed.
create or replace function private.ruined_reset_reopened_task_dismissal()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('completed', 'cancelled')
    and new.status in ('open', 'in_progress', 'blocked') then
    new.dismissed_at := null;
    new.dismissed_by_auth_user_id := null;
  end if;
  return new;
end
$$;
drop trigger if exists operator_tasks_reset_reopened_dismissal on public.operator_tasks;
create trigger operator_tasks_reset_reopened_dismissal
  before update of status on public.operator_tasks
  for each row execute function private.ruined_reset_reopened_task_dismissal();
revoke all on function private.ruined_reset_reopened_task_dismissal() from public, anon, authenticated;

comment on column public.operator_tasks.dismissed_at is 'Attention dismissal, independent of obligation status. System resolution remains authoritative; a resolved task that genuinely reopens returns to attention.';
comment on column public.operator_tasks.dismissed_by_auth_user_id is 'Administrator who dismissed this task. Dismiss and restore actions are retained in append-only task events and audit records.';

commit;
