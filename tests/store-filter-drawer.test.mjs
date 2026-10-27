import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const elements = node => React.isValidElement(node)
  ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)]
  : [];
const text = node => React.isValidElement(node)
  ? React.Children.toArray(node.props.children).map(text).join("")
  : String(node ?? "");

function fixture({ coarse = false, hasFilters = true, resultCount = 2 } = {}) {
  const slots = [], effects = [], focus = [], scroll = [];
  let cursor = 0, tree, showCalls = 0, clearCalls = 0;
  const initialStyle = { overflow: "clip", paddingRight: "6px", position: "relative", top: "2px", left: "3px", width: "99%" };
  const body = { style: { ...initialStyle } };
  const document = { body, documentElement: { clientWidth: 980 } };
  const window = {
    scrollX: 4, scrollY: 620, innerWidth: 1000,
    matchMedia: () => ({ matches: coarse }),
    getComputedStyle: () => ({ paddingRight: "6px" }),
    scrollTo: options => scroll.push(options),
  };
  const react = {
    ...React,
    useId: () => "drawer-test",
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useEffect(callback, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) {
        effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; });
      }
    },
  };
  const code = ts.transpileModule(readFileSync(new URL("../src/components/store/StoreFilterDrawer.tsx", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", "window", "document", code)(
    name => ({ react, "react/jsx-runtime": jsxRuntime, "./StoreFilterDrawer.module.css": { default: {} } })[name],
    output, output.exports, window, document,
  );
  const trigger = { focus: options => focus.push({ target: "trigger", ...options }) };
  const closer = { focus: options => focus.push({ target: "close", ...options }) };
  const panel = { getBoundingClientRect: () => ({ left: 0, right: 384, top: 0, bottom: 844 }) };
  const dialog = {
    open: false,
    showModal() { this.open = true; showCalls += 1; },
    close() { this.open = false; dialogNode().props.onClose(); },
  };
  const dialogNode = () => elements(tree).find(node => node.type === "dialog");
  const button = label => elements(tree).find(node => node.type === "button" && (text(node) === label || node.props["aria-label"] === label));
  function render() {
    cursor = 0;
    tree = output.exports.default({ children: React.createElement("select", { "aria-label": "Collection" }), activeCount: 2, hasFilters, resultCount, onClear() { clearCalls += 1; } });
    elements(tree).find(node => node.props["aria-haspopup"] === "dialog").props.ref.current = trigger;
    dialogNode().props.ref.current = dialog;
    button("Close filters").props.ref.current = closer;
    elements(tree).find(node => node.type === "div" && node.props.ref).props.ref.current = panel;
    effects.splice(0).forEach(effect => effect());
    return tree;
  }
  render();
  return {
    render, body, initialStyle, focus, scroll, dialog, dialogNode, button,
    get trigger() { return elements(tree).find(node => node.props["aria-haspopup"] === "dialog"); },
    open() { this.trigger.props.onClick(); render(); },
    cancel() { let prevented = false; dialogNode().props.onCancel({ preventDefault() { prevented = true; } }); render(); return prevented; },
    pointer(x, y, target = dialog) { dialogNode().props.onPointerDown({ target, currentTarget: dialog, clientX: x, clientY: y }); render(); },
    cleanup() { slots.forEach(slot => slot?.cleanup?.()); },
    get showCalls() { return showCalls; }, get clearCalls() { return clearCalls; },
  };
}

test("opening uses the native modal and Escape restores body styles and trigger focus", () => {
  const view = fixture();
  assert.equal(view.trigger.props["aria-expanded"], false);
  view.open(); view.open();
  assert.equal(view.showCalls, 1, "repeat clicks do not overwrite the original page state");
  assert.equal(view.body.style.overflow, "hidden");
  assert.equal(view.body.style.paddingRight, "26px");
  assert.equal(view.body.style.position, "relative");
  assert.equal(view.trigger.props["aria-expanded"], true);
  assert.deepEqual(view.focus[0], { target: "close", preventScroll: true });
  assert.equal(view.cancel(), true);
  assert.equal(view.dialog.open, false);
  assert.equal(view.trigger.props["aria-expanded"], false);
  assert.deepEqual(view.body.style, view.initialStyle);
  assert.deepEqual(view.focus.at(-1), { target: "trigger", preventScroll: true });
  assert.deepEqual(view.scroll, []);
  view.cleanup();
});

test("mobile scrolling is frozen and the result action restores the exact page position", () => {
  const view = fixture({ coarse: true, resultCount: 1 });
  view.open();
  assert.equal(view.body.style.position, "fixed");
  assert.equal(view.body.style.top, "-620px");
  assert.equal(view.body.style.left, "-4px");
  assert.equal(view.body.style.width, "100%");
  view.button("View 1 style↗").props.onClick();
  assert.deepEqual(view.body.style, view.initialStyle);
  assert.deepEqual(view.scroll, [{ left: 4, top: 620, behavior: "instant" }]);
  assert.deepEqual(view.focus.at(-1), { target: "trigger", preventScroll: true });
  view.cleanup();
});

test("backdrop dismissal excludes panel whitespace and child controls", () => {
  const view = fixture();
  view.open();
  view.pointer(100, 300);
  assert.equal(view.dialog.open, true, "panel whitespace is not a backdrop click");
  view.pointer(600, 300, {});
  assert.equal(view.dialog.open, true, "child controls never dismiss the drawer");
  view.pointer(600, 300);
  assert.equal(view.dialog.open, false);
  assert.deepEqual(view.body.style, view.initialStyle);
  view.cleanup();
});

test("clear updates filters without dismissing; the close control restores the page", () => {
  const view = fixture();
  view.open();
  view.button("Clear filters").props.onClick();
  assert.equal(view.clearCalls, 1);
  assert.equal(view.dialog.open, true);
  view.button("Close filters").props.onClick();
  assert.equal(view.dialog.open, false);
  assert.deepEqual(view.body.style, view.initialStyle);
  view.cleanup();
  const empty = fixture({ hasFilters: false });
  assert.equal(empty.button("Clear filters").props.disabled, true);
  empty.cleanup();
});

test("unmount restores an active mobile lock but never changes a page that was not locked", () => {
  const closed = fixture();
  closed.body.style.overflow = "scroll";
  closed.cleanup();
  assert.equal(closed.body.style.overflow, "scroll");
  const open = fixture({ coarse: true });
  open.open(); open.cleanup();
  assert.deepEqual(open.body.style, open.initialStyle);
  assert.deepEqual(open.scroll, [{ left: 4, top: 620, behavior: "instant" }]);
});
