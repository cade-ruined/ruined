import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function functionSource(sourceText, startMarker, endMarker) {
  const start = sourceText.indexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} was not found`);
  assert.ok(end > start, `${endMarker} was not found after ${startMarker}`);
  return sourceText.slice(start, end);
}

const [
  apiRoute,
  repository,
  home,
  experience,
  shell,
  memberPage,
  experiencePage,
  migration,
] = await Promise.all([
  source("app/api/my/foundations/route.ts"),
  source("src/lib/foundations/repository.ts"),
  source("src/components/foundations/MemberFoundationsHome.tsx"),
  source("src/components/foundations/MemberFoundationsExperience.tsx"),
  source("src/components/foundations/PresentationShell.tsx"),
  source("app/my/foundations/page.tsx"),
  source("app/my/foundations/experience/page.tsx"),
  source("db/migrations/20260825_membership_foundations_circle_gate.sql"),
]);

test("Circle is a completion condition, not a condition for starting or progressing", () => {
  const start = functionSource(
    repository,
    "export async function startMemberFoundations",
    "export async function recordMemberFoundationProgress",
  );
  const progress = functionSource(
    repository,
    "export async function recordMemberFoundationProgress",
    "export function isCircleCompletionConstraint",
  );
  const completion = functionSource(
    repository,
    "export async function completeMemberFoundations",
    "\n}",
  );

  assert.doesNotMatch(start, /circle_member_assignments|CircleRequired/);
  assert.doesNotMatch(progress, /circle_member_assignments|CircleRequired/);
  assert.match(completion, /from circle_member_assignments assignment/);
  assert.match(completion, /assignment\.ended_at is null/);
  assert.match(completion, /assignment\.assigned_at <= statement_timestamp\(\)/);
  assert.match(completion, /circle\.status = 'active'/);
  assert.match(completion, /circle\.activated_at <= statement_timestamp\(\)/);
  assert.match(completion, /CircleRequiredForFoundationCompletionError/);
  assert.match(completion, /for no key update of circle/);
  assert.doesNotMatch(completion, /for (?:no key )?update of assignment/);
  assert.match(completion, /completed_at = coalesce\(completed_at, statement_timestamp\(\)\)/);
  assert.match(completion, /returning completed_at, completion_circle_assignment_id/);
  assert.equal(
    completion.match(/\$\{completion\.completed_at\}/g)?.length,
    3,
    "lifecycle and both completion history events must share the durable completion time",
  );

  assert.match(home, /A Circle is not required to begin or continue/);
  assert.match(home, /required only when you complete the final moment/);
  assert.match(shell, /COMPLETION BEGINS WITH A CIRCLE/);
  assert.match(shell, /Complete Foundations/);
});

test("Foundations writes derive member, progress, version, and Circle proof on the server", () => {
  const requestType = apiRoute.match(
    /type FoundationAction =([\s\S]*?);\n\nfunction isFoundationAction/,
  )?.[1] ?? "";

  assert.match(requestType, /action: "start"/);
  assert.match(requestType, /action: "progress"; momentId: string/);
  assert.match(requestType, /action: "complete"/);
  assert.doesNotMatch(requestType, /memberId|circleId|version|percent|status/i);
  assert.match(apiRoute, /isTrustedPlatformOrigin\(request\)/);
  assert.match(apiRoute, /getPlatformConfiguration\(\)\.mode !== "connected"/);
  assert.match(apiRoute, /const viewer = await getCurrentPlatformViewer\(\)/);
  assert.match(apiRoute, /recordMemberFoundationProgress\(viewer, body\.momentId\)/);
  assert.match(apiRoute, /completeMemberFoundations\(viewer\)/);
  assert.match(apiRoute, /code: "circle_required"/);
  assert.ok(
    (repository.match(/program_record\.slug = 'ruined-foundations'/g) ?? []).length >= 3,
    "published versions and enrollments must stay scoped to the Ruined Foundations program",
  );
  assert.match(
    repository,
    /from platform_users platform_user[\s\S]*join platform_role_grants member_grant[\s\S]*member_grant\.role_slug = 'member'[\s\S]*member_grant\.revoked_at is null[\s\S]*platform_user\.auth_user_id = \$\{viewer\.authUserId\}::uuid[\s\S]*platform_user\.status = 'active'/,
  );
});

test("Foundations history gives Postgres explicit JSON identifier types", () => {
  assert.match(
    repository,
    /jsonb_build_object\('enrollment_id', \$\{enrollment\.id\}::uuid\)/,
  );
  assert.equal(
    repository.match(/'enrollment_id', \$\{enrollment\.id\}::uuid/g)?.length,
    3,
  );
  assert.equal(
    repository.match(/'circle_id', \$\{circle\.circle_id\}::uuid/g)?.length,
    2,
  );
  assert.equal(
    repository.match(/'circle_assignment_id', \$\{completionProof\}::bigint/g)?.length,
    2,
  );
});

test("member journey saves only sequential moment position and cannot arrow past completion", () => {
  assert.match(experience, /activeIndex !== state\.completedUnits \+ 1/);
  assert.match(experience, /FOUNDATION_MOMENTS\[activeIndex - 1\]/);
  assert.match(experience, /action: "progress", momentId: completedMoment\.id/);
  assert.match(experience, /failedMoment\.current === completedMoment\.id/);
  assert.match(experience, /failedMoment\.current = completedMoment\.id/);
  assert.match(experience, /state\.completedUnits \+ 1/);
  assert.match(experience, /const finalProgressPending =/);
  assert.match(experience, /if \(saving \|\| completing \|\| finalProgressPending\) return false/);
  assert.match(experience, /pending: saving \|\| completing \|\| finalProgressPending/);
  assert.match(shell, /Math\.min\(index, upperMomentIndex\)/);
  assert.match(shell, /if \(!member\) setClosingOverview\(true\)/);
  assert.match(shell, /if \(await props\.member\.onComplete\(\)\)/);
  assert.match(shell, /closingOverview \|\| Boolean\(member\)/);
});

test("reflection content remains ephemeral while resume position is persisted", () => {
  assert.match(home, /only your place in the path is saved/);
  assert.match(shell, /YOUR WORDS STAY IN THIS MOMENT/);
  assert.doesNotMatch(experience, /responses|reflection|textarea|localStorage|sessionStorage/);
  assert.doesNotMatch(apiRoute, /responses|reflection|answer|fieldId/);
});

test("member Foundations pages keep paid access gates and preview writes disabled", () => {
  for (const page of [memberPage, experiencePage]) {
    assert.match(page, /context\.state !== "preview"/);
    assert.match(page, /!hasActiveMemberAccess\(context\.member\)/);
    assert.match(page, /redirect\("\/my\/account"\)/);
    assert.match(page, /writable=\{false\}/);
  }
  assert.match(experiencePage, /!foundations\.enrollmentId/);
  assert.match(experiencePage, /redirect\("\/my\/foundations"\)/);

  const readState = functionSource(
    repository,
    "export async function getMemberFoundationsState",
    "export async function startMemberFoundations",
  );
  assert.match(readState, /isolation level repeatable read read only/);
  assert.match(readState, /join member_lifecycle lifecycle/);
  assert.match(readState, /platform_user\.status = 'active'/);
  assert.match(readState, /lifecycle\.account_state = 'active'/);
  assert.match(readState, /lifecycle\.billing_state = 'active'/);
  assert.match(readState, /lifecycle\.program_state in \('onboarding', 'active'\)/);
});

test("database records the active Circle assignment as durable completion proof", () => {
  assert.match(migration, /completion_circle_assignment_id bigint/);
  assert.match(migration, /foreign key \(completion_circle_assignment_id\)/);
  assert.match(migration, /private\.ruined_require_foundation_completion_circle\(\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /circle_record\.status = 'active'/);
  assert.match(migration, /assignment\.ended_at is null/);
  assert.match(migration, /new\.completion_circle_assignment_id := active_assignment_id/);
  assert.match(migration, /foundation_enrollments_completion_circle_guard/);
});
