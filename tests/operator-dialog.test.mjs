import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/platform/OperatorDialog.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);

function fixture(overrides = {}) {
  let props = { open: true, title: "Circle 01", children: React.createElement("input", { name: "draft" }), ...overrides };
  let cursor = 0, closed = 0;
  const slots = [];
  const pendingEffects = [];
  const cleanups = new Map();
  const frames = [];
  const focusCalls = [];
  const ids = new Map();
  const document = { activeElement: null, body: { style: { overflow: "scroll" } }, getElementById: (id) => ids.get(id) ?? null };
  class Element {
    constructor(name) { this.name = name; this.isConnected = true; }
    focus(options) { document.activeElement = this; focusCalls.push({ name: this.name, options }); }
    closest() { return this.link ?? null; }
  }
  class FormElement extends Element {}
  const previousFocus = new Element("original-trigger");
  document.activeElement = previousFocus;
  const dialog = new Element("dialog");
  dialog.opens = 0;
  dialog.closes = 0;
  dialog.dirty = false;
  dialog.saving = false;
  dialog.showModal = () => { dialog.opens++; };
  dialog.close = () => { dialog.closes++; };
  dialog.querySelector = (selector) => selector.includes("pending") ? dialog.saving ? {} : null : dialog.dirty ? {} : null;
  const buttons = new Map();
  const mockedReact = { ...React,
    useId() { return `dialog-title-${cursor++}`; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!(index in slots) || dependencies.some((dependency, i) => !Object.is(slots[index][i], dependency))) {
        slots[index] = dependencies;
        pendingEffects.push({ index, effect });
      }
    },
  };
  const cjsModule = { exports: {} };
  const window = { location: new URL("https://members.example.test/ops/circles?circleId=one") };
  new Function("require", "module", "exports", "document", "HTMLElement", "Element", "HTMLFormElement", "window", "requestAnimationFrame", compiled)((name) => {
    if (name === "react") return mockedReact;
    if (name === "react/jsx-runtime") return require(name);
    throw Error(`Unexpected dialog dependency: ${name}`);
  }, cjsModule, cjsModule.exports, document, Element, Element, FormElement, window, (callback) => { frames.push(callback); });
  function draw() {
    cursor = 0;
    const tree = cjsModule.exports.default({ ...props, onClose() { closed++; } });
    for (const node of nodes(tree)) {
      if (!node.props?.ref) continue;
      if (node.type === "dialog") node.props.ref.current = dialog;
      else {
        const name = node.props["aria-label"] ?? text(node);
        if (!buttons.has(name)) buttons.set(name, new Element(name));
        node.props.ref.current = buttons.get(name);
      }
    }
    for (const { index, effect } of pendingEffects.splice(0)) {
      cleanups.get(index)?.();
      cleanups.set(index, effect());
    }
    return tree;
  }
  const button = (label) => {
    const found = nodes(draw()).find((node) => node.type === "button" && (text(node) === label || node.props["aria-label"] === label));
    assert.ok(found, `Dialog button ${label}`);
    return found;
  };
  function domEvent(target, patch = {}) {
    return { target, button: 0, nativeEvent: {}, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...patch };
  }
  function link(href = "https://members.example.test/ops/members/one", patch = {}) {
    const element = new Element("navigation-link");
    Object.assign(element, { href, target: "", download: false, navigations: 0, hasAttribute: (name) => name === "download" && element.download,
      click() { const event = domEvent(element); draw().props.onClickCapture(event); if (!event.prevented) { element.onClick?.(event); if (!event.prevented) element.navigations++; } }, ...patch });
    element.link = element;
    return element;
  }
  function form(patch = {}) {
    const element = new FormElement("member-search");
    Object.assign(element, { method: "get", explicitAction: true, submissions: [], hasAttribute: (name) => name === "action" && element.explicitAction,
      requestSubmit(submitter) { const event = domEvent(element, { nativeEvent: { submitter } }); draw().props.onSubmitCapture(event); if (!event.prevented) element.submissions.push(submitter); }, ...patch });
    return element;
  }
  return { draw, button, dialog, document, previousFocus, focusCalls, ids, Element, link, form, domEvent,
    closed: () => closed,
    update(next) { props = { ...props, ...next }; return draw(); },
    unmount() { cleanups.forEach((cleanup) => cleanup?.()); cleanups.clear(); },
    flushFrames() { frames.splice(0).forEach((frame) => frame()); },
    escape() { let prevented = false; draw().props.onCancel({ preventDefault() { prevented = true; } }); assert.equal(prevented, true, "Native Escape must not bypass the close guard"); },
    backdrop() { draw().props.onClick({ target: dialog, currentTarget: dialog }); },
  };
}

