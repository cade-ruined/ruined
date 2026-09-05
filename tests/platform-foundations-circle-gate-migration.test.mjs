import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FOUNDATION_MOMENTS } from "../src/data/foundations.ts";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [migration, migrationRunner] = await Promise.all([
  source("db/migrations/20260825_membership_foundations_circle_gate.sql"),
  source("scripts/migrate-platform.mjs"),
]);

function migrationFunction(functionName) {
  const marker = `create or replace function private.${functionName}()`;
  const start = migration.indexOf(marker);
  assert.ok(start >= 0, `${marker} was not found`);

  const end = migration.indexOf("\n$$;", start);
  assert.ok(end > start, `${functionName} does not have a complete SQL body`);
  return migration.slice(start, end + 4);
}

function pilotSeedRows() {
  const insertMarker = "insert into ruined_pilot_foundation_moment_seed (";
  const start = migration.indexOf(insertMarker);
  const end = migration.indexOf("\n\ninsert into public.foundation_programs", start);
  assert.ok(start >= 0 && end > start, "the pilot unit seed was not found");

  const seed = migration.slice(start, end);
  const rowPattern =
    /\('([0-9a-f-]+)', '([^']+)', (\d+), '((?:''|[^'])*)', '([^']+)', '([^']+)', (null|'((?:''|[^'])*)')\)/g;

  return [...seed.matchAll(rowPattern)].map((match) => ({
    chapter: match[7] === "null" ? null : match[8].replaceAll("''", "'"),
    id: match[1],
    kind: match[6],
    label: match[4].replaceAll("''", "'"),
    momentId: match[2],
    position: Number(match[3]),
    stage: match[5],
  }));
}

test("pilot seed is an exact, ordered projection of all stable Foundation moments", () => {
  const seeded = pilotSeedRows();
  assert.equal(seeded.length, 22);
  assert.equal(FOUNDATION_MOMENTS.length, 22);

  assert.deepEqual(
    seeded,
    FOUNDATION_MOMENTS.map((moment, index) => ({
      chapter: "chapterId" in moment ? moment.chapterId : null,
      id: `f0000000-0000-4000-8000-${String(1001 + index).padStart(12, "0")}`,
      kind: moment.kind,
      label: moment.label,
      momentId: moment.id,
      position: index + 1,
      stage: moment.stage,
    })),
  );

  assert.match(migration, /'moment_count', 22/);
  assert.match(migration, /'required_prior_unit_count', 21/);
  assert.match(migration, /'final_unit_slug', 'closing'/);
  assert.match(migration, /'source', 'src\/data\/foundations\.ts#FOUNDATION_MOMENTS'/);
  assert.match(
    migration,
    /status = 'published',[\s\S]*published_at = coalesce\(published_at, now\(\)\)/,
  );
  assert.match(migration, /if unit_count <> 22 then/);
  assert.match(migration, /pilot units do not match FOUNDATION_MOMENTS/);
});

test("migration runner orders the Circle gate after the platform schema", () => {
  const platformIndex = migrationRunner.indexOf("20260819_platform_foundation.sql");
  const circleGateIndex = migrationRunner.indexOf(
    "20260825_membership_foundations_circle_gate.sql",
  );
  const communicationsIndex = migrationRunner.indexOf("20260819_communications.sql");

  assert.ok(platformIndex >= 0, "the platform migration is missing from the runner");
  assert.ok(circleGateIndex > platformIndex, "the Circle gate must follow the platform schema");
  assert.ok(
    communicationsIndex > circleGateIndex,
    "later platform migrations must follow the Circle gate",
  );
});

test("migration runner atomically ledgers checksums and skips safe replays", () => {
  assert.match(migrationRunner, /createHash\("sha256"\)/);
  assert.match(
    migrationRunner,
    /must contain exactly one top-level BEGIN\/COMMIT envelope/,
  );
  assert.match(migrationRunner, /private\.ruined_platform_migrations/);
  assert.match(migrationRunner, /migration_name text primary key/);
  assert.match(migrationRunner, /sha256 text not null/);
  assert.match(
    migrationRunner,
    /select pg_advisory_xact_lock\(hashtext\('ruined-platform-migration-runner'\)\)/,
  );
  assert.match(
    migrationRunner,
    /select sha256[\s\S]*where migration_name = \$\{migrationName\}[\s\S]*for update/,
  );
  assert.match(migrationRunner, /existing\.sha256 !== checksum/);
  assert.match(migrationRunner, /Create a new migration instead of editing applied history/);
  assert.match(
    migrationRunner,
    /await transaction\.unsafe\(body\);[\s\S]*insert into private\.ruined_platform_migrations/,
  );
  assert.match(migrationRunner, /return false;/);
});

