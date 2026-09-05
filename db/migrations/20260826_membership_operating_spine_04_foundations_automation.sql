begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Member-authored Timeline data stays compact by contract: Year, Title, and
-- optional Details. Every edit produces an immutable version row.
create table if not exists public.member_timeline_entries (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  entry_year integer not null check (entry_year between 1900 and 2200),
  title text not null,
  details text,
  position integer not null default 1 check (position > 0),
  status text not null default 'active'
    check (status in ('active', 'deleted')),
  current_version integer not null default 1 check (current_version > 0),
  updated_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (char_length(btrim(title)) between 1 and 200),
  check (details is null or char_length(details) <= 4000),
  check ((status = 'deleted') = (deleted_at is not null))
);

create index if not exists member_timeline_entries_member_idx
  on public.member_timeline_entries(member_id, status, entry_year, position);
create index if not exists member_timeline_entries_updater_idx
  on public.member_timeline_entries(updated_by_auth_user_id);

create table if not exists public.member_timeline_entry_versions (
  id bigint generated always as identity primary key,
  timeline_entry_id uuid not null
    references public.member_timeline_entries(id) on delete restrict,
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  version integer not null check (version > 0),
  action text not null check (action in ('created', 'updated', 'deleted')),
  entry_year integer not null check (entry_year between 1900 and 2200),
  title text not null,
  details text,
  position integer not null check (position > 0),
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  unique (timeline_entry_id, version),
  check (char_length(btrim(title)) between 1 and 200),
  check (details is null or char_length(details) <= 4000)
);

create index if not exists member_timeline_entry_versions_member_idx
  on public.member_timeline_entry_versions(member_id, occurred_at desc);
create index if not exists member_timeline_entry_versions_actor_idx
  on public.member_timeline_entry_versions(actor_auth_user_id);

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
    new.title,
    new.details,
    new.position,
    new.updated_by_auth_user_id,
    new.updated_at
  );
  return new;
end;
$$;

drop trigger if exists member_timeline_entries_00_version
  on public.member_timeline_entries;
create trigger member_timeline_entries_00_version
before update on public.member_timeline_entries
for each row execute function private.ruined_version_timeline_entry();

drop trigger if exists member_timeline_entries_90_record_version
  on public.member_timeline_entries;
create trigger member_timeline_entries_90_record_version
after insert or update on public.member_timeline_entries
for each row execute function private.ruined_record_timeline_entry_version();

drop trigger if exists member_timeline_entry_versions_append_only
  on public.member_timeline_entry_versions;
create trigger member_timeline_entry_versions_append_only
before update or delete on public.member_timeline_entry_versions
for each row execute function public.ruined_reject_append_only_mutation();

revoke all on function private.ruined_version_timeline_entry()
  from public, anon, authenticated;
revoke all on function private.ruined_record_timeline_entry_version()
  from public, anon, authenticated;

-- These are completion markers only. No Future Letter body, file, or excerpt is
-- accepted by this table; the letter itself remains outside platform storage.
create table if not exists public.member_foundation_requirement_completions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  foundation_enrollment_id uuid not null
    references public.foundation_enrollments(id) on delete restrict,
  requirement_slug text not null
    check (requirement_slug in ('timeline', 'future_letter')),
  completion_version integer not null default 1 check (completion_version > 0),
  completed_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  completed_at timestamptz not null default statement_timestamp(),
  source text not null check (source in ('member', 'ops', 'system', 'migration')),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  supersedes_completion_id uuid
    references public.member_foundation_requirement_completions(id) on delete restrict,
  state text not null default 'completed'
    check (state in ('completed', 'revoked')),
  reason text,
  dedupe_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  unique (foundation_enrollment_id, requirement_slug, completion_version),
  check (reason is null or char_length(reason) <= 1000),
  check (
    requirement_slug <> 'future_letter'
    or not (evidence ?| array['content', 'body', 'text', 'letter', 'letter_body', 'excerpt', 'storage_path', 'url'])
  )
);

