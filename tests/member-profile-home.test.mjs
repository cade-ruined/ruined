import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

const [home, shell, navigation, repository, preview] = await Promise.all([
  source("src/components/platform/MemberHome.tsx"),
  source("src/components/platform/PlatformShell.tsx"),
  source("src/components/platform/MemberNavigationFab.tsx"),
  source("src/lib/membership/repository.ts"),
  source("src/lib/membership/preview.ts"),
]);

test("member home is an identity-led profile instead of the old membership landing page", () => {
  assert.match(home, /`Welcome, \$\{preferredName\}\.\`/);
  assert.match(home, /member\.profile\.preferredName/);
  assert.match(home, /bg-\[var\(--color-highlight\)\]/);
  assert.match(home, /Portrait not added/);
  assert.match(home, /Photo pending/);
  assert.match(home, /data-member-polaroid/);
  assert.match(home, /data-member-profile-dossier/);
  assert.match(home, /\/membership\/polaroid-frame\.png/);
  assert.match(home, /\/membership\/portrait-pending-editorial\.webp/);
  assert.match(home, /\/membership\/archive-material-placeholder\.webp/);
  assert.match(home, /data-placeholder/);
  assert.match(home, />History</);
  assert.match(home, />Artifacts</);
  assert.match(home, />Upcoming</);
  assert.match(home, />Member info</);
  assert.match(home, /member\.profile\.fullName/);
  assert.doesNotMatch(home, /Do the next true thing/);
  assert.doesNotMatch(home, /Members & Membership/);
  assert.doesNotMatch(home, /Ruined Membership \/ Home/);
  assert.doesNotMatch(home, /EditorialImagePlaceholder/);
  assert.doesNotMatch(home, /Membership at a glance/);
  assert.doesNotMatch(home, /Your place\./);
  assert.doesNotMatch(home, /Private completion recorded/);
  assert.doesNotMatch(home, /Membership started/);
});

test("member profile preserves the supplied Polaroid frame byte for byte", async () => {
  const frame = await readFile(new URL("../public/membership/polaroid-frame.png", import.meta.url));
  assert.equal(
    createHash("sha256").update(frame).digest("hex"),
    "cc05a8d4c91b4efb1c2707379f8877457f1c07a0e71711e4719b508945133b31",
  );
});

test("member profile modules only use real membership data and valid routes", () => {
  assert.match(home, /member\.circleMembers/);
  assert.match(home, /member\.artifacts/);
  assert.match(home, /member\.upcomingExperiences/);
  assert.match(home, /member\.foundations\.requirements\.activeCircle/);
  assert.match(home, /member\.progression\.position/);
  assert.match(home, /circleGateOutstanding/);
  assert.match(home, /!member\.foundations\.requirements\.activeCircle\.completed/);
  assert.match(home, /aria-valuetext=\{foundationValueText\}/);
  assert.match(home, /ProfileState state=\{member\.identity\.standingState\}/);
  assert.match(home, /const state = current \? "Current" : reached \? "Reached" : "Upcoming"/);
  assert.match(home, /href="\/my\/circle"/);
  assert.match(home, /href="\/my\/artifacts"/);
  assert.match(home, /href="\/my\/experiences"/);
  assert.match(home, /href="\/my\/profile"/);
  assert.doesNotMatch(home, /member\.identity\.memberId/);
  assert.doesNotMatch(home, /0047/);
  assert.doesNotMatch(home, /Mitch/);
  assert.doesNotMatch(home, /Circle 03/);
});

test("member home repository separates preferred greeting data and suppresses private arrays", () => {
  const loader = section(
    repository,
    "export async function getMemberHome",
    "export async function getMemberTimeline",
  );
  assert.match(loader, /membership_activated_at as member_since/);
  assert.match(loader, /from ruined_members/);
  assert.doesNotMatch(loader, /coalesce\(membership_activated_at, created_at\)/);
  assert.match(loader, /profile\.directory\.preferredName\?\.trim\(\) \|\| profile\.directory\.displayName/);
  assert.match(loader, /displayName: profile\.directory\.displayName/);
  assert.match(loader, /fullName: profile\.privateProfile\.legalName/);
  assert.match(loader, /visibleArtifacts = suppressPrivateHighlights \? \[\] : artifacts\.awards/);
  assert.match(loader, /visibleCircleMembers = suppressPrivateHighlights \? \[\] : circle\.members/);
  assert.match(loader, /visibleUpcomingExperiences = suppressPrivateHighlights \? \[\] : experiences\.upcoming/);
});

test("profile home gets a light paper dossier without repeated top branding", () => {
  const main = section(home, "<main", "<header>");
  assert.match(shell, /const memberHome = member && pathname === "\/my"/);
  assert.match(shell, /const dark = !member \|\| threshold \|\| foundations;/);
  assert.match(shell, /member-profile-paper/);
  assert.match(shell, /data-platform-member-home/);
  assert.match(shell, /hideBrand=\{memberHome\}/);
  assert.match(shell, /!memberHome \? <span>/);
  assert.match(shell, /member && !threshold && !foundationsExperience/);
  assert.match(navigation, /\{ href: "\/my", label: "Profile" \}/);
  assert.match(navigation, /\{ href: "\/my\/profile", label: "Edit profile" \}/);
  assert.match(preview, /circleMembers: \[previewSelf, previewPartner\]/);
  assert.match(preview, /upcomingExperiences: \[previewMeeting, previewExperience\]/);
  assert.doesNotMatch(main, /border/);
  assert.doesNotMatch(main, /shadow/);
});
