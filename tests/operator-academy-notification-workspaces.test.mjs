import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
function fixture(file, initialProps, { hash = "", exportName = "default", respond = async () => Response.json({ dispatch: { recipientCount: 1 }, resource: { resourceId: "new-lesson" } }) } = {}) {
  const slots = [], effects = [], calls = [], locations = [], listeners = new Set();
  let cursor = 0, changed = false, props = initialProps, refreshes = 0;
  const window = {
    location: { hash },
    history: { state: { untouched: true }, replaceState(state, _title, location) { assert.deepEqual(state, { untouched: true }); window.location.hash = location; locations.push(location); } },
    addEventListener(name, listener) { if (name === "hashchange") listeners.add(listener); },
    removeEventListener(name, listener) { if (name === "hashchange") listeners.delete(listener); },
  };
  const hooks = {
    ...React, useMemo: (fn) => fn(),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value) => { const next = typeof value === "function" ? value(slots[i]) : value; if (next !== slots[i]) { slots[i] = next; changed = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(effect, dependencies) { const i = cursor++; if (!slots[i] || dependencies.some((value, index) => value !== slots[i].dependencies[index])) { effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { dependencies, cleanup: effect() }; }); } },
  };
  const deps = {
    react: hooks,
    "next/link": { __esModule: true, default: "a" },
    "next/image": { __esModule: true, default: "img" },
    "next/navigation": { useRouter: () => ({ refresh() { refreshes++; }, push(path) { locations.push(path); } }) },
    "@/components/platform/OperatorDialog": { __esModule: true, default: "operator-dialog" },
    "@/components/platform/OperatorPageFrame": { __esModule: true, default: "main" },
    "@/components/platform/OperatorMessagesTabs": { __esModule: true, default: "message-views" },
    "@/components/platform/OperatorEmptyState": { __esModule: true, default: "empty-state" },
    "@/components/platform/OperatorAcademyThumbnail": { __esModule: true, default: "academy-thumbnail" },
    "@/components/platform/StateLabel": { __esModule: true, default: "state-label" },
    "@/components/platform/operatorStyles": new Proxy({}, { get: () => "operator-style" }),
    "@/components/platform/OperatorAcademyActions": { OperatorAcademyCreateResource: "create-resource", OperatorAcademyCollectionCreate: "create-collection", OperatorAcademyCollectionActions: "edit-collection", OperatorAcademyEditorForm: "edit-resource", OperatorAcademyResourceStateActions: "resource-state" },
    "@/components/platform/OperatorWorkActions": { OperatorAnnouncementCreateAction: "create-announcement", OperatorAnnouncementCloseAction: "close-announcement", OperatorAnnouncementPublishAction: "publish-announcement" },
    "@/lib/platform/ops-notification-model": { opsNotificationReadState: (status, readAt) => status === "delivered" ? readAt ? "read" : "unread" : null },
  };
  const output = ts.transpileModule(readFileSync(new URL(`../src/components/platform/${file}.tsx`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "window", "fetch", "FormData", output)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(deps, name), `Unexpected dependency ${name}`); return deps[name];
  }, mod, mod.exports, window, async (url, options) => { calls.push({ url, ...options }); return respond(calls.at(-1)); }, class { constructor(form) { this.fields = form.fields; } get(key) { return this.fields[key] ?? null; } getAll(key) { return this.fields[key] ?? []; } });
  const Component = mod.exports[exportName];
  function draw() { let result; for (let i = 0; i < 10; i++) { cursor = 0; changed = false; result = Component(props); effects.splice(0).forEach((effect) => effect()); if (!changed) return result; } throw new Error("Unstable fixture render"); }
  return {
    draw, calls, locations, refreshes: () => refreshes,
    setProps(next) { props = next; },
    hash(value) { window.location.hash = value; for (const listener of listeners) listener(); },
    click(label) { const button = nodes(draw()).find((node) => node.type === "button" && text(node) === label); assert.ok(button, `Missing ${label}`); return button.props.onClick(); },
    dialog() { return nodes(draw()).find((node) => node.type === "operator-dialog"); },
    form() { return nodes(draw()).find((node) => node.type === "form"); },
    submit(fields = {}) { const form = this.form(); assert.ok(form); return form.props.onSubmit({ preventDefault() {}, currentTarget: { fields, reset() {} } }); },
  };
}
const academy = { canManage: true, counts: { published: 1, draft: 1, unpublished: 0 }, resources: [{ resourceId: "one", title: "See", status: "published", latestVersion: 1, audiences: [] }], collections: [{ collectionId: "collection-one", name: "Foundations", status: "published", resourceCount: 1, revision: 3 }] };
const options = { collections: [], circles: [], blocks: [] };
const data = { circles: [{ id: "circle-one", label: "Circle One" }], blocks: [], members: [{ id: "member-one", label: "Example Member" }], history: [{ notificationId: "one", title: "Bring a journal", memberName: "Example Member", memberId: "member-one", type: "reminder", status: "delivered", statusAt: "2026-09-15T12:00:00Z", readAt: null }] };
const message = { audience: "member:member-one", notificationType: "reminder", title: "Bring a journal", body: "Meet at the studio.", actionLabel: "Open Circle", actionUrl: "/my/circle" };