create index if not exists member_foundation_requirement_member_idx
  on public.member_foundation_requirement_completions(member_id, completed_at desc);
create index if not exists member_foundation_requirement_enrollment_idx
  on public.member_foundation_requirement_completions(
    foundation_enrollment_id,
    requirement_slug,
    completion_version desc
  );
create index if not exists member_foundation_requirement_actor_idx
  on public.member_foundation_requirement_completions(completed_by_auth_user_id);
create index if not exists member_foundation_requirement_supersedes_idx
  on public.member_foundation_requirement_completions(supersedes_completion_id);

create or replace function private.ruined_validate_foundation_requirement_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  enrollment_member_id uuid;
begin
  select enrollment.member_id
  into enrollment_member_id
  from public.foundation_enrollments enrollment
  where enrollment.id = new.foundation_enrollment_id;

  if enrollment_member_id is distinct from new.member_id then
    raise exception 'Foundation requirement completion does not belong to the enrollment member.';
  end if;

  if new.requirement_slug = 'timeline'
     and new.state = 'completed'
     and not exists (
       select 1
       from public.member_timeline_entries timeline_entry
       where timeline_entry.member_id = new.member_id
         and timeline_entry.status = 'active'
     ) then
    raise exception 'At least one active Timeline entry is required for Timeline completion.';
  end if;

  if new.state = 'revoked' and new.supersedes_completion_id is null then
    raise exception 'A revoked requirement marker must supersede a completion.';
  end if;

  if new.supersedes_completion_id is not null and not exists (
    select 1
    from public.member_foundation_requirement_completions prior
    where prior.id = new.supersedes_completion_id
      and prior.member_id = new.member_id
      and prior.foundation_enrollment_id = new.foundation_enrollment_id
      and prior.requirement_slug = new.requirement_slug
      and prior.completion_version < new.completion_version
  ) then
    raise exception 'The superseded requirement marker is incompatible.';
  end if;

  return new;
end;
$$;

drop trigger if exists member_foundation_requirement_completions_validate
  on public.member_foundation_requirement_completions;
create trigger member_foundation_requirement_completions_validate
before insert on public.member_foundation_requirement_completions
for each row execute function private.ruined_validate_foundation_requirement_completion();

drop trigger if exists member_foundation_requirement_completions_append_only
  on public.member_foundation_requirement_completions;
create trigger member_foundation_requirement_completions_append_only
before update or delete on public.member_foundation_requirement_completions
for each row execute function public.ruined_reject_append_only_mutation();

revoke all on function private.ruined_validate_foundation_requirement_completion()
  from public, anon, authenticated;

-- New Ruined Foundations versions receive the two approved member-owned
-- requirements. The already-published historical version is not rewritten.
create or replace function private.ruined_default_foundation_member_requirements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  program_slug text;
  configured_requirement text;
begin
  select program.slug
  into program_slug
  from public.foundation_programs program
  where program.id = new.foundation_program_id;

  if program_slug = 'ruined-foundations'
     and not (new.configuration ? 'required_member_requirements') then
    new.configuration := jsonb_set(
      new.configuration,
      '{required_member_requirements}',
      '["timeline", "future_letter"]'::jsonb,
      true
    );
  end if;

  if new.configuration ? 'required_member_requirements' then
    if jsonb_typeof(new.configuration -> 'required_member_requirements') <> 'array' then
      raise exception 'required_member_requirements must be a JSON array.';
    end if;
    for configured_requirement in
      select jsonb_array_elements_text(
        new.configuration -> 'required_member_requirements'
      )
    loop
      if configured_requirement not in ('timeline', 'future_letter') then
        raise exception 'Unsupported member requirement: %', configured_requirement;
      end if;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists foundation_versions_00_default_member_requirements
  on public.foundation_versions;
create trigger foundation_versions_00_default_member_requirements
before insert or update of configuration, foundation_program_id
on public.foundation_versions
for each row execute function private.ruined_default_foundation_member_requirements();

revoke all on function private.ruined_default_foundation_member_requirements()
  from public, anon, authenticated;

