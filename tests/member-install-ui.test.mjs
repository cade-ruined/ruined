import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const source = await readFile(new URL("../src/components/membership/InstallRuined.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const descendants = element => React.isValidElement(element) ? [element, ...React.Children.toArray(element.props.children).flatMap(descendants)] : [];
const text = element => typeof element === "string" || typeof element === "number" ? String(element) : React.isValidElement(element) ? React.Children.toArray(element.props.children).map(text).join("") : "";
const button = (tree, label) => descendants(tree).find(element => element.type === "button" && text(element) === label);

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type, event = {}) { for (const listener of listeners.get(type) ?? []) listener(event); },
    count: () => [...listeners.values()].reduce((count, group) => count + group.size, 0),
  };
}

function harness(options = {}) {
  const hooks = [], effects = [];
  let cursor = 0, changed = false;
  const storage = options.storage ?? new Map();
  const media = { ...eventTarget(), matches: options.standalone ?? false };
  const window = { ...eventTarget(), matchMedia: () => media, localStorage: {
    getItem(key) { if (options.storageError) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
    setItem(key, value) { if (options.storageError) throw new Error("Storage blocked"); storage.set(key, value); },
  } };
  const fakeReact = { ...React,
    useId: () => { cursor++; return "install-instructions"; },
    useState: initial => {
      const slot = cursor++;
      if (!(slot in hooks)) hooks[slot] = typeof initial === "function" ? initial() : initial;
      return [hooks[slot], update => { const next = typeof update === "function" ? update(hooks[slot]) : update; changed ||= next !== hooks[slot]; hooks[slot] = next; }];
    },
    useRef: initial => { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = { current: initial }; return hooks[slot]; },
    useEffect: (effect, deps) => {
      const slot = cursor++, previous = hooks[slot];
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
        const state = { deps, cleanup: undefined };
        hooks[slot] = state;
        effects.push(() => { previous?.cleanup?.(); state.cleanup = effect(); });
      }
    },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "navigator", "Date", compiled)(name => {
    if (name === "react") return fakeReact;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(`Unexpected dependency: ${name}`);
  }, loaded, loaded.exports, window, { userAgent: options.userAgent ?? "Android Chrome", maxTouchPoints: options.maxTouchPoints ?? 0, standalone: options.iosStandalone ?? false }, class extends Date { static now() { return options.now ?? 1_800_000_000_000; } });

  function render(flushEffects = true) {
    let tree, passes = 0;
    do {
      cursor = 0; changed = false;
      tree = loaded.exports.default({ className: "shell-install", variant: options.variant });
      if (flushEffects) while (effects.length) effects.shift()();
      assert.ok(++passes < 10, "effects should settle");
    } while (flushEffects && changed);
    return tree;
  }
  const unmount = () => { for (const hook of hooks) hook?.cleanup?.(); };
  return { render, window, media, storage, unmount, remount: () => { unmount(); hooks.length = 0; effects.length = 0; return render(); } };
}

const HANDLED_KEY = "ruined-member-install-handled";
const DISMISSAL_KEY = "ruined-member-install-dismissed-until";

test("the suggestion waits for mobile detection and stays absent in installed apps", () => {
  const normal = harness();
  assert.equal(normal.render(false), null);
  assert.ok(button(normal.render(), "Install Ruined"));
  for (const variant of ["suggestion", "profile"]) {
    assert.equal(harness({ variant, standalone: true }).render(), null);
    assert.equal(harness({ variant, userAgent: "iPhone", iosStandalone: true }).render(), null);
  }
  normal.media.matches = true;
  normal.media.dispatch("change");
  assert.equal(normal.render(), null);
  normal.unmount();
});

