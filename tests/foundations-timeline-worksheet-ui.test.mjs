import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import * as timelineModel from "../src/components/membership/timeline-model.ts";

const require = createRequire(import.meta.url);
const output = ts.transpileModule(readFileSync(new URL("../src/components/membership/FoundationsTimelineWorksheet.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "";
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && (node.props["aria-label"] ?? text(node).replace(/\s+/g, " ").trim()) === label);
const click = node => {
  const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  node.props.onClick(event);
  return event;
};
const control = (tree, id) => nodes(tree).find(node => node.props.id === id);
const momentButton = (tree, title) => nodes(tree).find(node => node.type === "button" && nodes(node).some(child => child.type === "strong" && text(child) === title));
const panel = (tree, label) => nodes(tree).find(node => node.type === "section" && node.props["aria-label"] === label);
const yearInput = tree => nodes(tree).find(node => node.type === "input" && node.props.inputMode === "numeric");
const form = tree => nodes(tree).find(node => node.type === "form");
const entries = [
  { id: "first-moment", position: 1, year: 2008, month: null, title: "Moved to a new city", details: "A place without familiar faces.", meaning: "I had to figure things out alone." },
  { id: "second-moment", position: 2, year: 2015, month: 6, title: "Opened the studio", details: "The first room of our own.", meaning: "I could build something that mattered." },
];
const snapshot = (moments = entries, revision = "4") => ({ access: {}, completedAt: null, revision, entries: moments });
class TimelineConflictError extends Error {}
class TimelineSaveUncertainError extends Error {}

function fixture({ initialTimeline = snapshot(), writable = true, preview = false, recoveryDraft = null, save, latest } = {}) {
  const slots = [], effects = [], saves = [], loads = [], guardStates = [], navigations = [];
  let cursor = 0, newId = 0, cleared = 0;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(factory, deps) { const i = cursor++; if (!slots[i] || deps.some((v, n) => !Object.is(v, slots[i].deps[n]))) slots[i] = { deps, value: factory() }; return slots[i].value; },
    useEffect(effect, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((v, n) => !Object.is(v, prior.deps[n]))) { const state = { deps }; slots[i] = state; effects.push(() => { prior?.cleanup?.(); state.cleanup = effect(); }); } },
  };
  const adapter = {
    async save(values, current) {
      saves.push({ entries: structuredClone(values), current: structuredClone(current) });
      if (save) return save(values, current);
      return { ...current, revision: String(Number(current.revision) + 1), entries: values.map((value, index) => ({ ...value, id: value.id ?? `new-${++newId}`, position: index + 1 })) };
    },
    async load(current) { loads.push(structuredClone(current)); return latest ?? current; },
    complete: () => assert.fail("The worksheet must not mark Foundations complete"),
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "document", "HTMLElement", output)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "a" };
    if (name === "next/navigation") return { useRouter: () => ({ push: url => navigations.push(url) }) };
    if (name === "./timeline-model") return timelineModel;
    if (name === "./timeline-persistence") return { createTimelinePersistenceAdapter: () => adapter, TimelineConflictError, TimelineSaveUncertainError };
    if (name === "./useTimelineDraftGuard") return { __esModule: true, default: state => { guardStates.push(state); return { recoveryDraft, dismissRecovery() { recoveryDraft = null; }, clearDraft() { cleared++; } }; } };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, property) => property }) };
    throw Error(`Unexpected worksheet dependency ${name}`);
  }, loaded, loaded.exports, {
    requestAnimationFrame(callback) { callback(); }, location: { origin: "https://members.example.test", assign: url => navigations.push(url) },
  }, { activeElement: null }, class {});
  const props = { initialTimeline, writable, preview, ownerId: "owner-a" };
  const render = () => { cursor = 0; const tree = loaded.exports.default(props); effects.splice(0).forEach(effect => effect()); return tree; };
  const change = (id, value) => control(render(), id).props.onChange({ target: { value } });
  const submit = () => form(render()).props.onSubmit({ preventDefault() {} });
  return { render, change, changeYear: value => yearInput(render()).props.onChange({ target: { value } }), submit, saves, loads, guardStates, navigations, cleared: () => cleared, unmount: () => { for (const slot of slots) slot?.cleanup?.(); } };
}

