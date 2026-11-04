import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadDependency(path) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} }; new Function("require", "module", "exports", code)(require, loadedModule, loadedModule.exports); return loadedModule.exports;
}
const model = loadDependency("src/lib/practice/model.ts");
const { createPracticeDraftStore } = loadDependency("src/components/membership/MemberPracticeDraftState.tsx");
const output = ts.transpileModule(readFileSync(new URL("../src/components/membership/MemberPractice.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const owner = "11111111-1111-4111-8111-111111111111";
const snapshot = overrides => ({ ...model.previewPracticeSnapshot(new Date("2026-11-04T12:00:00Z")), ownerId: owner, canWrite: true, ...overrides });
const resolve = node => Array.isArray(node) ? node.map(resolve) : !React.isValidElement(node) ? node : typeof node.type === "function" ? resolve(node.type(node.props)) : React.cloneElement(node, {}, resolve(node.props.children));
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join("") : React.isValidElement(node) ? text(node.props.children) : node == null || typeof node === "boolean" ? "" : String(node);

function fixture({ initial = snapshot(), initialArea, initialCourse, connected = true, handle, getSnapshot, draftStore = createPracticeDraftStore(owner) } = {}) {
  const hooks = [], effects = [], timers = new Map(), requests = [], navigations = [], events = [];
  let cursor = 0, timerId = 0, server = structuredClone(initial), tree;
  const react = { ...React,
    useState(value) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof value === "function" ? value() : value; return [hooks[index], next => { hooks[index] = typeof next === "function" ? next(hooks[index]) : next; }]; },
    useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
    useCallback(callback, deps) { const index = cursor++, previous = hooks[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) hooks[index] = { value: callback, deps }; return hooks[index].value; },
    useEffect(callback, deps = []) { const index = cursor++, previous = hooks[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) { const effect = { deps, callback }; hooks[index] = effect; effects.push(() => { previous?.cleanup?.(); effect.cleanup = callback(); }); } },
  };
  const response = data => ({ ok: true, status: 200, json: async () => structuredClone(data) });
  const apply = request => {
    assert.equal(request.ownerId, owner);
    assert.equal(request.expectedRevision, server.revision);
    server.revision = String(Number(server.revision) + 1);
    if (request.action === "save_timeline_draft") server.timelineDraft = structuredClone(request.fields);
    if (request.action === "keep_timeline_entry") {
      assert.equal(request.expectedTimelineRevision, server.timeline.revision);
      const id = request.fields.id ?? `22222222-2222-4222-8222-${String(server.timeline.entries.length + 1).padStart(12, "0")}`;
      const entry = { ...request.fields, id, position: server.timeline.entries.length + 1 };
      server.timeline.entries = [...server.timeline.entries.filter(entry => entry.id !== id), entry];
      server.timeline.revision = String(Number(server.timeline.revision) + 1);
      server.timeline.completeEntryIds = server.timeline.entries.filter(entry => entry.title && entry.meaning && entry.presentImpact).map(entry => entry.id);
      server.timelineDraft = null;
      server.lastTimelineEntryId = id;
      const completed = server.timeline.entries.filter(entry => entry.title && entry.meaning && entry.presentImpact).length;
      server.badges.f1 = { earned: completed >= 3, earnedAt: completed >= 3 ? "2026-11-05T23:00:00Z" : null, completed: Math.min(3, completed), target: 3 };
    }
    if (request.action.includes("letter")) server.letter = { ...request.fields, keptAt: request.action === "keep_letter" ? "2026-11-30T23:00:00Z" : null };
    if (request.action === "keep_letter") server.badges.f4 = { earned: true, earnedAt: server.letter.keptAt, completed: 1, target: 1 };
    if (request.action.includes("time")) {
      if (request.action === "save_time" || request.action === "keep_time") {
        server.time = { ...request.fields, keptAt: request.action === "keep_time" ? "2026-12-01T20:00:00Z" : null };
        server.badges.time = { earned: request.action === "keep_time", earnedAt: server.time.keptAt, completed: request.action === "keep_time" ? 2 : request.fields.action ? 1 : 0, target: 2 };
      }
    }
    return response(server);
  };
  const fetch = async (url, options = {}) => {
    assert.equal(url, "/api/my/practice", "Practice work never uses the public journal composer");
    assert.equal(options.headers["x-ruined-session-owner"], owner);
    if (options.method !== "POST") return getSnapshot ? getSnapshot(server, response) : response(server);
    const request = JSON.parse(options.body); requests.push(request);
    return handle ? handle(request, { apply, server, response }) : apply(request);
  };
  const windowListeners = new Map(), documentListeners = new Map();
  const window = { setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); }, addEventListener(type, callback) { windowListeners.set(type, callback); }, removeEventListener(type) { windowListeners.delete(type); }, dispatchEvent(event) { events.push(event.type); }, history: { state: {}, replaceState(_state, _title, url) { navigations.push(url); } }, location: { href: "https://members.test/my/practice", assign(url) { navigations.push(url); } } };
  const document = { addEventListener(type, callback) { documentListeners.set(type, callback); }, removeEventListener(type) { documentListeners.delete(type); } };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "document", "fetch", "CustomEvent", output)(name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/lib/practice/model") return model;
    if (name === "./MemberPracticeDraftState") return { usePracticeDraftStore: () => draftStore };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, property) => property }) };
    throw Error(`Unexpected Practice dependency: ${name}`);
  }, loaded, loaded.exports, window, document, fetch, class CustomEvent { constructor(type) { this.type = type; } });
  const render = () => { cursor = 0; tree = resolve(loaded.exports.default({ initial, connected, initialArea, initialCourse })); for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = { focus() {} }; effects.splice(0).forEach(effect => effect()); return tree; };
  const find = predicate => { const found = nodes(render()).find(predicate); assert.ok(found, "Expected matching Practice element"); return found; };
  const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); render(); };
  const button = label => find(node => node.type === "button" && text(node) === label);
  const click = async label => { const node = button(label); assert.equal(Boolean(node.props.disabled), false, `${label} should be enabled`); node.props.onClick(); await settle(); };
  const change = (id, value) => { find(node => node.props.id === id).props.onChange({ target: { value } }); render(); };
  const autosave = async () => { render(); for (const [id, timer] of [...timers]) if (timer.delay === 700) { timers.delete(id); timer.callback(); } await settle(); };
  render();
  const clickShellLink = href => { const event = { button: 0, defaultPrevented: false, target: { closest: () => ({ href, target: "", hasAttribute: () => false }) }, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } }; documentListeners.get("click")?.(event); return event; };
  return { render, find, button, click, change, autosave, settle, requests, navigations, events, draftStore, clickShellLink, server: () => server, focus: () => windowListeners.get("focus")?.(), back: () => windowListeners.get("popstate")?.(), strictEffects: () => { hooks.forEach(hook => hook?.cleanup?.()); hooks.forEach(hook => { if (hook?.callback) hook.cleanup = hook.callback(); }); }, unmount: () => hooks.forEach(hook => hook?.cleanup?.()) };
}

