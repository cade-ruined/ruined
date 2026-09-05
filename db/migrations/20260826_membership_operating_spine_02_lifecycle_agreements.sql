begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Progression is independent from billing, access, and Foundations completion.
-- These five names are the approved Ruined progression vocabulary; no criteria
-- or automatic promotion rules are inferred by this migration.
create table if not exists public.membership_progression_levels (
  slug text primary key,
  display_name text not null,
  position integer not null unique check (position > 0),
  status text not null default 'active'
    check (status in ('active', 'retired')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (slug ~ '^[a-z][a-z0-9_]*$'),
  check (char_length(btrim(display_name)) between 1 and 80)
);

insert into public.membership_progression_levels (slug, display_name, position)
values
  ('member', 'Member', 1),
  ('shaper', 'Shaper', 2),
  ('builder', 'Builder', 3),
  ('author', 'Author', 4),
  ('partner', 'Partner', 5)
on conflict (slug) do nothing;

alter table public.member_lifecycle
  add column if not exists admission_state text not null default 'interested',
  add column if not exists administrative_onboarding_state text not null default 'not_started',
  add column if not exists standing_state text not null default 'pre_active',
  add column if not exists standing_changed_at timestamptz not null default statement_timestamp(),
  add column if not exists access_started_at timestamptz,
  add column if not exists access_ended_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists cancellation_effective_at timestamptz,
  add column if not exists inactive_at timestamptz,
  add column if not exists alumni_at timestamptz,
  add column if not exists current_progression_level_slug text;

update public.member_lifecycle
set
  admission_state = case
    when account_state = 'closed' and program_state = 'withdrawn' then 'withdrawn'
    when account_state in ('active', 'suspended') or billing_state = 'active' then 'accepted'
    when account_state = 'invited' then 'invited'
    else admission_state
  end,
  administrative_onboarding_state = case
    when billing_state = 'active' and program_state in ('onboarding', 'active', 'paused', 'completed')
      then 'completed'
    when account_state in ('invited', 'active', 'suspended')
      or program_state = 'onboarding'
      then 'in_progress'
    else administrative_onboarding_state
  end,
  standing_state = case
    when program_state = 'completed' then 'alumni'
    when program_state = 'paused' then 'paused'
    when program_state = 'withdrawn' or account_state = 'closed' or billing_state = 'ended'
      then 'inactive'
    when account_state = 'active'
      and billing_state = 'active'
      and program_state in ('onboarding', 'active')
      then 'active'
    else 'pre_active'
  end,
  access_started_at = case
    when account_state = 'active' and billing_state = 'active'
      then coalesce(access_started_at, updated_at)
    else access_started_at
  end,
  paused_at = case
    when program_state = 'paused' then coalesce(paused_at, updated_at)
    else paused_at
  end,
  inactive_at = case
    when program_state = 'withdrawn' or account_state = 'closed' or billing_state = 'ended'
      then coalesce(inactive_at, updated_at)
    else inactive_at
  end,
  alumni_at = case
    when program_state = 'completed' then coalesce(alumni_at, updated_at)
    else alumni_at
  end,
  current_progression_level_slug = coalesce(current_progression_level_slug, 'member');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.member_lifecycle'::regclass
      and conname = 'member_lifecycle_admission_state_check'
  ) then
    alter table public.member_lifecycle
      add constraint member_lifecycle_admission_state_check
      check (admission_state in ('interested', 'applied', 'invited', 'accepted', 'declined', 'withdrawn'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.member_lifecycle'::regclass
      and conname = 'member_lifecycle_administrative_onboarding_state_check'
  ) then
    alter table public.member_lifecycle
      add constraint member_lifecycle_administrative_onboarding_state_check
      check (administrative_onboarding_state in ('not_started', 'in_progress', 'completed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.member_lifecycle'::regclass
      and conname = 'member_lifecycle_standing_state_check'
  ) then
    alter table public.member_lifecycle
      add constraint member_lifecycle_standing_state_check
      check (standing_state in ('pre_active', 'active', 'paused', 'cancellation_requested', 'inactive', 'alumni'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.member_lifecycle'::regclass
      and conname = 'member_lifecycle_progression_level_fkey'
  ) then
    alter table public.member_lifecycle
      add constraint member_lifecycle_progression_level_fkey
      foreign key (current_progression_level_slug)
      references public.membership_progression_levels(slug)
      on delete restrict not valid;
  end if;
end;
$$;

alter table public.member_lifecycle
  validate constraint member_lifecycle_progression_level_fkey;

create index if not exists member_lifecycle_progression_idx
  on public.member_lifecycle(current_progression_level_slug);
create index if not exists member_lifecycle_access_queue_idx
  on public.member_lifecycle(
    administrative_onboarding_state,
    standing_state,
    updated_at desc
  );
create index if not exists member_lifecycle_admission_idx
  on public.member_lifecycle(admission_state, updated_at desc);

alter table public.member_lifecycle
  alter column current_progression_level_slug set default 'member',
  alter column current_progression_level_slug set not null;

alter table public.member_state_history
  drop constraint if exists member_state_history_dimension_check;
alter table public.member_state_history
  add constraint member_state_history_dimension_check
  check (
    dimension in (
      'account', 'billing', 'program', 'foundations', 'artifact',
      'admission', 'administrative_onboarding', 'standing', 'progression'
    )
  );

create table if not exists public.member_onboardings (
  member_id uuid primary key
    references public.ruined_members(id) on delete restrict,
  state text not null default 'not_started'
    check (state in ('not_started', 'in_progress', 'completed')),
  form_version text not null,
  requirements_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(requirements_snapshot) = 'object'),
  application_received_at timestamptz,
  admitted_at timestamptz,
  invited_at timestamptz,
  billing_confirmed_at timestamptz,
  profile_completed_at timestamptz,
  agreement_completed_at timestamptz,
  circle_assigned_at timestamptz,
  foundations_ready_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  operator_owner_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  completion_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(completion_evidence) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (char_length(btrim(form_version)) between 1 and 80),
  check (completed_at is null or started_at is null or completed_at >= started_at),
  check (state <> 'completed' or completed_at is not null)
);

insert into public.member_onboardings (
  member_id,
  state,
  form_version,
  requirements_snapshot,
  billing_confirmed_at,
  started_at,
  completed_at,
  completion_evidence,
  updated_at
)
select
  lifecycle.member_id,
  lifecycle.administrative_onboarding_state,
  'legacy-v1',
  jsonb_build_object('legacy_backfill', true),
  case when lifecycle.billing_state = 'active' then lifecycle.updated_at end,
  case
    when lifecycle.administrative_onboarding_state <> 'not_started' then lifecycle.updated_at
  end,
  case
    when lifecycle.administrative_onboarding_state = 'completed' then lifecycle.updated_at
  end,
  jsonb_build_object('source', 'legacy_lifecycle_backfill'),
  lifecycle.updated_at
from public.member_lifecycle lifecycle
on conflict (member_id) do nothing;

create table if not exists public.member_onboarding_events (
  id bigint generated always as identity primary key,
  member_id uuid not null
    references public.member_onboardings(member_id) on delete restrict,
  event_type text not null
    check (event_type in ('started', 'field_completed', 'state_changed', 'completed', 'reopened', 'assigned')),
  previous_state text,
  next_state text,
  field_name text,
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  dedupe_key text unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp()
);

create index if not exists member_onboardings_owner_idx
  on public.member_onboardings(operator_owner_auth_user_id);
create index if not exists member_onboardings_state_idx
  on public.member_onboardings(state, updated_at desc);
create index if not exists member_onboarding_events_member_idx
  on public.member_onboarding_events(member_id, occurred_at desc);
create index if not exists member_onboarding_events_actor_idx
  on public.member_onboarding_events(actor_auth_user_id);

create or replace function private.ruined_create_default_member_onboarding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.member_onboardings (
    member_id,
    state,
    form_version,
    requirements_snapshot,
    completion_evidence
  ) values (
    new.member_id,
    new.administrative_onboarding_state,
    'platform-v1',
    '{}'::jsonb,
    '{}'::jsonb
  ) on conflict (member_id) do nothing;
  return new;
end;
$$;

drop trigger if exists member_lifecycle_20_default_onboarding
  on public.member_lifecycle;
create trigger member_lifecycle_20_default_onboarding
after insert on public.member_lifecycle
for each row execute function private.ruined_create_default_member_onboarding();

revoke all on function private.ruined_create_default_member_onboarding()
  from public, anon, authenticated;

create table if not exists public.membership_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  agreement_key text not null,
  version integer not null check (version > 0),
  title text not null,
  content_format text not null default 'markdown'
    check (content_format in ('markdown', 'html', 'plain_text')),
  body_text text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired')),
  effective_at timestamptz,
  published_at timestamptz,
  retired_at timestamptz,
  created_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (agreement_key, version),
  check (agreement_key ~ '^[a-z][a-z0-9_]*$'),
  check (char_length(btrim(title)) between 1 and 200),
  check (char_length(body_text) > 0),
  check (status = 'draft' or published_at is not null),
  check (retired_at is null or published_at is null or retired_at >= published_at)
);

create unique index if not exists membership_agreement_versions_one_published_idx
  on public.membership_agreement_versions(agreement_key)
  where status = 'published';
create index if not exists membership_agreement_versions_status_idx
  on public.membership_agreement_versions(status, effective_at desc);
create index if not exists membership_agreement_versions_creator_idx
  on public.membership_agreement_versions(created_by_auth_user_id);

create table if not exists public.membership_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  agreement_version_id uuid not null
    references public.membership_agreement_versions(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  accepted_by_auth_user_id uuid not null
    references public.platform_users(auth_user_id) on delete restrict,
  age_attestation_id bigint
    references public.member_consents(id) on delete restrict,
  signer_name_snapshot text not null,
  signer_email_snapshot text not null,
  affirmative_action text not null
    check (affirmative_action in ('checkbox_and_submit', 'typed_signature')),
  acceptance_context text not null default 'initial_membership'
    check (acceptance_context in ('initial_membership', 'rejoin', 'renewal')),
  accepted_at timestamptz not null,
  agreement_key_snapshot text not null,
  agreement_version_snapshot integer not null check (agreement_version_snapshot > 0),
  agreement_title_snapshot text not null,
  agreement_content_sha256 text not null
    check (agreement_content_sha256 ~ '^[0-9a-f]{64}$'),
  agreement_body_snapshot text not null,
  acceptance_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(acceptance_evidence) = 'object'),
  dedupe_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (member_id, person_id)
    references public.ruined_members(id, person_id) on delete restrict,
  check (char_length(btrim(signer_name_snapshot)) between 1 and 180),
  check (char_length(btrim(signer_email_snapshot)) between 3 and 254),
  check (char_length(agreement_body_snapshot) > 0)
);

