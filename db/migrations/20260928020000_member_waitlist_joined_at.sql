begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Shared by the public waitlist writer and the member badge system.
-- Attribution-only rows remain null until a genuine waitlist submission.
alter table public.membership_waitlist add column if not exists joined_waitlist_at timestamptz;
comment on column public.membership_waitlist.joined_waitlist_at is
  'First genuine public waitlist submission; null for invitation-attribution-only rows.';

commit;
