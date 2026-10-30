import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import * as timelineModel from "../src/components/membership/timeline-model.ts";

const require = createRequire(import.meta.url);
const output = ts.transpileModule(readFileSync(new URL("../src/components/membership/TimelineGraphics.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "";
const entry = (overrides = {}) => ({ id: "entry-a", kind: "text", title: "One beginning", body: "A public moment.", eventYear: 2024, eventMonth: null, eventDay: null, includeOnTimeline: true, visibility: "public", createdAt: "2026-10-30T01:23:00Z", version: "1", saved: false, media: [], ...overrides });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture({ source = [], props: overrides = {}, fetchOverride } = {}) {
  const slots = [], effects = [], calls = [];
  let cursor = 0;
  const props = { ownerId: "owner-a", preview: false, entries: [], revision: "a", ...overrides };
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useId() { cursor++; return "graphics-id"; },
    useEffect(effect, deps) { const i = cursor++, previous = slots[i]; if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) { const state = { deps }; slots[i] = state; effects.push(() => { previous?.cleanup?.(); state.cleanup = effect(); }); } },
  };
  function Studio() { return null; }
  const loaded = { exports: {} };
  const fetch = async (url, init) => { calls.push({ url, ...init }); return fetchOverride ? fetchOverride(calls.at(-1), calls.length) : json({ entries: source }); };
  new Function("require", "module", "exports", "fetch", output)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "./TimelineExportStudio") return { __esModule: true, default: Studio };
    if (name === "./timeline-model") return timelineModel;
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, property) => property }) };
    throw Error(`Unexpected graphics dependency: ${name}`);
  }, loaded, loaded.exports, fetch);
  const render = () => { cursor = 0; const tree = loaded.exports.default(props); effects.splice(0).forEach(effect => effect()); return tree; };
  const flush = async () => { render(); await tick(); return render(); };
  const click = async label => { const button = nodes(render()).find(node => node.type === "button" && text(node).startsWith(label)); assert.ok(button, `Missing button ${label}`); button.props.onClick(); return flush(); };
  const studio = () => nodes(render()).find(node => node.type === Studio);
  return { render, flush, click, studio, calls, map: loaded.exports.publicTimelineArtworkEntries, update(values) { Object.assign(props, values); return render(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}

test("artwork mapping excludes private and unmarked posts and preserves exact or unknown dates", () => {
  const ui = fixture();
  const values = ui.map([
    entry({ id: "private", visibility: "private", body: "Never export this." }),
    entry({ id: "unmarked", includeOnTimeline: false }),
    entry({ id: "exact", eventYear: 2024, eventMonth: 2, eventDay: 29 }),
    entry({ id: "year-only", eventYear: 2009 }),
    entry({ id: "created-date", eventYear: null, title: null, body: "A first line." }),
  ]);
  assert.deepEqual(values.map(value => value.id), ["exact", "year-only", "created-date"]);
  assert.deepEqual(values.map(({ year, month, day }) => [year, month, day]), [[2024, 2, 29], [2009, null, null], [2026, 10, 30]]);
  assert.equal(values[2].title, "A first line.");
  assert.equal(values[2].details, "A first line.");
  assert.doesNotMatch(JSON.stringify(values), /Never export/);
  ui.unmount();
});

test("opening graphics fetches the complete public collection with owner protection rather than the visible feed", async () => {
  const source = Array.from({ length: 45 }, (_, index) => entry({ id: `post-${index}`, title: `Post ${index}` }));
  const ui = fixture({ source: [...source, entry({ id: "private", visibility: "private" })], props: { entries: [source[0]] } });
  ui.render(); assert.equal(ui.calls.length, 0);
  await ui.click("Create a graphic");
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].url, "/api/my/journal/export?collection=public");
  assert.equal(ui.calls[0].cache, "no-store");
  assert.equal(new Headers(ui.calls[0].headers).get("x-ruined-session-owner"), "owner-a");
  assert.equal(ui.studio().props.entries.length, 45);
  assert.equal(ui.studio().props.examples, false);
  ui.update({ entries: [source[0]] }); await ui.flush();
  assert.equal(ui.calls.length, 1, "a recreated feed array while typing must not reload artwork");
  ui.unmount();
});

