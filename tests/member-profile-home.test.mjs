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

const [home, portrait, shell, navigation, siteNavigation, repository, preview] = await Promise.all([
  source("src/components/platform/MemberHome.tsx"),
  source("src/components/membership/CircleMemberPortrait.tsx"),
  source("src/components/platform/PlatformShell.tsx"),
  source("src/components/platform/MemberNavigationFab.tsx"),
  source("src/data/navigation.ts"),
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
  const hero = section(home, "data-member-profile-hero", "</header>");
  assert.match(home, /member\.circleMembers/);
  assert.match(home, /import CircleMemberPortrait/);
  assert.match(home, /<CircleMemberPortrait/);
  assert.match(portrait, /person\.avatarUrl/);
  assert.match(portrait, /previewCirclePortraitStyle\(person\.id\)/);
  assert.match(home, /member\.artifacts/);
  assert.match(home, /member\.upcomingExperiences/);
  assert.match(home, /member\.foundations\.requirements\.activeCircle/);
  assert.match(home, /<p className=\{microLabel\}>Member<\/p>/);
  assert.match(home, /data-member-more/);
  assert.match(home, /const foundationsIsNext = member\.nextAction\.kind === "foundations"/);
  assert.match(home, /data-primary-action-tone=\{foundationsIsNext \? "verdigris" : "faded"\}/);
  assert.match(home, /foundationsIsNext \? "bg-\[var\(--color-verdigris\)\]/);
  assert.match(home, /data-foundations-action/);
  assert.match(home, /bg-\[var\(--color-faded\)\] p-3\.5 text-\[var\(--color-bone\)\]/);
  assert.match(home, /data-circle-action/);
  assert.match(home, /bg-\[var\(--color-shop\)\] p-3\.5 text-\[var\(--color-faded\)\]/);
  assert.match(home, /Want more\?/);
  assert.match(home, /mailto:connect@theruinedproject\.com/);
  assert.match(home, /const contributionWays = \["Shape", "Build", "Author", "Partner"\]/);
  assert.doesNotMatch(home, /Current level/);
  assert.doesNotMatch(home, /Membership progression/);
  assert.doesNotMatch(home, /member\.progression/);
  assert.match(home, /circleGateOutstanding/);
  assert.match(home, /!member\.foundations\.requirements\.activeCircle\.completed/);
  assert.match(home, /aria-valuetext=\{foundationValueText\}/);
  assert.match(home, /ProfileState state=\{member\.identity\.standingState\}/);
  assert.match(home, /href="\/my\/circle"/);
  assert.match(home, /href="\/my\/artifacts"/);
  assert.match(home, /href="\/my\/experiences"/);
  assert.match(home, /href="\/my\/profile"/);
  assert.match(home, /aria-label="Edit profile"/);
  assert.match(home, /data-member-profile-edit/);
  assert.match(home, /data-member-profile-hero/);
  assert.match(home, /data-member-profile-portrait/);
  assert.match(home, /data-member-profile-identity/);
  assert.match(home, /const profileBio = member\.profile\.bio\?\.trim\(\) \|\| member\.profile\.buildingNow\?\.trim\(\) \|\| null/);
  assert.match(home, /data-member-profile-bio/);
  assert.ok(hero.indexOf("Joined {formatMonthYear(member.memberSince)}") < hero.indexOf("data-member-profile-bio"));
  assert.doesNotMatch(home, /data-member-profile-purpose/);
  assert.doesNotMatch(home, /what I’m building/);
  assert.doesNotMatch(home, /Add what you’re building/);
  assert.match(home, /absolute right-0 top-0 z-10 grid size-11/);
  assert.doesNotMatch(home, /Edit profile →/);
  assert.doesNotMatch(home, /member\.identity\.memberId/);
  assert.doesNotMatch(home, /0047/);
  assert.doesNotMatch(home, /Mitch/);
  assert.doesNotMatch(home, /Circle 03/);
});

test("next actions use a responsive bento and deeper participation stays below the member work", () => {
  const header = section(home, "<header>", "</header>");
  const hero = section(home, "data-member-profile-hero", "</header>");
  const memberHome = section(home, "export default function MemberHome", "</main>");
  assert.match(home, /data-member-next-actions/);
  assert.match(home, /data-member-history-entry/);
  assert.match(home, /grid-cols-\[4\.7rem_minmax\(0,1fr\)\][^\n]*bg-black\/\[0\.035\][^\n]*sm:p-4/);
  assert.match(home, /grid grid-cols-2 gap-3 pb-2 pr-2 sm:gap-4[\s\S]*?lg:grid-cols-12/);
  assert.match(home, /lg:col-span-5 lg:row-span-2/);
  assert.match(home, /shadow-\[7px_8px_0_var\(--color-poster\)\]/);
  assert.match(home, /shadow-\[7px_8px_0_rgba\(0,0,0,0\.5\)\]/);
  assert.match(home, /active:translate-x-\[2px\]/);
  assert.match(home, /const upcoming = member\.upcomingExperiences\[0\] \?\? null/);
  assert.match(home, /href=\{member\.nextAction\.href\}/);
  assert.match(home, /href="\/my\/foundations"/);
  assert.match(home, /href="\/my\/circle"/);
  assert.match(home, /circleGateOutstanding \? "Active Circle required" : foundationHeading/);
  assert.match(hero, /MemberPortrait member=\{member\}/);
  assert.match(hero, /data-member-profile-identity/);
  assert.match(hero, /data-member-profile-bio/);
  assert.doesNotMatch(hero, /data-member-profile-purpose/);
  assert.doesNotMatch(hero, /what I’m building/);
  assert.ok(memberHome.indexOf("data-member-profile-hero") < memberHome.indexOf("<NextActionsBento"));
  assert.doesNotMatch(home, /aria-label="Membership snapshot"/);
  assert.doesNotMatch(header, /<WantMore \/>/);
  assert.ok(home.lastIndexOf("<WantMore />") > home.indexOf('id="experiences-title"'));
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

test("profile, Circle, Experiences, Academy, and Timeline get light paper dossiers without repeated top branding", () => {
  const main = section(home, "<main", "<header>");
  assert.match(shell, /const memberHome = member && pathname === "\/my"/);
  assert.match(shell, /const memberCircle = member && pathname\.startsWith\("\/my\/circle"\)/);
  assert.match(shell, /const memberExperiences = member && pathname\.startsWith\("\/my\/experiences"\)/);
  assert.match(shell, /const memberLearning = member && pathname\.startsWith\("\/my\/learn"\)/);
  assert.match(shell, /const timeline = member && pathname === "\/my\/foundations\/timeline"/);
  assert.match(shell, /const paperSurface = memberHome \|\| memberCircle \|\| memberExperiences \|\| memberLearning \|\| timeline/);
  assert.match(shell, /timeline[\s\S]*?"member-timeline-paper"/);
  assert.match(shell, /memberHome \|\| memberCircle \|\| memberExperiences \|\| memberLearning[\s\S]*?"member-profile-paper"/);
  assert.match(shell, /const dark = !member \|\| threshold \|\| \(foundations && !timeline\)/);
  assert.match(shell, /member-profile-paper/);
  assert.match(shell, /data-platform-member-home/);
  assert.match(shell, /hideBrand=\{paperSurface\}/);
  assert.match(shell, /!paperSurface \? <span>/);
  assert.match(shell, /member && !threshold && !foundationsExperience/);
  assert.match(navigation, /\{ href: "\/my", label: "Profile" \}/);
  assert.match(navigation, /\{ href: "\/my\/profile", label: "Edit profile" \}/);
  assert.match(preview, /circleMembers: previewCircleMembers/);
  assert.match(preview, /upcomingExperiences: previewUpcomingExperiences/);
  assert.doesNotMatch(main, /border/);
  assert.doesNotMatch(main, /shadow/);
});

test("profile refinements use the established handwritten and section-label systems", () => {
  assert.match(home, /const microLabel =[\s\S]*?--font-cadehandy2/);
  assert.match(home, /text-\[clamp\(1\.6rem,6\.5vw,2\.05rem\)\]/);
  assert.match(home, /sm:text-\[clamp\(2\.2rem,4\.7vw,4\.25rem\)\]/);
  assert.match(home, /grid-cols-\[minmax\(0,1\.15fr\)_minmax\(0,0\.85fr\)\]/);
  assert.match(home, /self-start lg:max-w-\[30rem\]/);
  assert.match(home, /sm:grid-cols-\[minmax\(17rem,0\.88fr\)_minmax\(0,1\.12fr\)\]/);
  assert.match(home, /lg:grid-cols-\[minmax\(22rem,0\.88fr\)_minmax\(0,1\.12fr\)\]/);
  assert.match(home, /rounded-\[4px\]/);
  assert.match(home, /Joined \{formatMonthYear\(member\.memberSince\)\}/);
  assert.match(
    siteNavigation,
    /pathname === "\/my" \|\| pathname\.startsWith\("\/my\/"\)\) return "MEMBERS"/,
  );
});
