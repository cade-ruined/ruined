import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

function fixture({ reduced = false, observerAvailable = true } = {}) {
  const slots = [], effects = [];
  let cursor = 0, intersect, disconnected = false, plays = 0, pauses = 0;
  const preference = new EventTarget();
  preference.matches = reduced;
  const document = new EventTarget();
  document.visibilityState = "visible";
  const video = { play() { plays += 1; return Promise.resolve(); }, pause() { pauses += 1; } };
  const react = {
    ...React,
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useEffect(callback, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((dep, index) => dep !== slots[i].deps[index])) {
        effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; });
      }
    },
  };
  const code = ts.transpileModule(readFileSync(new URL("../src/components/sequence/JourneyPreviewVideo.tsx", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const output = { exports: {} };
  const Observer = class {
    constructor(callback) { intersect = callback; }
    observe(target) { assert.equal(target, video); }
    disconnect() { disconnected = true; }
  };
  new Function("require", "module", "exports", "window", "document", "IntersectionObserver", code)(
    name => ({ react, "react/jsx-runtime": jsxRuntime })[name], output, output.exports,
    { matchMedia: () => preference }, document, observerAvailable ? Observer : undefined,
  );
  const render = () => {
    cursor = 0;
    const node = output.exports.default({ src: "/film.mp4", poster: "/poster.jpg", label: "A preview" });
    node.props.ref.current = video;
    effects.splice(0).forEach(effect => effect());
    return node;
  };
  return {
    render,
    visible(ratio) { intersect([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]); },
    reduced(value) { preference.matches = value; preference.dispatchEvent(new Event("change")); },
    hidden(value) { document.visibilityState = value ? "hidden" : "visible"; document.dispatchEvent(new Event("visibilitychange")); },
    cleanup() { slots.forEach(slot => slot?.cleanup?.()); },
    get plays() { return plays; }, get pauses() { return pauses; }, get disconnected() { return disconnected; },
  };
}

test("an offscreen carousel film cannot request video bytes until its card is visible", () => {
  const view = fixture();
  assert.equal(view.render().props.src, undefined);
  assert.equal(view.render().props.poster, "/poster.jpg");
  assert.equal(view.render().props.preload, "none");
  view.visible(0.1);
  assert.equal(view.render().props.src, undefined);
  view.visible(0.5);
  assert.equal(view.render().props.src, "/film.mp4");
  assert.equal(view.plays, 1);
  view.visible(0);
  assert.equal(view.render().props.autoPlay, false);
  assert.ok(view.pauses >= 1);
  view.cleanup();
  assert.equal(view.disconnected, true);
});

test("reduced motion keeps the poster and visibility changes pause a running preview", () => {
  const view = fixture({ reduced: true });
  view.render(); view.visible(1);
  assert.equal(view.render().props.src, undefined);
  view.reduced(false);
  assert.equal(view.render().props.autoPlay, true);
  view.hidden(true);
  assert.equal(view.render().props.autoPlay, false);
  view.hidden(false);
  assert.equal(view.render().props.autoPlay, true);
  view.reduced(true);
  assert.equal(view.render().props.autoPlay, false);
  view.cleanup();
});

test("browsers without visibility observation retain the lightweight poster", () => {
  const view = fixture({ observerAvailable: false });
  assert.equal(view.render().props.src, undefined);
  assert.equal(view.render().props.autoPlay, false);
  assert.equal(view.plays, 0);
  view.cleanup();
});
