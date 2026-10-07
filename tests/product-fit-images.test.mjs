import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as fits from "../src/lib/store/product-fit-images.ts";
import * as colors from "../src/lib/store/product-colors.ts";

const photos = ["Men's", "Women's"].flatMap((fit) => ["back", "front"].map((view) => ({
  url: `https://cdn.shopify.com/files/${fit.replace("'", "").toLowerCase()}-${view}-uploaded.png?v=1`,
  alt: `BYOB Tank — ${fit} — ${view}`,
})));
const product = {
  id: "byob-tank", name: "BYOB Tank", image: photos[0], images: photos,
  options: [{ name: "Fit", values: ["Men's", "Women's"] }],
  variants: [], subtitle: "", material: "", origin: "", care: "", tone: "shadow",
};

test("BYOB explicit alts identify each fit and preserve the supplied back/front order despite interleaved media", () => {
  const interleaved = { ...product, images: [photos[3], photos[1], photos[2], photos[0]] };
  assert.deepEqual(fits.getProductFitImages(interleaved, "Men's"), photos.slice(0, 2));
  assert.deepEqual(fits.getProductFitImages(interleaved, "Women's"), photos.slice(2));
});

test("exact original Shopify filenames identify photos when alt text is generic", () => {
  const namedPhotos = ["mens", "womens"].flatMap((fit) => ["back", "front"].map((view) => ({
    url: `https://cdn.shopify.com/files/byob%20tank%20${fit}%20${view}.png?v=2`, alt: "BYOB Tank",
  })));
  const named = { ...product, images: namedPhotos };
  assert.deepEqual(fits.getProductFitImages(named, "Men's"), namedPhotos.slice(0, 2));
  assert.deepEqual(fits.getProductFitImages(named, "Women's"), namedPhotos.slice(2));
});

test("missing fit photos never borrow another cut's cover or ambiguous media", () => {
  assert.deepEqual(fits.getProductFitImages({ ...product, images: photos.slice(0, 2) }, "Women's"), []);
  const ambiguous = { url: "/some-womens-back.png", alt: "Women's photo" };
  assert.deepEqual(fits.getProductFitImages({ ...product, images: [ambiguous] }, "Women's"), []);
  assert.equal(fits.getProductFitImages(product, "Unisex"), undefined);
  assert.equal(fits.getProductFitImages({ ...product, id: "another-tank" }, "Women's"), undefined);
});

test("product gallery switches to the selected Fit while other products retain color galleries", () => {
  const source = readFileSync(new URL("../src/components/store/ProductDetail.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const slots = [];
  let cursor = 0;
  const Image = () => null;
  const Purchase = () => null;
  const dependencies = {
    react: { ...React, useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = value; }];
    } },
    "react/jsx-runtime": jsxRuntime,
    "next/image": { default: Image },
    "next/navigation": { useSearchParams: () => new URLSearchParams("color=Blue") },
    "@/data/products": { PRODUCT_TONES: { shadow: "#000" } },
    "@/lib/store/product-colors": colors,
    "@/lib/store/product-fit-images": fits,
    "./ProductPurchase": { default: Purchase },
  };
  const output = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports);
  const elements = (node) => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
  const render = (value = product) => { cursor = 0; return elements(output.exports.default({ product: value })); };
  const images = (tree) => tree.filter((node) => node.type === Image).map((node) => node.props.src);
  assert.deepEqual(images(render()), photos.slice(0, 2).map((photo) => photo.url));
  render().find((node) => node.type === Purchase).props.onFitChange("Women's");
  assert.deepEqual(images(render()), photos.slice(2).map((photo) => photo.url));
  assert.ok(render().some((node) => node.props["aria-label"] === "Women's product photographs"));
  render().find((node) => node.type === Purchase).props.onFitChange("Men's");
  assert.deepEqual(images(render()), photos.slice(0, 2).map((photo) => photo.url));
  slots.length = 0;
  const blue = { url: "/blue.png", alt: "Blue front" };
  const hoodie = { ...product, id: "another-hoodie", options: [{ name: "Color", values: ["Black", "Blue"] }],
    variants: [{ available: true, selectedOptions: [{ name: "Color", value: "Blue" }], image: blue, id: "gid://shopify/ProductVariant/1" }] };
  assert.deepEqual(images(render(hoodie)), [blue.url]);
});
