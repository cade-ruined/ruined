begin;

-- Platform identities intentionally do not reference auth.users. Supabase Auth
-- owns passwordless credentials; this table only links its stable user UUID to
-- Ruined's durable member record. This also keeps the schema runnable in plain
-- PostgreSQL for local and automated tests.
create table if not exists platform_users (
  auth_user_id uuid primary key,
  member_id uuid unique references ruined_members(id) on delete set null,
  email_normalized text not null unique,
  user_type text not null default 'member'
    check (user_type in ('member', 'staff')),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended', 'disabled')),
  invited_at timestamptz,
  activated_at timestamptz,
  suspended_at timestamptz,
  last_signed_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email_normalized = lower(btrim(email_normalized)))
);

create table if not exists user_profiles (
  auth_user_id uuid primary key references platform_users(auth_user_id) on delete cascade,
  display_name text,
  avatar_storage_path text,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contact and fulfillment details are deliberately isolated from the general
-- profile so their RLS and retention rules can remain stricter.
create table if not exists member_private_profiles (
  member_id uuid primary key references ruined_members(id) on delete restrict,
  preferred_name text,
  legal_name text,
  phone_e164 text,
  default_fulfillment_address jsonb,
  accessibility_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists platform_roles (
  role_slug text primary key,
  display_name text not null,
  is_internal boolean not null default true,
  created_at timestamptz not null default now()
);

insert into platform_roles (role_slug, display_name, is_internal)
values
  ('member', 'Member', false),
  ('guide', 'Guide', true),
  ('circle_leader', 'Circle leader', true),
  ('ops_admin', 'Operations administrator', true)
on conflict (role_slug) do nothing;

create table if not exists platform_role_grants (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null references platform_users(auth_user_id) on delete restrict,
  role_slug text not null references platform_roles(role_slug) on delete restrict,
  granted_by_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text,
  check (revoked_at is null or revoked_at >= granted_at)
);

-- Replace the initially generated FK as well when this migration is rerun over
-- an earlier local draft that used cascading deletion.
alter table platform_role_grants
  drop constraint if exists platform_role_grants_auth_user_id_fkey;
alter table platform_role_grants
  add constraint platform_role_grants_auth_user_id_fkey
  foreign key (auth_user_id) references platform_users(auth_user_id) on delete restrict;

create unique index if not exists platform_role_grants_one_active_idx
  on platform_role_grants(auth_user_id, role_slug)
  where revoked_at is null;

-- Invite audit only. The passwordless token remains exclusively in the auth
-- provider and must never be copied into application tables.
create table if not exists passwordless_account_invites (
  id bigint generated always as identity primary key,
  member_id uuid references ruined_members(id) on delete restrict,
  email_normalized text not null,
  intended_user_type text not null default 'member'
    check (intended_user_type in ('member', 'staff')),
  invited_by_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  accepted_by_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  invited_at timestamptz not null default now(),
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  provider_reference text unique,
  created_at timestamptz not null default now(),
  check (email_normalized = lower(btrim(email_normalized))),
  check (expires_at is null or expires_at > invited_at),
  check (accepted_at is null or accepted_at >= invited_at),
  check (revoked_at is null or revoked_at >= invited_at)
);

create index if not exists passwordless_account_invites_email_idx
  on passwordless_account_invites(email_normalized, invited_at desc);

-- These dimensions are independent by design. Stripe may change billing_state
-- only; account access and program participation remain app-owned decisions.
create table if not exists member_lifecycle (
  member_id uuid primary key references ruined_members(id) on delete restrict,
  account_state text not null default 'provisional'
    check (account_state in ('provisional', 'invited', 'active', 'suspended', 'closed')),
  billing_state text not null default 'pending'
    check (billing_state in ('pending', 'active', 'attention_required', 'ended')),
  program_state text not null default 'prospect'
    check (program_state in ('prospect', 'onboarding', 'active', 'paused', 'completed', 'withdrawn')),
  foundations_state text not null default 'not_started'
    check (foundations_state in ('not_started', 'in_progress', 'completed')),
  artifact_state text not null default 'not_started'
    check (artifact_state in ('not_started', 'collecting', 'in_production', 'fulfilled')),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table if not exists member_state_history (
  id bigint generated always as identity primary key,
  member_id uuid not null references ruined_members(id) on delete restrict,
  dimension text not null
    check (dimension in ('account', 'billing', 'program', 'foundations', 'artifact')),
  previous_state text,
  next_state text not null,
  reason_code text,
  source text not null
    check (source in ('migration', 'member', 'ops', 'stripe', 'system')),
  source_event_id text,
  actor_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  correlation_id text,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists member_state_history_member_idx
  on member_state_history(member_id, occurred_at desc);

alter table member_state_history
  drop constraint if exists member_state_history_source_check;
alter table member_state_history
  add constraint member_state_history_source_check
  check (source in ('migration', 'member', 'ops', 'stripe', 'system'));

create table if not exists member_consents (
  id bigint generated always as identity primary key,
  member_id uuid not null references ruined_members(id) on delete restrict,
  consent_type text not null
    check (consent_type in ('membership_agreement', 'age_attestation', 'privacy', 'communications')),
  policy_version text not null,
  decision text not null default 'accepted'
    check (decision in ('accepted', 'withdrawn')),
  accepted_at timestamptz not null,
  source text not null default 'member'
    check (source in ('migration', 'checkout', 'member', 'ops')),
  actor_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  check (consent_type not in ('membership_agreement', 'age_attestation') or decision = 'accepted')
);

create index if not exists member_consents_member_idx
  on member_consents(member_id, consent_type, accepted_at desc);

create table if not exists circles (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  capacity integer not null default 10 check (capacity > 0),
  status text not null default 'forming'
    check (status in ('forming', 'active', 'completed', 'archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create table if not exists circle_member_assignments (
  id bigint generated always as identity primary key,
  circle_id uuid not null references circles(id) on delete restrict,
  member_id uuid not null references ruined_members(id) on delete restrict,
  assigned_by_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= assigned_at)
);

create unique index if not exists circle_member_assignments_one_active_idx
  on circle_member_assignments(member_id)
  where ended_at is null;

create index if not exists circle_member_assignments_circle_idx
  on circle_member_assignments(circle_id, ended_at);

create table if not exists circle_staff_assignments (
  id bigint generated always as identity primary key,
  circle_id uuid not null references circles(id) on delete restrict,
  auth_user_id uuid not null references platform_users(auth_user_id) on delete restrict,
  role_slug text not null references platform_roles(role_slug) on delete restrict,
  assigned_by_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  check (role_slug in ('guide', 'circle_leader')),
  check (ended_at is null or ended_at >= assigned_at)
);

create unique index if not exists circle_staff_assignments_one_active_role_idx
  on circle_staff_assignments(circle_id, auth_user_id, role_slug)
  where ended_at is null;

create unique index if not exists circle_staff_assignments_one_leader_idx
  on circle_staff_assignments(circle_id)
  where role_slug = 'circle_leader' and ended_at is null;

create table if not exists foundation_programs (
  id uuid primary key,
  slug text not null unique,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists foundation_versions (
  id uuid primary key,
  foundation_program_id uuid not null references foundation_programs(id) on delete restrict,
  version integer not null check (version > 0),
  title text not null,
  summary text,
  configuration jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired')),
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (foundation_program_id, version),
  unique (id, foundation_program_id),
  check (status = 'draft' or published_at is not null),
  check (retired_at is null or published_at is null or retired_at >= published_at)
);

create table if not exists foundation_units (
  id uuid primary key,
  foundation_version_id uuid not null references foundation_versions(id) on delete restrict,
  unit_slug text not null,
  position integer not null check (position > 0),
  title text not null,
  is_required boolean not null default true,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (foundation_version_id, unit_slug),
  unique (foundation_version_id, position),
  unique (id, foundation_version_id)
);

create table if not exists foundation_enrollments (
  id uuid primary key,
  member_id uuid not null references ruined_members(id) on delete restrict,
  foundation_version_id uuid not null references foundation_versions(id) on delete restrict,
  progress_percent numeric(5,2) not null default 0
    check (progress_percent >= 0 and progress_percent <= 100),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'paused', 'completed', 'withdrawn')),
  enrolled_by_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  enrolled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, foundation_version_id),
  check (completed_at is null or started_at is null or completed_at >= started_at),
  check (status <> 'completed' or progress_percent = 100)
);

create unique index if not exists foundation_enrollments_one_active_idx
  on foundation_enrollments(member_id)
  where status in ('not_started', 'in_progress', 'paused');

create index if not exists foundation_enrollments_member_idx
  on foundation_enrollments(member_id, enrolled_at desc);

create table if not exists foundation_unit_progress (
  enrollment_id uuid not null,
  unit_id uuid not null,
  foundation_version_id uuid not null,
  progress_percent numeric(5,2) not null default 0
    check (progress_percent >= 0 and progress_percent <= 100),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'submitted', 'completed', 'blocked')),
  started_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  reviewed_by_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (enrollment_id, unit_id),
  foreign key (enrollment_id, foundation_version_id)
    references foundation_enrollments(id, foundation_version_id) on delete restrict,
  foreign key (unit_id, foundation_version_id)
    references foundation_units(id, foundation_version_id) on delete restrict,
  check (status <> 'completed' or progress_percent = 100)
);

create table if not exists foundation_submissions (
  id bigint generated always as identity primary key,
  enrollment_id uuid not null,
  unit_id uuid not null,
  foundation_version_id uuid not null,
  submission_version integer not null check (submission_version > 0),
  payload jsonb not null,
  submitted_by_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  submitted_at timestamptz not null default now(),
  unique (enrollment_id, unit_id, submission_version),
  foreign key (enrollment_id, foundation_version_id)
    references foundation_enrollments(id, foundation_version_id) on delete restrict,
  foreign key (unit_id, foundation_version_id)
    references foundation_units(id, foundation_version_id) on delete restrict
);

create table if not exists foundation_submission_reviews (
  id bigint generated always as identity primary key,
  foundation_submission_id bigint not null references foundation_submissions(id) on delete restrict,
  review_state text not null
    check (review_state in ('accepted', 'changes_requested')),
  feedback text,
  reviewed_by_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  reviewed_at timestamptz not null default now()
);

create table if not exists membership_offers (
  id uuid primary key,
  offer_slug text not null unique,
  name text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists membership_prices (
  id uuid primary key,
  membership_offer_id uuid not null references membership_offers(id) on delete restrict,
  livemode boolean not null default false,
  stripe_product_id text,
  stripe_price_id text,
  currency text not null,
  unit_amount bigint,
  billing_interval text
    check (billing_interval is null or billing_interval in ('month', 'year')),
  interval_count integer not null default 1 check (interval_count > 0),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  is_default boolean not null default false,
  effective_from timestamptz,
  effective_to timestamptz,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (currency = lower(currency) and currency ~ '^[a-z]{3}$'),
  check (unit_amount is null or unit_amount >= 0),
  check (
    status = 'draft'
    or (stripe_product_id is not null and stripe_price_id is not null and unit_amount is not null)
  ),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create unique index if not exists membership_prices_stripe_price_idx
  on membership_prices(livemode, stripe_price_id)
  where stripe_price_id is not null;

create unique index if not exists membership_prices_one_default_idx
  on membership_prices(membership_offer_id, livemode)
  where is_default and status = 'active';

create table if not exists artifact_templates (
  id uuid primary key,
  template_slug text not null unique,
  name text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists artifact_template_versions (
  id uuid primary key,
  artifact_template_id uuid not null references artifact_templates(id) on delete restrict,
  version integer not null check (version > 0),
  name text not null,
  input_schema jsonb not null default '{}'::jsonb,
  production_specification jsonb not null default '{}'::jsonb,
  fulfillment_configuration jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired')),
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artifact_template_id, version),
  check (status = 'draft' or published_at is not null),
  check (retired_at is null or published_at is null or retired_at >= published_at)
);

create table if not exists artifact_jobs (
  id uuid primary key,
  member_id uuid not null references ruined_members(id) on delete restrict,
  artifact_template_version_id uuid not null references artifact_template_versions(id) on delete restrict,
  status text not null default 'requested'
    check (status in ('requested', 'collecting', 'ready_for_production', 'in_production', 'review', 'ready', 'fulfilled', 'canceled')),
  priority integer not null default 0,
  assigned_to_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  input_snapshot jsonb not null default '{}'::jsonb,
  production_snapshot jsonb not null default '{}'::jsonb,
  fulfillment_address_snapshot jsonb,
  idempotency_key text unique,
  external_reference text,
  requested_at timestamptz not null default now(),
  production_started_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table artifact_jobs
  add column if not exists production_started_at timestamptz;

create index if not exists artifact_jobs_member_idx
  on artifact_jobs(member_id, requested_at desc);

create index if not exists artifact_jobs_ops_queue_idx
  on artifact_jobs(status, priority desc, due_at);

create table if not exists artifact_assets (
  id uuid primary key,
  artifact_job_id uuid not null references artifact_jobs(id) on delete restrict,
  asset_kind text not null
    check (asset_kind in ('source', 'proof', 'production', 'final', 'shipping')),
  storage_bucket text not null,
  storage_path text not null,
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 text,
  asset_version integer not null default 1 check (asset_version > 0),
  created_by_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (artifact_job_id, storage_bucket, storage_path, asset_version)
);

create table if not exists artifact_job_events (
  id bigint generated always as identity primary key,
  artifact_job_id uuid not null references artifact_jobs(id) on delete restrict,
  previous_status text,
  next_status text not null,
  reason_code text,
  actor_auth_user_id uuid references platform_users(auth_user_id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists artifact_job_events_job_idx
  on artifact_job_events(artifact_job_id, occurred_at desc);

create table if not exists integration_entity_links (
  id bigint generated always as identity primary key,
  provider text not null
    check (provider in ('stripe', 'shopify', 'supabase', 'google')),
  local_entity_type text not null,
  local_entity_id text not null,
  external_entity_type text not null,
  external_entity_id text not null,
  livemode boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table integration_entity_links
  drop constraint if exists integration_entity_links_provider_check;
alter table integration_entity_links
  add constraint integration_entity_links_provider_check
  check (provider in ('stripe', 'shopify', 'supabase', 'google'));

do $$
begin
  if exists (
    select 1
    from public.integration_entity_links
    where livemode is null
  ) then
    raise exception 'Existing integration links must be explicitly classified as test or live before migration.';
  end if;
end;
$$;

alter table integration_entity_links
  alter column livemode set default false,
  alter column livemode set not null;

-- Remove anonymous UNIQUE constraints from an earlier local draft before
-- installing explicit mode-aware indexes. The primary key is not contype 'u'.
do $$
declare
  unique_constraint record;
begin
  for unique_constraint in
    select constraint_record.conname
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.integration_entity_links'::regclass
      and constraint_record.contype = 'u'
      and pg_get_constraintdef(constraint_record.oid) in (
        'UNIQUE (provider, local_entity_type, local_entity_id, external_entity_type)',
        'UNIQUE (provider, external_entity_type, external_entity_id)',
        'UNIQUE (provider, local_entity_type, local_entity_id, external_entity_type, livemode)',
        'UNIQUE (provider, external_entity_type, external_entity_id, livemode)'
      )
  loop
    execute format(
      'alter table public.integration_entity_links drop constraint %I',
      unique_constraint.conname
    );
  end loop;
end;
$$;

create unique index if not exists integration_entity_links_local_mode_idx
  on integration_entity_links(
    provider,
    local_entity_type,
    local_entity_id,
    external_entity_type,
    livemode
  );

create unique index if not exists integration_entity_links_external_mode_idx
  on integration_entity_links(provider, external_entity_type, external_entity_id, livemode);

-- This is an at-least-once delivery queue. Workers must claim rows with
-- FOR UPDATE SKIP LOCKED and make destination updates idempotent by dedupe_key.
create table if not exists integration_outbox (
  id bigint generated always as identity primary key,
  destination text not null
    check (destination in ('shopify', 'stripe', 'google', 'resend')),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table integration_outbox
  drop constraint if exists integration_outbox_destination_check;
alter table integration_outbox
  add constraint integration_outbox_destination_check
  check (destination in ('shopify', 'stripe', 'google', 'resend'));

create index if not exists integration_outbox_delivery_idx
  on integration_outbox(status, available_at, id)
  where status in ('pending', 'failed');

-- PostgreSQL does not index referencing columns automatically. Keep complete,
-- non-partial indexes for every FK path so parent updates/deletes and RLS joins
-- do not scan or broadly lock child tables.
create index if not exists platform_role_grants_auth_user_idx
  on platform_role_grants(auth_user_id);
create index if not exists platform_role_grants_granted_by_idx
  on platform_role_grants(granted_by_auth_user_id);
create index if not exists platform_role_grants_role_idx
  on platform_role_grants(role_slug);

create index if not exists passwordless_account_invites_member_idx
  on passwordless_account_invites(member_id);
create index if not exists passwordless_account_invites_invited_by_idx
  on passwordless_account_invites(invited_by_auth_user_id);
create index if not exists passwordless_account_invites_accepted_by_idx
  on passwordless_account_invites(accepted_by_auth_user_id);

create index if not exists member_state_history_actor_idx
  on member_state_history(actor_auth_user_id);
create index if not exists member_consents_actor_idx
  on member_consents(actor_auth_user_id);

create index if not exists circle_member_assignments_member_full_idx
  on circle_member_assignments(member_id);
create index if not exists circle_member_assignments_assigned_by_idx
  on circle_member_assignments(assigned_by_auth_user_id);
create index if not exists circle_staff_assignments_circle_full_idx
  on circle_staff_assignments(circle_id);
create index if not exists circle_staff_assignments_auth_user_idx
  on circle_staff_assignments(auth_user_id);
create index if not exists circle_staff_assignments_role_idx
  on circle_staff_assignments(role_slug);
create index if not exists circle_staff_assignments_assigned_by_idx
  on circle_staff_assignments(assigned_by_auth_user_id);

create index if not exists foundation_enrollments_version_idx
  on foundation_enrollments(foundation_version_id);
create index if not exists foundation_enrollments_enrolled_by_idx
  on foundation_enrollments(enrolled_by_auth_user_id);
create index if not exists foundation_unit_progress_enrollment_version_idx
  on foundation_unit_progress(enrollment_id, foundation_version_id);
create index if not exists foundation_unit_progress_unit_version_idx
  on foundation_unit_progress(unit_id, foundation_version_id);
create index if not exists foundation_unit_progress_reviewed_by_idx
  on foundation_unit_progress(reviewed_by_auth_user_id);
create index if not exists foundation_submissions_enrollment_version_idx
  on foundation_submissions(enrollment_id, foundation_version_id);
create index if not exists foundation_submissions_unit_version_idx
  on foundation_submissions(unit_id, foundation_version_id);
create index if not exists foundation_submissions_submitted_by_idx
  on foundation_submissions(submitted_by_auth_user_id);
create index if not exists foundation_submission_reviews_submission_idx
  on foundation_submission_reviews(foundation_submission_id);
create index if not exists foundation_submission_reviews_reviewed_by_idx
  on foundation_submission_reviews(reviewed_by_auth_user_id);

create index if not exists membership_prices_offer_idx
  on membership_prices(membership_offer_id);

create index if not exists artifact_jobs_template_version_idx
  on artifact_jobs(artifact_template_version_id);
create index if not exists artifact_jobs_assigned_to_idx
  on artifact_jobs(assigned_to_auth_user_id);
create index if not exists artifact_assets_created_by_idx
  on artifact_assets(created_by_auth_user_id);
create index if not exists artifact_job_events_actor_idx
  on artifact_job_events(actor_auth_user_id);

-- Serialize active Circle member assignment counts under concurrent writes.
create or replace function ruined_enforce_circle_capacity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  allowed_capacity integer;
  active_count integer;
begin
  if new.ended_at is not null then
    return new;
  end if;

  -- A real row update, rather than only SELECT FOR UPDATE, also forces a
  -- serialization failure under REPEATABLE READ if a competing capacity change
  -- used an older snapshot.
  update public.circles
  set updated_at = now()
  where id = new.circle_id
  returning capacity into allowed_capacity;

  if allowed_capacity is null then
    raise exception 'Circle % does not exist.', new.circle_id;
  end if;

  select count(*)
  into active_count
  from public.circle_member_assignments assignment
  where assignment.circle_id = new.circle_id
    and assignment.ended_at is null
    and (tg_op = 'INSERT' or assignment.id <> new.id);

  if active_count >= allowed_capacity then
    raise exception 'Circle % has reached its capacity of %.', new.circle_id, allowed_capacity;
  end if;

  return new;
end;
$$;

drop trigger if exists circle_member_assignments_capacity on circle_member_assignments;
create trigger circle_member_assignments_capacity
before insert or update of circle_id, ended_at
on circle_member_assignments
for each row execute function ruined_enforce_circle_capacity();

-- Assignment writes and capacity changes serialize on the same Circle row.
-- This prevents a capacity reduction from committing below the active count,
-- including when it waits behind a concurrent accepted assignment.
create or replace function ruined_enforce_circle_capacity_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  active_count integer;
begin
  if new.capacity = old.capacity then
    return new;
  end if;

  select count(*)
  into active_count
  from public.circle_member_assignments assignment
  where assignment.circle_id = old.id
    and assignment.ended_at is null;

  if new.capacity < active_count then
    raise exception 'Circle % has % active members; capacity cannot be reduced to %.',
      old.id,
      active_count,
      new.capacity;
  end if;

  return new;
end;
$$;

drop trigger if exists circles_capacity_guard on circles;
create trigger circles_capacity_guard
before update of capacity on circles
for each row execute function ruined_enforce_circle_capacity_change();

lock table public.circles in share row exclusive mode;
lock table public.circle_member_assignments in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.circles circle_record
    left join public.circle_member_assignments assignment
      on assignment.circle_id = circle_record.id
      and assignment.ended_at is null
    group by circle_record.id, circle_record.capacity
    having count(assignment.id) > circle_record.capacity
  ) then
    raise exception 'Existing Circle assignments exceed configured capacity.';
  end if;
end;
$$;

create or replace function ruined_reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only; % is not permitted.', tg_table_name, tg_op;
end;
$$;

drop trigger if exists member_state_history_append_only on member_state_history;
create trigger member_state_history_append_only
before update or delete on member_state_history
for each row execute function ruined_reject_append_only_mutation();

drop trigger if exists member_consents_append_only on member_consents;
create trigger member_consents_append_only
before update or delete on member_consents
for each row execute function ruined_reject_append_only_mutation();

drop trigger if exists platform_role_grants_no_delete on platform_role_grants;
create trigger platform_role_grants_no_delete
before delete on platform_role_grants
for each row execute function ruined_reject_append_only_mutation();

drop trigger if exists foundation_submissions_append_only on foundation_submissions;
create trigger foundation_submissions_append_only
before update or delete on foundation_submissions
for each row execute function ruined_reject_append_only_mutation();

drop trigger if exists foundation_submission_reviews_append_only on foundation_submission_reviews;
create trigger foundation_submission_reviews_append_only
before update or delete on foundation_submission_reviews
for each row execute function ruined_reject_append_only_mutation();

drop trigger if exists artifact_job_events_append_only on artifact_job_events;
create trigger artifact_job_events_append_only
before update or delete on artifact_job_events
for each row execute function ruined_reject_append_only_mutation();

drop trigger if exists artifact_assets_append_only on artifact_assets;
create trigger artifact_assets_append_only
before update or delete on artifact_assets
for each row execute function ruined_reject_append_only_mutation();

create or replace function ruined_protect_foundation_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('published', 'retired') then
      raise exception 'Published Foundation versions cannot be deleted.';
    end if;
    return old;
  end if;

  if old.status in ('published', 'retired') and (
    new.foundation_program_id is distinct from old.foundation_program_id
    or new.version is distinct from old.version
    or new.title is distinct from old.title
    or new.summary is distinct from old.summary
    or new.configuration is distinct from old.configuration
    or new.published_at is distinct from old.published_at
  ) then
    raise exception 'Published Foundation version content is immutable; publish a new version.';
  end if;

  if old.status = 'published' and new.status not in ('published', 'retired') then
    raise exception 'Published Foundation versions may only remain published or be retired.';
  end if;

  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'Retired Foundation versions cannot be reactivated.';
  end if;

  return new;
end;
$$;

drop trigger if exists foundation_versions_immutable on foundation_versions;
create trigger foundation_versions_immutable
before update or delete on foundation_versions
for each row execute function ruined_protect_foundation_version();

create or replace function ruined_protect_foundation_unit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  parent_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status into parent_status
    from public.foundation_versions
    where id = old.foundation_version_id
    for update;

    if parent_status in ('published', 'retired') then
      raise exception 'Units in a published Foundation version are immutable.';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select status into parent_status
    from public.foundation_versions
    where id = new.foundation_version_id
    for update;

    if parent_status in ('published', 'retired') then
      raise exception 'Units cannot be added or moved into a published Foundation version.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists foundation_units_immutable on foundation_units;
create trigger foundation_units_immutable
before insert or update or delete on foundation_units
for each row execute function ruined_protect_foundation_unit();

create or replace function ruined_require_published_foundation_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  parent_status text;
begin
  select status into parent_status
  from public.foundation_versions
  where id = new.foundation_version_id
  for share;

  if parent_status is distinct from 'published' then
    raise exception 'Foundation enrollments require a published Foundation version.';
  end if;

  return new;
end;
$$;

drop trigger if exists foundation_enrollments_published_version on foundation_enrollments;
create trigger foundation_enrollments_published_version
before insert or update of foundation_version_id on foundation_enrollments
for each row execute function ruined_require_published_foundation_version();

do $$
begin
  if exists (
    select 1
    from public.foundation_enrollments enrollment
    join public.foundation_versions version_record
      on version_record.id = enrollment.foundation_version_id
    where version_record.status = 'draft'
  ) then
    raise exception 'Existing Foundation enrollments reference a draft version.';
  end if;
end;
$$;

create or replace function ruined_protect_membership_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('active', 'retired') then
      raise exception 'Activated membership prices cannot be deleted.';
    end if;
    return old;
  end if;

  if old.status in ('active', 'retired') and (
    new.membership_offer_id is distinct from old.membership_offer_id
    or new.livemode is distinct from old.livemode
    or new.stripe_product_id is distinct from old.stripe_product_id
    or new.stripe_price_id is distinct from old.stripe_price_id
    or new.currency is distinct from old.currency
    or new.unit_amount is distinct from old.unit_amount
    or new.billing_interval is distinct from old.billing_interval
    or new.interval_count is distinct from old.interval_count
    or new.effective_from is distinct from old.effective_from
    or new.configuration is distinct from old.configuration
  ) then
    raise exception 'Activated membership price terms are immutable; create a replacement price.';
  end if;

  if old.status = 'active' and new.status not in ('active', 'retired') then
    raise exception 'Activated membership prices may only remain active or be retired.';
  end if;

  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'Retired membership prices cannot be reactivated.';
  end if;

  return new;
end;
$$;

drop trigger if exists membership_prices_immutable on membership_prices;
create trigger membership_prices_immutable
before update or delete on membership_prices
for each row execute function ruined_protect_membership_price();

create or replace function ruined_protect_artifact_template_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('published', 'retired') then
      raise exception 'Published Artifact template versions cannot be deleted.';
    end if;
    return old;
  end if;

  if old.status in ('published', 'retired') and (
    new.artifact_template_id is distinct from old.artifact_template_id
    or new.version is distinct from old.version
    or new.name is distinct from old.name
    or new.input_schema is distinct from old.input_schema
    or new.production_specification is distinct from old.production_specification
    or new.fulfillment_configuration is distinct from old.fulfillment_configuration
    or new.published_at is distinct from old.published_at
  ) then
    raise exception 'Published Artifact template content is immutable; publish a new version.';
  end if;

  if old.status = 'published' and new.status not in ('published', 'retired') then
    raise exception 'Published Artifact template versions may only remain published or be retired.';
  end if;

  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'Retired Artifact template versions cannot be reactivated.';
  end if;

  return new;
end;
$$;

drop trigger if exists artifact_template_versions_immutable on artifact_template_versions;
create trigger artifact_template_versions_immutable
before update or delete on artifact_template_versions
for each row execute function ruined_protect_artifact_template_version();

create or replace function ruined_protect_artifact_job_record()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  template_status text;
begin
  if tg_op = 'INSERT' then
    select status into template_status
    from public.artifact_template_versions
    where id = new.artifact_template_version_id
    for share;

    if template_status is distinct from 'published' then
      raise exception 'Artifact jobs require a published Artifact template version.';
    end if;

    if new.status = 'fulfilled' and new.completed_at is null then
      raise exception 'Fulfilled Artifact jobs require completed_at.';
    end if;

    if new.status in ('in_production', 'review', 'ready', 'fulfilled')
      and new.production_started_at is null then
      new.production_started_at := now();
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Artifact jobs are durable production records; cancel rather than delete them.';
  end if;

  if new.member_id is distinct from old.member_id then
    raise exception 'Artifact jobs cannot be reassigned to another member.';
  end if;

  if new.artifact_template_version_id is distinct from old.artifact_template_version_id then
    raise exception 'Artifact jobs must remain pinned to their original template version.';
  end if;

  if old.status in ('fulfilled', 'canceled') and new is distinct from old then
    raise exception 'Fulfilled and canceled Artifact jobs are immutable.';
  end if;

  if old.production_started_at is not null
    and new.production_started_at is distinct from old.production_started_at then
    raise exception 'Artifact production start is immutable once recorded.';
  end if;

  if old.production_started_at is not null and (
    new.input_snapshot is distinct from old.input_snapshot
    or new.production_snapshot is distinct from old.production_snapshot
    or new.fulfillment_address_snapshot is distinct from old.fulfillment_address_snapshot
  ) then
    raise exception 'Artifact production snapshots are immutable after production begins.';
  end if;

  if old.production_started_at is null
    and new.status in ('in_production', 'review', 'ready', 'fulfilled') then
    new.production_started_at := now();
  end if;

  if new.status = 'fulfilled' and new.completed_at is null then
    raise exception 'Fulfilled Artifact jobs require completed_at.';
  end if;

  return new;
end;
$$;

drop trigger if exists artifact_jobs_identity_immutable on artifact_jobs;
drop trigger if exists artifact_jobs_record_guard on artifact_jobs;
create trigger artifact_jobs_record_guard
before insert or update or delete on artifact_jobs
for each row execute function ruined_protect_artifact_job_record();

do $$
begin
  if exists (
    select 1
    from public.artifact_jobs job
    join public.artifact_template_versions template_version
      on template_version.id = job.artifact_template_version_id
    where template_version.status = 'draft'
  ) then
    raise exception 'Existing Artifact jobs reference a draft template version.';
  end if;

  if exists (
    select 1
    from public.artifact_jobs job
    where job.status = 'fulfilled'
      and job.completed_at is null
  ) then
    raise exception 'Existing fulfilled Artifact jobs are missing completed_at.';
  end if;

  if exists (
    select 1
    from public.artifact_jobs job
    where job.status in ('in_production', 'review', 'ready', 'fulfilled')
      and job.production_started_at is null
  ) then
    raise exception 'Existing production-stage Artifact jobs are missing production_started_at.';
  end if;
end;
$$;

-- Backfill the new lifecycle projection without claiming account, program,
-- Foundations, or Artifact activation. Existing Stripe-derived state maps only
-- to billing_state.
insert into member_lifecycle (
  member_id,
  account_state,
  billing_state,
  program_state,
  foundations_state,
  artifact_state,
  version,
  updated_at
)
select
  member.id,
  'provisional',
  member.membership_state,
  'prospect',
  'not_started',
  'not_started',
  1,
  member.updated_at
from ruined_members member
on conflict (member_id) do nothing;

insert into member_state_history (
  member_id,
  dimension,
  previous_state,
  next_state,
  reason_code,
  source,
  metadata,
  dedupe_key,
  occurred_at
)
select
  member.id,
  initial_state.dimension,
  null,
  initial_state.state,
  'platform_foundation_backfill',
  'migration',
  jsonb_build_object('source_table', 'ruined_members'),
  'platform-foundation-backfill:' || member.id::text || ':' || initial_state.dimension,
  member.updated_at
from ruined_members member
cross join lateral (
  values
    ('account'::text, 'provisional'::text),
    ('billing'::text, member.membership_state::text),
    ('program'::text, 'prospect'::text),
    ('foundations'::text, 'not_started'::text),
    ('artifact'::text, 'not_started'::text)
) as initial_state(dimension, state)
on conflict (dedupe_key) do nothing;

insert into member_consents (
  member_id,
  consent_type,
  policy_version,
  decision,
  accepted_at,
  source,
  evidence,
  dedupe_key
)
select
  member.id,
  'membership_agreement',
  coalesce(nullif(member.agreement_version, ''), 'legacy-unspecified'),
  'accepted',
  member.agreement_accepted_at,
  'migration',
  jsonb_build_object('source_column', 'agreement_accepted_at'),
  'platform-foundation-consent:' || member.id::text || ':membership-agreement:' ||
    coalesce(nullif(member.agreement_version, ''), 'legacy-unspecified')
from ruined_members member
where member.agreement_accepted_at is not null
on conflict (dedupe_key) do nothing;

insert into member_consents (
  member_id,
  consent_type,
  policy_version,
  decision,
  accepted_at,
  source,
  evidence,
  dedupe_key
)
select
  member.id,
  'age_attestation',
  'legacy-unspecified-threshold',
  'accepted',
  member.age_attested_at,
  'migration',
  jsonb_build_object(
    'source_column', 'age_attested_at',
    'minimum_age', null,
    'requires_policy_confirmation', true
  ),
  'platform-foundation-consent:' || member.id::text || ':age-attestation:legacy-unspecified-threshold'
from ruined_members member
where member.age_attested_at is not null
on conflict (dedupe_key) do nothing;

-- Provider-neutral auth helpers for RLS. Keep the privileged lookup outside
-- Supabase's exposed schemas so it cannot become a public RPC surface.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.ruined_current_auth_user_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  subject text;
begin
  subject := nullif(current_setting('request.jwt.claim.sub', true), '');
  if subject is null then
    subject := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
  end if;
  if subject is null then
    return null;
  end if;
  return subject::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function private.ruined_current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select platform_user.member_id
  from public.platform_users platform_user
  where platform_user.auth_user_id = private.ruined_current_auth_user_id()
    and platform_user.status = 'active'
  limit 1
$$;

revoke all on function private.ruined_current_auth_user_id() from public, anon, authenticated;
revoke all on function private.ruined_current_member_id() from public, anon, authenticated;
grant execute on function private.ruined_current_auth_user_id() to authenticated;
grant execute on function private.ruined_current_member_id() to authenticated;

-- RLS defaults to server-only. Only explicitly listed self-read surfaces receive
-- a SELECT policy; there are no client write policies in this foundation.
alter table platform_users enable row level security;
alter table user_profiles enable row level security;
alter table member_private_profiles enable row level security;
alter table platform_roles enable row level security;
alter table platform_role_grants enable row level security;
alter table passwordless_account_invites enable row level security;
alter table member_lifecycle enable row level security;
alter table member_state_history enable row level security;
alter table member_consents enable row level security;
alter table circles enable row level security;
alter table circle_member_assignments enable row level security;
alter table circle_staff_assignments enable row level security;
alter table foundation_programs enable row level security;
alter table foundation_versions enable row level security;
alter table foundation_units enable row level security;
alter table foundation_enrollments enable row level security;
alter table foundation_unit_progress enable row level security;
alter table foundation_submissions enable row level security;
alter table foundation_submission_reviews enable row level security;
alter table membership_offers enable row level security;
alter table membership_prices enable row level security;
alter table artifact_templates enable row level security;
alter table artifact_template_versions enable row level security;
alter table artifact_jobs enable row level security;
alter table artifact_assets enable row level security;
alter table artifact_job_events enable row level security;
alter table integration_entity_links enable row level security;
alter table integration_outbox enable row level security;

-- Grants are the first Data API boundary; RLS only filters rows after a role
-- has object access. Normalize old and new Supabase project defaults, then
-- restore read-only access to the explicitly member-facing surfaces.
revoke all on table
  platform_users,
  user_profiles,
  member_private_profiles,
  platform_roles,
  platform_role_grants,
  passwordless_account_invites,
  member_lifecycle,
  member_state_history,
  member_consents,
  circles,
  circle_member_assignments,
  circle_staff_assignments,
  foundation_programs,
  foundation_versions,
  foundation_units,
  foundation_enrollments,
  foundation_unit_progress,
  foundation_submissions,
  foundation_submission_reviews,
  membership_offers,
  membership_prices,
  artifact_templates,
  artifact_template_versions,
  artifact_jobs,
  artifact_assets,
  artifact_job_events,
  integration_entity_links,
  integration_outbox
from anon, authenticated;

grant select on table
  platform_users,
  user_profiles,
  member_private_profiles,
  member_lifecycle,
  member_state_history,
  member_consents,
  circles,
  circle_member_assignments,
  foundation_programs,
  foundation_versions,
  foundation_units,
  foundation_enrollments,
  foundation_unit_progress,
  foundation_submissions,
  foundation_submission_reviews,
  artifact_templates,
  artifact_template_versions,
  artifact_jobs,
  artifact_assets,
  artifact_job_events
to authenticated;

drop policy if exists platform_users_select_self on platform_users;
create policy platform_users_select_self
on platform_users for select
to authenticated
using (auth_user_id = private.ruined_current_auth_user_id());

drop policy if exists user_profiles_select_self on user_profiles;
create policy user_profiles_select_self
on user_profiles for select
to authenticated
using (auth_user_id = private.ruined_current_auth_user_id());

drop policy if exists member_private_profiles_select_self on member_private_profiles;
create policy member_private_profiles_select_self
on member_private_profiles for select
to authenticated
using (member_id = private.ruined_current_member_id());

drop policy if exists member_lifecycle_select_self on member_lifecycle;
create policy member_lifecycle_select_self
on member_lifecycle for select
to authenticated
using (member_id = private.ruined_current_member_id());

drop policy if exists member_state_history_select_self on member_state_history;
create policy member_state_history_select_self
on member_state_history for select
to authenticated
using (member_id = private.ruined_current_member_id());

drop policy if exists member_consents_select_self on member_consents;
create policy member_consents_select_self
on member_consents for select
to authenticated
using (member_id = private.ruined_current_member_id());

drop policy if exists circle_member_assignments_select_self on circle_member_assignments;
create policy circle_member_assignments_select_self
on circle_member_assignments for select
to authenticated
using (member_id = private.ruined_current_member_id());

drop policy if exists circles_select_assigned on circles;
create policy circles_select_assigned
on circles for select
to authenticated
using (
  exists (
    select 1
    from circle_member_assignments assignment
    where assignment.circle_id = circles.id
      and assignment.member_id = private.ruined_current_member_id()
      and assignment.ended_at is null
  )
);

drop policy if exists foundation_enrollments_select_self on foundation_enrollments;
create policy foundation_enrollments_select_self
on foundation_enrollments for select
to authenticated
using (member_id = private.ruined_current_member_id());

drop policy if exists foundation_versions_select_enrolled on foundation_versions;
create policy foundation_versions_select_enrolled
on foundation_versions for select
to authenticated
using (
  exists (
    select 1
    from foundation_enrollments enrollment
    where enrollment.foundation_version_id = foundation_versions.id
      and enrollment.member_id = private.ruined_current_member_id()
  )
);

drop policy if exists foundation_programs_select_enrolled on foundation_programs;
create policy foundation_programs_select_enrolled
on foundation_programs for select
to authenticated
using (
  exists (
    select 1
    from foundation_versions version_record
    join foundation_enrollments enrollment
      on enrollment.foundation_version_id = version_record.id
    where version_record.foundation_program_id = foundation_programs.id
      and enrollment.member_id = private.ruined_current_member_id()
  )
);

drop policy if exists foundation_units_select_enrolled on foundation_units;
create policy foundation_units_select_enrolled
on foundation_units for select
to authenticated
using (
  exists (
    select 1
    from foundation_enrollments enrollment
    where enrollment.foundation_version_id = foundation_units.foundation_version_id
      and enrollment.member_id = private.ruined_current_member_id()
  )
);

drop policy if exists foundation_unit_progress_select_self on foundation_unit_progress;
create policy foundation_unit_progress_select_self
on foundation_unit_progress for select
to authenticated
using (
  exists (
    select 1
    from foundation_enrollments enrollment
    where enrollment.id = foundation_unit_progress.enrollment_id
      and enrollment.member_id = private.ruined_current_member_id()
  )
);

drop policy if exists foundation_submissions_select_self on foundation_submissions;
create policy foundation_submissions_select_self
on foundation_submissions for select
to authenticated
using (
  exists (
    select 1
    from foundation_enrollments enrollment
    where enrollment.id = foundation_submissions.enrollment_id
      and enrollment.member_id = private.ruined_current_member_id()
  )
);

drop policy if exists foundation_submission_reviews_select_self on foundation_submission_reviews;
create policy foundation_submission_reviews_select_self
on foundation_submission_reviews for select
to authenticated
using (
  exists (
    select 1
    from foundation_submissions submission
    join foundation_enrollments enrollment
      on enrollment.id = submission.enrollment_id
    where submission.id = foundation_submission_reviews.foundation_submission_id
      and enrollment.member_id = private.ruined_current_member_id()
  )
);

drop policy if exists artifact_jobs_select_self on artifact_jobs;
create policy artifact_jobs_select_self
on artifact_jobs for select
to authenticated
using (member_id = private.ruined_current_member_id());

drop policy if exists artifact_assets_select_self on artifact_assets;
create policy artifact_assets_select_self
on artifact_assets for select
to authenticated
using (
  exists (
    select 1
    from artifact_jobs job
    where job.id = artifact_assets.artifact_job_id
      and job.member_id = private.ruined_current_member_id()
  )
);

drop policy if exists artifact_job_events_select_self on artifact_job_events;
create policy artifact_job_events_select_self
on artifact_job_events for select
to authenticated
using (
  exists (
    select 1
    from artifact_jobs job
    where job.id = artifact_job_events.artifact_job_id
      and job.member_id = private.ruined_current_member_id()
  )
);

drop policy if exists artifact_template_versions_select_assigned on artifact_template_versions;
create policy artifact_template_versions_select_assigned
on artifact_template_versions for select
to authenticated
using (
  exists (
    select 1
    from artifact_jobs job
    where job.artifact_template_version_id = artifact_template_versions.id
      and job.member_id = private.ruined_current_member_id()
  )
);

drop policy if exists artifact_templates_select_assigned on artifact_templates;
create policy artifact_templates_select_assigned
on artifact_templates for select
to authenticated
using (
  exists (
    select 1
    from artifact_template_versions template_version
    join artifact_jobs job
      on job.artifact_template_version_id = template_version.id
    where template_version.artifact_template_id = artifact_templates.id
      and job.member_id = private.ruined_current_member_id()
  )
);


-- Remove the former exposed helpers after all dependent policies have moved.
drop function if exists public.ruined_current_member_id();
drop function if exists public.ruined_current_auth_user_id();

commit;
