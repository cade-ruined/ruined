import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as promotion from "../src/lib/store/store-promotion.js";
import * as ranch from "../src/lib/store/ranch-catalog.js";
import * as colors from "../src/lib/store/product-colors.ts";
import { productOffers } from "../src/lib/store/product-metadata.ts";

const start = Date.parse(promotion.STORE_SALE_START);
const end = Date.parse(promotion.STORE_SALE_END);
const variant = { id: "gid://shopify/ProductVariant/123", title: "Blue / M", price: "$96", priceAmount: "96.00", currencyCode: "USD", available: true, selectedOptions: [{ name: "Color", value: "Blue" }, { name: "Size", value: "M" }] };
const product = { id: "mens-ruined-ranch-hoodie", shopifyProductGid: ranch.RANCH_PRODUCT_IDS[0], name: "Men's Ruined Ranch Hoodie", code: "RR", price: "$96", variants: [variant], pricingAsOf: start, available: true, options: [{ name: "Color", values: ["Blue"] }], image: { url: "/RR_Mens_Top_Blue_Concrete_Flash.png", alt: "Blue hoodie" }, images: [{ url: "/RR_Mens_Top_Blue_Concrete_Flash.png", alt: "Blue hoodie" }] };
const teeVariant = { ...variant, id: "gid://shopify/ProductVariant/124", price: "$64", priceAmount: "64.00" };
const teeProduct = { ...product, id: "ruined-tee", shopifyProductGid: "gid://shopify/Product/999", name: "Staple Tee", price: "$64", variants: [teeVariant] };
function compile(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports);
  return output.exports;
}

test("automatic sale covers all Shopify products within the exact configured window", () => {
  assert.equal(promotion.isStoreSaleActive(start - 1), false);
  assert.equal(promotion.isStoreSaleActive(start), true);
  assert.equal(promotion.isStoreSaleActive(end - 1), true);
  assert.equal(promotion.isStoreSaleActive(end), false);
  assert.equal(new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "long", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).format(end), "30 Monday, 11:59:59 PM");
  for (const shopifyProductGid of [...ranch.RANCH_PRODUCT_IDS, teeProduct.shopifyProductGid]) assert.ok(promotion.storePromotionPrice({ shopifyProductGid }, variant, start));
  for (const local of [{}, { id: product.id }, { shopifyProductGid: "local" }, { shopifyProductGid: "gid://shopify/ProductVariant/999" }, { shopifyProductGid: "gid://shopify/Product/0" }]) assert.equal(promotion.storePromotionPrice(local, variant, start), undefined);
  assert.equal(promotion.storePromotionPrice(product, variant, end), undefined);
});

test("sale amounts preserve cents and original variant prices", () => {
  const original = JSON.stringify(product);
  const hoodie = promotion.storePromotionPrice(product, variant, start);
  assert.deepEqual([hoodie.price, hoodie.priceAmount, hoodie.regularPrice, hoodie.savings], ["$67.20", "67.20", "$96", 28.8]);
  const pants = promotion.storePromotionPrice({ shopifyProductGid: ranch.RANCH_PRODUCT_IDS[2] }, { ...variant, priceAmount: "77.00" }, start);
  assert.deepEqual([pants.price, pants.priceAmount, pants.regularPrice], ["$53.90", "53.90", "$77"]);
  assert.equal(promotion.storePromotionPrice(teeProduct, teeVariant, start).priceAmount, "44.80");
  assert.equal(promotion.storePromotionPrice(product, { ...variant, priceAmount: "72.99" }, start).priceAmount, "51.09");
  for (const priceAmount of ["", "NaN", "-4", "Infinity"]) assert.equal(promotion.storePromotionPrice(product, { ...variant, priceAmount }, start), undefined);
  assert.equal(JSON.stringify(product), original);
});

