import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import * as timelineModel from "../src/components/membership/timeline-model.ts";

const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const journalModel = { exports: {} };
new Function("module", "exports", compile("../src/lib/membership/journal-model.ts"))(journalModel, journalModel.exports);
const compiled = compile("../src/components/membership/MemberJournal.tsx");
const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "";
const nodes = node => !React.isValidElement(node) ? [] : [node, ...(node.type.name === "Dialog" && !node.props.open ? [] : React.Children.toArray(node.props.children).flatMap(nodes))];
const item = (overrides = {}) => ({ id: id(1), kind: "text", title: null, body: null, createdAt: "2026-11-04T12:00:00Z", updatedAt: "2026-11-04T12:00:00Z", saved: false, media: [], eventYear: null, eventMonth: null, eventDay: null, includeOnTimeline: false, visibility: "private", version: "1", ...overrides });
const backend = () => ({ entries: new Map(), drafts: new Map(), media: new Map(), sequence: 100 });

// A new fixture is a full component remount. Only the fake server survives it,
// so these tests cannot pass merely because the session recovery guard kept data.
function fixture({ server = backend(), intercept, recoveryDraft = null, writable = true } = {}) {
  const slots = [], calls = [], events = [], navigations = [], frames = new Map(), timers = new Map();
  let cursor = 0, queued = [], changed = false, tree, timerId = 0, confirmed = true;
  const props = { writable, preview: false, sharingEnabled: true, initialMode: "all" };
  const same = (left, right) => left?.length === right?.length && left.every((value, i) => Object.is(value, right[i]));
  const hooks = { ...React,
    useId: () => "journal-drafts-test",
    useState(initial) { const key = cursor++; if (!(key in slots)) slots[key] = typeof initial === "function" ? initial() : initial; return [slots[key], next => { const value = typeof next === "function" ? next(slots[key]) : next; changed ||= !Object.is(value, slots[key]); slots[key] = value; }]; },
    useRef(initial) { const key = cursor++; return slots[key] ??= { current: initial }; },
    useMemo(factory, dependencies) { const key = cursor++; if (!slots[key] || !same(slots[key].dependencies, dependencies)) slots[key] = { dependencies, value: factory() }; return slots[key].value; },
    useCallback(callback, dependencies) { return hooks.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) { const key = cursor++, previous = slots[key]; if (!previous || !same(previous.dependencies, dependencies)) { const current = { dependencies }; slots[key] = current; queued.push(() => { previous?.cleanup?.(); current.cleanup = callback(); }); } },
  };
  const list = (source, url) => {
    const values = [...source.values()].filter(entry => !url.searchParams.get("search") || `${entry.title} ${entry.body}`.includes(url.searchParams.get("search")));
    return response({ entries: structuredClone(values), total: values.length, hasMore: false, nextCursor: null, years: [], mediaReady: true, writable, publicUrl: "/profile/test-member" });
  };
  async function fakeFetch(href, init = {}) {
    const url = new URL(href, "https://members.example.test"), method = init.method ?? "GET", body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    const call = { url, method, body, headers: new Headers(init.headers) }; calls.push(call);
    const overridden = intercept ? await intercept(call) : undefined;
    if (overridden !== undefined) return overridden;
    if (method === "PUT") return response({});
    if (url.pathname === "/api/my/timeline") return response({ timeline: { completedAt: null, access: { capabilities: [] } } });
    if (url.pathname === "/api/my/journal/media") {
      const mediaId = id(++server.sequence);
      server.media.set(mediaId, { id: mediaId, mimeType: body.mimeType, size: body.size, url: `/api/my/journal/media/${mediaId}` });
      return response({ id: mediaId, signedUrl: `https://uploads.example.test/${mediaId}` });
    }
    const isDraft = url.pathname.startsWith("/api/my/journal/drafts"), source = isDraft ? server.drafts : server.entries;
    if (["/api/my/journal", "/api/my/journal/drafts"].includes(url.pathname) && method === "GET") return list(source, url);
    const currentId = url.pathname.split("/").at(-1), existing = source.get(currentId);
    if (method === "GET") return existing ? response({ entry: structuredClone(existing) }) : response({ error: "Entry not found." }, 404);
    if (method === "DELETE") { source.delete(currentId); return response({ ok: true }); }
    if (method === "PATCH" && (!existing || existing.version !== body.expectedVersion)) return response({ error: "Load the latest entry before saving." }, 409);
    const value = item({ ...existing, ...body, id: body.id ?? currentId, version: String(Number(existing?.version ?? "0") + 1), media: (body.mediaIds ?? []).map(mediaId => server.media.get(mediaId)) });
    if (method === "POST" && source.has(value.id)) return response({ entry: structuredClone(source.get(value.id)) });
    if (isDraft && body.action === "complete") { source.delete(value.id); server.entries.set(value.id, value); }
    else source.set(value.id, value);
    return response({ entry: structuredClone(value) });
  }
  const window = {
    location: { hash: "" }, history: { state: null, replaceState(_state, _title, hash) { window.location.hash = hash; } }, addEventListener() {}, removeEventListener() {},
    dispatchEvent(event) { events.push(event.type); return true; },
    requestAnimationFrame(callback) { const key = ++timerId; frames.set(key, callback); return key; }, cancelAnimationFrame(key) { frames.delete(key); },
    setTimeout(callback) { const key = ++timerId; timers.set(key, callback); return key; }, clearTimeout(key) { timers.delete(key); },
    confirm: () => confirmed,
  };
  class FakeURL extends URL { static createObjectURL() { return `blob:draft-${++server.sequence}`; } static revokeObjectURL() {} }
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "fetch", "URL", "crypto", compiled)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/lib/membership/journal-model") return journalModel.exports;
    if (name === "./timeline-model") return timelineModel;
    if (name === "./TimelineGraphics" || name === "./TimelineExportStudio" || name === "./TimelineStoryContent") return { __esModule: true, default: () => null };
    if (name === "./useJournalDraftGuard") return { __esModule: true, default: () => ({ ownerId: id(900), recoveryDraft, dismissRecovery() { recoveryDraft = null; }, clearDraft() { recoveryDraft = null; } }) };
    if (name === "next/link") return { __esModule: true, default: "a" };
    if (name === "next/navigation") return { useRouter: () => ({ push: href => navigations.push(href) }) };
    if (name === "next/image") return { __esModule: true, default: "image" };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw Error(`Unexpected Journal dependency ${name}`);
  }, loaded, loaded.exports, window, fakeFetch, FakeURL, { randomUUID: () => id(++server.sequence) });
  function render(nextProps) {
    Object.assign(props, nextProps); let attempts = 0;
    do { assert.ok(attempts++ < 16, "Journal effects should settle"); cursor = 0; queued = []; changed = false; tree = loaded.exports.default(props); queued.forEach(callback => callback()); } while (changed);
    for (const node of nodes(tree)) if (node.type === "input" && node.props.ref) node.props.ref.current = { focus() {} };
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); return tree;
  }
  async function flush() { for (let index = 0; index < 24; index++) { await Promise.resolve(); render(); } return tree; }
  const find = predicate => nodes(render()).find(predicate);
  const button = label => find(node => node.type === "button" && (text(node) === label || node.props["aria-label"] === label));
  const field = label => {
    const scope = find(node => node.type === "form") ?? render();
    const container = nodes(scope).find(node => node.type === "label" && text(node).startsWith(label));
    assert.ok(container, `Missing field ${label}`);
    return nodes(container).find(node => ["input", "textarea", "select"].includes(node.type));
  };
  return { server, calls, events, navigations, render, flush, find, button, field,
    async click(label) { const control = button(label); assert.ok(control, `Missing button ${label}`); assert.equal(Boolean(control.props.disabled), false, `${label} should be enabled`); control.props.onClick(); return flush(); },
    change(label, value) { field(label).props.onChange({ target: { value, checked: value } }); return render(); },
    submit() { return find(node => node.type === "form").props.onSubmit({ preventDefault() {}, nativeEvent: { submitter: { getAttribute: () => null } } }); },
    attach(files) { find(node => node.type === "input" && node.props.type === "file").props.onChange({ target: { files, value: "picked" } }); return render(); },
    mutate() { return calls.filter(call => ["POST", "PATCH", "DELETE"].includes(call.method)); },
    confirm(value) { confirmed = value; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); frames.clear(); },
  };
}

