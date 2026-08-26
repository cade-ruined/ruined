import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const migrationPaths = [
  "db/migrations/20260826_membership_operating_spine_01_person_identity.sql",
  "db/migrations/20260826_membership_operating_spine_02_lifecycle_agreements.sql",
  "db/migrations/20260826_membership_operating_spine_03_community_experiences.sql",
  "db/migrations/20260826_membership_operating_spine_04_foundations_automation.sql",
  "db/migrations/20260826_membership_operating_spine_05_content_operations.sql",
];

const [identity, lifecycle, community, automation, operations, migrationRunner] =
  await Promise.all([
    ...migrationPaths.map(source),
    source("scripts/migrate-platform.mjs"),
  ]);

const migrations = [identity, lifecycle, community, automation, operations];

test("operating-spine migrations are atomic and ordered after applied history", () => {
  for (const [index, migration] of migrations.entries()) {
    assert.match(migration, /^begin;\n/i, `${migrationPaths[index]} must start with BEGIN`);
    assert.match(migration, /\ncommit;\s*$/i, `${migrationPaths[index]} must end with COMMIT`);
    assert.equal(
      (migration.match(/^commit;\s*$/gim) ?? []).length,
      1,
      `${migrationPaths[index]} must have one transaction envelope`,
    );
    assert.match(migration, /pg_advisory_xact_lock\(hashtext\('ruined-platform-migration-runner'\)\)/);
  }

  const appliedHistory = migrationRunner.indexOf("20260821_byob_registration_v3.sql");
  const orderedIndexes = migrationPaths.map((path) =>
    migrationRunner.indexOf(path.split("/").at(-1)),
  );
  assert.ok(appliedHistory >= 0);
  assert.ok(orderedIndexes.every((index) => index > appliedHistory));
  assert.deepEqual(orderedIndexes, [...orderedIndexes].sort((a, b) => a - b));
});

test("Person identity is additive, legacy-write compatible, and role based", () => {
  for (const table of [
    "people",
    "person_email_addresses",
    "person_profiles",
    "person_private_profiles",
    "person_merge_events",
  ]) {
    assert.match(identity, new RegExp(`create table if not exists public\\.${table} \\(`));
    assert.match(identity, new RegExp(`alter table public\\.${table} enable row level security`));
  }

  assert.match(identity, /alter table public\.ruined_members add column if not exists person_id uuid/);
  assert.match(identity, /alter table public\.platform_users add column if not exists person_id uuid/);
  assert.match(identity, /ruined_members_00_link_person[\s\S]*before insert/);
  assert.match(identity, /platform_users_00_link_person[\s\S]*before insert/);
  assert.match(identity, /normalized email is already linked to another Person/);
  assert.match(identity, /create or replace function private\.ruined_has_active_role\(requested_role text\)/);
  assert.match(identity, /role_grant\.role_slug = 'member'/);
  assert.doesNotMatch(
    identity.slice(identity.indexOf("private.ruined_current_member_id()")),
    /platform_user\.user_type = 'member'/,
  );
  assert.match(identity, /drop constraint if exists platform_users_staff_has_no_member_check/);
  assert.match(identity, /person_merge_events_append_only/);
});