create index if not exists membership_agreement_acceptances_person_idx
  on public.membership_agreement_acceptances(person_id, accepted_at desc);
create index if not exists membership_agreement_acceptances_member_idx
  on public.membership_agreement_acceptances(member_id, accepted_at desc);
create index if not exists membership_agreement_acceptances_version_idx
  on public.membership_agreement_acceptances(agreement_version_id, accepted_at desc);
create index if not exists membership_agreement_acceptances_auth_idx
  on public.membership_agreement_acceptances(accepted_by_auth_user_id);
create index if not exists membership_agreement_acceptances_age_idx
  on public.membership_agreement_acceptances(age_attestation_id);

-- Expand Checkout without invalidating pre-migration attempts. New application
-- writes bind each attempt to the durable acceptance; a later cutover can make
-- this NOT NULL after legacy/open attempts have drained.
alter table public.stripe_checkout_attempts
  add column if not exists agreement_acceptance_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stripe_checkout_attempts'::regclass
      and conname = 'stripe_checkout_attempts_agreement_acceptance_id_fkey'
  ) then
    alter table public.stripe_checkout_attempts
      add constraint stripe_checkout_attempts_agreement_acceptance_id_fkey
      foreign key (agreement_acceptance_id)
      references public.membership_agreement_acceptances(id)
      on delete restrict not valid;
  end if;