create or replace function private.ruined_guard_foundation_required_member_markers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  required_slug text;
begin
  if new.status <> 'completed'
     or (tg_op = 'UPDATE' and old.status = 'completed') then
    return new;
  end if;

  for required_slug in
    select jsonb_array_elements_text(
      coalesce(
        (
          select coalesce(
            version_record.configuration -> 'required_member_requirements',
            case
              when program.slug = 'ruined-foundations'
                then '["timeline", "future_letter"]'::jsonb
              else '[]'::jsonb
            end
          )
          from public.foundation_versions version_record
          join public.foundation_programs program
            on program.id = version_record.foundation_program_id
          where version_record.id = new.foundation_version_id
        ),
        '[]'::jsonb
      )
    )
  loop
    if required_slug not in ('timeline', 'future_letter') then
      raise exception 'Unknown configured member requirement: %', required_slug;
    end if;

    if not exists (
      select 1
      from public.member_foundation_requirement_completions completion
      where completion.foundation_enrollment_id = new.id
        and completion.member_id = new.member_id
        and completion.requirement_slug = required_slug
        and completion.state = 'completed'
        and not exists (
          select 1
          from public.member_foundation_requirement_completions later
          where later.supersedes_completion_id = completion.id
            and later.state = 'revoked'
        )
    ) then
      raise exception 'Foundation requirement % must be complete before the enrollment.', required_slug;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists foundation_enrollments_05_member_requirements_guard
  on public.foundation_enrollments;
create trigger foundation_enrollments_05_member_requirements_guard
before insert or update of status on public.foundation_enrollments
for each row execute function private.ruined_guard_foundation_required_member_markers();

revoke all on function private.ruined_guard_foundation_required_member_markers()
  from public, anon, authenticated;

create table if not exists public.member_milestones (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  milestone_type text not null check (milestone_type ~ '^[a-z][a-z0-9_.]*$'),
  title text not null,
  occurred_at timestamptz not null,
  source_entity_type text,
  source_entity_id text,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  visibility text not null default 'member'
    check (visibility in ('private', 'member', 'circle', 'ops')),
  dedupe_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (member_id, person_id)
    references public.ruined_members(id, person_id) on delete restrict,
  check (char_length(btrim(title)) between 1 and 200)
);

create index if not exists member_milestones_member_idx
  on public.member_milestones(member_id, occurred_at desc);
create index if not exists member_milestones_person_idx
  on public.member_milestones(person_id, occurred_at desc);
create index if not exists member_milestones_source_idx
  on public.member_milestones(source_entity_type, source_entity_id);

create table if not exists public.artifact_awards (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  artifact_template_version_id uuid
    references public.artifact_template_versions(id) on delete restrict,
  award_name text not null,
  acquisition_type text not null
    check (acquisition_type in ('earned', 'purchased', 'gifted')),
  award_reason text,
  status text not null default 'awarded'
    check (status in ('awarded', 'in_fulfillment', 'fulfilled', 'revoked')),
  member_input_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(member_input_snapshot) = 'object'),
  awarded_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  awarded_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  revoked_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  revoke_reason text,
  source_event_reference text,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  dedupe_key text not null unique,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (member_id, person_id)
    references public.ruined_members(id, person_id) on delete restrict,
  check (char_length(btrim(award_name)) between 1 and 200),
  check (award_reason is null or char_length(award_reason) <= 2000),
  check (revoke_reason is null or char_length(revoke_reason) <= 2000),
  check ((status = 'revoked') = (revoked_at is not null))
);

create index if not exists artifact_awards_member_idx
  on public.artifact_awards(member_id, awarded_at desc);
create index if not exists artifact_awards_person_idx
  on public.artifact_awards(person_id, awarded_at desc);
create index if not exists artifact_awards_template_version_idx
  on public.artifact_awards(artifact_template_version_id);
create index if not exists artifact_awards_status_idx
  on public.artifact_awards(status, awarded_at desc);
