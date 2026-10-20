import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const images = ["front", "back", "detail"].map(view => ({ url: `/${view}.jpg`, alt: `Garment — ${view}` }));
const elements = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : "";

function fixture({ photos = images, reducedMotion = false, desktop = false } = {}) {
  const slots = [], scrolls = [];
  let cursor = 0;
  const Image = () => null;
  const dependencies = {
    react: { ...React, useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; }, useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }];
    } },
    "react/jsx-runtime": jsxRuntime,
    "next/image": { default: Image },
    "@/data/products": { PRODUCT_TONES: { shadow: "#000" } },
  };
  const code = ts.transpileModule(readFileSync(new URL("../src/components/store/ProductGallery.tsx", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", "window", code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, output, output.exports, { matchMedia: query => ({ matches: query.includes("reduced-motion") ? reducedMotion : desktop }) });
  const viewport = { clientWidth: 350, scrollLeft: 0, scrollTo(value) { scrolls.push(value); } };
  const render = () => {
    cursor = 0;
    const tree = elements(output.exports.default({ images: photos, tone: "shadow", label: "Black product photographs" }));
    const list = tree.find(node => node.type === "ul");
    if (list) list.props.ref.current = viewport;
    return tree;
  };
  const list = () => render().find(node => node.type === "ul");
  const button = label => render().find(node => node.type === "button" && node.props["aria-label"] === label);
  return { render, list, button, viewport, scrolls, Image, counter: () => text(render().find(node => node.props["aria-live"] === "polite")) };
}

test("gallery controls navigate one image at a time and stop at each end", () => {
  const view = fixture();
  assert.equal(view.counter(), "1 / 3");
  assert.equal(view.button("Previous product image").props.disabled, true);
  assert.equal(view.button("Next product image").props.disabled, false);
  view.button("Next product image").props.onClick();
  assert.deepEqual(view.scrolls.at(-1), { left: 350, behavior: "smooth" });
  assert.equal(view.counter(), "2 / 3");
  view.button("Next product image").props.onClick();
  assert.equal(view.button("Next product image").props.disabled, true);
  assert.equal(view.counter(), "3 / 3");
  view.button("Previous product image").props.onClick();
  assert.equal(view.counter(), "2 / 3");
  const renderedImages = view.render().filter(node => node.type === view.Image);
  assert.deepEqual(renderedImages.map(node => node.props.src), images.map(image => image.url));
  assert.deepEqual(renderedImages.map(node => node.props.priority), [true, false, false]);
});

test("swiping synchronizes the counter and arrow controls without losing the image bounds", () => {
  const view = fixture();
  view.list().props.onScroll({ currentTarget: { clientWidth: 350, scrollLeft: 700 } });
  assert.equal(view.counter(), "3 / 3");
  assert.equal(view.button("Next product image").props.disabled, true);
  view.list().props.onScroll({ currentTarget: { clientWidth: 350, scrollLeft: -25 } });
  assert.equal(view.counter(), "1 / 3");
  view.list().props.onScroll({ currentTarget: { clientWidth: 0, scrollLeft: 900 } });
  assert.equal(view.counter(), "1 / 3");
});

test("keyboard navigation supports arrows and endpoints and honors reduced motion", () => {
  const view = fixture({ reducedMotion: true });
  const prevented = [];
  const press = key => view.list().props.onKeyDown({ key, preventDefault: () => prevented.push(key) });
  press("End");
  assert.equal(view.counter(), "3 / 3");
  assert.deepEqual(view.scrolls.at(-1), { left: 700, behavior: "instant" });
  press("ArrowLeft");
  assert.equal(view.counter(), "2 / 3");
  press("Home");
  assert.equal(view.counter(), "1 / 3");
  press("ArrowLeft");
  assert.equal(view.counter(), "1 / 3");
  press("Tab");
  assert.deepEqual(prevented, ["End", "ArrowLeft", "Home", "ArrowLeft"]);
  const desktop = fixture({ desktop: true });
  desktop.list().props.onKeyDown({ key: "End", preventDefault: () => assert.fail("Desktop keeps native page navigation") });
  assert.deepEqual(desktop.scrolls, []);
});

test("one-photo and missing-photo products do not offer empty navigation", () => {
  for (const photos of [[], images.slice(0, 1)]) {
    const view = fixture({ photos });
    assert.equal(view.render().filter(node => node.type === "button").length, 0);
    assert.equal(view.counter(), "");
    assert.equal(view.render().filter(node => node.type === view.Image).length, photos.length);
    assert.equal(view.list()?.props.tabIndex, undefined);
  }
});