test("Practice keeps Foundations and Monthly separate, future assignments visible and locked", async () => {
  const ui = fixture();
  assert.equal(nodes(ui.render()).filter(node => node.props["aria-label"] === "Locked").length, 3);
  assert.match(text(ui.render()), /Foundations 2Assignment to be announced/);
  assert.match(text(ui.render()), /Foundations 4A letter to your future self/);
  assert.equal(nodes(ui.render()).filter(node => node.type === "button" && text(node) === "Continue →").length, 1);
  await ui.click("Monthly");
  assert.match(text(ui.render()), /TIME \/ DecemberMake room in MY 168Opens December 1/);
  assert.equal(nodes(ui.render()).some(node => node.type === "button" && text(node) === "Continue →"), false);
  assert.equal(ui.requests.length, 0);
  ui.unmount();
});

test("F1 saves partial writing to the account and keeps a complete entry only after all four questions", async () => {
  const ui = fixture({ initialCourse: "f1" });
  await ui.click("Add an entry →");
  assert.match(text(ui.render()), /When was this\?/);
  ui.change("practice-year", "2008"); await ui.autosave();
  assert.equal(ui.server().timelineDraft.year, 2008);
  assert.equal(ui.server().timeline.entries.length, 0);
  await ui.click("Continue →");
  ui.change("practice-event", "Moved to a new city");
  await ui.click("Continue →");
  assert.equal(ui.server().timelineDraft.title, "Moved to a new city");
  assert.equal(nodes(ui.render()).filter(node => node.type === "textarea").length, 1);
  ui.change("practice-reflection", "I had to do everything alone.");
  await ui.click("Continue →");
  ui.change("practice-reflection", "I stopped asking for help.");
  await ui.click("Keep entry →");
  assert.equal(ui.server().timeline.entries.length, 1);
  assert.equal(ui.server().timelineDraft, null);
  assert.equal(ui.server().badges.f1.earned, false);
  assert.equal(ui.requests.at(-1).action, "keep_timeline_entry");
  assert.equal(ui.requests.at(-1).expectedTimelineRevision, "0");
  assert.ok(ui.events.includes("ruined:member-progress"));
  assert.match(text(ui.render()), /1 \/ 3timeline entries/);
  ui.unmount();
});

