import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}, document) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", "document", "fetch", code)((name) => {
    if (name in dependencies) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw Error(`Unexpected dependency ${name}`);
  }, loadedModule, loadedModule.exports, document, () => { throw Error("Member navigation must not send requests"); });
  return loadedModule.exports;
}

const navigation = load("src/lib/membership/navigation.ts");
const { MEMBER_DESTINATIONS, currentMemberDestination, findMemberDestinations } = navigation;
const expectedDestinations = {
  "/my": "Profile",
  "/my/foundations/timeline": "My Timeline",
  "/my/artifacts": "Artifacts",
  "/my/circle": "Circle",
  "/my/experiences": "Experiences",
  "/my/foundations": "Foundations",
  "/my/learn": "Academy",
  "/my/updates": "Updates",
  "/my/profile": "Edit profile",
  "/my/account": "Account",
  "/my/support": "Support",
};

function nodes(node) {
  return !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
}

function text(node) {
  return node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
}

function fixture(initialPath = "/my") {
  const states = [], refs = [], effects = [];
  const document = { body: { style: { overflow: "clip" } } };
  let stateIndex, refIndex, effectIndex, dirty, tree, pathname = initialPath, focused;
  let showCalls = 0, closeCalls = 0;
  const find = (predicate) => {
    const result = nodes(tree).find(predicate);
    assert.ok(result, "Expected matching navigation element");
    return result;
  };
  // The native-dialog facade exercises the actual component effects and event
  // callbacks. Browser QA separately verifies native focus containment.
  const dialog = {
    open: false,
    showModal() { assert.equal(this.open, false); this.open = true; showCalls += 1; },
    close() {
      if (!this.open) return;
      this.open = false;
      closeCalls += 1;
      find((node) => node.type === "dialog").props.onClose();
    },
  };
  const Component = load("src/components/platform/MemberNavigationFab.tsx", {
    "next/link": { __esModule: true, default: "a" },
    "@/components/membership/MemberIcon": {__esModule:true,default:"svg"},
    "next/navigation": { usePathname: () => pathname },
    "@/lib/membership/navigation": navigation,
    "./MemberNavigationFab.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, name) => String(name) }) },
    react: {
      ...React,
      useId: () => "member-navigation-test",
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (value) => {
          const next = typeof value === "function" ? value(states[index]) : value;
          if (!Object.is(next, states[index])) { states[index] = next; dirty = true; }
        }];
      },
      useRef(initial) { return refs[refIndex++] ??= { current: initial }; },
      useEffect(callback, dependencies) {
        const index = effectIndex++, previous = effects[index];
        if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
          previous?.cleanup?.();
          effects[index] = { callback, dependencies, pending: true };
        }
      },
    },
  }, document).default;
  const draw = (nextPath = pathname) => {
    pathname = nextPath;
    let passes = 0;
    do {
      assert.ok(++passes < 10, "navigation settles after effects");
      dirty = false;
      stateIndex = 0; refIndex = 0; effectIndex = 0;
      tree = Component();
      for (const node of nodes(tree).filter((node) => node.props?.ref)) {
        node.props.ref.current = node.type === "dialog" ? dialog : {
          focus: (options) => { focused = { type: node.type, label: node.props["aria-label"], options }; },
        };
      }
      for (const effect of effects.filter((effect) => effect.pending)) {
        effect.pending = false;
        effect.cleanup = effect.callback();
      }
    } while (dirty);
    return tree;
  };
  draw();
  return {
    draw, find, dialog, document,
    all: () => nodes(tree),
    trigger: () => find((node) => node.type === "button" && node.props["aria-haspopup"] === "dialog"),
    sheet: () => find((node) => node.type === "dialog"),
    search: () => find((node) => node.type === "input" && node.props.type === "search"),
    menu: () => find((node) => node.type === "nav" && node.props["aria-label"] === "Membership"),
    focused: () => focused,
    calls: () => ({ show: showCalls, close: closeCalls }),
    unmount: () => { for (const effect of effects) effect.cleanup?.(); },
    escape: () => {
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      find((node) => node.type === "dialog").props.onCancel(event);
      if (!event.defaultPrevented) dialog.close();
      draw();
    },
  };
}

test("Member navigation retains all eleven named destinations and each page exists", () => {
  assert.deepEqual(Object.fromEntries(MEMBER_DESTINATIONS.map(({ href, label }) => [href, label])), expectedDestinations);
  assert.equal(new Set(MEMBER_DESTINATIONS.map(({ href }) => href)).size, 11);
  for (const { href } of MEMBER_DESTINATIONS) assert.ok(readFileSync(new URL(`../app${href}/page.tsx`, import.meta.url), "utf8").length, href);
});

