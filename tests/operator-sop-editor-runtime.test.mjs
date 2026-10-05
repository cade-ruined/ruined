import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const Frame = ({ children }) => React.createElement("main", null, children);
const Dialog = ({ children, title, open }) => open ? React.createElement("dialog", { open, "aria-label": title }, children) : null;
function load(path, dependencies = {}, fetch = () => { throw new Error("Unexpected real request"); }) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "fetch", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "@/components/platform/OperatorPageFrame") return { __esModule: true, default: Frame };
    if (name === "@/components/platform/OperatorDialog") return { __esModule: true, default: Dialog };
    if (name === "@/components/platform/StateLabel") return { __esModule: true, default: ({ state }) => React.createElement("span", null, state) };
    if (name === "@/components/platform/OperatorSopBody") return body;
    if (name === "@/components/platform/operatorStyles") return load("src/components/platform/operatorStyles.ts");
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }, mod, mod.exports, fetch);
  return mod.exports;
}
const body = load("src/components/platform/OperatorSopBody.tsx");
const procedure = {
  id: "sop-1", title: "Member arrival", summary: "Welcome a new member", category: "Member support", bodyText: "# Before you begin\nCheck the member record.\n\n1. Review the welcome note.\n2. Confirm the next step.",
  externalUrl: null, status: "published", revision: 3, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z", publishedAt: "2026-10-05T00:00:00Z", updatedBy: null,
};
function interactive({ editor = { canManage: true, procedure, history: [procedure] }, preview = false, response } = {}) {
  const slots = [], calls = [], routes = [];
  let cursor = 0;
  const hooks = { ...React, useEffect() {}, useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  }, useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; } };
  const Editor = load("src/components/platform/OperatorSopEditor.tsx", { react: hooks, "next/navigation": { useRouter: () => ({ replace: (url) => routes.push(url), refresh() {} }) } }, async (url, options) => {
    calls.push({ url, options });
    return response ?? { ok: true, status: 200, json: async () => ({ procedure: { ...procedure, ...JSON.parse(options.body), revision: procedure.revision + 1 } }) };
  }).default;
  return { calls, routes, savedProcedure: () => slots[0], draw() { cursor = 0; return Editor({ editor, preview }); } };
}
const node = (f, predicate) => nodes(f.draw()).find(predicate);
const edit = (f) => node(f, (item) => item.props?.id === "edit-sop").props.onClick();
const change = (f, name, value) => node(f, (item) => item.props?.name === name).props.onChange({ target: { value } });
const submit = (f, status) => node(f, (item) => item.type === "form").props.onSubmit({ preventDefault() {}, nativeEvent: { submitter: { value: status } } });

test("SOP prose escapes HTML, preserves ordered steps, and rejects unsafe document URLs", () => {
  const markup = renderToStaticMarkup(React.createElement(body.default, { body: "# Start\n<img src=x onerror=alert(1)>\n\n3. Check record\n4. Send welcome\n\n- First\n- Second" }));
  assert.match(markup, /<h3[^>]*>Start<\/h3>/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /<ol[^>]*start="3"/);
  assert.match(markup, /<ul/);
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "http://example.com", "https://user:pass@example.com", "/relative"]) assert.equal(body.safeSopDocumentUrl(url), null);
  assert.equal(body.safeSopDocumentUrl(" https://example.com/sop "), "https://example.com/sop");
});

test("ordinary operators get readable content without edit controls or private history", () => {
  const f = interactive({ editor: { canManage: false, procedure: { ...procedure, externalUrl: "javascript:alert(1)" }, history: [procedure] } });
  const markup = renderToStaticMarkup(f.draw());
  assert.match(markup, /Member arrival/);
  assert.match(markup, /Confirm the next step/);
  assert.doesNotMatch(markup, /Edit SOP|Archive SOP|Revision history|javascript:/);
  assert.deepEqual(f.calls, []);
});