create index if not exists artifact_awards_awarder_idx
  on public.artifact_awards(awarded_by_auth_user_id);
create index if not exists artifact_awards_revoker_idx
  on public.artifact_awards(revoked_by_auth_user_id);

create table if not exists public.artifact_award_events (
  id bigint generated always as identity primary key,
  artifact_award_id uuid not null
    references public.artifact_awards(id) on delete restrict,
  event_type text not null
    check (event_type in ('awarded', 'inputs_updated', 'fulfillment_started', 'fulfilled', 'revoked')),
  previous_status text,
  next_status text not null,
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  dedupe_key text not null unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp()
);

create index if not exists artifact_award_events_award_idx
  on public.artifact_award_events(artifact_award_id, occurred_at desc);
create index if not exists artifact_award_events_actor_idx
  on public.artifact_award_events(actor_auth_user_id);

alter table public.artifact_jobs
  add column if not exists artifact_award_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.artifact_jobs'::regclass
      and conname = 'artifact_jobs_artifact_award_id_fkey'
  ) then
    alter table public.artifact_jobs
      add constraint artifact_jobs_artifact_award_id_fkey
      foreign key (artifact_award_id) references public.artifact_awards(id)
      on delete restrict not valid;
  end if;
end;
$$;

alter table public.artifact_jobs
  validate constraint artifact_jobs_artifact_award_id_fkey;
create unique index if not exists artifact_jobs_artifact_award_idx
  on public.artifact_jobs(artifact_award_id)
  where artifact_award_id is not null;

create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  person_id uuid references public.people(id) on delete restrict,
  member_id uuid references public.ruined_members(id) on delete restrict,
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  correlation_id text,
  causation_event_id uuid references public.domain_events(id) on delete restrict,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default statement_timestamp(),
  dedupe_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (member_id, person_id)
    references public.ruined_members(id, person_id) on delete restrict,
  check (aggregate_type ~ '^[a-z][a-z0-9_.]*$'),
  check (event_type ~ '^[a-z][a-z0-9_.]*$')
);

create index if not exists domain_events_aggregate_idx
  on public.domain_events(aggregate_type, aggregate_id, occurred_at desc);
create index if not exists domain_events_person_idx
  on public.domain_events(person_id, occurred_at desc);
create index if not exists domain_events_member_idx
  on public.domain_events(member_id, occurred_at desc);
create index if not exists domain_events_actor_idx
  on public.domain_events(actor_auth_user_id);
create index if not exists domain_events_causation_idx
  on public.domain_events(causation_event_id);
create index if not exists domain_events_correlation_idx
  on public.domain_events(correlation_id)
  where correlation_id is not null;

create table if not exists public.workflow_actions (
  id uuid primary key default gen_random_uuid(),
  domain_event_id uuid not null references public.domain_events(id) on delete restrict,
  action_type text not null
    check (action_type in ('create_artifact_job', 'create_operator_task', 'generate_agreement_receipt', 'send_notification', 'project_milestone')),
  target_type text,
  target_id text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'dead_letter', 'cancelled')),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  idempotency_key text not null unique,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts > 0),
  available_at timestamptz not null default statement_timestamp(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (attempts <= max_attempts),
  check (completed_at is null or status in ('succeeded', 'dead_letter', 'cancelled'))
);

create index if not exists workflow_actions_claim_idx
  on public.workflow_actions(status, available_at, created_at)
  where status in ('pending', 'failed');
create index if not exists workflow_actions_event_idx
  on public.workflow_actions(domain_event_id);
create index if not exists workflow_actions_target_idx
  on public.workflow_actions(target_type, target_id);

