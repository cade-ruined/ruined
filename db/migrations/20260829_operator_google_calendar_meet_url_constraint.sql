begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- The original constraint used a regular-expression literal whose escaping
-- was interpreted differently by Postgres than intended. Prefer an exact
-- HTTPS host prefix here; the application also parses the URL and requires
-- url.hostname = 'meet.google.com' before persisting it.
alter table public.experience_calendar_links
  drop constraint if exists experience_calendar_links_meet_url_check;

alter table public.experience_calendar_links
  add constraint experience_calendar_links_meet_url_check
  check (
    meet_url is null
    or (
      char_length(btrim(meet_url)) between 25 and 2048
      and meet_url like 'https://meet.google.com/%'
    )
  ) not valid;

alter table public.experience_calendar_links
  validate constraint experience_calendar_links_meet_url_check;

comment on constraint experience_calendar_links_meet_url_check
  on public.experience_calendar_links is
  'Allows only HTTPS Google Meet URLs already hostname-validated by the Calendar adapter.';

commit;
