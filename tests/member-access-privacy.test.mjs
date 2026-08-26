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
  accessPolicy,
  repository,
  profileApi,
  profileEditor,
  foundationsApi,
  foundationsExperience,
  foundationsShell,
  foundationsMemberPage,
  foundationsExperiencePage,
] = await Promise.all([
  source("src/lib/membership/access-policy.ts"),
  source("src/lib/membership/repository.ts"),
  source("app/api/my/profile/route.ts"),
  source("src/components/membership/MemberProfileEditor.tsx"),
  source("app/api/my/foundations/route.ts"),
  source("src/components/foundations/MemberFoundationsExperience.tsx"),
  source("src/components/foundations/PresentationShell.tsx"),
  source("app/my/foundations/page.tsx"),
  source("app/my/foundations/experience/page.tsx"),
]);

test("non-active membership states never inherit full member capabilities", () => {
  const accountGate = accessPolicy.indexOf('identity.accountState !== "active"');
  const fullReturn = accessPolicy.lastIndexOf("capabilities: FULL_CAPABILITIES");
  assert.ok(accountGate >= 0 && accountGate < fullReturn);
  assert.match(accessPolicy, /identity\.accountState === "closed"[\s\S]*capabilities: \["account\.read"\]/);
  assert.match(accessPolicy, /identity\.accountState === "suspended"[\s\S]*capabilities: \["account\.read"\]/);

  const identityLoader = section(
    repository,
    "export async function getMemberIdentity",
    "async function requireMemberIdentity",
  );
  assert.match(identityLoader, /member_grant\.role_slug = 'member'/);
  assert.match(identityLoader, /platform_user\.status = 'active'/);
  assert.doesNotMatch(identityLoader, /user_type/);
});

test("private member loaders stop before private queries when capability is absent", () => {
  const circle = section(repository, "export async function getMemberCircle", "export async function getMemberExperiences");
  assert.ok(circle.indexOf('memberCan(access, "circle.read")') < circle.indexOf("const sql = getApplicationDatabase()"));
  assert.match(circle, /members: \[\][\s\S]*resources: \[\]/);

  const artifacts = section(repository, "export async function getMemberArtifacts", "export async function getMemberUpdates");
  assert.ok(artifacts.indexOf('memberCan(access, "artifacts.read")') < artifacts.indexOf("const sql = getApplicationDatabase()"));

  const updates = section(repository, "export async function getMemberUpdates", "export async function markMemberNotificationRead");
  assert.ok(updates.indexOf('memberCan(access, "updates.read")') < updates.indexOf("const sql = getApplicationDatabase()"));

  const timeline = section(repository, "export async function getMemberTimeline", "export type MemberTimelineInput");
  assert.match(timeline, /requireMemberCapability\(identity, "foundations\.write"\)/);

  const requirements = section(repository, "export async function getMemberFoundationRequirements", "export async function getMemberHome");
  assert.match(requirements, /memberCan\(access, "foundations\.summary"\)/);
  assert.ok(requirements.indexOf('memberCan(access, "foundations.summary")') < requirements.indexOf("const sql = getApplicationDatabase()"));
});

test("Home removes private highlights for entry and limited access", () => {
  const home = section(repository, "export async function getMemberHome", "export async function getMemberTimeline");
  assert.match(home, /requireMemberCapability\(identity, "home\.read"\)/);
  assert.match(home, /access\.mode === "entry" \|\| access\.mode === "limited" \|\| access\.mode === "suspended"/);
  assert.match(home, /blockName: suppressPrivateHighlights \? null/);
  assert.match(home, /circleName: suppressPrivateHighlights \? null/);
  assert.match(home, /partner: suppressPrivateHighlights \? null/);
  assert.match(home, /unreadUpdates: suppressPrivateHighlights \? 0/);
  assert.match(home, /const firstArtifact = suppressPrivateHighlights \? null/);
  assert.match(home, /const latestAnnouncement = suppressPrivateHighlights/);
});

test("Circle directory visibility is an explicit hidden-by-default member choice", () => {
  assert.match(profileEditor, /name="circle-directory-enabled"/);
  assert.match(profileEditor, /Off by default/);
  assert.match(profileEditor, /directoryStatus:[\s\S]*\? "circle_visible"[\s\S]*: "hidden"/);
  assert.match(profileApi, /\["hidden", "circle_visible"\]\.includes\(String\(candidate\.directoryStatus\)\)/);
  assert.match(repository, /directoryStatus: row\.directory_status \?\? "hidden"/);
  assert.match(repository, /const directoryStatus = input\.directory\.directoryStatus/);
  assert.doesNotMatch(repository, /const directoryStatus = "circle_visible"/);
  assert.match(repository, /directory_status: directoryStatus/);
});

test("Future Letter navigation waits for the durable marker and never submits its text", () => {
  for (const page of [foundationsMemberPage, foundationsExperiencePage]) {
    assert.match(page, /getMemberFoundationRequirements/);
    assert.match(page, /\.\.\.foundations, requirements/);
  }

  assert.match(foundationsExperience, /action: "complete_requirement"/);
  assert.match(foundationsExperience, /requirement: "future_letter"/);
  assert.match(foundationsExperience, /setState\(\(current\) => \(\{ \.\.\.current, requirements \}\)\)/);
  assert.doesNotMatch(foundationsExperience, /letterBody|letterText|letterValues/);

  assert.match(foundationsShell, /member\?\.futureLetterCompleted \?\? false/);
  assert.match(foundationsShell, /if \(futureLetterBlocked\) return/);
  assert.match(foundationsShell, /Math\.min\(memberUpperMomentIndex, letterMomentIndex\)/);
  assert.ok(
    foundationsShell.indexOf("await props.member.onFutureLetterComplete()") <
      foundationsShell.indexOf("props.setLetterComplete(true)"),
  );

  const requestGuard = section(foundationsApi, "function isFoundationAction", "function errorResponse");
  assert.match(requestGuard, /candidate\.requirement === "future_letter"/);
  assert.match(requestGuard, /key === "action" \|\| key === "requirement"/);
});
