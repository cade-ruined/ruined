import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [fixtures, directoryPage, recordPage, directory, record, googleField] = await Promise.all([
  source("src/lib/platform/ops-experience-preview.ts"),
  source("app/ops/experiences/page.tsx"),
  source("app/ops/experiences/[experienceId]/page.tsx"),
  source("src/components/platform/OperatorExperienceDirectory.tsx"),
  source("src/components/platform/OperatorExperienceRecord.tsx"),
  source("src/components/platform/OperatorGoogleCommunicationField.tsx"),
]);

test("preview Experiences expose creation with Circle and Block choices", () => {
  assert.match(fixtures, /PREVIEW_OPS_EXPERIENCE_DIRECTORY/);
  assert.match(fixtures, /canCreate: true/);
  assert.match(fixtures, /canManageGlobal: true/);
  assert.match(fixtures, /preview-circle-01/);
  assert.match(fixtures, /preview-block-01/);
  assert.match(directoryPage, /directory=\{PREVIEW_OPS_EXPERIENCE_DIRECTORY\}/);
  assert.match(directoryPage, /preview/);
  assert.match(directory, /Add an Experience/);
});

test("both preview Experience links resolve to complete operator records", () => {
  assert.match(fixtures, /"preview-experience-circle-01":/);
  assert.match(fixtures, /"preview-experience-02":/);
  assert.match(fixtures, /circleRoster/);
  assert.match(fixtures, /academyRoster/);
  assert.match(fixtures, /"waitlisted"/);
  assert.match(fixtures, /attendanceState/);
  assert.match(fixtures, /history:/);
  assert.match(fixtures, /meetingUrl: "https:\/\/meet\.google\.com/);
  assert.match(recordPage, /getPreviewOpsExperienceRecord\(experienceId\)/);
  assert.match(recordPage, /if \(!experience\) notFound\(\)/);
  assert.match(recordPage, /<OperatorExperienceRecord[\s\S]*preview/);
});

test("all preview Experience controls stop before their live request", () => {
  assert.match(directory, /if \(preview\) \{[\s\S]*draft was not saved[\s\S]*return;/);
  assert.match(record, /if \(preview\) \{[\s\S]*roster was not changed[\s\S]*return;/);
  assert.match(record, /if \(preview\) \{[\s\S]*attendance was not changed[\s\S]*return;/);
  assert.match(record, /if \(preview\) \{[\s\S]*Experience changes were not saved[\s\S]*return;/);
  assert.match(record, /if \(preview\) \{[\s\S]*Experience state was not changed[\s\S]*return;/);
  assert.match(record, /if \(preview\) \{[\s\S]*member was not added[\s\S]*return;/);
  assert.match(googleField, /if \(preview\) \{[\s\S]*link was not changed[\s\S]*return;/);
  assert.match(record, /preview=\{preview\}/);
  assert.match(directory, /preview=\{preview\}/);
});