test("read-only members can select later saved moments while all mutation controls remain disabled", async () => {
  const ui = fixture({ writable: false });
  let tree = ui.render();
  const second = momentButton(tree, "Opened the studio");
  assert.equal(second.props.disabled, false);
  second.props.onClick();
  tree = ui.render();
  assert.equal(control(tree, "foundation-event").props.value, entries[1].title);
  assert.equal(control(tree, "foundation-meaning").props.value, entries[1].meaning);
  for (const id of ["foundation-event", "foundation-details", "foundation-meaning"]) assert.equal(control(tree, id).props.disabled, true);
  assert.equal(button(tree, "Add a moment").props.disabled, true);
  assert.equal(button(tree, "Save to my timeline").props.disabled, true);
  assert.equal(ui.guardStates.at(-1).enabled, false);
  await ui.submit();
  assert.equal(ui.saves.length, 0);
  ui.unmount();
});

test("a meaning-only save updates the same canonical moment and preserves the other saved entries", async () => {
  const ui = fixture();
  const meaning = "I could learn to ask people for help.";
  ui.change("foundation-meaning", meaning);
  let tree = ui.render();
  assert.equal(ui.guardStates.at(-1).dirty, true);
  assert.equal(button(tree, "Save to my timeline").props.disabled, false);
  await ui.submit();
  assert.equal(ui.saves.length, 1);
  const sent = ui.saves[0];
  assert.equal(sent.current.revision, "4");
  assert.equal(sent.entries.length, entries.length);
  assert.deepEqual(sent.entries[0], { id: entries[0].id, year: entries[0].year, month: null, title: entries[0].title, details: entries[0].details, meaning });
  assert.deepEqual(sent.entries[1], { id: entries[1].id, year: entries[1].year, month: entries[1].month, title: entries[1].title, details: entries[1].details, meaning: entries[1].meaning });
  tree = ui.render();
  assert.equal(control(tree, "foundation-meaning").props.value, meaning);
  assert.equal(ui.guardStates.at(-1).editingEntryId, entries[0].id);
  assert.equal(ui.guardStates.at(-1).dirty, false);
  assert.equal(ui.cleared(), 1);
  assert.match(text(tree), /Saved to your private timeline/);
  ui.unmount();
});

test("unsaved writing blocks switching to a different moment without mutating the saved list", () => {
  const ui = fixture();
  const draft = "I believed no one would stay.";
  ui.change("foundation-meaning", draft);
  momentButton(ui.render(), entries[1].title).props.onClick();
  const tree = ui.render();
  assert.equal(control(tree, "foundation-event").props.value, entries[0].title);
  assert.equal(control(tree, "foundation-meaning").props.value, draft);
  assert.equal(ui.guardStates.at(-1).editingEntryId, entries[0].id);
  assert.match(text(tree), /Save or discard this draft before opening another moment/);
  assert.equal(ui.saves.length, 0);
  ui.unmount();
});

