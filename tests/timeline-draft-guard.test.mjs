import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies, globals = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), compiled)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw Error(`Unexpected draft guard dependency: ${name}`);
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const { createTimelineDraftStore } = load("src/components/membership/MemberTimelineDraftState.tsx", { react: React });
const empty = { year: "", month: "", title: "", details: "" };
const draft = { year: "2026", month: "9", title: "An unfinished moment", details: "Private details" };
const state = overrides => ({ enabled: true, dirty: true, pending: false, form: draft, baseline: empty, editingEntryId: null, revision: "4", ...overrides });

class Target {
  listeners = new Map();
  addEventListener(name, callback, capture = false) {
    const values = this.listeners.get(name) ?? [];
    values.push({ callback, capture }); this.listeners.set(name, values);
  }
  removeEventListener(name, callback, capture = false) {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter(value => value.callback !== callback || value.capture !== capture));
  }
  dispatch(name, event) {
    for (const { callback } of this.listeners.get(name) ?? []) {
      callback(event);
      if (event.stopped) break;
    }
    return event;
  }
}
class Element {
  constructor(anchor) { this.anchor = anchor; }
  closest() { return this.anchor; }
}
function click(href, options = {}) {
  const anchor = { href, getAttribute: name => name === "target" ? options.target ?? null : null, hasAttribute: name => name === "download" && options.download === true };
  return { target: new Element(options.noAnchor ? null : anchor), button: 0, defaultPrevented: false, ...options,
    preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
}

function fixture(initial = state(), initialStore = createTimelineDraftStore("owner-a")) {
  const document = new Target(), window = new Target();
  window.location = { href: "https://members.example.test/my#timeline", origin: "https://members.example.test" };
  const confirmations = [];
  let confirmResult = false;
  window.confirm = message => { confirmations.push(message); return confirmResult; };
  const slots = [];
  let index = 0, changed = false, queued = [], currentState = initial, currentStore = initialStore, value;
  const same = (left, right) => left?.length === right?.length && left.every((item, position) => Object.is(item, right[position]));
  const hooks = {
    ...React,
    useRef(initialValue) { const key = index++; slots[key] ??= { current: initialValue }; return slots[key]; },
    useState(initialValue) {
      const key = index++;
      if (!(key in slots)) slots[key] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [slots[key], next => { const result = typeof next === "function" ? next(slots[key]) : next; changed ||= result !== slots[key]; slots[key] = result; }];
    },
    useEffect(callback, dependencies) {
      const key = index++;
      if (!slots[key] || !same(slots[key].dependencies, dependencies)) queued.push(() => {
        slots[key]?.cleanup?.();
        slots[key] = { dependencies, cleanup: callback() };
      });
    },
    useCallback(callback, dependencies) {
      const key = index++;
      if (!slots[key] || !same(slots[key].dependencies, dependencies)) slots[key] = { dependencies, callback };
      return slots[key].callback;
    },
  };
  const guard = load("src/components/membership/useTimelineDraftGuard.ts", {
    react: hooks,
    "./MemberTimelineDraftState": { useTimelineDraftStore: () => currentStore },
  }, { document, window, Element });
  function render(nextState = currentState, nextStore = currentStore) {
    currentState = nextState; currentStore = nextStore;
    let attempts = 0;
    do {
      assert.ok(attempts++ < 8, "draft effects should settle");
      index = 0; queued = []; changed = false;
      value = guard.default(currentState);
      for (const effect of queued) effect();
    } while (changed);
    return value;
  }
  return { render, document, window, confirmations, store: initialStore, allowLeave() { confirmResult = true; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); }, navigate: guard.timelineNavigationTarget };
}

test("dirty same-tab Next navigation can stay or leave without discarding the account-scoped checkpoint", () => {
  const view = fixture(); view.render();
  assert.equal(view.document.listeners.get("click")[0].capture, true);
  const staying = view.document.dispatch("click", click("https://members.example.test/my/circle"));
  assert.equal(staying.defaultPrevented, true); assert.equal(staying.stopped, true);
  assert.match(view.confirmations[0], /kept.*member area/);
  view.allowLeave();
  const leaving = view.document.dispatch("click", click("https://members.example.test/my/foundations/timeline"));
  assert.equal(leaving.defaultPrevented, false);
  assert.deepEqual(view.store.read().draft.form, draft);
  view.unmount();
  assert.equal(view.document.listeners.get("click").length, 0);
  assert.equal(view.window.listeners.get("beforeunload").length, 0);
  assert.deepEqual(view.store.read().draft.form, draft);
});

