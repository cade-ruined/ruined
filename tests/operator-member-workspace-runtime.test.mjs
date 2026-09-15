import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/platform/OperatorMemberWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const views = ["overview", "membership", "journey", "community", "record"];
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const elements = (node) => [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName);

function fixture({ queuedFrames = false } = {}) {
  const slots = []; const effects = []; const scrolls = []; const hashes = []; const frames = []; const scrollOptions = [];
  let cursor = 0; let pending = false;
  const window = { location: { hash: "", pathname: "/ops/members/fixture", search: "?returnTo=%2Fops%2Fmembers" }, history: { state: { router: "retained" }, replaceState(state, _title, url) { assert.deepEqual(state, this.state); hashes.push(url); window.location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : ""; } }, addEventListener() {}, removeEventListener() {} };
  const panels = Object.fromEntries(views.map((id) => [id, { dataset: { memberView: id }, contains: (form) => form.view === id, querySelector: () => null }]));
  class Element {
    constructor(view) { this.view = view; this.isConnected = true; }
    closest(selector) { return selector === "form" ? this : panels[this.view]; }
    scrollIntoView(options) { scrolls.push(this.view); scrollOptions.push(options); }
  }
  class Form extends Element {}
  const targets = Object.fromEntries(views.map((id) => [id, new Element(id)]));
  targets["operator-content"] = new Element("operator-content");
  targets["profile-support"] = new Element("membership");
  targets["new-member-task"] = new Form("record");
  targets["new-member-note"] = new Form("record");
  const root = { contains: (target) => Object.values(targets).includes(target), querySelector(selector) {
    if (selector === '[data-operator-pending="true"]') return pending ? {} : null;
    return panels[selector.match(/data-member-view="([^"]+)"/)?.[1]] ?? null;
  } };
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback: (callback) => callback,
    useEffect(callback) { effects.push(callback); },
  };
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", "window", "document", "requestAnimationFrame", "Element", "HTMLFormElement", compiled)((name) => name === "react" ? hooks : require(name), loadedModule, loadedModule.exports, window, { getElementById: (id) => targets[id] }, (callback) => queuedFrames ? frames.push(callback) : callback(), Element, Form);
  const children = views.map((id) => React.createElement("section", { id, key: id }, React.createElement("input", { name: `${id}-preserved-field`, defaultValue: `saved-${id}` })));
  function draw() { cursor = 0; const result = loadedModule.exports.default({ children }); result.props.ref.current = root; return result; }
  const button = (label) => nodes(draw()).find((node) => node.type === "button" && text(node) === label);
  return { draw, button, window, effects, scrolls, scrollOptions, hashes, targets, nextFrame: () => frames.shift()?.(), setPending: (value) => { pending = value; } };
}

test("a fresh hashless record reveals its header after router focus without scrolling tab changes", () => {
  const f = fixture({ queuedFrames: true }); f.draw(); f.effects[0]();
  assert.deepEqual(f.scrolls, []);
  f.nextFrame(); assert.deepEqual(f.scrolls, [], "wait until the router's initial focus pass finishes");
  f.nextFrame(); assert.deepEqual(f.scrolls, ["operator-content"]);
  assert.deepEqual(f.scrollOptions, [{ block: "start" }], "native scrolling respects the main's sticky-header scroll margin");
  f.button("Membership").props.onClick(); f.nextFrame();
  assert.deepEqual(f.scrolls, ["operator-content"], "view switches preserve the operator's scroll position");
});

test("deferred header reveal never overrides a new deep link or runs after unmount", () => {
  for (const cancel of ["deep-link", "unmount"]) {
    const f = fixture({ queuedFrames: true }); f.draw(); const cleanup = f.effects[0]();
    f.nextFrame();
    if (cancel === "deep-link") f.window.location.hash = "#profile-support";
    else cleanup();
    f.nextFrame(); assert.deepEqual(f.scrolls, [], cancel);
  }
});

test("only one member view is shown while all server-rendered panels remain mounted", () => {
  const f = fixture();
  for (const label of ["Overview", "Membership", "Journey", "Community", "Record"]) {
    f.button(label).props.onClick();
    const tree = parseFragment(renderToStaticMarkup(f.draw()));
    const panels = elements(tree).filter((node) => attr(node, "data-member-view"));
    assert.equal(panels.length, 5);
    assert.deepEqual(panels.filter((node) => attr(node, "hidden") === undefined).map((node) => attr(node, "data-member-view")), [label.toLowerCase()]);
    assert.equal(elements(tree).filter((node) => node.tagName === "input").length, 5, "switching never unmounts or recreates an editor");
    assert.ok(f.hashes.at(-1).startsWith("/ops/members/fixture?returnTo=%2Fops%2Fmembers#"));
  }
});

test("deep links reveal Membership support and Record forms without losing query context", () => {
  for (const [hash, active] of [["#profile-support", "membership"], ["#new-member-task", "record"], ["#new-member-note", "record"], ["#journey", "journey"], ["#community", "community"]]) {
    const f = fixture(); f.window.location.hash = hash; f.draw(); f.effects[0]();
    const panels = nodes(f.draw()).filter((node) => node.props?.["data-member-view"]);
    assert.deepEqual(panels.filter((node) => !node.props.hidden).map((node) => node.props["data-member-view"]), [active]);
    assert.deepEqual(f.scrolls, [active]); assert.ok(f.hashes.at(-1).endsWith(hash));
  }
});

test("pending saves block changing panels, including hash-driven navigation", () => {
  const f = fixture(); f.button("Record").props.onClick(); f.setPending(true);
  f.button("Membership").props.onClick();
  assert.match(text(f.draw()), /Wait for the current save to finish/);
  assert.equal(f.button("Record").props["aria-pressed"], true);
  f.window.location.hash = "#profile-support"; f.effects[0]();
  assert.equal(f.window.location.hash, "#record");
  f.setPending(false); f.button("Membership").props.onClick();
  assert.equal(f.button("Membership").props["aria-pressed"], true);
});

test("unsaved edits require acknowledgement to switch and are kept, never discarded", () => {
  const f = fixture(); f.button("Record").props.onClick();
  f.draw().props.onChangeCapture({ target: f.targets["new-member-note"] });
  f.button("Journey").props.onClick();
  assert.match(text(f.draw()), /Your edits in Record are not saved/);
  assert.equal(f.button("Record").props["aria-pressed"], true);
  f.button("Keep editing").props.onClick();
  assert.equal(f.button("Switch view — keep edits"), undefined);
  f.button("Journey").props.onClick(); f.setPending(true);
  f.button("Switch view — keep edits").props.onClick();
  assert.equal(f.button("Record").props["aria-pressed"], true, "a save beginning during review cannot be bypassed");
  f.setPending(false); f.button("Switch view — keep edits").props.onClick();
  assert.equal(f.button("Journey").props["aria-pressed"], true);
  f.button("Record").props.onClick();
  f.draw().props.onResetCapture({ target: f.targets["new-member-note"] });
  f.button("Membership").props.onClick();
  assert.equal(f.button("Membership").props["aria-pressed"], true, "successful form reset clears its dirty marker");
});