end;
$$;

alter table public.stripe_checkout_attempts
  validate constraint stripe_checkout_attempts_agreement_acceptance_id_fkey;
create index if not exists stripe_checkout_attempts_acceptance_idx
  on public.stripe_checkout_attempts(agreement_acceptance_id);

create table if not exists public.membership_agreement_receipts (
  id uuid primary key default gen_random_uuid(),
  acceptance_id uuid not null unique
    references public.membership_agreement_acceptances(id) on delete restrict,
  delivery_method text not null default 'database_snapshot'
    check (delivery_method in ('database_snapshot', 'storage')),
  storage_bucket text,
  storage_path text,
  mime_type text not null default 'text/plain',
  byte_size bigint not null check (byte_size > 0),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  generator_version text not null,
  generated_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (storage_bucket, storage_path),
  check (storage_bucket is null or char_length(btrim(storage_bucket)) between 1 and 100),
  check (storage_path is null or char_length(btrim(storage_path)) between 1 and 1000),
  check (
    (delivery_method = 'database_snapshot' and storage_bucket is null and storage_path is null)
    or (delivery_method = 'storage' and storage_bucket is not null and storage_path is not null)
  ),
  check (char_length(btrim(generator_version)) between 1 and 100)
);

create table if not exists public.membership_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  requested_by_auth_user_id uuid not null
    references public.platform_users(auth_user_id) on delete restrict,
  state text not null default 'requested'
    check (state in ('requested', 'confirmed', 'withdrawn', 'effective', 'rejected')),
  reason_category text,
  reason_detail text,
  requested_at timestamptz not null default statement_timestamp(),
  requested_effective_at timestamptz,
  resolved_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  resolved_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (reason_detail is null or char_length(reason_detail) <= 2000),
  check (requested_effective_at is null or requested_effective_at >= requested_at),
  check (resolved_at is null or resolved_at >= requested_at)
);