test("native document exit warns for dirty or pending work; external links get only the native prompt", () => {
  for (const current of [state(), state({ dirty: false, pending: true, form: empty })]) {
    const view = fixture(current); view.render();
    const external = view.document.dispatch("click", click("https://elsewhere.example/"));
    assert.equal(external.defaultPrevented, false);
    assert.equal(view.confirmations.length, 0);
    const unload = { preventDefault() { this.prevented = true; } };
    view.window.dispatch("beforeunload", unload);
    assert.equal(unload.prevented, true); assert.equal(unload.returnValue, "");
    assert.equal(view.store.read().draft.wasPending, current.pending);
    view.unmount();
  }
});

test("new tabs, downloads, modifier clicks, hash changes and clean/read-only pages keep native behavior", () => {
  const view = fixture(); view.render();
  for (const event of [
    click("https://members.example.test/my/circle", { target: "_blank" }),
    click("https://members.example.test/my/circle", { download: true }),
    ...["ctrlKey", "metaKey", "shiftKey", "altKey"].map(key => click("https://members.example.test/my/circle", { [key]: true })),
    click("https://members.example.test/my/circle", { button: 1 }),
    click("https://members.example.test/my/circle", { defaultPrevented: true }),
    click("https://members.example.test/my#journal"), click("mailto:member@example.test"),
    click("https://members.example.test/my/circle", { noAnchor: true }),
  ]) view.document.dispatch("click", event);
  assert.equal(view.confirmations.length, 0);
  for (const nextState of [state({ dirty: false }), state({ enabled: false })]) {
    view.render(nextState);
    assert.equal(view.document.dispatch("click", click("https://members.example.test/my/circle")).defaultPrevented, false);
    const unload = { preventDefault() { this.prevented = true; } };
    view.window.dispatch("beforeunload", unload);
    assert.equal(unload.prevented, undefined);
  }
  view.unmount();
});

test("route unmount and remount offer explicit recovery without restoring or saving automatically", () => {
  const view = fixture(state({ editingEntryId: "entry-id", pending: true })); view.render(); view.unmount();
  const returned = fixture(state({ dirty: false, form: empty, revision: "5" }), view.store);
  const recovery = returned.render();
  assert.deepEqual(recovery.recoveryDraft, { form: draft, baseline: empty, editingEntryId: "entry-id", revision: "4", wasPending: true });
  assert.deepEqual(returned.store.read().draft.form, draft);
  // The caller explicitly restores and then dismisses the older recovery.
  const dismissOldRecovery = recovery.dismissRecovery;
  returned.render(state({ form: { ...draft, title: "Restored and edited" }, revision: "5" }));
  dismissOldRecovery(); returned.render();
  assert.equal(returned.store.read().draft.form.title, "Restored and edited", "dismissing recovery must not clear the new page's checkpoint");
  returned.unmount();
});

test("confirmed save/cancel clears the draft even if navigation unmounts before the next render", () => {
  const view = fixture();
  view.render().clearDraft();
  view.render(state({ form: { ...draft }, baseline: { ...empty } }));
  assert.equal(view.store.read(), null, "a parent rerender with equivalent field values cannot recreate a cleared draft");
  view.unmount();
  assert.equal(view.store.read(), null);
  const returned = fixture(state({ dirty: false, form: empty }), view.store);
  assert.equal(returned.render().recoveryDraft, null);
  returned.unmount();
});

test("after clearing, a later edit receives a new protected checkpoint", () => {
  const view = fixture();
  view.render().clearDraft();
  view.render(state({ form: { ...draft, title: "A new unfinished moment" } }));
  assert.equal(view.store.read().draft.form.title, "A new unfinished moment");
  const navigation = view.document.dispatch("click", click("https://members.example.test/my/circle"));
  assert.equal(navigation.defaultPrevented, true);
  view.unmount();
});

