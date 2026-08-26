import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [
  migration,
  hardeningMigration,
  migrationRunner,
  model,
  platformRepository,
  opsRepository,
  blockRoute,
  assignmentRoute,
  actions,
  blockPage,
  operatorComponents,
] = await Promise.all([
  source("db/migrations/20260826_membership_blocks.sql"),
  source("db/migrations/20260826_membership_blocks_hardening.sql"),
  source("scripts/migrate-platform.mjs"),
  source("src/lib/platform/model.ts"),
  source("src/lib/platform/repository.ts"),
  source("src/lib/platform/ops-repository.ts"),
  source("app/api/ops/blocks/route.ts"),
  source("app/api/ops/block-assignments/route.ts"),
  source("src/components/platform/OpsActions.tsx"),
  source("app/ops/blocks/page.tsx"),
  Promise.all([
    source("src/components/platform/OpsOverview.tsx"),
    source("src/components/platform/OpsSection.tsx"),
    source("src/components/platform/OpsActions.tsx"),
    source("src/components/platform/OpsBlocks.tsx"),
    source("src/components/platform/OperatorMemberDirectory.tsx"),
    source("src/components/platform/OperatorPageFrame.tsx"),
  ]).then((sources) => sources.join("\n")),
]);

test("Blocks and Circle assignment history are durable and migration-runner ordered", () => {
  assert.match(
    migrationRunner,
    /20260825_membership_foundations_circle_gate\.sql[\s\S]*20260826_membership_blocks\.sql[\s\S]*20260826_membership_blocks_hardening\.sql/,
  );
  assert.match(migration, /create table if not exists public\.membership_blocks \(/);
  assert.match(migration, /create table if not exists public\.block_circle_assignments \(/);
  assert.match(migration, /block_id uuid not null[\s\S]*references public\.membership_blocks\(id\) on delete restrict/);
  assert.match(migration, /circle_id uuid not null[\s\S]*references public\.circles\(id\) on delete restrict/);
  assert.match(
    migration,
    /create unique index if not exists block_circle_assignments_one_current_circle_idx[\s\S]*on public\.block_circle_assignments\(circle_id\)[\s\S]*where ended_at is null/,
  );
  for (const indexName of [
    "membership_blocks_created_by_idx",
    "membership_blocks_activated_by_idx",
    "block_circle_assignments_block_idx",
    "block_circle_assignments_circle_idx",
    "block_circle_assignments_assigned_by_idx",
    "block_circle_assignments_ended_by_idx",
    "block_circle_assignments_current_block_idx",
  ]) {
    assert.match(migration, new RegExp(`create index if not exists ${indexName}`));
  }
  assert.match(migration, /ended_at is not null and ended_by_auth_user_id is not null/);
  assert.doesNotMatch(opsRepository, /delete from block_circle_assignments/);
  assert.match(opsRepository, /end_reason = 'ops_ended_assignment'/);
});

test("Block hardening preserves private RLS access and the multiple-Circle invariant", () => {
  assert.match(
    migrationRunner,
    /revoke all on schema private from public, anon, authenticated;[\s\S]*grant usage on schema private to authenticated/,
  );
  assert.match(
    hardeningMigration,
    /revoke all on schema private from public, anon, authenticated;[\s\S]*grant usage on schema private to authenticated/,
  );
  assert.match(
    hardeningMigration,
    /before insert or update of status[\s\S]*private\.ruined_enforce_block_activation/,
  );
  assert.match(
    hardeningMigration,
    /create or replace function private\.ruined_reconcile_active_block\([\s\S]*current_circle_count < 2[\s\S]*status = 'archived'/,
  );
  assert.match(
    hardeningMigration,
    /after update of block_id, ended_at[\s\S]*private\.ruined_reconcile_block_assignment_change/,
  );
  assert.match(
    hardeningMigration,
    /after update of status[\s\S]*private\.ruined_reconcile_block_circle_status/,
  );
  assert.match(
    hardeningMigration,
    /before update or delete[\s\S]*private\.ruined_preserve_block_assignment_history/,
  );
  assert.match(hardeningMigration, /Ended Block assignment history is immutable/);
  assert.match(
    hardeningMigration,
    /from public\.circles circle[\s\S]*for update;[\s\S]*from public\.membership_blocks block_record[\s\S]*for update;/,
  );
  assert.match(
    hardeningMigration,
    /revoke all on function private\.ruined_reconcile_active_block\(uuid\)[\s\S]*from public, anon, authenticated/,
  );
});

test("Block activation requires two current Circles in both Postgres and the repository", () => {
  assert.match(migration, /create or replace function private\.ruined_enforce_block_activation\(\)/);
  assert.match(migration, /assignment\.ended_at is null/);
  assert.match(migration, /circle\.status in \('forming', 'active'\)/);
  assert.match(migration, /if current_circle_count < 2 then/);
  assert.match(migration, /before update of status[\s\S]*private\.ruined_enforce_block_activation/);

  assert.match(opsRepository, /export async function activateBlock/);
  assert.match(opsRepository, /const currentCircles = circleRows\.length/);
  assert.match(opsRepository, /if \(currentCircles < 2\)/);
  assert.match(opsRepository, /activated_by_auth_user_id = \$\{actorAuthUserId\}::uuid/);
  assert.match(actions, /At least two current Circles are required/);
  assert.match(actions, /Block activation does not add a Foundations gate/);
});

test("Block assignment serializes per Circle and preserves one current parent", () => {
  assert.match(opsRepository, /export async function assignCircleToBlock/);
  assert.match(opsRepository, /pg_advisory_xact_lock\(hashtext\(\$\{circleId\}\), 3\)/);
  assert.match(
    opsRepository,
    /assignCircleToBlock[\s\S]*from circles[\s\S]*for update[\s\S]*from membership_blocks[\s\S]*for update[\s\S]*from block_circle_assignments[\s\S]*ended_at is null[\s\S]*for update/,
  );
  assert.match(opsRepository, /That Circle already belongs to a Block/);
  assert.match(opsRepository, /assigned_by_auth_user_id[\s\S]*\$\{actorAuthUserId\}::uuid/);
  assert.match(migration, /private\.ruined_guard_block_circle_assignment/);
});

test("authenticated members can read only the Block reached through their own Circle", () => {
  assert.match(migration, /alter table public\.membership_blocks enable row level security/);
  assert.match(migration, /alter table public\.block_circle_assignments enable row level security/);
  assert.match(migration, /revoke all on table[\s\S]*public\.membership_blocks[\s\S]*from anon, authenticated/);
  assert.match(migration, /create policy block_circle_assignments_select_own/);
  assert.match(migration, /member_assignment\.member_id = private\.ruined_current_active_access_member_id\(\)/);
  assert.match(migration, /create or replace function private\.ruined_current_active_access_block_id\(\)/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /grant select \(name, status\) on table public\.membership_blocks to authenticated/);
  assert.doesNotMatch(migration, /grant select on table[\s\S]{0,120}public\.block_circle_assignments/);
  assert.match(migration, /create policy membership_blocks_select_own/);
  assert.match(migration, /id = private\.ruined_current_active_access_block_id\(\)/);
  assert.doesNotMatch(migration, /create policy[\s\S]{0,140}\bfor (?:insert|update|delete|all)\b/i);

  assert.match(model, /blockName: string \| null/);
  assert.match(model, /blockStatus: BlockState \| null/);
  assert.doesNotMatch(model.match(/export type MemberPlatformSnapshot = \{([\s\S]*?)\n\};/)?.[1] ?? "", /blockId|circles|members/);
  assert.match(
    platformRepository,
    /getMemberPlatformSnapshot[\s\S]*block_assignment\.circle_id = active_circle\.circle_id[\s\S]*block_assignment\.ended_at is null/,
  );
  assert.match(platformRepository, /blockName: row\.block_name/);
  assert.match(platformRepository, /blockStatus: row\.block_status/);
});

test("Block APIs keep lifecycle fields server-owned and repeat route security boundaries", () => {
  for (const route of [blockRoute, assignmentRoute]) {
    assert.match(route, /isTrustedPlatformOrigin\(request\)/);
    assert.match(route, /const viewer = await getCurrentPlatformViewer\(\)/);
    assert.match(route, /if \(!viewer\)[\s\S]*401/);
    assert.match(route, /startsWith\("application\/json"\)/);
    assert.match(route, /actorAuthUserId: viewer\.authUserId/);
    assert.match(route, /Cache-Control": "no-store"/);
  }
  const createBody = blockRoute.match(/type BlockRequestBody = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  const assignmentBody = assignmentRoute.match(
    /type BlockCircleAssignmentRequestBody = \{([\s\S]*?)\n\};/,
  )?.[1] ?? "";
  assert.match(createBody, /name\?: unknown/);
  assert.doesNotMatch(createBody, /slug|status|startsAt|activated|role/);
  assert.match(assignmentBody, /blockId\?: unknown/);
  assert.match(assignmentBody, /circleId\?: unknown/);
  assert.doesNotMatch(assignmentBody, /status|endedAt|reason|role/);
});

test("operator totals are independent from the capped visible roster", () => {
  const dashboard = platformRepository.slice(
    platformRepository.indexOf("export async function getOperatorDashboard"),
  );
  assert.match(dashboard, /limit 100[\s\S]*const aggregateRows = await tx/);
  assert.match(dashboard, /with scoped_members as/);
  assert.match(dashboard, /count\(\*\) as total_members/);
  assert.match(dashboard, /activeMembers: Number\(aggregates\?\.active_members/);
  assert.match(dashboard, /attentionRequired: Number\(aggregates\?\.attention_required/);
  assert.match(dashboard, /unassignedMembers: Number\(aggregates\?\.unassigned_members/);
  assert.doesNotMatch(dashboard, /activeMembers: members\.filter/);
});

test("operator Block controls are admin-only and the control room avoids data-tool styling", () => {
  assert.match(blockPage, /context\.role === "ops_admin" && context\.viewer/);
  assert.match(blockPage, /getOpsBlockSummaries\(context\.viewer\.authUserId\)/);
  assert.match(blockPage, /getOpsCircleSummaries\(context\.viewer\.authUserId\)/);
  assert.match(actions, /"\/api\/ops\/blocks", \{ name \}/);
  assert.match(actions, /"\/api\/ops\/block-assignments"/);
  assert.doesNotMatch(operatorComponents, /font-mono/);
  assert.doesNotMatch(operatorComponents, /tooltip|hover card|AI hint/i);
  assert.match(operatorComponents, /font-\[var\(--font-body\)\]/);
  assert.match(operatorComponents, /bg-\[var\(--color-bone\)\]/);
});