create unique index if not exists membership_cancellation_requests_one_open_idx
  on public.membership_cancellation_requests(member_id)
  where state in ('requested', 'confirmed');
create index if not exists membership_cancellation_requests_member_idx
  on public.membership_cancellation_requests(member_id, requested_at desc);
create index if not exists membership_cancellation_requests_state_idx
  on public.membership_cancellation_requests(state, requested_at desc);
create index if not exists membership_cancellation_requests_requester_idx
  on public.membership_cancellation_requests(requested_by_auth_user_id);
create index if not exists membership_cancellation_requests_resolver_idx
  on public.membership_cancellation_requests(resolved_by_auth_user_id);

create table if not exists public.membership_cancellation_events (
  id bigint generated always as identity primary key,
  cancellation_request_id uuid not null
    references public.membership_cancellation_requests(id) on delete restrict,
  event_type text not null
    check (event_type in ('requested', 'confirmed', 'withdrawn', 'made_effective', 'rejected')),
  previous_state text,
  next_state text not null,
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  dedupe_key text unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp()
);

create index if not exists membership_cancellation_events_request_idx
  on public.membership_cancellation_events(cancellation_request_id, occurred_at desc);
create index if not exists membership_cancellation_events_actor_idx
  on public.membership_cancellation_events(actor_auth_user_id);

