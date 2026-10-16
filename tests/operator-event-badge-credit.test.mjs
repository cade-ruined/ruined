import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const loaded = { exports: {} };
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  new Function("require", "module", "exports", output)((name) => {
    if (name in dependencies) return dependencies[name];
    if (["react", "react/jsx-runtime"].includes(name)) return require(name);
    if (name === "@/lib/platform/badge-credit-model") return load("src/lib/platform/badge-credit-model.ts");
    if (name === "@/components/platform/operatorStyles") return load("src/components/platform/operatorStyles.ts");
    throw new Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const model = load("src/lib/platform/badge-credit-model.ts");
const parser = load("src/lib/platform/ops-experience-api.ts");
const membership = { track: "membership", stage: "see", month: "2026-10" };
const none = { track: "none", stage: null, month: null };
const draft = { title: "See / Why are just words in a title", kind: "weekly_call", capacity: null, waitlistEnabled: false };

test("credit accepts only explicit complete track, stage, month combinations", () => {
  for (const stage of ["see", "face", "cut", "grow"]) {
    assert.deepEqual(model.parseExperienceBadgeCredit({ ...membership, stage }), { ...membership, stage });
  }
  for (const stage of ["why", "implementation"]) {
    const value = { track: "circle", stage, month: "2026-12" };
    assert.deepEqual(model.parseExperienceBadgeCredit(value), value);
  }
  for (const track of ["none", "in_person"]) {
    assert.deepEqual(model.parseExperienceBadgeCredit({ track, stage: null, month: null }), { track, stage: null, month: null });
  }
  for (const value of [undefined, null, [], {}, { track: "membership" }, { ...membership, stage: null },
    { ...membership, stage: "why" }, { ...membership, stage: ["see"] }, { ...membership, month: "2026-13" },
    { ...membership, month: "2026-1" }, { ...membership, month: "0000-01" }, { ...membership, month: null },
    { ...membership, inferred: true }, { track: "circle", stage: "see", month: "2026-10" },
    { ...none, month: "2026-10" }, { track: "in_person", stage: "see", month: null },
  ]) assert.equal(model.parseExperienceBadgeCredit(value), null, JSON.stringify(value));
});

test("legacy, malformed, and title-only metadata never becomes badge evidence", () => {
  for (const metadata of [undefined, null, {}, [], { title: "Membership See call", email_cadence: "membership" },
    { badge_credit: { track: "membership", month: "2026-10" } },
  ]) assert.deepEqual(model.readExperienceBadgeCredit(metadata), none);
  assert.equal(Object.hasOwn(parser.parseOpsExperienceDraft(draft), "badgeCredit"), false);
  const metadata = { calendar: { providerEventId: "preserve-me" }, email_cadence: { kind: "membership" }, badge_credit: membership };
  assert.deepEqual(model.withExperienceBadgeCredit(metadata, undefined), metadata);
  assert.deepEqual(model.withExperienceBadgeCredit(metadata, none), { ...metadata, badge_credit: none });
  assert.deepEqual(metadata.badge_credit, membership, "the original metadata is not mutated");
});

test("API rejects credit incompatible with the event, Circle, location, or online link", () => {
  assert.deepEqual(parser.parseOpsExperienceDraft({ ...draft, badgeCredit: membership }).badgeCredit, membership);
  assert.equal(parser.parseOpsExperienceDraft({ ...draft, kind: "member_event", badgeCredit: membership }), null);
  assert.equal(parser.parseOpsExperienceDraft({ ...draft, circleId: "a-circle", badgeCredit: membership }), null);
  const circle = { track: "circle", stage: "why", month: "2026-10" };
  assert.equal(parser.parseOpsExperienceDraft({ ...draft, kind: "circle_meeting", badgeCredit: circle }), null);
  assert.deepEqual(parser.parseOpsExperienceDraft({ ...draft, kind: "circle_meeting", circleId: "a-circle", badgeCredit: circle }).badgeCredit, circle);
  const inPerson = { track: "in_person", stage: null, month: null };
  const physical = { ...draft, kind: "retreat", locationLabel: "Ruined studio, 123 Main Street", badgeCredit: inPerson };
  assert.deepEqual(parser.parseOpsExperienceDraft(physical).badgeCredit, inPerson);
  for (const locationLabel of ["", "   ", "Online", "Google Meet", "Zoom meeting", "https://meet.google.com/a"]) {
    assert.equal(parser.parseOpsExperienceDraft({ ...physical, locationLabel }), null);
  }
  assert.equal(parser.parseOpsExperienceCreateAndPublish({ ...physical, intent: "create_and_publish", requestId: "test", meetingUrl: "https://meet.google.com/abc-defg-hij" }), null);
  assert.equal(parser.parseOpsExperienceDraft({ ...physical, kind: "weekly_call" }), null);
});

const elements = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
function fixture(props = {}) {
  const states = []; let cursor = 0;
  const Subject = load("src/components/platform/OperatorEventBadgeCreditFields.tsx", { react: { ...React,
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], (next) => { states[index] = next; }]; },
  } }).default;
  const draw = () => { cursor = 0; return Subject(props); };
  return { draw, field: (name) => elements(draw()).find((node) => node.props?.name === name),
    change(name, value) { this.field(name).props.onChange({ currentTarget: { value } }); } };
}

test("operator fields retain saved credit, require matching stage and month, and clear stage on track change", () => {
  const f = fixture({ current: membership });
  assert.equal(f.field("badgeCreditTrack").props.value, "membership");
  assert.equal(f.field("badgeCreditStage").props.value, "see");
  assert.equal(f.field("badgeCreditStage").props.required, true);
  assert.equal(f.field("badgeCreditMonth").props.defaultValue, "2026-10");
  assert.equal(f.field("badgeCreditMonth").props.required, true);
  f.change("badgeCreditTrack", "circle");
  assert.equal(f.field("badgeCreditStage").props.value, "");
  assert.deepEqual(elements(f.field("badgeCreditStage")).filter((node) => node.type === "option").map((node) => node.props.value), ["", "why", "implementation"]);
  f.change("badgeCreditTrack", "none");
  assert.equal(f.field("badgeCreditStage"), undefined);
  assert.equal(f.field("badgeCreditMonth"), undefined);
  const quick = fixture({ onlineOnly: true });
  assert.equal(elements(quick.field("badgeCreditTrack")).some((node) => node.props?.value === "in_person"), false);
  const circle = fixture({ circleOnly: true });
  assert.deepEqual(elements(circle.field("badgeCreditTrack")).filter((node) => node.type === "option").map((node) => node.props.value), ["none", "circle"]);
});
