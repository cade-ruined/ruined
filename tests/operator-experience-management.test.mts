import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function section(sourceText: string, startMarker: string, endMarker: string) {
  const start = sourceText.indexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} was not found`);
  assert.ok(end > start, `${endMarker} was not found after ${startMarker}`);
  return sourceText.slice(start, end);
}

const [
  migration,
  runner,
  repository,
  memberRepository,
  directory,
  record,
  directoryPage,
  recordPage,
  createRoute,
  updateRoute,
  lifecycleRoute,
  registrationRoute,
  attendanceRoute,
] = await Promise.all([
  source("db/migrations/20260828_operator_experience_management.sql"),
  source("scripts/migrate-platform.mjs"),
  source("src/lib/platform/ops-experience-repository.ts"),
  source("src/lib/membership/repository.ts"),
  source("src/components/platform/OperatorExperienceDirectory.tsx"),
  source("src/components/platform/OperatorExperienceRecord.tsx"),
  source("app/ops/experiences/page.tsx"),
  source("app/ops/experiences/[experienceId]/page.tsx"),
  source("app/api/ops/experiences/route.ts"),
  source("app/api/ops/experiences/[experienceId]/route.ts"),
  source("app/api/ops/experiences/[experienceId]/lifecycle/route.ts"),
  source("app/api/ops/experiences/[experienceId]/registrations/route.ts"),
  source("app/api/ops/experiences/[experienceId]/attendance/route.ts"),
]);

test("the Experience migration is ordered, replay-safe, and keeps immutable history private", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /set local lock_timeout = '10s'/);
  assert.match(migration, /set local statement_timeout = '30s'/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('ruined-platform-migration-runner'\)\)/);
  assert.match(migration, /cancellation_reason = coalesce\([\s\S]*'Imported cancellation\.'/);
  assert.match(migration, /experiences_published_evidence_check/);
  assert.match(migration, /create table if not exists public\.experience_events/);
  assert.match(migration, /create table if not exists public\.experience_registration_events/);
  assert.match(migration, /experience_events_append_only/);
  assert.match(migration, /experience_registration_events_append_only/);
  assert.match(migration, /experience_registrations_waitlist_queue_idx[\s\S]*where status = 'waitlisted'/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table[\s\S]*experience_events[\s\S]*experience_registration_events[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /commit;\s*$/);

  const operatingSpine = runner.indexOf("20260826_membership_operating_spine_05_content_operations.sql");
  const experienceMigration = runner.indexOf("20260828_operator_experience_management.sql");
  const academyMigration = runner.indexOf("20260828_operator_academy.sql");
  assert.ok(operatingSpine >= 0 && operatingSpine < experienceMigration);
  assert.ok(experienceMigration < academyMigration);
});

test("Experience reads and writes reauthorize active, scoped operators", () => {
  assert.match(repository, /role_grant\.role_slug in \('ops_admin', 'guide', 'circle_leader'\)/);
  assert.match(repository, /platform_user\.status = 'active'/);
  assert.match(repository, /role_grant\.revoked_at is null/);
  assert.match(repository, /staff_assignment\.ended_at is null/);
  assert.match(repository, /A Shaper may create only a meeting for their assigned Circle/);
  assert.match(repository, /draft\.kind !== "circle_meeting"/);
  assert.match(repository, /draft\.visibility !== "circle"/);
  assert.match(repository, /Only an operations administrator can manage a non-Circle Experience/);
  assert.match(repository, /intent === "define"[\s\S]*"circle_leader"[\s\S]*"guide"/);
  assert.doesNotMatch(repository, /visibility:\s*"progression"/);
  assert.match(directory, /directory\.canManageGlobal/);
  assert.match(record, /experience\.canManageGlobal/);
});

test("CRUD lifecycle is archived instead of deleted and every mutation leaves audit evidence", () => {
  for (const mutation of [
    "createOpsExperience",
    "updateOpsExperience",
    "transitionOpsExperience",
    "setOpsExperienceRegistration",
    "recordOpsExperienceAttendance",
  ]) {
    assert.match(repository, new RegExp(`export async function ${mutation}`));
  }
  assert.match(repository, /intent: "archive" \| "cancel" \| "complete" \| "publish"/);
  assert.match(repository, /Experiences are archived instead of deleted|status = \$\{state\}/);
  assert.doesNotMatch(repository, /delete from experiences/);
  assert.match(repository, /writeExperienceEvent\(tx/);
  assert.match(repository, /writeRegistrationEvent\(tx/);
  assert.match(repository, /writeOperatorAudit\(tx/);
  assert.match(repository, /pg_advisory_xact_lock\(hashtext\(\$\{experienceId\}\), 48\)/);
  assert.match(repository, /Capacity cannot be lower than/);
  assert.match(repository, /Resolve the current roster before changing how registration is managed/);
  assert.match(repository, /Resolve the current waitlist before turning it off/);
});

test("capacity, waitlist, cancellation, promotion, and attendance are managed in queue order", () => {
  const promote = section(repository, "async function promoteWaitlist", "export async function getOpsExperienceManagementDirectory");
  assert.match(promote, /order by registration\.waitlisted_at, registration\.registered_at, registration\.id/);
  assert.match(promote, /for update/);
  assert.match(promote, /status = 'registered'/);
  assert.match(promote, /Promoted when a place became available/);

  const roster = section(repository, "export async function setOpsExperienceRegistration", "export async function recordOpsExperienceAttendance");
  assert.match(roster, /Choose exactly one member to register/);
  assert.match(roster, /Choose exactly one existing registration/);
  assert.doesNotMatch(roster, /left join experience_registrations[\s\S]*for update of member, registration/);
  assert.match(roster, /The Experience is full and has no waitlist/);
  assert.match(roster, /nextStatus === "cancelled" && previousStatus === "registered"[\s\S]*promoteWaitlist/);

  const attendance = repository.slice(repository.indexOf("export async function recordOpsExperienceAttendance"));
  assert.match(attendance, /Attendance can be recorded only for a published or completed Experience/);
  assert.match(attendance, /confirmed registration/);
  assert.match(attendance, /insert into experience_attendance_events/);
  assert.match(attendance, /input\.eventType === "revoked"/);
});

test("operator pages and JSON boundaries expose creation, roster, waitlist, attendance, and history", () => {
  assert.match(directoryPage, /getOpsExperienceManagementDirectory/);
  assert.match(recordPage, /getOpsExperienceRecord/);
  assert.match(recordPage, /notFound\(\)/);
  assert.match(directory, /Add an Experience/);
  assert.match(record, /Roster/);
  assert.match(record, /Move to waitlist/);
  assert.match(record, /Check in/);
  assert.match(record, /No-show/);
  assert.match(record, /Cancel Experience/);
  assert.match(record, /History/);
  assert.doesNotMatch(`${directory}\n${record}`, /Accountability|Current level|progression/i);

  for (const route of [createRoute, updateRoute, lifecycleRoute, registrationRoute, attendanceRoute]) {
    assert.match(route, /requireOpsMutationRequest\(request\)/);
    assert.match(route, /actorAuthUserId: access\.viewer\.authUserId/);
    assert.match(route, /OpsOperatingRepositoryError/);
  }
  assert.match(lifecycleRoute, /\["archive", "cancel", "complete", "publish"\]/);
  assert.match(registrationRoute, /\["cancel", "promote", "register", "waitlist"\]/);
});

test("Experience forms stay timezone-safe and reveal only relevant scope and registration controls", () => {
  assert.match(directory, /zonedDateTimeLocalToIso/);
  assert.doesNotMatch(directory, /function dateValue/);
  assert.match(directory, /newVisibility === "circle"/);
  assert.match(directory, /newVisibility === "block"/);
  assert.match(directory, /newRegistrationMode === "internal"/);
  assert.match(directory, /newRegistrationMode === "external"/);
  assert.match(record, /editVisibility === "circle"/);
  assert.match(record, /editVisibility === "block"/);
  assert.match(record, /editRegistrationMode === "internal"/);
  assert.match(record, /editRegistrationMode === "external"/);
  assert.match(`${directory}\n${record}`, /OPERATOR_FIELD_CLASS/);
  assert.match(record, /Manage place/);
  assert.match(record, /value="revoked">Not marked/);
  assert.match(record, /clamp\(2\.4rem,5vw,4\.75rem\)/);
});

test("member registration is idempotent, respects windows, promotes the queue, and guards Meet", () => {
  const registration = section(
    memberRepository,
    "export async function setMemberExperienceRegistration",
    "function learningResourceType",
  );
  assert.match(registration, /pg_advisory_xact_lock\(hashtext\(\$\{experienceId\}\), 48\)/);
  assert.match(registration, /current\?\.status === "registered" \|\| current\?\.status === "waitlisted"/);
  assert.match(registration, /registration_opens_at/);
  assert.match(registration, /registration_closes_at/);
  assert.match(registration, /waitlist_enabled/);
  assert.match(registration, /order by waitlisted_at, registered_at, id/);
  assert.match(registration, /insert into experience_registration_events/);

  const meeting = section(
    memberRepository,
    "export async function getMemberExperienceMeetingDestination",
    "export async function getMemberExperiences",
  );
  assert.match(meeting, /experience\.registration_mode = 'none'/);
  assert.match(meeting, /or registration\.status = 'registered'/);
});
