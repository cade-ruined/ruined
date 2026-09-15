import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
function load(path, overrides = {}, environment = {}) {
  const output = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "document", "window", "fetch", output)((name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react") return React;
    if (name === "next/navigation") return { usePathname: () => "/ops/circles" };
    if (name === "next/link") return { __esModule: true, default: "a" };
    if (name === "next/image") return { __esModule: true, default: "img" };
    if (name === "@/lib/platform/operations-navigation") return load("src/lib/platform/operations-navigation.ts");
    if (name === "@/lib/site") return { publicWebsiteHref: (path) => "https://theruinedproject.com" + path };
    if (name === "@/components/platform/MemberNavigationFab") return { __esModule: true, default: () => null };
    throw new Error("Unexpected navigation dependency: " + name);
  }, cjsModule, cjsModule.exports, environment.document, environment.window,
  () => { throw new Error("Navigation must not make a request"); });
  return cjsModule.exports;
}
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object") return [];
  return [node, ...descendants(node.props?.children)];
}
const configuration = { mode: "connected", database: "connected", supabase: "connected", stripe: "connected" };

function fixture() {
  const states = [], refs = [], effects = [], listeners = new Map(), scrolls = [];
  let stateIndex, refIndex, effectIndex, dirty, tree, focused;
  const document = {
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
  };
  const Navigation = load("src/components/platform/PlatformShell.tsx", { react: { ...React,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => {
        const next = typeof value === "function" ? value(states[index]) : value;
        if (next !== states[index]) { states[index] = next; dirty = true; }
      }];
    },
    useRef(initial) { return refs[refIndex++] ??= { current: initial }; },
    useEffect(callback, dependencies) {
      const index = effectIndex++, previous = effects[index];
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
        previous?.cleanup?.();
        effects[index] = { callback, dependencies, pending: true };
      }
    },
  } }, { document, window: { scrollTo: (value) => scrolls.push(value) } }).OperationsNavigation;
  const draw = (pathname = "/ops/circles", role = "ops_admin") => {
    let passes = 0;
    do {
      assert.ok(++passes < 10, "render settles");
      dirty = false; stateIndex = 0; refIndex = 0; effectIndex = 0;
      tree = Navigation({ configuration, operatorRole: role, pathname });
      for (const node of descendants(tree).filter((node) => node.props?.ref)) {
        node.props.ref.current = node.type === "button"
          ? { focus: () => { focused = node.props["aria-controls"]; } }
          : { contains: (target) => target?.inside === true };
      }
      for (const effect of effects.filter((effect) => effect.pending)) {
        effect.pending = false; effect.cleanup = effect.callback();
      }
    } while (dirty);
    return tree;
  };
  draw();
  return {
    draw, scrolls, listeners,
    all: () => descendants(tree),
    button: (controls = "ops-workspaces") => descendants(tree).find((node) => node.type === "button" && node.props["aria-controls"] === controls),
    emit: (type, event) => { for (const callback of listeners.get(type) ?? []) callback(event); },
    focused: () => focused,
  };
}

test("workspace selector lives in the single fixed header without a second sticky rail", () => {
  const f = fixture();
  const navigation = f.all().filter((node) => Object.hasOwn(node.props ?? {}, "data-operator-navigation"));
  assert.equal(navigation.length, 1);
  assert.equal(navigation[0].type, "header");
  assert.match(navigation[0].props.className, /fixed.*top-0.*z-\[90\]/);
  assert.equal(f.all().some((node) => /(?:^|\s)sticky(?:\s|$)/.test(node.props?.className ?? "")), false);
  assert.equal(f.button().props["aria-expanded"], false);
  assert.match(f.button().props.className, /min-h-11/);
  assert.deepEqual(f.scrolls, []);
});

test("open workspace panel fits the viewport and preserves 44px link targets", () => {
  const f = fixture();
  f.button().props.onClick(); f.draw();
  const panel = f.all().find((node) => node.props?.id === "ops-workspaces");
  assert.equal(panel.type, "nav");
  assert.match(panel.props.className, /max-h-\[calc\(100dvh-var\(--ruined-header-height\)-1.5rem\)\]/);
  assert.match(panel.props.className, /overflow-y-auto.*overscroll-contain/);
  const links = descendants(panel).filter((node) => node.props?.href);
  assert.equal(links.length, 13);
  for (const link of links) assert.match(link.props.className, /min-h-11/);
  assert.equal(links.filter((link) => link.props["aria-current"] === "page").length, 1);
});

