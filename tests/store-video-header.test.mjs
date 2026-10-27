import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

function descendants(node, type) {
  if (!node || typeof node !== "object") return [];
  return [
    ...(node.type === type ? [node] : []),
    ...React.Children.toArray(node.props?.children).flatMap(child => descendants(child, type)),
  ];
}

function fixture({ reduced = false, saveData = false, initiallyVisible = true } = {}) {
  const slots = [], effects = [];
  let cursor = 0, intersect, tree, plays = 0, pauses = 0, loads = 0;
  const preference = new EventTarget();
  preference.matches = reduced;
  const connection = new EventTarget();
  connection.saveData = saveData;
  const document = new EventTarget();
  document.visibilityState = "visible";
  const header = { getBoundingClientRect: () => ({ top: initiallyVisible ? 0 : 1500, bottom: 2000 }) };
  const video = {
    error: null,
    play() { plays += 1; descendants(tree, "video")[0].props.onPlay(); return Promise.resolve(); },
    pause() { pauses += 1; descendants(tree, "video")[0].props.onPause(); },
    load() { loads += 1; },
    querySelector: () => descendants(tree, "source")[0] ?? null,
  };
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
  const code = ts.transpileModule(readFileSync(new URL("../src/components/store/StoreVideoHeader.tsx", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", "window", "document", "navigator", "IntersectionObserver", code)(
    name => ({ react, "react/jsx-runtime": jsxRuntime, "next/link": { default: "a" }, "./StoreVideoHeader.module.css": { default: {} } })[name],
    output, output.exports, { innerHeight: 900, matchMedia: () => preference }, document, { connection },
    class {
      constructor(callback) { intersect = callback; }
      observe(target) { assert.equal(target, header); }
      disconnect() {}
    },
  );
  function render() {
    cursor = 0;
    tree = output.exports.default();
    tree.props.ref.current = header;
    descendants(tree, "video")[0].props.ref.current = video;
    effects.splice(0).forEach(effect => effect());
    return tree;
  }
  function settle() { render(); render(); return render(); }
  return {
    render, settle,
    visible(value) { intersect([{ isIntersecting: value }]); settle(); },
    hidden(value) { document.visibilityState = value ? "hidden" : "visible"; document.dispatchEvent(new Event("visibilitychange")); settle(); },
    toggle() { descendants(tree, "button")[0].props.onClick(); settle(); },
    fail(error = { code: 3 }) { video.error = error; descendants(tree, "video")[0].props.onError(); settle(); },
    recover() { video.error = null; descendants(tree, "video")[0].props.onLoadedData(); settle(); },
    get sources() { return descendants(tree, "source").map(node => node.props); },
    get label() { return descendants(tree, "button")[0]?.props["aria-label"]; },
    get video() { return descendants(tree, "video")[0].props; },
    get link() { return descendants(tree, "a")[0].props; },
    get plays() { return plays; }, get pauses() { return pauses; }, get loads() { return loads; },
    cleanup() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

for (const preference of [{ reduced: true }, { saveData: true }]) {
  test(`${Object.keys(preference)[0]} retains the poster without video sources until manual play`, () => {
    const view = fixture(preference);
    view.settle();
    view.visible(true);
    view.hidden(true); view.hidden(false);
    assert.deepEqual(view.sources, []);
    assert.equal(view.plays, 0);
    assert.equal(view.loads, 0);
    assert.equal(view.video.preload, "none");
    assert.equal(view.video.poster, "/media/store/apparel-header.webp");
    assert.equal(view.label, "Play apparel film");
    view.toggle();
    assert.equal(view.sources.length, 2);
    assert.equal(view.sources[0].media, "(max-width: 767px)");
    assert.equal(view.sources[0].src, "/media/store/apparel-header-mobile.mp4");
    assert.equal(view.plays, 1);
    assert.equal(view.label, "Pause apparel film");
    view.cleanup();
  });
}

test("an offscreen hero waits, pauses when hidden, and preserves an explicit pause across visibility changes", () => {
  const view = fixture({ initiallyVisible: false });
  view.settle();
  assert.deepEqual(view.sources, []);
  view.visible(true);
  assert.equal(view.label, "Pause apparel film");
  assert.equal(view.loads, 1);
  view.visible(false);
  assert.equal(view.label, "Play apparel film");
  const pausedPlays = view.plays;
  view.visible(true);
  assert.ok(view.plays > pausedPlays);
  view.hidden(true);
  assert.equal(view.label, "Play apparel film");
  view.hidden(false);
  assert.equal(view.label, "Pause apparel film");
  view.toggle();
  const manualPlays = view.plays;
  view.visible(false); view.visible(true);
  view.hidden(true); view.hidden(false);
  assert.equal(view.plays, manualPlays);
  assert.equal(view.label, "Play apparel film");
  view.cleanup();
});

test("video errors preserve the poster and back link without a broken playback control", () => {
  const view = fixture();
  view.settle();
  view.fail();
  const failedPlays = view.plays;
  view.visible(false); view.visible(true);
  view.hidden(true); view.hidden(false);
  assert.equal(view.plays, failedPlays);
  assert.equal(view.label, undefined);
  assert.equal(view.video.poster, "/media/store/apparel-header.webp");
  assert.equal(view.link.href, "/#top");
  view.cleanup();
});

test("responsive-source transitions cannot hide a healthy video, and successful media loading clears fallback", () => {
  const view = fixture();
  view.settle();
  view.fail(null);
  assert.equal(view.label, "Pause apparel film");
  view.fail({ code: 1 });
  assert.equal(view.label, "Pause apparel film");
  view.fail();
  assert.equal(view.label, undefined);
  view.recover();
  assert.equal(view.label, "Pause apparel film");
  view.toggle();
  view.fail();
  view.recover();
  assert.equal(view.label, "Play apparel film");
  view.cleanup();
});
