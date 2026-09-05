import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function exportedFunctionBody(contents: string, name: string, nextName?: string): string {
  const start = contents.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName
    ? contents.indexOf(`export async function ${nextName}`, start + 1)
    : contents.length;
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`);
  return contents.slice(start, end);
}

const [invalidation, opsRepository, membershipRepository, platformRepository, operatingRepository] =
  await Promise.all([
    source("src/lib/platform/calendar-audience-invalidation.ts"),
    source("src/lib/platform/ops-repository.ts"),
    source("src/lib/membership/repository.ts"),
    source("src/lib/platform/repository.ts"),
    source("src/lib/platform/ops-operating-repository.ts"),
  ]);

test("audience invalidation is limited to published, live Google-linked Experiences", () => {
  assert.match(invalidation, /join experience_calendar_links calendar_link/);
  assert.match(invalidation, /calendar_link\.provider = 'google'/);
  assert.match(invalidation, /calendar_link\.status <> 'cancelled'/);
  assert.match(invalidation, /experience\.status = 'published'/);
  assert.match(invalidation, /reason: "attendees"/);
  assert.doesNotMatch(invalidation, /createGoogleCalendarEvent|updateGoogleCalendarEvent|cancelGoogleCalendarEvent/);
});

test("Circle roster changes invalidate their Circle and current Block audiences", () => {
  assert.match(invalidation, /experience\.visibility = 'circle'/);
  assert.match(invalidation, /experience\.circle_id = \$\{input\.circleId\}::uuid/);
  assert.match(invalidation, /experience\.visibility = 'block'/);
  assert.match(invalidation, /from block_circle_assignments block_assignment/);
  assert.match(invalidation, /block_assignment\.ended_at is null/);

  for (const body of [
    exportedFunctionBody(opsRepository, "assignMemberToCircle", "endMemberCircleAssignment"),
    exportedFunctionBody(opsRepository, "endMemberCircleAssignment"),
  ]) {
    assert.match(body, /markCalendarAudiencesPendingForCircle\(tx,/);
    assert.match(body, /actorAuthUserId/);
    assert.match(body, /circleId: assignment\.circle_id/);
  }
});

test("Block membership changes invalidate the old or new Block audience", () => {
  const assignBody = exportedFunctionBody(
    opsRepository,
    "assignCircleToBlock",
    "endCircleBlockAssignment",
  );
  const endBody = exportedFunctionBody(
    opsRepository,
    "endCircleBlockAssignment",
    "assignMemberToCircle",
  );
  for (const body of [assignBody, endBody]) {
    assert.match(body, /markCalendarAudiencesPendingForBlock\(tx,/);
    assert.match(body, /blockId: assignment\.block_id/);
  }
});

test("member eligibility invalidation covers assigned and confirmed-registration audiences", () => {
  assert.match(invalidation, /experience\.visibility = 'all_members'/);
  assert.match(invalidation, /experience\.circle_id = circle_assignment\.circle_id/);
  assert.match(invalidation, /experience\.block_id = block_assignment\.block_id/);
  assert.match(invalidation, /experience\.visibility in \('public', 'invite_only'\)/);
  assert.match(invalidation, /registration\.status = 'registered'/);
  assert.match(invalidation, /registration\.person_id = member\.person_id/);

  const onboardingBody = exportedFunctionBody(
    membershipRepository,
    "completeMemberAdministrativeOnboarding",
    "getMemberAccount",
  );
  assert.match(onboardingBody, /markCalendarAudiencesPendingForMember\(tx,/);
  assert.match(onboardingBody, /memberId: identity\.memberId/);

  const claimBody = exportedFunctionBody(
    platformRepository,
    "claimPlatformMemberForViewer",
    "getMemberPlatformSnapshot",
  );
  assert.match(claimBody, /markPersonEmailVerified\(tx,/);
  assert.match(claimBody, /markCalendarAudiencesPendingForMember\(tx,/);
  assert.match(claimBody, /memberId: member\.id/);

  const overrideBody = exportedFunctionBody(
    operatingRepository,
    "recordOpsMemberStateOverride",
    "createOpsTask",
  );
  assert.match(overrideBody, /\["account", "administrative_onboarding", "standing"\]/);
  assert.match(overrideBody, /markCalendarAudiencesPendingForMember\(tx,/);
});