async function start(ui) { await ui.click("New +"); if (ui.button("Journal (Private)")) await ui.click("Journal (Private)"); }

test("Journal supports two independent saved drafts, a fresh entry, and reopening either after refresh", async () => {
  const server = backend(), ui = fixture({ server }); await ui.flush();
  await start(ui); ui.change("Title", "First unfinished thought"); ui.change("Your words", "Words for later."); await ui.click("Save draft");
  assert.equal(ui.find(node => node.type === "form"), undefined, "saving closes the composer and frees the next entry");
  assert.equal(server.drafts.size, 1); assert.equal(server.entries.size, 0); assert.deepEqual(ui.events, []);
  const firstId = [...server.drafts.keys()][0];
  await start(ui); assert.equal(ui.field("Title").props.value, ""); assert.equal(ui.field("Your words").props.value, "");
  ui.change("Title", "A second thought"); await ui.click("Save draft");
  assert.equal(server.drafts.size, 2); assert.notEqual([...server.drafts.keys()][1], firstId);
  for (const call of ui.mutate()) { assert.equal(call.url.pathname, "/api/my/journal/drafts"); assert.equal(call.body.visibility, "private"); assert.equal(call.body.includeOnTimeline, false); }
  ui.unmount();
  const returned = fixture({ server }); await returned.flush(); await returned.click("View drafts");
  assert.ok(returned.button("Open draft: First unfinished thought")); assert.ok(returned.button("Open draft: A second thought"));
  await returned.click("Open draft: First unfinished thought"); assert.equal(returned.field("Your words").props.value, "Words for later.");
  returned.change("Your words", "Edited after returning."); await returned.click("Save draft");
  assert.equal(server.drafts.size, 2); assert.equal(server.drafts.get(firstId).body, "Edited after returning.");
  await returned.click("View drafts"); await returned.click("Open draft: A second thought");
  assert.equal(returned.field("Your words").props.value, ""); returned.unmount();
});

