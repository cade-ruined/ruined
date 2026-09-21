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
      tree = loaded.exports.default({ className: "shell-install" });
      if (flushEffects) while (effects.length) effects.shift()();
      assert.ok(++passes < 10, "effects should settle");
    } while (flushEffects && changed);
    return tree;
  }
  return { render, window, media, storage, unmount: () => { for (const hook of hooks) hook?.cleanup?.(); } };
}

test("the suggestion waits for client detection and stays absent in standalone apps", () => {
  const normal = harness();
  assert.equal(normal.render(false), null);
  assert.ok(button(normal.render(), "Install Ruined"));
  assert.equal(harness({ standalone: true }).render(), null);
  assert.equal(harness({ userAgent: "iPhone", iosStandalone: true }).render(), null);
  normal.media.matches = true;
  normal.media.dispatch("change");
  assert.equal(normal.render(), null);
});

test("iPhone and iPad desktop user agents receive sign-in-first Safari instructions without a native prompt", async () => {
  for (const options of [{ userAgent: "iPhone Safari" }, { userAgent: "Macintosh Safari", maxTouchPoints: 5 }]) {
    const ui = harness(options);
    await button(ui.render(), "Install Ruined").props.onClick();
    const tree = ui.render();
    const steps = descendants(tree).filter(element => element.type === "li").map(text);
    assert.deepEqual(steps, ["Sign in to Ruined in Safari first.", "Tap Share, then Add to Home Screen.", "Keep Open as Web App on if shown, then tap Add."]);
    assert.match(text(tree), /may be asked to sign in once/);
    const control = button(tree, "Install Ruined");
    assert.equal(control.props["aria-expanded"], true);
    assert.ok(descendants(tree).some(element => element.props.id === control.props["aria-controls"]));
  }
});

test("Android captures the native install event but prompts only on a click, once", async () => {
  const ui = harness();
  ui.render();
  let prevented = 0, prompted = 0;
  ui.window.dispatch("beforeinstallprompt", { preventDefault() { prevented++; }, async prompt() { prompted++; }, userChoice: Promise.resolve({ outcome: "dismissed" }) });
  assert.equal(prevented, 1);
  assert.equal(prompted, 0);
  await button(ui.render(), "Install Ruined").props.onClick();
  assert.equal(prompted, 1);
  assert.match(text(ui.render()), /Install app or Add to Home screen/);
  await button(ui.render(), "Install Ruined").props.onClick();
  assert.equal(prompted, 1, "the saved event cannot be reused");
});

test("a pending native prompt cannot be opened twice and accepting remembers the result", async () => {
  const ui = harness();
  let resolveChoice, prompted = 0;
  const userChoice = new Promise(resolve => { resolveChoice = resolve; });
  ui.render();
  ui.window.dispatch("beforeinstallprompt", { preventDefault() {}, async prompt() { prompted++; }, userChoice });
  const click = button(ui.render(), "Install Ruined").props.onClick;
  const first = click();
  await click();
  assert.equal(prompted, 1);
  assert.equal(button(ui.render(), "Opening…").props.disabled, true);
  resolveChoice({ outcome: "accepted" });
  await first;
  assert.equal(ui.render(), null);
  assert.equal(harness({ storage: ui.storage }).render(), null);
});

test("missing or failed native installation leaves usable manual steps", async () => {
  const ui = harness();
  await button(ui.render(), "Install Ruined").props.onClick();
  assert.match(text(ui.render()), /browser menu/);
  ui.window.dispatch("beforeinstallprompt", { preventDefault() {}, async prompt() { throw new Error("Not allowed"); } });
  await button(ui.render(), "Install Ruined").props.onClick();
  assert.match(text(ui.render()), /Install app or Add to Home screen/);
  assert.equal(button(ui.render(), "Install Ruined").props.disabled, false);
  const desktop = harness({ userAgent: "Macintosh Safari" });
  await button(desktop.render(), "Install Ruined").props.onClick();
  assert.match(text(desktop.render()), /File → Add to Dock/);
});

test("dismissal survives revisits for thirty days and blocked storage still permits dismissal", () => {
  const now = 1_800_000_000_000, ui = harness({ now });
  button(ui.render(), "Not now").props.onClick();
  assert.equal(ui.render(), null);
  assert.equal(harness({ storage: ui.storage, now: now + 29 * 86_400_000 }).render(), null);
  assert.ok(button(harness({ storage: ui.storage, now: now + 30 * 86_400_000 }).render(), "Install Ruined"));
  const blocked = harness({ storageError: true });
  button(blocked.render(), "Not now").props.onClick();
  assert.equal(blocked.render(), null);
});

test("external installation hides the suggestion and unmount removes all listeners", () => {
  const ui = harness();
  ui.render();
  assert.equal(ui.window.count(), 2);
  assert.equal(ui.media.count(), 1);
  ui.window.dispatch("appinstalled");
  assert.equal(ui.render(), null);
  assert.equal(harness({ storage: ui.storage }).render(), null);
  ui.unmount();
  assert.equal(ui.window.count(), 0);
  assert.equal(ui.media.count(), 0);
});
