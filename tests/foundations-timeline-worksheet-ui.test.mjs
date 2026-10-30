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

function fixture({ initialTimeline = snapshot(), writable = true, preview = false, recoveryDraft = null, save, latest, initialEntryId, startNew = false } = {}) {
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
  const props = { initialTimeline, writable, preview, ownerId: "owner-a", initialEntryId, startNew };
  const render = () => { cursor = 0; const tree = loaded.exports.default(props); effects.splice(0).forEach(effect => effect()); return tree; };
  const change = (id, value) => control(render(), id).props.onChange({ target: { value } });
  const submit = () => form(render()).props.onSubmit({ preventDefault() {} });
  return { render, change, changeYear: value => yearInput(render()).props.onChange({ target: { value } }), submit, saves, loads, guardStates, navigations, cleared: () => cleared, unmount: () => { for (const slot of slots) slot?.cleanup?.(); } };
}

const questions = ["When was this?", "What happened?", "What did I make it mean?", "What did I start believing?", "How does it show up now?", "What can I see now?"];
const reflectionFields = ["meaning", "belief", "presentImpact", "perspective"];
const review = ui => button(ui.render(), "Review & save what I have").props.onClick();
const edit = (ui, field = "meaning") => button(ui.render(), `Edit ${field}`).props.onClick();

test("saved moments open as readable stories; read-only members can revisit without mutation controls", async () => {
  const ui = fixture({ writable: false });
  let tree = ui.render();
  assert.equal(panel(tree, "Your moment in perspective").props.hidden, false);
  assert.equal(panel(tree, questions[0]).props.hidden, true);
  const second = momentButton(tree, "Opened the studio");
  assert.equal(second.props.disabled, false); second.props.onClick();
  tree = ui.render();
  assert.equal(control(tree, "foundation-event").props.value, entries[1].title);
  assert.match(text(panel(tree, "Your moment in perspective")), /Opened the studio.*I could build something that mattered/);
  for (const id of ["foundation-event", "foundation-details", ...reflectionFields.map(f => `foundation-${f}`)]) assert.equal(control(tree, id).props.disabled, true);
  assert.equal(button(tree, "Add a moment").props.disabled, true);
  assert.equal(button(tree, "Save to my timeline"), undefined);
  assert.equal(button(tree, "Edit story"), undefined);
  assert.equal(ui.guardStates.at(-1).enabled, false);
  await ui.submit(); assert.equal(ui.saves.length, 0); ui.unmount();
});

test("entry selection props open the requested story or a clean new question without writes", () => {
  const selected = fixture({ initialEntryId: entries[1].id });
  assert.equal(control(selected.render(), "foundation-event").props.value, entries[1].title);
  const fresh = fixture({ initialEntryId: entries[1].id, startNew: true });
  assert.equal(control(fresh.render(), "foundation-event").props.value, "");
  assert.equal(panel(fresh.render(), questions[0]).props.hidden, false);
  assert.equal(fresh.guardStates.at(-1).dirty, false);
  assert.equal(fresh.saves.length, 0); selected.unmount(); fresh.unmount();
});

test("a reflection-only edit updates the same moment and preserves every other saved field", async () => {
  const rich = entries.map((e, i) => ({ ...e, belief: `Belief ${i}`, presentImpact: `Impact ${i}`, perspective: `Perspective ${i}` }));
  const ui = fixture({ initialTimeline: snapshot(rich) });
  edit(ui, "belief"); ui.change("foundation-belief", "I could learn to ask people for help."); ui.render();
  assert.equal(ui.guardStates.at(-1).dirty, true);
  review(ui); await ui.submit();
  assert.equal(ui.saves.length, 1);
  const sent = ui.saves[0];
  assert.equal(sent.current.revision, "4");
  assert.deepEqual(sent.entries, rich.map((e, i) => ({ id: e.id, year: e.year, month: e.month, title: e.title, details: e.details, meaning: e.meaning, belief: i === 0 ? "I could learn to ask people for help." : e.belief, presentImpact: e.presentImpact, perspective: e.perspective })));
  const tree = ui.render();
  assert.match(text(panel(tree, "Your moment in perspective")), /I could learn to ask people for help/);
  assert.equal(ui.guardStates.at(-1).editingEntryId, entries[0].id);
  assert.equal(ui.guardStates.at(-1).dirty, false); assert.equal(ui.cleared(), 1);
  assert.match(text(tree), /Saved to your private timeline/); ui.unmount();
});