test("administrators can read each revision's saved content and safe document link", () => {
  const historical = { ...procedure, revision: 2, title: "Earlier title", category: "Earlier category", summary: "Earlier summary", bodyText: "# Earlier procedure\nFollow the original step.\n<script>alert(1)</script>", externalUrl: "https://example.com/previous-procedure" };
  const unsafe = { ...historical, revision: 1, externalUrl: "javascript:alert(1)" };
  const f = interactive({ editor: { canManage: true, procedure, history: [procedure, historical, unsafe] } });
  node(f, (item) => item.props?.id === "read-sop-revision-2").props.onClick();
  let dialog = node(f, (item) => item.type === Dialog && item.props.title === "Revision 2");
  assert.equal(dialog.props.returnFocusId, "read-sop-revision-2");
  const markup = renderToStaticMarkup(dialog);
  for (const text of ["Earlier title", "Earlier category", "Earlier summary", "Earlier procedure", "Follow the original step."]) assert.ok(markup.includes(text));
  assert.match(markup, /href="https:\/\/example.com\/previous-procedure"/);
  assert.doesNotMatch(markup, /<script/);
  dialog.props.onClose();
  node(f, (item) => item.props?.id === "read-sop-revision-1").props.onClick();
  dialog = node(f, (item) => item.type === Dialog && item.props.title === "Revision 1");
  assert.doesNotMatch(renderToStaticMarkup(dialog), /javascript:|Open saved document/);
  assert.deepEqual(f.calls, []);
});

test("preview keeps the original publication date through republishing", async () => {
  const f = interactive({ preview: true });
  edit(f); change(f, "bodyText", "The revised procedure.");
  await submit(f, "published");
  assert.equal(f.savedProcedure().publishedAt, procedure.publishedAt);
  assert.equal(f.savedProcedure().revision, procedure.revision + 1);
  assert.deepEqual(f.calls, []);
});

test("published edits explicitly publish and send the current revision", async () => {
  const f = interactive(); edit(f);
  const markup = renderToStaticMarkup(f.draw());
  assert.match(markup, /Save &amp; publish/);
  assert.doesNotMatch(markup, />Save draft</);
  change(f, "bodyText", "Updated procedure");
  assert.equal(node(f, (item) => item.type === "form").props["data-operator-dirty"], true);
  await submit(f, "published");
  assert.equal(f.calls[0].url, "/api/ops/sops/sop-1");
  const payload = JSON.parse(f.calls[0].options.body);
  assert.equal(payload.expectedRevision, 3);
  assert.equal(payload.status, "published");
  assert.equal(payload.bodyText, "Updated procedure");
  assert.equal(node(f, (item) => item.type === "form"), undefined);
  assert.match(renderToStaticMarkup(f.draw()), /SOP published/);
});

test("a revision conflict retains every edit in the guarded form", async () => {
  const f = interactive({ response: { ok: false, status: 409, json: async () => ({ error: "Conflict" }) } });
  edit(f); change(f, "title", "My unsaved version"); change(f, "bodyText", "Keep these steps");
  await submit(f, "published");
  assert.equal(node(f, (item) => item.props?.name === "title").props.value, "My unsaved version");
  assert.equal(node(f, (item) => item.props?.name === "bodyText").props.value, "Keep these steps");
  assert.equal(node(f, (item) => item.type === "form").props["data-operator-dirty"], true);
  assert.match(renderToStaticMarkup(f.draw()), /Your edits are still here/);
});

test("preview creation remains editable after saving and never makes requests", async () => {
  const f = interactive({ editor: null, preview: true });
  change(f, "title", "Test procedure");
  await submit(f, "published");
  assert.match(renderToStaticMarkup(f.draw()), /Add the procedure or a document link before publishing/);
  await submit(f, "draft");
  assert.match(renderToStaticMarkup(f.draw()), /Draft saved/);
  edit(f); change(f, "bodyText", "1. Complete the first step.");
  await submit(f, "published");
  assert.match(renderToStaticMarkup(f.draw()), /SOP published/);
  assert.match(renderToStaticMarkup(f.draw()), /reloading resets these changes/);
  edit(f);
  assert.equal(node(f, (item) => item.props?.name === "bodyText").props.value, "1. Complete the first step.");
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.routes, []);
});

test("archive needs a confirmation and archived procedures can return as drafts", async () => {
  const f = interactive({ preview: true });
  node(f, (item) => item.props?.id === "archive-sop").props.onClick();
  assert.equal(f.calls.length, 0);
  const confirm = nodes(f.draw()).find((item) => item.type === Dialog && item.props.title === "Archive SOP");
  assert.ok(confirm);
  await nodes(confirm).find((item) => item.type === "button" && item.props.children === "Archive SOP").props.onClick();
  assert.match(renderToStaticMarkup(f.draw()), /SOP archived/);
  edit(f);
  assert.match(renderToStaticMarkup(f.draw()), /Restore as draft/);
  await submit(f, "draft");
  assert.match(renderToStaticMarkup(f.draw()), /Draft saved/);
  assert.deepEqual(f.calls, []);
});
