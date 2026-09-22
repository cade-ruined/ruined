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
const draftModule = load("src/components/membership/MemberJournalDraftState.tsx", { react: React });
const { createJournalDraftStore, copyJournalDraft } = draftModule;
const photo = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
const uploadedPhoto = new File(["already uploaded"], "second.jpg", { type: "image/jpeg" });
const empty = { kind: "text", title: "", body: "", eventYear: "", eventMonth: "", eventDay: "", includeOnTimeline: false, files: [], keptMedia: [], editingId: null, editingVersion: null, attempted: false, draftId: "", uploadIds: [] };
const draft = { ...empty, kind: "images", title: "An unfinished entry", body: "Private details", eventYear: "2026", eventMonth: "9", eventDay: "22", includeOnTimeline: true,
  files: [photo, uploadedPhoto], keptMedia: [{ id: "media-1", mimeType: "image/jpeg", size: 8, url: "/api/my/journal/media/media-1" }],
  editingId: "entry-1", editingVersion: "7", attempted: true, draftId: "stable-entry-id", uploadIds: [[uploadedPhoto, "reserved-upload-id"]] };
const state = overrides => ({ enabled: true, dirty: true, pending: false, draft: copyJournalDraft(draft), ...overrides });

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

function fixture(initial = state(), initialStore = createJournalDraftStore("owner-a")) {
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
  const guard = load("src/components/membership/useJournalDraftGuard.ts", {
    react: hooks,
    "./MemberJournalDraftState": { copyJournalDraft, useJournalDraftStore: () => currentStore },
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
    unmount() { for (const slot of slots) slot?.cleanup?.(); }, navigate: guard.journalNavigationTarget };
}

test("dirty internal member navigation is confirmed before Next and keeps the entire media draft", () => {
  const view = fixture(); view.render();
  assert.equal(view.document.listeners.get("click")[0].capture, true);
  const staying = view.document.dispatch("click", click("https://members.example.test/my/circle"));
  assert.equal(staying.defaultPrevented, true); assert.equal(staying.stopped, true);
  assert.match(view.confirmations[0], /kept.*member area/);
  view.allowLeave();
  assert.equal(view.document.dispatch("click", click("https://members.example.test/my/circle")).defaultPrevented, false);
  assert.deepEqual(view.store.read().draft, { ...draft, wasPending: false });
  assert.equal(view.store.read().draft.files[0], photo);
  assert.equal(view.store.read().draft.uploadIds[0][0], uploadedPhoto);
  view.unmount();
  assert.equal(view.document.listeners.get("click").length, 0);
  assert.equal(view.window.listeners.get("beforeunload").length, 0);
  assert.deepEqual(view.store.read().draft.keptMedia, draft.keptMedia);
});

test("unload and pending-only saves protect the draft; external navigation gets the native prompt", () => {
  for (const current of [state(), state({ dirty: false, pending: true })]) {
    const view = fixture(current); view.render();
    const external = view.document.dispatch("click", click("https://elsewhere.example/"));
    assert.equal(external.defaultPrevented, false); assert.equal(view.confirmations.length, 0);
    const unload = { preventDefault() { this.prevented = true; } };
    view.window.dispatch("beforeunload", unload);
    assert.equal(unload.prevented, true); assert.equal(unload.returnValue, "");
    assert.equal(view.store.read().draft.wasPending, current.pending);
    if (current.pending) {
      view.document.dispatch("click", click("https://members.example.test/my/circle"));
      assert.match(view.confirmations[0], /still saving.*Check your saved entries/);
    }
    view.unmount();
  }
});

test("internal view hashes, new tabs, downloads and modified clicks do not interrupt writing", () => {
  const view = fixture(); view.render();
  for (const event of [
    click("https://members.example.test/my/circle", { target: "_blank" }),
    click("https://members.example.test/my/circle", { download: true }),
    ...["ctrlKey", "metaKey", "shiftKey", "altKey"].map(key => click("https://members.example.test/my/circle", { [key]: true })),
    click("https://members.example.test/my/circle", { button: 1 }),
    click("https://members.example.test/my/circle", { defaultPrevented: true }),
    ...["journal", "timeline", "saved", "about"].map(hash => click(`https://members.example.test/my#${hash}`)),
    click("mailto:member@example.test"), click("https://members.example.test/my/circle", { noAnchor: true }),
  ]) view.document.dispatch("click", event);
  assert.equal(view.confirmations.length, 0);
  for (const next of [state({ dirty: false }), state({ enabled: false })]) {
    view.render(next);
    assert.equal(view.document.dispatch("click", click("https://members.example.test/my/circle")).defaultPrevented, false);
  }
  view.unmount();
});

test("route remount offers explicit recovery with media, occurrence precision and stable retry identifiers", () => {
  const view = fixture(state({ pending: true })); view.render(); view.unmount();
  const returned = fixture(state({ dirty: false, draft: empty }), view.store);
  const recovery = returned.render();
  assert.deepEqual(recovery.recoveryDraft, { ...draft, wasPending: true });
  assert.equal(recovery.recoveryDraft.files[0], photo);
  assert.equal(recovery.recoveryDraft.uploadIds[0][0], uploadedPhoto);
  assert.equal(recovery.recoveryDraft.editingVersion, "7");
  assert.equal(recovery.recoveryDraft.draftId, "stable-entry-id");
  const dismissOld = recovery.dismissRecovery;
  returned.render(state({ draft: { ...draft, title: "Restored and edited", editingVersion: "8" } }));
  dismissOld(); returned.render();
  assert.equal(returned.store.read().draft.title, "Restored and edited", "dismissing old recovery must preserve the newer writer");
  returned.unmount();
});

test("confirmed save or discard clears the draft even before another render or route unmount", () => {
  const view = fixture(); view.render().clearDraft();
  view.render(state());
  assert.equal(view.store.read(), null, "equivalent copied draft must not revive after clearing");
  view.unmount(); assert.equal(view.store.read(), null);
  const returned = fixture(state({ dirty: false, draft: empty }), view.store);
  assert.equal(returned.render().recoveryDraft, null); returned.unmount();
});

test("new metadata, media, date, or upload changes after clearing create a protected checkpoint", () => {
  for (const change of [
    { title: "Later title" }, { body: "Later body" }, { eventYear: "2025" }, { eventMonth: "" }, { eventDay: "" },
    { includeOnTimeline: false }, { kind: "video" }, { attempted: false }, { draftId: "different-id" },
    { editingId: "entry-2" }, { editingVersion: "8" }, { files: [photo] },
    { keptMedia: [{ ...draft.keptMedia[0], url: "/changed" }] }, { uploadIds: [[uploadedPhoto, "new-upload-id"]] },
  ]) {
    const view = fixture(); view.render().clearDraft();
    view.render(state({ draft: { ...draft, ...change } }));
    assert.deepEqual(view.store.read().draft, { ...draft, ...change, wasPending: false });
    assert.equal(view.document.dispatch("click", click("https://members.example.test/my/circle")).defaultPrevented, true);
    view.unmount();
  }
});

test("memory snapshots isolate mutable arrays, media objects and upload tuples while retaining immutable File bytes", () => {
  const store = createJournalDraftStore("owner-a"), first = Symbol("first"), second = Symbol("second");
  const snapshot = { ...copyJournalDraft(draft), wasPending: true };
  store.write(first, snapshot);
  snapshot.title = "Mutated caller"; snapshot.files.pop(); snapshot.keptMedia[0].url = "/changed"; snapshot.uploadIds[0][1] = "changed";
  assert.deepEqual(store.read().draft, { ...draft, wasPending: true });
  const read = store.read().draft; read.files.length = 0; read.keptMedia[0].id = "changed"; read.uploadIds[0][1] = "changed";
  assert.deepEqual(store.read().draft, { ...draft, wasPending: true });
  assert.equal(store.read().draft.files[0], photo); assert.equal(store.read().draft.uploadIds[0][0], uploadedPhoto);
  store.write(second, snapshot); store.clear(first); assert.equal(store.read().writer, second);
});

test("account changes and independent layouts cannot read or clear another member's recovery", () => {
  const view = fixture(), oldActions = view.render(), other = createJournalDraftStore("owner-b");
  other.write(Symbol("other"), { ...copyJournalDraft(draft), title: "Other member", wasPending: false });
  assert.equal(view.render(state({ dirty: false, draft: empty }), other).recoveryDraft.title, "Other member");
  oldActions.clearDraft(); oldActions.dismissRecovery();
  assert.equal(view.render().recoveryDraft.title, "Other member");
  assert.equal(other.read().draft.title, "Other member");
  assert.equal(createJournalDraftStore("owner-a").read(), null);
  const unverified = createJournalDraftStore(); unverified.write(Symbol("anonymous"), { ...draft, wasPending: true });
  assert.equal(unverified.read(), null); view.unmount();
});

test("provider retains Files across temporary outages and remounts cleanly on A to B to A or logout", () => {
  let stateValue, changed = false;
  const provider = load("src/components/membership/MemberJournalDraftState.tsx", { react: { ...React,
    useState(initial) { stateValue ??= initial(); return [stateValue, next => { changed = true; stateValue = next; }]; },
  } }).default;
  const children = React.createElement("form");
  const render = (ownerId, temporarilyUnavailable = false) => {
    let node, attempts = 0;
    do { assert.ok(attempts++ < 5); changed = false; node = provider({ ownerId, temporarilyUnavailable, children }); } while (changed);
    return node;
  };
  const first = render("owner-a"); first.props.value.write(Symbol("draft-a"), { ...copyJournalDraft(draft), wasPending: false });
  const outage = render(undefined, true);
  assert.equal(outage.key, first.key); assert.equal(outage.props.value, first.props.value); assert.equal(outage.props.children, children);
  assert.equal(outage.props.value.read().draft.files[0], photo);
  assert.equal(render("owner-a").props.value, first.props.value);
  const other = render("owner-b"); assert.notEqual(other.key, first.key); assert.equal(other.props.value.read(), null);
  first.props.value.write(Symbol("late-old-callback"), { ...draft, wasPending: true }); assert.equal(other.props.value.read(), null);
  const returned = render("owner-a"); assert.notEqual(returned.props.value, first.props.value); assert.equal(returned.props.value.read(), null);
  returned.props.value.write(Symbol("new-a"), { ...draft, wasPending: false });
  const signedOut = render(undefined); assert.notEqual(signedOut.key, returned.key); assert.equal(signedOut.props.value.read(), null);
  assert.equal(render("owner-a").props.value.read(), null);
});

test("read-only and preview Journals expose no recovery and install no draft listeners", () => {
  const store = createJournalDraftStore("owner-a"); store.write(Symbol("previous"), { ...draft, wasPending: false });
  const view = fixture(state({ enabled: false }), store);
  assert.equal(view.render().recoveryDraft, null);
  assert.equal(view.document.listeners.get("click"), undefined); assert.equal(view.window.listeners.get("beforeunload"), undefined);
  view.unmount();
});