test("a recovered uncertain new moment cannot be blindly saved or turned into another new entry", async () => {
  const draft = { year: "2021", month: "", title: "The business closed", details: "One final day.", meaning: "I had failed." };
  const committed = { id: "possibly-committed", position: 3, year: 2021, month: null, title: draft.title, details: draft.details, meaning: draft.meaning };
  const current = snapshot([...entries, committed], "5");
  const ui = fixture({ initialTimeline: current, latest: current, recoveryDraft: {
    form: draft, baseline: { year: "", month: "", title: "", details: "", meaning: "" }, editingEntryId: null, revision: "4", wasPending: true,
  } });
  assert.equal(button(ui.render(), "Save to my timeline").props.disabled, true);
  button(ui.render(), "Restore draft").props.onClick();
  let tree = ui.render();
  assert.equal(control(tree, "foundation-event").props.value, draft.title);
  assert.equal(ui.guardStates.at(-1).pending, true, "unresolved uncertainty must survive another navigation checkpoint");
  assert.equal(button(tree, "Save to my timeline").props.disabled, true);
  await ui.submit();
  assert.equal(ui.saves.length, 0);
  await button(tree, "Load latest saved moments").props.onClick();
  tree = ui.render();
  assert.equal(ui.loads.length, 1);
  assert.match(text(tree), /The save may have reached your timeline/);
  assert.equal(button(tree, "Keep draft as a new moment"), undefined);
  assert.equal(button(tree, "Save to my timeline").props.disabled, true);
  button(tree, "Add a moment").props.onClick();
  tree = ui.render();
  assert.equal(control(tree, "foundation-event").props.value, draft.title);
  assert.match(text(tree), /Save or discard this draft before opening another moment/);
  await ui.submit();
  assert.equal(ui.saves.length, 0);
  ui.unmount();
});

test("an unconfirmed response keeps an existing meaning draft and records uncertainty after the request settles", async () => {
  const ui = fixture({ save: async () => { throw new TimelineSaveUncertainError("The save could not be confirmed."); } });
  ui.change("foundation-meaning", "The draft is still mine.");
  await ui.submit();
  const tree = ui.render();
  assert.equal(control(tree, "foundation-meaning").props.value, "The draft is still mine.");
  assert.equal(button(tree, "Save to my timeline").props.disabled, true);
  assert.equal(ui.guardStates.at(-1).pending, true);
  assert.equal(ui.guardStates.at(-1).dirty, true);
  assert.equal(ui.saves.length, 1);
  await ui.submit();
  assert.equal(ui.saves.length, 1, "uncertain writes must not be retried before reviewing the latest saved moment");
  ui.unmount();
});


test("moving between the two steps keeps every field and never saves implicitly", () => {
  const ui = fixture();
  let tree = ui.render();
  assert.equal(panel(tree, "The moment").props.hidden, true);
  assert.equal(panel(tree, "The meaning").props.hidden, false);
  ui.change("foundation-meaning", "An unfinished meaning in my own words.");
  button(ui.render(), "1 The moment").props.onClick();
  tree = ui.render();
  assert.equal(panel(tree, "The moment").props.hidden, false);
  assert.equal(panel(tree, "The meaning").props.hidden, true);
  assert.equal(control(tree, "foundation-meaning").props.value, "An unfinished meaning in my own words.");
  ui.change("foundation-event", "A more specific title");
  ui.change("foundation-details", "A detail I want to keep.");
  ui.changeYear("2009");
  click(button(ui.render(), "Continue"));
  tree = ui.render();
  assert.equal(panel(tree, "The meaning").props.hidden, false);
  assert.equal(control(tree, "foundation-event").props.value, "A more specific title");
  assert.equal(control(tree, "foundation-details").props.value, "A detail I want to keep.");
  assert.equal(yearInput(tree).props.value, "2009");
  assert.equal(control(tree, "foundation-meaning").props.value, "An unfinished meaning in my own words.");
  assert.equal(ui.saves.length, 0);
  ui.unmount();
});

