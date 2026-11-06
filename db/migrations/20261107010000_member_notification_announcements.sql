begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Existing inbox history must never turn into a queue of login popups.
alter table public.member_notifications
  add column show_on_next_visit boolean not null default false,
  add column announcement_dismissed_at timestamptz;
alter table public.operator_notification_dispatches
  add column show_on_next_visit boolean not null default false;

create index member_notifications_pending_announcement_idx
  on public.member_notifications(member_id, created_at desc, id desc)
  where show_on_next_visit and announcement_dismissed_at is null
    and read_at is null and dismissed_at is null
    and channel = 'in_app' and status = 'delivered';

comment on column public.member_notifications.announcement_dismissed_at is
  'Acknowledges only the next-visit announcement. Does not remove the inbox item or mark it read.';
comment on column public.member_notifications.show_on_next_visit is
  'Explicitly selected for a one-time member announcement; false for all historical notifications.';

commit;
