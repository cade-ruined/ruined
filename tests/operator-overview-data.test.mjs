import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [repository, model, preview, memberRepository, page, component] = await Promise.all([
  source("src/lib/platform/ops-operating-repository.ts"),
  source("src/lib/platform/ops-model.ts"),
  source("src/lib/platform/ops-preview.ts"),
  source("src/lib/platform/repository.ts"),
  source("app/ops/page.tsx"),
  source("src/components/platform/OpsOverview.tsx"),
]);

const overview = repository.slice(
  repository.indexOf("export async function getOpsOverviewData"),
  repository.indexOf("export async function getOpsArtifactQueue"),
);

function activityBranch(stablePrefix) {
  const start = overview.indexOf(`'${stablePrefix}`);
  const end = overview.indexOf("\n\n        union all", start);
  assert.ok(start >= 0, `${stablePrefix} activity branch must exist`);
  return overview.slice(start, end < 0 ? undefined : end);
}

test("operator Overview data is bounded, server-authorized, and current-Circle scoped", () => {
  assert.match(overview, /requireOperatorAccess\(tx, actorAuthUserId\)/);
  assert.match(overview, /repeatable read read only/);
  assert.match(overview, /interval '90 days'/);
  assert.match(overview, /limit 30/);
  assert.match(overview, /circle_staff_assignments staff_assignment/);
  assert.match(overview, /circle_member_assignments member_assignment/);
  assert.match(overview, /role_grant\.revoked_at is null/);
  assert.match(overview, /staff_assignment\.ended_at is null/);
  assert.match(overview, /member_assignment\.ended_at is null/);
});

test("operator Overview uses durable activity sources without selecting private member content", () => {
  for (const sourceTable of [
    "domain_events",
    "member_state_history",
    "foundation_unit_progress",
    "member_foundation_requirement_completions",
    "circle_member_assignments",
    "experience_registrations",
    "experience_attendance_events",
    "artifact_job_events",
    "operator_task_events",
    "workflow_action_attempts",
  ]) {
    assert.match(overview, new RegExp(sourceTable));
  }

  for (const privateSource of [
    "member_timeline_entries",
    "member_timeline_entry_versions",
    "foundation_submissions",
    "foundation_submission_reviews",
    "operator_member_notes",
    "person_private_profiles",
    "membership_agreement_acceptances",
  ]) {
    assert.doesNotMatch(overview, new RegExp(privateSource));
  }
  assert.doesNotMatch(overview, /body_text|agreement_body_snapshot|acceptance_evidence|mobile_e164|legal_name/);
});

test("Foundations activity reports four chapter milestones instead of every moment", () => {
  const branch = activityBranch("foundation-unit:");
  assert.match(branch, /Completed Foundations \/ /);
  assert.match(branch, /sibling\.configuration ->> 'chapter' = unit\.configuration ->> 'chapter'/);
  assert.doesNotMatch(branch, /'Completed ' \|\| unit\.title/);
  assert.match(repository, /group by unit\.configuration ->> 'chapter'/);
});

test("sensitive Overview activity remains ops-admin only", () => {
  for (const prefix of [
    "domain:",
    "membership-state:",
    "onboarding:",
    "artifact-job:",
    "operator-task:",
    "workflow-attempt:",
    "announcement:",
  ]) {
    assert.match(activityBranch(prefix), /\$\{isAdmin\}/, `${prefix} must be admin gated`);
  }
});

test("operator Overview counts are aggregate queries rather than the capped dashboard roster", () => {
  assert.match(overview, /count\(\*\) as total_members/);
  assert.match(overview, /as eligible_without_circle/);
  assert.match(overview, /as foundations_in_progress/);
  assert.match(overview, /as active_circles/);
  assert.match(overview, /as workflow_failures/);
  assert.doesNotMatch(overview, /dashboard\.members|limit 100/);
});

test("operator Overview contract and preview expose stable activity, work, and upcoming experiences", () => {
  assert.match(model, /export type OpsOverviewActivityItem/);
  for (const field of ["activityId", "href", "kind", "memberId", "occurredAt", "subject", "summary", "tone"]) {
    assert.match(model, new RegExp(`${field}:`));
  }
  assert.match(model, /export type OpsOverviewData/);
  assert.match(model, /canPlaceMembers: boolean/);
  assert.match(model, /priorityWork: OpsWorkItem\[\]/);
  assert.match(model, /upcomingExperiences: OpsExperienceDirectoryItem\[\]/);
  assert.match(preview, /export const PREVIEW_OPS_OVERVIEW: OpsOverviewData/);
  assert.match(preview, /preview-activity-billing-01/);
  assert.match(preview, /priorityWork: PREVIEW_OPS_WORK_QUEUE\.items/);
  assert.match(preview, /upcomingExperiences: PREVIEW_OPS_EXPERIENCES/);
});

test("Overview decisions link to member filters with the same eligibility rules", () => {
  for (const condition of [
    /billing_state = 'attention_required'/,
    /account_state = 'suspended'/,
    /standing_state in \('paused', 'cancellation_requested'\)/,
    /program_state in \('onboarding', 'active'\)/,
  ]) {
    assert.match(overview, condition);
    assert.match(memberRepository, condition);
  }
  assert.match(overview, /circle_state <> 'active'/);
  assert.match(memberRepository, /circle\.status <> 'active'/);
});

test("Overview authorizes directly and only offers Circle placement to admins", () => {
  assert.doesNotMatch(page, /getOperatorPageContext/);
  assert.match(page, /getOpsOverviewData\(viewer\.authUserId\)/);
  assert.match(repository, /canPlaceMembers: isAdmin/);
  assert.match(component, /data\.canPlaceMembers \? \(/);
});
