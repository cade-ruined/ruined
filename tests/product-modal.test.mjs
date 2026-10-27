import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const elements = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : String(node ?? "");

function fixture() {
  const slots = [], effects = [], events = [], focus = [], locks = [];
  let cursor = 0, tree, backs = 0, releases = 0;
  class Element { isConnected = true; focus(options) { focus.push(options); } }
  const previousFocus = new Element();
  const document = { body: {}, activeElement: previousFocus, querySelector: () => null };
  const react = { ...React,
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => v !== slots[i].deps[j])) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const dependencies = {
    react, "react/jsx-runtime": jsxRuntime,
    "next/navigation": { useRouter: () => ({ back() { backs++; } }) },
    "@/lib/analytics/storefront": { trackStoreEvent(name, props) { events.push({ name, props }); } },
    "@/lib/store/product-scroll-lock": { acquireProductScrollLock(options) { locks.push(options); return () => { releases++; }; } },
    "./ProductSurface.module.css": { default: {} }, "./ProductModal.module.css": { default: {} },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../src/components/store/ProductModal.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", "document", "HTMLElement", "requestAnimationFrame", "CSS", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, output, output.exports, document, Element, callback => callback(), { escape: value => value });
  const content = React.createElement("div", { "data-selected-variant": "blue-medium" }, "Product");
  function render() {
    cursor = 0;
    tree = output.exports.default({ handle: "hoodie", name: "Hoodie", children: content });
    tree.props.ref.current = dialog;
    elements(tree).find(node => node.props["aria-label"] === "Close product").props.ref.current = { focus() {} };
    effects.splice(0).forEach(run => run());
    return tree;
  }
  render();
  return { render, dialog, events, focus, locks, content,
    get releases() { return releases; }, leaveBackground() { previousFocus.isConnected = false; },
    get tree() { return tree; }, get backs() { return backs; },
    button(label) { return elements(tree).find(node => node.type === "button" && (text(node).startsWith(label) || node.props["aria-label"] === label)); },
    cleanup() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test("expanding preserves product children and reports expansion only, minimizing does not close", () => {
  const view = fixture();
  assert.equal(view.dialog.open, true);
  view.button("Expand").props.onClick(); view.render();
  assert.equal(view.button("Minimize").props["aria-pressed"], true);
  assert.ok(elements(view.tree).some(node => node.props.children === view.content));
  view.button("Minimize").props.onClick(); view.render();
  assert.equal(view.button("Expand").props["aria-pressed"], false);
  assert.deepEqual(view.events, [{ name: "store_product_expanded", props: { product_handle: "hoodie", source: "product_modal" } }]);
  assert.equal(view.backs, 0);
  assert.equal(view.locks.length, 1, "expansion preserves the existing modal lock");
  view.cleanup();
});

test("Escape and backdrop dismiss once, while product-content interactions do not dismiss", () => {
  const view = fixture();
  view.tree.props.onPointerDown({ target: {}, currentTarget: view.dialog });
  assert.equal(view.backs, 0);
  let prevented = false;
  view.tree.props.onCancel({ target: view.dialog, currentTarget: view.dialog, preventDefault() { prevented = true; } });
  view.button("Close product").props.onClick();
  assert.equal(prevented, true);
  assert.equal(view.backs, 1);
  view.cleanup();
  const backdrop = fixture();
  backdrop.tree.props.onPointerDown({ target: backdrop.dialog, currentTarget: backdrop.dialog });
  assert.equal(backdrop.backs, 1);
  backdrop.cleanup();
});

test("a nested size guide's Escape keeps the product modal open and permits the guide to close", () => {
  const view = fixture();
  let prevented = false;
  view.tree.props.onCancel({ target: { open: true }, currentTarget: view.dialog, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, "the nested dialog retains its native Escape close behavior");
  assert.equal(view.backs, 0, "the outer product route stays open");
  assert.equal(view.dialog.open, true);
  view.cleanup();
});

test("modal cleanup releases its shared lock and restores focus only to the retained background", () => {
  const view = fixture();
  assert.equal(view.locks[0].restoreScroll(), true);
  view.cleanup();
  assert.equal(view.dialog.open, false);
  assert.equal(view.releases, 1);
  assert.deepEqual(view.focus, [{ preventScroll: true }]);
  const leaving = fixture();
  leaving.leaveBackground();
  assert.equal(leaving.locks[0].restoreScroll(), false, "another page must not inherit the store's old scroll position");
  leaving.cleanup();
  assert.equal(leaving.releases, 1);
  assert.deepEqual(leaving.focus, []);
});
