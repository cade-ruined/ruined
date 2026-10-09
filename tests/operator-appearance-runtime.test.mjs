import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const KEY = "ruined-operator-appearance";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(path, dependencies, window) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "window", output)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(dependencies, name), name);
    return dependencies[name];
  }, mod, mod.exports, window);
  return mod.exports;
}
const navigation = compile("src/lib/platform/operations-navigation.ts", {});
const configuration = { mode: "connected", database: "connected", supabase: "connected", stripe: "connected" };
const descendants = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children)];
const dependencies = (react, pathname) => ({
  react,
  "next/navigation": { usePathname: pathname },
  "next/link": { __esModule: true, default: "a" },
  "next/image": { __esModule: true, default: "img" },
  "@/components/platform/MemberNavigationFab": { __esModule: true, default: "member-navigation" },
  "@/components/platform/operatorStyles": compile("src/components/platform/operatorStyles.ts", {}),
  "@/lib/platform/operations-navigation": navigation,
  "@/lib/site": { publicWebsiteHref: (path) => `https://theruinedproject.com${path}` },
});

function fixture({ stored = null, systemDark = false, storageBlocked = false, mediaUnavailable = false, legacyMedia = false, surface = "ops" } = {}) {
  const states = [], effects = [], mediaListeners = new Set(), storageListeners = new Set();
  const storage = new Map([["ruined-member-appearance", "ink"]]);
  if (stored !== null) storage.set(KEY, stored);
  const reads = [], writes = [];
  let stateIndex = 0, effectIndex = 0, changed = false, currentSurface = surface, tree;
  const media = { matches: systemDark };
  const listen = (_event, callback) => mediaListeners.add(callback);
  const unlisten = (_event, callback) => mediaListeners.delete(callback);
  if (legacyMedia) { media.addListener = (callback) => listen("change", callback); media.removeListener = (callback) => unlisten("change", callback); }
  else { media.addEventListener = listen; media.removeEventListener = unlisten; }
  const window = {
    get localStorage() {
      if (storageBlocked) throw Error("Storage blocked");
      return { getItem(key) { reads.push(key); return storage.get(key) ?? null; }, setItem(key, value) { writes.push([key, value]); storage.set(key, value); } };
    },
    matchMedia(query) { assert.equal(query, "(prefers-color-scheme: dark)"); if (mediaUnavailable) throw Error("Media unavailable"); return media; },
    addEventListener(event, callback) { assert.equal(event, "storage"); storageListeners.add(callback); },
    removeEventListener(event, callback) { assert.equal(event, "storage"); storageListeners.delete(callback); },
  };
  const hooks = { ...React,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value) => { const next = typeof value === "function" ? value(states[index]) : value; if (next !== states[index]) { states[index] = next; changed = true; } }];
    },
    useEffect(callback, deps) {
      const index = effectIndex++, previous = effects[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects[index] = { callback, deps, cleanup: previous?.cleanup, pending: true };
    },
  };
  const shell = compile("src/components/platform/PlatformShell.tsx", dependencies(hooks, () => currentSurface === "ops" ? "/ops/members" : "/my"), window);
  function draw(nextSurface = currentSurface) {
    currentSurface = nextSurface;
    for (let pass = 0; pass < 10; pass++) {
      changed = false; stateIndex = 0; effectIndex = 0;
      tree = shell.default({ configuration, surface: currentSurface, operatorRole: "ops_admin", children: "Workspace" });
      for (const effect of effects.filter((value) => value.pending)) { effect.pending = false; effect.cleanup?.(); effect.cleanup = effect.callback(); }
      if (!changed) return tree;
    }
    throw Error("Appearance did not settle");
  }
  draw();
  return {
    draw, storage, reads, writes, mediaListeners, storageListeners,
    theme: () => tree.props["data-operator-theme"],
    navigation: () => descendants(tree).find((node) => node.type === shell.OperationsNavigation),
    change(value) { this.navigation().props.onAppearanceChange(value); draw(); },
    system(value) { media.matches = value; for (const callback of mediaListeners) callback(); draw(); },
    external(key, newValue) { for (const callback of storageListeners) callback({ key, newValue }); draw(); },
    unmount() { for (const effect of effects) effect.cleanup?.(); },
  };
}

