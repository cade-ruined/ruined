import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/sequence/JourneyMembersPreview.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const MembershipLandingModal = () => null;

function fixture(headingId = "test-members-heading") {
  const slots = [];
  const portalCalls = [];
  const focusCalls = [];
  const body = { name: "document body" };
  const triggerElement = { focus: (...args) => focusCalls.push(args) };
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "document", compiled)((name) => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-dom") return { createPortal: (child, host) => {
      portalCalls.push({ child, host });
      return child;
    } };
    if (name === "./MembershipLandingModal") return { __esModule: true, default: MembershipLandingModal };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, property) => property }) };
    throw new Error(`Unexpected preview dependency: ${name}`);
  }, loaded, loaded.exports, { body });

  function draw() {
    cursor = 0;
    const tree = loaded.exports.default({ headingId });
    for (const node of nodes(tree)) {
      if (node.type === "button" && node.props.ref) node.props.ref.current = triggerElement;
    }
    return tree;
  }
  const trigger = (tree) => nodes(tree).find((node) => node.type === "button" && node.props["aria-haspopup"] === "dialog");
  const modal = (tree) => nodes(tree).find((node) => node.type === MembershipLandingModal);
  return { draw, trigger, modal, portalCalls, focusCalls, body, triggerElement };
}

test("arriving in Members shows a preview without opening or loading the landing page", () => {
  const f = fixture();
  const tree = f.draw();
  assert.equal(f.trigger(tree).props.type, "button");
  assert.equal(f.trigger(tree).props["aria-expanded"], false);
  assert.ok(f.trigger(tree).props["aria-label"].trim());
  assert.equal(f.modal(tree), undefined);
  assert.equal(nodes(tree).some((node) => node.type === "iframe" || node.type === "form" || node.type === "video"), false);
  assert.deepEqual(f.portalCalls, [], "The landing page is not mounted before activation");
  assert.deepEqual(f.focusCalls, [], "Arriving in the room does not move keyboard focus");
});

test("activating the preview opens one modal outside the walk and provides its return-focus target", () => {
  const f = fixture();
  f.trigger(f.draw()).props.onClick();
  const open = f.draw();
  assert.equal(f.trigger(open).props["aria-expanded"], true);
  assert.equal(nodes(open).filter((node) => node.type === MembershipLandingModal).length, 1);
  assert.equal(f.portalCalls.at(-1).host, f.body, "A body portal escapes the transformed walk container");
  assert.equal(f.modal(open).props.returnFocus.current, f.triggerElement);
  assert.equal(typeof f.modal(open).props.onClose, "function");
  f.trigger(open).props.onClick();
  assert.equal(nodes(f.draw()).filter((node) => node.type === MembershipLandingModal).length, 1);
});

test("the modal close callback returns to the snippet and allows reopening", () => {
  const f = fixture();
  f.trigger(f.draw()).props.onClick();
  f.modal(f.draw()).props.onClose();
  const closed = f.draw();
  assert.equal(f.trigger(closed).props["aria-expanded"], false);
  assert.equal(f.modal(closed), undefined, "The full landing page unmounts when dismissed");
  f.trigger(closed).props.onClick();
  const reopened = f.draw();
  assert.equal(f.trigger(reopened).props["aria-expanded"], true);
  assert.equal(f.modal(reopened).props.returnFocus.current, f.triggerElement);
});

test("desktop and mobile snippets own independent launch state and return-focus targets", () => {
  const desktop = fixture("desktop-members-heading");
  const mobile = fixture("mobile-members-heading");
  desktop.trigger(desktop.draw()).props.onClick();
  const desktopOpen = desktop.draw();
  const mobileClosed = mobile.draw();
  assert.equal(desktop.trigger(desktopOpen).props["aria-expanded"], true);
  assert.equal(mobile.trigger(mobileClosed).props["aria-expanded"], false);
  assert.equal(mobile.modal(mobileClosed), undefined);
  mobile.trigger(mobileClosed).props.onClick();
  assert.notEqual(desktop.modal(desktopOpen).props.returnFocus.current, mobile.modal(mobile.draw()).props.returnFocus.current);
});
