begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Completion is the reveal. The existing immutable Foundations completion
-- proof and lifecycle projection make a second reveal flag unnecessary.
create or replace function private.ruined_current_circle_is_revealed()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.member_lifecycle lifecycle
    where lifecycle.member_id = private.ruined_current_membership_id()
      and lifecycle.foundations_state = 'completed'
  );
$$;
revoke all on function private.ruined_current_circle_is_revealed() from public, anon, authenticated;
grant execute on function private.ruined_current_circle_is_revealed() to authenticated;

drop policy if exists circle_member_assignments_select_self on public.circle_member_assignments;
create policy circle_member_assignments_select_self on public.circle_member_assignments
for select to authenticated using (
  member_id = private.ruined_current_active_access_member_id()
  and private.ruined_current_circle_is_revealed()
);

drop policy if exists accountability_partner_assignments_select_self on public.accountability_partner_assignments;
create policy accountability_partner_assignments_select_self on public.accountability_partner_assignments
for select to authenticated using (
  private.ruined_current_active_access_member_id() in (member_one_id, member_two_id)
  and private.ruined_current_circle_is_revealed()
);

create or replace function private.ruined_current_active_access_block_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select block_assignment.block_id
  from public.circle_member_assignments member_assignment
  join public.block_circle_assignments block_assignment
    on block_assignment.circle_id = member_assignment.circle_id
    and block_assignment.ended_at is null
  where private.ruined_current_circle_is_revealed()
    and member_assignment.member_id = private.ruined_current_active_access_member_id()
    and member_assignment.ended_at is null
  order by block_assignment.assigned_at desc
  limit 1
$$;

create or replace function private.ruined_can_access_learning_resource(
  requested_learning_resource_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.learning_resources resource
    where resource.id = requested_learning_resource_id
      and resource.status = 'published'
      and (
        exists (
          select 1
          from public.learning_resource_targets target
          where target.learning_resource_id = resource.id
            and (
              (target.audience_type = 'all_members'
                and private.ruined_current_active_access_member_id() is not null)
              or (target.audience_type = 'circle' and private.ruined_current_circle_is_revealed() and exists (
                select 1 from public.circle_member_assignments assignment
                where assignment.circle_id = target.circle_id
                  and assignment.member_id = private.ruined_current_active_access_member_id()
                  and assignment.ended_at is null
              ))
              or (target.audience_type = 'block' and private.ruined_current_circle_is_revealed() and exists (
                select 1 from public.circle_member_assignments circle_assignment
                join public.block_circle_assignments block_assignment
                  on block_assignment.circle_id = circle_assignment.circle_id
                  and block_assignment.ended_at is null
                where block_assignment.block_id = target.block_id
                  and circle_assignment.member_id = private.ruined_current_active_access_member_id()
                  and circle_assignment.ended_at is null
              ))
              or (target.audience_type = 'progression' and exists (
                select 1 from public.member_lifecycle lifecycle
                where lifecycle.member_id = private.ruined_current_active_access_member_id()
                  and lifecycle.current_progression_level_slug = target.progression_level_slug
              ))
            )
        )
        or exists (
          select 1
          from public.circle_resources circle_resource
          join public.circle_member_assignments assignment
            on assignment.circle_id = circle_resource.circle_id
            and assignment.ended_at is null
          where private.ruined_current_circle_is_revealed()
            and circle_resource.learning_resource_id = resource.id
            and circle_resource.ended_at is null
            and assignment.member_id = private.ruined_current_active_access_member_id()
        )
      )
  )
