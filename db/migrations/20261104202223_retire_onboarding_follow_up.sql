begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Onboarding completion retains its milestone and welcome notification, without
-- creating an operator follow-up obligation.
create or replace function private.ruined_queue_onboarding_completion_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_person_id uuid;
  event_id uuid;
  event_dedupe_key text;
begin
  if new.state <> 'completed'
     or (tg_op = 'UPDATE' and old.state = 'completed') then
    return new;
  end if;

  select member.person_id into member_person_id
  from public.ruined_members member
  where member.id = new.member_id;

  event_dedupe_key :=
    'member-onboarding-completed:' || new.member_id::text || ':v' || new.version::text;

  insert into public.domain_events (
    aggregate_type,
    aggregate_id,
    event_type,
    person_id,
    member_id,
    payload,
    occurred_at,
    dedupe_key
  ) values (
    'member_onboarding',
    new.member_id::text,
    'membership.administrative_onboarding_completed',
    member_person_id,
    new.member_id,
    jsonb_build_object('onboarding_version', new.version),
    new.completed_at,
    event_dedupe_key
  ) on conflict (dedupe_key) do nothing
  returning id into event_id;

  if event_id is null then
    select existing_event.id into event_id
    from public.domain_events existing_event
    where existing_event.dedupe_key = event_dedupe_key;
  end if;

  insert into public.member_milestones (
    member_id,
    person_id,
    milestone_type,
    title,
    occurred_at,
    source_entity_type,
    source_entity_id,
    evidence,
    dedupe_key
  ) values (
    new.member_id,
    member_person_id,
    'membership.administrative_onboarding_completed',
    'Membership onboarding complete',
    new.completed_at,
    'member_onboarding',
    new.member_id::text,
    jsonb_build_object('onboarding_version', new.version),
    'member-onboarding-milestone:' || new.member_id::text || ':v' || new.version::text
  ) on conflict (dedupe_key) do nothing;

  insert into public.workflow_actions (
    domain_event_id,
    action_type,
    target_type,
    target_id,
    payload,
    idempotency_key
  ) values
  (
    event_id,
    'send_notification',
    'member',
    new.member_id::text,
    jsonb_build_object(
      'member_id', new.member_id,
      'template_key', 'administrative_onboarding_completed',
      'notification_type', 'membership',
      'title', 'Welcome to My Ruined',
      'body', 'Your membership is ready. Begin Ruined Foundations when you are ready.',
      'action_label', 'Begin Foundations',
      'action_url', '/my/foundations'
    ),
    'notify-onboarding-completed:' || new.member_id::text || ':v' || new.version::text
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

revoke all on function private.ruined_queue_onboarding_completion_work()
  from public, anon, authenticated;

-- Stop queued retries and release any obsolete worker lease. Preserve successful
-- delivery history, including earlier task creation, exactly as it was recorded.
update public.workflow_actions
set status = 'cancelled',
    last_error = 'onboarding_follow_up_retired',
    locked_at = null,
    locked_by = null,
    completed_at = statement_timestamp(),
    updated_at = statement_timestamp()
where action_type = 'create_operator_task'
  and payload ->> 'task_type' = 'onboarding.follow_up'
  and status in ('pending', 'failed', 'processing', 'dead_letter');

-- This obligation is retired, not completed. Keep completed/cancelled task
-- history and append a system event for each outstanding task we cancel.
with retiring as (
  select id, status
  from public.operator_tasks
  where task_type = 'onboarding.follow_up'
    and status in ('open', 'in_progress', 'blocked')
  for update
), cancelled as (
  update public.operator_tasks task
  set status = 'cancelled',
      due_at = null,
      completed_at = null,
      blocked_reason = null,
      version = task.version + 1,
      updated_at = statement_timestamp()
  from retiring
  where task.id = retiring.id
  returning task.id, retiring.status as previous_status, task.version
)
insert into public.operator_task_events (
  operator_task_id, event_type, previous_status, next_status,
  actor_type, actor_auth_user_id, evidence, dedupe_key
)
select id, 'cancelled', previous_status, 'cancelled', 'system', null,
  jsonb_build_object(
    'reason', 'onboarding_follow_up_retired',
    'task_type', 'onboarding.follow_up'
  ),
  'retired-onboarding-follow-up:' || id::text || ':v' || version::text
from cancelled
on conflict (dedupe_key) do nothing;

commit;
