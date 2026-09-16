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
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node)
  ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const WaitlistForm = () => null;

function fixture(headingId = "test-members-heading") {
  const slots = [];
  const focus = [];
  const effects = [];
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
    useEffect(callback, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
        effects.push(callback);
      }
      slots[index] = dependencies;
    },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/components/public-members/MembershipWaitlistForm") return { __esModule: true, default: WaitlistForm };
    if (name === "@/data/public-membership") return {
      MEMBERSHIP_INTRO: { headline: "A place for what matters." },
      MEMBERSHIP_LINKS: { signIn: "https://members.theruinedproject.com/access" },
    };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, property) => property }) };
    throw new Error(`Unexpected public signup dependency: ${name}`);
  }, loaded, loaded.exports);

  function draw() {
    cursor = 0;
    const tree = loaded.exports.default({ headingId });
    for (const node of nodes(tree)) {
      if (node.props?.ref && node.type === "button") {
        node.props.ref.current = { focus: (options) => focus.push({ label: node.props["aria-label"] ?? text(node).trim(), options }) };
      }
    }
    for (const effect of effects.splice(0)) effect();
    return tree;
  }
  const panel = (tree) => nodes(tree).find((node) => node.type === "section");
  const close = (tree) => nodes(tree).find((node) => node.type === "button" && node.props["aria-label"] === "Close registration form");
  const reopen = (tree) => nodes(tree).find((node) => node.type === "button" && text(node).startsWith("Join the waitlist"));
  return { draw, panel, close, reopen, focus };
}

function childPath(tree, type, path = []) {
  if (!tree || typeof tree !== "object") return null;
  if (tree.type === type) return { path, key: tree.key, props: tree.props };
  const children = Array.isArray(tree) ? tree : React.Children.toArray(tree.props?.children);
  for (let index = 0; index < children.length; index += 1) {
    const found = childPath(children[index], type, [...path, index]);
    if (found) return found;
  }
  return null;
}

test("registration starts open with an accessible close button and no focus change", () => {
  const f = fixture();
  const tree = f.draw();
  assert.equal(f.panel(tree).props.hidden, false);
  assert.equal(f.reopen(tree).props.hidden, true);
  assert.equal(f.reopen(tree).props["aria-expanded"], true);
  assert.equal(f.reopen(tree).props["aria-controls"], f.panel(tree).props.id);
  assert.equal(f.close(tree).props.type, "button");
  assert.equal(f.reopen(tree).props.type, "button");
  assert.deepEqual(f.focus, [], "arriving in Members must not take keyboard focus");
});

test("closing hides the paper, preserves the form position, and focuses the reopen control", () => {
  const f = fixture();
  const initial = f.draw();
  const originalForm = childPath(initial, WaitlistForm);
  assert.ok(originalForm);
  f.close(initial).props.onClick();
  const closed = f.draw();
  assert.equal(f.panel(closed).props.hidden, true);
  assert.equal(f.reopen(closed).props.hidden, false);
  assert.equal(f.reopen(closed).props["aria-expanded"], false);
  assert.deepEqual(childPath(closed, WaitlistForm), originalForm, "the same child type, key, and position preserve the mounted form and its state");
  assert.deepEqual(f.focus, [{ label: "Join the waitlist ↗", options: { preventScroll: true } }]);
  f.draw();
  assert.equal(f.focus.length, 1, "ordinary rerenders do not repeatedly move focus");
});

test("reopening restores the same form and focuses its close control without scrolling", () => {
  const f = fixture();
  const initial = f.draw();
  f.close(initial).props.onClick();
  const closed = f.draw();
  f.reopen(closed).props.onClick();
  const reopened = f.draw();
  assert.equal(f.panel(reopened).props.hidden, false);
  assert.equal(f.reopen(reopened).props.hidden, true);
  assert.equal(f.reopen(reopened).props["aria-expanded"], true);
  assert.deepEqual(childPath(reopened, WaitlistForm), childPath(initial, WaitlistForm));
  assert.deepEqual(f.focus.at(-1), { label: "Close registration form", options: { preventScroll: true } });
});

test("Escape closes the focused registration area without consuming other keys or closed-state Escape", () => {
  const f = fixture();
  let prevented = 0;
  let stopped = 0;
  const event = (key) => ({ key, preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } });
  let tree = f.draw();
  tree.props.onKeyDown(event("Enter"));
  tree = f.draw();
  assert.equal(f.panel(tree).props.hidden, false);
  assert.equal(prevented, 0);
  tree.props.onKeyDown(event("Escape"));
  tree = f.draw();
  assert.equal(f.panel(tree).props.hidden, true);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1, "handled Escape must not reach another page control");
  tree.props.onKeyDown(event("Escape"));
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});

test("desktop and mobile controls own distinct panel IDs and independent dismissal state", () => {
  const desktop = fixture("desktop-members-heading");
  const mobile = fixture("mobile-members-heading");
  let desktopTree = desktop.draw();
  const mobileTree = mobile.draw();
  assert.notEqual(desktop.panel(desktopTree).props.id, mobile.panel(mobileTree).props.id);
  assert.equal(mobile.reopen(mobileTree).props["aria-controls"], mobile.panel(mobileTree).props.id);
  desktop.close(desktopTree).props.onClick();
  desktopTree = desktop.draw();
  assert.equal(desktop.panel(desktopTree).props.hidden, true);
  assert.equal(mobile.panel(mobile.draw()).props.hidden, false);
  assert.deepEqual(mobile.focus, []);
});
