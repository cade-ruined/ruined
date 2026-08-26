begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

create table if not exists public.member_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body_text text not null,
  image_storage_path text,
  action_label text,
  action_url text,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published', 'archived', 'cancelled')),
  scheduled_for timestamptz,
  published_at timestamptz,
  archived_at timestamptz,
  created_by_auth_user_id uuid not null
    references public.platform_users(auth_user_id) on delete restrict,
  updated_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (char_length(btrim(title)) between 1 and 200),
  check (char_length(body_text) between 1 and 10000),
  check ((action_label is null) = (action_url is null)),
  check (status <> 'scheduled' or scheduled_for is not null),
  check (status <> 'published' or published_at is not null),
  check (status <> 'archived' or archived_at is not null)
);

create index if not exists member_announcements_delivery_idx
  on public.member_announcements(status, scheduled_for, published_at desc);
create index if not exists member_announcements_creator_idx
  on public.member_announcements(created_by_auth_user_id);
create index if not exists member_announcements_updater_idx
  on public.member_announcements(updated_by_auth_user_id);

create table if not exists public.member_announcement_targets (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null
    references public.member_announcements(id) on delete restrict,
  target_type text not null
    check (target_type in ('all_active_members', 'circle', 'block', 'progression', 'member')),
  circle_id uuid references public.circles(id) on delete restrict,
  block_id uuid references public.membership_blocks(id) on delete restrict,
  progression_level_slug text
    references public.membership_progression_levels(slug) on delete restrict,
  member_id uuid references public.ruined_members(id) on delete restrict,
  created_by_auth_user_id uuid not null
    references public.platform_users(auth_user_id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  check (
    (target_type = 'all_active_members' and circle_id is null and block_id is null and progression_level_slug is null and member_id is null)
    or (target_type = 'circle' and circle_id is not null and block_id is null and progression_level_slug is null and member_id is null)
    or (target_type = 'block' and circle_id is null and block_id is not null and progression_level_slug is null and member_id is null)
    or (target_type = 'progression' and circle_id is null and block_id is null and progression_level_slug is not null and member_id is null)
    or (target_type = 'member' and circle_id is null and block_id is null and progression_level_slug is null and member_id is not null)
  )
);

create unique index if not exists member_announcement_targets_scope_idx
  on public.member_announcement_targets(
    announcement_id,
    target_type,
    coalesce(circle_id::text, block_id::text, progression_level_slug, member_id::text, '*')
  );
create index if not exists member_announcement_targets_circle_idx
  on public.member_announcement_targets(circle_id, announcement_id);
create index if not exists member_announcement_targets_block_idx
  on public.member_announcement_targets(block_id, announcement_id);
create index if not exists member_announcement_targets_progression_idx
  on public.member_announcement_targets(progression_level_slug, announcement_id);
create index if not exists member_announcement_targets_member_idx
  on public.member_announcement_targets(member_id, announcement_id);
create index if not exists member_announcement_targets_creator_idx
  on public.member_announcement_targets(created_by_auth_user_id);

create table if not exists public.member_notifications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete restrict,
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  announcement_id uuid
    references public.member_announcements(id) on delete restrict,
  notification_type text not null
    check (notification_type in ('announcement', 'reminder', 'membership', 'circle', 'foundations', 'artifact', 'system')),
  channel text not null default 'in_app'
    check (channel in ('in_app', 'email', 'sms', 'push')),
  title_snapshot text not null,
  body_snapshot text not null,
  image_storage_path_snapshot text,
  action_label_snapshot text,
  action_url_snapshot text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'failed', 'cancelled')),
  scheduled_for timestamptz not null default statement_timestamp(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  dismissed_at timestamptz,
  last_error text,
  dedupe_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (member_id, person_id)
    references public.ruined_members(id, person_id) on delete restrict,
  check (char_length(btrim(title_snapshot)) between 1 and 200),
  check (char_length(body_snapshot) between 1 and 10000),
  check ((action_label_snapshot is null) = (action_url_snapshot is null)),
  check (sent_at is null or sent_at >= scheduled_for),
  check (delivered_at is null or sent_at is null or delivered_at >= sent_at),
  check (read_at is null or delivered_at is null or read_at >= delivered_at),
  check (dismissed_at is null or dismissed_at >= scheduled_for)
);

create index if not exists member_notifications_delivery_idx
  on public.member_notifications(status, scheduled_for, created_at)
  where status in ('queued', 'failed');
create index if not exists member_notifications_person_idx
  on public.member_notifications(person_id, created_at desc);
create index if not exists member_notifications_member_idx
  on public.member_notifications(member_id, created_at desc);
create index if not exists member_notifications_announcement_idx
  on public.member_notifications(announcement_id, created_at desc);
