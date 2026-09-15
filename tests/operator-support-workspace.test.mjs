import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(path, dependency, globals = {}) {
  const output = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "window", "fetch", output)((name) => name === "react/jsx-runtime" ? require(name) : dependency(name), mod, mod.exports, globals.window, globals.fetch);
  return mod.exports;
}
const noDependency = (name) => { throw Error(`Unexpected dependency: ${name}`); };
const model = compile("src/lib/support/model.ts", noDependency);
const { PREVIEW_SUPPORT_TICKETS } = compile("src/lib/support/preview.ts", noDependency);
const ticket = PREVIEW_SUPPORT_TICKETS[0];
const nodes = (node) => node == null || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
function fixture({ operator = true, writable = true, hash = "", respond = async () => Response.json({ ticket: { ...ticket, status: "resolved", updatedAt: "2026-09-15T12:00:00Z" } }) } = {}) {
  const slots = [], effects = [], listeners = new Set(), calls = [];
  let cursor = 0, changed = false, refreshes = 0;
  const window = { location: { hash, pathname: `/ops/support/${ticket.id}`, search: "" }, history: { state: { kept: true }, replaceState(state, _title, url) { assert.deepEqual(state, { kept: true }); window.location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : ""; } }, addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
  const hooks = { ...React,
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (next) => { const value = typeof next === "function" ? next(slots[i]) : next; changed ||= value !== slots[i]; slots[i] = value; }]; },
    useEffect(effect, dependencies) { const i = cursor++; if (!slots[i] || dependencies.some((value, index) => value !== slots[i].dependencies[index])) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { dependencies, cleanup: effect() }; }); },
  };
  const dependencies = {
    react: hooks, "next/link": { __esModule: true, default: "a" }, "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
    "@/components/platform/OperatorPageFrame": { __esModule: true, default: "main" },
    "@/components/platform/OperatorDialog": { __esModule: true, default: "operator-dialog" },
    "@/components/support/SupportDeliveryStatus": { __esModule: true, default: "delivery-status" },
    "@/components/support/SupportShared": { SupportPreviewNotice: "preview-notice", SupportStatusBadge: "status-badge", supportDate: (value) => value },
    "@/components/support/supportStyles": new Proxy({}, { get: () => "control" }),
    "@/lib/support/model": model,
  };
  const Component = compile("src/components/support/SupportThread.tsx", (name) => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, { window, fetch: async (url, init) => { calls.push({ url, ...init }); return respond(calls.at(-1)); } }).default;
  function draw() { for (let i = 0; i < 10; i++) { cursor = 0; changed = false; const tree = Component({ initialTicket: ticket, operator, writable }); effects.splice(0).forEach((fn) => fn()); if (!changed) return tree; } throw Error("Unstable render"); }
  const find = (predicate) => nodes(draw()).find(predicate);
  return { draw, calls, window, refreshes: () => refreshes, find,
    dialog: () => find((node) => node.type === "operator-dialog"),
    button(label) { const button = find((node) => node.type === "button" && text(node) === label); assert.ok(button, label); return button; },
    changeStatus(value) { find((node) => node.type === "select").props.onChange({ target: { value } }); },
    save() { return find((node) => node.type === "form" && node.props.id === "support-request-status").props.onSubmit({ preventDefault() {} }); },
  };
}

test("operator support is conversation-first with one focused status editor and unchanged member view", () => {
  const f = fixture();
  assert.equal(f.dialog(), undefined);
  assert.equal(f.find((node) => node.type === "aside"), undefined);
  assert.ok(f.find((node) => node.props?.["aria-label"] === "Conversation"));
  assert.ok(f.find((node) => node.props?.id === "support-reply"));
  assert.match(f.find((node) => node.type === "h2" && text(node) === ticket.subject).props.className, /operator-record-title/);
  f.button("Update status").props.onClick();
  assert.equal(f.dialog().props.returnFocusId, "support-status-trigger");
  assert.equal(f.dialog().props.title, "Update request status");
  assert.equal(f.calls.length, 0);
  const member = fixture({ operator: false, hash: "#support-request-status" });
  assert.equal(member.dialog(), undefined);
  assert.equal(member.find((node) => node.type === "select"), undefined);
  assert.match(member.find((node) => node.type === "h1").props.className, /uppercase/);
});

test("status cancellation resets only status while preserving a typed reply and focus target", () => {
  const f = fixture();
  f.find((node) => node.type === "textarea").props.onChange({ target: { value: "A reply I am still writing" } });
  f.button("Update status").props.onClick();
  f.changeStatus("resolved");
  assert.equal(f.find((node) => node.props?.id === "support-request-status").props["data-operator-dirty"], true);
  f.dialog().props.onClose();
  assert.equal(f.dialog(), undefined);
  assert.equal(f.find((node) => node.type === "textarea").props.value, "A reply I am still writing");
  f.button("Update status").props.onClick();
  assert.equal(f.find((node) => node.type === "select").props.value, ticket.status);
  assert.equal(f.find((node) => node.props?.id === "support-request-status").props["data-operator-dirty"], false);
  assert.equal(f.calls.length, 0);
});

test("status deep links preserve expected-version checks and cannot close a pending save", async () => {
  let settle;
  const response = new Promise((resolve) => { settle = resolve; });
  const f = fixture({ hash: "#support-request-status", respond: () => response });
  assert.ok(f.dialog());
  f.changeStatus("resolved");
  const save = f.save();
  assert.equal(f.dialog().props.pending, true);
  f.dialog().props.onClose();
  assert.ok(f.dialog());
  assert.equal(f.calls[0].url, `/api/ops/support/${ticket.id}`);
  assert.equal(f.calls[0].method, "PATCH");
  assert.deepEqual(JSON.parse(f.calls[0].body), { status: "resolved", expectedUpdatedAt: ticket.updatedAt });
  settle(Response.json({ ticket: { ...ticket, status: "resolved" } }));
  await save;
  assert.equal(f.dialog(), undefined);
  assert.equal(f.window.location.hash, "");
  assert.match(text(f.draw()), /Status saved/);
});

test("status conflicts remain inside the dialog with reload guidance and preview writes stay blocked", async () => {
  const f = fixture({ respond: async () => Response.json({ error: "The request changed." }, { status: 409 }) });
  f.button("Update status").props.onClick(); f.changeStatus("resolved"); await f.save();
  assert.match(text(f.dialog()), /The request changed/);
  assert.equal(f.button("Save status").props.disabled, true);
  f.button("Reload request").props.onClick();
  assert.equal(f.refreshes(), 1);
  const preview = fixture({ writable: false });
  preview.button("Update status").props.onClick(); preview.changeStatus("resolved"); await preview.save();
  assert.equal(preview.calls.length, 0);
  assert.equal(preview.button("Save status").props.disabled, true);
});