test("first application is serialized with a fail-fast quiescence boundary", () => {
  assert.match(migration, /set local lock_timeout = '10s'/);
  assert.match(
    migration,
    /select pg_advisory_xact_lock\(hashtext\('ruined-platform-migration-runner'\)\)/,
  );

  const progressLock = migration.indexOf(
    "public.foundation_unit_progress,",
  );
  const enrollmentLock = migration.indexOf(
    "public.foundation_enrollments,",
  );
  const memberLock = migration.indexOf(
    "public.ruined_members,",
  );

  assert.ok(progressLock >= 0);
  assert.ok(enrollmentLock > progressLock);
  assert.ok(memberLock > enrollmentLock);
  assert.match(
    migration,
    /lock table[\s\S]*public\.artifact_templates\s+in access exclusive mode nowait;/,
  );
});

test("completion stores a constrained, indexed Circle assignment proof", () => {
  assert.match(
    migration,
    /add column if not exists completion_circle_assignment_id bigint/,
  );
  assert.match(
    migration,
    /foundation_enrollments_completion_circle_assignment_idx[\s\S]*completion_circle_assignment_id/,
  );
  assert.match(
    migration,
    /foreign key \(completion_circle_assignment_id\)[\s\S]*references public\.circle_member_assignments\(id\)[\s\S]*on delete restrict[\s\S]*not valid/,
  );
  assert.match(
    migration,
    /status = 'completed'[\s\S]*completed_at is not null[\s\S]*completion_circle_assignment_id is not null[\s\S]*status <> 'completed'[\s\S]*completed_at is null[\s\S]*completion_circle_assignment_id is null/,
  );
  assert.match(
    migration,
    /from public\.foundation_enrollments enrollment\s+where enrollment\.status = 'completed'\s+order by enrollment\.id/,
  );
  assert.match(
    migration,
    /if enrollment_record\.completion_circle_assignment_id is not null then\s+continue;/,
  );
  assert.match(migration, /lacks provable required-unit progress/);
  assert.match(migration, /lock table\s+public\.foundation_unit_progress,/);
  assert.match(migration, /if proof_count <> 1 then/);
  assert.match(migration, /assignment\.ended_at >= enrollment_record\.completed_at/);
  assert.match(migration, /circle_record\.activated_at <= enrollment_record\.completed_at/);
  assert.match(migration, /circle_record\.status = 'active'/);
  assert.match(migration, /invalid Circle assignment proof/);
  assert.match(migration, /index_record\.indrelid = 'public\.foundation_enrollments'::regclass/);
  assert.match(migration, /index_record\.indkey::text = column_number::text/);
  assert.match(
    migration,
    /constraint_record\.conkey = array\[local_attribute_number\]::smallint\[\]/,
  );
  assert.match(migration, /constraint_record\.confdeltype = 'r'/);
  assert.match(
    migration,
    /obj_description\(constraint_record\.oid, 'pg_constraint'\)[\s\S]*ruined:v1:completed requires timestamp and Circle assignment proof/,
  );
});

test("private trigger functions are invoker-safe and unavailable as RPCs", () => {
  const functionNames = [
    "ruined_sync_revoked_member_platform_access",
    "ruined_guard_circle_activation_audit",
    "ruined_guard_invitation_revocation_audit",
    "ruined_guard_completed_foundation_progress",
    "ruined_guard_circle_assignment_foundation_proof",
    "ruined_require_foundation_completion_circle",
    "ruined_require_completed_foundation_enrollment",
    "ruined_require_foundation_lifecycle_projection",
  ];

  for (const functionName of functionNames) {
    const functionSource = migrationFunction(functionName);
    assert.match(
      functionSource,
      /language plpgsql\s+security invoker\s+set search_path = ''/,
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on function private\\.${functionName}\\(\\)\\s+from public, anon, authenticated;`,
      ),
    );
  }

  for (const helperName of [
    "ruined_current_member_id",
    "ruined_current_active_access_member_id",
  ]) {
    const helper = migrationFunction(helperName);
    assert.match(helper, /language sql\s+stable\s+security definer\s+set search_path = ''/);
    assert.match(
      migration,
      new RegExp(
        `revoke all on function private\\.${helperName}\\(\\)\\s+from public, anon, authenticated;`,
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute on function private\\.${helperName}\\(\\) to authenticated;`,
      ),
    );
  }
});

