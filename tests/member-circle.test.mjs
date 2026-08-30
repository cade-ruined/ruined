import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [room, communication, cluster, clusterStyles, portrait, personProfile, personPage, home, preview, shell, repository] = await Promise.all([
  source("src/components/membership/MemberCircleRoom.tsx"),
  source("src/components/membership/CircleRoomCommunication.tsx"),
  source("src/components/membership/CircleMemberCluster.tsx"),
  source("src/components/membership/circle-member-cluster.module.css"),
  source("src/components/membership/CircleMemberPortrait.tsx"),
  source("src/components/membership/CirclePersonProfile.tsx"),
  source("app/my/circle/people/[personId]/page.tsx"),
  source("src/components/platform/MemberHome.tsx"),
  source("src/lib/membership/preview.ts"),
  source("src/components/platform/PlatformShell.tsx"),
  source("src/lib/membership/repository.ts"),
]);

test("member Circle is a profile-style room rather than an administrative roster", () => {
  assert.match(room, /data-member-circle-room/);
  assert.match(room, /member-profile-dossier/);
  assert.match(room, /<CircleMemberCluster members=\{visibleMembers\}/);
  assert.match(room, /circle\.members\.slice\(0, 10\)/);
  assert.match(room, /<CircleRoomCommunication/);
  assert.match(room, /circle\.communication\.chatHref/);
  assert.match(room, /circle\.communication\.chatState/);
  assert.match(room, /Shared with your Circle/);
  assert.match(room, /circle\.resources\.map/);
  assert.match(room, /futureMeetings\[0\]/);
  assert.match(room, />Shaper</);
  assert.match(room, /data-circle-shaper-profile-link/);
  assert.match(room, /\/my\/circle\/people\/\$\{encodeURIComponent\(circle\.shaper\.id\)\}/);
  assert.doesNotMatch(room, /MemberPageHeader/);
  assert.doesNotMatch(room, /EditorialImagePlaceholder/);
  assert.doesNotMatch(room, /Ruined Membership \/ Circle/);
  assert.doesNotMatch(room, /Accountability/i);
  assert.doesNotMatch(room, /circle\.accountabilityPartner/);
  assert.doesNotMatch(room, /border-[btlry]/);
});

