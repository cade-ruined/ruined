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
  assert.match(timeline, /!memberCan\(access, "foundations\.write"\) && !memberCan\(access, "foundations\.revisit"\)/);
  assert.ok(timeline.indexOf("throw new MembershipAccessDeniedError") < timeline.indexOf("readTimelineRecord("));

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
  assert.doesNotMatch(home, /partner:|accountabilityPartner/);
  assert.match(home, /unreadUpdates: suppressPrivateHighlights \? 0/);
  assert.match(home, /const firstArtifact = suppressPrivateHighlights \? null/);
  assert.match(home, /const latestAnnouncement = suppressPrivateHighlights/);
});

test("Circle identity is visible by default while email and phone remain explicitly scoped", () => {
  assert.doesNotMatch(profileEditor, /name="circle-directory-enabled"/);
  assert.match(profileEditor, /name="email-scope"/);
  assert.match(profileEditor, /name="phone-scope"/);
  const contactValidator = section(profileApi, "function isDirectory", "function isProfileInput");
  assert.match(contactValidator, /emailScope/);
  assert.match(contactValidator, /phoneScope/);
  assert.doesNotMatch(contactValidator, /directoryStatus/);
  assert.match(repository, /directoryStatus: "circle_visible"/);
  assert.match(repository, /const directoryStatus = "circle_visible"/);
  const circle = section(repository, "export async function getMemberCircle", "export async function getMemberExperiences");
  assert.match(circle, /preference\.email_scope = 'circle'/);
  assert.match(circle, /preference\.phone_scope = 'circle'/);
  assert.doesNotMatch(circle, /preference\.directory_status = 'circle_visible'/);
  assert.doesNotMatch(profileApi, /accountability_partner/);
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