create table if not exists public.member_progression_assignments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  progression_level_slug text not null
    references public.membership_progression_levels(slug) on delete restrict,
  assigned_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  assignment_reason text,
  assigned_at timestamptz not null default statement_timestamp(),
  ended_at timestamptz,
  ended_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  end_reason text,
  created_at timestamptz not null default statement_timestamp(),
  check (ended_at is null or ended_at >= assigned_at),
  check (assignment_reason is null or char_length(assignment_reason) <= 1000),
  check (end_reason is null or char_length(end_reason) <= 1000)
);

create unique index if not exists member_progression_assignments_one_active_idx
  on public.member_progression_assignments(member_id)
  where ended_at is null;
create index if not exists member_progression_assignments_member_idx
  on public.member_progression_assignments(member_id, assigned_at desc);
create index if not exists member_progression_assignments_level_idx
  on public.member_progression_assignments(progression_level_slug, ended_at);
create index if not exists member_progression_assignments_assigner_idx
  on public.member_progression_assignments(assigned_by_auth_user_id);
create index if not exists member_progression_assignments_ender_idx
  on public.member_progression_assignments(ended_by_auth_user_id);

insert into public.member_progression_assignments (
  member_id,
  progression_level_slug,
  assignment_reason,
  assigned_at
)
select
  lifecycle.member_id,
  lifecycle.current_progression_level_slug,
  'Legacy membership backfill',
  lifecycle.updated_at
from public.member_lifecycle lifecycle
where lifecycle.current_progression_level_slug is not null
on conflict (member_id) where ended_at is null do nothing;

create or replace function private.ruined_project_progression_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.member_lifecycle
  set
    current_progression_level_slug = new.progression_level_slug,
    version = version + 1,
    updated_at = statement_timestamp()
  where member_id = new.member_id
    and current_progression_level_slug is distinct from new.progression_level_slug;
  return new;
end;
$$;

drop trigger if exists member_progression_assignments_project
  on public.member_progression_assignments;
create trigger member_progression_assignments_project
after insert on public.member_progression_assignments
for each row execute function private.ruined_project_progression_assignment();

create or replace function private.ruined_create_default_progression_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.member_progression_assignments (
    member_id,
    progression_level_slug,
    assignment_reason,
    assigned_at
  ) values (
    new.member_id,
    new.current_progression_level_slug,
    'Initial membership progression',
    statement_timestamp()
  )
  on conflict (member_id) where ended_at is null do nothing;
  return new;
end;
$$;

drop trigger if exists member_lifecycle_90_default_progression
  on public.member_lifecycle;
create trigger member_lifecycle_90_default_progression
after insert on public.member_lifecycle
for each row execute function private.ruined_create_default_progression_assignment();

create or replace function private.ruined_guard_progression_assignment_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Progression assignment history cannot be deleted.';
  end if;
  if new.member_id is distinct from old.member_id
     or new.progression_level_slug is distinct from old.progression_level_slug
     or new.assigned_by_auth_user_id is distinct from old.assigned_by_auth_user_id
     or new.assignment_reason is distinct from old.assignment_reason
     or new.assigned_at is distinct from old.assigned_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Only progression assignment closure fields may be updated.';
  end if;
  if old.ended_at is not null then
    raise exception 'A closed progression assignment is immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists member_progression_assignments_guard
  on public.member_progression_assignments;
create trigger member_progression_assignments_guard
before update or delete on public.member_progression_assignments
for each row execute function private.ruined_guard_progression_assignment_mutation();

create or replace function private.ruined_validate_agreement_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement_record public.membership_agreement_versions%rowtype;
  accepting_person_id uuid;
  attestation_member_id uuid;
  attestation_type text;
  attestation_decision text;
