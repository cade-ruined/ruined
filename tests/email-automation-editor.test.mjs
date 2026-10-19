import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}
const model = compile("src/lib/communications/member-email-cadence-model.ts");
const copy = compile("src/lib/communications/member-email-cadence-copy.ts", { "./member-email-cadence-model": model });
const styles = compile("src/components/platform/operatorStyles.ts");
const event = { id: "call-1", title: "Foundations 01 — November", startsAt: "2026-11-05T22:00:00Z", endsAt: "2026-11-05T23:30:00Z", timeZone: "America/Denver" };
const template = { id: "design-1", version: "v1", name: "Personal note", status: "published", variables: [{ key: "MEMBER_NAME", type: "string", fallbackValue: "Friend" }], fields: [{ key: "heading", label: "Heading", value: "Heading" }, { key: "body", label: "Message", value: "Message" }, { key: "signature", label: "Signature", value: "RU/NED" }] };
const draft = { scope: "sequence", eventId: event.id, kind: "foundations_01", track: "members", templateId: template.id, templateVersion: template.version, bodyTarget: "copy:body", headingTarget: "copy:heading", bindings: { MEMBER_NAME: { source: "member_name" } }, copy: { signature: "RU/NED" } };
const nodes = node => node == null || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);

function fixture(overrides = {}) {
  const slots = [];
  let cursor = 0, reviews = 0;
  const hooks = { ...React, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; } };
  const dependencies = { react: hooks, "next/link": { __esModule: true, default: "a" }, "@/components/platform/operatorStyles": styles, "@/lib/communications/member-email-cadence-model": model, "@/lib/communications/member-email-cadence-copy": copy };
  const exports = compile("src/components/platform/OperatorEmailAutomationEditor.tsx", dependencies);
  const props = { draft: structuredClone(draft), template, overview: { events: [event], templates: [template], setupRequired: false }, editing: true, pending: null, onSelectTemplate() {}, onReview(event) { event.preventDefault(); reviews++; }, onDraft(patch) { props.draft = { ...props.draft, ...patch }; }, ...overrides };
  const render = () => { cursor = 0; return exports.default(props); };
  const find = predicate => nodes(render()).find(predicate);
  const field = id => { const node = find(node => node.props?.id === id); assert.ok(node, `Missing field ${id}`); return node; };
  return { props, render, find, field, exports, reviews: () => reviews, change(id, value) { field(id).props.onChange({ currentTarget: { value } }); } };
}

test("saved email editor exposes every stage and keeps design machinery collapsed", () => {
  const f = fixture();
  const stageButtons = nodes(f.find(node => node.props?.["aria-label"] === "Email reminder stages")).filter(node => node.type === "button");
  assert.equal(stageButtons.length, 4);
  assert.match(text(stageButtons[2]), /24 hours before/);
  assert.equal(stageButtons[2].props["aria-pressed"], true);
  assert.equal(f.find(node => node.type === "details").props.open, false);
  assert.ok(f.field("cadence-message-subject").props.value.startsWith("Tomorrow:"));
  assert.match(f.field("cadence-message-body").props.value, /We’re about to begin/);
  assert.doesNotMatch(f.field("cadence-message-body").props.value, /https:|All the love|November 5/);
  assert.match(text(f.render()), /greeting, call details, access link, reminder preferences, and sign-off are added automatically/);
});

test("stage-specific edits and reset preserve other messages and saved design connections", () => {
  const f = fixture({ draft: { ...structuredClone(draft), messages: { orientation: { subject: "Getting ready" } } } });
  const bindings = f.props.draft.bindings, templateCopy = f.props.draft.copy;
  f.change("cadence-message-subject", "See you tomorrow");
  f.change("cadence-message-body", "Bring a notebook.");
  assert.deepEqual(f.props.draft.messages, { orientation: { subject: "Getting ready" }, day_before: { subject: "See you tomorrow", message: "Bring a notebook." } });
  assert.equal(f.props.draft.bindings, bindings);
  assert.equal(f.props.draft.copy, templateCopy);
  f.find(node => node.type === "button" && text(node).startsWith("Foundations orientation")).props.onClick();
  assert.equal(f.field("cadence-message-subject").props.value, "Getting ready");
  f.find(node => node.type === "button" && text(node) === "Restore default message").props.onClick();
  assert.deepEqual(f.props.draft.messages, { day_before: { subject: "See you tomorrow", message: "Bring a notebook." } });
  assert.equal(f.reviews(), 0);
});

