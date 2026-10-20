import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as fits from "../src/lib/store/product-fit-images.ts";
import * as colors from "../src/lib/store/product-colors.ts";
import * as links from "../src/lib/store/product-links.ts";

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
  let query = "color=Blue";
  const Gallery = () => null;
  const Purchase = () => null;
  const dependencies = {
    react: { ...React, useEffect: () => {}, useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; }, useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = value; }];
    } },
    "react/jsx-runtime": jsxRuntime,
    "./ProductGallery": { default: Gallery },
    "next/navigation": { useSearchParams: () => new URLSearchParams(query) },
    "@/data/products": { PRODUCT_TONES: { shadow: "#000" } },
    "@/lib/store/product-colors": colors,
    "@/lib/store/product-fit-images": fits,
    "@/lib/store/product-links": links,
    "@/lib/marketing/consent": { MARKETING_CONSENT_EVENT: "consent" },
    "@/lib/marketing/meta": { trackMetaProductView: () => {} },
    "@/lib/analytics/storefront": { trackStoreEvent: () => false },
    "./ProductPurchase": { default: Purchase },
  };
  const output = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports);
  const elements = (node) => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
  const render = (value = product) => { cursor = 0; return elements(output.exports.default({ product: value })); };
  const gallery = (tree) => tree.find((node) => node.type === Gallery);
  const images = (tree) => gallery(tree).props.images.map((image) => image.url);
  const initialGalleryKey = gallery(render()).key;
  assert.deepEqual(images(render()), photos.slice(0, 2).map((photo) => photo.url));
  globalThis.window = { location: { pathname: "/store/byob-tank", search: "" }, history: { replaceState: () => {} } };
  render().find((node) => node.type === Purchase).props.onFitChange("Women's");
  assert.deepEqual(images(render()), photos.slice(2).map((photo) => photo.url));
  assert.equal(gallery(render()).props.label, "Women's product photographs");
  assert.notEqual(gallery(render()).key, initialGalleryKey, "changing fit remounts the gallery at its first photo");
  render().find((node) => node.type === Purchase).props.onFitChange("Men's");
  assert.deepEqual(images(render()), photos.slice(0, 2).map((photo) => photo.url));
  slots.length = 0;
  const blue = { url: "/blue.png", alt: "Blue front" };
  const hoodie = { ...product, id: "another-hoodie", options: [{ name: "Color", values: ["Black", "Blue"] }],
    variants: [{ available: true, selectedOptions: [{ name: "Color", value: "Blue" }], image: blue, id: "gid://shopify/ProductVariant/1" }] };
  assert.deepEqual(images(render(hoodie)), [blue.url]);
  const blueKey = gallery(render(hoodie)).key;
  query = "variant=1";
  assert.equal(gallery(render(hoodie)).key, blueKey, "choosing a size within the same color keeps the current photo");
  const black = { url: "/black.png", alt: "Black front" };
  const twoColors = { ...hoodie, variants: [...hoodie.variants, { ...hoodie.variants[0], id: "gid://shopify/ProductVariant/2", selectedOptions: [{ name: "Color", value: "Black" }], image: black }] };
  query = "color=Black";
  assert.deepEqual(images(render(twoColors)), [black.url]);
  assert.notEqual(gallery(render(twoColors)).key, blueKey, "changing color remounts the gallery at its first photo");
  const other = { ...product, id: "single-style", options: [], images: photos };
  assert.deepEqual(images(render(other)), photos.map((photo) => photo.url), "single-style products retain every photo");
});