begin
  select agreement.*
  into agreement_record
  from public.membership_agreement_versions agreement
  where agreement.id = new.agreement_version_id;

  if agreement_record.id is null or agreement_record.status <> 'published' then
    raise exception 'Only a published agreement version may be accepted.';
  end if;

  if new.accepted_at < agreement_record.published_at
     or (
       agreement_record.effective_at is not null
       and new.accepted_at < agreement_record.effective_at
     ) then
    raise exception 'The agreement was not effective at the acceptance time.';
  end if;

  if new.agreement_key_snapshot <> agreement_record.agreement_key
     or new.agreement_version_snapshot <> agreement_record.version
     or new.agreement_title_snapshot <> agreement_record.title
     or new.agreement_content_sha256 <> agreement_record.content_sha256
     or new.agreement_body_snapshot <> agreement_record.body_text then
    raise exception 'Agreement acceptance snapshot does not match the published version.';
  end if;

  select platform_user.person_id
  into accepting_person_id
  from public.platform_users platform_user
  where platform_user.auth_user_id = new.accepted_by_auth_user_id
    and platform_user.status = 'active';

  if accepting_person_id is distinct from new.person_id then
    raise exception 'The accepting authentication identity does not belong to this Person.';
  end if;

  if new.age_attestation_id is not null then
    select consent.member_id, consent.consent_type, consent.decision
    into attestation_member_id, attestation_type, attestation_decision
    from public.member_consents consent
    where consent.id = new.age_attestation_id;

    if attestation_member_id is distinct from new.member_id
       or attestation_type is distinct from 'age_attestation'
       or attestation_decision is distinct from 'accepted' then
      raise exception 'The linked age attestation is not an accepted attestation for this member.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists membership_agreement_acceptances_validate
  on public.membership_agreement_acceptances;
create trigger membership_agreement_acceptances_validate
before insert on public.membership_agreement_acceptances
for each row execute function private.ruined_validate_agreement_acceptance();

create or replace function private.ruined_validate_member_onboarding_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle_record public.member_lifecycle%rowtype;
  member_person_id uuid;
begin
  if new.state <> 'completed'
     or (tg_op = 'UPDATE' and old.state = 'completed') then
    return new;
  end if;

  select lifecycle.*
  into lifecycle_record
  from public.member_lifecycle lifecycle
  where lifecycle.member_id = new.member_id;

  select member.person_id
  into member_person_id
  from public.ruined_members member
  where member.id = new.member_id;

  if lifecycle_record.billing_state <> 'active' then
    raise exception 'Active billing is required to complete administrative onboarding.';
  end if;

  if new.profile_completed_at is null
     or new.agreement_completed_at is null
     or new.billing_confirmed_at is null then
    raise exception 'Profile, agreement, and billing checkpoints are required to complete administrative onboarding.';
  end if;

  if not exists (
    select 1
    from public.person_profiles profile
    where profile.person_id = member_person_id
      and coalesce(profile.preferred_name, profile.display_name) is not null
  ) then
    raise exception 'A named Person profile is required to complete administrative onboarding.';
  end if;

  if not exists (
    select 1
    from public.platform_users platform_user
    join public.platform_role_grants role_grant
      on role_grant.auth_user_id = platform_user.auth_user_id
      and role_grant.role_slug = 'member'
      and role_grant.revoked_at is null
    join public.person_email_addresses email_address
      on email_address.person_id = platform_user.person_id
      and email_address.verification_state = 'verified'
      and email_address.retired_at is null
    where platform_user.person_id = member_person_id
      and platform_user.status = 'active'
  ) then
    raise exception 'An active member login and verified email are required to complete administrative onboarding.';
  end if;

  if not exists (
    select 1
    from public.membership_agreement_acceptances acceptance
    where acceptance.member_id = new.member_id
      and acceptance.person_id = member_person_id
      and acceptance.accepted_at <= new.agreement_completed_at
  ) then
    raise exception 'A durable agreement acceptance is required to complete administrative onboarding.';
  end if;

  if new.started_at is null then
    new.started_at := statement_timestamp();
  end if;
  if new.completed_at is null then
    new.completed_at := statement_timestamp();
  end if;

  return new;
end;
$$;

drop trigger if exists member_onboardings_validate_completion
  on public.member_onboardings;
