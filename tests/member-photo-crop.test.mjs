import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

async function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
    if (name === "react/jsx-runtime") return jsx;
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const policy = { MEMBER_PHOTO_MAX_BYTES: 3 * 1024 * 1024 };
const crop = await load("src/lib/membership/member-photo-crop.ts", { "./photo-policy": policy });
const center = { zoom: 1, x: 0, y: 0 };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const photo = { name: "phone.heic", type: "image/heic", size: 10_000_000 };
const decoded = { naturalWidth: 4000, naturalHeight: 3000 };
const oldUrl = "/api/member-photos/owner/old.webp", newUrl = "/api/member-photos/owner/new.webp";

test("center, boundary and zoom crops remain square and within portrait or landscape sources", () => {
  assert.deepEqual(crop.memberPhotoCropRect(4000, 3000, center), { x: 500, y: 0, side: 3000 });
  assert.deepEqual(crop.memberPhotoCropRect(3000, 4000, center), { x: 0, y: 500, side: 3000 });
  for (const [width, height] of [[4000, 3000], [3000, 4000], [8000, 6000], [20, 20]]) {
    for (const zoom of [1, 1.4, 3, 100]) for (const x of [-20, -1, 0, 1, 20]) for (const y of [-1, 0, 1]) {
      const rect = crop.memberPhotoCropRect(width, height, { zoom, x, y });
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.side <= width && rect.y + rect.side <= height);
    }
  }
  assert.throws(() => crop.memberPhotoCropRect(9000, 9000, center), /64 megapixels/);
  assert.throws(() => crop.memberPhotoCropRect(0, 100, center));
});

test("dragging translates image position without exposing empty space and stays aligned at zoom", () => {
  assert.deepEqual(crop.panMemberPhotoCrop(4000, 3000, center, 0.1, 0.2), { zoom: 1, x: -0.6, y: 0 });
  const zoomed = { zoom: 2, x: 0, y: 0 };
  const before = crop.memberPhotoCropRect(4000, 3000, zoomed);
  const after = crop.memberPhotoCropRect(4000, 3000, crop.panMemberPhotoCrop(4000, 3000, zoomed, 0.2, -0.1));
  assert.equal(after.x, before.x - before.side * 0.2);
  assert.equal(after.y, before.y + before.side * 0.1);
  assert.equal(crop.panMemberPhotoCrop(4000, 3000, center, 100, 0).x, -1);
});

test("bounded large and empty-MIME phone selections are accepted before actual decoding", () => {
  for (const file of [photo, { ...photo, name: "PHONE.JPG", type: "" }, { ...photo, name: "phone.heif", type: "" }]) assert.doesNotThrow(() => crop.validateMemberPhotoSelection(file));
  for (const file of [{ ...photo, size: 0 }, { ...photo, size: 21 * 1024 * 1024 }, { ...photo, type: "text/html" }, { ...photo, name: "unknown", type: "" }]) assert.throws(() => crop.validateMemberPhotoSelection(file));
});

test("decoding uses oriented dimensions, rejects corrupt/oversized images and supports cancellation", async () => {
  const images = [];
  class Image { constructor() { images.push(this); this.naturalWidth = 3000; this.naturalHeight = 4000; this.wait = deferred(); } decode() { return this.wait.promise; } }
  const helper = await load("src/lib/membership/member-photo-crop.ts", { "./photo-policy": policy }, { Image });
  const opening = helper.decodeMemberPhoto("blob:portrait", new AbortController().signal);
  images.at(-1).wait.resolve(); assert.equal((await opening).naturalHeight, 4000);
  const bad = helper.decodeMemberPhoto("blob:bad", new AbortController().signal); images.at(-1).wait.reject(new Error("invalid bytes")); await assert.rejects(bad, /Export it as JPG/);
  const huge = helper.decodeMemberPhoto("blob:huge", new AbortController().signal); images.at(-1).naturalWidth = 9000; images.at(-1).naturalHeight = 9000; images.at(-1).wait.resolve(); await assert.rejects(huge, /64 megapixels/);
  const controller = new AbortController(), cancelled = helper.decodeMemberPhoto("blob:cancel", controller.signal);
  controller.abort(); await assert.rejects(cancelled, { name: "AbortError" }); assert.equal(images.at(-1).src, "");
});

test("canvas export uses the displayed crop, caps dimensions and retries oversized encodings", async () => {
  const draws = [], qualities = [];
  const canvas = { getContext: () => ({ fillRect() {}, drawImage(...args) { draws.push(args); } }), toBlob(callback, type, quality) { qualities.push(quality); callback(new Blob([new Uint8Array(qualities.length === 1 ? policy.MEMBER_PHOTO_MAX_BYTES + 1 : 100)], { type })); } };
  const helper = await load("src/lib/membership/member-photo-crop.ts", { "./photo-policy": policy }, { document: { createElement: () => canvas } });
  const file = await helper.exportMemberPhotoCrop(decoded, { zoom: 2, x: 1, y: -1 });
  assert.deepEqual(draws[0], [decoded, 2500, 0, 1500, 1500, 0, 0, 1024, 1024]);
  assert.deepEqual(qualities, [0.92, 0.82]); assert.equal(file.type, "image/jpeg"); assert.equal(file.size, 100);
  assert.equal(canvas.width, 1024); assert.equal(canvas.height, 1024);
  canvas.toBlob = callback => callback(null);
  await assert.rejects(helper.exportMemberPhotoCrop(decoded, center), /could not be prepared/);
});