test("finishing a saved draft promotes the same record once and reports progress only then", async () => {
  const ui = fixture(); await ui.flush(); await start(ui); ui.change("Your words", "A thought to finish."); await ui.click("Save draft");
  const draftId = [...ui.server.drafts.keys()][0]; assert.deepEqual(ui.events, []);
  await ui.click("View drafts"); await ui.click("Open draft: A thought to finish.");
  await ui.submit(); await ui.flush();
  const writes = ui.mutate(); assert.equal(writes.at(-1).method, "PATCH"); assert.equal(writes.at(-1).url.pathname, `/api/my/journal/drafts/${draftId}`);
  assert.equal(writes.at(-1).body.action, "complete"); assert.equal(writes.at(-1).body.expectedVersion, "1");
  assert.equal(ui.server.drafts.size, 0); assert.equal(ui.server.entries.size, 1); assert.ok(ui.server.entries.has(draftId));
  assert.equal(ui.server.entries.get(draftId).visibility, "private"); assert.deepEqual(ui.events, ["ruined:member-progress"]); ui.unmount();
});

test("a failed draft save keeps the entry available and never announces completion", async () => {
  const ui = fixture({ intercept: call => call.url.pathname === "/api/my/journal/drafts" && call.method === "POST" ? response({ error: "Your draft could not be saved right now." }, 503) : undefined });
  await ui.flush(); await start(ui); ui.change("Your words", "Keep these exact words."); await ui.click("Save draft");
  assert.equal(ui.field("Your words").props.value, "Keep these exact words."); assert.equal(ui.server.drafts.size, 0);
  assert.match(text(ui.render()), /could not be saved/); assert.deepEqual(ui.events, []); ui.unmount();
});

test("a pending draft save cannot submit a duplicate or replace the composer", async () => {
  const pending = deferred();
  const ui = fixture({ intercept: call => call.url.pathname === "/api/my/journal/drafts" && call.method === "POST" ? pending.promise : undefined });
  await ui.flush(); await start(ui); ui.change("Your words", "Save just once.");
  const save = ui.button("Save draft"); save.props.onClick(); save.props.onClick(); await ui.flush();
  assert.equal(ui.mutate().length, 1); assert.equal(ui.button("Continue entry")?.props.disabled, true);
  pending.resolve(response({ entry: item({ id: ui.mutate()[0].body.id, body: "Save just once." }) })); await ui.flush();
  assert.equal(ui.find(node => node.type === "form"), undefined); assert.deepEqual(ui.events, []); ui.unmount();
});

test("editing a finished private Journal entry cannot demote it into a draft", async () => {
  const server = backend(); server.entries.set(id(1), item({ title: "Already in my Journal", body: "A finished entry." }));
  const ui = fixture({ server }); await ui.flush(); await ui.click("Open entry: Already in my Journal"); await ui.click("Edit entry");
  assert.equal(ui.button("Save draft"), undefined); ui.change("Your words", "A considered update."); await ui.submit(); await ui.flush();
  assert.equal(server.drafts.size, 0); assert.equal(server.entries.size, 1); assert.equal(ui.mutate()[0].url.pathname, `/api/my/journal/${id(1)}`); ui.unmount();
});

test("draft attachments survive a remount without uploading again when the entry is completed", async () => {
  const server = backend(), ui = fixture({ server }); await ui.flush(); await start(ui);
  ui.change("Photos", true); ui.change("Title", "An unfinished photograph");
  ui.attach([new File(["private photograph"], "memory.jpg", { type: "image/jpeg" })]); await ui.click("Save draft");
  const saved = [...server.drafts.values()][0]; assert.equal(saved.media.length, 1);
  const mediaId = saved.media[0].id;
  assert.equal(ui.calls.filter(call => call.method === "PUT").length, 1);
  assert.equal(ui.calls.find(call => call.method === "PUT").headers.has("x-ruined-session-owner"), false, "the signed upload must not receive member identity headers");
  ui.unmount();
  const returned = fixture({ server }); await returned.flush(); await returned.click("View drafts"); await returned.click("Open draft: An unfinished photograph");
  assert.ok(returned.find(node => node.type === "image" && node.props.src === `/api/my/journal/media/${mediaId}`));
  await returned.submit(); await returned.flush();
  assert.equal(returned.calls.some(call => call.method === "PUT"), false);
  assert.deepEqual(server.entries.get(saved.id).media.map(value => value.id), [mediaId]); returned.unmount();
});

test("saving an unfinished entry as a draft never publishes a checked Timeline destination", async () => {
  const ui = fixture(); await ui.flush(); await start(ui); ui.change("Your words", "Still thinking about this."); ui.change("Add to Timeline", true);
  await ui.click("Save draft");
  const write = ui.mutate().at(-1);
  assert.equal(write.url.pathname, "/api/my/journal/drafts"); assert.equal(write.body.visibility, "private"); assert.equal(write.body.includeOnTimeline, false);
  assert.equal(ui.server.entries.size, 0); assert.deepEqual(ui.events, []); ui.unmount();
});
