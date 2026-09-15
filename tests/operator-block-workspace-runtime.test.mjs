import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? node.type?.name === "Notice" ? text(node.type(node.props)) : text(node.props?.children) : String(node);
const Dialog = ({ children }) => children;
const circles = [
  { id: "one", name: "Circle 01", status: "active", blockId: "block-a", blockName: "Block A", blockStatus: "forming" },
  { id: "two", name: "Circle 02", status: "active", blockId: "block-a", blockName: "Block A", blockStatus: "forming" },
  { id: "three", name: "Circle 03", status: "active", blockId: "block-b", blockName: "Block B", blockStatus: "active" },
  { id: "free", name: "Circle 04", status: "forming", blockId: null },
];
const blocks = [
  { id: "block-a", name: "Block A", status: "forming", currentCircles: 2, circles: circles.slice(0, 2) },
  { id: "block-b", name: "Block B", status: "active", currentCircles: 1, circles: [circles[2]] },
];

function fixture({ hash = "", preview = false, props = {}, respond = async () => Response.json({ assignment: { created: true }, block: { ...blocks[0], activated: true } }) } = {}) {
  const values = { circles, initialBlocks: blocks, preview, ...props };
  const state = [];
  const effects = [];
  const listeners = new Map();
  const requests = [];
  let cursor = 0;
  let changed = false;
  let refreshes = 0;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], (next) => { const value = typeof next === "function" ? next(state[i]) : next; changed ||= !Object.is(state[i], value); state[i] = value; }]; },
    useRef(initial) { const i = cursor++; return state[i] ??= { current: initial }; },
    useEffect(work, deps) { const i = cursor++; if (!state[i] || deps.some((value, index) => !Object.is(value, state[i][index]))) { state[i] = deps; effects.push(work); } },
  };
  const browserWindow = {
    location: { pathname: "/ops/blocks", search: "?preserve=1", hash },
    history: { state: { next: true }, replaceState(next, unused, url) { void unused; this.state = next; browserWindow.location.hash = new URL(url, "https://example.test").hash; } },
    addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); },
  };
  const code = ts.transpileModule(readFileSync(new URL("../src/components/platform/OpsActions.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", "window", "fetch", "FormData", code)((dependency) => {
    if (dependency === "react") return hooks;
    if (dependency === "react/jsx-runtime") return require(dependency);
    if (dependency === "next/link") return { __esModule: true, default: "a" };
    if (dependency === "next/navigation") return { useRouter: () => ({ refresh() { refreshes++; } }) };
    if (dependency === "@/components/platform/OperatorDialog") return { __esModule: true, default: Dialog };
    if (dependency === "@/components/platform/operatorStyles") return new Proxy({}, { get: () => "operator-control" });
    throw new Error(`Unexpected Block UI dependency ${dependency}`);
  }, loadedModule, loadedModule.exports, browserWindow, async (url, options) => { const request = { url, method: options.method, body: JSON.parse(options.body) }; requests.push(request); return respond(request); }, class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } });
  const draw = () => { let result; let turns = 0; do { assert.ok(++turns < 10, "effects settle"); cursor = 0; changed = false; result = loadedModule.exports.OpsBlockActions(values); while (effects.length) effects.shift()(); } while (changed); return result; };
  return {
    draw, requests, browserWindow, listeners, refreshes: () => refreshes,
    modal: () => nodes(draw()).find((node) => node.type === Dialog),
    form: () => nodes(draw()).find((node) => node.type === "form"),
    button(label) { const target = nodes(draw()).find((node) => node.type === "button" && text(node) === label); assert.ok(target, label); return target; },
    click(label) { this.button(label).props.onClick(); },
    dirty() { nodes(draw()).find((node) => node.props?.["aria-label"] === "Block administration").props.onChangeCapture(); },
    submit(fields = {}) { return this.form().props.onSubmit({ preventDefault() {}, currentTarget: { values: fields, reset() {} } }); },
  };
}

test("Blocks opens no forms until a creation or management task is requested", () => {
  const f = fixture();
  assert.equal(f.modal(), undefined);
  assert.equal(f.form(), undefined);
  f.browserWindow.location.hash = "#create-block";
  f.listeners.get("hashchange")();
  assert.equal(f.modal().props.title, "New Block");
  assert.equal(f.modal().props.returnFocusId, "new-block-trigger");
  assert.equal(nodes(f.draw()).filter((node) => node.type === "form").length, 1);
  f.modal().props.onClose();
  assert.equal(f.modal(), undefined);
  assert.deepEqual(f.requests, []);
});