test("one question at a time preserves all six answers while Back, skips, and review never save implicitly", async () => {
  const ui = fixture({ initialTimeline: snapshot([]) });
  ui.changeYear("2009"); await ui.submit();
  ui.change("foundation-event", "A move that stayed with me"); ui.change("foundation-details", "A place without familiar faces.");
  await ui.submit();
  const responses = ["I thought I had to manage alone.", "Asking for help was a burden.", "I try to solve everything first.", "Connection can begin by asking."];
  for (let i = 0; i < 4; i++) {
    const tree = ui.render();
    for (let q = 0; q < questions.length; q++) assert.equal(panel(tree, questions[q]).props.hidden, q !== i + 2);
    ui.change(`foundation-${reflectionFields[i]}`, responses[i]);
    if (i > 0) {
      button(ui.render(), "Back").props.onClick();
      assert.equal(control(ui.render(), `foundation-${reflectionFields[i]}`).props.value, responses[i]);
      await ui.submit();
    }
    await ui.submit();
  }
  let tree = ui.render(); assert.equal(panel(tree, "Your moment in perspective").props.hidden, false);
  for (const response of responses) assert.ok(text(panel(tree, "Your moment in perspective")).includes(response));
  assert.equal(ui.saves.length, 0, "reading the completed story must precede the explicit save");
  await ui.submit(); assert.equal(ui.saves.length, 1);
  assert.deepEqual(ui.saves[0].entries, [{ id: null, year: 2009, month: null, title: "A move that stayed with me", details: "A place without familiar faces.", meaning: responses[0], belief: responses[1], presentImpact: responses[2], perspective: responses[3] }]);
  tree = ui.render(); assert.equal(ui.guardStates.at(-1).dirty, false); assert.match(text(tree), /Saved to your private timeline/); ui.unmount();
});

test("year and title are the only requirements; all deeper questions can be skipped or saved for later", async () => {
  const ui = fixture({ initialTimeline: snapshot([]) });
  await ui.submit(); assert.equal(panel(ui.render(), questions[0]).props.hidden, false); assert.match(text(ui.render()), /Add a four-digit year/);
  ui.changeYear("2022"); await ui.submit();
  await ui.submit(); assert.equal(panel(ui.render(), questions[1]).props.hidden, false); assert.match(text(ui.render()), /Give this moment a short title/);
  ui.change("foundation-event", "Started over"); await ui.submit();
  assert.ok(button(ui.render(), "Review & save what I have"));
  for (let i = 0; i < 4; i++) button(ui.render(), "Skip for now").props.onClick();
  assert.equal(panel(ui.render(), "Your moment in perspective").props.hidden, false); assert.equal(ui.saves.length, 0);
  await ui.submit(); assert.equal(ui.saves.length, 1);
  assert.deepEqual(ui.saves[0].entries, [{ id: null, year: 2022, month: null, title: "Started over", details: null, meaning: null, belief: null, presentImpact: null, perspective: null }]);
  assert.equal(button(ui.render(), "Continue exploring").props.disabled, false); ui.unmount();
});

test("Continue exploring resumes the first unanswered reflection without overwriting existing writing", () => {
  const ui = fixture({ initialTimeline: snapshot([{ ...entries[0], belief: "I should prove myself." }]) });
  button(ui.render(), "Continue exploring").props.onClick();
  const tree = ui.render();
  assert.equal(panel(tree, questions[4]).props.hidden, false);
  assert.equal(control(tree, "foundation-belief").props.value, "I should prove myself.");
  assert.equal(control(tree, "foundation-meaning").props.value, entries[0].meaning);
  assert.equal(ui.saves.length, 0); ui.unmount();
});

test("unsaved reflection writing blocks switching moments without mutating the saved list", () => {
  const ui = fixture(); edit(ui, "perspective");
  ui.change("foundation-perspective", "These words are still a draft.");
  momentButton(ui.render(), entries[1].title).props.onClick();
  const tree = ui.render();
  assert.equal(control(tree, "foundation-event").props.value, entries[0].title);
  assert.equal(control(tree, "foundation-perspective").props.value, "These words are still a draft.");
  assert.equal(ui.guardStates.at(-1).editingEntryId, entries[0].id);
  assert.match(text(tree), /Save or discard this draft before opening another moment/);
  assert.equal(ui.saves.length, 0); ui.unmount();
});

test("an uncertain recovered new moment requires reconciliation and cannot duplicate the previous save", async () => {
  const draft = { year: "2021", month: "", title: "The business closed", details: "One final day.", meaning: "I had failed.", belief: "Starting again was impossible.", presentImpact: "I hesitate.", perspective: "I have started again before." };
  const committed = { ...draft, year: 2021, month: null, id: "possibly-committed", position: 3 };
  const current = snapshot([...entries, committed], "5");
  const ui = fixture({ initialTimeline: current, latest: current, recoveryDraft: {
    form: draft, baseline: { year: "", month: "", title: "", details: "" }, editingEntryId: null, revision: "4", wasPending: true,
  } });
  button(ui.render(), "Restore draft").props.onClick();
  assert.equal(ui.guardStates.at(-1).pending, false); ui.render();
  assert.equal(ui.guardStates.at(-1).pending, true);
  assert.equal(button(ui.render(), "Save to my timeline").props.disabled, true);
  for (const field of reflectionFields) assert.equal(control(ui.render(), `foundation-${field}`).props.value, draft[field]);
  await ui.submit(); assert.equal(ui.saves.length, 0);
  await button(ui.render(), "Load latest saved moments").props.onClick();
  assert.equal(ui.loads.length, 1); assert.match(text(ui.render()), /The save may have reached your timeline/);
  assert.equal(button(ui.render(), "Keep draft as a new moment"), undefined);
  button(ui.render(), "Add a moment").props.onClick();
  assert.match(text(ui.render()), /Save or discard this draft before opening another moment/);
  await ui.submit(); assert.equal(ui.saves.length, 0); ui.unmount();
});

