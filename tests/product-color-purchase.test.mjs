import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as colors from "../src/lib/store/product-colors.ts";

function load(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports);
  return output.exports;
}

const product = {
  id: "sunday-clothes-hoodie", name: "Sunday Clothes Hoodie", code: "RU—005", price: "$ 96",
  subtitle: "", material: "", origin: "", care: "", tone: "shadow", available: true,
  image: { url: "/SundayClothes-BlackHoodieFront.png", alt: "Sunday Clothes Hoodie" },
  images: ["Black", "Blue", "Grey", "Red"].flatMap((color) => ["Front", "Back"].map((view) => ({
    url: `/SundayClothes-${color}Hoodie${view}.png`, alt: "Sunday Clothes Hoodie",
  }))),
  options: [{ name: "Color", values: ["Black", "Blue", "Grey", "Red"] }, { name: "Size", values: ["S", "M"] }],
  variants: ["Black", "Blue", "Grey", "Red"].flatMap((color, index) => ["S", "M"].map((size, offset) => ({
    id: `gid://shopify/ProductVariant/${index * 2 + offset + 1}`, title: `${color} / ${size}`,
    available: color !== "Grey", price: "$ 96", priceAmount: "96.00", currencyCode: "USD",
    selectedOptions: [{ name: "Color", value: color }, { name: "Size", value: size }],
  }))),
};
const dependencies = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "next/link": { default: () => null },
  "next/image": { default: () => null },
  "@/lib/store/product-colors": colors,
  "@/data/store-policies": { FREE_STANDARD_SHIPPING_COPY: "Free standard shipping on U.S. orders $70+." },
  "./bag-store": { useBag: () => ({}), isShopifyVariantId: (id) => id.startsWith("gid://shopify/") },
  "@/data/product-size-guides": { getProductSizeGuide: () => undefined, getProductSizeGuideConfig: () => undefined },
  "./BagLink": { default: () => null },
  "./ProductSizeGuideDialog": { default: () => null },
};
function elements(node) {
  return React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
}
function content(node) {
  return typeof node === "string" ? node : React.isValidElement(node) ? React.Children.toArray(node.props.children).map(content).join("") : "";
}
function purchase(initialColor) {
  const slots = [];
  let cursor = 0;
  const added = [];
  const changed = [];
  const Component = load("src/components/store/ProductPurchase.tsx", {
    ...dependencies,
    react: { ...React, useMemo: (fn) => fn(), useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    } },
    "./bag-store": { ...dependencies["./bag-store"], useBag: () => ({ add: (item) => added.push(item) }) },
  }).default;
  const render = () => { cursor = 0; return elements(Component({ product, initialColor, onColorChange: (color) => changed.push(color) })); };
  const button = (label) => render().find((node) => node.type === "button" && content(node) === label);
  const submit = () => render().find((node) => node.type === "button" && elements(node).some((child) => child.props["aria-live"] === "polite"));
  return { render, button, submit, added, changed };
}

test("a color listing preselects its color, requires size, and adds the exact variant and matching image", () => {
  for (const color of ["Black", "Blue", "Red"]) {
    const view = purchase(color);
    assert.equal(view.button(color).props["aria-pressed"], true);
    assert.equal(content(view.submit()), "Select size");
    assert.equal(view.submit().props.disabled, true);
    view.submit().props.onClick();
    assert.equal(view.added.length, 0);
    view.button("M").props.onClick();
    assert.equal(view.submit().props.disabled, false);
    view.submit().props.onClick();
    const expected = product.variants.find((variant) => variant.title === `${color} / M`);
    assert.equal(view.added[0].variantId, expected.id);
    assert.equal(view.added[0].productId, product.id);
    assert.deepEqual(view.added[0].selectedOptions, expected.selectedOptions);
    assert.equal(view.added[0].image.url, `/SundayClothes-${color}HoodieFront.png`);
  }
});

test("changing color updates the gallery owner, clears size, and clears the added state", () => {
  const view = purchase("Black");
  view.button("M").props.onClick();
  view.submit().props.onClick();
  assert.equal(content(view.submit()), "Added to bag");
  view.button("Blue").props.onClick();
  assert.deepEqual(view.changed, ["Blue"]);
  assert.equal(view.button("M").props["aria-pressed"], false);
  assert.equal(content(view.submit()), "Select size");
  assert.equal(view.submit().props.disabled, true);
});

test("a sold-out color remains viewable and cannot add another color's available stock", () => {
  const view = purchase("Grey");
  assert.equal(view.button("Grey").props["aria-pressed"], true);
  assert.equal(view.button("Grey").props.disabled, false);
  assert.equal(view.button("M").props.disabled, true);
  assert.equal(content(view.submit()), "Sold out");
  view.submit().props.onClick();
  assert.deepEqual(view.added, []);
  view.button("Red").props.onClick();
  assert.equal(content(view.submit()), "Select size");
});

test("unknown URL colors cannot initialize a fabricated purchase option", () => {
  const view = purchase("Yellow");
  assert.equal(content(view.submit()), "Select options");
  assert.equal(view.submit().props.disabled, true);
});

test("bag reconciliation keeps the selected color's image, link, price, and canonical Shopify variant", () => {
  const { resolveBagItems } = load("src/components/store/BagPageClient.tsx", dependencies);
  const chosen = product.variants.find((variant) => variant.title === "Red / M");
  const [item] = resolveBagItems([{
    key: "saved", variantId: chosen.id, productId: product.id, productName: "Old name",
    priceAmount: "1.00", image: product.image, quantity: 2,
  }], [product]);
  assert.equal(item.variantId, chosen.id);
  assert.equal(item.productId, product.id);
  assert.equal(item.productName, product.name);
  assert.equal(item.image.url, "/SundayClothes-RedHoodieFront.png");
  assert.equal(item.href, "/store/sunday-clothes-hoodie?color=Red");
  assert.equal(item.priceAmount, "96.00");
  assert.equal(item.quantity, 2);
  assert.equal(item.available, true);
});
