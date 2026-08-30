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
  library,
  lesson,
  preview,
  repository,
  listPage,
  detailPage,
  streamRoute,
  shell,
] = await Promise.all([
  source("src/components/membership/MemberLearningLibrary.tsx"),
  source("src/components/membership/MemberLearningArticle.tsx"),
  source("src/lib/membership/preview.ts"),
  source("src/lib/membership/repository.ts"),
  source("app/my/learn/page.tsx"),
  source("app/my/learn/[slug]/page.tsx"),
  source("app/api/my/learn/[slug]/stream/route.ts"),
  source("src/components/platform/PlatformShell.tsx"),
]);

test("Learn is a compact, searchable Academy organized by category and lesson cards", () => {
  assert.match(library, /^"use client";/);
  assert.match(library, /data-member-academy/);
  assert.match(library, /<h1[^>]*>\s*Academy\s*<\/h1>/);
  assert.match(library, /aria-label="Search Academy"/);
  assert.match(library, /aria-pressed=/);
  assert.match(library, /data-academy-resource-card/);
  assert.match(library, /resource\.href/);
  assert.match(library, /resource\.thumbnailUrl/);
  assert.match(library, /resource\.durationLabel/);
  assert.match(library, /resource\.presenter/);
  assert.doesNotMatch(library, /MemberPageHeader/);
  assert.doesNotMatch(library, /Not content\. Material\./);
});

test("video lessons use an accessible native player without surprise autoplay", () => {
  assert.match(lesson, /data-member-academy-lesson/);
  assert.match(lesson, /<video/);
  assert.match(lesson, /\bcontrols\b/);
  assert.match(lesson, /\bplaysInline\b/);
  assert.match(lesson, /preload="metadata"/);
  assert.match(lesson, /resource\.videoUrl/);
  assert.match(lesson, /resource\.thumbnailUrl/);
  assert.match(lesson, /kind="captions"/);
  assert.doesNotMatch(lesson, /\bautoPlay\b|\bautoplay\b/);
  assert.match(lesson, /aria-labelledby="academy-up-next"/);
  assert.match(lesson, /id="academy-up-next"/);
  assert.match(lesson, />\s*Up next\s*</);
  assert.match(lesson, />\s*Lesson notes\s*</);
  assert.match(detailPage, /getMemberLearning\(authUserId\)/);
  assert.match(detailPage, /<MemberLearningArticle related=\{context\.data\.related\}/);
});

test("preview Academy is rich enough to demo several series and media types", () => {
  const detailPreview = section(
    preview,
    "export const PREVIEW_MEMBER_LEARNING_DETAILS",
    "} satisfies Record<string, MemberLearningResourceDetail>;",
  );
  assert.equal(
    detailPreview.match(/^  "[a-z0-9]+(?:-[a-z0-9]+)*": \{$/gm)?.length,
    7,
    "preview should define seven complete lesson records",
  );
  assert.equal(
    detailPreview.match(/resourceType: "video"/g)?.length,
    3,
    "preview should include three playable video lessons",
  );
  const libraryPreview = section(
    preview,
    "export const PREVIEW_MEMBER_LEARNING:",
    "export const PREVIEW_MEMBER_ARTIFACTS",
  );
  assert.equal(
    libraryPreview.match(/previewLearningSummary\(/g)?.length,
    7,
    "all seven lesson records should be discoverable from the Academy",
  );
  assert.equal(
    libraryPreview.match(/description: /g)?.length,
    3,
    "preview should include three Academy series",
  );
  assert.match(preview, /export const PREVIEW_MEMBER_LEARNING_DETAILS/);
  assert.match(detailPage, /getPreviewMemberLearningResource\(slug\)/);
});

test("Academy pages and private video streams preserve member access boundaries", () => {
  for (const page of [listPage, detailPage]) {
    assert.match(page, /getMembershipPageContext\(/);
    assert.match(page, /context\.state === "signed_out"[\s\S]*redirect\("\/my\/access"\)/);
    assert.match(page, /context\.state === "denied"[\s\S]*reason="member_access"/);
  }
  assert.match(detailPage, /notFound\(\)/);

  const learningLoader = section(
    repository,
    "export async function getMemberLearning(",
    "export async function getMemberLearningResource(",
  );
  const resourceLoader = section(
    repository,
    "export async function getMemberLearningResource(",
    "export type MemberFoundationRequirements",
  );
  for (const loader of [learningLoader, resourceLoader]) {
    assert.match(loader, /requireMemberIdentity\(authUserId\)/);
    assert.match(loader, /memberCan\(access, "learn\.read"\)/);
    assert.match(loader, /from learning_resource_targets target/);
    assert.match(loader, /target\.audience_type = 'all_members'/);
    assert.match(loader, /target\.audience_type = 'circle'/);
    assert.match(loader, /target\.audience_type = 'block'/);
    assert.match(loader, /target\.audience_type = 'progression'/);
  }
  assert.match(resourceLoader, /\^\[a-z0-9\]/);

  assert.match(streamRoute, /getCurrentPlatformViewer\(\)/);
  assert.match(streamRoute, /getMemberLearningResource\(viewer\.authUserId, slug\)/);
  assert.match(streamRoute, /resource\.resourceType !== "video"/);
  assert.match(streamRoute, /resource\.storageBucket/);
  assert.match(streamRoute, /resource\.storagePath/);
  assert.match(streamRoute, /createSignedUrl\(resource\.storagePath/);
});

test("Academy shares the member paper shell without duplicate membership chrome", () => {
  assert.match(shell, /const memberLearning = member && pathname\.startsWith\("\/my\/learn"\)/);
  assert.match(
    shell,
    /const paperSurface = memberHome \|\| memberCircle \|\| memberExperiences \|\| memberLearning \|\| timeline/,
  );
  assert.match(
    shell,
    /memberHome \|\| memberCircle \|\| memberExperiences \|\| memberLearning[\s\S]*?"member-profile-paper"/,
  );
  assert.match(shell, /hideBrand=\{paperSurface\}/);
  assert.match(shell, /!paperSurface \? <span>/);
});
