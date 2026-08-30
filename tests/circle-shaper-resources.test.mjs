import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function section(sourceText, startMarker, endMarker) {
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
  shaperRoute,
  resourceRoute,
  actions,
  circlesPage,
  memberModel,
  memberRepository,
  operatorModel,
  operatorRepository,
  operatorActions,
] = await Promise.all([
  source("db/migrations/20260828_circle_shaper_resources.sql"),
  source("scripts/migrate-platform.mjs"),
  source("src/lib/platform/ops-repository.ts"),
  source("app/api/ops/circle-shaper-assignments/route.ts"),
  source("app/api/ops/circle-resources/route.ts"),
  source("src/components/platform/OpsCircleManagementActions.tsx"),
  source("app/ops/circles/page.tsx"),
  source("src/lib/membership/model.ts"),
  source("src/lib/membership/repository.ts"),
  source("src/lib/platform/ops-model.ts"),
  source("src/lib/platform/ops-operating-repository.ts"),
  source("src/components/platform/OperatorMemberActions.tsx"),
]);

test("the additive migration retires accountability without deleting history or broadening contact access", () => {
  assert.match(runner, /20260828_circle_shaper_resources\.sql/);
  assert.match(migration, /update public\.accountability_partner_assignments[\s\S]*ended_at = statement_timestamp\(\)/);
  assert.match(migration, /end_reason = 'Accountability pairing retired'/);
  assert.match(migration, /email_scope = case when email_scope = 'accountability_partner' then 'none'/);
  assert.match(migration, /phone_scope = case when phone_scope = 'accountability_partner' then 'none'/);
  assert.match(migration, /check \(email_scope in \('none', 'circle'\)\)/);
  assert.match(migration, /check \(phone_scope in \('none', 'circle'\)\)/);
  assert.match(migration, /before insert on public\.accountability_partner_assignments/);
  assert.match(migration, /Accountability partner assignments are retired/);
  assert.match(migration, /revoke select on public\.accountability_partner_assignments from authenticated/);
  assert.doesNotMatch(migration, /delete from public\.accountability_partner_assignments/);
});

test("Shaper keeps the stable authorization slug and gains validated append-preserving assignment controls", () => {
  assert.match(migration, /where role_slug = 'circle_leader'/);
  assert.match(migration, /set display_name = 'Shaper'/);
  assert.match(migration, /circle_staff_assignments[\s\S]*ended_by_auth_user_id/);
  assert.match(migration, /platform_user\.status = 'active'/);
  assert.match(migration, /role_grant\.role_slug = new\.role_slug/);
  assert.match(migration, /Circle staff assignment history cannot be deleted/);
  assert.match(migration, /A closed Circle staff assignment is immutable/);

  const assign = section(repository, "export async function assignShaperToCircle", "export async function endCircleShaperAssignment");
  assert.match(assign, /requireOpsAdmin/);
  assert.match(assign, /role_grant\.role_slug = 'circle_leader'/);
  assert.match(assign, /role_slug = 'circle_leader'/);
  assert.match(assign, /That Circle already has a Shaper/);
  assert.match(assign, /insert into circle_staff_assignments/);
  assert.match(assign, /circle\.shaper_assigned/);

  const end = section(repository, "export async function endCircleShaperAssignment", "export async function assignResourceToCircle");
  assert.match(end, /ended_by_auth_user_id/);
  assert.match(end, /end_reason = 'ops_ended_assignment'/);
  assert.match(end, /circle\.shaper_assignment_ended/);
  assert.doesNotMatch(end, /delete from circle_staff_assignments/);
});

test("Circle resources pin an exact published version and end instead of being overwritten", () => {
  assert.match(migration, /add column if not exists learning_resource_id uuid/);
  assert.match(migration, /foreign key \(learning_resource_version_id, learning_resource_id\)/);
  assert.match(migration, /circle_resources_one_active_resource_idx[\s\S]*where ended_at is null/);
  assert.match(migration, /Circle resource history cannot be deleted/);
  assert.match(migration, /circle_resource\.ended_at is null/);
  assert.match(migration, /create policy circle_resources_select_assigned[\s\S]*ended_at is null/);

  const assign = section(repository, "export async function assignResourceToCircle", "export async function endCircleResourceAssignment");
  assert.match(assign, /resource\.current_version_id/);
  assert.match(assign, /resource\.status = 'published'/);
  assert.match(assign, /insert into circle_resources/);
  assert.match(assign, /learning_resource_version_id/);
  assert.match(assign, /circle\.resource_assigned/);

  const end = section(repository, "export async function endCircleResourceAssignment", "export async function createBlock");
  assert.match(end, /ended_by_auth_user_id/);
  assert.match(end, /circle\.resource_assignment_ended/);
  assert.doesNotMatch(end, /delete from circle_resources/);
  assert.match(memberRepository, /where circle_resource\.circle_id = \$\{circle\.circle_id\}::uuid[\s\S]*circle_resource\.ended_at is null/);
  assert.match(operatorRepository, /where circle_resource\.circle_id = \$\{base\.circle_id\}::uuid[\s\S]*circle_resource\.ended_at is null/);
});

test("operator routes and the Circle management surface expose assign and end actions safely", () => {
  for (const route of [shaperRoute, resourceRoute]) {
    assert.match(route, /isTrustedPlatformOrigin\(request\)/);
    assert.match(route, /getCurrentPlatformViewer\(\)/);
    assert.match(route, /application\/json/);
    assert.match(route, /export async function POST/);
    assert.match(route, /export async function PATCH/);
    assert.doesNotMatch(route, /export async function DELETE/);
  }
  assert.match(actions, /Assign Shaper/);
  assert.match(actions, /End assignment/);
  assert.match(actions, /Assign exact version/);
  assert.match(actions, /\/api\/ops\/circle-shaper-assignments/);
  assert.match(actions, /\/api\/ops\/circle-resources/);
  assert.match(circlesPage, /getOpsCircleManagementOptions/);
  assert.match(circlesPage, /<OpsCircleManagementActions/);
});

test("member and operator public models no longer expose accountability or promotion-style progression", () => {
  assert.doesNotMatch(memberModel, /accountabilityPartner|ProgressionSummary|progression:/);
  assert.doesNotMatch(operatorModel, /accountabilityPartner|accountability\.manage|progression:/);
  assert.doesNotMatch(operatorRepository, /assignOpsAccountabilityPartner|accountability_partner_assignments/);
  assert.doesNotMatch(operatorActions, /Accountability|accountability|Progression|progression/);
  assert.match(operatorModel, /circle\.resource\.manage/);
  assert.match(operatorModel, /circle\.shaper\.manage/);
});
