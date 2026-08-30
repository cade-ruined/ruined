import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [helper, model, repository, preview, chatRoute, meetRoute] = await Promise.all([
  source("src/lib/google/communications.ts"),
  source("src/lib/membership/model.ts"),
  source("src/lib/membership/repository.ts"),
  source("src/lib/membership/preview.ts"),
  source("app/api/my/circle/chat/route.ts"),
  source("app/api/my/experiences/[experienceId]/join/route.ts"),
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
  assert.match(repository, /requireMemberCapability\(identity, "experiences\.member"\)/);
  assert.match(repository, /member_assignment\.ended_at is null/);
  assert.match(repository, /experience\.visibility = 'circle' and experience\.circle_id = scope\.circle_id/);
  assert.match(repository, /experience\.visibility = 'block' and experience\.block_id = scope\.block_id/);
  assert.match(repository, /experience\.registration_mode = 'none'[\s\S]*or registration\.status = 'registered'/);
  assert.match(repository, /experience\.visibility = 'invite_only'[\s\S]*registration\.status in \('external_pending', 'registered', 'waitlisted'\)/);
});