test("saved partial work resumes on another visit and a deck remains a separate resource", async () => {
  const draft = { id: null, year: 2016, title: "Started over", details: "", meaning: "", presentImpact: "" };
  const ui = fixture({ initial: snapshot({ timelineDraft: draft }), initialCourse: "f1" });
  assert.ok(ui.button("View deck ↗"));
  assert.equal(nodes(ui.render()).some(node => node.type === "textarea"), false);
  await ui.click("Continue entry →");
  assert.match(text(ui.render()), /What did I make it mean\?/);
  ui.change("practice-reflection", "I could begin again.");
  await ui.click("← Assignment");
  assert.equal(ui.server().timelineDraft.meaning, "I could begin again.");
  await ui.click("View deck ↗");
  assert.equal(ui.navigations.at(-1), "/my/practice/deck/f1");
  assert.equal(ui.server().badges.f1.earned, false);
  ui.unmount();
});

test("an uncertain save blocks advancement, keeps the open draft and reconciles before retry", async () => {
  let fail = true;
  const ui = fixture({ initialCourse: "f1", handle(request, { apply }) { const response = apply(request); if (fail) { fail = false; throw Error("Connection interrupted"); } return response; } });
  await ui.click("Add an entry →"); ui.change("practice-year", "2012"); await ui.autosave();
  assert.equal(ui.button("Continue →").props.disabled, true);
  assert.equal(ui.requests.length, 1);
  await ui.click("Check saved work");
  assert.equal(ui.button("Continue →").props.disabled, false);
  await ui.click("Continue →");
  assert.equal(ui.requests.length, 1, "confirmed save is adopted without a duplicate mutation");
  ui.unmount();
});

test("a lost Keep response adopts the canonical entry rather than adding it twice", async () => {
  const draft = { id: null, year: 2014, title: "A turning point", details: "", meaning: "I had more choice.", presentImpact: "I began making room." };
  const ui = fixture({ initial: snapshot({ timelineDraft: draft }), initialCourse: "f1", handle(request, { apply }) { const response = apply(request); if (request.action === "keep_timeline_entry") throw Error("Connection interrupted"); return response; } });
  await ui.click("Continue entry →");
  await ui.click("Continue →"); await ui.click("Continue →"); await ui.click("Continue →");
  await ui.click("Keep entry →");
  assert.equal(ui.server().timeline.entries.length, 1);
  await ui.click("Check saved work");
  assert.match(text(ui.render()), /Your entry was saved/);
  assert.equal(ui.server().timeline.entries.length, 1);
  assert.equal(ui.requests.filter(request => request.action === "keep_timeline_entry").length, 1);
  assert.equal(ui.server().timelineDraft, null);
  ui.unmount();
});