create trigger member_onboardings_validate_completion
before insert or update of state on public.member_onboardings
for each row execute function private.ruined_validate_member_onboarding_completion();

create or replace function private.ruined_validate_lifecycle_onboarding_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.administrative_onboarding_state = 'completed'
     and (
       tg_op = 'INSERT'
       or old.administrative_onboarding_state is distinct from 'completed'
     )
     and not exists (
       select 1
       from public.member_onboardings onboarding
       where onboarding.member_id = new.member_id
         and onboarding.state = 'completed'
     ) then
    raise exception 'Complete member_onboardings before projecting administrative onboarding complete.';
  end if;
  return new;
end;
$$;

drop trigger if exists member_lifecycle_01_validate_onboarding
  on public.member_lifecycle;
create trigger member_lifecycle_01_validate_onboarding
before insert or update of administrative_onboarding_state
on public.member_lifecycle
for each row execute function private.ruined_validate_lifecycle_onboarding_projection();

create or replace function private.ruined_guard_agreement_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.status <> 'draft' then
    raise exception 'Published or retired agreement versions are immutable.';
  end if;

  if tg_op = 'UPDATE'
     and old.status in ('published', 'retired')
     and (
       new.agreement_key is distinct from old.agreement_key
       or new.version is distinct from old.version
       or new.title is distinct from old.title
       or new.content_format is distinct from old.content_format
       or new.body_text is distinct from old.body_text
       or new.content_sha256 is distinct from old.content_sha256
       or new.effective_at is distinct from old.effective_at
       or new.published_at is distinct from old.published_at
       or new.created_by_auth_user_id is distinct from old.created_by_auth_user_id
       or new.created_at is distinct from old.created_at
     ) then
    raise exception 'Published or retired agreement content is immutable.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists membership_agreement_versions_guard
  on public.membership_agreement_versions;
create trigger membership_agreement_versions_guard
before update or delete on public.membership_agreement_versions
for each row execute function private.ruined_guard_agreement_version_mutation();

drop trigger if exists member_onboarding_events_append_only
  on public.member_onboarding_events;
create trigger member_onboarding_events_append_only
before update or delete on public.member_onboarding_events
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists membership_agreement_acceptances_append_only
  on public.membership_agreement_acceptances;
create trigger membership_agreement_acceptances_append_only
before update or delete on public.membership_agreement_acceptances
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists membership_agreement_receipts_append_only
  on public.membership_agreement_receipts;
create trigger membership_agreement_receipts_append_only
before update or delete on public.membership_agreement_receipts
for each row execute function public.ruined_reject_append_only_mutation();

drop trigger if exists membership_cancellation_events_append_only
  on public.membership_cancellation_events;
create trigger membership_cancellation_events_append_only
before update or delete on public.membership_cancellation_events
for each row execute function public.ruined_reject_append_only_mutation();

revoke all on function private.ruined_guard_agreement_version_mutation()
  from public, anon, authenticated;
revoke all on function private.ruined_project_progression_assignment()
  from public, anon, authenticated;
revoke all on function private.ruined_create_default_progression_assignment()
  from public, anon, authenticated;
revoke all on function private.ruined_guard_progression_assignment_mutation()
  from public, anon, authenticated;
revoke all on function private.ruined_validate_agreement_acceptance()
  from public, anon, authenticated;
revoke all on function private.ruined_validate_member_onboarding_completion()
  from public, anon, authenticated;
revoke all on function private.ruined_validate_lifecycle_onboarding_projection()
  from public, anon, authenticated;