const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" ? node : "";
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
const image = tree => nodes(tree).find(node => node.props.alt === "Unsaved profile photo crop" || node.props.alt === "Your profile photo");
async function fixture(options = {}) {
  const slots = [], effects = [], calls = [], changed = [], published = [], busy = [], drafts = [], revoked = [], decodes = [], exports = [];
  let cursor = 0, urlNumber = 0, ownerId = "owner-a", saved = options.avatarUrl ?? oldUrl, override;
  const props = { avatarUrl: saved, enabled: true, available: true, onChange(value) { changed.push(value); saved = value; }, onBusyChange: value => busy.push(value), onDraftChange: value => drafts.push(value) };
  const hooks = { ...React, useId: () => "photo",
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((v, n) => v !== prior.deps[n])) { const current = { deps }; slots[i] = current; effects.push(() => { prior?.cleanup?.(); current.cleanup = effect(); }); } },
  };
  const Component = (await load("src/components/membership/MemberPhotoUpload.tsx", {
    react: hooks, "next/image": () => null,
    "@/lib/membership/member-photo-crop": { ...crop, decodeMemberPhoto(url, signal) { const task = deferred(); decodes.push({ ...task, url, signal }); return task.promise; }, async exportMemberPhotoCrop(source, position) { exports.push({ source, position }); return options.export ? options.export() : new File(["cropped"], "profile.jpg", { type: "image/jpeg" }); } },
    "@/components/membership/MemberPortraitState": { useMemberPortrait() { const captured = ownerId; return { avatarUrl: override === undefined ? saved : override, ownerId, setAvatarUrl(value) { published.push({ ownerId: captured, value }); override = value; } }; } },
  }, { window: new EventTarget(), URL: { createObjectURL: () => `blob:photo-${++urlNumber}`, revokeObjectURL: url => revoked.push(url) }, fetch: async (url, init) => { calls.push({ url, ...init }); return options.fetch ? options.fetch(url, init) : { ok: true, json: async () => ({ avatarUrl: init.method === "DELETE" ? null : newUrl }) }; } })).default;
  const render = () => { cursor = 0; const tree = Component(props); effects.splice(0).forEach(effect => effect()); return tree; };
  const select = (file = photo) => nodes(render()).find(node => node.type === "input" && node.props.type === "file").props.onChange({ currentTarget: { files: [file], value: "selected" } });
  const choose = async () => { const pending = select(); decodes.at(-1).resolve(decoded); await pending; render(); };
  return { render, select, choose, calls, changed, published, busy, drafts, revoked, decodes, exports, props, setOwner(value) { ownerId = value; render(); render(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}

test("selection previews immediately but never publishes or uploads until Use photo succeeds", async () => {
  const response = deferred(), ui = await fixture({ fetch: () => response.promise });
  const opening = ui.select();
  assert.equal(image(ui.render()).props.src, "blob:photo-1"); assert.equal(button(ui.render(), "Use photo").props.disabled, true);
  assert.deepEqual(ui.drafts, [true]); assert.deepEqual(ui.busy, []); assert.equal(ui.calls.length, 0); assert.deepEqual(ui.changed, []);
  ui.decodes[0].resolve(decoded); await opening;
  const zoom = nodes(ui.render()).find(node => node.props.id === "photo-zoom"); zoom.props.onChange({ currentTarget: { value: "2" } });
  const saving = button(ui.render(), "Use photo").props.onClick(); await tick();
  assert.equal(ui.exports[0].position.zoom, 2); assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].body.get("photo").type, "image/jpeg");
  assert.deepEqual(ui.calls[0].headers, { "X-Ruined-Session-Owner": "owner-a" }); assert.deepEqual(ui.changed, []); assert.deepEqual(ui.published, []);
  assert.equal(button(ui.render(), "Saving…").props.disabled, true);
  response.resolve({ ok: true, json: async () => ({ avatarUrl: newUrl }) }); await saving;
  assert.deepEqual(ui.changed, [newUrl]); assert.deepEqual(ui.published, [{ ownerId: "owner-a", value: newUrl }]); assert.deepEqual(ui.busy, [true, false]);
  assert.deepEqual(ui.drafts, [true, false]); assert.equal(image(ui.render()).props.src, newUrl); assert.deepEqual(ui.revoked, ["blob:photo-1"]); ui.unmount();
});

