import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [
  memberPage,
  memberRecord,
  directory,
  shell,
  workPage,
  artifactPage,
  experiencePage,
  announcementPage,
  systemPage,
  oldAccessBillingPage,
] = await Promise.all([
  source("app/ops/members/[memberId]/page.tsx"),
  source("src/components/platform/OperatorMemberRecord.tsx"),
  source("src/components/platform/OperatorMemberDirectory.tsx"),
  source("src/components/platform/PlatformShell.tsx"),
  source("app/ops/work/page.tsx"),
  source("app/ops/artifacts/page.tsx"),
  source("app/ops/experiences/page.tsx"),
  source("app/ops/announcements/page.tsx"),
  source("app/ops/system/page.tsx"),
  source("app/ops/access-billing/page.tsx"),
]);

test("the member directory opens one unified, server-projected operating record", () => {
  assert.match(directory, /href=\{`\/ops\/members\/\$\{member\.memberId\}`\}/);
  assert.match(memberPage, /getOpsMemberOperatingRecord\(context\.viewer\.authUserId, memberId\)/);
  assert.match(memberPage, /context\.state === "signed_out"[\s\S]*redirect\("\/ops\/access"\)/);
  assert.match(memberPage, /if \(!record\) notFound\(\)/);

  for (const section of ["overview", "membership", "journey", "community", "record"]) {
    assert.match(memberRecord, new RegExp(`id="${section}"`));
    assert.match(memberRecord, new RegExp(`"#${section}"`));
  }
  assert.doesNotMatch(memberRecord, /divide-y|border-y|uppercase tracking-\[0\.1/);
  assert.match(memberRecord, /Manage member record/);
  assert.match(memberRecord, /OperatorTaskCreateAction/);
  assert.match(memberRecord, /OperatorNoteAction/);
  assert.match(memberRecord, /OperatorOverrideAction/);
  assert.match(memberRecord, /OperatorAccountabilityAction/);
});

test("operator navigation stays restrained while every working surface remains reachable", () => {
  for (const route of [
    "/ops/members",
    "/ops/foundations",
    "/ops/circles",
    "/ops/blocks",
    "/ops/experiences",
    "/ops/work",
  ]) {
    assert.match(shell, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(shell, /href: "\/ops\/access-billing"/);
  assert.match(oldAccessBillingPage, /redirect\("\/ops\/system"\)/);
});

test("work, Artifact, Experience, announcement, and system routes fail closed and have preview states", () => {
  for (const page of [workPage, artifactPage, experiencePage, announcementPage, systemPage]) {
    assert.match(page, /context\.state === "signed_out"[\s\S]*redirect\("\/ops\/access"\)/);
    assert.match(page, /context\.state === "denied"/);
    assert.match(page, /context\.state === "preview"/);
    assert.match(page, /context\.viewer/);
    assert.match(page, /PlatformUnavailable/);
  }
  assert.match(workPage, /getOpsWorkQueue/);
  assert.match(artifactPage, /getOpsArtifactQueue/);
  assert.match(experiencePage, /getOpsExperienceDirectory/);
  assert.match(announcementPage, /getOpsAnnouncements/);
  assert.match(systemPage, /getOpsSystemHealth/);
});
