import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [repository, api, overrideRoute, noteRoute, taskRoute, accountabilityRoute] = await Promise.all([
  source("src/lib/platform/ops-operating-repository.ts"),
  source("src/lib/platform/ops-api.ts"),
  source("app/api/ops/members/[memberId]/state-overrides/route.ts"),
  source("app/api/ops/members/[memberId]/notes/route.ts"),
  source("app/api/ops/tasks/route.ts"),
  source("app/api/ops/accountability-partners/route.ts"),
]);

test("operator authorization unions active grants and scopes guides and leaders to current Circles", () => {
  const access = repository.slice(
    repository.indexOf("async function requireOperatorAccess"),
    repository.indexOf("async function writeAudit"),
  );
  assert.match(access, /role_grant\.role_slug in \('ops_admin', 'guide', 'circle_leader'\)/);
  assert.match(access, /role_grant\.revoked_at is null/);
  assert.match(access, /platform_user\.status = 'active'/);
  assert.match(access, /circle_member_assignments member_assignment/);
  assert.match(access, /circle_staff_assignments staff_assignment/);
  assert.match(access, /staff_assignment\.ended_at is null/);
  assert.match(access, /member_assignment\.ended_at is null/);
  assert.doesNotMatch(access, /user_type/);
});

test("the server projection excludes private Foundations writing and limits sensitive branches to admins", () => {
  assert.doesNotMatch(repository, /member_timeline_entries|member_timeline_entry_versions/);
  assert.doesNotMatch(repository, /foundation_submissions|foundation_submission_reviews/);
  assert.doesNotMatch(repository, /agreement_body_snapshot|acceptance_evidence/);
  assert.match(repository, /const contactRows = isAdmin/);
  assert.match(repository, /case when directory\.phone_scope = 'circle' then private_profile\.mobile_e164 end/);
  assert.match(repository, /const agreementRows = isAdmin/);
  assert.match(repository, /const billingRows = isAdmin/);
  assert.match(repository, /const noteRows = isAdmin/);
  assert.match(repository, /const taskRows = isAdmin/);
  assert.match(repository, /const artifactRows = isAdmin/);
  assert.match(repository, /const experienceRows = isAdmin/);
  assert.match(repository, /member_foundation_requirement_completions/);
});

test("state corrections are versioned, audited, and cannot target billing, agreements, or Foundations", () => {
  const allowed = repository.slice(
    repository.indexOf("const OVERRIDE_VALUES"),
    repository.indexOf("const ARTIFACT_TRANSITIONS"),
  );
  for (const dimension of ["account", "admission", "administrative_onboarding", "standing", "artifact", "progression"]) {
    assert.match(allowed, new RegExp(`${dimension}:`));
  }
  assert.doesNotMatch(allowed, /billing|agreement|foundations|program/);

  const mutation = repository.slice(
    repository.indexOf("export async function recordOpsMemberStateOverride"),
    repository.indexOf("export async function assignOpsAccountabilityPartner"),
  );
  assert.match(mutation, /requireAdmin: true/);
  assert.match(mutation, /version = \$\{input\.expectedLifecycleVersion\}/);
  assert.match(mutation, /insert into member_state_overrides/);
  assert.match(mutation, /insert into member_state_history/);
  assert.match(mutation, /member\.state_override_applied/);
  assert.match(overrideRoute, /recordOpsMemberStateOverride/);
});

test("every new mutation shares origin, session, JSON, and repository authorization checks", () => {
  assert.match(api, /isTrustedPlatformOrigin\(request\)/);
  assert.match(api, /getCurrentPlatformViewer\(\)/);
  assert.match(api, /application\/json/);
  for (const route of [overrideRoute, noteRoute, taskRoute, accountabilityRoute]) {
    assert.match(route, /requireOpsMutationRequest\(request\)/);
    assert.match(route, /actorAuthUserId: access\.viewer\.authUserId/);
    assert.match(route, /OpsOperatingRepositoryError/);
  }
  assert.match(repository, /for update of platform_user, role_grant/);
  assert.match(repository, /insert into operator_audit_events/);
});

test("notes and task events are append-only records while accountability replacement ends history", () => {
  assert.match(repository, /insert into operator_member_notes/);
  assert.doesNotMatch(repository, /delete from operator_member_notes/);
  assert.match(repository, /insert into operator_task_events/);
  assert.doesNotMatch(repository, /delete from operator_task_events/);
  assert.match(repository, /ended_at = statement_timestamp\(\)/);
  assert.match(repository, /end_reason = 'Replaced by a new operator assignment'/);
  assert.doesNotMatch(repository, /delete from accountability_partner_assignments/);
});
