import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import * as timelineModel from "../src/components/membership/timeline-model.ts";

const require = createRequire(import.meta.url);
const output = ts.transpileModule(readFileSync(new URL("../src/components/membership/RuinedTimeline.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "";
const control = (tree, name) => nodes(tree).find(node => node.props.name === name);
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
const form = tree => nodes(tree).find(node => node.type === "form");
const summaries = tree => nodes(tree).filter(node => node.type === "summary");
const snapshot = entries => ({ access: {}, completedAt: null, revision: "2", entries });
const remembered = [
  { id: "year-only", position: 1, year: 2020, month: null, title: "A year remembered", details: null },
  { id: "september", position: 2, year: 2020, month: 9, title: "A month remembered", details: "The first quiet morning." },
  { id: "earlier", position: 3, year: 2018, month: 2, title: "An earlier beginning", details: "A place of our own." },
];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class TimelineConflictError extends Error {}
class TimelineSaveUncertainError extends Error {}
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [2026, 8, 21, 12])); }
  static now() { return new Date(2026, 8, 21, 12).getTime(); }
}

function fixture({ entries = remembered, writable = true, preview = false, save, recoveryDraft = null } = {}) {
  const slots = [], effects = [], timers = new Map(), calls = [], guardStates = [];
  let cursor = 0, key = 0, nextId = 0, timerId = 0, cleared = 0;
  const hooks = { ...React,
    useId: () => "timeline-test",
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(factory, deps) { const i = cursor++; if (!slots[i] || deps.some((v, n) => !Object.is(v, slots[i].deps[n]))) slots[i] = { deps, value: factory() }; return slots[i].value; },
    useEffect(effect, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((v, n) => !Object.is(v, prior.deps[n]))) { const state = { deps }; slots[i] = state; effects.push(() => { prior?.cleanup?.(); state.cleanup = effect(); }); } },
  };
  const adapter = {
    async save(values, current) {
      calls.push({ entries: structuredClone(values), current: structuredClone(current) });
      if (save) return save(values, current);
      let lastPosition = Math.max(0, ...current.entries.map(entry => entry.position));
      const saved = values.map(value => ({ ...value, id: value.id ?? `saved-${++nextId}`, position: current.entries.find(entry => entry.id === value.id)?.position ?? ++lastPosition }));
      saved.sort((a, b) => a.year - b.year || (a.month ?? 13) - (b.month ?? 13) || a.position - b.position);
      return { ...current, revision: String(Number(current.revision) + 1), entries: saved };
    },
    complete: () => assert.fail("These tests do not complete Foundations"),
    load: async current => ({ ...current, revision: "3" }),
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "crypto", "Date", "CSS", "HTMLElement", output)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith("/timeline-model")) return timelineModel;
    if (name === "./timeline-persistence") return { createTimelinePersistenceAdapter: () => adapter, TimelineConflictError, TimelineSaveUncertainError };
    if (name === "./useTimelineDraftGuard") return { __esModule: true, default: state => { guardStates.push(state); return { recoveryDraft, dismissRecovery() { recoveryDraft = null; }, clearDraft() { cleared++; } }; } };
    if (name.endsWith("/TimelineExportStudio")) return { __esModule: true, default: () => null };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, property) => property }) };
    throw Error(`Unexpected timeline dependency ${name}`);
  }, loaded, loaded.exports, {
    requestAnimationFrame(callback) { callback(); }, confirm: () => true,
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
  }, { randomUUID: () => `local-${++key}` }, FixedDate, { escape: value => value }, class {});
  const props = { writable, preview, initialTimeline: snapshot(entries) };
  const render = () => { cursor = 0; const tree = loaded.exports.default(props); effects.splice(0).forEach(effect => effect()); return tree; };
  const change = (name, value) => control(render(), name).props.onChange({ target: { value } });
  const add = () => button(render(), "+ Add moment").props.onClick();
  const submit = (another = false) => form(render()).props.onSubmit({ preventDefault() {}, nativeEvent: { submitter: { getAttribute: name => name === "data-add-another" && another ? "true" : null } } });
  return { render, change, add, submit, calls, guardStates, cleared: () => cleared, unmount: () => { for (const slot of slots) slot?.cleanup?.(); } };
}

test("timeline opens for reading with native expandable stories, accessible chronological dates, and no editor", () => {
  const ui = fixture(), tree = ui.render();
  assert.equal(form(tree), undefined);
  assert.equal(text(nodes(tree).find(node => node.type === "h1")), "My Timeline");
  assert.equal(button(tree, "+ Add moment").props["aria-expanded"], false);
  const stories = nodes(tree).filter(node => node.type === "details");
  assert.equal(stories.length, 3);
  for (const story of stories) assert.equal(React.Children.toArray(story.props.children)[0].type, "summary");
  const dates = nodes(tree).filter(node => node.type === "time");
  assert.deepEqual(dates.map(text), ["Feb 2018", "Sep 2020", "2020"]);
  assert.deepEqual(dates.map(node => node.props.dateTime), ["2018-02", "2020-09", "2020"]);
  assert.deepEqual(dates.map(node => node.props["aria-label"]), ["February 2018", "September 2020", "2020"]);
  assert.match(text(stories[1]), /A month remembered.*The first quiet morning/);
  const reader = nodes(tree).find(node => node.type === "section" && node.props["aria-label"] === "Your saved moments");
  assert.ok(reader); assert.equal(ui.calls.length, 0); ui.unmount();
});