test("account changes and independent layouts cannot read, clear or revive another account's draft", () => {
  const old = fixture(); const oldActions = old.render();
  const otherStore = createTimelineDraftStore("owner-b");
  const otherWriter = Symbol("other");
  const otherDraft = { form: { ...draft, title: "Other member" }, baseline: empty, editingEntryId: null, revision: "2", wasPending: false };
  otherStore.write(otherWriter, otherDraft);
  const current = old.render(state({ dirty: false, form: empty }), otherStore);
  assert.equal(current.recoveryDraft.form.title, "Other member");
  oldActions.clearDraft(); oldActions.dismissRecovery();
  assert.equal(old.render().recoveryDraft.form.title, "Other member");
  assert.equal(otherStore.read().draft.form.title, "Other member");
  assert.equal(createTimelineDraftStore("owner-a").read(), null, "a new layout cannot recover private drafts from an old layout");
  const unverified = createTimelineDraftStore();
  unverified.write(Symbol("anonymous"), otherDraft);
  assert.equal(unverified.read(), null);
  old.unmount();
});

test("stored drafts are copied and an old page cannot clear a newer writer", () => {
  const store = createTimelineDraftStore("owner-a"), first = Symbol("first"), second = Symbol("second");
  const snapshot = { form: { ...draft }, baseline: { ...empty }, editingEntryId: null, revision: "1", wasPending: false };
  store.write(first, snapshot); snapshot.form.title = "Mutated caller";
  assert.equal(store.read().draft.form.title, draft.title);
  store.read().draft.form.title = "Mutated reader";
  assert.equal(store.read().draft.form.title, draft.title);
  store.write(second, snapshot); store.clear(first);
  assert.equal(store.read().writer, second);
});

test("provider keeps the mounted member scope during outages and replaces it on verified account changes", () => {
  let stateValue, changed = false;
  const provider = load("src/components/membership/MemberTimelineDraftState.tsx", { react: {
    ...React,
    useState(initial) {
      stateValue ??= initial();
      return [stateValue, next => { changed = true; stateValue = next; }];
    },
  } }).default;
  const children = React.createElement("form", { "data-private-draft": "member-a" });
  const render = (ownerId, temporarilyUnavailable = false) => {
    let node, attempts = 0;
    do {
      assert.ok(attempts++ < 5);
      changed = false;
      node = provider({ ownerId, temporarilyUnavailable, children });
    } while (changed);
    return node;
  };
  const first = render("owner-a");
  first.props.value.write(Symbol("draft-a"), { ...state(), wasPending: false });
  const unavailable = render(undefined, true);
  assert.equal(unavailable.key, first.key);
  assert.equal(unavailable.props.value, first.props.value);
  assert.equal(unavailable.props.children, children);
  assert.deepEqual(unavailable.props.value.read().draft.form, draft);
  assert.equal(render("owner-a").props.value, first.props.value);
  const other = render("owner-b");
  assert.notEqual(other.key, first.key, "a verified owner change remounts the private form subtree");
  assert.equal(other.props.value.read(), null);
  first.props.value.write(Symbol("late-old-callback"), { ...state(), wasPending: true });
  assert.equal(other.props.value.read(), null);
  const returned = render("owner-a");
  assert.notEqual(returned.props.value, first.props.value);
  assert.equal(returned.props.value.read(), null, "A to B to A never revives the previous owner's scope");
  returned.props.value.write(Symbol("new-a"), { ...state(), wasPending: false });
  const signedOut = render(undefined);
  assert.notEqual(signedOut.key, returned.key);
  assert.equal(signedOut.props.value.read(), null);
  assert.equal(render("owner-a").props.value.read(), null);
});

test("read-only or preview timelines never expose a saved recovery draft", () => {
  const store = createTimelineDraftStore("owner-a");
  store.write(Symbol("earlier-page"), { ...state(), wasPending: false });
  const view = fixture(state({ enabled: false }), store);
  assert.equal(view.render().recoveryDraft, null);
  assert.equal(view.document.listeners.get("click"), undefined);
  assert.equal(view.window.listeners.get("beforeunload"), undefined);
  view.unmount();
});