create table if not exists public.workflow_action_attempts (
  id bigint generated always as identity primary key,
  workflow_action_id uuid not null
    references public.workflow_actions(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  outcome text not null check (outcome in ('started', 'succeeded', 'failed', 'dead_lettered')),
  worker_id text,
  error_code text,
  error_message text,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  unique (workflow_action_id, attempt_number, outcome)
);

create index if not exists workflow_action_attempts_action_idx
  on public.workflow_action_attempts(workflow_action_id, occurred_at desc);

-- Extensible activity spine. External/public activity stays unlinked until a
-- verified identity is resolved; no email or other raw lookup value is stored.
create table if not exists public.person_activities (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.people(id) on delete restrict,
  member_id uuid references public.ruined_members(id) on delete restrict,
  activity_type text not null
    check (activity_type in ('event_registration', 'event_attendance', 'academy', 'challenge', 'saved_content', 'purchase', 'artifact', 'leadership', 'progression', 'membership')),
  subject_type text not null,
  subject_id text not null,
  identity_state text not null
    check (identity_state in ('unlinked', 'linked', 'rejected')),
  source_provider text not null
    check (source_provider in ('internal', 'community', 'shopify', 'stripe', 'external', 'import')),
  external_reference text,
  visibility text not null default 'member'
    check (visibility in ('private', 'member', 'circle', 'ops')),
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  domain_event_id uuid references public.domain_events(id) on delete restrict,
  dedupe_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (member_id, person_id)
    references public.ruined_members(id, person_id) on delete restrict,
  check (activity_type ~ '^[a-z][a-z0-9_]*$'),
  check (
    (identity_state = 'linked' and person_id is not null)
    or (identity_state <> 'linked' and person_id is null and member_id is null)
  )
);

create index if not exists person_activities_person_idx
  on public.person_activities(person_id, occurred_at desc);
create index if not exists person_activities_member_idx
  on public.person_activities(member_id, occurred_at desc);
create index if not exists person_activities_type_idx
  on public.person_activities(activity_type, occurred_at desc);
create index if not exists person_activities_subject_idx
  on public.person_activities(subject_type, subject_id, occurred_at desc);
create index if not exists person_activities_external_idx
  on public.person_activities(source_provider, external_reference)
  where external_reference is not null;
create index if not exists person_activities_domain_event_idx
  on public.person_activities(domain_event_id);
create index if not exists person_activities_resolution_idx
  on public.person_activities(identity_state, source_provider, occurred_at)
  where identity_state = 'unlinked';

-- An imported activity remains immutable. Verified identity resolution is an
-- additive, separately audited link rather than an update to its source row.
create table if not exists public.person_activity_identity_links (
  id uuid primary key default gen_random_uuid(),
  person_activity_id uuid not null unique
    references public.person_activities(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  member_id uuid references public.ruined_members(id) on delete restrict,
  resolution_method text not null
    check (resolution_method in ('verified_email', 'authenticated_member', 'operator_review', 'external_customer_link')),
  resolved_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  resolved_at timestamptz not null default statement_timestamp(),
  dedupe_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (member_id, person_id)
    references public.ruined_members(id, person_id) on delete restrict
);

create index if not exists person_activity_identity_links_person_idx
  on public.person_activity_identity_links(person_id, resolved_at desc);
create index if not exists person_activity_identity_links_member_idx
  on public.person_activity_identity_links(member_id, resolved_at desc);
create index if not exists person_activity_identity_links_actor_idx
  on public.person_activity_identity_links(resolved_by_auth_user_id);

create or replace function private.ruined_validate_person_activity_identity_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_identity_state text;
begin
  select activity.identity_state
  into source_identity_state
  from public.person_activities activity
  where activity.id = new.person_activity_id
  for update;

  if source_identity_state is distinct from 'unlinked' then
    raise exception 'Only an unlinked imported activity may receive an identity link.';
  end if;

  return new;
end;
$$;

drop trigger if exists person_activity_identity_links_validate
  on public.person_activity_identity_links;
create trigger person_activity_identity_links_validate
before insert on public.person_activity_identity_links
for each row execute function private.ruined_validate_person_activity_identity_link();

drop trigger if exists person_activity_identity_links_append_only
  on public.person_activity_identity_links;
create trigger person_activity_identity_links_append_only
before update or delete on public.person_activity_identity_links
for each row execute function public.ruined_reject_append_only_mutation();

revoke all on function private.ruined_validate_person_activity_identity_link()
  from public, anon, authenticated;

drop trigger if exists member_milestones_append_only
  on public.member_milestones;
create trigger member_milestones_append_only
before update or delete on public.member_milestones
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists artifact_award_events_append_only
  on public.artifact_award_events;
create trigger artifact_award_events_append_only
before update or delete on public.artifact_award_events
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists domain_events_append_only
  on public.domain_events;
create trigger domain_events_append_only
before update or delete on public.domain_events
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists workflow_action_attempts_append_only
  on public.workflow_action_attempts;
create trigger workflow_action_attempts_append_only
before update or delete on public.workflow_action_attempts
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists person_activities_append_only
  on public.person_activities;
create trigger person_activities_append_only
before update or delete on public.person_activities
for each row execute function public.ruined_reject_append_only_mutation();

create or replace function private.ruined_queue_artifact_award()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
begin
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
    'artifact_award',
    new.id::text,
    'artifact.awarded',
    new.person_id,
    new.member_id,
    new.awarded_by_auth_user_id,
    jsonb_build_object(
      'artifact_award_id', new.id,
      'artifact_template_version_id', new.artifact_template_version_id,
      'acquisition_type', new.acquisition_type
    ),
    new.awarded_at,
    'artifact-award:' || new.id::text
  )
  on conflict (dedupe_key) do nothing
  returning id into event_id;

  if event_id is null then
    select existing_event.id
    into event_id
    from public.domain_events existing_event
    where existing_event.dedupe_key = 'artifact-award:' || new.id::text;
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
    new.person_id,
    'artifact.awarded',
    new.award_name,
    new.awarded_at,
    'artifact_award',
    new.id::text,
    jsonb_build_object('acquisition_type', new.acquisition_type),
    'artifact-award-milestone:' || new.id::text
  ) on conflict (dedupe_key) do nothing;

  insert into public.person_activities (
    person_id,
    member_id,
    activity_type,
    subject_type,
    subject_id,
    identity_state,
    source_provider,
    occurred_at,
    metadata,
    domain_event_id,
    dedupe_key
  ) values (
    new.person_id,
    new.member_id,
    'artifact',
    'artifact_award',
    new.id::text,
    'linked',
    'internal',
    new.awarded_at,
    jsonb_build_object('acquisition_type', new.acquisition_type),
    event_id,
    'artifact-award-activity:' || new.id::text
  ) on conflict (dedupe_key) do nothing;

  if new.artifact_template_version_id is not null then
    insert into public.workflow_actions (
      domain_event_id,
      action_type,
      target_type,
      target_id,
      payload,
      idempotency_key
    ) values (
      event_id,
      'create_artifact_job',
      'artifact_award',
      new.id::text,
      jsonb_build_object(
        'artifact_award_id', new.id,
        'member_id', new.member_id,
        'artifact_template_version_id', new.artifact_template_version_id
      ),
      'create-artifact-job:' || new.id::text
    ) on conflict (idempotency_key) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists artifact_awards_90_queue_work
  on public.artifact_awards;
