import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [
  frame,
  overview,
  progress,
  section,
  styles,
  actions,
  stateLabel,
  shell,
  memberRecord,
] = await Promise.all([
  source("src/components/platform/OperatorPageFrame.tsx"),
  source("src/components/platform/OpsOverview.tsx"),
  source("src/components/platform/OperatorProgress.tsx"),
  source("src/components/platform/OpsSection.tsx"),
  source("src/components/platform/operatorStyles.ts"),
  source("src/components/platform/OpsActions.tsx"),
  source("src/components/platform/StateLabel.tsx"),
  source("src/components/platform/PlatformShell.tsx"),
  source("src/components/platform/OperatorMemberRecord.tsx"),
]);

test("operator pages let navigation name the route once", () => {
  assert.match(frame, /<h1 className="sr-only">\{title\}<\/h1>/);
  assert.doesNotMatch(frame, /Ruined Operations \/|introduction \?/);
  assert.doesNotMatch(section, /SECTION_COPY|A member still needs an active Circle/);
});

test("the Overview is an activity-first linked snapshot", () => {
  assert.match(overview, /Recent activity/);
  assert.match(overview, /data\.activity/);
  assert.match(overview, /Needs a decision/);
  assert.match(overview, /\/ops\/members\?filter=attention/);
  assert.match(overview, /\/ops\/members\?filter=unassigned/);
  assert.doesNotMatch(overview, /The membership, in view|Member decisions/);
});

test("Foundations progress stays poster red until it reaches verdigris completion", () => {
  assert.match(progress, /progress === 100/);
  assert.match(progress, /bg-\[var\(--color-poster\)\]/);
  assert.match(progress, /bg-\[var\(--color-verdigris\)\]/);
  assert.match(section, /<OperatorProgress/);
});

test("operator fields reuse the Ruined intake language without tool eyebrows", () => {
  assert.match(styles, /font-cadehandy2/);
  assert.match(styles, /color-poster/);
  assert.match(styles, /color-shop/);
  assert.doesNotMatch(actions, />Admin action<|>Completion authority<|>Activation authority</);
  assert.doesNotMatch(stateLabel, /h-px w-4|uppercase tracking/);
});

test("operator navigation and member records avoid stacked utility rails and divider tables", () => {
  assert.match(shell, /member \? \(\s*<PlatformUtilityRail/);
  assert.match(shell, /<OperationsNavigation\s+configuration=\{configuration\}/);
  assert.doesNotMatch(memberRecord, /divide-y|border-y/);
  assert.doesNotMatch(memberRecord, /uppercase tracking-\[0\.1/);
  assert.match(memberRecord, /Manage member record/);
});
