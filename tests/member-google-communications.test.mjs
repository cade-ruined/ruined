import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [helper, model, repository, preview, chatRoute, meetRoute, experienceAccess] = await Promise.all([
  source("src/lib/google/communications.ts"),
  source("src/lib/membership/model.ts"),
  source("src/lib/membership/repository.ts"),
  source("src/lib/membership/preview.ts"),
  source("app/api/my/circle/chat/route.ts"),
  source("app/api/my/experiences/[experienceId]/join/route.ts"),
  source("src/lib/platform/experience-member-access.ts"),
]);

test("member models expose protected communication routes without raw Google links", () => {
  assert.match(model, /communication:\s*\{[\s\S]*chatHref: string \| null/);
  assert.match(repository, /chatHref: chatReady \? "\/api\/my\/circle\/chat" : null/);
  assert.match(repository, /`\/api\/my\/experiences\/\$\{encodeURIComponent\(row\.id\)\}\/join`/);
  assert.doesNotMatch(preview, /https:\/\/(?:chat|meet)\.google\.com/);
});

test("Google destinations are read from environment-scoped integration links", () => {
  assert.match(repository, /from integration_entity_links link/);
  assert.match(repository, /link\.provider = 'google'/);
  assert.match(repository, /link\.external_entity_type = 'chat_space'/);
  assert.match(repository, /meet_link\.external_entity_type = 'meet_space'/);
  assert.match(repository, /link\.livemode = \$\{googleLivemode\}/);
  assert.match(helper, /GOOGLE_COMMUNICATIONS_LIVEMODE/);
  assert.match(helper, /if \(value === "true"\) return true/);
  assert.match(helper, /if \(value === "false"\) return false/);
  assert.match(helper, /return null/);
  assert.match(helper, /\["spaceUri", "space_uri", "chatUri", "chat_uri"\]/);
  assert.match(helper, /\["meetingUri", "meeting_uri", "meetUri", "meet_uri"\]/);
});

test("external redirects accept only canonical Google Chat and Meet destinations", () => {
  assert.match(helper, /url\.protocol !== "https:"/);
  assert.match(helper, /url\.hostname === "chat\.google\.com"/);
  assert.match(helper, /\(\?:room\|space\)/);
  assert.match(helper, /url\.hostname === "mail\.google\.com"/);
  assert.match(helper, /#chat\\\/space/);
  assert.match(helper, /url\.hostname !== "meet\.google\.com"/);
  assert.match(helper, /url\.username/);
  assert.match(helper, /url\.password/);
  assert.match(helper, /\(url\.port && url\.port !== "443"\)/);
  assert.doesNotMatch(repository, /meetingUrl:\s*row\.[A-Za-z_]*url/);
});

test("Chat and Meet redirects reauthorize members and never cache destinations", () => {
  for (const route of [chatRoute, meetRoute]) {
    assert.match(route, /getPlatformConfiguration\(\)\.mode !== "connected"/);
    assert.match(route, /getCurrentPlatformViewer\(\)/);
    assert.match(route, /"Cache-Control": "no-store"/);
    assert.match(route, /status: 303/);
    assert.match(route, /"Referrer-Policy": "no-referrer"/);
  }
  assert.match(chatRoute, /getMemberCircleChatDestination\(viewer\.authUserId\)/);
  assert.match(meetRoute, /getMemberExperienceMeetingDestination\([\s\S]*viewer\.authUserId[\s\S]*experienceId/);
  assert.match(repository, /requireMemberCapability\(identity, "circle\.read"\)/);
  const meetingAccess = repository.slice(repository.indexOf("export async function getMemberExperienceMeetingDestination"), repository.indexOf("export async function getMemberExperiences"));
  assert.match(meetingAccess, /const fullExperienceAccess = memberCan\(access, "experiences\.member"\)/);
  assert.match(meetingAccess, /const invitedExperienceIds = fullExperienceAccess \? \[\] : await getEligibleExplicitExperienceInvitationIds\(authUserId\)/);
  assert.match(meetingAccess, /if \(!fullExperienceAccess && !memberCan\(access, "circle\.read"\) && !invitedExperienceIds\.includes\(experienceId\)\) throw new MembershipAccessDeniedError/);
  assert.match(meetingAccess, /and \(\$\{fullExperienceAccess\} or \(experience\.visibility = 'circle' and experience\.circle_id = scope\.circle_id\)\s+or experience\.id = any\(\$\{sql\.array\(invitedExperienceIds\)\}::uuid\[\]\)\)/);
  assert.match(meetingAccess, /active_circle\.status = 'active'/);
  assert.match(meetingAccess, /member_assignment\.assigned_at <= statement_timestamp\(\)/);
  assert.match(meetingAccess, /active_circle\.activated_at <= statement_timestamp\(\)/);
  assert.match(repository, /member_assignment\.ended_at is null/);
  assert.match(repository, /experience\.visibility = 'circle' and experience\.circle_id = scope\.circle_id/);
  assert.match(repository, /experience\.visibility = 'block' and experience\.block_id = scope\.block_id/);
  assert.match(repository, /experience\.registration_mode = 'none'[\s\S]*or registration\.status = 'registered'/);
  assert.match(repository, /experience\.visibility = 'invite_only'[\s\S]*registration\.status in \('external_pending', 'registered', 'waitlisted'\)/);
});

test("the held-profile Meet exception uses server-verified operator invitations, never a client supplied audience", () => {
  const invitations = experienceAccess.slice(
    experienceAccess.indexOf("export async function getEligibleExplicitExperienceInvitationIds"),
    experienceAccess.indexOf("export async function hasEligibleExplicitExperienceInvitations"),
  );
  assert.match(invitations, /where auth_user_id = \$\{authUserId\}::uuid and status = 'active' and member_id is not null/);
  assert.match(invitations, /member\.person_id = registration\.person_id/);
  assert.match(invitations, /experience\.visibility = 'invite_only' and experience\.registration_mode = 'internal'/);
  assert.match(invitations, /experience\.status in \('published', 'completed'\)/);
  assert.match(invitations, /registration\.member_id = \$\{memberId\}::uuid/);
  assert.match(invitations, /registration\.status = 'registered' and registration\.source = 'ops'/);
  assert.match(invitations, /if \(!invitations\.length \|\| !await explicitInvitationMember\(tx, memberId, false\)\) return \[\]/);
  assert.match(invitations, /return invitations\.map\(invitation => invitation\.id\)/);
});