$$;

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
        or (target.target_type = 'circle' and private.ruined_current_circle_is_revealed() and exists (
          select 1
          from public.circle_member_assignments assignment
          where assignment.circle_id = target.circle_id
            and assignment.member_id = access.member_id
            and assignment.ended_at is null
        ))
        or (target.target_type = 'block' and private.ruined_current_circle_is_revealed() and exists (
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

create or replace function private.ruined_queue_circle_assignment_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_person_id uuid;
  event_id uuid;
  event_dedupe_key text := 'circle-assignment-started:' || new.id::text;
begin
  if new.ended_at is not null then
    return new;
  end if;

  select member.person_id into member_person_id
  from public.ruined_members member
  where member.id = new.member_id;

  insert into public.domain_events (
    aggregate_type,
    aggregate_id,
    event_type,
    person_id,
    member_id,
    actor_auth_user_id,
    payload,
    occurred_at,
    dedupe_key
  ) values (
    'circle_member_assignment',
    new.id::text,
    'circle.member_assigned',
    member_person_id,
    new.member_id,
    new.assigned_by_auth_user_id,
    jsonb_build_object('circle_id', new.circle_id),
    new.assigned_at,
    event_dedupe_key
  ) on conflict (dedupe_key) do nothing
  returning id into event_id;

  if event_id is null then
    select existing_event.id into event_id
    from public.domain_events existing_event
    where existing_event.dedupe_key = event_dedupe_key;
  end if;

  insert into public.member_onboardings (
    member_id,
    state,
    form_version,
    requirements_snapshot,
    circle_assigned_at,
    started_at,
    completion_evidence
  ) values (
    new.member_id,
    'in_progress',
    'platform-v1',
    '{}'::jsonb,
    new.assigned_at,
    new.assigned_at,
    '{}'::jsonb
  )
  on conflict (member_id) do update
  set
    circle_assigned_at = coalesce(
      public.member_onboardings.circle_assigned_at,
      excluded.circle_assigned_at
    ),
    started_at = coalesce(public.member_onboardings.started_at, excluded.started_at),
    state = case
      when public.member_onboardings.state = 'not_started' then 'in_progress'
      else public.member_onboardings.state
    end,
    version = public.member_onboardings.version + 1,
    updated_at = statement_timestamp();

  insert into public.member_onboarding_events (
    member_id,
    event_type,
    field_name,
    actor_auth_user_id,
    evidence,
    dedupe_key,
    occurred_at
  ) values (
    new.member_id,
    'field_completed',
    'circle_assigned_at',
    new.assigned_by_auth_user_id,
    jsonb_build_object(
      'circle_id', new.circle_id,
      'circle_member_assignment_id', new.id
    ),
    'circle-onboarding-checkpoint:' || new.id::text,
    new.assigned_at
  ) on conflict (dedupe_key) do nothing;

  -- Approval is private until Foundations completes. The existing completion
  -- workflow then welcomes the member to their Circle; later transfers notify normally.
  if exists (select 1 from public.member_lifecycle lifecycle
    where lifecycle.member_id = new.member_id and lifecycle.foundations_state = 'completed') then
  insert into public.workflow_actions (
    domain_event_id,
    action_type,
    target_type,
    target_id,
    payload,
    idempotency_key
  ) values (
    event_id,
    'send_notification',
    'member',
    new.member_id::text,
    jsonb_build_object(
      'member_id', new.member_id,
      'circle_id', new.circle_id,
      'template_key', 'circle_assigned',
      'notification_type', 'circle',
      'title', 'Your Circle is ready',
      'body', 'Your Circle is now available in My Ruined.',
      'action_label', 'View your Circle',
      'action_url', '/my/circle'
    ),
    'notify-circle-assigned:' || new.id::text
  ) on conflict (idempotency_key) do nothing;

  end if;

  return new;
end;
$$;

-- Old snapshots remain in audit history. Evaluate dispatch scope inside a
-- definer helper so authenticated members need no access to the operator ledger.
create or replace function private.ruined_notification_circle_is_visible(
  requested_type text, requested_announcement_id uuid, requested_dispatch_id uuid
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.ruined_current_circle_is_revealed() or (
    requested_type <> 'circle'
    and (requested_announcement_id is null or private.ruined_can_read_announcement(requested_announcement_id))
    and (requested_dispatch_id is null or not exists (
      select 1 from public.operator_notification_dispatches dispatch
      where dispatch.id = requested_dispatch_id and dispatch.target_type in ('circle', 'block')
    ))
  );
$$;
revoke all on function private.ruined_notification_circle_is_visible(text, uuid, uuid) from public, anon, authenticated;
grant execute on function private.ruined_notification_circle_is_visible(text, uuid, uuid) to authenticated;

drop policy if exists member_notifications_circle_reveal on public.member_notifications;
create policy member_notifications_circle_reveal on public.member_notifications
as restrictive for select to authenticated using (
  private.ruined_notification_circle_is_visible(notification_type, announcement_id, operator_dispatch_id)
);

commit;
