import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, overrides = {}, environment = {}) {
  const output = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "ResizeObserver", "window", "fetch", output)((name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react") return React;
    if (name === "next/navigation") return { usePathname: () => "/ops/circles" };
    if (name === "next/link") return { __esModule: true, default: "a" };
    if (name === "next/image") return { __esModule: true, default: "img" };
    if (name === "@/lib/platform/operations-navigation") return load("src/lib/platform/operations-navigation.ts");
    if (name === "@/lib/site") return { publicWebsiteHref: (path) => `https://theruinedproject.com${path}` };
    if (name === "@/components/platform/MemberNavigationFab") return { __esModule: true, default: () => null };
    throw new Error(`Unexpected sticky navigation dependency: ${name}`);
  }, cjsModule, cjsModule.exports, environment.ResizeObserver, environment.window,
  () => { throw new Error("Sticky navigation must not make a request"); });
  return cjsModule.exports;
}
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object") return [];
  return [node, ...descendants(node.props?.children)];
}
const configuration = { mode: "connected", database: "connected", supabase: "connected", stripe: "connected" };

function fixture(role = "ops_admin", pathname = "/ops/circles") {
  const effects = [];
  const observers = [];
  const scrolls = [];
  const properties = new Map();
  let height = 152.5;
  const shell = { style: {
    setProperty: (key, value) => properties.set(key, value),
    removeProperty: (key) => properties.delete(key),
  } };
  const element = {
    closest: (selector) => { assert.equal(selector, '[data-platform-surface="ops"]'); return shell; },
    getBoundingClientRect: () => ({ height }),
  };
  class Observer {
    constructor(callback) { this.callback = callback; this.observed = []; this.disconnected = false; observers.push(this); }
    observe(target) { this.observed.push(target); }
    disconnect() { this.disconnected = true; }
  }
  const Navigation = load("src/components/platform/PlatformShell.tsx", {
    react: { ...React,
      useState: (value) => [value, () => {}],
      useRef: () => ({ current: null }),
      useEffect: (effect, dependencies) => effects.push({ effect, dependencies }),
    },
  }, { ResizeObserver: Observer, window: { scrollTo: (options) => scrolls.push(options) } }).OperationsNavigation;
  const tree = Navigation({ configuration, operatorRole: role, pathname });
  const rail = descendants(tree).find((node) => Object.hasOwn(node.props ?? {}, "data-operator-navigation"));
  if (rail) rail.props.ref.current = element;
  return { tree, rail, effects, observers, scrolls, properties, element, setHeight: (value) => { height = value; } };
}

test("the complete wrapping navigation rail sticks below the fixed brand header, not inside a short container", () => {
  const f = fixture();
  assert.equal(f.tree.type, React.Fragment);
  assert.ok(f.tree.props.children.includes(f.rail));
  assert.match(f.rail.props.className, /(?:^|\s)sticky(?:\s|$)/);
  assert.match(f.rail.props.className, /top-\[var\(--ruined-header-height\)\]/);
  assert.match(f.rail.props.className, /z-\[80\]/);
  assert.doesNotMatch(f.rail.props.className, /overflow-(?:hidden|auto|scroll)|h-\[/);
  const header = descendants(f.tree).find((node) => node.type === "header");
  assert.match(header.props.className, /fixed.*z-\[90\]/);
  const rails = descendants(f.rail).filter((node) => node.type === "nav");
  assert.equal(rails.length, 2);
  for (const rail of rails) assert.match(rail.props.className, /flex-wrap/);
});

test("actual combined rail height is measured initially and again when mobile or text wrapping changes", () => {
  const f = fixture();
  f.effects[0].effect();
  assert.equal(f.properties.get("--operator-navigation-height"), "152.5px");
  assert.deepEqual(f.observers[0].observed, [f.element]);
  for (const height of [204, 116.25, 68]) {
    f.setHeight(height);
    f.observers[0].callback([]);
    assert.equal(f.properties.get("--operator-navigation-height"), `${height}px`);
  }
  assert.deepEqual(f.scrolls, [], "resize must not fight the user's scroll or hash navigation");
});

test("observer cleanup removes the scoped measurement and role changes reinitialize the effect", () => {
  const f = fixture();
  const cleanup = f.effects[0].effect();
  assert.ok(f.effects[0].dependencies.includes("ops_admin"));
  assert.equal(typeof cleanup, "function");
  cleanup();
  assert.equal(f.observers[0].disconnected, true);
  assert.equal(f.properties.has("--operator-navigation-height"), false);
  assert.deepEqual(f.scrolls, []);
});

test("unauthorized or absent navigation never installs a measurement observer", () => {
  const f = fixture(null, "/ops/access");
  assert.equal(f.rail, undefined);
  assert.equal(f.effects[0].effect(), undefined);
  assert.equal(f.observers.length, 0);
  assert.equal(f.properties.size, 0);
});

test("only operator anchor and focus targets receive the complete sticky offset, without double scroll padding", () => {
  const css = source("src/styles/index.css");
  const rule = css.match(/\[data-platform-surface="ops"\] \.operator-paper,[^{]+\{([^}]+)\}/);
  assert.ok(rule);
  assert.match(rule[0], /\.operator-paper :is\(\[id\], a, button, input, select, textarea, summary, \[tabindex\]\)/);
  assert.match(rule[1], /scroll-margin-top:\s*calc\(var\(--ruined-header-height\) \+ var\(--operator-navigation-height, [^)]+\) \+ 1rem\)/);
  assert.doesNotMatch(css, /scroll-padding(?:-top)?:/);
  assert.doesNotMatch(rule[0], /html|body|member-profile-paper/);
  // index.css is unlayered; the imported Tailwind utility layer cannot override
  // this scoped rule with a page's old scroll-mt-28/32/36 utility.
  assert.match(source("src/styles/tailwind.css"), /@import 'tailwindcss'/);
  const frame = load("src/components/platform/OperatorPageFrame.tsx").default({ title: "Circles", children: "Roster" });
  assert.equal(frame.type, "main");
  assert.equal(frame.props.id, "operator-content");
  assert.equal(frame.props.tabIndex, -1);
  assert.match(frame.props.className, /operator-paper/);
});

test("the skip link remains native and only route selections request instant top positioning", () => {
  const f = fixture();
  const links = descendants(f.tree).filter((node) => node.props?.href);
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

test("member record sections stay in document flow instead of hiding behind a third sticky rail", () => {
  const record = source("src/components/platform/OperatorMemberRecord.tsx");
  const localRail = record.match(/aria-label="Member record sections"\s+className="([^"]+)"/);
  assert.ok(localRail);
  assert.doesNotMatch(localRail[1], /(?:^|\s)(?:sticky|fixed)(?:\s|$)|top-\[/);
});
