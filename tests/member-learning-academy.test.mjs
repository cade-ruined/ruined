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
  videoPlayer,
  preview,
  repository,
  listPage,
  detailPage,
  streamRoute,
  shell,
] = await Promise.all([
  source("src/components/membership/MemberLearningLibrary.tsx"),
  source("src/components/membership/MemberLearningArticle.tsx"),
  source("src/components/membership/MemberLibraryVideo.tsx"),
  source("src/lib/membership/preview.ts"),
  source("src/lib/membership/repository.ts"),
  source("app/my/library/page.tsx"),
  source("app/my/library/[slug]/page.tsx"),
  source("app/api/my/learn/[slug]/stream/route.ts"),
  source("src/components/platform/PlatformShell.tsx"),
]);

test("Library is searchable and organized by collection and resource cards", () => {
  assert.match(library, /^"use client";/);
  assert.match(library, /data-member-library/);
  assert.match(library, /<h1[^>]*>\s*Library\s*<\/h1>/);
  assert.match(library, /aria-label="Search Library"/);
  assert.match(library, /aria-pressed=/);
  assert.match(library, /data-library-resource-card/);
  assert.match(library, /resource\.href/);
  assert.match(library, /resource\.thumbnailUrl/);
  assert.match(library, /resource\.durationLabel/);
  assert.match(library, /resource\.presenter/);
  assert.doesNotMatch(library, /MemberPageHeader/);
  assert.doesNotMatch(library, /Not content\. Material\./);
});

test("video lessons use an accessible native player without surprise autoplay", () => {
  assert.match(lesson, /data-member-library-resource/);
  assert.match(videoPlayer, /<video/);
  assert.match(videoPlayer, /\bcontrols\b/);
  assert.match(videoPlayer, /\bplaysInline\b/);
  assert.match(videoPlayer, /preload="metadata"/);
  assert.match(lesson, /resource\.videoUrl/);
  assert.match(lesson, /resource\.thumbnailUrl/);
  assert.match(videoPlayer, /kind="captions"/);
  assert.doesNotMatch(videoPlayer, /\bautoPlay\b|\bautoplay\b/);
  assert.match(lesson, /aria-labelledby="academy-up-next"/);
  assert.match(lesson, /id="academy-up-next"/);
  assert.match(lesson, />\s*Up next\s*</);
  assert.match(lesson, />\s*About this call\s*</);
  assert.match(detailPage, /getMemberLearning\(authUserId\)/);
  assert.match(detailPage, /<MemberLearningArticle related=\{context\.data\.related\}/);
});

test("the preview library uses the supplied first recording without placeholder lessons", () => {
  const detailPreview = section(preview, "export const PREVIEW_MEMBER_LEARNING_DETAILS", "} satisfies Record<string, MemberLearningResourceDetail>;");
  assert.match(detailPreview, /"foundations-01"/);
  assert.match(detailPreview, /resourceType: "video"/);
  assert.doesNotMatch(detailPreview, /BigBuckBunny|Sintel|flower\.mp4|welcome-to-ruined|turning-pressure-into-direction/);
  assert.match(detailPage, /getPreviewMemberLearningResource\(slug\)/);
});

test("Library pages and private video streams preserve member access boundaries", () => {
  for (const page of [listPage, detailPage]) {
    assert.match(page, /getMembershipPageContext\(/);
    assert.match(page, /context\.state === "signed_out"[\s\S]*redirect\(["`]\/access\?returnTo=/);
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

test("Library shares the member paper shell without duplicate membership chrome", () => {
  assert.match(shell, /const memberLearning = member && \(pathname === "\/my\/library"/);
  assert.match(
    shell,
    /const paperSurface = memberHome \|\| memberCircle \|\| memberExperiences \|\| memberLearning \|\| memberSupport \|\| memberSettings \|\| timeline/,
  );
  assert.match(
    shell,
    /memberHome \|\| memberCircle \|\| memberExperiences \|\| memberLearning[\s\S]*?"member-profile-paper"/,
  );
  assert.match(shell, /hideBrand=\{paperSurface\}/);
  assert.match(shell, /!paperSurface \? <span>/);
});