test("operator workspace uses a labelled native modal and scrolls content independently", () => {
  const f = fixture();
  const tree = f.draw();
  assert.equal(tree.type, "dialog");
  assert.equal(f.dialog.opens, 1, "showModal makes the background inert and constrains keyboard focus natively");
  assert.equal(f.document.body.style.overflow, "hidden");
  const heading = nodes(tree).find((node) => node.type === "h2");
  assert.equal(tree.props["aria-labelledby"], heading.props.id);
  assert.equal(text(heading), "Circle 01");
  assert.equal(f.document.activeElement.name, "Close Circle 01 management");
  assert.equal(f.button("Close Circle 01 management").props.type, "button");
  assert.ok(nodes(tree).some((node) => node.props?.className?.includes("overflow-y-auto") && node.props.className.includes("min-h-0")));
  f.draw();
  assert.equal(f.dialog.opens, 1, "ordinary child renders must not reopen or reset the modal");
  f.unmount();
  f.flushFrames();
  assert.equal(f.dialog.closes, 1);
  assert.equal(f.document.body.style.overflow, "scroll", "restore the prior value, not a hard-coded empty string");
  assert.equal(f.document.activeElement, f.previousFocus);
  assert.deepEqual(f.focusCalls.at(-1).options, { preventScroll: true });
});

test("a dialog that is not open does not steal focus or lock page scrolling", () => {
  const f = fixture({ open: false });
  f.draw();
  assert.equal(f.dialog.opens, 0);
  assert.equal(f.document.activeElement, f.previousFocus);
  assert.equal(f.document.body.style.overflow, "scroll");
  f.unmount();
  assert.equal(f.dialog.closes, 0);
});

test("Close, Escape, and backdrop all close a clean idle dialog; content clicks do not", () => {
  for (const action of ["button", "escape", "backdrop"]) {
    const f = fixture();
    const tree = f.draw();
    tree.props.onClick({ target: {}, currentTarget: f.dialog });
    assert.equal(f.closed(), 0);
    if (action === "button") f.button("Close Circle 01 management").props.onClick();
    else f[action]();
    assert.equal(f.closed(), 1);
  }
});

test("parent pending state and nested pending markers block every close path", () => {
  for (const pendingSource of ["parent", "nested"]) {
    for (const action of ["button", "escape", "backdrop"]) {
      const f = fixture({ pending: pendingSource === "parent" });
      f.dialog.saving = pendingSource === "nested";
      if (action === "button") f.button("Close Circle 01 management").props.onClick();
      else f[action]();
      assert.equal(f.closed(), 0);
      assert.ok(nodes(f.draw()).some((node) => node.props?.role === "status" && /current save/.test(text(node))));
      assert.equal(nodes(f.draw()).some((node) => node.props?.role === "alertdialog"), false);
    }
  }
});

test("dirty child state requires explicit discard and keeps the underlying editor inert", () => {
  const f = fixture();
  f.dialog.dirty = true;
  f.escape();
  let tree = f.draw();
  assert.equal(f.closed(), 0);
  const confirmation = nodes(tree).find((node) => node.props?.role === "alertdialog");
  assert.ok(confirmation);
  assert.equal(confirmation.props["aria-label"], "Discard unsaved changes?");
  assert.ok(nodes(confirmation).some((node) => node.props?.id === confirmation.props["aria-describedby"]));
  assert.ok(nodes(tree).some((node) => node.props?.inert === true));
  assert.equal(f.document.activeElement.name, "Keep editing");
  f.button("Keep editing").props.onClick();
  tree = f.draw();
  assert.equal(f.closed(), 0);
  assert.equal(nodes(tree).some((node) => node.props?.inert === true || node.props?.role === "alertdialog"), false);
  f.backdrop();
  f.button("Discard changes").props.onClick();
  assert.equal(f.closed(), 1);
});