test("Academy preserves creation hash links and opens just one permissioned workspace", () => {
  const f = fixture("OperatorAcademy", { academy, options, preview: true }, { hash: "#new-collection" });
  assert.equal(f.dialog().props.title, "New collection");
  assert.ok(nodes(f.draw()).some((node) => node.props?.["aria-label"] === "Academy collections"));
  assert.equal(nodes(f.dialog()).find((node) => node.type === "create-collection").props.preview, true);
  f.dialog().props.onClose();
  assert.equal(f.dialog(), undefined);
  assert.equal(f.locations.at(-1), "#academy-collections");
  f.click("Manage collection");
  assert.equal(f.dialog().props.returnFocusId, "open-collection-collection-one");
  assert.equal(nodes(f.dialog()).find((node) => node.type === "edit-collection").props.expanded, true);
  f.hash("#new-lesson");
  assert.equal(f.dialog().props.title, "Foundations", "hash changes cannot discard a current editor");
  const denied = fixture("OperatorAcademy", { academy: { ...academy, canManage: false }, options }, { hash: "#new-lesson" });
  assert.equal(denied.dialog(), undefined);
  assert.equal(nodes(denied.draw()).some((node) => node.type === "create-resource"), false);
  assert.deepEqual(f.calls, []);
});

test("Academy creation signals dirty/pending state, blocks duplicate submits and keeps failed drafts", async () => {
  let settle;
  const response = new Promise((resolve) => { settle = resolve; });
  const f = fixture("OperatorAcademyActions", { options }, { exportName: "OperatorAcademyCreateResource", respond: () => response });
  assert.equal(f.form().props["data-operator-dirty"], false);
  f.form().props.onChange();
  assert.equal(f.form().props["data-operator-dirty"], true);
  const first = f.submit({ title: "A lesson", audienceAll: "yes", contentType: "video" });
  assert.equal(f.form().props["data-operator-pending"], true);
  assert.ok(nodes(f.draw()).some((node) => node.type === "fieldset" && node.props.disabled));
  await f.submit({ title: "Duplicate" });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].body).audiences, [{ kind: "all_members", id: null }]);
  settle(Response.json({ error: "Please review the lesson." }, { status: 409 }));
  await first;
  assert.equal(f.form().props["data-operator-pending"], false);
  assert.equal(f.form().props["data-operator-dirty"], true);
  assert.match(text(f.draw()), /Please review the lesson/);
});

