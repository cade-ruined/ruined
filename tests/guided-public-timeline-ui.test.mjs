import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import * as timelineModel from "../src/components/membership/timeline-model.ts";

const require = createRequire(import.meta.url);
const journalModel = {};
new Function("exports", ts.transpileModule(readFileSync(new URL("../src/lib/membership/journal-model.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(journalModel);
const output = ts.transpileModule(readFileSync(new URL("../src/components/membership/GuidedTimeline.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "";
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && (node.props["aria-label"] ?? text(node).replace(/\s+/g, " ").trim()) === label);
const control = (tree, id) => nodes(tree).find(node => node.props.id === id);
const disclosure = (tree, label) => nodes(tree).find(node => node.type === "details" && React.Children.toArray(node.props.children).some(child => React.isValidElement(child) && child.type === "summary" && text(child).trim().startsWith(label)));
const form = tree => nodes(tree).find(node => node.type === "form");
const responses = { meaning: "I thought I had to manage alone.", belief: "Asking for help was a burden.", presentImpact: "I try to solve everything first.", perspective: "Connection can begin by asking." };
const entry = (overrides = {}) => ({ id: "11111111-1111-4111-8111-111111111111", kind: "text", title: "Moved to a new city", body: "No familiar faces.", eventYear: 2008, eventMonth: 6, eventDay: 12, includeOnTimeline: true, visibility: "private", createdAt: "2026-10-20T12:00:00Z", version: "4", saved: false, media: [], ...overrides });
const snapshot = (entries = [], extras = {}) => ({ entries, writable: true, mediaReady: true, hasMore: false, nextCursor: null, ...extras });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ initialJournal = snapshot(), preview = false, ownerId = "owner-a", recoveryDraft = null, fetchOverride, initialEntryId, startNew = false } = {}) {
  const slots = [], effects = [], requests = [], guardStates = [], navigations = [], uploads = new Map();
  let cursor = 0, newId = 0, cleared = 0;
  const saved = new Map(initialJournal.entries.map(e => [e.id, structuredClone(e)]));
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((v, n) => !Object.is(v, prior.deps[n]))) { const state = { deps }; slots[i] = state; effects.push(() => { prior?.cleanup?.(); state.cleanup = effect(); }); } },
  };
  const fetch = async (url, init = {}) => {
    const request = { url, method: init.method ?? "GET", value: typeof init.body === "string" ? JSON.parse(init.body) : null, body: init.body, signal: init.signal, owner: new Headers(init.headers).get("x-ruined-session-owner") }; requests.push(request);
    if (fetchOverride) { const custom = await fetchOverride(request, saved); if (custom) return custom; }
    if (url === "/api/my/timeline") return json({ timeline: { access: { capabilities: [] }, completedAt: null } });
    if (url === "/api/my/journal/media") { const id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(uploads.size + 1).padStart(12, "0")}`; uploads.set(id, { id, ...request.value, url: `/api/my/journal/media/${id}` }); return json({ id, signedUrl: `https://upload.example.test/${id}` }); }
    if (request.method === "PUT") return json({});
    if (request.method === "GET") {
      if (url.includes("?")) return json(snapshot([...saved.values()]));
      const value = saved.get(url.split("/").at(-1)); return value ? json({ entry: value }) : json({ error: "Not found." }, 404);
    }
    const fields = request.value;
    const id = fields.id ?? url.split("/").at(-1);
    try {
      if (request.method === "POST") journalModel.validateJournalInput(fields);
      else journalModel.validateJournalEdit(fields, id);
    } catch (error) {
      return json({ error: error.message }, error.status ?? 400);
    }
    const previous = saved.get(id);
    const next = entry({ ...previous, ...fields, id, version: String(Number(previous?.version ?? "0") + 1), media: fields.mediaIds.map(id => uploads.get(id) ?? previous?.media.find(item => item.id === id)).filter(Boolean), title: fields.title.trim() || null, body: fields.body.trim() || null });
    delete next.action; delete next.expectedVersion; delete next.mediaIds;
    saved.set(id, next); return json({ entry: next });
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "document", "HTMLElement", "fetch", "crypto", output)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "a" };
    if (name === "next/image") return { __esModule: true, default: "img" };
    if (name === "next/navigation") return { useRouter: () => ({ push: url => navigations.push(url) }) };
    if (name === "@/lib/membership/journal-model") return journalModel;
    if (name === "./MemberTimelineDraftState") return { copyPublicTimelineMedia: media => ({ ...media, keptMedia: media.keptMedia.map(item => ({ ...item })), files: [...media.files], uploadIds: media.uploadIds.map(pair => [...pair]) }) };
    if (name === "./timeline-model") return timelineModel;
    if (name === "./useTimelineDraftGuard") return { __esModule: true, default: state => { guardStates.push(state); return { recoveryDraft, dismissRecovery() { recoveryDraft = null; }, clearDraft() { cleared++; } }; } };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, property) => property }) };
    throw Error(`Unexpected guided Timeline dependency ${name}`);
  }, loaded, loaded.exports, { requestAnimationFrame(callback) { callback(); }, dispatchEvent() {}, location: { origin: "https://members.example.test", assign: url => navigations.push(url) } }, { activeElement: null }, class {}, fetch, { randomUUID: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++newId).padStart(12, "0")}` });
  const props = { initialJournal, preview, ownerId, initialEntryId, startNew };
  const render = () => { cursor = 0; const tree = loaded.exports.default(props); effects.splice(0).forEach(effect => effect()); return tree; };
  const change = (id, value) => control(render(), id).props.onChange({ target: { value } });
  const attach = files => control(render(), "timeline-attachments").props.onChange({ target: { files, value: "" } });
  const submit = () => form(render()).props.onSubmit({ preventDefault() {} });
  const click = async label => { const b = button(render(), label); assert.ok(b, `Missing button: ${label}`); b.props.onClick({ preventDefault() {} }); await tick(); };
  return { render, change, attach, submit, click, requests, writes: () => requests.filter(r => r.method !== "GET"), saved, guardStates, navigations, cleared: () => cleared, unmount: () => { for (const slot of slots) slot?.cleanup?.(); } };
}
async function fillStory(ui) {
  if (!control(ui.render(), "timeline-event")) await ui.click("Add a title");
  ui.change("timeline-year", "2014");
  ui.change("timeline-event", "Starting over");
  ui.change("timeline-details", "A new room and a new beginning.");
  for (const [field, response] of Object.entries(responses)) ui.change(`timeline-${field}`, response);
}

test("the page starts with a blank composer instead of editing the first saved story", () => {
  const ui = fixture({ initialJournal: snapshot([entry({ body: "Private unfinished words.", legacyTimelineReflection: responses }), entry({ id: "22222222-2222-4222-8222-222222222222", title: "An existing public post", visibility: "public" })]) });
  assert.equal(control(ui.render(), "timeline-details").props.value, "");
  assert.equal(disclosure(ui.render(), "Go deeper").props.open, false);
  for (const field of Object.keys(responses)) assert.equal(control(ui.render(), `timeline-${field}`).props.value, "");
  assert.equal(button(ui.render(), "Post").props.disabled, true);
  assert.equal(ui.writes().length, 0);
  ui.unmount();
});

test("Posts and Drafts keep private entries separate and editing is an explicit action", async () => {
  const published = entry({ visibility: "public", title: "A public moment", body: "A visible thought." });
  const privateDraft = entry({ id: "33333333-3333-4333-8333-333333333333", title: "My private draft", body: "Private unfinished context.", legacyTimelineReflection: responses });
  const ui = fixture({ initialJournal: snapshot([privateDraft, published]) });
  const cards = () => nodes(ui.render()).filter(node => node.type === "article" && node.props["aria-label"]);
  assert.equal(button(ui.render(), "Posts").props["aria-pressed"], true);
  assert.deepEqual(cards().map(node => node.props["aria-label"]), [published.title]);
  assert.doesNotMatch(text(ui.render()), /Private unfinished context/);
  await ui.click("Drafts");
  assert.equal(button(ui.render(), "Drafts").props["aria-pressed"], true);
  assert.deepEqual(cards().map(node => node.props["aria-label"]), [privateDraft.title]);
  assert.match(text(cards()[0]), /Private draft/);
  assert.equal(control(ui.render(), "timeline-details").props.value, "");
  await ui.click(`Edit ${privateDraft.title}`);
  assert.equal(control(ui.render(), "timeline-details").props.value, privateDraft.body);
  assert.equal(disclosure(ui.render(), "Go deeper").props.open, true);
  for (const [field, value] of Object.entries(responses)) assert.equal(control(ui.render(), `timeline-${field}`).props.value, value);
  assert.equal(ui.writes().length, 0);
  ui.unmount();
});

test("long post bodies keep their full text behind Read more while short posts need no disclosure", () => {
  const long = entry({ visibility: "public", title: "A longer story", body: "A little more context. ".repeat(40) });
  const short = entry({ id: "33333333-3333-4333-8333-333333333333", visibility: "public", title: "A short update", body: "One small moment." });
  const ui = fixture({ initialJournal: snapshot([long, short]) });
  const card = label => nodes(ui.render()).find(node => node.type === "article" && node.props["aria-label"] === label);
  const longCard = card(long.title), shortCard = card(short.title);
  assert.ok(disclosure(longCard, "Read more"));
  assert.equal(disclosure(longCard, "Read more").props.open, undefined);
  assert.ok(text(longCard).includes(long.body));
  assert.equal(nodes(longCard).find(node => node.type === "p" && text(node) === long.body).props["data-long"], true);
  assert.equal(disclosure(shortCard, "Read more"), undefined);
  assert.ok(text(shortCard).includes(short.body));
  ui.unmount();
});

test("one composer collects a public story and optional reflections without an intermediate save or review", async () => {
  const ui = fixture(); await fillStory(ui);
  assert.equal(ui.writes().length, 0);
  assert.ok(control(ui.render(), "timeline-details"));
  assert.equal(button(ui.render(), "Review my story"), undefined);
  assert.equal(button(ui.render(), "Next"), undefined);
  assert.equal(button(ui.render(), "Post").props.disabled, false);
  await ui.submit();
  assert.equal(ui.writes().length, 1);
  assert.equal(ui.writes()[0].owner, "owner-a");
  assert.equal(ui.writes()[0].value.visibility, "public");
  assert.equal(ui.writes()[0].value.includeOnTimeline, true);
  assert.deepEqual(ui.writes()[0].value.timelineReflection, responses);
  assert.equal(ui.saved.size, 1);
  assert.equal(ui.guardStates.at(-1).scope, "public-timeline");
  ui.unmount();
});

test("private drafts remain private and require a separate explicit publication", async () => {
  const ui = fixture(); await fillStory(ui); await ui.click("Save private draft");
  assert.equal(ui.writes()[0].value.visibility, "private");
  assert.match(text(ui.render()), /Saved privately in your Journal/);
  assert.equal(button(ui.render(), "Post").props.disabled, false);
  await ui.submit();
  assert.equal(ui.writes()[1].method, "PATCH");
  assert.equal(ui.writes()[1].value.expectedVersion, "1");
  assert.equal(ui.writes()[1].value.visibility, "public"); ui.unmount();
});

test("a text-only private draft gets a valid visible title and stays private until Post", async () => {
  const ui = fixture();
  ui.change("timeline-details", "A thought I am still working through.\nMore private context.");
  await ui.click("Save private draft");
  assert.equal(ui.saved.size, 1);
  const draft = ui.writes()[0].value;
  assert.equal(draft.visibility, "private");
  assert.equal(draft.title, "A thought I am still working through.");
  assert.equal(draft.timelineReflection, null);
  assert.equal(control(ui.render(), "timeline-event").props.value, draft.title);
  assert.equal(button(ui.render(), "Post").props.disabled, false);
  await ui.submit();
  assert.equal(ui.writes()[1].method, "PATCH");
  assert.equal(ui.writes()[1].value.expectedVersion, "1");
  assert.equal(ui.writes()[1].value.visibility, "public");
  assert.equal(ui.saved.size, 1);
  ui.unmount();
});

test("legacy private reflections are reviewed but never published by opening them", async () => {
  const ui = fixture({ initialJournal: snapshot([entry({ legacyTimelineReflection: responses })]), initialEntryId: entry().id });
  assert.equal(disclosure(ui.render(), "Go deeper").props.open, true);
  for (const [field, value] of Object.entries(responses)) assert.equal(control(ui.render(), `timeline-${field}`).props.value, value);
  assert.match(text(ui.render()), /Private draft/); assert.equal(ui.writes().length, 0);
  await ui.submit(); assert.equal(ui.writes().length, 1);
  assert.deepEqual(ui.writes()[0].value.timelineReflection, responses);
  assert.equal(ui.writes()[0].value.visibility, "public"); ui.unmount();
});

test("reflection edits preserve attachment identities, exact dates, long context, and version", async () => {
  const body = "Long context. ".repeat(700);
  const media = [{ id: "22222222-2222-4222-8222-222222222222", url: "/api/my/journal/media/test", mimeType: "image/jpeg", size: 20 }];
  const ui = fixture({ initialJournal: snapshot([entry({ kind: "images", body, media, visibility: "public", timelineReflection: responses })]), initialEntryId: entry().id });
  ui.change("timeline-belief", "A different belief."); await ui.submit();
  const write = ui.writes()[0];
  assert.equal(write.method, "PATCH"); assert.equal(write.value.expectedVersion, "4");
  assert.equal(write.value.eventDay, 12); assert.equal(write.value.body, body);
  assert.equal(write.value.kind, "images"); assert.deepEqual(write.value.mediaIds, [media[0].id]);
  assert.equal(write.value.timelineReflection.belief, "A different belief."); ui.unmount();
});

test("ambiguous create freezes writes, reconciles, and retries the same identifier", async () => {
  let fail = true;
  const ui = fixture({ fetchOverride(request) { if (request.method === "POST" && request.url === "/api/my/journal" && fail) { fail = false; throw Error("Network lost"); } } });
  await fillStory(ui); await ui.submit();
  const id = ui.writes()[0].value.id;
  assert.equal(button(ui.render(), "Post").props.disabled, true);
  assert.equal(control(ui.render(), "timeline-belief").props.disabled, true);
  await ui.submit(); assert.equal(ui.writes().length, 1);
  await ui.click("Load latest saved story"); await ui.click("Keep draft and retry"); await ui.submit();
  assert.equal(ui.writes().length, 2); assert.equal(ui.writes()[1].value.id, id);
  assert.equal(ui.saved.size, 1); ui.unmount();
});

test("a committed but unconfirmed create is reconciled without a duplicate", async () => {
  let fail = true;
  const ui = fixture({ fetchOverride(request, saved) {
    if (request.method === "POST" && request.url === "/api/my/journal" && fail) { fail = false; saved.set(request.value.id, entry({ ...request.value, version: "1", media: [] })); throw Error("Response lost"); }
  } });
  await fillStory(ui); await ui.submit(); await ui.click("Load latest saved story");
  assert.equal(ui.writes().length, 1); assert.equal(ui.saved.size, 1);
  assert.equal(button(ui.render(), "Save changes").props.disabled, true);
  assert.match(text(ui.render()), /Your story is published on your Timeline/); ui.unmount();
});

test("an unconfirmed private save reconciles the generated title without exposing or duplicating it", async () => {
  let fail = true;
  const ui = fixture({ fetchOverride(request, saved) {
    if (request.method === "POST" && request.url === "/api/my/journal" && fail) { fail = false; saved.set(request.value.id, entry({ ...request.value, version: "1", media: [] })); throw Error("Response lost"); }
  } });
  ui.change("timeline-details", "Private words without a title.");
  await ui.click("Save private draft");
  assert.equal(control(ui.render(), "timeline-event").props.value, "Private words without a title.");
  assert.equal(button(ui.render(), "Post").props.disabled, true);
  await ui.click("Load latest saved story");
  assert.equal(ui.writes().length, 1);
  assert.equal(ui.saved.size, 1);
  assert.equal([...ui.saved.values()][0].visibility, "private");
  assert.equal(button(ui.render(), "Post").props.disabled, false);
  assert.doesNotMatch(text(ui.render()), /Your story is published on your Timeline/);
  ui.unmount();
});

test("read-only and unverified sessions cannot publish, and missing targets do not open another story", async () => {
  for (const options of [{ initialJournal: snapshot([entry()], { writable: false }) }, { initialJournal: snapshot([entry()]), ownerId: null }]) {
    const ui = fixture(options); ui.render();
    assert.equal(button(ui.render(), "Post"), undefined);
    assert.equal(form(ui.render()), undefined);
    assert.equal(control(ui.render(), "timeline-details"), undefined);
    assert.equal(control(ui.render(), "timeline-attachments"), undefined);
    assert.equal(ui.writes().length, 0); ui.unmount();
  }
  const missing = fixture({ initialJournal: snapshot([entry()]), initialEntryId: "missing" });
  assert.match(text(missing.render()), /This moment isn’t available/); assert.equal(form(missing.render()).props.hidden, true); missing.unmount();
});

test("preview writing uses only local state and truthfully describes publication", async () => {
  const ui = fixture({ preview: true, initialJournal: snapshot([], { writable: false }), ownerId: undefined });
  await fillStory(ui); await ui.submit();
  assert.equal(ui.requests.length, 0); assert.match(text(ui.render()), /Nothing was published to an account/); ui.unmount();
});

test("a text-only post needs no title, reflection answers, or review step", async () => {
  const today = new Date();
  const ui = fixture();
  ui.change("timeline-details", "A small moment worth sharing.");
  assert.equal(ui.writes().length, 0);
  await ui.submit();
  assert.equal(ui.writes().length, 1);
  const write = ui.writes()[0].value;
  assert.equal(write.visibility, "public");
  assert.equal(write.includeOnTimeline, true);
  assert.equal(write.title, "");
  assert.equal(write.body, "A small moment worth sharing.");
  assert.equal(write.timelineReflection, null);
  assert.equal(write.eventYear, today.getFullYear());
  assert.equal(write.eventMonth, today.getMonth() + 1);
  assert.equal(write.eventDay, today.getDate());
  assert.equal(ui.saved.size, 1);
  assert.equal(control(ui.render(), "timeline-details").props.value, "");
  ui.unmount();
});

test("a version conflict requires reviewing the latest story before an intentional overwrite", async () => {
  let conflict = true;
  const original = entry({ visibility: "public", timelineReflection: responses });
  const ui = fixture({ initialJournal: snapshot([original]), initialEntryId: original.id, fetchOverride(request, saved) {
    if (request.method === "PATCH" && conflict) {
      conflict = false; saved.set(original.id, { ...original, version: "5", timelineReflection: { ...responses, belief: "Saved elsewhere." } });
      return json({ error: "This story changed in another tab." }, 409);
    }
  } });
  ui.change("timeline-belief", "My considered change."); await ui.submit();
  assert.equal(button(ui.render(), "Save changes").props.disabled, true);
  await ui.click("Load latest saved story");
  assert.match(text(ui.render()), /Saved elsewhere/);
  assert.equal(control(ui.render(), "timeline-belief").props.value, "My considered change.");
  await ui.click("Keep my draft for this story"); await ui.submit();
  assert.equal(ui.writes()[1].value.expectedVersion, "5");
  assert.equal(ui.writes()[1].value.timelineReflection.belief, "My considered change."); ui.unmount();
});

test("date editing preserves an exact day until its month changes", async () => {
  const ui = fixture({ initialJournal: snapshot([entry({ timelineReflection: responses })]), initialEntryId: entry().id });
  assert.match(text(ui.render()), /Jun(?:e)? 12, 2008/);
  ui.change("timeline-month", "2"); await ui.submit();
  assert.equal(ui.writes()[0].value.eventDay, null);
  assert.equal(ui.writes()[0].value.eventMonth, 2); ui.unmount();
});

test("choosing an approximate month in the same month clears the day and enables Save changes", async () => {
  const ui = fixture({ initialJournal: snapshot([entry({ visibility: "public", timelineReflection: responses })]), initialEntryId: entry().id });
  assert.equal(button(ui.render(), "Save changes").props.disabled, true);
  ui.change("timeline-month", "6");
  assert.equal(button(ui.render(), "Save changes").props.disabled, false);
  await ui.submit();
  assert.equal(ui.writes().length, 1);
  assert.equal(ui.writes()[0].value.eventYear, 2008);
  assert.equal(ui.writes()[0].value.eventMonth, 6);
  assert.equal(ui.writes()[0].value.eventDay, null);
  ui.unmount();
});

test("recovering an unfinished new draft keeps its stable request identifier", async () => {
  const recoveredId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000099";
  const ui = fixture({ recoveryDraft: { form: { year: "2014", month: "", title: "Recovered", details: "Words", ...responses }, baseline: { year: "", month: "", title: "", details: "", meaning: "", belief: "", presentImpact: "", perspective: "" }, editingEntryId: recoveredId, revision: "", wasPending: false } });
  ui.render(); await ui.click("Restore draft");
  assert.equal(ui.guardStates.at(-1).scope, "public-timeline");
  await ui.submit(); assert.equal(ui.writes()[0].value.id, recoveredId);
  assert.equal(ui.writes()[0].value.visibility, "public"); ui.unmount();
});

test("restoring a new post with a Today baseline does not mistake it for a saved entry", async () => {
  const today = new Date();
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-000000000098";
  const baseline = { year: String(today.getFullYear()), month: String(today.getMonth() + 1), title: "", details: "", meaning: "", belief: "", presentImpact: "", perspective: "" };
  const ui = fixture({ recoveryDraft: { form: { ...baseline, details: "Unfinished new post." }, baseline, editingEntryId: id, revision: "", wasPending: false } });
  await ui.click("Restore draft");
  assert.equal(button(ui.render(), "Post").props.disabled, false);
  assert.equal(button(ui.render(), "Load latest saved story"), undefined);
  await ui.submit();
  const writes = ui.requests.filter(request => request.url === "/api/my/journal" && request.method === "POST");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value.id, id);
  assert.equal(writes[0].value.body, "Unfinished new post.");
  assert.equal(writes[0].value.timelineReflection, null);
  assert.equal(ui.requests.filter(request => request.method === "PATCH").length, 0);
  assert.equal(ui.saved.size, 1);
  ui.unmount();
});

test("a recovered new post preserves its exact date without pretending to be persisted", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-000000000097";
  const baseline = { year: "2026", month: "10", title: "", details: "", meaning: "", belief: "", presentImpact: "", perspective: "" };
  const ui = fixture({ recoveryDraft: { form: { ...baseline, details: "Started writing on another day." }, baseline, editingEntryId: id, revision: "", wasPending: false,
    publicTimelineMedia: { kind: "text", keptMedia: [], files: [], uploadIds: [], attemptedVisibility: null, editingExisting: false, eventDay: 17, baselineEventDay: 17 } } });
  await ui.click("Restore draft"); await ui.submit();
  assert.equal(ui.writes().length, 1);
  assert.equal(ui.writes()[0].method, "POST");
  assert.equal(ui.writes()[0].value.eventDay, 17);
  assert.equal(ui.writes()[0].value.id, id);
  ui.unmount();
});

test("optional photos upload through the private media pipeline before explicit publication", async () => {
  const ui = fixture(); await fillStory(ui);
  const photos = [new File(["photo one"], "one.jpg", { type: "image/jpeg" }), new File(["photo two"], "two.png", { type: "image/png" })];
  ui.attach(photos); assert.equal(ui.writes().length, 0);
  await ui.submit();
  const uploads = ui.requests.filter(request => request.url === "/api/my/journal/media");
  const puts = ui.requests.filter(request => request.method === "PUT");
  const write = ui.requests.find(request => request.url === "/api/my/journal" && request.method === "POST");
  assert.equal(uploads.length, 2); assert.equal(puts.length, 2);
  assert.ok(uploads.every(request => request.owner === "owner-a"));
  assert.ok(puts.every(request => request.owner === null && request.body instanceof FormData));
  assert.equal(write.value.kind, "images"); assert.equal(write.value.mediaIds.length, 2); assert.equal(write.value.visibility, "public");
  assert.equal([...ui.saved.values()][0].media.length, 2); ui.unmount();
});

test("a photo can be posted directly without a required title or body", async () => {
  const ui = fixture();
  ui.attach([new File(["one photo"], "moment.jpg", { type: "image/jpeg" })]);
  await ui.submit();
  const write = ui.requests.find(request => request.url === "/api/my/journal" && request.method === "POST");
  assert.equal(write.value.title, ""); assert.equal(write.value.body, "");
  assert.equal(write.value.kind, "images"); assert.equal(write.value.mediaIds.length, 1);
  assert.equal(write.value.timelineReflection, null);
  assert.equal(ui.saved.size, 1);
  assert.ok(nodes(ui.render()).some(node => node.type === "img" && node.props.alt === "Post photograph 1"));
  ui.unmount();
});

test("attachment selection rejects oversized, unsupported, mixed, and excess files", async () => {
  for (const [files, message] of [
    [[{ type: "image/jpeg", size: 8 * 1024 * 1024 + 1 }], /under 8 MB/],
    [[{ type: "video/mp4", size: 50 * 1024 * 1024 + 1 }], /under 50 MB/],
    [[{ type: "image/heic", size: 5 }], /Choose JPG, PNG, WebP, MP4, or WebM/],
    [[new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.mp4", { type: "video/mp4" })], /Use photos or one video/],
    [Array.from({ length: 9 }, () => new File(["a"], "a.jpg", { type: "image/jpeg" })), /up to eight images/],
    [[new File(["a"], "a.mp4", { type: "video/mp4" }), new File(["b"], "b.mp4", { type: "video/mp4" })], /Remove the current video/],
  ]) {
    const ui = fixture(); ui.attach(files); assert.match(text(ui.render()), message);
    assert.equal(ui.guardStates.at(-1).publicTimelineMedia.files.length, 0); assert.equal(ui.writes().length, 0); ui.unmount();
  }
});

test("media unavailable and read-only states forbid new uploads but preserve saved attachments", async () => {
  const media = [{ id: "22222222-2222-4222-8222-222222222222", url: "/existing.jpg", mimeType: "image/jpeg", size: 20 }];
  const ui = fixture({ initialJournal: snapshot([entry({ kind: "images", media, timelineReflection: responses })], { mediaReady: false }), initialEntryId: entry().id });
  assert.equal(control(ui.render(), "timeline-attachments").props.disabled, true);
  ui.attach([new File(["a"], "a.jpg", { type: "image/jpeg" })]);
  assert.equal(ui.guardStates.at(-1).publicTimelineMedia.files.length, 0);
  await ui.submit(); assert.deepEqual(ui.writes()[0].value.mediaIds, [media[0].id]); ui.unmount();
  const readOnly = fixture({ initialJournal: snapshot([entry()], { writable: false }) });
  assert.equal(control(readOnly.render(), "timeline-attachments"), undefined);
  assert.equal(readOnly.guardStates.at(-1).publicTimelineMedia.files.length, 0); readOnly.unmount();
});

test("failed attachment upload keeps the draft editable and reuses earlier successful uploads", async () => {
  let putCount = 0;
  const ui = fixture({ fetchOverride(request) { if (request.method === "PUT" && ++putCount === 2) return json({}, 503); } });
  await fillStory(ui); ui.attach([new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.jpg", { type: "image/jpeg" })]);
  await ui.submit();
  assert.equal(ui.requests.filter(request => request.url === "/api/my/journal").length, 0);
  assert.equal(button(ui.render(), "Post").props.disabled, false);
  assert.equal(ui.guardStates.at(-1).publicTimelineMedia.uploadIds.length, 1);
  await ui.submit();
  assert.equal(ui.requests.filter(request => request.url === "/api/my/journal/media").length, 3);
  assert.equal(ui.requests.filter(request => request.url === "/api/my/journal").length, 1);
  assert.equal([...ui.saved.values()][0].media.length, 2); ui.unmount();
});

test("canceling an upload retains writing and selected files without creating an entry", async () => {
  const ui = fixture({ fetchOverride(request) {
    if (request.method === "PUT") return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true }));
  } });
  await fillStory(ui); ui.attach([new File(["video"], "memory.mp4", { type: "video/mp4" })]);
  const pending = ui.submit(); await tick();
  assert.equal(button(ui.render(), "Saving…").props.disabled, true);
  await ui.click("Cancel upload"); await pending;
  assert.match(text(ui.render()), /Upload canceled/);
  assert.equal(ui.requests.filter(request => request.url === "/api/my/journal").length, 0);
  assert.equal(ui.guardStates.at(-1).publicTimelineMedia.files.length, 1);
  assert.equal(control(ui.render(), "timeline-event").props.value, "Starting over"); ui.unmount();
});

test("recovered drafts retain selected files and successful upload identifiers", async () => {
  const file = new File(["memory"], "memory.jpg", { type: "image/jpeg" });
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-111111111111";
  const mediaId = "bbbbbbbb-bbbb-4bbb-8bbb-222222222222";
  const values = { year: "2008", month: "", title: "A memory", details: "Words", ...responses };
  const ui = fixture({ recoveryDraft: { form: values, baseline: { year: "", month: "", title: "", details: "" }, revision: "", editingEntryId: id, wasPending: false,
    publicTimelineMedia: { kind: "images", keptMedia: [], files: [file], uploadIds: [[file, mediaId]], attemptedVisibility: null } } });
  await ui.click("Restore draft"); await ui.submit();
  assert.equal(ui.requests.filter(request => request.url === "/api/my/journal/media").length, 0);
  assert.equal(ui.writes()[0].value.id, id); assert.deepEqual(ui.writes()[0].value.mediaIds, [mediaId]); ui.unmount();
});

test("removing the last attachment turns the edited moment into a text story", async () => {
  const media = [{ id: "22222222-2222-4222-8222-222222222222", url: "/existing.jpg", mimeType: "image/jpeg", size: 20 }];
  const ui = fixture({ initialJournal: snapshot([entry({ kind: "images", media, visibility: "public", timelineReflection: responses })]), initialEntryId: entry().id });
  await ui.click("Remove saved attachment 1");
  assert.equal(button(ui.render(), "Save changes").props.disabled, false);
  await ui.submit(); assert.equal(ui.writes()[0].value.kind, "text"); assert.deepEqual(ui.writes()[0].value.mediaIds, []); ui.unmount();
});

test("an ambiguous publish does not mistake an unchanged private draft for publication", async () => {
  const ui = fixture({ initialJournal: snapshot([entry({ timelineReflection: responses })]), initialEntryId: entry().id, fetchOverride(request) { if (request.method === "PATCH") throw Error("Network lost"); } });
  await ui.submit(); await ui.click("Load latest saved story");
  assert.equal(button(ui.render(), "Post").props.disabled, true);
  assert.ok(button(ui.render(), "Keep my draft for this story"));
  assert.doesNotMatch(text(ui.render()), /Your story is published on your Timeline/); ui.unmount();
});

test("recovering an older entry outside the loaded page fetches its version before editing", async () => {
  const previous = entry({ timelineReflection: responses });
  const baseline = { year: "2008", month: "6", title: previous.title, details: previous.body, ...responses };
  const ui = fixture({ recoveryDraft: { form: { ...baseline, title: "Revisited" }, baseline, revision: "", editingEntryId: previous.id, wasPending: false },
    fetchOverride(request) { if (request.method === "GET" && request.url === `/api/my/journal/${previous.id}`) return json({ entry: previous }); } });
  await ui.click("Restore draft"); assert.equal(button(ui.render(), "Post").props.disabled, true);
  await ui.click("Load latest saved story"); await ui.click("Keep my draft for this story"); await ui.submit();
  assert.equal(ui.writes()[0].method, "PATCH"); assert.equal(ui.writes()[0].value.expectedVersion, previous.version); ui.unmount();
});

test("a recovered persisted media-only post fetches its version instead of creating a duplicate", async () => {
  const media = [{ id: "22222222-2222-4222-8222-222222222222", url: "/existing.jpg", mimeType: "image/jpeg", size: 20 }];
  const previous = entry({ title: null, body: null, kind: "images", media, visibility: "public", eventYear: null, eventMonth: null, eventDay: null });
  const baseline = { year: "2026", month: "", title: "", details: "", meaning: "", belief: "", presentImpact: "", perspective: "" };
  const ui = fixture({ recoveryDraft: { form: { ...baseline, details: "Adding a caption." }, baseline, revision: "", editingEntryId: previous.id, wasPending: false,
    publicTimelineMedia: { kind: "images", keptMedia: media, files: [], uploadIds: [], attemptedVisibility: null, editingExisting: true, eventDay: null, baselineEventDay: null } },
    fetchOverride(request) { if (request.method === "GET" && request.url === `/api/my/journal/${previous.id}`) return json({ entry: previous }); } });
  await ui.click("Restore draft");
  assert.equal(button(ui.render(), "Post").props.disabled, true);
  await ui.click("Load latest saved story"); await ui.click("Keep my draft for this story"); await ui.submit();
  assert.equal(ui.writes().length, 1);
  assert.equal(ui.writes()[0].method, "PATCH");
  assert.equal(ui.writes()[0].value.expectedVersion, previous.version);
  assert.deepEqual(ui.writes()[0].value.mediaIds, [media[0].id]);
  assert.equal(ui.writes()[0].value.body, "Adding a caption.");
  ui.unmount();
});

test("a deleted entry converted to a new draft restores and posts without a false existing-entry conflict", async () => {
  const original = entry({ visibility: "public", timelineReflection: responses });
  const ui = fixture({ initialJournal: snapshot([original]), initialEntryId: original.id,
    fetchOverride(request, saved) {
      if (request.method === "PATCH") { saved.delete(original.id); return json({ error: "This story changed in another tab." }, 409); }
    } });
  ui.change("timeline-details", "Keep these words after the old post was deleted.");
  await ui.submit();
  await ui.click("Load latest saved story");
  await ui.click("Keep draft as a new story");
  ui.render();
  const checkpoint = ui.guardStates.at(-1);
  assert.notEqual(checkpoint.editingEntryId, original.id);
  assert.equal(checkpoint.publicTimelineMedia.editingExisting, false);
  assert.equal(checkpoint.dirty, true);
  assert.equal(checkpoint.pending, false);
  const recoveryDraft = { form: checkpoint.form, baseline: checkpoint.baseline, editingEntryId: checkpoint.editingEntryId,
    revision: checkpoint.revision, wasPending: checkpoint.pending, publicTimelineMedia: checkpoint.publicTimelineMedia };
  ui.unmount();
  const restored = fixture({ recoveryDraft });
  await restored.click("Restore draft");
  assert.equal(button(restored.render(), "Post").props.disabled, false);
  assert.equal(button(restored.render(), "Load latest saved story"), undefined);
  await restored.submit();
  assert.equal(restored.writes().length, 1);
  assert.equal(restored.writes()[0].method, "POST");
  assert.equal(restored.writes()[0].value.id, checkpoint.editingEntryId);
  assert.equal(restored.writes()[0].value.body, "Keep these words after the old post was deleted.");
  assert.equal(restored.writes()[0].value.visibility, "public");
  assert.equal(restored.saved.size, 1);
  restored.unmount();
});

test("media checkpoint metadata is copied without mutating or exposing another account's draft", () => {
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(new URL("../src/components/membership/MemberTimelineDraftState.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("require", "module", "exports", compiled)(require, loaded, loaded.exports);
  const first = loaded.exports.createTimelineDraftStore("owner-a"), second = loaded.exports.createTimelineDraftStore("owner-b");
  const file = new File(["image"], "image.jpg", { type: "image/jpeg" });
  const media = { kind: "images", files: [file], keptMedia: [{ id: "saved", mimeType: "image/jpeg", size: 5, url: "/saved.jpg" }], uploadIds: [[file, "uploaded"]], attemptedVisibility: null };
  first.write(Symbol("writer"), { form: {}, baseline: {}, editingEntryId: "id", revision: "", wasPending: false, publicTimelineMedia: media }, "public-timeline");
  media.keptMedia[0].url = "/changed.jpg"; media.uploadIds[0][1] = "changed"; media.files.pop();
  const recovered = first.read("public-timeline").draft.publicTimelineMedia;
  assert.equal(recovered.files[0], file); assert.equal(recovered.keptMedia[0].url, "/saved.jpg"); assert.equal(recovered.uploadIds[0][1], "uploaded");
  recovered.keptMedia.pop(); assert.equal(first.read("public-timeline").draft.publicTimelineMedia.keptMedia.length, 1);
  assert.equal(first.read(), null); assert.equal(second.read("public-timeline"), null);
});
