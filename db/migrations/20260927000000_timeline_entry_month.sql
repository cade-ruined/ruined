begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Existing year-only entries and immutable history keep an unknown month.
-- No dates are inferred or backfilled, and existing privacy policies remain.
alter table public.member_timeline_entries
  add column entry_month integer check (entry_month between 1 and 12);
alter table public.member_timeline_entry_versions
  add column entry_month integer check (entry_month between 1 and 12);

create or replace function private.ruined_version_timeline_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.member_id is distinct from old.member_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Timeline entry identity fields are immutable.';
    end if;
    if new.entry_year is not distinct from old.entry_year
       and new.entry_month is not distinct from old.entry_month
       and new.title is not distinct from old.title
       and new.details is not distinct from old.details
       and new.position is not distinct from old.position
       and new.status is not distinct from old.status then
      return new;
    end if;
    if old.status = 'deleted' then
      raise exception 'A deleted Timeline entry is immutable.';
    end if;
    new.current_version := old.current_version + 1;
    new.updated_at := statement_timestamp();
    if new.status = 'deleted' then
      new.deleted_at := coalesce(new.deleted_at, statement_timestamp());
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.ruined_record_timeline_entry_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.current_version = old.current_version then
    return new;
  end if;

  insert into public.member_timeline_entry_versions (
    timeline_entry_id,
    member_id,
    version,
    action,
    entry_year,
    entry_month,
    title,
    details,
    position,
    actor_auth_user_id,
    occurred_at
  ) values (
    new.id,
    new.member_id,
    new.current_version,
    case
      when tg_op = 'INSERT' then 'created'
      when new.status = 'deleted' then 'deleted'
      else 'updated'
    end,
    new.entry_year,
    new.entry_month,
    new.title,
    new.details,
    new.position,
    new.updated_by_auth_user_id,
    new.updated_at
  );
  return new;
end;
$$;

commit;