test("Manage Block shows its Circles first, pins assignments and keeps other Blocks out of removal choices", async () => {
  const f = fixture({ hash: "#manage-block-block-a" });
  assert.equal(f.modal().props.title, "Block A");
  assert.equal(f.modal().props.returnFocusId, "manage-block-trigger-block-a");
  assert.equal(f.form(), undefined);
  assert.match(text(f.draw()), /Circle 01.*Circle 02/);
  assert.doesNotMatch(text(f.draw()), /Circle 03/);
  f.click("Add a Circle");
  assert.equal(nodes(f.form()).find((node) => node.props?.name === "blockId").props.value, "block-a");
  const choices = nodes(f.form()).find((node) => node.props?.name === "circleId");
  assert.deepEqual(nodes(choices).filter((node) => node.type === "option").map((node) => node.props.value), ["", "free"]);
  await f.submit({ blockId: "block-b", circleId: "free" });
  assert.deepEqual(f.requests, []);
  assert.ok(f.form(), "a failed scope validation stays in the assignment form");
  f.click("← Back to Block"); f.click("Remove a Circle");
  const assigned = nodes(f.form()).find((node) => node.props?.name === "circleId");
  assert.deepEqual(nodes(assigned).filter((node) => node.type === "option").map((node) => node.props.value), ["", "one", "two"]);
  assert.match(text(f.draw()), /fewer than two.*full history stays intact/);
  await f.submit({ circleId: "three" });
  assert.deepEqual(f.requests, []);
});

test("all four Block task previews return before reading form values or making requests", async () => {
  for (const [hash, action] of [["#create-block", null], ["#assign-block-circle", null], ["#manage-block-block-a", "Activate Block"], ["#manage-block-block-a", "Remove a Circle"]]) {
    const f = fixture({ hash, preview: true }); f.draw();
    if (action) f.click(action);
    await f.form().props.onSubmit({ preventDefault() {}, get currentTarget() { throw new Error("Preview must not read the form"); } });
    assert.deepEqual(f.requests, []); assert.equal(f.refreshes(), 0);
    assert.match(text(f.draw()), /Preview only/);
  }
});

test("pending creates cannot be closed or repeated, and success returns to the saved Block", async () => {
  let resolve;
  const f = fixture({ hash: "#create-block", respond: () => new Promise((done) => { resolve = done; }) });
  f.dirty();
  const request = f.submit({ name: "Block C" });
  assert.equal(f.modal().props.pending, true);
  await f.submit({ name: "Block C" }); f.modal().props.onClose();
  assert.ok(f.modal()); assert.equal(f.requests.length, 1);
  resolve(Response.json({ block: { id: "block-c", name: "Block C", status: "forming", currentCircles: 0, circles: [] } }));
  await request;
  assert.equal(f.modal(), undefined);
  assert.equal(f.browserWindow.location.hash, "#block-block-c");
  assert.equal(f.browserWindow.location.search, "?preserve=1");
  assert.match(text(f.draw()), /Block C created/);
});

test("failed assignment edits remain visible and dirty even when the request settles", async () => {
  const f = fixture({ hash: "#manage-block-block-a", respond: async () => Response.json({ error: "Circle was assigned by another operator." }, { status: 409 }) });
  f.click("Add a Circle"); f.dirty();
  await f.submit({ blockId: "block-a", circleId: "free" });
  assert.ok(f.form()); assert.match(text(f.draw()), /Circle was assigned by another operator/);
  assert.equal(nodes(f.draw()).find((node) => node.props?.["aria-label"] === "Block administration").props["data-operator-dirty"], "true");
  assert.equal(f.button("← Back to Block").props.disabled, true);
  f.browserWindow.location.hash = "#create-block"; f.listeners.get("hashchange")();
  assert.equal(f.modal().props.title, "Block A", "hash changes cannot silently replace a dirty form");
});

test("activation still requires two current Circles and no forged Block can be activated", async () => {
  const f = fixture({ hash: "#manage-block-block-a", props: { initialBlocks: [{ ...blocks[0], currentCircles: 1 }] } });
  assert.equal(f.button("Activate Block").props.disabled, true);
  f.click("Activate Block");
  await f.submit({ blockId: "block-a" });
  assert.deepEqual(f.requests, []);
  const valid = fixture({ hash: "#manage-block-block-a" }); valid.click("Activate Block");
  await valid.submit({ blockId: "block-b" }); assert.deepEqual(valid.requests, []);
  await valid.submit({ blockId: "block-a" });
  assert.deepEqual(valid.requests, [{ url: "/api/ops/blocks", method: "PATCH", body: { blockId: "block-a" } }]);
});

test("ending a relationship keeps its original API and displays automatic closure/history outcome", async () => {
  const f = fixture({ hash: "#manage-block-block-a", respond: async () => Response.json({ assignment: { blockId: "block-a", blockStatus: "archived", circleId: "one" } }) });
  f.click("Remove a Circle"); await f.submit({ circleId: "one" });
  assert.deepEqual(f.requests, [{ url: "/api/ops/block-assignments", method: "PATCH", body: { circleId: "one" } }]);
  assert.equal(f.modal(), undefined);
  assert.match(text(f.draw()), /Block closed.*history is preserved/);
});

test("unknown Block links and unavailable choices have recovery explanations, not another preselected Block", () => {
  const unknown = fixture({ hash: "#manage-block-missing" });
  assert.match(text(unknown.draw()), /no longer available/); assert.equal(unknown.form(), undefined);
  const empty = fixture({ hash: "#assign-block-circle", props: { initialBlocks: [], circles: [] } });
  assert.match(text(empty.draw()), /Create a Block before assigning/);
  assert.equal(empty.button("Assign Circle").props.disabled, true);
  assert.deepEqual(empty.requests, []);
});
