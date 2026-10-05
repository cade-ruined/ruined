begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- A saved-card consent is a review obligation, never permission to charge.
-- Keep every obligation's task identity so polling cannot recreate a review an
-- operator already completed. A genuinely new saved-card consent gets its own
-- review; older task events remain in the existing append-only task ledger.
create table if not exists public.registration_operator_work (
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  payment_setup_attempt_id uuid not null references public.member_payment_method_setup_attempts(id) on delete restrict,
  operator_task_id uuid not null unique references public.operator_tasks(id) on delete restrict,
  resolution_reason text check (resolution_reason in (
    'billing_active', 'saved_method_replaced', 'billing_owner_changed', 'registration_no_longer_eligible'
  )),
  resolved_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (member_id, payment_setup_attempt_id),
  check ((resolved_at is null) = (resolution_reason is null))
);
alter table public.registration_operator_work enable row level security;
revoke all on public.registration_operator_work from public, anon, authenticated;

create unique index if not exists operator_tasks_registration_billing_live_member
  on public.operator_tasks(member_id)
  where task_type = 'registration.billing_review' and status in ('open', 'in_progress', 'blocked');

create or replace function private.ruined_guard_registration_operator_work()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Registration work history must be retained.'; end if;
  if tg_op = 'UPDATE' and (new.member_id is distinct from old.member_id
    or new.payment_setup_attempt_id is distinct from old.payment_setup_attempt_id
    or new.operator_task_id is distinct from old.operator_task_id
    or new.created_at is distinct from old.created_at) then
    raise exception 'Registration work identity is immutable.';
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from public.member_payment_method_setup_attempts attempt
    join public.operator_tasks task on task.id = new.operator_task_id
      and task.member_id = attempt.member_id and task.task_type = 'registration.billing_review'
      and task.created_by_type = 'system'
    where attempt.id = new.payment_setup_attempt_id and attempt.member_id = new.member_id
  ) then raise exception 'Registration work must match its member, saved-card attempt and system task.'; end if;
  return new;
end
$$;
drop trigger if exists registration_operator_work_identity on public.registration_operator_work;
create trigger registration_operator_work_identity before insert or update or delete on public.registration_operator_work
  for each row execute function private.ruined_guard_registration_operator_work();
revoke all on function private.ruined_guard_registration_operator_work() from public, anon, authenticated;

comment on table public.registration_operator_work is 'Internal durable registration billing-review obligations. Reconciled by the server worker; migration does not backfill tasks, charge members, activate profiles or send messages.';
commit;
