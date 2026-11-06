import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const safeHrefs = load("src/lib/membership/notification-inbox-model.ts");
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const notification = { id: "notice-1", kind: "notification", title: "The Library is live", body: "The first recording is ready.", publishedAt: "2026-11-06T12:00:00Z", readAt: null, actionLabel: "Watch Foundations 01", href: "/my/library/foundations-01" };
function fixture({ items = [notification], unreadCount = items.filter(item => item.kind === "notification" && !item.readAt).length, writable = true, previewChoice = null, respond = async () => Response.json({ ok: true }) } = {}) {
  const states = [], refs = [], calls = [], events = [], effects = [], pendingEffects = [];
  let cursor, refCursor, effectCursor, tree, refreshes = 0;
  const Component = load("src/components/membership/MemberUpdates.tsx", {
    react: { ...React, useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; }, useRef(initial) { return refs[refCursor++] ??= { current: initial }; }, useEffect(effect, deps) { const i = effectCursor++; if (!effects[i] || deps.some((dep, j) => dep !== effects[i][j])) pendingEffects.push(effect); effects[i] = deps; } },
    "next/link": { __esModule: true, default: "a" },
    "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
    "@/lib/membership/notification-inbox-model": safeHrefs,
    "./MemberUpdates.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, name) => String(name) }) },
  }, {
    window: { dispatchEvent(event) { events.push(event.type); }, sessionStorage: { getItem(key) { assert.equal(key, "ruined-preview-library-announcement"); return previewChoice; } } },
    fetch: async (url, options) => { calls.push({ url, ...options }); return respond(calls.at(-1)); },
  }).default;
  const draw = () => { cursor = 0; refCursor = 0; effectCursor = 0; tree = Component({ initialUpdates: { items, unreadCount }, writable }); pendingEffects.splice(0).forEach(effect => effect()); return tree; };
  draw();
  return { calls, events, draw, refreshes: () => refreshes, all: () => nodes(draw()), text: () => text(draw()), find(predicate) { const node = nodes(draw()).find(predicate); assert.ok(node, "Expected matching element"); return node; }, settle: () => new Promise(resolve => setImmediate(resolve)) };
}

test("Updates uses the configured button label and opens the ordinary link while marking read", async () => {
  const f = fixture();
  const link = f.find(node => node.type === "a");
  assert.equal(link.props.href, notification.href);
  assert.equal(link.props["aria-label"], "Watch Foundations 01: The Library is live");
  assert.match(text(link), /^Watch Foundations 01/);
  let prevented = false;
  link.props.onClick({ preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  await f.settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/my/updates/read");
  assert.equal(f.calls[0].keepalive, true);
  assert.deepEqual(JSON.parse(f.calls[0].body), { notificationId: notification.id });
  assert.deepEqual(f.events, ["ruined:member-updates"]);
  assert.match(f.text(), /You’re all caught up/);
  assert.equal(f.refreshes(), 0, "following a link owns navigation; the read request does not refresh it");
});

test("failed CTA read requests do not block, rewrite, or raise an error over the destination link", async () => {
  const f = fixture({ respond: async () => Response.json({ error: "Unavailable" }, { status: 503 }) });
  let prevented = false;
  f.find(node => node.type === "a").props.onClick({ preventDefault() { prevented = true; } });
  await f.settle();
  assert.equal(prevented, false);
  assert.equal(f.find(node => node.type === "a").props.href, notification.href);
  assert.equal(f.all().some(node => node.props?.role === "alert"), false);
  assert.deepEqual(f.events, []);
  assert.match(f.text(), /1 unread update/);
});

test("Mark as read retains feedback and refreshes the bell after successful persistence", async () => {
  const f = fixture();
  await f.find(node => node.type === "button" && text(node) === "Mark as read").props.onClick();
  assert.deepEqual(f.events, ["ruined:member-updates"]);
  assert.equal(f.refreshes(), 1);
  assert.match(f.text(), /marked as read/);
  assert.match(f.text(), /You’re all caught up/);
});

test("unsafe legacy CTA links are omitted while safe unlabeled links keep the fallback", () => {
  for (const href of ["javascript:alert(1)", "//evil.example/my", "/my/../../ops", "/my-other", "https://user:password@example.com/"]) {
    const f = fixture({ items: [{ ...notification, href }] });
    assert.equal(f.all().some(node => node.type === "a"), false, href);
    assert.ok(f.find(node => node.type === "button" && text(node) === "Mark as read"));
  }
  const f = fixture({ items: [{ ...notification, actionLabel: null, readAt: "2026-11-06T13:00:00Z" }] });
  assert.match(text(f.find(node => node.type === "a")), /^View details/);
});

test("readonly and announcement links navigate without trying to mark a notification read", async () => {
  for (const options of [{ writable: false }, { items: [{ ...notification, kind: "announcement" }] }, { items: [{ ...notification, readAt: "2026-11-06T13:00:00Z" }] }]) {
    const f = fixture(options);
    f.find(node => node.type === "a").props.onClick(); await f.settle();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.events, []);
  }
});

test("a link can mark its own notice while a different read request is pending, without duplicating either", async () => {
  const resolvers = [];
  const f = fixture({ items: [notification, { ...notification, id: "notice-2", title: "Second notice" }], respond: () => new Promise(resolve => resolvers.push(resolve)) });
  const first = f.find(node => node.type === "button" && node.props["aria-label"] === "Mark as read: The Library is live").props.onClick();
  const second = f.find(node => node.type === "a" && node.props["aria-label"].endsWith("Second notice"));
  second.props.onClick(); second.props.onClick();
  assert.equal(f.calls.length, 2);
  resolvers.forEach(resolve => resolve(Response.json({ ok: true })));
  await first; await f.settle();
  assert.deepEqual(f.events, ["ruined:member-updates", "ruined:member-updates"]);
  assert.match(f.text(), /You’re all caught up/);
});

test("the inbox preserves the full unread count when only the latest 100 updates are loaded", async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ ...notification, id: `notice-${index}`, readAt: index ? "2026-11-06T13:00:00Z" : null }));
  const f = fixture({ items, unreadCount: 130 });
  assert.match(f.text(), /130 unread updates/);
  assert.match(f.text(), /Showing your latest 100 updates/);
  assert.equal(text(f.find(node => node.type === "button" && text(node).startsWith("Unread"))), "Unread 130");
  await f.find(node => node.type === "button" && text(node) === "Mark as read").props.onClick();
  assert.match(f.text(), /129 unread updates/);
  f.find(node => node.type === "button" && text(node).startsWith("Unread")).props.onClick();
  assert.match(f.text(), /No unread updates in this view/);
  assert.match(f.text(), /Older unread notices/);
  assert.doesNotMatch(f.text(), /caught up/);
});

test("preview opening is reflected locally in Updates without affecting real member reads", () => {
  const items = [{ ...notification, id: "preview-library-launch" }, { ...notification, id: "circle", title: "Your Circle" }];
  const preview = fixture({ items, writable: false, previewChoice: "open" });
  assert.match(preview.text(), /1 unread update/);
  assert.equal(text(preview.find(node => node.type === "li")).includes("Unread"), false);
  assert.deepEqual(preview.calls, []);
  assert.deepEqual(preview.events, []);
  assert.match(fixture({ items, writable: true, previewChoice: "open" }).text(), /2 unread updates/);
  assert.match(fixture({ items, writable: false, previewChoice: "dismiss" }).text(), /2 unread updates/);
});
