import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("membership workflow claims are leased, retryable, and dead-letter safely", async () => {
  const [repository, migration] = await Promise.all([
    source("src/lib/workflows/repository.ts"),
    source("db/migrations/20260826_membership_operating_spine_04_foundations_automation.sql"),
  ]);

  assert.match(repository, /for update skip locked/i);
  assert.match(repository, /status = 'processing'/);
  assert.match(repository, /locked_by = \$\{workerId\}/);
  assert.match(repository, /Worker lease expired before completion/);
  assert.match(repository, /2 \*\* Math\.max\(0, action\.attempts - 1\)/);
  assert.match(repository, /status = \$\{terminal \? "dead_letter" : "failed"\}/);
  assert.match(repository, /workflow_action_attempts/);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /workflow_action_attempts_append_only/);
  assert.doesNotMatch(repository, /sync_external_identity/);
  assert.doesNotMatch(migration, /sync_external_identity/);
});

test("agreement receipts reproduce the accepted snapshot instead of editable legal copy", async () => {
  const [renderer, repository, route, migration] = await Promise.all([
    source("src/lib/membership/agreement-receipt.ts"),
    source("src/lib/workflows/repository.ts"),
    source("app/api/my/agreement/receipt/route.ts"),
    source("db/migrations/20260826_membership_operating_spine_02_lifecycle_agreements.sql"),
  ]);

  assert.match(renderer, /source\.agreementBody/);
  assert.match(renderer, /source\.agreementContentSha256/);
  assert.match(renderer, /createHash\("sha256"\)/);
  assert.match(repository, /acceptance\.agreement_body_snapshot as "agreementBody"/);
  assert.match(repository, /delivery_method[\s\S]*?'database_snapshot'/);
  assert.match(repository, /agreementReceiptSha256\(receipt\)/);
  assert.match(route, /renderAgreementReceiptForVersion/);
  assert.match(route, /agreementReceiptSha256/);
  assert.match(migration, /membership_agreement_receipts/);
  assert.match(migration, /delivery_method in \('database_snapshot', 'storage'\)/);
});

test("membership workflow endpoint is private and has scheduled recovery", async () => {
  const [route, vercel] = await Promise.all([
    source("app/api/internal/membership/process/route.ts"),
    source("vercel.json"),
  ]);

  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /processWorkflowBatch\(50\)/);
  assert.match(vercel, /\/api\/internal\/membership\/process/);
});

test("workflow side effects are idempotent and retain immutable evidence", async () => {
  const repository = await source("src/lib/workflows/repository.ts");
  const milestoneHandler = repository.slice(
    repository.indexOf("async function projectMilestone"),
    repository.indexOf("async function createOperatorTask"),
  );

  assert.match(repository, /on conflict \(acceptance_id\) do nothing/);
  assert.match(repository, /on conflict \(dedupe_key\) do update/);
  assert.match(
    repository,
    /on conflict \(idempotency_key\) where idempotency_key is not null do update/,
  );
  assert.match(repository, /member_notification_events/);
  assert.match(repository, /operator_task_events/);
  assert.match(repository, /artifact_job_events/);
  assert.match(milestoneHandler, /on conflict \(dedupe_key\) do nothing/);
  assert.match(milestoneHandler, /select id[\s\S]*from member_milestones[\s\S]*where dedupe_key/);
  assert.doesNotMatch(milestoneHandler, /do update/);
});

test("published announcements fan out once to each eligible active member", async () => {
  const repository = await source("src/lib/workflows/repository.ts");
  const announcementHandler = repository.slice(
    repository.indexOf("async function sendAnnouncementNotifications"),
    repository.indexOf("async function sendNotification"),
  );

  assert.match(announcementHandler, /announcement\.status = 'published'/);
  assert.match(announcementHandler, /lifecycle\.account_state = 'active'/);
  assert.match(announcementHandler, /lifecycle\.billing_state = 'active'/);
  assert.match(announcementHandler, /lifecycle\.administrative_onboarding_state = 'completed'/);
  assert.match(announcementHandler, /role_grant\.role_slug = 'member'/);
  assert.match(announcementHandler, /role_grant\.revoked_at is null/);
  assert.match(announcementHandler, /member_announcement_targets/);
  for (const targetType of ["all_active_members", "member", "circle", "block", "progression"]) {
    assert.match(announcementHandler, new RegExp(`target\\.target_type = '${targetType}'`));
  }
  assert.match(announcementHandler, /announcement_id/);
  assert.match(announcementHandler, /on conflict \(dedupe_key\) do nothing/);
  assert.match(announcementHandler, /member_notification_events/);
  assert.match(
    repository,
    /action\.targetType === "member_announcement"[\s\S]*sendAnnouncementNotifications\(action\)/,
  );
});

test("announcement creation stores the exact active-member audience contract", async () => {
  const [component, operationsMigration, opsRepository, memberRepository] = await Promise.all([
    source("src/components/platform/OperatorWorkActions.tsx"),
    source("db/migrations/20260826_membership_operating_spine_05_content_operations.sql"),
    source("src/lib/platform/ops-operating-repository.ts"),
    source("src/lib/membership/repository.ts"),
  ]);

  assert.match(component, /value="all_active_members">All active members/);
  assert.match(opsRepository, /input\.targetKind !== "all_active_members"/);
  assert.match(opsRepository, /'all_active_members'/);
  assert.match(operationsMigration, /target_type in \('all_active_members', 'circle', 'block', 'progression', 'member'\)/);
  assert.match(memberRepository, /target\.target_type = 'all_active_members'/);
  assert.doesNotMatch(
    opsRepository.slice(
      opsRepository.indexOf("export async function createOpsAnnouncement"),
      opsRepository.indexOf("export async function publishOpsAnnouncement"),
    ),
    /'all_members'/,
  );
});
