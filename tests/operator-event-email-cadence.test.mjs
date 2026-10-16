import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const elements = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
function load(path, dependencies = {}) {
  const loaded = { exports: {} };
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function("require", "module", "exports", output)((name) => {
    if (name === "@/lib/platform/badge-credit-model") return load("src/lib/platform/badge-credit-model.ts");
    if (name in dependencies) return dependencies[name];
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "@/components/platform/operatorStyles") return load("src/components/platform/operatorStyles.ts");
    throw new Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const parser = load("src/lib/platform/ops-experience-api.ts");
const draft = { title: "Foundations 01 is merely a title", kind: "member_event", capacity: null, waitlistEnabled: false };
function fixture(props = {}) {
  const states = []; let cursor = 0;
  const Subject = load("src/components/platform/OperatorEventEmailCadenceFields.tsx", { react: { ...React,
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (next) => { states[i] = next; }]; },
  } }).default;
  const draw = () => { cursor = 0; return Subject(props); };
  return { draw, field: (name) => elements(draw()).find(node => node.props?.name === name),
    change(name, value) { this.field(name).props.onChange({ currentTarget: { value } }); } };
}

test("legacy drafts and quick creation omit classification and never infer it from titles", () => {
  const parsed = parser.parseOpsExperienceDraft(draft);
  assert.equal(Object.hasOwn(parsed, "emailCadence"), false);
  const quick = parser.parseOpsExperienceCreateAndPublish({ ...draft, intent: "create_and_publish", meetingUrl: "https://meet.google.com/abc-defg-hij", requestId: "test" });
  assert.equal(Object.hasOwn(quick, "emailCadence"), false);
  assert.equal(quick.kind, "member_event");
});

test("draft parser preserves explicit Foundation, Membership, Circle and opt-out classifications", () => {
  for (const emailCadence of [
    { kind: "foundations_01", track: "members", cohortMonth: "2026-11" },
    { kind: "foundations_04", track: "founder_test" },
    { kind: "membership", track: "members" }, { kind: "circle", track: "members" },
    { kind: "none", track: "members" },
  ]) assert.deepEqual(parser.parseOpsExperienceDraft({ ...draft, emailCadence }).emailCadence, emailCadence);
  for (const emailCadence of [null, [], "membership", {}, { kind: "birthday", track: "members" },
    { kind: "membership", track: "admin" }, { kind: "membership", track: "members", sendNow: true },
    { kind: "foundations_01", track: "members", cohortMonth: "2026-13" },
    { kind: "foundations_01", track: "members", cohortMonth: "2026-1" },
    { kind: ["membership"], track: "members" }, { kind: "membership", track: ["members"] },
  ]) assert.equal(parser.parseOpsExperienceDraft({ ...draft, emailCadence }), null);
});

test("existing classification is shown but unchanged edit defaults preserve it", () => {
  const f = fixture({ current: { kind: "foundations_02", track: "members", cohortMonth: "2026-11" } });
  assert.equal(f.field("emailCadenceKind").props.value, "");
  assert.match(text(f.draw()), /Current: Foundations 02 · Members · 2026-11/);
  assert.match(text(f.draw()), /Keep current classification/);
  assert.equal(f.field("emailCadenceCohortMonth"), undefined);
  f.change("emailCadenceKind", "none");
  assert.equal(f.field("emailCadenceKind").props.value, "none");
  assert.equal(f.field("emailCadenceTrack").props.value, "members");
});

test("Foundation members require an explicit cohort while founder tests use explicit invitations", () => {
  const f = fixture(); f.change("emailCadenceKind", "foundations_01");
  assert.equal(f.field("emailCadenceCohortMonth").props.required, true);
  assert.equal(f.field("emailCadenceCohortMonth").props.type, "month");
  assert.match(text(f.draw()), /America\/Denver/);
  f.change("emailCadenceTrack", "founder_test");
  assert.equal(f.field("emailCadenceCohortMonth"), undefined);
  assert.match(text(f.draw()), /founder tests use explicit invitations/);
});

test("quick events expose only compatible sequence choices and retain Auto as their default", () => {
  const f = fixture({ quick: true });
  assert.equal(f.field("emailCadenceKind").props.value, "");
  assert.deepEqual(elements(f.field("emailCadenceKind")).filter(node => node.type === "option").map(node => node.props.value), ["", "membership", "circle", "none"]);
  assert.match(text(f.draw()), /Names are never used/);
  assert.match(text(f.draw()), /must also be active before reminders can send/);
});