create or replace function private.ruined_stamp_lifecycle_standing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.standing_state is distinct from old.standing_state then
    new.standing_changed_at := statement_timestamp();
    new.paused_at := case
      when new.standing_state = 'paused' then coalesce(new.paused_at, statement_timestamp())
      else new.paused_at
    end;
    new.inactive_at := case
      when new.standing_state = 'inactive' then coalesce(new.inactive_at, statement_timestamp())
      else new.inactive_at
    end;
    new.alumni_at := case
      when new.standing_state = 'alumni' then coalesce(new.alumni_at, statement_timestamp())
      else new.alumni_at
    end;
    new.access_ended_at := case
      when new.standing_state in ('inactive', 'alumni')
        then coalesce(new.access_ended_at, statement_timestamp())
      else new.access_ended_at
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists member_lifecycle_00_stamp_standing
  on public.member_lifecycle;
create trigger member_lifecycle_00_stamp_standing
before update of standing_state on public.member_lifecycle
for each row execute function private.ruined_stamp_lifecycle_standing();

revoke all on function private.ruined_stamp_lifecycle_standing()
  from public, anon, authenticated;

create or replace function private.ruined_current_active_access_member_id()
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
    and lifecycle.standing_state in ('active', 'cancellation_requested')
    and (
      lifecycle.standing_state = 'active'
      or lifecycle.cancellation_effective_at is null
      or lifecycle.cancellation_effective_at > statement_timestamp()
    )
  limit 1
$$;

revoke all on function private.ruined_current_active_access_member_id()
  from public, anon, authenticated;
grant execute on function private.ruined_current_active_access_member_id()
  to authenticated;

alter table public.membership_progression_levels enable row level security;
alter table public.member_onboardings enable row level security;
alter table public.member_onboarding_events enable row level security;
alter table public.membership_agreement_versions enable row level security;
alter table public.membership_agreement_acceptances enable row level security;
alter table public.membership_agreement_receipts enable row level security;
alter table public.membership_cancellation_requests enable row level security;
alter table public.membership_cancellation_events enable row level security;
alter table public.member_progression_assignments enable row level security;

revoke all on table
  public.membership_progression_levels,
  public.member_onboardings,
  public.member_onboarding_events,
  public.membership_agreement_versions,
  public.membership_agreement_acceptances,
  public.membership_agreement_receipts,
  public.membership_cancellation_requests,
  public.membership_cancellation_events,
  public.member_progression_assignments
from public, anon, authenticated;

grant select on table
  public.membership_progression_levels,
  public.member_onboardings,
  public.membership_agreement_versions,
  public.membership_agreement_acceptances,
  public.membership_agreement_receipts,
  public.membership_cancellation_requests,
  public.member_progression_assignments
to authenticated;

create policy membership_progression_levels_select_active
on public.membership_progression_levels for select
to authenticated
using (status = 'active');

create policy member_onboardings_select_self
on public.member_onboardings for select
to authenticated
using (member_id = private.ruined_current_membership_id());

create policy membership_agreement_versions_select_published
on public.membership_agreement_versions for select
to authenticated
using (status = 'published');

create policy membership_agreement_acceptances_select_self
on public.membership_agreement_acceptances for select
to authenticated
using (person_id = private.ruined_current_person_id());

create policy membership_agreement_receipts_select_self
on public.membership_agreement_receipts for select
to authenticated
using (
  exists (
    select 1
    from public.membership_agreement_acceptances acceptance
    where acceptance.id = membership_agreement_receipts.acceptance_id
      and acceptance.person_id = private.ruined_current_person_id()
  )
);

create policy membership_cancellation_requests_select_self
on public.membership_cancellation_requests for select
to authenticated
using (member_id = private.ruined_current_membership_id());

create policy member_progression_assignments_select_self
on public.member_progression_assignments for select
to authenticated
using (member_id = private.ruined_current_membership_id());

comment on table public.membership_agreement_versions is
  'Immutable once published; legal text is never inferred or seeded by migrations.';
comment on table public.membership_agreement_acceptances is
  'Append-only proof plus the exact agreement copy seen by the signer.';
comment on column public.membership_agreement_acceptances.age_attestation_id is
  'Optional link to the separately recorded member_consents age attestation.';
comment on column public.member_lifecycle.current_progression_level_slug is
  'Projection of the active member_progression_assignments row.';

commit;