test("completion enforces each version contract and an active Circle", () => {
  const circleAudit = migrationFunction("ruined_guard_circle_activation_audit");
  const completion = migrationFunction("ruined_require_foundation_completion_circle");

  assert.match(
    circleAudit,
    /new\.status = 'active'[\s\S]*new\.ends_at < statement_timestamp\(\)[\s\S]*active Circle cannot have an elapsed end time/,
  );
  assert.match(completion, /update public\.ruined_members[\s\S]*where id = new\.member_id/);
  assert.match(completion, /nullif\(btrim\(final_unit_slug\), ''\) is null/);
  assert.match(completion, /expected_prior_count is null/);
  assert.match(completion, /expected_prior_count < 0/);
  assert.match(completion, /required_prior_count <> expected_prior_count/);
  assert.match(completion, /completed_prior_count <> expected_prior_count/);
  assert.match(completion, /unit_record\.position < final_position/);
  assert.match(completion, /progress\.status = 'completed'/);
  assert.match(completion, /unit_record\.position > final_position/);
  assert.match(completion, /final_unit_complete is distinct from true/);
  assert.match(completion, /assignment\.ended_at is null/);
  assert.match(completion, /completion_time timestamptz := statement_timestamp\(\)/);
  assert.match(completion, /assignment\.assigned_at <= completion_time/);
  assert.match(completion, /circle_record\.status = 'active'/);
  assert.match(completion, /circle_record\.starts_at is not null/);
  assert.match(completion, /circle_record\.starts_at <= completion_time/);
  assert.match(completion, /circle_record\.activated_at is not null/);
  assert.match(completion, /circle_record\.activated_at <= completion_time/);
  assert.match(
    completion,
    /circle_record\.ends_at is null[\s\S]*circle_record\.ends_at >= completion_time/,
  );
  assert.match(completion, /for no key update of circle_record/);
  assert.match(completion, /new\.completed_at := completion_time/);
  assert.match(completion, /new\.completion_circle_assignment_id := active_assignment_id/);
  assert.match(completion, /constraint = 'foundation_completion_requires_circle'/);
  assert.match(completion, /tg_op = 'DELETE'[\s\S]*cannot be deleted/);

  assert.match(migration, /create trigger foundation_enrollments_completed_delete_guard/);
  assert.match(migration, /before delete\s+on public\.foundation_enrollments/);
});

test("assignment and lifecycle mutations cannot invalidate completion proof", () => {
  const assignmentGuard = migrationFunction(
    "ruined_guard_circle_assignment_foundation_proof",
  );
  const lifecycleGuard = migrationFunction(
    "ruined_require_completed_foundation_enrollment",
  );
  const enrollmentProjection = migrationFunction(
    "ruined_require_foundation_lifecycle_projection",
  );

  const firstMemberLock = assignmentGuard.indexOf("update public.ruined_members");
  const proofRead = assignmentGuard.indexOf("from public.foundation_enrollments");
  assert.ok(firstMemberLock >= 0 && proofRead > firstMemberLock);
  assert.match(assignmentGuard, /old\.member_id < new\.member_id/);
  assert.match(assignmentGuard, /tg_op = 'DELETE'[\s\S]*cannot be deleted/);
  assert.match(
    assignmentGuard,
    /new\.member_id is distinct from old\.member_id[\s\S]*new\.circle_id is distinct from old\.circle_id[\s\S]*new\.assigned_at is distinct from old\.assigned_at[\s\S]*new\.ended_at < enrollment\.completed_at/,
  );
  assert.match(
    assignmentGuard,
    /new\.ended_at is null\) <> \(new\.ended_by_auth_user_id is null/,
  );
  assert.match(assignmentGuard, /Ended Circle assignment evidence is immutable/);
  assert.match(
    migration,
    /create trigger circle_member_assignments_00_foundation_proof_guard\s+before insert or update or delete/,
  );

  assert.match(lifecycleGuard, /update public\.ruined_members[\s\S]*where id = new\.member_id/);
  assert.match(
    lifecycleGuard,
    /enrollment\.status = 'completed'[\s\S]*enrollment\.completed_at is not null[\s\S]*enrollment\.completion_circle_assignment_id is not null/,
  );
  assert.match(
    migration,
    /completed Foundation lifecycle has no completed enrollment with Circle proof/,
  );
  assert.match(
    migration,
    /create trigger member_lifecycle_foundations_completion_guard[\s\S]*before insert or update of foundations_state, member_id/,
  );
  assert.match(lifecycleGuard, /completed Foundation lifecycle projection cannot regress/);
  assert.match(lifecycleGuard, /completed Foundation lifecycle projection cannot be deleted/);
  assert.match(
    migration,
    /create trigger member_lifecycle_foundations_completion_delete_guard[\s\S]*before delete/,
  );
  assert.match(
    migration,
    /migration_repaired_completed_enrollment_projection[\s\S]*foundations_state = 'completed'/,
  );
  assert.match(
    migration,
    /lifecycle\.foundations_state <> 'completed'[\s\S]*or lifecycle\.program_state = 'onboarding'/,
  );
  assert.match(
    migration,
    /where projection\.previous_state <> 'completed'[\s\S]*where projection\.previous_program_state = 'onboarding'/,
  );
  assert.match(
    enrollmentProjection,
    /Completed Foundation enrollment requires a completed lifecycle projection/,
  );
  assert.match(
    migration,
    /create constraint trigger foundation_enrollments_lifecycle_projection_guard[\s\S]*deferrable initially deferred/,
  );
});