create trigger artifact_awards_90_queue_work
after insert on public.artifact_awards
for each row execute function private.ruined_queue_artifact_award();

revoke all on function private.ruined_queue_artifact_award()
  from public, anon, authenticated;

create or replace function private.ruined_queue_agreement_acceptance_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
  event_dedupe_key text := 'agreement-acceptance:' || new.id::text;
begin
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
    'membership_agreement_acceptance',
    new.id::text,
    'membership.agreement_accepted',
    new.person_id,
    new.member_id,
    new.accepted_by_auth_user_id,
    jsonb_build_object(
      'acceptance_id', new.id,
      'agreement_version_id', new.agreement_version_id,
      'agreement_content_sha256', new.agreement_content_sha256
    ),
    new.accepted_at,
    event_dedupe_key
  ) on conflict (dedupe_key) do nothing
  returning id into event_id;

  if event_id is null then
    select existing_event.id into event_id
    from public.domain_events existing_event
    where existing_event.dedupe_key = event_dedupe_key;
  end if;

  insert into public.workflow_actions (
    domain_event_id,
    action_type,
    target_type,
    target_id,
    payload,
    idempotency_key
  ) values (
    event_id,
    'generate_agreement_receipt',
    'membership_agreement_acceptance',
    new.id::text,
    jsonb_build_object(
      'acceptance_id', new.id,
      'delivery_method', 'database_snapshot'
    ),
    'generate-agreement-receipt:' || new.id::text
  ) on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists membership_agreement_acceptances_90_queue_work
  on public.membership_agreement_acceptances;