create index if not exists member_notifications_unread_idx
  on public.member_notifications(member_id, created_at desc)
  where read_at is null and dismissed_at is null;

create table if not exists public.member_notification_events (
  id bigint generated always as identity primary key,
  notification_id uuid not null
    references public.member_notifications(id) on delete restrict,
  event_type text not null
    check (event_type in ('queued', 'sent', 'delivered', 'failed', 'read', 'dismissed', 'cancelled')),
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  provider_reference text,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  dedupe_key text not null unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp()
);

create index if not exists member_notification_events_notification_idx
  on public.member_notification_events(notification_id, occurred_at desc);
create index if not exists member_notification_events_actor_idx
  on public.member_notification_events(actor_auth_user_id);

create table if not exists public.operator_member_notes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  note_type text not null
    check (note_type in ('general', 'outreach', 'support', 'risk', 'logistics', 'circle')),
  body_text text not null,
  occurred_at timestamptz not null default statement_timestamp(),
  authored_by_auth_user_id uuid not null
    references public.platform_users(auth_user_id) on delete restrict,
  source text not null default 'operator'
    check (source in ('operator', 'system', 'import')),
  dedupe_key text unique,
  created_at timestamptz not null default statement_timestamp(),
  check (char_length(body_text) between 1 and 10000)
);

create index if not exists operator_member_notes_member_idx
  on public.operator_member_notes(member_id, occurred_at desc);
create index if not exists operator_member_notes_author_idx
  on public.operator_member_notes(authored_by_auth_user_id, occurred_at desc);
create index if not exists operator_member_notes_type_idx
  on public.operator_member_notes(note_type, occurred_at desc);

create table if not exists public.operator_member_note_redactions (
  id uuid primary key default gen_random_uuid(),
  operator_member_note_id uuid not null unique
    references public.operator_member_notes(id) on delete restrict,
  reason text not null,
  redacted_by_auth_user_id uuid not null
    references public.platform_users(auth_user_id) on delete restrict,
  redacted_at timestamptz not null default statement_timestamp(),
  replacement_text text not null default '[redacted]',
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  check (char_length(btrim(reason)) between 3 and 2000),
  check (char_length(replacement_text) between 1 and 100)
);

create index if not exists operator_member_note_redactions_actor_idx
  on public.operator_member_note_redactions(redacted_by_auth_user_id);

create table if not exists public.operator_tasks (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.ruined_members(id) on delete restrict,
  person_id uuid references public.people(id) on delete restrict,
  circle_id uuid references public.circles(id) on delete restrict,
  block_id uuid references public.membership_blocks(id) on delete restrict,
  task_type text not null,
  title text not null,
  description text,
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled')),
  assigned_to_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  created_by_type text not null default 'operator'
    check (created_by_type in ('operator', 'system')),
  created_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete restrict,
  due_at timestamptz,
  completed_at timestamptz,
  blocked_reason text,
  idempotency_key text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (member_id, person_id)
    references public.ruined_members(id, person_id) on delete restrict,
  check (task_type ~ '^[a-z][a-z0-9_.]*$'),
  check (char_length(btrim(title)) between 1 and 200),
  check (description is null or char_length(description) <= 5000),
  check (blocked_reason is null or char_length(blocked_reason) <= 2000),
  check (status <> 'completed' or completed_at is not null),
  check (
    (created_by_type = 'operator' and created_by_auth_user_id is not null)
    or (created_by_type = 'system' and created_by_auth_user_id is null)
  )
);

create index if not exists operator_tasks_queue_idx
  on public.operator_tasks(status, priority, due_at, created_at);
create index if not exists operator_tasks_assignee_idx
  on public.operator_tasks(assigned_to_auth_user_id, status, due_at);
create index if not exists operator_tasks_member_idx
  on public.operator_tasks(member_id, status, due_at);
create index if not exists operator_tasks_person_idx
  on public.operator_tasks(person_id, status, due_at);
create index if not exists operator_tasks_circle_idx
  on public.operator_tasks(circle_id, status, due_at);
create index if not exists operator_tasks_block_idx
  on public.operator_tasks(block_id, status, due_at);
create index if not exists operator_tasks_creator_idx
  on public.operator_tasks(created_by_auth_user_id);
create unique index if not exists operator_tasks_idempotency_idx
  on public.operator_tasks(idempotency_key)
  where idempotency_key is not null;

create table if not exists public.operator_task_events (
  id bigint generated always as identity primary key,
  operator_task_id uuid not null
    references public.operator_tasks(id) on delete restrict,
  event_type text not null
    check (event_type in ('created', 'assigned', 'state_changed', 'commented', 'completed', 'cancelled')),
  previous_status text,
  next_status text,
  actor_type text not null default 'operator'
    check (actor_type in ('operator', 'system')),
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete restrict,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  dedupe_key text unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  check (
    (actor_type = 'operator' and actor_auth_user_id is not null)
    or (actor_type = 'system' and actor_auth_user_id is null)
  )
);