test("TIME guides a single funded plan without requiring a full 168-hour schedule", async () => {
  const initial = snapshot(); initial.releases.time = true;
  const ui = fixture({ initial, initialCourse: "time" });
  await ui.click("Start assignment →");
  ui.change("practice-action", "Walk outside after lunch"); await ui.click("Continue →");
  assert.equal(ui.server().time.action, "Walk outside after lunch");
  assert.equal(ui.server().badges.time.earned, false);
  ui.change("practice-category", "health"); await ui.click("Continue →");
  ui.change("practice-minutes", "90"); await ui.click("Continue →");
  ui.change("practice-category", "media"); await ui.click("Continue →");
  ui.change("practice-minutes", "180"); await ui.click("Continue →");
  assert.match(text(ui.render()), /1h 30m each week for health, from phone \/ social \/ media/);
  await ui.click("Keep my plan →");
  assert.equal(ui.server().badges.time.earned, true);
  assert.deepEqual(ui.requests.at(-1).fields, { action: "Walk outside after lunch", category: "health", minutes: 90, sourceCategory: "media", sourceMinutes: 180 });
  assert.match(text(ui.render()), /TIME Badge earned/);
  ui.unmount();
});

test("the letter saves privately as a draft and earns F4 only on Keep", async () => {
  const initial = snapshot(); initial.releases.f4 = true;
  const ui = fixture({ initial, initialCourse: "f4" });
  await ui.click("Write my letter →"); ui.change("practice-letter", "Remember what matters."); await ui.autosave();
  assert.equal(ui.server().letter.body, "Remember what matters.");
  assert.equal(ui.server().letter.keptAt, null);
  assert.equal(ui.server().badges.f4.earned, false);
  await ui.click("Keep my letter →");
  assert.equal(ui.server().badges.f4.earned, true);
  assert.match(text(ui.render()), /F4 Badge earned/);
  ui.unmount();
});

test("preview and locked deep links never send account writes", async () => {
  const preview = fixture({ connected: false, initialCourse: "f1" });
  assert.equal(preview.button("Add an entry →").props.disabled, true);
  assert.equal(preview.requests.length, 0);
  preview.unmount();
  const locked = fixture({ initialCourse: "time" });
  assert.match(text(locked.render()), /Opens December 1/);
  assert.equal(nodes(locked.render()).some(node => node.type === "button" && text(node) === "Start assignment →"), false);
  assert.equal(nodes(locked.render()).some(node => node.type === "button" && text(node) === "View deck ↗"), false);
  assert.equal(locked.requests.length, 0);
  locked.unmount();
});

test("a released TBD assignment keeps its full deck available without inventing work", async () => {
  const initial = snapshot(); initial.releases.f2 = true;
  const ui = fixture({ initial, initialCourse: "f2" });
  assert.match(text(ui.render()), /Assignment to be announced/);
  assert.equal(nodes(ui.render()).some(node => node.type === "textarea" || node.type === "input"), false);
  await ui.click("View deck ↗");
  assert.equal(ui.navigations.at(-1), "/my/practice/deck/f2");
  assert.equal(ui.requests.length, 0);
  ui.unmount();
});

test("rapid typing then a shell link waits for every serialized account save", async () => {
  let releaseFirst;
  const ui = fixture({ initialCourse: "f1", handle(request, { apply }) {
    if (!releaseFirst) return new Promise(resolve => { releaseFirst = () => resolve(apply(request)); });
    return apply(request);
  } });
  await ui.click("Add an entry →");
  ui.change("practice-year", "2008"); await ui.autosave();
  ui.change("practice-year", "2010"); await ui.autosave();
  const event = ui.clickShellLink("https://members.test/my/circle");
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
  assert.equal(ui.navigations.length, 0);
  assert.equal(ui.requests.length, 1, "a second request cannot race the in-flight revision");
  releaseFirst(); await ui.settle();
  assert.equal(ui.server().timelineDraft.year, 2010);
  assert.deepEqual(ui.requests.map(request => request.expectedRevision), ["0", "1"]);
  assert.equal(ui.navigations.at(-1), "https://members.test/my/circle");
  ui.unmount();
});