test("collection edits keep version guards and cannot publish unsaved changes", async () => {
  const f = fixture("OperatorAcademyActions", { collection: { ...academy.collections[0], slug: "foundations", position: 1 }, expanded: true }, { exportName: "OperatorAcademyCollectionActions" });
  f.form().props.onChange();
  await f.click("Unpublish");
  assert.equal(f.calls.length, 0);
  assert.match(text(f.draw()), /Save your collection changes/);
  await f.submit({ name: "Revised", slug: "foundations", position: "1" });
  assert.equal(JSON.parse(f.calls[0].body).expectedRevision, 3);
  assert.equal(f.form().props["data-operator-dirty"], false);
});

const lesson = { resourceId: "lesson-one", revision: 8, title: "The work in front of you", contentType: "video", status: "published", collectionName: "Foundations", durationLabel: "08:14", summary: "A quiet practice.", bodyText: "Notes with all of their original detail.", videoUrl: "https://example.com/lesson.mp4", externalUrl: "https://example.com/lesson", presenter: "Cade", currentVersion: 2, latestVersion: 3, hasUnpublishedChanges: true, featured: true, audiences: [{ kind: "circle", id: "circle-one", label: "Circle One" }] };

test("Academy thumbnails show a compact format fallback for missing, loading or failed images and recover after a URL change", () => {
  const f = fixture("OperatorAcademyThumbnail", { src: null, format: "video", detail: true });
  const image = () => nodes(f.draw()).find((node) => node.type === "img");
  assert.equal(image(), undefined);
  assert.match(text(f.draw()), /video/);
  assert.match(f.draw().props.className, /h-20/);
  assert.equal(f.draw().props["aria-hidden"], "true", "decorative media does not repeat the lesson title to screen readers");
  f.setProps({ src: "https://example.com/missing.jpg", format: "video" });
  assert.match(image().props.className, /opacity-0/);
  assert.match(f.draw().props.className, /size-16/);
  image().props.onError();
  assert.equal(image(), undefined);
  assert.match(text(f.draw()), /video/);
  f.setProps({ src: "https://example.com/replaced.jpg", format: "video" });
  assert.equal(image().props.src, "https://example.com/replaced.jpg");
  image().props.onLoad();
  assert.match(image().props.className, /opacity-100/);
  assert.equal(f.calls.length, 0);
});

test("Academy lesson detail starts with saved content, audience and publication cards, not an open editor", () => {
  const f = fixture("OperatorAcademyEditor", { editor: { canManage: true, resource: lesson, options }, preview: true });
  const tree = f.draw();
  assert.equal(f.dialog(), undefined);
  assert.equal(nodes(tree).some((node) => node.type === "edit-resource"), false);
  assert.deepEqual(nodes(tree).filter((node) => node.type === "h2").map(text), ["Content", "Audience", "Publication"]);
  assert.match(text(tree), /Live versionv2Latest versionv3Changes not published/);
  assert.match(text(tree), /Circle One/);
  assert.equal(nodes(tree).find((node) => node.type === "a" && text(node).includes("Open source")).props.href, lesson.videoUrl);
  f.click("Edit lesson");
  assert.equal(f.dialog().props.title, "Edit lesson");
  assert.equal(f.dialog().props.returnFocusId, "edit-academy-lesson");
  const editor = nodes(f.dialog()).find((node) => node.type === "edit-resource");
  assert.equal(editor.props.resource, lesson);
  assert.equal(editor.props.preview, true);
  editor.props.onSaved();
  assert.equal(f.dialog(), undefined);
  assert.match(text(f.draw()), /Draft saved. Publish when ready/);
  assert.equal(f.calls.length, 0);
});

test("read-only and retired lessons expose full notes without editable forms or accidental publication", () => {
  for (const [canManage, status] of [[false, "published"], [true, "retired"]]) {
    const f = fixture("OperatorAcademyEditor", { editor: { canManage, resource: { ...lesson, status }, options } });
    assert.equal(nodes(f.draw()).some((node) => node.type === "button" && text(node) === "Edit lesson"), false);
    if (!canManage) assert.equal(nodes(f.draw()).some((node) => node.type === "resource-state"), false);
    f.click("Read lesson notes");
    assert.equal(f.dialog().props.returnFocusId, "read-academy-notes");
    assert.match(text(f.dialog()), /Notes with all of their original detail/);
    assert.equal(nodes(f.dialog()).some((node) => node.type === "edit-resource"), false);
    f.dialog().props.onClose();
    assert.equal(f.dialog(), undefined);
    assert.equal(f.calls.length, 0);
  }
});

