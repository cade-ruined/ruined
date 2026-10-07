import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const blank = () => null;
const Note = () => React.createElement("div", { "data-note-control": true });
function load(path, dependencies = {}, fetch = () => { throw new Error("Unexpected network request"); }) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "fetch", "FormData", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "@/components/platform/OperatorPageFrame" || name === "@/components/platform/OperatorMemberWorkspace") return { __esModule: true, default: ({ children }) => React.createElement("div", null, children) };
    if (name === "@/components/platform/OperatorMemberActions") return { OperatorNoteAction: Note, OperatorTaskCreateAction: blank, OperatorOverrideAction: blank };
    if (name === "@/components/platform/operatorStyles") return load("src/components/platform/operatorStyles.ts");
    if (name.startsWith("@/components/platform/")) return { __esModule: true, default: blank };
    if (name.startsWith("@/lib/platform/")) return load(`${name.replace("@/", "src/")}.ts`);
    throw new Error(`Unexpected dependency ${name}`);
  }, mod, mod.exports, fetch, class FormData { constructor(form) { this.fields = form.fields; } get(key) { return this.fields[key] ?? null; } });
  return mod.exports;
}
const Record = load("src/components/platform/OperatorMemberRecord.tsx", { "@/lib/membership/operator-registration-progress": load("src/lib/membership/operator-registration-progress.ts") }).default;
const sample = load("src/lib/platform/ops-preview.ts").getPreviewOpsMemberRecord("preview-01");
const note = { noteId: "note-one", category: "support", createdAt: "2026-10-05T16:08:00Z", createdBy: "Casey Operator", visibility: "ops_only", body: "Private support context <script>alert(1)</script>" };
const record = { ...sample, operational: { ...sample.operational, notes: [note] } };

test("notes have a dedicated section with author, exact timestamp, category, and a prominent backward-compatible action", () => {
  const tree = Record({ record });
  const list = nodes(tree);
  const section = list.find((item) => item.props?.id === "operator-notes");
  assert.ok(section);
  assert.equal(nodes(section).some((item) => item.props?.id === "new-member-note"), true);
  assert.equal(nodes(list.find((item) => item.props?.id === "record")).some((item) => item.type === Note), false);
  const actionNav = list.find((item) => item.props?.["aria-label"] === "Member actions");
  const firstAction = nodes(actionNav).find((item) => item.type === "a");
  assert.equal(firstAction.props.href, "#new-member-note");
  assert.equal(firstAction.props.children, "Add note");
  const markup = renderToStaticMarkup(section);
  assert.match(markup, /Never shown on the member profile/);
  assert.match(markup, /By Casey Operator/);
  assert.match(markup, /dateTime="2026-10-05T16:08:00Z"/);
  assert.match(markup, /4:08 PM UTC/);
  assert.match(markup, /support/);
  assert.doesNotMatch(markup, /<script/);
});

test("private note content and controls never render for non-administrators, even in an overfilled record", () => {
  for (const role of ["guide", "circle_leader"]) {
    const tree = Record({ record: { ...record, access: { ...record.access, roles: [role] } } });
    assert.equal(nodes(tree).some((item) => item.props?.id === "operator-notes" || item.props?.id === "new-member-note" || item.type === Note), false);
    assert.doesNotMatch(renderToStaticMarkup(tree), /Private support context|Casey Operator|data-note-control|Add note/);
    assert.ok(nodes(tree).some((item) => item.props?.id === "record"));
  }
  const readOnly = Record({ record: { ...record, access: { ...record.access, capabilities: [] } } });
  assert.ok(nodes(readOnly).some((item) => item.props?.id === "operator-notes"));
  assert.equal(nodes(readOnly).some((item) => item.type === Note), false);
});

function actionFixture({ preview = false, respond } = {}) {
  const slots = [], requests = [];
  let cursor = 0, refreshes = 0;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value) => { slots[index] = value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
  };
  const Action = load("src/components/platform/OperatorMemberActions.tsx", { react: hooks, "next/navigation": { useRouter: () => ({ refresh() { refreshes += 1; } }) } }, async (url, options) => {
    requests.push({ url, ...options });
    return respond ? respond() : { ok: true, json: async () => ({}) };
  }).OperatorNoteAction;
  return { requests, refreshes: () => refreshes, draw() { cursor = 0; return Action({ memberId: "member-one", preview }); } };
}

test("preview note forms explicitly disclose that notes are not saved and never make requests", async () => {
  const f = actionFixture({ preview: true });
  const markup = renderToStaticMarkup(f.draw());
  assert.match(markup, /Preview — notes are not saved/);
  assert.match(markup, /Never shown on the member profile/);
  assert.equal(nodes(f.draw()).find((item) => item.type === "button").props.disabled, true);
  await f.draw().props.onSubmit({ preventDefault() {}, get currentTarget() { throw new Error("Preview must not read submitted data"); } });
  assert.deepEqual(f.requests, []);
});

test("notes use the existing durable endpoint, block duplicate saves, and clear dirty state only after success", async () => {
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const f = actionFixture({ respond: () => response });
  let resets = 0;
  const event = { preventDefault() {}, currentTarget: { fields: { body: "Useful private context", category: "support" }, reset() { resets += 1; } } };
  f.draw().props.onChange();
  assert.equal(f.draw().props["data-operator-dirty"], "true");
  const saving = f.draw().props.onSubmit(event);
  assert.equal(f.draw().props["data-operator-pending"], "true");
  assert.equal(nodes(f.draw()).find((item) => item.type === "fieldset").props.disabled, true);
  await f.draw().props.onSubmit(event);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "/api/ops/members/member-one/notes");
  assert.deepEqual(JSON.parse(f.requests[0].body), { body: "Useful private context", category: "support" });
  resolve({ ok: true, json: async () => ({}) });
  await saving;
  assert.equal(resets, 1);
  assert.equal(f.draw().props["data-operator-dirty"], "false");
  assert.equal(f.draw().props["data-operator-pending"], "false");
  assert.equal(f.refreshes(), 1);
  assert.match(renderToStaticMarkup(f.draw()), /operator note was saved/);
});

test("failed note saves keep the draft dirty and available to retry", async () => {
  const f = actionFixture({ respond: () => ({ ok: false, json: async () => ({ error: "Save unavailable" }) }) });
  let resets = 0;
  f.draw().props.onChange();
  await f.draw().props.onSubmit({ preventDefault() {}, currentTarget: { fields: { body: "Keep this note", category: "general" }, reset() { resets += 1; } } });
  assert.equal(resets, 0);
  assert.equal(f.draw().props["data-operator-dirty"], "true");
  assert.equal(f.draw().props["data-operator-pending"], "false");
  assert.match(renderToStaticMarkup(f.draw()), /Save unavailable/);
});
