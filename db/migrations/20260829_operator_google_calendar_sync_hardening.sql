begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- A Calendar ID such as "primary" is only meaningful together with the
-- delegated Workspace user. Keep that organizer identity on every link so a
-- later environment change cannot silently operate on a different calendar.
alter table public.experience_calendar_links
  add column if not exists organizer_email text;

update public.experience_calendar_links
set organizer_email = 'connect@theruinedproject.com'
where organizer_email is null;

alter table public.experience_calendar_links
  alter column organizer_email set not null;

alter table public.experience_calendar_links
  drop constraint if exists experience_calendar_links_organizer_email_check;
alter table public.experience_calendar_links
  add constraint experience_calendar_links_organizer_email_check
  check (
    organizer_email = lower(btrim(organizer_email))
    and char_length(organizer_email) between 3 and 320
    and organizer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

drop index if exists public.experience_calendar_links_provider_event_idx;
create unique index experience_calendar_links_provider_event_idx
  on public.experience_calendar_links(
    provider,
    organizer_email,
    organizer_calendar_id,
    provider_event_id
  )
  where provider_event_id is not null;

create or replace function private.ruined_guard_experience_calendar_link_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Experience calendar links cannot be deleted.';
  end if;

  if new.id is distinct from old.id
     or new.experience_id is distinct from old.experience_id
     or new.provider is distinct from old.provider
     or new.organizer_email is distinct from old.organizer_email
     or new.organizer_calendar_id is distinct from old.organizer_calendar_id
     or new.created_by_auth_user_id is distinct from old.created_by_auth_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Experience calendar link identity is immutable.';
  end if;

  if new.version <> old.version + 1 then
    raise exception 'Experience calendar link version must increase by exactly one.';
  end if;

  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'A cancelled Google Calendar link cannot be reactivated.';
  end if;

  return new;
end;
$$;

revoke all on function private.ruined_guard_experience_calendar_link_mutation()
  from public, anon, authenticated;

comment on column public.experience_calendar_links.organizer_email is
  'Immutable delegated Google Workspace organizer paired with organizer_calendar_id.';

commit;
