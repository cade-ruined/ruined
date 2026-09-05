begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Unknown historical mode is intentionally NOT inferred from the deployment.
alter table public.experience_calendar_links
  add column if not exists livemode boolean,
  add column if not exists reconcile_attempt_count integer not null default 0 check (reconcile_attempt_count >= 0),
  add column if not exists next_reconcile_at timestamptz not null default statement_timestamp();

create index if not exists experience_calendar_links_reconcile_due_idx
  on public.experience_calendar_links(livemode, next_reconcile_at, id)
  where status in ('pending_create', 'pending_update', 'pending_cancel', 'failed');

create or replace function private.ruined_guard_calendar_delivery_mode()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.livemode is not null and new.livemode is distinct from old.livemode then
    raise exception 'A Calendar delivery mode cannot change after binding.';
  end if;
  return new;
end;
$$;
revoke all on function private.ruined_guard_calendar_delivery_mode() from public, anon, authenticated;
drop trigger if exists experience_calendar_delivery_mode_guard on public.experience_calendar_links;
create trigger experience_calendar_delivery_mode_guard
before update on public.experience_calendar_links
for each row execute function private.ruined_guard_calendar_delivery_mode();
alter table public.experience_calendar_links enable row level security;
revoke all on public.experience_calendar_links from public, anon, authenticated;
comment on column public.experience_calendar_links.livemode is
  'Immutable delivery mode. NULL legacy links are blocked until an authorized operator verifies the provider organizer and explicitly binds the intended mode.';
comment on column public.experience_calendar_links.next_reconcile_at is
  'Durable background reconciliation retry time; provider calls run after the reservation transaction commits.';
commit;