test("shared price and sale copy disappear together at expiration", () => {
  let now = start;
  const { default: ProductPrice, StoreSaleNotice } = compile("src/components/store/ProductPrice.tsx", {
    "react/jsx-runtime": jsxRuntime, "@/lib/store/ranch-catalog.js": ranch, "@/lib/store/store-promotion.js": promotion,
    "@/lib/store/use-promotion-time": { usePromotionTime: () => now },
  });
  const render = () => renderToStaticMarkup(React.createElement(React.Fragment, null, ...[product, teeProduct].map(item => React.createElement(React.Fragment, { key: item.id }, React.createElement(ProductPrice, { product: item, variant: item.variants[0] }), React.createElement(StoreSaleNotice, { product: item })))));
  const active = render();
  assert.match(active, /\$67\.20/); assert.match(active, /\$44\.80/); assert.match(active, /<del[^>]*>\$96<\/del>/); assert.match(active, /<del[^>]*>\$64<\/del>/); assert.match(active, /30% off storewide/); assert.match(active, /Automatically applied at checkout/);
  const compact = renderToStaticMarkup(React.createElement(StoreSaleNotice, { product: teeProduct, compact: true }));
  assert.match(compact, /30% off storewide · through Monday/);
  now = end;
  const expired = render();
  assert.match(expired, /\$96/); assert.match(expired, /\$64/); assert.doesNotMatch(expired, /\$67\.20|\$44\.80|<del|30%/);
});

test("mixed Ranch and regular-product bags apply the sale once and expire without mutating base prices", () => {
  const { resolveBagItems } = compile("src/components/store/BagPageClient.tsx", {
    "react/jsx-runtime": jsxRuntime, react: React, "next/image": {}, "next/link": {},
    "@/lib/analytics/shopify": {}, "@/lib/analytics/storefront": {}, "@/lib/marketing/consent": {}, "@/lib/marketing/meta": {},
    "@/data/store-policies": {}, "@/lib/store/product-colors": colors, "./bag-store": {},
    "@/lib/store/store-promotion.js": promotion, "@/lib/store/use-promotion-time": {},
  });
  const stored = [{ key: "item", variantId: variant.id, productId: product.id, quantity: 2, priceAmount: "1.00", unitPrice: "$1" }, { key: "tee", variantId: teeVariant.id, productId: teeProduct.id, quantity: 1, priceAmount: "1.00", unitPrice: "$1" }];
  const snapshot = JSON.stringify(stored);
  const catalog = [product, teeProduct];
  const sale = resolveBagItems(stored, catalog, start);
  assert.deepEqual(sale.map(item => [item.priceAmount, item.regularUnitPrice]), [["67.20", "$96"], ["44.80", "$64"]]);
  assert.equal(sale.reduce((sum, item) => sum + Math.round(Number(item.priceAmount) * 100) * item.quantity, 0), 17920);
  const twice = resolveBagItems(sale, catalog, start);
  assert.deepEqual(twice.map(item => item.priceAmount), ["67.20", "44.80"]);
  const expired = resolveBagItems(sale, catalog, end);
  assert.deepEqual(expired.map(item => [item.priceAmount, item.regularUnitPrice]), [["96.00", undefined], ["64.00", undefined]]);
  assert.deepEqual(sale.map(item => item.variantId), [variant.id, teeVariant.id]); assert.equal(JSON.stringify(stored), snapshot); assert.equal(variant.priceAmount, "96.00"); assert.equal(teeVariant.priceAmount, "64.00");
});

test("structured offers match the visible sale and return to base pricing after the deadline", () => {
  for (const [item, amount] of [[product, "67.20"], [teeProduct, "44.80"]]) {
    const offer = (pricingAsOf) => productOffers({ variants: item.variants, productUrl: `https://theruinedproject.com/store/${item.id}`, product: { ...item, pricingAsOf } })[0];
    assert.equal(offer(start).price, amount); assert.equal(offer(start).validThrough, promotion.STORE_SALE_END);
    assert.equal(offer(end).price, item.variants[0].priceAmount); assert.equal(offer(end).validThrough, undefined);
  }
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
      "./store-promotion.js": promotion,
    });
    assert.equal(usePromotionTime(start - 20), start - 20);
    const cleanup = effects[0]();
    assert.equal(value, start); assert.equal(timers.length, 1); assert.equal(timers[0].delay, end - start + 1);
    clock = end; timers[0].callback(); assert.equal(promotion.isStoreSaleActive(value), false);
    clock = end + 100; listeners.get("visibilitychange")(); assert.equal(value, clock);
    cleanup(); assert.deepEqual(cleared, [1]); assert.equal(listeners.size, 0);
  } finally { Date.now = originalNow; globalThis.window = originalWindow; globalThis.document = originalDocument; }
});
