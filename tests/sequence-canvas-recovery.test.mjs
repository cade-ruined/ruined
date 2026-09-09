import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const transpile = (path) => ts.transpileModule(read(path), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const helperModule = { exports: {} };
new Function("module", "exports", transpile("src/utils/sequenceRecovery.ts"))(helperModule, helperModule.exports);

const frames = ["lobby", "store", "records", "lounge"].flatMap((room) =>
  [1, 2, 3, 4].map((index) => `/sequences/${room}/frame-000${index}.webp?v=approved`),
);
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

function fixture(progress = 0, { delayBitmap = false } = {}) {
  const refs = [];
  const effects = [];
  const requests = [];
  const draws = [];
  const listeners = new Map();
  const timers = new Map();
  const bitmaps = [];
  const scroll = { progress };
  let now = 1_000;
  let frame;
  let timerId = 0;
  const react = { ...React, useRef(initial) { const ref = { current: initial }; refs.push(ref); return ref; }, useEffect(effect) { effects.push(effect); } };
  const window = {
    matchMedia: () => ({ matches: false }), devicePixelRatio: 2, innerWidth: 1440, innerHeight: 900,
    addEventListener(name, listener) { listeners.set(name, listener); }, removeEventListener(name) { listeners.delete(name); },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, location: { reload() { throw new Error("Unexpected reload"); } },
  };
  const request = (url, { signal }) => new Promise((resolve, reject) => {
    const item = { url, signal, resolve, reject, pending: true };
    signal.addEventListener("abort", () => { item.pending = false; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    requests.push(item);
  });
  const componentModule = { exports: {} };
  new Function("require", "module", "exports", "window", "fetch", "createImageBitmap", "requestAnimationFrame", "cancelAnimationFrame", "Date", transpile("src/components/sequence/RoomSequenceCanvas.tsx"))((name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "a" };
    if (name === "@/utils/scrollState") return { scrollState: scroll };
    if (name === "@/utils/sequenceRecovery") return helperModule.exports;
    if (name === "@/utils/sequenceFraming") return { sequenceAssetFocalX: () => 0.5, sequenceCoverRect: () => ({ x: 0, y: 0, width: 1440, height: 900 }), sequenceFocalMediaStyle: () => ({ objectFit: "cover" }) };
    throw new Error(`Unexpected dependency: ${name}`);
  }, componentModule, componentModule.exports, window, request, (blob) => {
    const bitmap = { width: 1920, height: 1080, url: blob.url, closed: false, close() { this.closed = true; } };
    if (!delayBitmap) return Promise.resolve(bitmap);
    return new Promise((resolve) => { bitmaps.push({ bitmap, resolve: () => resolve(bitmap) }); });
  }, (callback) => { frame = callback; return 1; }, () => { frame = undefined; }, class extends Date { static now() { return now; } });
  const view = componentModule.exports.default({ frames });
  const canvas = { style: {}, getContext: () => ({ drawImage: (bitmap) => draws.push(bitmap.url) }) };
  const fallback = { hidden: false };
  let imageSource = "";
  let imageRequests = 0;
  const image = { style: {}, get src() { return imageSource; }, set src(value) { imageSource = value; imageRequests++; } };
  const recovery = { hidden: true };
  [canvas, fallback, image, recovery].forEach((element, index) => { refs[index].current = element; });
  const cleanup = effects[0]();
  const tick = () => frame?.();
  const advance = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    tick();
  };
  const resolve = async (url) => {
    const item = requests.find((candidate) => candidate.url === url && candidate.pending);
    assert.ok(item, `pending request for ${url}`);
    item.pending = false;
    item.resolve({ ok: true, blob: async () => ({ url }) });
    await flush();
  };
  const fail = async (url) => {
    const item = requests.find((candidate) => candidate.url === url && candidate.pending);
    assert.ok(item, `pending request for ${url}`);
    item.pending = false;
    item.reject(new Error("Connection interrupted"));
    await flush();
  };
  return { requests, draws, scroll, canvas, fallback, image, recovery, view, listeners, timers, tick, advance, resolve, fail, cleanup, bitmaps, imageRequests: () => imageRequests };
}

test("a cold direct arrival shows its canonical destination, not the Lobby or a black canvas", () => {
  const h = fixture(11 / 15);
  assert.equal(h.image.src, frames[12], "Members arrival matches its mobile still");
  assert.equal(h.canvas.style.visibility, "hidden");
  assert.equal(h.fallback.hidden, false);
  assert.deepEqual(h.draws, []);
  assert.equal(h.recovery.hidden, true, "routine decoding does not immediately announce an error");
  h.advance(1_600);
  assert.equal(h.recovery.hidden, false, "long waits expose usable retry/navigation");
  h.cleanup();
});

test("crossing rooms hides an old decoded canvas immediately and resumes once the target is ready", async () => {
  const h = fixture();
  await h.resolve(frames[0]);
  h.tick();
  assert.equal(h.fallback.hidden, true);
  assert.deepEqual(h.draws, [frames[0]]);
  h.scroll.progress = 11 / 15;
  h.tick();
  assert.equal(h.fallback.hidden, false);
  assert.equal(h.canvas.style.visibility, "hidden");
  assert.equal(h.image.src, frames[12]);
  assert.equal(h.image.style.visibility, "hidden", "the previous still hides until the new URL loads");
  await h.resolve(frames[11]);
  h.tick();
  assert.equal(h.fallback.hidden, true);
  assert.equal(h.canvas.style.visibility, "visible");
  assert.equal(h.draws.at(-1), frames[11]);
  h.scroll.progress = 0;
  h.tick();
  assert.equal(h.draws.at(-1), frames[0], "reverse scrolling reuses the correct cached room");
  h.cleanup();
});

test("a repeatedly failed target retries after cooldown and online cancels stale work immediately", async () => {
  const h = fixture();
  for (const delay of [500, 1_000, 2_000, 4_000]) {
    await h.fail(frames[0]);
    const count = h.requests.filter((item) => item.url === frames[0]).length;
    h.tick();
    assert.equal(h.requests.filter((item) => item.url === frames[0]).length, count);
    h.advance(delay);
    assert.equal(h.requests.filter((item) => item.url === frames[0]).length, count + 1, "target retries after its cooldown, including after failure three");
  }
  const stale = h.requests.filter((item) => item.pending);
  h.listeners.get("online")();
  assert.ok(stale.every((item) => item.signal.aborted), "reconnect frees stalled request slots");
  await flush();
  await h.resolve(frames[0]);
  h.tick();
  assert.equal(h.fallback.hidden, true);
  h.cleanup();
  await flush();
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});

test("a stalled frame request releases its slot after the deadline", async () => {
  const h = fixture();
  const initial = h.requests.find((item) => item.url === frames[0]);
  h.advance(12_000);
  await flush();
  assert.equal(initial.signal.aborted, true);
  h.advance(500);
  assert.equal(h.requests.filter((item) => item.url === frames[0]).length, 2);
  await h.resolve(frames[0]);
  h.tick();
  assert.equal(h.fallback.hidden, true);
  h.cleanup();
});

test("a failed canonical still retries once per cooldown, never on every animation tick", () => {
  const h = fixture();
  assert.equal(h.imageRequests(), 1);
  h.image.onerror();
  h.tick();
  assert.equal(h.imageRequests(), 1);
  h.advance(500);
  assert.equal(h.imageRequests(), 2);
  for (let index = 0; index < 10; index++) h.tick();
  assert.equal(h.imageRequests(), 2, "pending native image request is not restarted");
  h.image.onerror();
  h.advance(500);
  assert.equal(h.imageRequests(), 2, "second failure increases the cooldown");
  h.advance(500);
  assert.equal(h.imageRequests(), 3);
  h.image.onload();
  assert.equal(h.image.style.visibility, "visible");
  h.cleanup();
});

test("the visible Retry action immediately requeues a failed target", async () => {
  const h = fixture();
  await h.fail(frames[0]);
  const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const retry = nodes(h.view).find((node) => node.type === "button");
  assert.ok(retry);
  retry.props.onClick();
  await flush();
  assert.equal(h.requests.filter((item) => item.url === frames[0]).length, 2);
  await h.resolve(frames[0]);
  h.tick();
  assert.equal(h.fallback.hidden, true);
  h.cleanup();
  await flush();
  assert.equal(h.timers.size, 0);
});

test("a stalled bitmap decode releases its request lane and closes a late result", async () => {
  const h = fixture(0, { delayBitmap: true });
  await h.resolve(frames[0]);
  assert.equal(h.bitmaps.length, 1);
  h.advance(12_000);
  await flush();
  h.advance(500);
  assert.equal(h.requests.filter((item) => item.url === frames[0]).length, 2, "timed-out decoding does not hold the target lane forever");
  h.bitmaps[0].resolve();
  await flush();
  assert.equal(h.bitmaps[0].bitmap.closed, true);
  assert.deepEqual(h.draws, [], "late decoded frames never paint");
  h.cleanup();
  await flush();
  assert.equal(h.timers.size, 0);
});

test("unmount during bitmap decoding aborts safely and closes the eventual bitmap", async () => {
  const h = fixture(0, { delayBitmap: true });
  await h.resolve(frames[0]);
  h.cleanup();
  await flush();
  h.bitmaps[0].resolve();
  await flush();
  assert.equal(h.bitmaps[0].bitmap.closed, true);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.draws, []);
});