test("desktop browsers never show or capture installation, including touch Windows and narrow-screen desktop UAs", () => {
  const desktops = [
    { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15" },
    { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0", maxTouchPoints: 10 },
    { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0", maxTouchPoints: 5 },
    { userAgent: "Mozilla/5.0 (X11; CrOS x86_64 16093.68.0) Chrome/130.0.0.0", maxTouchPoints: 10 },
    { userAgent: "Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1) Edge/15", maxTouchPoints: 5 },
  ];
  for (const variant of ["suggestion", "profile"]) for (const device of desktops) {
    const ui = harness({ ...device, variant });
    assert.equal(ui.render(), null, device.userAgent);
    let prevented = false, prompted = false;
    ui.window.dispatch("beforeinstallprompt", { preventDefault() { prevented = true; }, async prompt() { prompted = true; } });
    assert.equal(prevented, false); assert.equal(prompted, false);
    assert.equal(ui.window.count(), 0); assert.equal(ui.media.count(), 0);
    ui.unmount();
  }
});

test("iPhone, iPad, desktop-UA iPad and Android allow one mobile install interaction in either variant", async () => {
  for (const variant of ["suggestion", "profile"]) for (const device of [
    { userAgent: "iPhone Safari" }, { userAgent: "iPad Safari" },
    { userAgent: "Macintosh Safari", maxTouchPoints: 5 }, { userAgent: "Android Chrome" },
  ]) {
    const ui = harness({ ...device, variant });
    const install = button(ui.render(), "Install Ruined"); assert.ok(install);
    await install.props.onClick();
    assert.equal(ui.storage.get(HANDLED_KEY), "true", "the first click is persisted without waiting for installation");
    assert.equal(ui.storage.has(DISMISSAL_KEY), false, "a handled install is independent of a timed Not now choice");
    assert.equal(button(ui.render(), "Install Ruined"), undefined);
    assert.ok(button(ui.render(), "Done"));
    button(ui.render(), "Done").props.onClick(); assert.equal(ui.render(), null);
    assert.equal(ui.remount(), null, "route remounts do not restore the CTA");
    assert.equal(harness({ ...device, variant, storage: ui.storage, now: 2_800_000_000_000 }).render(), null, "later visits have no expiry");
    ui.unmount();
  }
});

test("manual iOS instructions remain usable until Done and replace the repeated install CTA", async () => {
  const ui = harness({ userAgent: "iPhone Safari", variant: "profile" });
  await button(ui.render(), "Install Ruined").props.onClick();
  const tree = ui.render();
  const steps = descendants(tree).filter(element => element.type === "li").map(text);
  assert.deepEqual(steps, ["Sign in to Ruined in Safari first.", "Tap Share, then Add to Home Screen.", "Keep Open as Web App on if shown, then tap Add."]);
  assert.match(text(tree), /may be asked to sign in once/);
  assert.equal(button(tree, "Install Ruined"), undefined);
  const region = descendants(tree).find(element => element.props.id === "install-instructions");
  assert.equal(region.props.tabIndex, -1, "manual steps can receive focus after the initiating CTA disappears");
  assert.ok(descendants(tree).some(element => element.props.id === region.props["aria-labelledby"]));
  button(tree, "Done").props.onClick(); assert.equal(ui.render(), null);
  ui.unmount();
});

test("native prompts open only on a click and persist handling before a pending result", async () => {
  const ui = harness({ variant: "profile" });
  let resolveChoice, prevented = 0, prompted = 0;
  const userChoice = new Promise(resolve => { resolveChoice = resolve; });
  ui.render();
  ui.window.dispatch("beforeinstallprompt", { preventDefault() { prevented++; }, async prompt() { prompted++; }, userChoice });
  assert.equal(prevented, 1); assert.equal(prompted, 0);
  const click = button(ui.render(), "Install Ruined").props.onClick;
  const pending = click(); await click();
  assert.equal(prompted, 1); assert.equal(ui.render(), null, "the CTA disappears while the browser handles installation");
  assert.equal(ui.storage.get(HANDLED_KEY), "true");
  assert.equal(harness({ variant: "profile", storage: ui.storage }).render(), null, "navigation or refresh during the prompt cannot restore the CTA");
  resolveChoice({ outcome: "accepted" }); await pending;
  assert.equal(ui.render(), null); ui.unmount();
});

test("dismissed, failed and inconclusive native prompts retain manual steps without recurring prompts", async () => {
  for (const outcome of ["dismissed", "failed", "inconclusive"]) for (const variant of ["suggestion", "profile"]) {
    const ui = harness({ variant }); ui.render(); let prompted = 0;
    const nativePrompt = { preventDefault() {}, async prompt() { prompted++; if (outcome === "failed") throw Error("Unavailable"); return outcome === "dismissed" ? { outcome } : undefined; } };
    ui.window.dispatch("beforeinstallprompt", nativePrompt);
    const click = button(ui.render(), "Install Ruined").props.onClick;
    await click();
    assert.equal(prompted, 1); assert.match(text(ui.render()), /Install app or Add to Home screen/);
    assert.equal(button(ui.render(), "Install Ruined"), undefined);
    ui.window.dispatch("beforeinstallprompt", nativePrompt); await click();
    assert.equal(prompted, 1, "neither a fresh event nor a stale click repeats the native installer");
    button(ui.render(), "Done").props.onClick(); assert.equal(ui.render(), null);
    assert.equal(harness({ variant, storage: ui.storage }).render(), null); ui.unmount();
  }
});

test("Android without a native prompt keeps manual steps for the current interaction", async () => {
  const ui = harness(); await button(ui.render(), "Install Ruined").props.onClick();
  assert.deepEqual(descendants(ui.render()).filter(element => element.type === "li").map(text), [
    "Sign in to Ruined in your browser first.",
    "Open the browser menu and choose Install app or Add to Home screen.",
    "Confirm, then open Ruined from its icon.",
  ]);
  button(ui.render(), "Done").props.onClick(); assert.equal(ui.render(), null); ui.unmount();
});

test("blocked storage cannot interrupt instructions or restore a handled CTA during the same visit", async () => {
  for (const variant of ["suggestion", "profile"]) {
    const ui = harness({ variant, storageError: true, userAgent: "iPhone" });
    await button(ui.render(), "Install Ruined").props.onClick();
    assert.match(text(ui.render()), /Add to Home Screen/);
    button(ui.render(), "Done").props.onClick(); assert.equal(ui.render(), null);
    assert.equal(ui.remount(), null, "the memory fallback survives route remounts even when writes are blocked");
    ui.unmount();
  }
  const ui = harness({ storageError: true }); ui.render();
  ui.window.dispatch("beforeinstallprompt", { preventDefault() {}, async prompt() { throw Error("Not allowed"); } });
  await button(ui.render(), "Install Ruined").props.onClick();
  assert.match(text(ui.render()), /Install app or Add to Home screen/);
  button(ui.render(), "Done").props.onClick(); assert.equal(ui.remount(), null); ui.unmount();
});

test("Not now keeps its thirty-day expiry and every variant honors the existing dismissal", () => {
  const now = 1_800_000_000_000, ui = harness({ now });
  button(ui.render(), "Not now").props.onClick(); assert.equal(ui.render(), null);
  assert.equal(ui.storage.has(HANDLED_KEY), false);
  for (const variant of ["suggestion", "profile"]) {
    assert.equal(harness({ variant, storage: ui.storage, now: now + 29 * 86_400_000 }).render(), null);
    assert.ok(button(harness({ variant, storage: ui.storage, now: now + 30 * 86_400_000 }).render(), "Install Ruined"));
  }
  const blocked = harness({ storageError: true });
  button(blocked.render(), "Not now").props.onClick(); assert.equal(blocked.render(), null);
  ui.unmount(); blocked.unmount();
});

test("external installation permanently handles the suggestion and unmount removes listeners", () => {
  const ui = harness(); ui.render();
  assert.equal(ui.window.count(), 2); assert.equal(ui.media.count(), 1);
  ui.window.dispatch("appinstalled"); assert.equal(ui.render(), null);
  assert.equal(ui.storage.get(HANDLED_KEY), "true");
  assert.equal(harness({ variant: "profile", storage: ui.storage, now: 2_800_000_000_000 }).render(), null);
  ui.unmount(); assert.equal(ui.window.count(), 0); assert.equal(ui.media.count(), 0);
});
