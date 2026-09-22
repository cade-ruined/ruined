import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import * as timelineModel from "../src/components/membership/timeline-model.ts";

const require = createRequire(import.meta.url);
const journalModel = { exports: {} };
new Function("module", "exports", ts.transpileModule(readFileSync(new URL("../src/lib/membership/journal-model.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(journalModel, journalModel.exports);

const compiled = ts.transpileModule(readFileSync(new URL("../src/components/membership/MemberJournal.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const entry = (overrides = {}) => ({ id: id(1), kind: "text", title: "One remembered beginning", body: "The original words.", createdAt: "2026-09-22T12:00:00Z", saved: true, media: [], eventYear: 2018, eventMonth: null, eventDay: null, includeOnTimeline: true, version: "1", ...overrides });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "";
const nodes = node => !React.isValidElement(node) ? [] : [node, ...(node.type.name === "Dialog" && !node.props.open ? [] : React.Children.toArray(node.props.children).flatMap(nodes))];

function fixture({ initialEntries = [entry()], writable = true, preview = false, initialMode = "all", view = "journal", pageSize = 30, intercept, recoveryDraft = null, timelineCapabilities = ["foundations.write"], ownerId = id(900), captureRenders = false } = {}) {
  const slots = [], calls = [], guards = [], rendered = [], timers = new Map(), frames = new Map(), revoked = [], createdUrls = [];
  const entries = new Map(initialEntries.map(value => [value.id, structuredClone(value)]));
  const media = new Map(initialEntries.flatMap(value => value.media.map(item => [item.id, item])));
  const Export = () => null;
  let cursor = 0, queued = [], changed = false, tree, uuid = 100, timerId = 0, urlId = 0, cleared = 0, focused = 0, confirmResult = true;
  const props = { writable, preview, initialMode, view, onModeChange(mode) { props.initialMode = mode; } };
  const same = (left, right) => left?.length === right?.length && left.every((value, i) => Object.is(value, right[i]));
  const hooks = { ...React,
    useId: () => "journal-test",
    useState(initial) { const key = cursor++; if (!(key in slots)) slots[key] = typeof initial === "function" ? initial() : initial; return [slots[key], next => { const value = typeof next === "function" ? next(slots[key]) : next; changed ||= !Object.is(value, slots[key]); slots[key] = value; }]; },
    useRef(initial) { const key = cursor++; return slots[key] ??= { current: initial }; },
    useMemo(factory, dependencies) { const key = cursor++; if (!slots[key] || !same(slots[key].dependencies, dependencies)) slots[key] = { dependencies, value: factory() }; return slots[key].value; },
    useCallback(callback, dependencies) { return hooks.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) { const key = cursor++, previous = slots[key]; if (!previous || !same(previous.dependencies, dependencies)) { const current = { dependencies }; slots[key] = current; queued.push(() => { previous?.cleanup?.(); current.cleanup = callback(); }); } },
  };
  function listed(url) {
    const params = url.searchParams;
    const values = [...entries.values()].filter(value => (params.get("saved") !== "true" || value.saved)
      && (params.get("view") !== "timeline" || value.includeOnTimeline)
      && (!params.get("year") || String(value.eventYear) === params.get("year"))
      && (!params.get("search") || `${value.title} ${value.body}`.toLowerCase().includes(params.get("search").toLowerCase())));
    if (params.get("view") === "timeline") values.sort((a, b) => (params.get("order") === "newest" ? -1 : 1) * ((a.eventYear ?? 0) - (b.eventYear ?? 0)) || (a.eventMonth ?? 13) - (b.eventMonth ?? 13));
    const start = params.has("before") ? values.findIndex(value => value.id === params.get("before")) + 1 : 0;
    const page = values.slice(start, start + pageSize), hasMore = start + pageSize < values.length;
    return response({ entries: structuredClone(page), total: values.length, years: [...new Set([...entries.values()].map(value => value.eventYear).filter(Boolean))], hasMore, nextCursor: hasMore ? page.at(-1)?.id : null, mediaReady: true, writable });
  }
  async function fakeFetch(href, init = {}) {
    const url = new URL(href, "https://members.example.test"), method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    const call = { href: String(href), url, method, body, signal: init.signal, headers: new Headers(init.headers) }; calls.push(call);
    const overridden = intercept ? await intercept(call, { entries, media }) : undefined;
    if (overridden !== undefined) return overridden;
    if (method === "PUT") return response({});
    if (url.pathname === "/api/my/timeline") return response(method === "GET" ? { timeline: { completedAt: null, access: { capabilities: timelineCapabilities } } } : { requirements: { timeline: { completedAt: "2026-09-22T13:00:00Z" } } });
    if (url.pathname === "/api/my/journal/export") return response({ entries: [...entries.values()].filter(value => value.includeOnTimeline).sort((a, b) => a.eventYear - b.eventYear) });
    if (url.pathname === "/api/my/journal/media") {
      const mediaId = id(++uuid); media.set(mediaId, { id: mediaId, mimeType: body.mimeType, size: body.size, url: `/api/my/journal/media/${mediaId}` });
      return response({ id: mediaId, signedUrl: `https://upload.example.test/${mediaId}` });
    }
    if (url.pathname === "/api/my/journal" && method === "GET") return listed(url);
    const currentId = url.pathname.split("/").at(-1), existing = entries.get(currentId);
    if (method === "GET") return existing ? response({ entry: structuredClone(existing) }) : response({ error: "Entry not found." }, 404);
    if (method === "DELETE") { entries.delete(currentId); return response({ ok: true }); }
    if (method === "PATCH" && Object.hasOwn(body, "saved")) {
      const value = { ...existing, saved: body.saved }; entries.set(value.id, value); return response({ entry: structuredClone(value) });
    }
    if (method === "PATCH" && body.expectedVersion !== existing.version) return response({ error: "Load the latest entry before saving." }, 409);
    const fields = method === "PATCH" ? journalModel.exports.validateJournalEdit(body, currentId) : journalModel.exports.validateJournalInput(body);
    const value = { ...entry({ id: body.id ?? currentId, saved: existing?.saved ?? false, version: String(Number(existing?.version ?? "0") + 1) }), ...fields, media: fields.mediaIds.map(mediaId => media.get(mediaId)) };
    // Replaying a confirmed create UUID returns its one existing record.
    if (method === "POST" && entries.has(value.id)) return response({ entry: structuredClone(entries.get(value.id)) });
    entries.set(value.id, value); return response({ entry: structuredClone(value) });
  }
  class FakeURL extends URL {
    static createObjectURL(file) { const url = `blob:journal-${++urlId}`; createdUrls.push({ file, url }); return url; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  const window = { requestAnimationFrame(callback) { const key = ++timerId; frames.set(key, callback); return key; }, cancelAnimationFrame(key) { frames.delete(key); }, setTimeout(callback) { const key = ++timerId; timers.set(key, callback); return key; }, clearTimeout(key) { timers.delete(key); }, confirm: () => confirmResult };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "fetch", "URL", "crypto", compiled)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/lib/membership/journal-model") return journalModel.exports;
    if (name === "./timeline-model") return timelineModel;
    if (name === "./TimelineExportStudio") return { __esModule: true, default: Export };
    if (name === "./useJournalDraftGuard") return { __esModule: true, default: state => { guards.push(state); return { ownerId, recoveryDraft, dismissRecovery() { recoveryDraft = null; }, clearDraft() { cleared++; } }; } };
    if (name === "next/image") return { __esModule: true, default: "image" };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw Error(`Unexpected Journal dependency ${name}`);
  }, loaded, loaded.exports, window, fakeFetch, FakeURL, { randomUUID: () => id(++uuid) });
  function render(nextProps) {
    Object.assign(props, nextProps);
    let attempts = 0;
    do { assert.ok(attempts++ < 12, "Journal effects should settle"); cursor = 0; queued = []; changed = false; tree = loaded.exports.default(props); if (captureRenders) rendered.push(tree); queued.forEach(callback => callback()); } while (changed);
    for (const node of nodes(tree)) if (node.type === "input" && node.props.ref) node.props.ref.current = { focus() { focused++; } };
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback());
    return tree;
  }
  async function flush() { for (let i = 0; i < 16; i++) { await Promise.resolve(); render(); } return tree; }
  const find = predicate => nodes(render()).find(predicate);
  const button = label => find(node => node.type === "button" && (text(node) === label || node.props["aria-label"] === label));
  const field = label => {
    const scope = find(node => node.type === "form") ?? render();
    const container = nodes(scope).find(node => node.type === "label" && text(node).startsWith(label));
    assert.ok(container, `Missing field ${label}`);
    return nodes(container).find(node => ["input", "textarea", "select"].includes(node.type));
  };
  return { calls, entries, guards, rendered, createdUrls, revoked, render, flush, find, button, field, Export,
    async click(label) { const control = button(label); assert.ok(control, `Missing button ${label}`); assert.equal(Boolean(control.props.disabled), false, `${label} should be enabled`); control.props.onClick(); return flush(); },
    change(label, value) { const control = field(label); control.props.onChange({ target: { value, checked: value } }); return render(); },
    submit(another = false) { return find(node => node.type === "form").props.onSubmit({ preventDefault() {}, nativeEvent: { submitter: { getAttribute: name => name === "data-add-another" && another ? "true" : null } } }); },
    attach(files) { const input = find(node => node.type === "input" && node.props.type === "file"); input.props.onChange({ target: { files, value: "picked" } }); return render(); },
    mutate() { return calls.filter(call => ["PATCH", "POST", "DELETE"].includes(call.method) && !call.href.endsWith("/media")); },
    runTimers() { const values = [...timers.values()]; timers.clear(); values.forEach(callback => callback()); return render(); },
    cleared: () => cleared, focusCount: () => focused, confirm(value) { confirmResult = value; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); frames.clear(); },
  };
}

test("one saved milestone edits the same entry through All, Timeline and Saved without duplicate creates", async () => {
  const ui = fixture(); await ui.flush();
  for (const [mode, view, title] of [["all", "journal", "Edited from all"], ["timeline", "journal", "Edited from timeline"], ["timeline", "saved", "Edited from saved"]]) {
    ui.render({ initialMode: mode, view }); await ui.flush();
    await ui.click(`Open entry: ${ui.entries.get(id(1)).title}`); await ui.click("Edit entry");
    assert.equal(ui.field("Your words").props.value, "The original words.");
    ui.change("Title", title); await ui.submit(); await ui.flush();
    assert.equal(ui.entries.size, 1); assert.equal(ui.entries.get(id(1)).title, title);
    assert.equal(ui.entries.get(id(1)).includeOnTimeline, true); assert.equal(ui.entries.get(id(1)).saved, true);
  }
  assert.deepEqual(ui.mutate().map(call => [call.method, call.url.pathname, call.body.expectedVersion]), [["PATCH", `/api/my/journal/${id(1)}`, "1"], ["PATCH", `/api/my/journal/${id(1)}`, "2"], ["PATCH", `/api/my/journal/${id(1)}`, "3"]]);
  ui.unmount();
});

test("editing retains existing media and uploads new files once before preserving all attachment IDs", async () => {
  const kept = { id: id(20), mimeType: "image/jpeg", size: 8, url: `/api/my/journal/media/${id(20)}` };
  const ui = fixture({ initialEntries: [entry({ kind: "images", media: [kept], body: "Caption stays." })] }); await ui.flush();
  await ui.click("Open entry: One remembered beginning"); await ui.click("Edit entry");
  const photo = new File(["new photo"], "new.jpg", { type: "image/jpeg" }); ui.attach([photo]);
  assert.equal(ui.mutate().length, 0); assert.ok(ui.createdUrls.some(value => value.file === photo));
  ui.change("Title", "A shared photo memory"); await ui.submit(); await ui.flush();
  const reserve = ui.calls.filter(call => call.url.pathname === "/api/my/journal/media");
  assert.equal(reserve.length, 1); assert.equal(ui.calls.filter(call => call.method === "PUT").length, 1);
  const edit = ui.mutate()[0]; assert.equal(edit.body.mediaIds[0], kept.id); assert.equal(edit.body.mediaIds.length, 2);
  assert.equal(edit.body.body, "Caption stays."); assert.deepEqual(ui.entries.get(id(1)).media.map(value => value.id), edit.body.mediaIds);
  assert.ok(ui.revoked.includes(ui.createdUrls[0].url)); ui.unmount();
});

test("a year-only milestone keeps unknown date parts null and Save & add another retains date only", async () => {
  const ui = fixture({ initialEntries: [], initialMode: "timeline" }); await ui.flush(); await ui.click("+ Add milestone");
  ui.change("Title", "A move"); ui.change("Year", "2014"); await ui.submit(true); await ui.flush();
  const first = ui.mutate()[0].body; assert.equal(first.eventYear, 2014); assert.equal(first.eventMonth, null); assert.equal(first.eventDay, null);
  assert.equal(ui.field("Year").props.value, "2014"); assert.equal(ui.field("Month").props.value, ""); assert.equal(ui.field("Day").props.value, "");
  assert.equal(ui.field("Title").props.value, ""); assert.equal(ui.field("Your words").props.value, ""); assert.equal(ui.field("Include on my timeline").props.checked, true);
  assert.equal(ui.guards.at(-1).dirty, false); assert.equal(ui.cleared(), 1);
  assert.equal(ui.focusCount(), 2, "opening the composer and adding another entry each focus its title");
  ui.change("Title", "Another beginning"); await ui.submit(); await ui.flush();
  assert.equal(ui.entries.size, 2); assert.notEqual(ui.mutate()[0].body.id, ui.mutate()[1].body.id);
  assert.equal(ui.mutate()[1].body.eventYear, 2014); ui.unmount();
});

test("invalid dates and incomplete milestones keep typed content without issuing mutations", async () => {
  const ui = fixture({ initialEntries: [], initialMode: "timeline" }); await ui.flush(); await ui.click("+ Add milestone");
  ui.change("Title", "Keep this draft"); await ui.submit(); assert.match(text(ui.render()), /title and a year/);
  ui.change("Year", "2025"); ui.change("Month", "2"); ui.change("Day", "29"); await ui.submit(); assert.match(text(ui.render()), /valid day/);
  ui.change("Day", ""); ui.change("Year", ""); await ui.submit(); assert.match(text(ui.render()), /Add a year with this month/);
  assert.equal(ui.mutate().length, 0); assert.equal(ui.field("Title").props.value, "Keep this draft");
  ui.change("Year", "2024"); ui.change("Day", "29"); await ui.submit(); await ui.flush();
  assert.equal(ui.mutate()[0].body.eventDay, 29); ui.unmount();
});

test("editing a long journal body preserves all 20,000 characters when adding it to the timeline", async () => {
  const body = "x".repeat(20_000), ui = fixture({ initialEntries: [entry({ body, includeOnTimeline: false, eventYear: null })] }); await ui.flush();
  await ui.click("Open entry: One remembered beginning"); await ui.click("Edit entry");
  assert.equal(ui.field("Your words").props.value, body); assert.equal(ui.field("Your words").props.maxLength, 20_000);
  ui.change("Include on my timeline", true); ui.change("Year", "2010"); await ui.submit(); await ui.flush();
  assert.equal(ui.mutate()[0].body.body, body); assert.equal(ui.entries.get(id(1)).body, body); ui.unmount();
});

test("uncertain create retries preserve the stable ID and uploaded media without duplicating entries", async () => {
  let first = true;
  const ui = fixture({ initialEntries: [], intercept(call) { if (call.method === "POST" && call.url.pathname === "/api/my/journal" && first) { first = false; throw Error("Connection lost"); } } });
  await ui.flush(); await ui.click("+ Add entry"); ui.change("Photos", true);
  ui.attach([new File(["retry photo"], "retry.jpg", { type: "image/jpeg" })]); ui.change("Title", "A retryable thought");
  await ui.submit(); await ui.flush();
  assert.equal(ui.field("Title").props.value, "A retryable thought"); assert.equal(ui.field("Title").props.disabled, true); assert.ok(ui.button("Retry save"));
  await ui.submit(); await ui.flush();
  const [firstSave, retry] = ui.mutate(); assert.deepEqual(retry.body, firstSave.body); assert.equal(ui.entries.size, 1); assert.equal(ui.cleared(), 1);
  assert.equal(ui.calls.filter(call => call.url.pathname === "/api/my/journal/media").length, 1);
  assert.equal(ui.calls.filter(call => call.method === "PUT").length, 1); ui.unmount();
});

test("a conflicting edit preserves draft and media until the latest saved version is fetched and compared", async () => {
  const ui = fixture(); await ui.flush(); await ui.click("Open entry: One remembered beginning"); await ui.click("Edit entry");
  ui.change("Your words", "My unsaved revision"); ui.entries.set(id(1), entry({ body: "Saved in another tab", version: "2" }));
  await ui.submit(); await ui.flush();
  assert.equal(ui.field("Your words").props.value, "My unsaved revision"); assert.equal(ui.button("Retry save").props.disabled, true); assert.equal(ui.cleared(), 0);
  await ui.click("Check saved entry");
  assert.equal(ui.field("Your words").props.value, "My unsaved revision");
  assert.match(text(ui.render()), /Latest saved version.*Saved in another tab/);
  assert.equal(ui.guards.at(-1).draft.editingVersion, "2");
  await ui.submit(); await ui.flush(); assert.equal(ui.entries.get(id(1)).body, "My unsaved revision"); assert.equal(ui.entries.get(id(1)).version, "3"); ui.unmount();
});

test("timeline filters and pagination are requested from the server while export loads the complete timeline", async () => {
  const values = Array.from({ length: 8 }, (_, index) => entry({ id: id(index + 1), eventYear: 2001 + index, title: ["First", "Second", "Third"][index] ?? `Milestone ${index + 1}` }));
  const ui = fixture({ initialEntries: values, initialMode: "timeline", pageSize: 1 }); await ui.flush();
  assert.equal(nodes(ui.render()).filter(node => node.type === "article").length, 1);
  await ui.click("Show more entries"); assert.equal(nodes(ui.render()).filter(node => node.type === "article").length, 2);
  assert.equal(ui.calls.find(call => call.url.searchParams.has("before")).url.searchParams.get("before"), id(1));
  ui.change("Find an entry", "Third"); ui.runTimers(); await ui.flush(); ui.change("Year", "2003"); await ui.flush();
  const filtered = ui.calls.filter(call => call.url.pathname === "/api/my/journal").at(-1).url.searchParams;
  assert.equal(filtered.get("search"), "Third"); assert.equal(filtered.get("year"), "2003"); assert.equal(filtered.get("view"), "timeline"); assert.equal(filtered.get("order"), "oldest");
  assert.equal(nodes(ui.render()).filter(node => node.type === "article").length, 1);
  await ui.click("Export timeline ↗");
  const studio = ui.find(node => node.type === ui.Export); assert.deepEqual(studio.props.entries.map(value => value.id), values.map(value => value.id));
  assert.equal(ui.calls.filter(call => call.url.pathname === "/api/my/journal/export").length, 1); ui.unmount();
});

test("read-only reading exposes no working mutation actions and a real empty Journal has no examples", async () => {
  const ui = fixture({ writable: false }); await ui.flush();
  assert.equal(ui.button("+ Add entry"), undefined); assert.equal(ui.button("Unsave entry").props.disabled, true);
  await ui.click("Open entry: One remembered beginning");
  assert.equal(ui.button("Edit entry"), undefined); assert.equal(ui.button("Delete entry"), undefined);
  assert.equal(ui.guards.at(-1).enabled, false); assert.equal(ui.mutate().length, 0); ui.unmount();
  const empty = fixture({ initialEntries: [] }); await empty.flush(); assert.match(text(empty.render()), /Start with a moment/);
  assert.doesNotMatch(text(empty.render()), /Example entries|Moved somewhere new|Making room/); empty.unmount();
});

test("a pending save blocks duplicate submits synchronously and keeps the draft until confirmation", async () => {
  const save = deferred();
  const ui = fixture({ initialEntries: [], intercept(call) { if (call.method === "POST" && call.url.pathname === "/api/my/journal") return save.promise; } });
  await ui.flush(); await ui.click("+ Add entry"); ui.change("Title", "Save only once");
  const first = ui.submit(), duplicate = ui.submit(); await ui.flush(); await duplicate;
  assert.equal(ui.mutate().length, 1); assert.equal(ui.field("Title").props.disabled, true); assert.equal(ui.cleared(), 0);
  await ui.click("Keep draft & close"); assert.equal(ui.guards.at(-1).draft.title, "Save only once"); assert.equal(ui.guards.at(-1).pending, true);
  save.resolve(response({ entry: entry({ ...ui.mutate()[0].body, media: [] }) })); await first; await ui.flush();
  assert.equal(ui.cleared(), 1); assert.equal(ui.guards.at(-1).pending, false); ui.unmount();
});

test("failed second uploads retain the first confirmed upload for a safe media retry", async () => {
  let puts = 0;
  const ui = fixture({ initialEntries: [], intercept(call) { if (call.method === "PUT" && ++puts === 2) return response({}, 503); } });
  await ui.flush(); await ui.click("+ Add entry"); ui.change("Photos", true);
  const first = new File(["first"], "first.jpg", { type: "image/jpeg" }), second = new File(["second"], "second.jpg", { type: "image/jpeg" });
  ui.attach([first, second]); ui.change("Title", "Both photographs"); await ui.submit(); await ui.flush();
  assert.equal(ui.mutate().length, 0); assert.equal(ui.guards.at(-1).draft.files.length, 2);
  const confirmed = ui.guards.at(-1).draft.uploadIds[0]; assert.equal(confirmed[0], first);
  assert.match(text(ui.render()), /upload could not finish/);
  await ui.submit(); await ui.flush();
  assert.equal(ui.calls.filter(call => call.url.pathname === "/api/my/journal/media").length, 3);
  assert.equal(ui.mutate()[0].body.mediaIds[0], confirmed[1]); assert.equal(ui.mutate()[0].body.mediaIds.length, 2); ui.unmount();
});

test("a late paginated page cannot contaminate a different Journal view", async () => {
  const page = deferred();
  const ui = fixture({ initialEntries: [entry(), entry({ id: id(2), title: "Unsaved second", saved: false })], pageSize: 1,
    intercept(call) { if (call.method === "GET" && call.url.searchParams.has("before")) return page.promise; } });
  await ui.flush(); await ui.click("Show more entries");
  ui.render({ view: "saved" }); await ui.flush();
  page.resolve(response({ entries: [entry({ id: id(2), title: "Unsaved second", saved: false })], hasMore: false, nextCursor: null })); await ui.flush();
  const articles = nodes(ui.render()).filter(node => node.type === "article");
  assert.equal(articles.length, 1); assert.doesNotMatch(text(articles[0]), /Unsaved second/); ui.unmount();
});

test("an uncertain recovered create checks the stable ID before allowing another save", async () => {
  const recovered = { kind: "text", title: "Recovered words", body: "Still private", eventYear: "2015", eventMonth: "", eventDay: "", includeOnTimeline: true,
    files: [], keptMedia: [], editingId: null, editingVersion: null, attempted: true, draftId: id(88), uploadIds: [], wasPending: true };
  const ui = fixture({ initialEntries: [], recoveryDraft: recovered }); await ui.flush(); await ui.click("Restore draft");
  assert.equal(ui.field("Title").props.value, recovered.title); assert.equal(ui.button("Retry save").props.disabled, true);
  await ui.click("Check saved entry");
  assert.ok(ui.calls.some(call => call.method === "GET" && call.url.pathname === `/api/my/journal/${id(88)}`));
  assert.equal(ui.field("Title").props.disabled, false); assert.match(text(ui.render()), /has not been saved yet/);
  await ui.submit(); await ui.flush(); assert.equal(ui.mutate()[0].body.id, id(88)); assert.equal(ui.entries.size, 1); ui.unmount();
});

test("Foundations completion follows the returned progress capability independently of Journal writing", async () => {
  const ui = fixture({ initialMode: "timeline", writable: true, timelineCapabilities: ["profile.write", "foundations.revisit"] }); await ui.flush();
  assert.ok(ui.button("+ Add milestone")); assert.equal(ui.button("Complete Foundations step"), undefined);
  assert.equal(ui.mutate().length, 0); ui.unmount();
});

test("changing a reading filter during full export preparation does not lose the export response", async () => {
  const full = deferred(), values = Array.from({ length: 8 }, (_, index) => entry({ id: id(index + 1), title: `Milestone ${index + 1}`, eventYear: 2020 + index }));
  const ui = fixture({ initialEntries: values, initialMode: "timeline", intercept(call) { if (call.url.pathname === "/api/my/journal/export") return full.promise; } });
  await ui.flush(); await ui.click("Export timeline ↗");
  ui.change("Year", "2020"); await ui.flush(); full.resolve(response({ entries: values })); await ui.flush();
  const studio = ui.find(node => node.type === ui.Export);
  assert.ok(studio, "a reading filter must not discard independently fetched full export data");
  assert.deepEqual(studio.props.entries.map(value => value.id), values.map(value => value.id)); ui.unmount();
});


test("closing and reopening export ignores the earlier request even if it finishes last", async () => {
  const old = deferred(), current = deferred(); let exports = 0;
  const ui = fixture({ initialMode: "timeline", intercept(call) { if (call.url.pathname === "/api/my/journal/export") return ++exports === 1 ? old.promise : current.promise; } });
  await ui.flush(); await ui.click("Export timeline ↗"); await ui.click("Close export"); await ui.click("Export timeline ↗");
  current.resolve(response({ entries: [entry({ title: "Current export" })] })); await ui.flush();
  assert.equal(ui.find(node => node.type === ui.Export).props.entries[0].title, "Current export");
  old.resolve(response({ entries: [entry({ title: "Obsolete export" })] })); await ui.flush();
  assert.equal(ui.find(node => node.type === ui.Export).props.entries[0].title, "Current export"); ui.unmount();
});

test("private Journal requests bind to the verified owner while signed media PUTs receive no owner header", async () => {
  const ownerId = id(909), ui = fixture({ initialEntries: [], ownerId }); await ui.flush();
  await ui.click("+ Add entry"); ui.change("Photos", true); ui.attach([new File(["owner photo"], "owner.jpg", { type: "image/jpeg" })]);
  await ui.submit(); await ui.flush();
  for (const call of ui.calls.filter(call => call.url.pathname.startsWith("/api/my/"))) assert.equal(call.headers.get("x-ruined-session-owner"), ownerId);
  assert.equal(ui.calls.find(call => call.method === "PUT").headers.has("x-ruined-session-owner"), false); ui.unmount();
});

test("closing keeps a draft and files; discarding requires confirmation before clearing and releasing previews", async () => {
  const ui = fixture({ initialEntries: [] }); await ui.flush(); await ui.click("+ Add entry");
  ui.change("Photos", true); const file = new File(["private draft"], "draft.jpg", { type: "image/jpeg" }); ui.attach([file]); ui.change("Title", "Unfinished");
  const url = ui.createdUrls[0].url; await ui.click("Keep draft & close");
  assert.equal(ui.cleared(), 0); assert.equal(ui.guards.at(-1).draft.files[0], file); assert.equal(ui.revoked.includes(url), false);
  await ui.click("Continue entry"); ui.confirm(false); await ui.click("Discard draft");
  assert.equal(ui.field("Title").props.value, "Unfinished"); assert.equal(ui.cleared(), 0);
  ui.confirm(true); await ui.click("Discard draft"); assert.equal(ui.cleared(), 1); assert.ok(ui.revoked.includes(url));
  assert.equal(ui.mutate().length, 0); ui.unmount();
});


test("switching All, Saved and Timeline after unmarking a same-year milestone never repeats year groups", async () => {
  const ui = fixture({ preview: true, captureRenders: true }); await ui.flush(); await ui.click("Timeline");
  await ui.click("+ Add milestone"); ui.change("Title", "September change"); ui.change("Year", "2014"); ui.change("Month", "9");
  await ui.submit(); await ui.flush(); await ui.click("All entries");
  await ui.click("Open entry: September change"); await ui.click("Edit entry"); ui.change("Include on my timeline", false);
  await ui.submit(); await ui.flush();
  ui.render({ view: "saved" }); await ui.flush(); ui.render({ view: "journal" }); await ui.flush();
  ui.rendered.length = 0;
  await ui.click("Timeline");
  assert.ok(ui.rendered.length > 1, "inspect transition renders before filtering effects settle");
  for (const frame of ui.rendered) {
    const groups = nodes(frame).filter(node => node.type === "section" && node.props.className === "storyYear");
    const labels = groups.map(group => group.props["aria-labelledby"]);
    assert.equal(new Set(labels).size, labels.length, "each year must have one keyed section, even during a view transition");
    for (const group of groups) {
      assert.doesNotMatch(text(group), /September change/, "an unmarked entry must never flash inside Timeline");
      assert.notEqual(text(nodes(group).find(node => node.type === "h3")), "0", "undated journal entries do not create a fake year");
    }
  }
  assert.deepEqual(nodes(ui.render()).filter(node => node.type === "section" && node.props.className === "storyYear").map(group => text(nodes(group).find(node => node.type === "h3"))), ["2014", "2026"]);
  assert.equal(ui.mutate().length, 0); ui.unmount();
});