test("lesson editing retains revision, all draft fields and pending guards; failed saves keep the editor dirty", async () => {
  let settle;
  let saved = 0;
  const f = fixture("OperatorAcademyActions", { options, resource: lesson, onSaved: () => saved++ }, { exportName: "OperatorAcademyEditorForm", respond: () => new Promise((resolve) => { settle = resolve; }) });
  const payload = { title: "Revised lesson", contentType: "video", circleIds: ["circle-one"], bodyText: "Saved notes", externalUrl: "https://example.com/resource", videoUrl: "https://example.com/lesson.mp4", captionsUrl: "https://example.com/lesson.vtt", thumbnailUrl: "https://example.com/lesson.jpg", featured: "yes", position: "4", durationLabel: "08:14", presenter: "Cade", summary: "A quiet practice.", collectionId: "collection-one", slug: "the-work" };
  f.form().props.onChange();
  const first = f.submit(payload);
  assert.equal(f.form().props["data-operator-pending"], true);
  assert.ok(nodes(f.draw()).some((node) => node.type === "fieldset" && node.props.disabled));
  await f.submit(payload);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, "PATCH");
  assert.equal(f.calls[0].url, "/api/ops/academy/resources/lesson-one");
  const { circleIds, ...fields } = payload;
  assert.deepEqual(JSON.parse(f.calls[0].body), { ...fields, audiences: circleIds.map((id) => ({ kind: "circle", id })), featured: true, position: 4, expectedRevision: 8 });
  settle(Response.json({ error: "Another operator changed this lesson." }, { status: 409 }));
  await first;
  assert.equal(f.form().props["data-operator-pending"], false);
  assert.equal(f.form().props["data-operator-dirty"], true);
  assert.match(text(f.draw()), /Another operator changed this lesson/);
  assert.equal(saved, 0);
  const second = f.submit(payload);
  settle(Response.json({}));
  await second;
  assert.equal(f.form().props["data-operator-dirty"], false);
  assert.equal(saved, 1);
  assert.equal(f.refreshes(), 1);
});

test("lesson publication keeps secondary destructive actions disclosed and exact revision on a single pending request", async () => {
  let settle;
  const f = fixture("OperatorAcademyActions", { resourceId: lesson.resourceId, revision: lesson.revision, status: "published", hasUnpublishedChanges: true }, { exportName: "OperatorAcademyResourceStateActions", respond: () => new Promise((resolve) => { settle = resolve; }) });
  const disclosure = nodes(f.draw()).find((node) => node.type === "details");
  assert.equal(disclosure.props.open, undefined);
  assert.match(text(disclosure), /More actionsUnpublishRetire/);
  const first = f.click("Publish latest changes");
  await f.click("Publish latest changes");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].body), { action: "publish", expectedRevision: 8 });
  settle(Response.json({})); await first;
  f.click("Retire");
  assert.match(text(f.draw()), /Its history is retained. This cannot be undone/);
  f.click("Keep lesson");
  assert.equal(f.calls.length, 1);
});

test("notification deep links open compose, preserve exact review, and guard pending sends from close and duplicates", async () => {
  let settle;
  const response = new Promise((resolve) => { settle = resolve; });
  const f = fixture("OperatorNotificationCenter", { data }, { hash: "#write-notification", respond: () => response });
  assert.equal(f.dialog().props.title, "Write notification");
  f.form().props.onChange();
  await f.submit(message);
  assert.equal(f.form().props.hidden, true);
  assert.equal(f.dialog().props.title, "Review notification");
  assert.match(text(f.dialog()), /Example Member/);
  assert.equal(f.calls.length, 0);
  const first = f.click("Send notification");
  assert.equal(f.dialog().props.pending, true);
  f.dialog().props.onClose();
  assert.ok(f.dialog(), "a pending request cannot unmount its composer");
  await f.click("Sending");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].body), { actionLabel: message.actionLabel, actionUrl: message.actionUrl, body: message.body, notificationType: "reminder", targetId: "member-one", targetType: "member", title: message.title });
  settle(Response.json({ dispatch: { recipientCount: 1 } }));
  await first;
  assert.equal(f.dialog(), undefined);
  assert.equal(f.locations.at(-1), "#notification-history");
  assert.match(text(f.draw()), /No email or text message was sent/);
});