test("a save beginning during discard confirmation still prevents a stale Discard click", () => {
  const f = fixture();
  f.dialog.dirty = true;
  f.escape();
  const oldDiscard = f.button("Discard changes").props.onClick;
  f.dialog.saving = true;
  oldDiscard();
  assert.equal(f.closed(), 0);
  assert.match(text(f.draw()), /Wait for the current save/);
});

test("closing can restore focus to a replacement Circle card without scrolling", () => {
  const f = fixture({ returnFocusId: "manage-circle-one" });
  f.draw();
  f.previousFocus.isConnected = false;
  const replacement = new f.Element("replacement-card-button");
  f.ids.set("manage-circle-one", replacement);
  f.unmount();
  f.flushFrames();
  assert.equal(f.document.activeElement, replacement);
  assert.deepEqual(f.focusCalls.at(-1).options, { preventScroll: true });
});

test("Keep editing cancels a deferred navigation and restores the previous editor focus", () => {
  const f = fixture();
  f.draw();
  const field = new f.Element("chat-link-input");
  field.focus();
  f.dialog.dirty = true;
  const link = f.link();
  const event = f.domEvent(link);
  f.draw().props.onClickCapture(event);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  f.draw();
  assert.equal(f.document.activeElement.name, "Keep editing");
  f.button("Keep editing").props.onClick();
  f.draw();
  f.flushFrames();
  assert.equal(f.document.activeElement, field);
  assert.deepEqual(f.focusCalls.at(-1).options, { preventScroll: true });
  assert.equal(link.navigations, 0);
  assert.equal(f.closed(), 0);
  f.dialog.dirty = false;
  f.escape();
  f.flushFrames();
  assert.equal(f.closed(), 1, "cancelled navigation must not be replayed by a subsequent ordinary close");
  assert.equal(link.navigations, 0);
});

test("confirming a same-tab navigation replays the clicked link once without also closing its route", () => {
  const f = fixture();
  f.dialog.dirty = true;
  const link = f.link();
  const icon = new f.Element("link-icon");
  icon.link = link;
  const event = f.domEvent(icon);
  f.draw().props.onClickCapture(event);
  assert.equal(event.prevented, true);
  assert.equal(link.navigations, 0);
  f.button("Discard changes").props.onClick();
  assert.equal(link.navigations, 0, "wait until the confirmation's inert state has been removed");
  f.draw();
  f.flushFrames();
  assert.equal(link.navigations, 1, "the replay must bypass its own dirty guard exactly once");
  assert.equal(f.closed(), 0, "do not race navigation with onClose's route replacement");
  assert.equal(nodes(f.draw()).some((node) => node.props?.role === "alertdialog"), false);
});

test("member search GET submissions are guarded and preserve the original submitter on replay", () => {
  const f = fixture();
  f.dialog.dirty = true;
  const form = f.form();
  const submitter = new f.Element("Search");
  const event = f.domEvent(form, { nativeEvent: { submitter } });
  f.draw().props.onSubmitCapture(event);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.deepEqual(form.submissions, []);
  f.button("Discard changes").props.onClick();
  f.draw();
  f.flushFrames();
  assert.deepEqual(form.submissions, [submitter]);
  assert.equal(f.closed(), 0);
});

test("pending state blocks navigation and search without allowing a discard workaround", () => {
  for (const targetKind of ["link", "form"]) {
    const f = fixture();
    f.dialog.saving = true;
    const target = targetKind === "link" ? f.link() : f.form();
    const event = f.domEvent(target);
    f.draw().props[targetKind === "link" ? "onClickCapture" : "onSubmitCapture"](event);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.match(text(f.draw()), /Wait for the current save/);
    assert.equal(nodes(f.draw()).some((node) => node.props?.role === "alertdialog"), false);
    f.flushFrames();
    assert.equal(f.closed(), 0);
    assert.equal(targetKind === "link" ? target.navigations : target.submissions.length, 0);
  }
});