test("a real empty timeline shows a truthful empty state and read-only timelines expose no mutation controls", () => {
  const empty = fixture({ entries: [] }), emptyTree = empty.render();
  assert.equal(summaries(emptyTree).length, 0);
  assert.match(text(emptyTree), /Start with one moment/);
  assert.doesNotMatch(text(emptyTree), /Moved somewhere new|Finished school|EXAMPLE/);
  assert.ok(button(emptyTree, "Add your first moment")); assert.equal(form(emptyTree), undefined);
  for (const entries of [[], remembered]) {
    const readonly = fixture({ entries, writable: false }), tree = readonly.render();
    assert.equal(form(tree), undefined);
    assert.equal(nodes(tree).some(node => node.type === "button" && /Add moment|Add your first|^Edit$|Save|Remove|Complete Foundations/.test(text(node))), false);
    assert.equal(readonly.guardStates.at(-1).enabled, false);
    assert.equal(readonly.calls.length, 0); readonly.unmount();
  }
  empty.unmount();
});

test("quick capture opens explicitly with an optional labeled month and all twelve choices", () => {
  const ui = fixture(); ui.add(); const tree = ui.render(), month = control(tree, "month");
  assert.ok(form(tree)); assert.equal(month.type, "select"); assert.equal(month.props.required, undefined);
  assert.equal(month.props.disabled, false); assert.equal(month.props.value, "");
  const label = nodes(tree).find(node => node.type === "label" && node.props.htmlFor === month.props.id);
  assert.equal(text(label), "Month Optional");
  const options = nodes(month).filter(node => node.type === "option");
  assert.deepEqual(options.map(node => String(node.props.value)), ["", ...Array.from({ length: 12 }, (_, i) => String(i + 1))]);
  assert.equal(text(options[0]), "Year only"); assert.equal(text(options[1]), "January"); assert.equal(text(options[12]), "December");
  const trigger = button(tree, "Continue writing"); assert.equal(trigger.props["aria-expanded"], true);
  assert.ok(nodes(tree).some(node => node.props.id === trigger.props["aria-controls"]));
  assert.equal(ui.calls.length, 0); ui.unmount();
});

test("Use this month supplies the local current date without changing typed content or saving", () => {
  const ui = fixture({ entries: [] }); ui.add();
  ui.change("title", "A quieter practice"); ui.change("details", "Keep these words.");
  button(ui.render(), "Use this month ↗").props.onClick(); const tree = ui.render();
  assert.equal(control(tree, "year").props.value, "2026"); assert.equal(control(tree, "month").props.value, "9");
  assert.equal(control(tree, "title").props.value, "A quieter practice"); assert.equal(control(tree, "details").props.value, "Keep these words.");
  assert.equal(ui.calls.length, 0); ui.unmount();
});

test("Save & add another retains the selected date, clears only content and records a clean new draft", async () => {
  const ui = fixture({ entries: [] }); ui.add();
  for (const [name, value] of Object.entries({ year: "2021", month: "11", title: "  A new practice  ", details: "  Remember the morning.  " })) ui.change(name, value);
  await ui.submit(true); const tree = ui.render();
  assert.equal(ui.calls.length, 1); assert.deepEqual(ui.calls[0].entries, [{ id: null, year: 2021, month: 11, title: "A new practice", details: "Remember the morning." }]);
  assert.ok(form(tree)); assert.equal(control(tree, "year").props.value, "2021"); assert.equal(control(tree, "month").props.value, "11");
  assert.equal(control(tree, "title").props.value, ""); assert.equal(control(tree, "details").props.value, "");
  assert.equal(ui.guardStates.at(-1).dirty, false); assert.equal(ui.cleared(), 1);
  assert.match(text(summaries(tree)[0]), /Nov 2021A new practice/);
  ui.change("title", "The next moment"); await ui.submit(true);
  assert.equal(ui.calls.at(-1).entries.at(-1).month, 11); assert.equal(ui.calls.at(-1).entries.at(-1).year, 2021); ui.unmount();
});

test("a year-only save stays year-only and returns to reading after confirmed success", async () => {
  const ui = fixture({ entries: [] }); ui.add(); ui.change("year", "2019"); ui.change("title", "A choice");
  await ui.submit(); const tree = ui.render();
  assert.equal(ui.calls[0].entries[0].month, null); assert.equal(form(tree), undefined);
  assert.equal(button(tree, "+ Add moment").props["aria-expanded"], false);
  assert.equal(nodes(tree).find(node => node.type === "time").props.dateTime, "2019"); ui.unmount();
});

