import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as promotion from "../src/lib/store/ranch-promotion.js";
import * as ranch from "../src/lib/store/ranch-catalog.js";
import * as colors from "../src/lib/store/product-colors.ts";
import { productOffers } from "../src/lib/store/product-metadata.ts";

const start = Date.parse(promotion.RANCH_SALE_START);
const end = Date.parse(promotion.RANCH_SALE_END);
const variant = { id: "gid://shopify/ProductVariant/123", title: "Blue / M", price: "$96", priceAmount: "96.00", currencyCode: "USD", available: true, selectedOptions: [{ name: "Color", value: "Blue" }, { name: "Size", value: "M" }] };
const product = { id: "mens-ruined-ranch-hoodie", shopifyProductGid: ranch.RANCH_PRODUCT_IDS[0], name: "Men's Ruined Ranch Hoodie", code: "RR", price: "$96", variants: [variant], pricingAsOf: start, available: true, options: [{ name: "Color", values: ["Blue"] }], image: { url: "/RR_Mens_Top_Blue_Concrete_Flash.png", alt: "Blue hoodie" }, images: [{ url: "/RR_Mens_Top_Blue_Concrete_Flash.png", alt: "Blue hoodie" }] };
function compile(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports);
  return output.exports;
}

test("automatic sale is restricted to four Shopify identities and the exact configured window", () => {
  assert.equal(promotion.isRanchSaleActive(start - 1), false);
  assert.equal(promotion.isRanchSaleActive(start), true);
  assert.equal(promotion.isRanchSaleActive(end - 1), true);
  assert.equal(promotion.isRanchSaleActive(end), false);
  assert.equal(new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "long", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).format(end), "30 Monday, 11:59:59 PM");
  for (const shopifyProductGid of ranch.RANCH_PRODUCT_IDS) assert.ok(promotion.ranchPromotionPrice({ shopifyProductGid }, variant, start));
  for (const unrelated of [{}, { id: product.id }, { shopifyProductGid: "gid://shopify/Product/999" }]) assert.equal(promotion.ranchPromotionPrice(unrelated, variant, start), undefined);
  assert.equal(promotion.ranchPromotionPrice(product, variant, end), undefined);
});

test("sale amounts preserve cents and original variant prices", () => {
  const original = JSON.stringify(product);
  const hoodie = promotion.ranchPromotionPrice(product, variant, start);
  assert.deepEqual([hoodie.price, hoodie.priceAmount, hoodie.regularPrice, hoodie.savings], ["$57.60", "57.60", "$96", 38.4]);
  const pants = promotion.ranchPromotionPrice({ shopifyProductGid: ranch.RANCH_PRODUCT_IDS[2] }, { ...variant, priceAmount: "72.00" }, start);
  assert.deepEqual([pants.price, pants.priceAmount, pants.regularPrice], ["$43.20", "43.20", "$72"]);
  assert.equal(promotion.ranchPromotionPrice(product, { ...variant, priceAmount: "72.99" }, start).priceAmount, "43.79");
  for (const priceAmount of ["", "NaN", "-4", "Infinity"]) assert.equal(promotion.ranchPromotionPrice(product, { ...variant, priceAmount }, start), undefined);
  assert.equal(JSON.stringify(product), original);
});

test("shared price and sale copy disappear together at expiration", () => {
  let now = start;
  const { default: ProductPrice, RanchSaleNotice } = compile("src/components/store/ProductPrice.tsx", {
    "react/jsx-runtime": jsxRuntime, "@/lib/store/ranch-catalog.js": ranch, "@/lib/store/ranch-promotion.js": promotion,
    "@/lib/store/use-promotion-time": { usePromotionTime: () => now },
  });
  const render = () => renderToStaticMarkup(React.createElement(React.Fragment, null, React.createElement(ProductPrice, { product, variant }), React.createElement(RanchSaleNotice, { product })));
  const active = render();
  assert.match(active, /\$57\.60/); assert.match(active, /<del[^>]*>\$96<\/del>/); assert.match(active, /Automatically applied at checkout/);
  now = end;
  const expired = render();
  assert.match(expired, /\$96/); assert.doesNotMatch(expired, /\$57\.60|<del|40%/);
});

test("canonical bag prices apply the sale once and expire without mutating stored base prices", () => {
  const { resolveBagItems } = compile("src/components/store/BagPageClient.tsx", {
    "react/jsx-runtime": jsxRuntime, react: React, "next/image": {}, "next/link": {},
    "@/lib/analytics/shopify": {}, "@/lib/analytics/storefront": {}, "@/lib/marketing/consent": {}, "@/lib/marketing/meta": {},
    "@/data/store-policies": {}, "@/lib/store/product-colors": colors, "./bag-store": {},
    "@/lib/store/ranch-promotion.js": promotion, "@/lib/store/use-promotion-time": {},
  });
  const stored = [{ key: "item", variantId: variant.id, productId: product.id, quantity: 2, priceAmount: "1.00", unitPrice: "$1" }];
  const snapshot = JSON.stringify(stored);
  const [sale] = resolveBagItems(stored, [product], start);
  assert.equal(sale.priceAmount, "57.60"); assert.equal(sale.regularUnitPrice, "$96"); assert.equal(Number(sale.priceAmount) * sale.quantity, 115.2);
  const [twice] = resolveBagItems([sale], [product], start);
  assert.equal(twice.priceAmount, "57.60");
  const [expired] = resolveBagItems([sale], [product], end);
  assert.equal(expired.priceAmount, "96.00"); assert.equal(expired.regularUnitPrice, undefined);
  assert.equal(sale.variantId, variant.id); assert.equal(JSON.stringify(stored), snapshot); assert.equal(variant.priceAmount, "96.00");
});

test("structured offers match the visible sale and return to base pricing after the deadline", () => {
  const offer = (pricingAsOf) => productOffers({ variants: [variant], productUrl: "https://theruinedproject.com/store/mens-ruined-ranch-hoodie", product: { ...product, pricingAsOf } })[0];
  assert.equal(offer(start).price, "57.60"); assert.equal(offer(start).validThrough, promotion.RANCH_SALE_END);
  assert.equal(offer(end).price, "96.00"); assert.equal(offer(end).validThrough, undefined);
});

test("open pages schedule the exact sale deadline and refresh when the tab wakes", () => {
  const originalNow = Date.now, originalWindow = globalThis.window, originalDocument = globalThis.document;
  const timers = [], listeners = new Map(), effects = [], cleared = [];
  let clock = start, value;
  Date.now = () => clock;
  globalThis.window = { setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }, clearTimeout: (id) => cleared.push(id), addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: (name) => listeners.delete(name) };
  globalThis.document = { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: (name) => listeners.delete(name) };
  try {
    const { usePromotionTime } = compile("src/lib/store/use-promotion-time.ts", {
      react: { useState: (initial) => { value = initial(); return [value, (next) => { value = next; }]; }, useEffect: (fn) => effects.push(fn) },
      "./ranch-promotion.js": promotion,
    });
    assert.equal(usePromotionTime(start - 20), start - 20);
    const cleanup = effects[0]();
    assert.equal(value, start); assert.equal(timers.length, 1); assert.equal(timers[0].delay, end - start + 1);
    clock = end; timers[0].callback(); assert.equal(promotion.isRanchSaleActive(value), false);
    clock = end + 100; listeners.get("visibilitychange")(); assert.equal(value, clock);
    cleanup(); assert.deepEqual(cleared, [1]); assert.equal(listeners.size, 0);
  } finally { Date.now = originalNow; globalThis.window = originalWindow; globalThis.document = originalDocument; }
});