create trigger membership_agreement_acceptances_90_queue_work
after insert on public.membership_agreement_acceptances
for each row execute function private.ruined_queue_agreement_acceptance_work();

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
  ),
  (
    event_id,
    'create_operator_task',
    'member',
    new.member_id::text,
    jsonb_build_object(
      'member_id', new.member_id,
      'task_type', 'onboarding.follow_up',
      'priority', 'normal',
      'title', 'Follow up after onboarding',
      'description', 'Check that the member can access My Ruined and knows their next step.'
    ),
    'operator-follow-up-onboarding:' || new.member_id::text || ':v' || new.version::text
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists member_onboardings_90_queue_completion_work
  on public.member_onboardings;
create trigger member_onboardings_90_queue_completion_work
after insert or update of state on public.member_onboardings
for each row execute function private.ruined_queue_onboarding_completion_work();

create or replace function private.ruined_queue_foundation_completion_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_person_id uuid;
  event_id uuid;
  event_dedupe_key text;
  configured_template_text text;
  approved_template_id uuid;
  approved_template_name text;
begin
  if new.status <> 'completed'
     or (tg_op = 'UPDATE' and old.status = 'completed') then
    return new;
  end if;

  select member.person_id into member_person_id
  from public.ruined_members member
  where member.id = new.member_id;

  event_dedupe_key := 'foundation-enrollment-completed:' || new.id::text;

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
    'foundation_enrollment',
    new.id::text,
    'foundations.completed',
    member_person_id,
    new.member_id,
    jsonb_build_object(
      'foundation_enrollment_id', new.id,
      'foundation_version_id', new.foundation_version_id
    ),
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
    'foundations.completed',
    'Ruined Foundations complete',
    new.completed_at,
    'foundation_enrollment',
    new.id::text,
    jsonb_build_object('foundation_version_id', new.foundation_version_id),
    'foundation-completion-milestone:' || new.id::text
  ) on conflict (dedupe_key) do nothing;

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
      'template_key', 'foundations_completed',
      'notification_type', 'foundations',
      'title', 'Foundations complete',
      'body', 'Your Foundation is complete. Your Circle and next steps are ready in My Ruined.',
      'action_label', 'View My Ruined',
      'action_url', '/my'
    ),
    'notify-foundations-completed:' || new.id::text
  ) on conflict (idempotency_key) do nothing;

  select version_record.configuration ->> 'artifact_template_version_id'
  into configured_template_text
  from public.foundation_versions version_record
  where version_record.id = new.foundation_version_id;

  if configured_template_text is not null
     and configured_template_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select template_version.id, template_version.name
    into approved_template_id, approved_template_name
    from public.artifact_template_versions template_version
    where template_version.id = configured_template_text::uuid
      and template_version.status = 'published';
  end if;

  if approved_template_id is not null then
    insert into public.artifact_awards (
      member_id,
      person_id,
      artifact_template_version_id,
      award_name,
      acquisition_type,
      award_reason,
      awarded_at,
      source_event_reference,
      evidence,
      dedupe_key
    ) values (
      new.member_id,
      member_person_id,
      approved_template_id,
      approved_template_name,
      'earned',
      'Ruined Foundations completion',
      new.completed_at,
      event_id::text,
      jsonb_build_object('foundation_enrollment_id', new.id),
      'foundation-completion-artifact:' || new.id::text
    ) on conflict (dedupe_key) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists foundation_enrollments_90_queue_completion_work
  on public.foundation_enrollments;