test("failed save retains editable crop and old saved state; cancel works when sharing disables upload", async () => {
  const ui = await fixture({ fetch: async () => ({ ok: false, json: async () => ({ error: "Try again later." }) }) }); await ui.choose();
  await button(ui.render(), "Use photo").props.onClick();
  assert.match(text(ui.render()), /Try again later/); assert.equal(image(ui.render()).props.src, "blob:photo-1"); assert.deepEqual(ui.changed, []); assert.deepEqual(ui.published, []); assert.deepEqual(ui.busy, [true, false]);
  ui.props.enabled = false; ui.props.available = false;
  assert.equal(button(ui.render(), "Use photo").props.disabled, true); assert.equal(button(ui.render(), "Cancel").props.disabled, false);
  button(ui.render(), "Cancel").props.onClick(); assert.equal(image(ui.render()).props.src, oldUrl); assert.equal(ui.drafts.at(-1), false); ui.unmount();
});

test("replacement, decode failure and cancellation revoke URLs and ignore stale decoding", async () => {
  const ui = await fixture(); const first = ui.select(); const second = ui.select();
  assert.equal(ui.decodes[0].signal.aborted, true); ui.decodes[1].resolve(decoded); await second;
  ui.decodes[0].resolve({ naturalWidth: 10, naturalHeight: 10 }); await first;
  assert.equal(image(ui.render()).props.src, "blob:photo-2");
  const third = ui.select(); ui.decodes[2].reject(new Error("Unreadable photo")); await third;
  assert.equal(image(ui.render()).props.src, oldUrl); assert.equal(ui.drafts.at(-1), false); assert.match(text(ui.render()), /Unreadable/);
  assert.deepEqual(ui.revoked, ["blob:photo-1", "blob:photo-2", "blob:photo-3"]); ui.unmount();
});

test("duplicate confirmation is suppressed and unmount aborts pending upload without publishing", async () => {
  const response = deferred(), ui = await fixture({ fetch: () => response.promise }); await ui.choose();
  const click = button(ui.render(), "Use photo").props.onClick, pending = click(); await click(); await tick();
  assert.equal(ui.calls.length, 1); ui.unmount(); assert.equal(ui.calls[0].signal.aborted, true);
  response.resolve({ ok: true, json: async () => ({ avatarUrl: newUrl }) }); await pending;
  assert.deepEqual(ui.changed, []); assert.deepEqual(ui.published, []); assert.equal(ui.drafts.at(-1), false); assert.equal(ui.busy.at(-1), false);
});

test("owner changes discard old drafts and A to B to A cannot publish a stale export", async () => {
  const exportResult = deferred(), ui = await fixture({ export: () => exportResult.promise }); await ui.choose();
  const saving = button(ui.render(), "Use photo").props.onClick();
  ui.setOwner("owner-b"); ui.setOwner("owner-a");
  assert.equal(button(ui.render(), "Use photo"), undefined); assert.equal(ui.drafts.at(-1), false);
  exportResult.resolve(new File(["crop"], "profile.jpg", { type: "image/jpeg" })); await saving;
  assert.equal(ui.calls.length, 0); assert.deepEqual(ui.changed, []); assert.deepEqual(ui.published, []); ui.unmount();
});

test("an old account response cannot publish or unlock a newer account's pending save", async () => {
  const responses = [deferred(), deferred()]; let requestNumber = 0;
  const ui = await fixture({ fetch: () => responses[requestNumber++].promise }); await ui.choose();
  const first = button(ui.render(), "Use photo").props.onClick(); await tick();
  ui.setOwner("owner-b"); await ui.choose();
  const second = button(ui.render(), "Use photo").props.onClick(); await tick();
  assert.equal(ui.calls[0].signal.aborted, true);
  responses[0].resolve({ ok: true, json: async () => ({ avatarUrl: oldUrl }) }); await first;
  assert.deepEqual(ui.changed, []); assert.equal(button(ui.render(), "Saving…").props.disabled, true); assert.equal(ui.busy.at(-1), true);
  responses[1].resolve({ ok: true, json: async () => ({ avatarUrl: newUrl }) }); await second;
  assert.deepEqual(ui.changed, [newUrl]); assert.deepEqual(ui.published, [{ ownerId: "owner-b", value: newUrl }]); ui.unmount();
});

test("confirmed removal publishes null; failed removal leaves the saved portrait untouched", async () => {
  for (const ok of [false, true]) {
    const ui = await fixture({ fetch: async () => ({ ok, json: async () => ok ? { avatarUrl: null } : { error: "Could not remove" } }) });
    await button(ui.render(), "Remove photo").props.onClick();
    assert.equal(ui.calls[0].method, "DELETE"); assert.equal(ui.calls[0].body, undefined);
    assert.deepEqual(ui.changed, ok ? [null] : []); assert.deepEqual(ui.published, ok ? [{ ownerId: "owner-a", value: null }] : []); ui.unmount();
  }
});
