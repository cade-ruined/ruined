begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

create table if not exists public.operator_notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique,
  request_fingerprint text not null,
  actor_auth_user_id uuid not null
    references public.platform_users(auth_user_id) on delete restrict,
  notification_type text not null
    check (notification_type in ('announcement', 'reminder', 'membership', 'circle', 'foundations', 'artifact', 'system')),
  target_type text not null
    check (target_type in ('all_active_members', 'circle', 'block', 'member')),
  target_id uuid,
  title_snapshot text not null,
  body_snapshot text not null,
  action_label_snapshot text,
  action_url_snapshot text,
  status text not null default 'processing'
    check (status in ('processing', 'completed')),
  recipient_count integer not null default 0
    check (recipient_count >= 0),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  check (char_length(request_key) between 16 and 200),
  check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  check (char_length(btrim(title_snapshot)) between 1 and 200),
  check (char_length(body_snapshot) between 1 and 10000),
  check ((action_label_snapshot is null) = (action_url_snapshot is null)),
  check (
    (target_type = 'all_active_members' and target_id is null)
    or (target_type in ('circle', 'block', 'member') and target_id is not null)
  ),
  check (
    (status = 'processing' and completed_at is null)
    or (status = 'completed' and completed_at is not null and recipient_count > 0)
  )
);

create index if not exists operator_notification_dispatches_actor_idx
  on public.operator_notification_dispatches(actor_auth_user_id, created_at desc);
create index if not exists operator_notification_dispatches_status_idx
  on public.operator_notification_dispatches(status, created_at)
  where status = 'processing';

alter table public.member_notifications
  add column if not exists operator_dispatch_id uuid
    references public.operator_notification_dispatches(id) on delete restrict;

create index if not exists member_notifications_operator_dispatch_idx
  on public.member_notifications(operator_dispatch_id, created_at desc)
  where operator_dispatch_id is not null;

alter table public.operator_notification_dispatches enable row level security;
revoke all on table public.operator_notification_dispatches
  from public, anon, authenticated;

-- Announcements and direct notifications share one entitlement boundary:
-- the signed-in user must be an active member whose billing is active and
-- whose administrative onboarding is complete. The helper also enforces the
-- active role grant, standing, and cancellation-effective date.
create or replace function private.ruined_current_updates_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select member.id
  from public.platform_users platform_user
  join public.ruined_members member
    on member.person_id = platform_user.person_id
  join public.member_lifecycle lifecycle
    on lifecycle.member_id = member.id
  join public.platform_role_grants role_grant
    on role_grant.auth_user_id = platform_user.auth_user_id
    and role_grant.role_slug = 'member'
    and role_grant.revoked_at is null
  where platform_user.auth_user_id = private.ruined_current_auth_user_id()
    and platform_user.status = 'active'
    and lifecycle.account_state = 'active'
    and lifecycle.billing_state = 'active'
    and lifecycle.administrative_onboarding_state = 'completed'
    and (
      lifecycle.standing_state = 'active'
      or (
        lifecycle.standing_state = 'cancellation_requested'
        and lifecycle.cancellation_effective_at > statement_timestamp()
      )
    )
  limit 1
$$;

revoke all on function private.ruined_current_updates_member_id()
  from public, anon, authenticated;
grant execute on function private.ruined_current_updates_member_id()
  to authenticated;

create or replace function private.ruined_can_read_announcement(
  requested_announcement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with current_access as (
    select private.ruined_current_updates_member_id() as member_id
  )
  select exists (
    select 1
    from current_access access
    join public.member_announcements announcement
      on announcement.id = requested_announcement_id
    join public.member_announcement_targets target
      on target.announcement_id = announcement.id
    where access.member_id is not null
      and announcement.status = 'published'
      and announcement.published_at <= statement_timestamp()
      and (
        target.target_type = 'all_active_members'
        or (target.target_type = 'member'
          and target.member_id = access.member_id)
        or (target.target_type = 'circle' and exists (
          select 1
          from public.circle_member_assignments assignment
          where assignment.circle_id = target.circle_id
            and assignment.member_id = access.member_id
            and assignment.ended_at is null
        ))
        or (target.target_type = 'block' and exists (
          select 1
          from public.circle_member_assignments circle_assignment
          join public.block_circle_assignments block_assignment
            on block_assignment.circle_id = circle_assignment.circle_id
            and block_assignment.ended_at is null
          where block_assignment.block_id = target.block_id
            and circle_assignment.member_id = access.member_id
            and circle_assignment.ended_at is null
        ))
        or (target.target_type = 'progression' and exists (
          select 1
          from public.member_lifecycle lifecycle
          where lifecycle.member_id = access.member_id
            and lifecycle.current_progression_level_slug = target.progression_level_slug
        ))
      )
  )
$$;

revoke all on function private.ruined_can_read_announcement(uuid)
  from public, anon, authenticated;
grant execute on function private.ruined_can_read_announcement(uuid)
  to authenticated;

drop policy if exists member_announcements_select_entitled
  on public.member_announcements;
create policy member_announcements_select_entitled
on public.member_announcements for select
to authenticated
using ((select private.ruined_can_read_announcement(member_announcements.id)));

drop policy if exists member_notifications_select_self
  on public.member_notifications;
create policy member_notifications_select_self
on public.member_notifications for select
to authenticated
using (
  member_id = (select private.ruined_current_updates_member_id())
  and person_id = (select private.ruined_current_person_id())
);

comment on table public.operator_notification_dispatches is
  'Operator notification request ledger. request_key makes a logical send retry-safe; member_notification_events remain delivery evidence.';
comment on column public.member_notifications.operator_dispatch_id is
  'Groups direct operator-created notifications under the persisted request that produced them.';

commit;
