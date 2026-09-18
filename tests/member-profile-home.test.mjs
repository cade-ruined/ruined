import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";
const source=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const [home,repository,shell,layout,styles]=await Promise.all([source("src/components/platform/MemberHome.tsx"),source("src/lib/membership/repository.ts"),source("src/components/membership/MemberJourneyShell.tsx"),source("app/my/layout.tsx"),source("src/components/platform/MemberProfile.module.css")]);
function section(text,start,end){const from=text.indexOf(start),to=text.indexOf(end,from);assert.ok(from>=0&&to>from);return text.slice(from,to);}
test("member profile preserves the supplied Polaroid frame byte for byte", async () => {
  const frame = await readFile(new URL("../public/membership/polaroid-frame.png", import.meta.url));
  assert.equal(
    createHash("sha256").update(frame).digest("hex"),
    "cc05a8d4c91b4efb1c2707379f8877457f1c07a0e71711e4719b508945133b31",
  );
});

test("member home repository uses the editable display name and suppresses private arrays", () => {
  const loader = section(
    repository,
    "export async function getMemberHome",
    "export async function getMemberTimeline",
  );
  assert.match(loader, /membership_activated_at as member_since/);
  assert.match(loader, /from ruined_members/);
  assert.doesNotMatch(loader, /coalesce\(membership_activated_at, created_at\)/);
  assert.doesNotMatch(loader, /displayName: profile\.directory\.preferredName/);
  assert.match(loader, /memberTag: profile\.directory\.memberTag/);
  assert.match(loader, /displayName: profile\.directory\.displayName/);
  assert.match(loader, /fullName: profile\.privateProfile\.legalName/);
  assert.match(loader, /visibleArtifacts = suppressPrivateHighlights \? \[\] : artifacts\.awards/);
  assert.match(loader, /visibleCircleMembers = suppressPrivateHighlights \? \[\] : circle\.members/);
  assert.match(loader, /visibleUpcomingExperiences = suppressPrivateHighlights \? \[\] : experiences\.upcoming/);
});


test("profile keeps the approved assets and authentic member identity",()=>{
  assert.match(home,/member.displayName/);
  assert.match(home,/member.profile.bio/);
  assert.match(home,/\/membership\/polaroid-frame.png/);
  assert.match(home,/\/ruined-mark.svg/);
  assert.doesNotMatch(home,/Founding member|@cademangelson|Circle 01/);
  assert.match(home,/href="\/my\/profile"/);
  assert.match(styles,/@media\(max-width:359px\)/);
});
test("member layout owns one shared themed shell with complete navigation",()=>{
  assert.match(layout,/<MemberJourneyShell/);
  assert.match(shell,/MEMBER_PRIMARY_DESTINATIONS/);
  assert.match(shell,/data-member-theme/);
  assert.match(shell,/Settings|trigger="settings"/);
  assert.match(shell,/preview only|Preview only/);
});
