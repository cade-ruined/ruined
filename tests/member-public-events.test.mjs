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
  events,
  adapter,
  model,
  repository,
  preview,
  memberHome,
  memberExperiences,
] = await Promise.all([
  source("src/data/events.ts"),
  source("src/lib/events/member-experiences.ts"),
  source("src/lib/membership/model.ts"),
  source("src/lib/membership/repository.ts"),
  source("src/lib/membership/preview.ts"),
  source("src/components/platform/MemberHome.tsx"),
  source("src/components/membership/MemberExperiences.tsx"),
]);

test("public member experiences are derived from the canonical event registry", () => {
  assert.match(adapter, /import\s+\{[\s\S]*\bEVENTS\b[\s\S]*\}\s+from\s+"@\/data\/events"/);
  assert.match(adapter, /export function memberExperienceFromStudioEvent\s*\(/);
  assert.match(adapter, /export function getUpcomingPublicMemberExperiences\s*\(/);
  assert.match(adapter, /EVENTS\s*\.filter\s*\(/);

  const summary = section(
    model,
    "export type MemberExperienceSummary = {",
    "export type MemberArtifactSummary",
  );
  assert.match(summary, /detailHref: string;/);
  assert.match(summary, /registrationHref: string \| null;/);

  const conversion = section(
    adapter,
    "export function memberExperienceFromStudioEvent",
    "export function getUpcomingPublicMemberExperiences",
  );
  assert.match(conversion, /id:[^\n]*event\.id/);
  assert.match(conversion, /title:\s*event\.title/);
  assert.match(
    conversion,
    /detailHref:\s*`\/community#\$\{encodeURIComponent\(event\.id\)\}`/,
  );
  assert.match(conversion, /registrationHref:[^\n]*event\.registration\?\.href[^\n]*null/);
});

test("public event detail links and registration links remain separate", () => {
  assert.match(adapter, /export function publicEventDetailHref\s*\(/);
  assert.match(adapter, /`\/community#\$\{encodeURIComponent\(eventId\)\}`/);

  const conversion = section(
    adapter,
    "export function memberExperienceFromStudioEvent",
    "export function getUpcomingPublicMemberExperiences",
  );
  assert.doesNotMatch(conversion, /detailHref:\s*event\.registration/);
  assert.doesNotMatch(conversion, /registrationHref:\s*publicEventDetailHref/);
});

test("the timed BYOB event uses an explicit timezone-safe instant", () => {
  assert.match(events, /T14:00:00\.000Z/);
  assert.doesNotMatch(events, /T08:00:00(?![\d:])/);

  const conversion = section(
    adapter,
    "export function memberExperienceFromStudioEvent",
    "export function getUpcomingPublicMemberExperiences",
  );
  assert.match(adapter, /ABSOLUTE_DATE_TIME\.test\(event\.dateTime\)/);
  assert.match(adapter, /Date\.parse\(event\.dateTime\)/);
  assert.match(adapter, /new Date\(timestamp\)\.toISOString\(\)/);
  assert.match(conversion, /startsAt:\s*eventStartsAt\(event\)/);
});

test("public events merge into member upcoming events without weakening entitlement SQL", () => {
  const loader = section(
    repository,
    "export async function getMemberExperiences",
    "export async function setMemberExperienceRegistration",
  );

  assert.match(repository, /mergeUpcomingPublicMemberExperiences/);
  assert.match(loader, /mergeUpcomingPublicMemberExperiences\s*\(/);

  // The database query remains the authority for member, Circle, Block,
  // progression, and invite-only entitlements. Public registry events merge
  // only after those rows have been authorized and adapted.
  assert.match(loader, /with membership_scope as\s*\(/);
  assert.match(loader, /experience\.visibility in \('public', 'all_members'\)/);
  assert.match(loader, /experience\.visibility = 'circle' and experience\.circle_id = scope\.circle_id/);
  assert.match(loader, /experience\.visibility = 'block' and experience\.block_id = scope\.block_id/);
  assert.match(loader, /experience\.visibility = 'progression'[\s\S]*experience\.progression_level_slug = scope\.current_progression_level_slug/);
  assert.match(loader, /experience\.visibility = 'invite_only'[\s\S]*registration\.status in \('external_pending', 'registered', 'waitlisted'\)/);

  const queryEnd = loader.indexOf("const now =");
  const firstPublicRegistryRead = loader.search(/mergeUpcomingPublicMemberExperiences\s*\(/);
  assert.ok(queryEnd >= 0, "the entitlement query boundary was not found");
  assert.ok(
    firstPublicRegistryRead > queryEnd,
    "canonical public events must merge after the entitlement query",
  );

  const mergeStart = adapter.indexOf("export function mergeUpcomingPublicMemberExperiences");
  assert.ok(mergeStart >= 0, "the public-event merge helper was not found");
  const merge = adapter.slice(mergeStart);
  assert.match(merge, /const merged = \[\.\.\.memberExperiences\]/);
  assert.match(merge, /merged\.findIndex\s*\(/);
  assert.match(merge, /experience\.detailHref/);
  assert.match(merge, /experience\.detailHref === publicExperience\.detailHref/);
  assert.match(merge, /merged\.push\(publicExperience\)/);
  assert.match(merge, /\.sort\s*\(/);
  assert.match(merge, /startsAt/);
});

test("membership preview derives public events without requiring a permanent named event", () => {
  assert.match(preview, /getUpcomingPublicMemberExperiences/);
  assert.match(
    preview,
    /previewExperience\s*=\s*previewPublicExperiences\[0\]\s*\?\?\s*null/,
  );
  assert.match(preview, /previewUpcomingExperiences\s*=\s*\[previewMeeting, \.\.\.previewPublicExperiences\]/);
  assert.match(preview, /upcomingExperiences: previewUpcomingExperiences/);
  assert.match(preview, /upcoming: previewUpcomingExperiences/);
  assert.doesNotMatch(preview, /throw new Error\("The preview public event is not configured\."\)/);
  assert.doesNotMatch(preview, /BYOB_02_EVENT_KEY|"byob-02"/);
  assert.doesNotMatch(
    preview,
    /const previewExperience\s*=\s*\{[\s\S]*?title:\s*"BYOB Nº 02"/,
  );
});

test("every profile Upcoming row opens its canonical event detail", () => {
  const upcoming = section(
    memberHome,
    "member.upcomingExperiences.slice(0, 3).map",
    "</ol>",
  );
  assert.match(upcoming, /<Link[\s\S]*?href=\{experience\.detailHref\}[\s\S]*?<article/);
  assert.doesNotMatch(upcoming, /href=\{experience\.registrationHref\}/);
});

test("experience index titles open canonical details and rows expose matching IDs", () => {
  const row = section(
    memberExperiences,
    "function ExperienceRow",
    "export default function MemberExperiences",
  );
  assert.match(row, /<li[^>]*\bid=\{`experience-\$\{experience\.id\}`\}/);
  assert.match(
    row,
    /<h3[\s\S]*?<Link[^>]*href=\{experience\.detailHref\}[\s\S]*?\{experience\.title\}[\s\S]*?<\/Link>[\s\S]*?<\/h3>/,
  );
});