test("Escape closes the selector, returns focus, and cleans up its listeners", () => {
  const f = fixture();
  f.button().props.onClick(); f.draw();
  f.emit("keydown", { key: "ArrowDown" }); f.draw();
  assert.equal(f.button().props["aria-expanded"], true);
  f.emit("keydown", { key: "Escape" }); f.draw();
  assert.equal(f.button().props["aria-expanded"], false);
  assert.equal(f.focused(), "ops-workspaces");
  assert.equal(f.listeners.get("keydown").size, 0);
  assert.equal(f.listeners.get("pointerdown").size, 0);
});

test("outside press closes the selector but choosing within it is not intercepted", () => {
  const f = fixture();
  f.button().props.onClick(); f.draw();
  f.emit("pointerdown", { target: { inside: true } }); f.draw();
  assert.equal(f.button().props["aria-expanded"], true);
  f.emit("pointerdown", { target: { inside: false } }); f.draw();
  assert.equal(f.button().props["aria-expanded"], false);
  assert.deepEqual(f.scrolls, []);
});

test("route and role changes close stale menus while preserving access boundaries", () => {
  const f = fixture();
  f.button().props.onClick(); f.draw("/ops/members/member-id");
  assert.equal(f.button().props["aria-expanded"], false);
  assert.equal(f.button().props["aria-label"], "Workspace: Members");
  f.button().props.onClick(); f.draw("/ops/members/member-id", "guide");
  assert.equal(f.button().props["aria-expanded"], false);
  f.button().props.onClick(); f.draw("/ops/members/member-id", "guide");
  assert.equal(f.all().some((node) => node.props?.href === "/ops/operators"), false);
  f.draw("/ops/access", null);
  assert.equal(f.button(), undefined);
  assert.equal(f.listeners.get("keydown").size, 0);
});

test("Tab leaving the disclosure closes it without moving focus", () => {
  const f = fixture();
  f.button().props.onClick(); f.draw();
  const wrapper = f.all().find((node) => typeof node.props?.onBlur === "function");
  wrapper.props.onBlur({ currentTarget: { contains: () => true }, relatedTarget: {} }); f.draw();
  assert.equal(f.button().props["aria-expanded"], true);
  wrapper.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: {} }); f.draw();
  assert.equal(f.button().props["aria-expanded"], false);
  assert.equal(f.focused(), undefined);
});

test("operator anchor and focus targets clear only the fixed header, without phantom rail spacing", () => {
  const css = source("src/styles/index.css");
  const rule = css.match(/\[data-platform-surface="ops"\] \.operator-paper,[^{]+\{([^}]+)\}/);
  assert.ok(rule);
  assert.match(rule[0], /\.operator-paper :is\(\[id\], a, button, input, select, textarea, summary, \[tabindex\]\)/);
  assert.match(rule[1], /scroll-margin-top:\s*calc\(var\(--ruined-header-height\) \+ 1rem\)/);
  assert.doesNotMatch(rule[1], /operator-navigation-height/);
  assert.doesNotMatch(css, /scroll-padding(?:-top)?:/);
  assert.doesNotMatch(rule[0], /html|body|member-profile-paper/);
  const frame = load("src/components/platform/OperatorPageFrame.tsx").default({ title: "Circles", children: "Roster" });
  assert.equal(frame.type, "main");
  assert.equal(frame.props.id, "operator-content");
  assert.equal(frame.props.tabIndex, -1);
});

test("skip link stays native and only route selections request instant top positioning", () => {
  const f = fixture();
  f.button().props.onClick(); f.draw();
  const links = f.all().filter((node) => node.props?.href);
  const skip = links.find((node) => node.props.href === "#operator-content");
  assert.ok(skip);
  assert.equal(skip.props.onNavigate, undefined);
  assert.equal(skip.props.onClick, undefined);
  for (const link of links.filter((node) => typeof node.props.onNavigate === "function")) {
    assert.equal(link.props.scroll, false);
    assert.ok(link.props.href.startsWith("/ops"));
    link.props.onNavigate();
    assert.deepEqual(f.scrolls.at(-1), { top: 0, left: 0, behavior: "instant" });
  }
});

test("member record section control stays in document flow instead of adding a competing sticky rail", () => {
  const record = source("src/components/platform/OperatorMemberWorkspace.tsx");
  const localRail = record.match(/aria-label="Member record sections"\s+className="([^"]+)"/);
  assert.ok(localRail);
  assert.doesNotMatch(localRail[1], /(?:^|\s)(?:sticky|fixed)(?:\s|$)|top-\[/);
});