test("Circle Chat and Meet share one restrained, branded room surface", () => {
  assert.match(communication, /data-circle-communications/);
  assert.match(communication, />\s*The room\s*</);
  assert.match(communication, /data-circle-chat-card/);
  assert.match(communication, /Circle Chat/);
  assert.match(communication, /Open Google Chat/);
  assert.match(communication, /bg-\[#B7CBDD\]/);
  assert.match(communication, /data-circle-meet-card/);
  assert.match(communication, /Join Google Meet/);
  assert.match(communication, /bg-\[#3B5D4F\]/);
  assert.match(communication, /rounded-\[4px\]/);
  assert.match(communication, /shadow-\[7px_8px_0_#15120f\]/);
  assert.match(communication, /meeting\.meetingUrl \? "Join Google Meet ↗" : "View gathering →"/);
  assert.match(communication, /target="_blank"/);
  assert.match(communication, /target=\{meeting\.meetingUrl \? "_blank" : undefined\}/);
  assert.match(communication, /data-state="unavailable"/);
  assert.match(communication, /data-state="unscheduled"/);
  assert.doesNotMatch(communication, /title=/);
  assert.doesNotMatch(communication, /border-[btlry]/);
});

test("the ten-person photo cluster stays data-driven, private, and keyboard accessible", () => {
  assert.match(cluster, /data-circle-member-cluster/);
  assert.match(cluster, /data-circle-member/);
  assert.match(cluster, /members\.slice\(0, 10\)/);
  assert.match(cluster, /visibleMembers\.map/);
  assert.match(cluster, /aria-label="Circle members"/);
  assert.match(cluster, /aria-label=\{`View \$\{person\.displayName\}`\}/);
  assert.match(cluster, /aria-pressed=\{selectedMember\}/);
  assert.match(cluster, /import CircleMemberPortrait/);
  assert.match(cluster, /<CircleMemberPortrait/);
  assert.match(cluster, /person\.isSelf/);
  assert.match(cluster, /data-circle-empty-roster/);
  assert.match(cluster, /data-circle-profile-link/);
  assert.match(cluster, /\/my\/circle\/people\/\$\{encodeURIComponent\(selected\.id\)\}/);
  assert.match(clusterStyles, /position:\s*absolute/);
  assert.match(clusterStyles, /border-radius:\s*999px/);
  assert.match(clusterStyles, /prefers-reduced-motion/);
  assert.doesNotMatch(cluster, /title=/);
});

test("preview shows ten distinct fictional portraits without fabricating connected members", () => {
  assert.equal(preview.match(/id: "preview-directory-(?:self|0[2-9]|10)"/g)?.length, 10);
  assert.match(preview, /const previewCircleMembers: PrivacySafePersonSummary\[\]/);
  assert.match(preview, /circleMembers: previewCircleMembers/);
  assert.match(preview, /members: previewCircleMembers/);
  assert.match(portrait, /if \(personId === "preview-directory-self"\) return 0/);
  assert.match(portrait, /personId\.match\(\/\^preview-directory-\(\\d\{2\}\)\$\//);
  assert.match(portrait, /Number\(match\[1\]\) - 1/);
  assert.match(portrait, /previewCirclePortraitStyle\(person\.id\)/);
  assert.match(portrait, /circle-preview-portraits\.webp/);
  assert.match(portrait, /person\.avatarUrl/);
  assert.match(portrait, /initials\(person\.displayName\)/);
  assert.doesNotMatch(cluster, /previewPortraitStyle\(index\)/);
  assert.match(repository, /const members = directoryRows\.map\(directoryPerson\)/);
  assert.match(repository, /members,/);
});

test("profile preview, Circle cluster, and person dossier share one ID-based portrait renderer", () => {
  assert.doesNotMatch(portrait, /"use client"/);
  assert.match(cluster, /import CircleMemberPortrait/);
  assert.match(cluster, /<CircleMemberPortrait/);
  assert.match(personProfile, /import CircleMemberPortrait/);
  assert.match(personProfile, /<CircleMemberPortrait/);
  assert.match(home, /import CircleMemberPortrait/);
  assert.match(home, /<CircleMemberPortrait/);
  assert.doesNotMatch(cluster, /function initials/);
  assert.doesNotMatch(personProfile, /function initials/);
  assert.doesNotMatch(home, /function initials/);
});

test("Circle shares the profile paper shell and member home no longer invents a partner role", () => {
  assert.match(shell, /const memberCircle = member && pathname\.startsWith\("\/my\/circle"\)/);
  assert.match(shell, /const paperSurface = memberHome \|\| memberCircle \|\| memberExperiences \|\| memberLearning \|\| timeline/);
  assert.match(shell, /memberHome \|\| memberCircle[\s\S]*?"member-profile-paper"/);
  assert.doesNotMatch(home, />Accountability</i);
  assert.doesNotMatch(home, /member\.partner/);
  assert.match(home, /\{member\.circleMembers\.length\} members/);
});

test("Circle member and Shaper links resolve through the viewer's privacy-safe Circle snapshot", () => {
  assert.match(personPage, /personFromCircle/);
  assert.match(personPage, /circle\.members\.find\(\(person\) => person\.id === personId\)/);
  assert.match(personPage, /circle\.shaper\?\.id === personId/);
  assert.match(personPage, /getMemberCircle\(authUserId\)/);
  assert.match(personPage, /if \(\(context\.state === "preview" \|\| context\.state === "authenticated"\) && !context\.data\) notFound\(\)/);
  assert.match(personProfile, /data-circle-person-profile/);
  assert.match(personProfile, /role === "shaper" \? "Shaper"/);
  assert.match(personProfile, /href=\{`mailto:\$\{person\.email\}`\}/);
  assert.match(personProfile, /href=\{`tel:\$\{person\.phone\}`\}/);
});