create trigger foundation_enrollments_90_queue_completion_work
after insert or update of status on public.foundation_enrollments
for each row execute function private.ruined_queue_foundation_completion_work();

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

  return new;
end;
$$;

drop trigger if exists circle_member_assignments_90_queue_work
  on public.circle_member_assignments;
create trigger circle_member_assignments_90_queue_work
after insert on public.circle_member_assignments
for each row execute function private.ruined_queue_circle_assignment_work();

revoke all on function private.ruined_queue_agreement_acceptance_work()
  from public, anon, authenticated;
revoke all on function private.ruined_queue_onboarding_completion_work()
  from public, anon, authenticated;
revoke all on function private.ruined_queue_foundation_completion_work()
  from public, anon, authenticated;
revoke all on function private.ruined_queue_circle_assignment_work()
  from public, anon, authenticated;

alter table public.member_timeline_entries enable row level security;
alter table public.member_timeline_entry_versions enable row level security;
alter table public.member_foundation_requirement_completions enable row level security;
alter table public.member_milestones enable row level security;
alter table public.artifact_awards enable row level security;
alter table public.artifact_award_events enable row level security;
alter table public.domain_events enable row level security;
alter table public.workflow_actions enable row level security;
alter table public.workflow_action_attempts enable row level security;
alter table public.person_activities enable row level security;
alter table public.person_activity_identity_links enable row level security;

revoke all on table
  public.member_timeline_entries,
  public.member_timeline_entry_versions,
  public.member_foundation_requirement_completions,
  public.member_milestones,
  public.artifact_awards,
  public.artifact_award_events,
  public.domain_events,
  public.workflow_actions,
  public.workflow_action_attempts,
  public.person_activities,
  public.person_activity_identity_links
from public, anon, authenticated;

grant select on table
  public.member_timeline_entries,
  public.member_timeline_entry_versions,
  public.member_foundation_requirement_completions,
  public.member_milestones,
  public.artifact_awards,
  public.person_activities,
  public.person_activity_identity_links
to authenticated;

create policy member_timeline_entries_select_self
on public.member_timeline_entries for select
to authenticated
using (member_id = private.ruined_current_membership_id());

create policy member_timeline_entry_versions_select_self
on public.member_timeline_entry_versions for select
to authenticated
using (member_id = private.ruined_current_membership_id());

create policy member_foundation_requirement_completions_select_self
on public.member_foundation_requirement_completions for select
to authenticated
using (member_id = private.ruined_current_membership_id());

create policy member_milestones_select_self
on public.member_milestones for select
to authenticated
using (person_id = private.ruined_current_person_id());

create policy artifact_awards_select_self
on public.artifact_awards for select
to authenticated
using (person_id = private.ruined_current_person_id());

create policy person_activities_select_self
on public.person_activities for select
to authenticated
using (
  (
    (identity_state = 'linked' and person_id = private.ruined_current_person_id())
    or exists (
      select 1
      from public.person_activity_identity_links identity_link
      where identity_link.person_activity_id = person_activities.id
        and identity_link.person_id = private.ruined_current_person_id()
    )
  )
  and visibility in ('member', 'circle')
);

create policy person_activity_identity_links_select_self
on public.person_activity_identity_links for select
to authenticated
using (person_id = private.ruined_current_person_id());

comment on table public.person_activities is
  'Extensible activity ledger for attendance, learning, purchases, Artifacts, leadership, progression, and membership. Unlinked rows contain no raw email.';
comment on table public.person_activity_identity_links is
  'Append-only verified resolution from an immutable imported activity to a Person.';
comment on table public.workflow_actions is
  'Durable internal work queue. Workers claim with FOR UPDATE SKIP LOCKED and honor idempotency_key.';
comment on table public.member_foundation_requirement_completions is
  'Append-only requirement markers. Future Letter content is explicitly prohibited.';

commit;