create index if not exists operator_task_events_task_idx
  on public.operator_task_events(operator_task_id, occurred_at desc);
create index if not exists operator_task_events_actor_idx
  on public.operator_task_events(actor_auth_user_id, occurred_at desc);

-- Overrides are immutable applied/revoked events. Billing, agreements, and
-- Foundations completion are intentionally absent from the dimension allowlist.
create table if not exists public.member_state_overrides (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  action text not null check (action in ('applied', 'revoked')),
  dimension text not null
    check (dimension in ('account', 'admission', 'administrative_onboarding', 'standing', 'program', 'artifact', 'progression')),
  previous_value text,
  override_value text,
  reason text not null,
  expires_at timestamptz,
  supersedes_override_id uuid
    references public.member_state_overrides(id) on delete restrict,
  actor_auth_user_id uuid not null
    references public.platform_users(auth_user_id) on delete restrict,
  correlation_id text,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  dedupe_key text not null unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  check (char_length(btrim(reason)) between 3 and 2000),
  check (
    (action = 'applied' and override_value is not null and supersedes_override_id is null)
    or (action = 'revoked' and supersedes_override_id is not null)
  ),
  check (expires_at is null or expires_at > occurred_at)
);

create index if not exists member_state_overrides_member_idx
  on public.member_state_overrides(member_id, dimension, occurred_at desc);
create index if not exists member_state_overrides_actor_idx
  on public.member_state_overrides(actor_auth_user_id, occurred_at desc);
create index if not exists member_state_overrides_supersedes_idx
  on public.member_state_overrides(supersedes_override_id);
create index if not exists member_state_overrides_expiry_idx
  on public.member_state_overrides(expires_at)
  where action = 'applied' and expires_at is not null;

create table if not exists public.operator_audit_events (
  id bigint generated always as identity primary key,
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  action text not null,
  subject_type text not null,
  subject_id text not null,
  member_id uuid references public.ruined_members(id) on delete restrict,
  request_id text,
  reason text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  dedupe_key text unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  check (action ~ '^[a-z][a-z0-9_.]*$'),
  check (subject_type ~ '^[a-z][a-z0-9_.]*$'),
  check (before_snapshot is null or jsonb_typeof(before_snapshot) = 'object'),
  check (after_snapshot is null or jsonb_typeof(after_snapshot) = 'object')
);

create index if not exists operator_audit_events_actor_idx
  on public.operator_audit_events(actor_auth_user_id, occurred_at desc);
create index if not exists operator_audit_events_subject_idx
  on public.operator_audit_events(subject_type, subject_id, occurred_at desc);
create index if not exists operator_audit_events_member_idx
  on public.operator_audit_events(member_id, occurred_at desc);
create index if not exists operator_audit_events_request_idx
  on public.operator_audit_events(request_id)
  where request_id is not null;

create or replace function private.ruined_validate_state_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_override public.member_state_overrides%rowtype;
begin
  if new.action = 'revoked' then
    select prior.*
    into prior_override
    from public.member_state_overrides prior
    where prior.id = new.supersedes_override_id;

    if prior_override.id is null
       or prior_override.action <> 'applied'
       or prior_override.member_id <> new.member_id
       or prior_override.dimension <> new.dimension then
      raise exception 'Revocation must reference an applied override for the same member and dimension.';
    end if;

    if exists (
      select 1 from public.member_state_overrides revocation
      where revocation.action = 'revoked'
        and revocation.supersedes_override_id = prior_override.id
    ) then
      raise exception 'The override has already been revoked.';
    end if;
  end if;

  if new.action = 'applied' then
    if new.dimension = 'account' and new.override_value not in ('provisional', 'invited', 'active', 'suspended', 'closed') then
      raise exception 'Invalid account override value.';
    elsif new.dimension = 'admission' and new.override_value not in ('interested', 'applied', 'invited', 'accepted', 'declined', 'withdrawn') then
      raise exception 'Invalid admission override value.';
    elsif new.dimension = 'administrative_onboarding' and new.override_value not in ('not_started', 'in_progress', 'completed') then
      raise exception 'Invalid administrative onboarding override value.';
    elsif new.dimension = 'standing' and new.override_value not in ('pre_active', 'active', 'paused', 'cancellation_requested', 'inactive', 'alumni') then
      raise exception 'Invalid standing override value.';
    elsif new.dimension = 'program' and new.override_value not in ('prospect', 'onboarding', 'active', 'paused', 'completed', 'withdrawn') then
      raise exception 'Invalid program override value.';
    elsif new.dimension = 'artifact' and new.override_value not in ('not_started', 'collecting', 'in_production', 'fulfilled') then
      raise exception 'Invalid artifact override value.';
    elsif new.dimension = 'progression' and not exists (
      select 1 from public.membership_progression_levels level_record
      where level_record.slug = new.override_value
        and level_record.status = 'active'
    ) then
      raise exception 'Invalid progression override value.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists member_state_overrides_validate
  on public.member_state_overrides;