test("completed unit progress is immutable behind the shared member lock", () => {
  const progressGuard = migrationFunction("ruined_guard_completed_foundation_progress");
  const memberLock = progressGuard.indexOf("update public.ruined_members");
  const completedRead = progressGuard.indexOf("enrollment.status = 'completed'");

  assert.ok(memberLock >= 0 && completedRead > memberLock);
  assert.match(progressGuard, /old_member_id < new_member_id/);
  assert.match(progressGuard, /Unit progress for a completed Foundation enrollment is immutable/);
  assert.match(
    migration,
    /create trigger foundation_unit_progress_00_completed_enrollment_guard\s+before insert or update or delete/,
  );
});

test("Circle activation and terminal operations retain attributable evidence", () => {
  const activationGuard = migrationFunction("ruined_guard_circle_activation_audit");
  const revocationGuard = migrationFunction("ruined_guard_invitation_revocation_audit");

  assert.match(migration, /add column if not exists activated_by_auth_user_id uuid/);
  assert.match(migration, /add column if not exists activated_at timestamptz/);
  assert.match(migration, /add column if not exists revoked_by_auth_user_id uuid/);
  assert.match(migration, /add column if not exists ended_by_auth_user_id uuid/);
  assert.match(migration, /circles_activated_by_auth_user_id_fkey/);
  assert.match(migration, /passwordless_account_invites_revoked_by_auth_user_id_fkey/);
  assert.match(migration, /circle_member_assignments_ended_by_auth_user_id_fkey/);
  assert.match(
    migration,
    /references public\.platform_users\(auth_user_id\) on delete restrict not valid/,
  );
  assert.match(
    migration,
    /Every activated Circle must have trustworthy start and activation times/,
  );
  assert.match(activationGuard, /statement_timestamp\(\)/);
  assert.match(activationGuard, /new\.activated_at := statement_timestamp\(\)/);
  assert.match(activationGuard, /A Circle must be created as forming before activation/);
  assert.match(
    activationGuard,
    /old\.status = 'active' and new\.status in \('active', 'completed', 'archived'\)/,
  );
  assert.match(
    activationGuard,
    /old\.status = 'completed' and new\.status in \('completed', 'archived'\)/,
  );
  assert.match(activationGuard, /old\.status = 'archived' and new\.status = 'archived'/);
  assert.match(activationGuard, /Circle activation attribution is immutable/);
  assert.match(activationGuard, /Circle activation time is immutable/);
  assert.match(activationGuard, /Circle start time is immutable after activation/);
  assert.match(activationGuard, /A Circle cannot invalidate Foundation completion proof/);
  assert.match(
    revocationGuard,
    /Invitation revocation time and actor must be recorded together/,
  );
  assert.match(revocationGuard, /Invitation revocation evidence is immutable/);
});

test("staff identities cannot carry member ownership", () => {
  assert.match(
    migration,
    /add constraint platform_users_staff_has_no_member_check[\s\S]*check \(user_type <> 'staff' or member_id is null\)[\s\S]*not valid/,
  );
  assert.match(
    migration,
    /validate constraint platform_users_staff_has_no_member_check/,
  );
});