test("Member route selection chooses the longest matching page and respects segment boundaries", () => {
  for (const { href } of MEMBER_DESTINATIONS) {
    assert.equal(currentMemberDestination(href), href);
    if (href !== "/my") assert.equal(currentMemberDestination(`${href}/example`), href);
  }
  assert.equal(currentMemberDestination("/my/foundations/timeline/export"), "/my/foundations/timeline");
  assert.equal(currentMemberDestination("/my/foundations/experience"), "/my/foundations");
  for (const path of ["/my/learning", "/my/circles", "/my/profile-other", "/my/supporting", "/my/unknown", "/my-other", "/ops"]) {
    assert.equal(currentMemberDestination(path), undefined, path);
  }
});

test("Member page search supports common task terms, whitespace, case, and multiple words", () => {
  assert.equal(findMemberDestinations("  ").length, 11);
  for (const [query, hrefs] of [
    ["BILLING", ["/my/account"]],
    ["  profile   photo ", ["/my/profile"]],
    ["events", ["/my/experiences"]],
    ["help", ["/my/support"]],
    ["unread", ["/my/updates"]],
    ["timeline export", ["/my/foundations/timeline"]],
    ["zz-no-page", []],
  ]) assert.deepEqual(findMemberDestinations(query).map(({ href }) => href), hrefs, query);
});

test("The topbar search trigger is labeled and controls a closed native dialog", () => {
  const f=fixture("/my/learn/lesson");
  assert.equal(f.trigger().props["aria-label"],"Search member pages");
  assert.equal(f.trigger().props["aria-expanded"],false);
  assert.equal(f.trigger().props["aria-controls"],f.sheet().props.id);
  assert.equal(f.sheet().props["aria-labelledby"],f.find(node=>node.type==="h2").props.id);
  assert.equal(f.dialog.open,false);
  assert.equal(f.document.body.style.overflow,"clip");
  assert.equal(f.all().some(node=>node.props?.role==="menu"),false);
});

test("Opening the menu calls showModal, focuses search, and exposes every destination with one current page", () => {
  const f = fixture("/my/foundations/timeline/export");
  f.trigger().props.onClick(); f.draw();
  assert.equal(f.trigger().props["aria-expanded"], true);
  assert.equal(f.dialog.open, true);
  assert.deepEqual(f.calls(), { show: 1, close: 0 });
  assert.equal(f.document.body.style.overflow, "hidden");
  assert.equal(f.focused().type, "input");
  assert.deepEqual(f.focused().options, { preventScroll: true });
  const links = nodes(f.menu()).filter((node) => node.type === "a");
  assert.deepEqual(links.map((node) => node.props.href), Object.keys(expectedDestinations));
  const current = links.filter((node) => node.props["aria-current"] === "page");
  assert.equal(current.length, 1);
  assert.equal(current[0].props.href, "/my/foundations/timeline");
  const label = f.find((node) => node.type === "label");
  assert.match(text(label), /Find a membership page/);
  assert.ok(nodes(label).includes(f.search()));
  f.draw();
  assert.deepEqual(f.calls(), { show: 1, close: 0 }, "a stable render never reopens the dialog");
});

test("Search changes the rendered pages, announces no matches, and resets when reopened", () => {
  const f = fixture();
  f.trigger().props.onClick(); f.draw();
  f.search().props.onChange({ target: { value: "billing" } }); f.draw();
  assert.deepEqual(nodes(f.menu()).filter((node) => node.type === "a").map((node) => node.props.href), ["/my/account"]);
  f.search().props.onChange({ target: { value: "no-such-page" } }); f.draw();
  assert.equal(nodes(f.menu()).some((node) => node.type === "a"), false);
  assert.match(text(f.find((node) => node.props?.role === "status")), /No matching pages/);
  f.find((node) => node.type === "button" && node.props["aria-label"] === "Close menu").props.onClick(); f.draw();
  assert.equal(f.dialog.open, false);
  assert.equal(f.document.body.style.overflow, "clip");
  assert.equal(f.focused().label, "Search member pages");
  f.trigger().props.onClick(); f.draw();
  assert.equal(f.search().props.value, "");
  assert.equal(nodes(f.menu()).filter((node) => node.type === "a").length, 11);
});

test("Native Escape closes the menu, restores scrolling and focus, and allows reopening", () => {
  const f = fixture();
  f.trigger().props.onClick(); f.draw();
  f.escape();
  assert.equal(f.dialog.open, false);
  assert.equal(f.trigger().props["aria-expanded"], false);
  assert.deepEqual(f.calls(), { show: 1, close: 1 });
  assert.equal(f.document.body.style.overflow, "clip");
  assert.equal(f.focused().label, "Search member pages");
  f.trigger().props.onClick(); f.draw();
  assert.equal(f.dialog.open, true);
  assert.deepEqual(f.calls(), { show: 2, close: 1 });
});