test("notification history search does not mutate delivery records or submit anything", () => {
  const f = fixture("OperatorNotificationCenter", { data });
  assert.equal(f.dialog(), undefined);
  nodes(f.draw()).find((node) => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "not-found" } });
  assert.match(text(f.draw()), /No matching notifications/);
  assert.equal(data.history.length, 1);
  assert.equal(f.calls.length, 0);
});

test("Board posts preserve compose deep links, preview and permission gating without automatically publishing", () => {
  const props = { announcements: [], audienceOptions: data, canManage: true, preview: true };
  const f = fixture("OperatorAnnouncements", props, { hash: "#new-announcement" });
  assert.equal(f.dialog().props.title, "Write announcement");
  const create = nodes(f.dialog()).find((node) => node.type === "create-announcement");
  assert.equal(create.props.preview, true);
  assert.equal(create.props.compact, true);
  assert.equal(f.calls.length, 0);
  create.props.onSaved();
  assert.equal(f.dialog(), undefined);
  assert.match(text(f.draw()), /Review it before publishing/);
  const denied = fixture("OperatorAnnouncements", { ...props, canManage: false }, { hash: "#new-announcement" });
  assert.equal(denied.dialog(), undefined);
  assert.equal(nodes(denied.draw()).some((node) => node.type === "create-announcement"), false);
});

test("Board-post composition preserves dirty drafts and pending guards without changing its API", async () => {
  let settle;
  const response = new Promise((resolve) => { settle = resolve; });
  const f = fixture("OperatorWorkActions", { audienceOptions: data, compact: true }, { exportName: "OperatorAnnouncementCreateAction", respond: () => response });
  f.form().props.onChange();
  const first = f.submit({ title: "Studio gathering", body: "Bring your journal.", audience: "circle:circle-one" });
  assert.equal(f.form().props["data-operator-dirty"], true);
  assert.equal(f.form().props["data-operator-pending"], true);
  await f.submit({ title: "Duplicate" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/ops/announcements");
  assert.deepEqual(JSON.parse(f.calls[0].body), { title: "Studio gathering", body: "Bring your journal.", targetKind: "circle", targetId: "circle-one" });
  settle(Response.json({ error: "Draft could not be saved." }, { status: 503 }));
  await first;
  assert.equal(f.form().props["data-operator-pending"], false);
  assert.equal(f.form().props["data-operator-dirty"], true);
  assert.match(text(f.draw()), /Draft could not be saved/);
});

test("Board search keeps the active draft editor mounted until explicitly saved or cancelled", () => {
  const announcement = { announcementId: "draft-one", title: "Studio gathering", body: "Bring a journal.", targetLabel: "All members", state: "draft", version: 3, publishedAt: null };
  const f = fixture("OperatorAnnouncements", { announcements: [announcement], audienceOptions: data, canManage: true });
  f.click("Edit draft");
  const editor = () => nodes(f.draw()).find((node) => node.type === "create-announcement");
  const key = editor().key;
  nodes(f.draw()).find((node) => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "not a matching post" } });
  assert.equal(editor().props.announcement, announcement);
  assert.equal(editor().key, key, "React preserves the existing uncontrolled draft fields");
  assert.equal(f.calls.length, 0);
  editor().props.onCancel();
  assert.equal(editor(), undefined);
  assert.equal(nodes(f.draw()).find((node) => node.type === "empty-state").props.title, "No matching posts.");
});