test("administrative onboarding and legal evidence cannot be unlocked by payment alone", () => {
  assert.match(lifecycle, /administrative_onboarding_state[\s\S]*not_started[\s\S]*in_progress[\s\S]*completed/);
  assert.match(lifecycle, /standing_state[\s\S]*cancellation_requested[\s\S]*inactive[\s\S]*alumni/);
  assert.match(lifecycle, /Active billing is required to complete administrative onboarding/);
  assert.match(lifecycle, /active member login and verified email are required/i);
  assert.match(lifecycle, /durable agreement acceptance is required/i);
  assert.match(lifecycle, /profile_completed_at[\s\S]*agreement_completed_at[\s\S]*billing_confirmed_at/);

  assert.match(lifecycle, /create table if not exists public\.membership_agreement_versions/);
  assert.match(lifecycle, /content_sha256 text not null/);
  assert.match(lifecycle, /status text not null default 'draft'[\s\S]*draft[\s\S]*published[\s\S]*retired/);
  assert.match(lifecycle, /membership_agreement_acceptances_append_only/);
  assert.match(lifecycle, /agreement_body_snapshot text not null/);
  assert.match(lifecycle, /age_attestation_id bigint/);
  assert.match(lifecycle, /acceptance_context[\s\S]*initial_membership[\s\S]*rejoin[\s\S]*renewal/);
  assert.match(lifecycle, /dedupe_key text not null unique/);
  assert.doesNotMatch(lifecycle, /unique \(member_id, agreement_version_id\)/i);
  assert.match(lifecycle, /membership_agreement_receipts_append_only/);
  assert.match(lifecycle, /delivery_method[\s\S]*database_snapshot[\s\S]*storage/);
  assert.match(lifecycle, /mime_type text not null default 'text\/plain'/);
  assert.match(lifecycle, /delivery_method = 'database_snapshot' and storage_bucket is null and storage_path is null/);
  assert.match(lifecycle, /stripe_checkout_attempts_agreement_acceptance_id_fkey/);
  assert.doesNotMatch(lifecycle, /insert into public\.membership_agreement_versions/i);
});

test("member community data defaults private and participation remains durable", () => {
  assert.match(community, /directory_status text not null default 'hidden'/);
  assert.match(community, /email_scope text not null default 'none'/);
  assert.match(community, /phone_scope text not null default 'none'/);
  assert.match(community, /A member may have only one active accountability partner/);
  assert.match(community, /Both accountability partners must be active members of the Circle/);

  assert.match(community, /create table if not exists public\.experiences/);
  assert.match(community, /circle_meeting[\s\S]*academy_session[\s\S]*challenge/);
  assert.match(community, /create table if not exists public\.experience_registrations/);
  assert.match(community, /create table if not exists public\.experience_attendance_events/);
  assert.match(community, /experience_attendance_events_append_only/);
  assert.match(
    community,
    /visibility = 'invite_only'[\s\S]*registration\.person_id = private\.ruined_current_person_id\(\)/,
  );
  assert.doesNotMatch(
    community,
    /visibility in \('all_members', 'invite_only'\)/,
  );
});