test("an unconfirmed response keeps every reflection and blocks blind retry", async () => {
  const ui = fixture({ save: async () => { throw new TimelineSaveUncertainError("The save could not be confirmed."); } });
  edit(ui, "perspective"); ui.change("foundation-perspective", "The draft is still mine."); review(ui); await ui.submit();
  const tree = ui.render();
  assert.equal(control(tree, "foundation-perspective").props.value, "The draft is still mine.");
  assert.equal(button(tree, "Save to my timeline").props.disabled, true);
  assert.equal(ui.guardStates.at(-1).pending, true); assert.equal(ui.guardStates.at(-1).dirty, true);
  await ui.submit(); assert.equal(ui.saves.length, 1); ui.unmount();
});

test("recovered invalid date or title reveals the relevant question without losing later reflections", async () => {
  for (const invalid of [{ year: "18", title: "A valid title", question: 0 }, { year: "2020", title: "   ", question: 1 }]) {
    const ui = fixture({ recoveryDraft: {
      form: { year: invalid.year, month: "", title: invalid.title, details: "Keep this context.", meaning: "Keep this meaning.", perspective: "Keep this perspective." },
      baseline: { year: "", month: "", title: "", details: "" }, editingEntryId: null, revision: "4", wasPending: false,
    } });
    button(ui.render(), "Restore draft").props.onClick();
    assert.equal(panel(ui.render(), "Your moment in perspective").props.hidden, false);
    await ui.submit();
    const tree = ui.render(); assert.equal(panel(tree, questions[invalid.question]).props.hidden, false);
    assert.ok(nodes(tree).some(node => node.props.role === "alert"));
    assert.equal(control(tree, "foundation-details").props.value, "Keep this context.");
    assert.equal(control(tree, "foundation-perspective").props.value, "Keep this perspective.");
    assert.equal(ui.saves.length, 0); ui.unmount();
  }
});

test("Read my story cancels click default before React exposes the Save submit button", async () => {
  const ui = fixture(); edit(ui, "perspective"); ui.change("foundation-perspective", "A deliberate new perspective.");
  const next = button(ui.render(), "Read my story");
  assert.equal(next.props.type, "button");
  const event = click(next);
  assert.equal(panel(ui.render(), "Your moment in perspective").props.hidden, false);
  assert.equal(button(ui.render(), "Save to my timeline").props.type, "submit");
  if (!event.defaultPrevented) await ui.submit();
  assert.equal(event.defaultPrevented, true); assert.equal(ui.saves.length, 0);
  await ui.submit(); assert.equal(ui.saves.length, 1); ui.unmount();
});

test("preview keeps the existing examples and labels memory-only saves honestly", async () => {
  const ui = fixture({ preview: true, writable: false, startNew: true });
  assert.match(text(ui.render()), /Nothing is saved to an account/);
  ui.changeYear("2024"); await ui.submit(); ui.change("foundation-event", "A preview only moment"); await ui.submit();
  review(ui); await ui.submit();
  assert.equal(ui.saves.length, 1); assert.equal(ui.guardStates.at(-1).enabled, true);
  assert.match(text(ui.render()), /Saved in this preview only. Refreshing resets these examples/); ui.unmount();
});

test("a missing deep-linked moment does not silently open somebody else's saved story", () => {
  const ui = fixture({ initialEntryId: "removed-moment" });
  let tree = ui.render();
  assert.match(text(tree), /This moment isn’t available/);
  assert.equal(form(tree).props.hidden, true);
  assert.equal(control(tree, "foundation-event").props.value, "");
  momentButton(tree, entries[1].title).props.onClick(); tree = ui.render();
  assert.equal(form(tree).props.hidden, false);
  assert.equal(control(tree, "foundation-event").props.value, entries[1].title);
  assert.equal(ui.saves.length, 0); ui.unmount();
});

test("read-only empty and new-entry deep links do not strand members in a disabled editor", () => {
  const empty = fixture({ writable: false, startNew: true, initialTimeline: snapshot([]) });
  assert.match(text(empty.render()), /No saved moments yet/);
  assert.equal(form(empty.render()).props.hidden, true);
  const existing = fixture({ writable: false, startNew: true });
  assert.equal(panel(existing.render(), "Your moment in perspective").props.hidden, false);
  assert.equal(control(existing.render(), "foundation-event").props.value, entries[0].title);
  empty.unmount(); existing.unmount();
});