test("shell navigation stays on Practice when an account save fails", async () => {
  const ui = fixture({ initialCourse: "f1", handle() { throw Error("Offline"); } });
  await ui.click("Add an entry →"); ui.change("practice-year", "2018");
  const event = ui.clickShellLink("https://members.test/my"); await ui.settle();
  assert.equal(event.defaultPrevented, true);
  assert.equal(ui.navigations.length, 0);
  assert.match(text(ui.render()), /Offline/);
  assert.equal(ui.find(node => node.props.id === "practice-year").props.value, "2018");
  ui.unmount();
});

test("StrictMode effect replay does not abandon a pending save or its owner checkpoint", async () => {
  let resolveSave;
  const ui = fixture({ initialCourse: "f1", handle(request, { apply }) { return new Promise(resolve => { resolveSave = () => resolve(apply(request)); }); } });
  await ui.click("Add an entry →"); ui.change("practice-year", "2020"); await ui.autosave();
  ui.strictEffects();
  assert.ok(ui.draftStore.read());
  resolveSave(); await ui.settle();
  assert.match(text(ui.render()), /Saved to your private account/);
  assert.equal(ui.draftStore.read(), null);
  ui.unmount();
});

test("Back retains an unacknowledged draft in the owner layout and requires reconciliation on return", async () => {
  const store = createPracticeDraftStore(owner);
  const ui = fixture({ initialCourse: "f1", draftStore: store, handle() { throw Error("Offline"); } });
  await ui.click("Add an entry →"); ui.change("practice-year", "2019"); ui.back(); await ui.settle(); ui.unmount();
  assert.equal(store.read().draft.drafts.timeline.year, 2019);
  const resumed = fixture({ initialCourse: "f1", draftStore: store });
  assert.match(text(resumed.render()), /Your unfinished work is still here/);
  assert.equal(resumed.find(node => node.props.id === "practice-year").props.value, "2019");
  assert.equal(resumed.button("Continue →").props.disabled, true);
  assert.equal(resumed.requests.length, 0, "restoring memory must not overwrite server work");
  await resumed.click("Check saved work");
  await resumed.click("Continue with my open draft"); await resumed.autosave();
  assert.equal(resumed.server().timelineDraft.year, 2019);
  resumed.unmount();
  assert.equal(createPracticeDraftStore("another-owner").read(), null);
  assert.equal(createPracticeDraftStore().read(), null);
});

test("recovery never mistakes an older entry for an optional-details edit that failed to Keep", async () => {
  const id = "22222222-2222-4222-8222-000000000001";
  const entry = { id, position: 1, year: 2014, month: 4, title: "A turning point", details: "Old details", meaning: "I had more choice.", presentImpact: "I began making room." };
  const initial = snapshot({ timeline: { entries: [entry], revision: "1" }, lastTimelineEntryId: id });
  const ui = fixture({ initial, initialCourse: "f1", handle(request, { apply }) {
    if (request.action === "keep_timeline_entry") throw Error("Offline before Keep");
    return apply(request);
  } });
  ui.find(node => node.type === "button" && text(node).includes("A turning point")).props.onClick(); await ui.settle();
  await ui.click("Continue →"); ui.change("practice-details", "New details that must not disappear.");
  await ui.click("Continue →"); await ui.click("Continue →"); await ui.click("Keep changes →");
  await ui.click("Check saved work");
  assert.equal(ui.server().timeline.entries[0].details, "Old details");
  assert.equal(ui.server().timelineDraft.details, "New details that must not disappear.");
  assert.doesNotMatch(text(ui.render()), /Your entry was saved/);
  assert.ok(ui.button("Keep changes →"));
  ui.unmount();
});