test("safe external actions and in-dialog anchors do not discard the active editor", () => {
  const cases = [
    ["https://chat.google.com/room/one", { target: "_blank" }],
    ["https://members.example.test/report.pdf", { download: true }],
    ["https://members.example.test/ops/circles?circleId=one#circle-resources", {}],
    ["mailto:member@example.test", {}],
    ["tel:+15555555555", {}],
  ];
  for (const [href, patch] of cases) {
    const f = fixture();
    f.dialog.dirty = true;
    const event = f.domEvent(f.link(href, patch));
    f.draw().props.onClickCapture(event);
    assert.equal(event.prevented, false, href);
    assert.equal(f.closed(), 0);
  }
  for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
    const f = fixture();
    f.dialog.dirty = true;
    const event = f.domEvent(f.link(), { [modifier]: true });
    f.draw().props.onClickCapture(event);
    assert.equal(event.prevented, false, modifier);
  }
  for (const patch of [{ method: "post" }, { explicitAction: false }]) {
    const f = fixture();
    f.dialog.dirty = true;
    const event = f.domEvent(f.form(patch));
    f.draw().props.onSubmitCapture(event);
    assert.equal(event.prevented, false, "local mutation forms retain their own submit handling");
  }
});

test("a different-origin link with matching path, query, and hash still requires discard", () => {
  const f = fixture();
  f.dialog.dirty = true;
  const event = f.domEvent(f.link("https://different.example.test/ops/circles?circleId=one#circle-resources"));
  f.draw().props.onClickCapture(event);
  assert.equal(event.prevented, true);
  assert.ok(nodes(f.draw()).some((node) => node.props?.role === "alertdialog"));
});

test("a save beginning before deferred navigation is replayed keeps the workspace open", () => {
  for (const source of ["nested", "parent"]) {
    const f = fixture();
    f.dialog.dirty = true;
    const link = f.link();
    f.draw().props.onClickCapture(f.domEvent(link));
    f.button("Discard changes").props.onClick();
    if (source === "nested") f.dialog.saving = true;
    else f.update({ pending: true });
    f.draw();
    f.flushFrames();
    assert.equal(link.navigations, 0, `${source} pending must be checked at replay time`);
    assert.equal(f.closed(), 0);
    assert.match(text(f.draw()), /Wait for the current save/);
  }
});

test("detached navigation targets are not replayed after discard confirmation", () => {
  for (const targetKind of ["link", "form"]) {
    const f = fixture();
    f.dialog.dirty = true;
    const target = targetKind === "link" ? f.link() : f.form();
    f.draw().props[targetKind === "link" ? "onClickCapture" : "onSubmitCapture"](f.domEvent(target));
    f.button("Discard changes").props.onClick();
    target.isConnected = false;
    f.draw();
    f.flushFrames();
    assert.equal(targetKind === "link" ? target.navigations : target.submissions.length, 0);
    assert.equal(f.closed(), 0);
  }
});

test("Create Circle link's imperative creation callback runs only after one confirmed navigation replay", () => {
  const f = fixture();
  f.dialog.dirty = true;
  let creationCallbacks = 0;
  const link = f.link("https://members.example.test/ops/circles#create-circle", {
    onClick(event) { event.preventDefault(); creationCallbacks++; },
  });
  link.click();
  assert.equal(creationCallbacks, 0, "capture must stop the local close/create handler before discard is approved");
  assert.equal(link.navigations, 0);
  f.button("Discard changes").props.onClick();
  f.draw();
  f.flushFrames();
  assert.equal(creationCallbacks, 1);
  assert.equal(link.navigations, 0, "the handler owns route replacement; do not additionally follow the native href");
  assert.equal(f.closed(), 0, "do not race creation navigation with the ordinary close route");
});

test("Create Circle link cannot close a pending child save through its local callback", () => {
  const f = fixture();
  f.dialog.saving = true;
  let creationCallbacks = 0;
  const link = f.link("https://members.example.test/ops/circles#create-circle", {
    onClick(event) { event.preventDefault(); creationCallbacks++; },
  });
  link.click();
  f.draw();
  f.flushFrames();
  assert.equal(creationCallbacks, 0);
  assert.equal(link.navigations, 0);
  assert.equal(f.closed(), 0);
  assert.match(text(f.draw()), /Wait for the current save/);
});