test("operator appearance follows the system until an explicit choice and can return to System", () => {
  const f = fixture({ systemDark: true });
  assert.equal(f.theme(), "ink");
  assert.equal(f.navigation().props.appearance, "system");
  f.system(false); assert.equal(f.theme(), "paper");
  f.change("ink"); assert.equal(f.theme(), "ink");
  assert.deepEqual(f.writes, [[KEY, "ink"]]);
  f.system(true); f.system(false); assert.equal(f.theme(), "ink");
  f.change("system"); assert.equal(f.theme(), "paper");
  f.system(true); assert.equal(f.theme(), "ink");
  assert.equal(f.storage.get(KEY), "system");
  assert.equal(f.storage.get("ruined-member-appearance"), "ink");
  assert.deepEqual(f.reads, [KEY]);
  f.unmount(); assert.equal(f.mediaListeners.size, 0); assert.equal(f.storageListeners.size, 0);
});

test("stored light/dark choices override system and invalid values safely follow it", () => {
  for (const [stored, systemDark, expected] of [["paper", true, "paper"], ["ink", false, "ink"], ["system", true, "ink"], ["unknown", true, "ink"]]) {
    const f = fixture({ stored, systemDark }); assert.equal(f.theme(), expected); assert.deepEqual(f.writes, []); f.unmount();
  }
});

test("blocked storage or unavailable media does not prevent switching for this visit", () => {
  const f = fixture({ storageBlocked: true, mediaUnavailable: true });
  assert.equal(f.theme(), "paper");
  f.change("ink"); assert.equal(f.theme(), "ink");
  f.change("paper"); assert.equal(f.theme(), "paper");
  assert.deepEqual(f.writes, []);
  f.unmount(); assert.equal(f.storageListeners.size, 0);
});

test("operator storage events sync other tabs without reading or overwriting member preferences", () => {
  const f = fixture();
  f.external("ruined-member-appearance", "ink"); assert.equal(f.theme(), "paper");
  f.external(KEY, "ink"); assert.equal(f.theme(), "ink");
  f.external(KEY, "paper"); assert.equal(f.theme(), "paper");
  f.system(true); assert.equal(f.theme(), "paper");
  f.external(null, null); assert.equal(f.theme(), "ink");
  assert.deepEqual(f.writes, []); f.unmount();
});

test("member shell is untouched and leaving operations cleans up modern and legacy media listeners", () => {
  for (const legacyMedia of [false, true]) {
    const f = fixture({ legacyMedia, systemDark: true });
    assert.equal(f.mediaListeners.size, 1);
    assert.equal(f.theme(), "ink");
    f.draw("member"); assert.equal(f.theme(), undefined); assert.equal(f.navigation(), undefined);
    assert.equal(f.mediaListeners.size, 0); assert.equal(f.storageListeners.size, 0);
    f.unmount();
  }
  const member = fixture({ surface: "member", storageBlocked: true });
  assert.equal(member.theme(), undefined); assert.deepEqual(member.reads, []); assert.deepEqual(member.writes, []);
  assert.equal(member.mediaListeners.size, 0); assert.equal(member.storageListeners.size, 0);
});

test("appearance switch has a stable accessible label, 44px target, correct state and a System option", () => {
  const f = fixture();
  const Navigation = compile("src/components/platform/PlatformShell.tsx", dependencies({ ...React, useEffect() {}, useRef: () => ({ current: null }), useState: () => [true, () => {}] }, () => "/ops"), {}).OperationsNavigation;
  const draw = () => descendants(Navigation(f.navigation().props));
  let nodes = draw();
  let toggle = nodes.find((node) => node.props?.role === "switch");
  assert.equal(toggle.props["aria-label"], "Dark mode"); assert.equal(toggle.props["aria-checked"], false);
  assert.match(toggle.props.className, /min-h-11/); assert.match(toggle.props.className, /w-14.*shrink-0/);
  assert.equal(toggle.props.title, "Switch to dark mode");
  assert.equal(descendants(toggle).find((node) => node.type === "span").props["aria-hidden"], "true");
  toggle.props.onClick(); f.draw(); assert.equal(f.theme(), "ink");
  nodes = draw(); toggle = nodes.find((node) => node.props?.role === "switch");
  assert.equal(toggle.props["aria-label"], "Dark mode"); assert.equal(toggle.props["aria-checked"], true); assert.equal(toggle.props.title, "Switch to light mode");
  const select = nodes.find((node) => node.props?.id === "operator-appearance");
  assert.deepEqual(descendants(select).filter((node) => node.type === "option").map((node) => node.props.value), ["system", "paper", "ink"]);
  select.props.onChange({ target: { value: "system" } }); f.draw(); assert.equal(f.theme(), "paper");
  f.unmount();
});