test("pending saves freeze draft controls and a failed save preserves the complete draft and saved reader", async () => {
  const waiting = deferred(), ui = fixture({ save: () => waiting.promise }); ui.add();
  const draft = { year: "2022", month: "4", title: "Still unfinished", details: "These words must remain." };
  for (const [name, value] of Object.entries(draft)) ui.change(name, value);
  const saving = ui.submit(true), pending = ui.render();
  for (const name of ["year", "title", "details"]) assert.equal(control(pending, name).props.readOnly, true);
  assert.equal(control(pending, "month").props.disabled, true); assert.equal(button(pending, "Save & add another").props.disabled, true);
  assert.equal(ui.guardStates.at(-1).pending, true);
  waiting.reject(new Error("Connection interrupted. Please try again.")); await saving; const failed = ui.render();
  for (const [name, value] of Object.entries(draft)) assert.equal(control(failed, name).props.value, value);
  assert.equal(summaries(failed).length, remembered.length); assert.ok(nodes(failed).some(node => node.props.role === "alert" && /Connection interrupted/.test(text(node))));
  assert.equal(ui.guardStates.at(-1).dirty, true); assert.equal(ui.cleared(), 0); assert.equal(button(failed, "Save & add another").props.disabled, false); ui.unmount();
});

test("search, year, and reading order controls change only the reader", () => {
  const entries = Array.from({ length: 8 }, (_, index) => ({ id: `entry-${index}`, year: 2020 + index % 2, month: index + 1, position: index + 1, title: `Moment ${index}`, details: index === 3 ? "A patient restart" : null }));
  const ui = fixture({ entries }); let tree = ui.render();
  nodes(tree).find(node => node.props.type === "search").props.onChange({ target: { value: "PATIENT" } });
  tree = ui.render(); assert.equal(summaries(tree).length, 1); assert.match(text(summaries(tree)[0]), /Moment 3/); assert.match(text(tree), /1 moment found/);
  button(tree, "Clear filters").props.onClick(); tree = ui.render();
  nodes(tree).find(node => node.props.id === "timeline-test-filter-year").props.onChange({ target: { value: "2021" } });
  nodes(ui.render()).find(node => node.props.id === "timeline-test-order").props.onChange({ target: { value: "newest" } });
  tree = ui.render(); assert.deepEqual(nodes(tree).filter(node => node.type === "time").map(text), ["Aug 2021", "Jun 2021", "Apr 2021", "Feb 2021"]);
  assert.equal(form(tree), undefined); assert.equal(ui.calls.length, 0); ui.unmount();
});

test("undoing the earlier of two same-date moments preserves distinct edit identities after server reordering", async () => {
  const ui = fixture({ entries: [
    { id: "a", position: 1, year: 2020, month: 9, title: "Moment A", details: "Details A" },
    { id: "b", position: 2, year: 2020, month: 9, title: "Moment B", details: "Details B" },
  ] });
  nodes(ui.render()).find(node => node.props["aria-label"] === "Edit Moment A").props.onClick();
  await button(ui.render(), "Remove moment").props.onClick();
  await button(ui.render(), "Undo").props.onClick();
  const restored = ui.render(), items = summaries(restored);
  assert.deepEqual(items.map(node => node.props["data-index-key"]), ["b", "a"]);
  assert.match(text(items[0]), /Moment B/); assert.match(text(items[1]), /Moment A/);
  for (const letter of ["B", "A"]) {
    nodes(ui.render()).find(node => node.props["aria-label"] === `Edit Moment ${letter}`).props.onClick();
    assert.equal(control(ui.render(), "title").props.value, `Moment ${letter}`);
    assert.equal(control(ui.render(), "details").props.value, `Details ${letter}`);
    button(ui.render(), "Cancel").props.onClick();
  }
  assert.equal(ui.calls[1].entries.filter(entry => entry.id === null).length, 1); ui.unmount();
});

test("restoring a stale or uncertain recovery requires loading saved moments before any retry", async () => {
  const draft = { year: "2024", month: "6", title: "Recovered memory", details: "Keep this draft." };
  for (const state of [{ revision: "1", wasPending: false }, { revision: "2", wasPending: true }]) {
    const ui = fixture({ recoveryDraft: { form: draft, baseline: timelineModel.EMPTY_TIMELINE_FORM, editingEntryId: null, ...state } });
    assert.equal(button(ui.render(), "+ Add moment").props.disabled, true);
    button(ui.render(), "Restore draft").props.onClick(); let tree = ui.render();
    for (const [name, value] of Object.entries(draft)) assert.equal(control(tree, name).props.value, value);
    assert.ok(button(tree, "Load latest saved moments"));
    assert.equal(button(tree, "Save moment").props.disabled, true);
    await ui.submit(); assert.equal(ui.calls.length, 0);
    await button(tree, "Load latest saved moments").props.onClick(); tree = ui.render();
    assert.equal(button(tree, "Save moment").props.disabled, false);
    assert.equal(control(tree, "title").props.value, draft.title);
    assert.equal(control(tree, "details").props.value, draft.details);
    assert.equal(ui.calls.length, 0, "loading latest must not automatically resubmit the recovered draft"); ui.unmount();
  }
});