test("learning content is versioned, audience-scoped, and saveable", () => {
  for (const table of [
    "learning_collections",
    "learning_resources",
    "learning_resource_versions",
    "learning_resource_targets",
    "circle_resources",
    "member_saved_learning_resources",
  ]) {
    assert.match(community, new RegExp(`create table if not exists public\\.${table} \\(`));
    assert.match(community, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(community, /learning_resource_versions_append_only/);
  assert.match(community, /audience_type[\s\S]*all_members[\s\S]*circle[\s\S]*block[\s\S]*progression/);
  assert.match(community, /learning_resource_version_id uuid not null/);
});

test("Foundations member-owned artifacts preserve private content boundaries", () => {
  assert.match(automation, /entry_year integer not null/);
  assert.match(automation, /title text not null/);
  assert.match(automation, /details text/);
  assert.match(automation, /member_timeline_entry_versions_append_only/);
  assert.match(automation, /At least one active Timeline entry is required/);
  assert.match(automation, /requirement_slug in \('timeline', 'future_letter'\)/);
  assert.match(automation, /Future Letter body, file, or excerpt/i);
  assert.match(automation, /required_member_requirements[\s\S]*timeline[\s\S]*future_letter/);
  assert.doesNotMatch(automation, /future_letter_(?:body|content|text)/i);
});

test("Artifact awards, activity resolution, and workflow retries are durable", () => {
  assert.match(automation, /create table if not exists public\.artifact_awards/);
  assert.match(automation, /acquisition_type[\s\S]*earned[\s\S]*purchased[\s\S]*gifted/);
  assert.match(automation, /artifact_jobs_artifact_award_id_fkey/);
  assert.match(automation, /create table if not exists public\.domain_events/);
  assert.match(automation, /domain_events_append_only/);
  assert.match(automation, /create table if not exists public\.workflow_actions/);
  assert.match(automation, /create_operator_task/);
  assert.match(automation, /workflow_actions_claim_idx/);
  assert.match(automation, /workflow_action_attempts_append_only/);
  assert.match(automation, /create table if not exists public\.person_activities/);
  assert.match(automation, /create table if not exists public\.person_activity_identity_links/);
  assert.match(automation, /person_activity_identity_links_append_only/);
  assert.match(automation, /Only an unlinked imported activity may receive an identity link/);

  for (const triggerFunction of [
    "ruined_queue_agreement_acceptance_work",
    "ruined_queue_onboarding_completion_work",
    "ruined_queue_foundation_completion_work",
    "ruined_queue_circle_assignment_work",
  ]) {
    assert.match(
      automation,
      new RegExp(
        `create or replace function private\\.${triggerFunction}\\(\\)[\\s\\S]*security definer[\\s\\S]*set search_path = ''`,
      ),
    );
    assert.match(
      automation,
      new RegExp(
        `revoke all on function private\\.${triggerFunction}\\(\\)[\\s\\S]*from public, anon, authenticated`,
      ),
    );
  }
  assert.match(automation, /generate-agreement-receipt:/);
  assert.match(automation, /operator-follow-up-onboarding:/);
  assert.match(automation, /notify-foundations-completed:/);
  assert.match(automation, /notify-circle-assigned:/);
  assert.match(automation, /template_version\.status = 'published'/);
});

test("operator history is append-only and overrides exclude canonical evidence", () => {
  for (const table of [
    "member_announcements",
    "member_announcement_targets",
    "member_notifications",
    "member_notification_events",
    "operator_member_notes",
    "operator_member_note_redactions",
    "operator_tasks",
    "operator_task_events",
    "member_state_overrides",
    "operator_audit_events",
  ]) {
    assert.match(operations, new RegExp(`create table if not exists public\\.${table} \\(`));
    assert.match(operations, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(operations, /operator_member_notes_append_only/);
  assert.match(operations, /operator_member_note_redactions_append_only/);
  assert.match(operations, /operator_task_events_append_only/);
  assert.match(operations, /member_state_overrides_append_only/);
  assert.match(operations, /operator_audit_events_append_only/);
  assert.match(operations, /created_by_type[\s\S]*operator[\s\S]*system/);
  assert.match(
    operations,
    /created_by_type = 'system' and created_by_auth_user_id is null/,
  );
  assert.match(operations, /actor_type text not null default 'operator'/);
  assert.match(
    operations,
    /actor_type = 'system' and actor_auth_user_id is null/,
  );
  assert.doesNotMatch(
    operations,
    /references public\.platform_users\(auth_user_id\)[^,;\n]*,?\s*references public\.platform_users\(auth_user_id\)/,
    "a column must not contain a duplicated platform_users REFERENCES clause",
  );

  const overrideDefinition = operations.slice(
    operations.indexOf("create table if not exists public.member_state_overrides"),
    operations.indexOf("create index if not exists member_state_overrides_member_idx"),
  );
  assert.doesNotMatch(overrideDefinition, /'billing'|'agreement'|'foundations'/);
  assert.match(community, /contact sharing defaults closed/i);
});

test("every new public table has RLS and intentional table revocation", () => {
  const allMigrations = migrations.join("\n");
  const tableNames = [
    ...allMigrations.matchAll(/create table if not exists public\.([a-z0-9_]+) \(/g),
  ].map((match) => match[1]);

  assert.ok(tableNames.length >= 45, "the full operating spine table set is expected");
  for (const table of tableNames) {
    assert.match(
      allMigrations,
      new RegExp(`alter table public\\.${table} enable row level security;`),
      `${table} must enable RLS`,
    );
    assert.match(
      allMigrations,
      new RegExp(`revoke all on table[\\s\\S]*?public\\.${table}[\\s\\S]*?from public, anon, authenticated;`),
      `${table} must be included in an explicit revoke block`,
    );
  }
});
