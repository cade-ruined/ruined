begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Existing awards start unseen. Preserve every award and its original earned
-- timestamp; acknowledgement records only the owner's first dismissal.
alter table public.member_badge_awards
  add column acknowledged_at timestamptz check (acknowledged_at is null or isfinite(acknowledged_at));

comment on column public.member_badge_awards.acknowledged_at is
  'First authenticated owner acknowledgement of the earned-badge celebration; null means unseen across devices.';

commit;