test("draft preview includes custom prose with automatic recipient and call details", () => {
  const f = fixture();
  f.change("cadence-message-subject", "Your next conversation");
  f.change("cadence-message-body", "Bring a notebook and a question.");
  const preview = f.find(node => node.props?.["aria-label"] === "Draft email content");
  assert.match(text(preview), /Your next conversation/);
  assert.match(text(preview), /Alex,\n\nBring a notebook and a question\./);
  assert.match(text(preview), /November 5, 2026/);
  assert.match(text(preview), /\/my\/experiences#experience-call-1/);
  assert.match(text(preview), /Manage your email reminders/);
  assert.match(text(preview), /All the love,\nRU\/NED/);
  assert.equal(f.reviews(), 0);
});

test("restoring the exact default keeps sequence copy dynamic for future calls", () => {
  const f = fixture();
  const originalSubject = f.field("cadence-message-subject").props.value;
  f.change("cadence-message-subject", "A different subject");
  f.change("cadence-message-subject", originalSubject);
  assert.equal(f.props.draft.messages, undefined);
  f.props.overview = { ...f.props.overview, events: [{ ...event, title: "Foundations 01 — December" }] };
  assert.match(f.field("cadence-message-subject").props.value, /December/);
});

test("preview is the only submit action and requires a complete message and design mapping", () => {
  const f = fixture();
  const submitButton = () => f.find(node => node.type === "button" && node.props.type === "submit");
  assert.equal(text(submitButton()), "Preview and review");
  assert.equal(submitButton().props.disabled, false);
  assert.equal(f.find(node => node.type === "button" && /Activate|Send email/.test(text(node))), undefined);
  f.render().props.onSubmit({ preventDefault() {} });
  assert.equal(f.reviews(), 1);
  f.change("cadence-message-body", " ");
  assert.equal(submitButton().props.disabled, true);
  f.change("cadence-message-body", "A complete message.");
  f.props.draft.bodyTarget = "";
  assert.equal(submitButton().props.disabled, true);
  f.find(node => node.type === "button" && text(node) === "Advanced settings").props.onClick();
  assert.equal(f.find(node => node.type === "details").props.open, true);
});

test("each call type exposes only its actual reminder stages and timing", () => {
  const f = fixture({ draft: { ...draft, kind: "circle" } });
  const stageButtons = nodes(f.find(node => node.props?.["aria-label"] === "Email reminder stages")).filter(node => node.type === "button");
  assert.equal(stageButtons.length, 2);
  assert.match(text(stageButtons), /24 hours before/);
  assert.match(text(stageButtons), /2½ hours before/);
  assert.doesNotMatch(text(stageButtons), /8 a.m.|Orientation|One week/);
});

test("design suggestions use only unambiguous fields and correctly typed dynamic variables", () => {
  const { suggestedCadenceDesignConnections } = fixture().exports;
  const suggested = suggestedCadenceDesignConnections(template);
  assert.equal(suggested.bodyTarget, "copy:body");
  assert.equal(suggested.headingTarget, "copy:heading");
  assert.deepEqual(suggested.bindings.MEMBER_NAME, { source: "member_name" });
  const ambiguous = suggestedCadenceDesignConnections({ ...template, variables: [...template.variables, { key: "BODY", type: "string", fallbackValue: "" }, { key: "CALL_TIME", type: "number", fallbackValue: 42 }] });
  assert.equal(ambiguous.bodyTarget, "");
  assert.deepEqual(ambiguous.bindings.CALL_TIME, { source: "literal", value: "42" });
});