test("a new moment validates Continue and saves only after the meaning-stage submission", async () => {
  const ui = fixture({ initialTimeline: snapshot([]) });
  let tree = ui.render();
  assert.equal(panel(tree, "The moment").props.hidden, false);
  assert.equal(button(tree, "Save to my timeline"), undefined);
  click(button(tree, "Continue"));
  tree = ui.render();
  assert.equal(panel(tree, "The moment").props.hidden, false);
  assert.match(text(tree), /Add a four-digit year/);
  ui.changeYear("2022");
  click(button(ui.render(), "Continue"));
  tree = ui.render();
  assert.equal(panel(tree, "The moment").props.hidden, false);
  assert.match(text(tree), /Give this moment a short title/);
  ui.change("foundation-event", "Started over");
  await ui.submit();
  tree = ui.render();
  assert.equal(panel(tree, "The meaning").props.hidden, false);
  assert.equal(ui.saves.length, 0, "pressing Enter or Continue on the first stage must not save");
  ui.change("foundation-meaning", "I could try again.");
  await ui.submit();
  assert.equal(ui.saves.length, 1);
  assert.deepEqual(ui.saves[0].entries, [{ id: null, year: 2022, month: null, title: "Started over", details: null, meaning: "I could try again." }]);
  ui.unmount();
});

test("saving a restored draft with invalid hidden event fields reveals the moment step without writing", async () => {
  for (const invalid of [{ year: "18", title: "A valid title" }, { year: "2020", title: "   " }]) {
    const ui = fixture({ recoveryDraft: {
      form: { year: invalid.year, month: "", title: invalid.title, details: "Keep this context.", meaning: "Keep this meaning." },
      baseline: { year: "", month: "", title: "", details: "", meaning: "" },
      editingEntryId: null, revision: "4", wasPending: false,
    } });
    button(ui.render(), "Restore draft").props.onClick();
    let tree = ui.render();
    assert.equal(panel(tree, "The moment").props.hidden, true, "the saved draft opens on meaning because it contains title text");
    assert.equal(form(tree).props.noValidate, true, "hidden required controls must not block the component validation path");
    await ui.submit();
    tree = ui.render();
    assert.equal(panel(tree, "The moment").props.hidden, false);
    assert.ok(nodes(tree).some(node => node.props.role === "alert"));
    assert.equal(control(tree, "foundation-details").props.value, "Keep this context.");
    assert.equal(control(tree, "foundation-meaning").props.value, "Keep this meaning.");
    assert.equal(ui.saves.length, 0);
    ui.unmount();
  }
});

test("reflection prompt chips reveal guidance without replacing the member's writing", () => {
  const ui = fixture();
  const writing = "These are my words, including the uncertainty.";
  ui.change("foundation-meaning", writing);
  const expectations = [
    ["About me", "What did this mean about me?"],
    ["Other people", "What did this mean about other people?"],
    ["Life", "What did this mean about life?"],
    ["My beliefs", "What did I begin believing because of it?"],
  ];
  for (const [label, prompt] of expectations) {
    button(ui.render(), label).props.onClick();
    const tree = ui.render();
    assert.equal(button(tree, label).props["aria-pressed"], true);
    assert.ok(nodes(tree).some(node => node.props.role === "status" && text(node) === prompt));
    assert.equal(control(tree, "foundation-meaning").props.value, writing);
    assert.equal(ui.guardStates.at(-1).form.meaning, writing);
  }
  assert.equal(ui.saves.length, 0);
  ui.unmount();
});


test("Continue cancels the click default before revealing the Save submit button", async () => {
  const ui = fixture({ initialTimeline: snapshot([]) });
  ui.changeYear("2023");
  ui.change("foundation-event", "A deliberate new beginning");
  const continueButton = button(ui.render(), "Continue");
  assert.equal(continueButton.props.type, "button");
  const event = click(continueButton);
  const tree = ui.render();
  assert.equal(panel(tree, "The meaning").props.hidden, false);
  assert.equal(button(tree, "Save to my timeline").props.type, "submit");
  // React can reuse the same button node. The browser's default action runs
  // after the click handler flushes the new submit-button state.
  if (!event.defaultPrevented) await ui.submit();
  assert.equal(event.defaultPrevented, true, "the Continue click must never fall through to native form submission");
  assert.equal(ui.saves.length, 0, "showing the meaning step must not persist the moment");
  ui.change("foundation-meaning", "I could choose a different direction.");
  await ui.submit();
  assert.equal(ui.saves.length, 1, "only the later explicit Save action persists the entry");
  ui.unmount();
});