create trigger member_state_overrides_validate
before insert on public.member_state_overrides
for each row execute function private.ruined_validate_state_override();

revoke all on function private.ruined_validate_state_override()
  from public, anon, authenticated;

drop trigger if exists member_notification_events_append_only
  on public.member_notification_events;
create trigger member_notification_events_append_only
before update or delete on public.member_notification_events
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists operator_member_notes_append_only
  on public.operator_member_notes;
create trigger operator_member_notes_append_only
before update or delete on public.operator_member_notes
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists operator_member_note_redactions_append_only
  on public.operator_member_note_redactions;
create trigger operator_member_note_redactions_append_only
before update or delete on public.operator_member_note_redactions
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists operator_task_events_append_only
  on public.operator_task_events;
create trigger operator_task_events_append_only
before update or delete on public.operator_task_events
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists member_state_overrides_append_only
  on public.member_state_overrides;
create trigger member_state_overrides_append_only
before update or delete on public.member_state_overrides
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists operator_audit_events_append_only
  on public.operator_audit_events;
create trigger operator_audit_events_append_only
before update or delete on public.operator_audit_events
for each row execute function public.ruined_reject_append_only_mutation();

alter table public.member_announcements enable row level security;
alter table public.member_announcement_targets enable row level security;
alter table public.member_notifications enable row level security;
alter table public.member_notification_events enable row level security;
alter table public.operator_member_notes enable row level security;
alter table public.operator_member_note_redactions enable row level security;
alter table public.operator_tasks enable row level security;
alter table public.operator_task_events enable row level security;
alter table public.member_state_overrides enable row level security;
alter table public.operator_audit_events enable row level security;

revoke all on table
  public.member_announcements,
  public.member_announcement_targets,
  public.member_notifications,
  public.member_notification_events,
  public.operator_member_notes,
  public.operator_member_note_redactions,
  public.operator_tasks,
  public.operator_task_events,
  public.member_state_overrides,
  public.operator_audit_events
from public, anon, authenticated;

grant select on table
  public.member_announcements,
  public.member_notifications
to authenticated;

create or replace function private.ruined_can_read_announcement(requested_announcement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.member_announcements announcement
    join public.member_announcement_targets target
      on target.announcement_id = announcement.id
    where announcement.id = requested_announcement_id
      and announcement.status = 'published'
      and (
        (target.target_type = 'all_active_members'
          and private.ruined_current_active_access_member_id() is not null)
        or (target.target_type = 'member'
          and target.member_id = private.ruined_current_membership_id())
        or (target.target_type = 'circle' and exists (
          select 1 from public.circle_member_assignments assignment
          where assignment.circle_id = target.circle_id
            and assignment.member_id = private.ruined_current_active_access_member_id()
            and assignment.ended_at is null
        ))
        or (target.target_type = 'block' and exists (
          select 1 from public.circle_member_assignments circle_assignment
          join public.block_circle_assignments block_assignment
            on block_assignment.circle_id = circle_assignment.circle_id
            and block_assignment.ended_at is null
          where block_assignment.block_id = target.block_id
            and circle_assignment.member_id = private.ruined_current_active_access_member_id()
            and circle_assignment.ended_at is null
        ))
        or (target.target_type = 'progression' and exists (
          select 1 from public.member_lifecycle lifecycle
          where lifecycle.member_id = private.ruined_current_active_access_member_id()
            and lifecycle.current_progression_level_slug = target.progression_level_slug
        ))
      )
  )
$$;

revoke all on function private.ruined_can_read_announcement(uuid)
  from public, anon, authenticated;
grant execute on function private.ruined_can_read_announcement(uuid)
  to authenticated;

create policy member_announcements_select_entitled
on public.member_announcements for select
to authenticated
using (private.ruined_can_read_announcement(id));

create policy member_notifications_select_self
on public.member_notifications for select
to authenticated
using (person_id = private.ruined_current_person_id());

comment on table public.operator_member_notes is
  'Append-only operator context. Private Foundations submissions, Timeline details, and Future Letter content do not belong here.';
comment on table public.member_state_overrides is
  'Audited override evidence. Billing, agreement acceptance, and Foundations completion cannot be overridden.';
comment on table public.operator_audit_events is
  'Append-only audit ledger for sensitive operator reads and writes.';

commit;