test("members with revisit access can read full entries and letters without mutation controls", async () => {
  const entry = { id: "22222222-2222-4222-8222-000000000001", position: 1, year: 2014, title: "A turning point", details: "The full moment", meaning: "I had more choice.", presentImpact: "I began making room.", belief: "I could ask for help.", perspective: "I was not alone." };
  const initial = snapshot({ canWrite: false, timeline: { entries: [entry], revision: "1" } });
  const ui = fixture({ initial, initialCourse: "f1" });
  await ui.click("View my work →");
  assert.match(text(ui.render()), /The full moment.*I had more choice.*I began making room.*I could ask for help.*I was not alone/s);
  assert.equal(nodes(ui.render()).some(node => node.type === "textarea" || node.type === "input"), false);
  assert.equal(ui.requests.length, 0);
  ui.unmount();
  const letterInitial = snapshot({ canWrite: false, letter: { body: "Remember what matters.", keptAt: "2026-11-30T23:00:00Z" } }); letterInitial.releases.f4 = true;
  const letter = fixture({ initial: letterInitial, initialCourse: "f4" });
  await letter.click("View my work →");
  assert.match(text(letter.render()), /Remember what matters/);
  assert.equal(nodes(letter.render()).some(node => node.type === "textarea"), false);
  assert.equal(letter.requests.length, 0);
  letter.unmount();
});

test("Practice draft provider retains a verified owner through outages and isolates account changes", () => {
  let state;
  const code = ts.transpileModule(readFileSync(new URL("../src/components/membership/MemberPracticeDraftState.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)(name => name === "react" ? { ...React, useState(initial) { state ??= initial(); return [state, next => { state = next; }]; } } : require(name), loaded, loaded.exports);
  const render = (ownerId, temporarilyUnavailable = false) => loaded.exports.default({ ownerId, temporarilyUnavailable, children: null });
  const first = render(owner), firstStore = first.props.value, writer = Symbol("first-page");
  const draft = { drafts: { timeline: { id: null, year: 2008, title: "Private", details: "", meaning: "", presentImpact: "" }, letter: { body: "Private letter" }, time: { action: "Private action", category: "", minutes: 0, sourceCategory: "", sourceMinutes: 0 } }, saved: { timeline: "", letter: "", time: "" }, revision: "1", course: "f1", step: 1, yearInput: "2008", failed: null };
  firstStore.write(writer, draft);
  const outage = render(undefined, true);
  assert.equal(outage.key, owner);
  assert.equal(outage.props.value, firstStore);
  assert.equal(outage.props.value.read().draft.drafts.letter.body, "Private letter");
  const switched = render("33333333-3333-4333-8333-333333333333");
  assert.notEqual(switched.props.value, firstStore);
  assert.equal(switched.props.value.read(), null);
  firstStore.write(writer, draft);
  assert.equal(switched.props.value.read(), null, "late old-owner callbacks cannot touch the new owner store");
  assert.equal(render(undefined).props.value.read(), null);
});

test("focus refresh opens released courses without replacing writing or its saved revision", async () => {
  const draft = { id: null, year: 2018, title: "My open moment", details: "", meaning: "", presentImpact: "" };
  const initial = snapshot({ timelineDraft: draft });
  const ui = fixture({ initial, initialCourse: "f1", getSnapshot(server, response) {
    return response({ ...server, revision: "9", releases: { ...server.releases, f4: true }, timelineDraft: { ...draft, title: "A different draft from another tab", meaning: "Other meaning" } });
  } });
  await ui.click("Continue entry →");
  ui.change("practice-reflection", "My unsaved meaning stays here.");
  ui.focus(); await ui.settle();
  assert.equal(ui.find(node => node.props.id === "practice-reflection").props.value, "My unsaved meaning stays here.");
  assert.equal(ui.requests.length, 0, "availability refresh does not write or advance the assignment");
  await ui.click("← Assignment");
  assert.equal(ui.requests[0].expectedRevision, "0", "the account write baseline is never advanced by a metadata refresh");
  assert.equal(ui.requests[0].fields.title, "My open moment");
  assert.equal(ui.requests[0].fields.meaning, "My unsaved meaning stays here.");
  ui.focus(); await ui.settle();
  await ui.click("Foundations");
  assert.equal(nodes(ui.render()).filter(node => node.props["aria-label"] === "Locked").length, 2);
  ui.unmount();
});