test("The first Escape in a populated search closes the menu and restores trigger focus", () => {
  const f = fixture();
  f.trigger().props.onClick(); f.draw();
  f.search().props.onChange({ target: { value: "billing" } }); f.draw();
  let prevented = 0;
  f.search().props.onKeyDown({ key: "ArrowDown", preventDefault() { prevented += 1; } }); f.draw();
  assert.equal(prevented, 0);
  assert.equal(f.dialog.open, true);
  assert.equal(f.search().props.value, "billing");
  f.search().props.onKeyDown({ key: "Escape", preventDefault() { prevented += 1; } }); f.draw();
  assert.equal(prevented, 1, "prevent the search field from consuming Escape to clear its query");
  assert.equal(f.dialog.open, false);
  assert.equal(f.trigger().props["aria-expanded"], false);
  assert.equal(f.focused().label, "Search member pages");
  assert.equal(f.document.body.style.overflow, "clip");
  assert.deepEqual(f.calls(), { show: 1, close: 1 });
});

test("Dialog Tab wraps from last to first and Shift+Tab from first to last for every search state", () => {
  const f = fixture();
  f.trigger().props.onClick(); f.draw();
  for (const query of ["", "billing", "no-such-page"]) {
    f.search().props.onChange({ target: { value: query } }); f.draw();
    const focusCalls = [];
    const controls = nodes(f.sheet())
      .filter((node) => (node.type === "a" && node.props.href) || (["button", "input"].includes(node.type) && !node.props.disabled))
      .map((node) => ({
        node,
        focus() { focusCalls.push(this); f.document.activeElement = this; },
      }));
    const first = controls[0], last = controls.at(-1);
    assert.equal(first.node.props["aria-label"], "Close menu");
    assert.ok(controls.length >= 2);
    const currentTarget = {
      querySelectorAll(selector) {
        assert.equal(selector, 'a[href], button:not([disabled]), input:not([disabled])');
        return controls;
      },
    };
    let prevented = 0;
    const keyDown = (shiftKey) => f.sheet().props.onKeyDown({ key: "Tab", shiftKey, currentTarget, preventDefault() { prevented += 1; } });
    f.document.activeElement = first;
    keyDown(true);
    assert.equal(prevented, 1);
    assert.equal(f.document.activeElement, last);
    assert.equal(focusCalls.at(-1), last);
    keyDown(false);
    assert.equal(prevented, 2);
    assert.equal(f.document.activeElement, first);
    assert.equal(focusCalls.at(-1), first);
    keyDown(false);
    assert.equal(prevented, 2, "forward Tab from first remains native");
    f.document.activeElement = last;
    keyDown(true);
    assert.equal(prevented, 2, "backward Tab from last remains native");
    assert.equal(focusCalls.length, 2, "only boundary Tab events move focus explicitly");
    assert.equal(f.dialog.open, true);
  }
});

test("The dialog keyboard boundary leaves other keys untouched", () => {
  const f = fixture();
  f.trigger().props.onClick(); f.draw();
  const currentTarget = { querySelectorAll() { throw Error("Unexpected focus traversal"); } };
  for (const key of ["ArrowDown", "Enter", "Escape"]) {
    f.sheet().props.onKeyDown({ key, currentTarget, preventDefault() { throw Error("Unexpected prevented key"); } });
  }
  assert.equal(f.dialog.open, true);
});

test("Backdrop click closes the menu while content clicks stay open", () => {
  const f = fixture();
  f.trigger().props.onClick(); f.draw();
  f.sheet().props.onClick({ target: {}, currentTarget: f.dialog }); f.draw();
  assert.equal(f.dialog.open, true);
  f.sheet().props.onClick({ target: f.dialog, currentTarget: f.dialog }); f.draw();
  assert.equal(f.dialog.open, false);
  assert.equal(f.focused().label, "Search member pages");
});

test("Choosing a page and changing routes close the menu without losing route identity", () => {
  const f = fixture();
  f.trigger().props.onClick(); f.draw();
  const destination = nodes(f.menu()).find((node) => node.props?.href === "/my/support");
  let prevented = false;
  destination.props.onClick({ preventDefault: () => { prevented = true; } }); f.draw("/my/support/ticket");
  assert.equal(prevented, false, "native link navigation is never prevented");
  assert.equal(f.dialog.open, false);
  assert.equal(nodes(f.menu()).find((node) => node.props?.["aria-current"] === "page").props.href, "/my/support");
  f.trigger().props.onClick(); f.draw();
  f.draw("/my/updates");
  assert.equal(f.trigger().props["aria-expanded"], false);
  assert.equal(f.dialog.open, false);
  assert.equal(f.document.body.style.overflow, "clip");
  assert.equal(nodes(f.menu()).find((node) => node.props?.["aria-current"] === "page").props.href, "/my/updates");
});

test("Unmounting an open menu restores the previous body overflow", () => {
  const f = fixture();
  f.trigger().props.onClick(); f.draw();
  assert.equal(f.document.body.style.overflow, "hidden");
  f.unmount();
  assert.equal(f.document.body.style.overflow, "clip");
});