test("preview and empty accounts show labeled examples without exposing private drafts or calling the API", async () => {
  const ui = fixture({ props: { preview: true, entries: [entry({ visibility: "private", title: "SECRET" })] } });
  await ui.click("Create a graphic");
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.studio().props.examples, true);
  assert.deepEqual(ui.studio().props.entries, timelineModel.TIMELINE_EXAMPLES);
  assert.match(text(ui.render()), /Example artwork.*Publish a Timeline post/);
  assert.doesNotMatch(JSON.stringify(ui.studio().props.entries), /SECRET/);
  ui.unmount();
  const empty = fixture(); await empty.click("Create a graphic");
  assert.equal(empty.studio().props.examples, true);
  assert.match(text(empty.render()), /Example artwork/); empty.unmount();
});

test("closing and reopening ignores an old response even if the server disregards cancellation", async () => {
  const old = deferred(), latest = deferred();
  const ui = fixture({ fetchOverride: (_call, count) => count === 1 ? old.promise : latest.promise });
  await ui.click("Create a graphic"); await ui.click("Close graphics");
  assert.equal(ui.calls[0].signal.aborted, true);
  await ui.click("Create a graphic");
  latest.resolve(json({ entries: [entry({ title: "Current graphics" })] })); await ui.flush();
  assert.equal(ui.studio().props.entries[0].title, "Current graphics");
  old.resolve(json({ entries: [entry({ title: "Obsolete graphics" })] })); await ui.flush();
  assert.equal(ui.studio().props.entries[0].title, "Current graphics"); ui.unmount();
});

test("saved-post revisions immediately hide stale artwork and refresh the full collection", async () => {
  const refreshed = deferred();
  const ui = fixture({ fetchOverride: (_call, count) => count === 1 ? json({ entries: [entry()] }) : refreshed.promise });
  await ui.click("Create a graphic"); assert.ok(ui.studio());
  const invalidated = ui.update({ revision: "b" });
  assert.match(text(invalidated), /Loading your public Timeline/);
  assert.equal(ui.studio(), undefined);
  refreshed.resolve(json({ entries: [] })); await ui.flush();
  assert.equal(ui.studio().props.examples, true); ui.unmount();
});

test("owner changes hide the prior account immediately and bind replacement requests to the new owner", async () => {
  const old = deferred(), next = deferred();
  const ui = fixture({ fetchOverride: (_call, count) => count === 1 ? old.promise : next.promise });
  await ui.click("Create a graphic"); ui.update({ ownerId: "owner-b" });
  assert.equal(ui.calls[0].signal.aborted, true);
  assert.equal(new Headers(ui.calls[1].headers).get("x-ruined-session-owner"), "owner-b");
  next.resolve(json({ entries: [entry({ title: "New owner" })] })); await ui.flush();
  old.resolve(json({ entries: [entry({ title: "Old owner" })] })); await ui.flush();
  assert.equal(ui.studio().props.entries[0].title, "New owner"); ui.unmount();
});

test("a failed owner-safe request shows an error and retries without falling back to cached feed entries", async () => {
  const ui = fixture({ props: { entries: [entry({ title: "Do not silently substitute" })] }, fetchOverride: (_call, count) => count === 1 ? json({ error: "The signed-in account changed." }, 409) : json({ entries: [entry({ title: "Confirmed owner" })] }) });
  await ui.click("Create a graphic");
  assert.match(text(ui.render()), /signed-in account changed/);
  assert.equal(ui.studio(), undefined);
  await ui.click("Try again"); assert.equal(ui.studio().props.entries[0].title, "Confirmed owner"); ui.unmount();
});

test("unmount aborts graphics loading", async () => {
  const pending = deferred(); const ui = fixture({ fetchOverride: () => pending.promise });
  await ui.click("Create a graphic"); ui.unmount();
  assert.equal(ui.calls[0].signal.aborted, true);
  pending.resolve(json({ entries: [entry()] })); await tick();
});
