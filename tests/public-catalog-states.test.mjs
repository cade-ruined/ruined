import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { loadCatalog } from "../src/lib/store/catalog-loader.ts";
import * as catalog from "../src/lib/store/catalog.ts";

const product = {
  id: "byob-tank", name: "BYOB Tank", code: "RU—001", price: "$ 48",
  subtitle: "", material: "Cotton", tone: "warm", image: { url: "/tank.webp", alt: "Tank" },
  available: true, variants: [{ id: "variant-1", available: true }],
};

async function compile(relativePath, dependencies, environment = {}) {
  const source = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports, { env: environment });
  return output.exports;
}

const uiDependencies = {
  "react/jsx-runtime": jsxRuntime,
  react: React,
  "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
  "next/image": { default: ({ src, alt }) => React.createElement("img", { src, alt }) },
  "@/lib/store/catalog": catalog,
};
const { default: StoreGallery } = await compile("src/components/store/StoreGallery.tsx", {
  ...uiDependencies,
  "@/data/products": { PRODUCT_TONES: { warm: "#e5e0d5" } },
});
const { JourneyStoreIndex, JourneyLobbyIndex } = await compile("src/components/sequence/JourneyIndexes.tsx", {
  ...uiDependencies,
  "@/data/navigation": { EXPLORE_ROOMS: [] },
  "@/data/public-membership": { MEMBERSHIP_INTRO: { image: "/members.webp", alt: "Members" } },
});

test("catalog differentiates missing configuration, successful empty reads, and available products", async () => {
  assert.deepEqual(await loadCatalog(null, (value) => value), { status: "unconfigured", products: [] });
  assert.deepEqual(await loadCatalog(async () => ({ data: { products: { nodes: [] } } }), (value) => value), { status: "empty", products: [] });
  assert.deepEqual(await loadCatalog(async () => ({ data: { products: { nodes: [product] } } }), (value) => value), { status: "ready", products: [product] });
});

test("provider errors, malformed responses, and mapping failures are unavailable, never empty", async () => {
  const responses = [undefined, {}, { data: {} }, { data: { products: null } }, { data: { products: { nodes: null } } }, { errors: { message: "Rejected" }, data: { products: { nodes: [] } } }];
  for (const response of responses) {
    assert.deepEqual(await loadCatalog(async () => response, (value) => value), { status: "unavailable", products: [] });
  }
  assert.deepEqual(await loadCatalog(async () => { throw new Error("Offline"); }, (value) => value), { status: "unavailable", products: [] });
  assert.deepEqual(await loadCatalog(async () => ({ data: { products: { nodes: [product] } } }), () => { throw new Error("Malformed product"); }), { status: "unavailable", products: [] });
});

test("slow requests receive an abort signal and settle as unavailable", async () => {
  let receivedSignal;
  const result = await loadCatalog((signal) => {
    receivedSignal = signal;
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true }));
  }, (value) => value, 5);
  assert.equal(receivedSignal.aborted, true);
  assert.deepEqual(result, { status: "unavailable", products: [] });
});

test("one failed read cannot poison the next successful catalog request", async () => {
  let requests = 0;
  const request = async () => {
    if (requests++ === 0) throw new Error("Temporary outage");
    return { data: { products: { nodes: [product] } } };
  };
  assert.equal((await loadCatalog(request, (value) => value)).status, "unavailable");
  assert.equal((await loadCatalog(request, (value) => value)).status, "ready");
});

test("the Shopify catalog adapter forwards cancellation and keeps getProducts array-compatible", async () => {
  const requests = [];
  let response = { data: { products: { nodes: [] } } };
  const api = await compile("src/lib/shopify.ts", {
    "server-only": {},
    "@shopify/storefront-api-client": { createStorefrontApiClient: () => ({ request: async (query, options) => {
      requests.push({ query, options });
      return response;
    } }) },
    "@/data/products": { TONE_BY_HANDLE: {}, TONE_CYCLE: ["warm"] },
    "@/lib/store/product-copy.js": { normalizeExpectedShipDateLanguage: (copy) => copy },
    "@/lib/store/catalog-loader": { loadCatalog },
  }, { SHOPIFY_STORE_DOMAIN: "fixture.myshopify.com", SHOPIFY_STOREFRONT_ACCESS_TOKEN: "test-token-not-a-credential" });
  assert.deepEqual(await api.getCatalog(), { status: "empty", products: [] });
  assert.match(requests[0].query, /query Products/);
  assert.equal(requests[0].options.variables.first, 50);
  assert.ok(requests[0].options.signal instanceof AbortSignal);
  response = { errors: { message: "Unavailable" } };
  assert.deepEqual(await api.getProducts(), []);
  assert.equal((await api.getCatalog()).status, "unavailable");
});

test("store failures show recovery/contact links, not a closed shop or configuration details", () => {
  for (const status of ["unavailable", "unconfigured"]) {
    const html = renderToStaticMarkup(React.createElement(StoreGallery, { products: [], catalogStatus: status }));
    assert.match(html, /We couldn’t load the catalog/);
    assert.match(html, /href="\/store"[^>]*>Try again/);
    assert.match(html, /href="\/contact"/);
    assert.doesNotMatch(html, /catalogue is closed|next piece is being prepared|SHOPIFY_|access.token/i);
  }
});

test("a confirmed empty catalog says no pieces are listed without inventing a release", () => {
  const html = renderToStaticMarkup(React.createElement(StoreGallery, { products: [], catalogStatus: "empty" }));
  assert.match(html, /No pieces listed right now/);
  assert.doesNotMatch(html, /Try again|couldn’t load|catalogue is closed/);
  assert.match(html, /Contact Ruined/);
});

test("available products preserve real product routes, price, and sold-out state", () => {
  const html = renderToStaticMarkup(React.createElement(StoreGallery, { products: [{ ...product, available: false }], catalogStatus: "ready" }));
  assert.match(html, /href="\/store\/byob-tank"/);
  assert.match(html, /\$ 48/);
  assert.match(html, /Sold out/);
  assert.doesNotMatch(html, /couldn’t load/);
});

test("the walk store receives an honest state and provides a direct catalog recovery route", () => {
  const unavailable = renderToStaticMarkup(React.createElement(JourneyStoreIndex, { products: [], catalogStatus: "unavailable" }));
  assert.match(unavailable, /We couldn’t load the catalog/);
  assert.match(unavailable, /href="\/store"/);
  assert.match(unavailable, /Try the catalog again/);
  const empty = renderToStaticMarkup(React.createElement(JourneyStoreIndex, { products: [], catalogStatus: "empty" }));
  assert.match(empty, /No pieces listed right now/);
  assert.doesNotMatch(empty, /couldn’t load/);
});

test("a removed featured tank is absent instead of an unclickable stale promotion", () => {
  const html = renderToStaticMarkup(React.createElement(JourneyLobbyIndex, { events: [], products: [] }));
  assert.doesNotMatch(html, /BYOB Tank|BYOB_Tee_Product|\$32|Ships September/);
  assert.match(html, /Good company\. Real work\./);
  assert.match(html, /Meet the Cast/);
});

test("the live lobby tank uses real data and does not advertise sold-out stock as preorder", () => {
  const html = renderToStaticMarkup(React.createElement(JourneyLobbyIndex, { events: [], products: [{ ...product, available: false, expectedShipDate: "2026-10-01" }] }));
  assert.match(html, /href="\/store\/byob-tank"/);
  assert.match(html, /\$48 · Sold out/);
  assert.doesNotMatch(html, /Preorder/);
});
