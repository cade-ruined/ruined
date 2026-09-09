import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createStorefrontApiClient } from "@shopify/storefront-api-client";
import ts from "typescript";
import { loadCatalog, CATALOG_REQUEST_TIMEOUT_MS } from "../src/lib/store/catalog-loader.ts";
import { normalizeExpectedShipDateLanguage } from "../src/lib/store/product-copy.js";

async function compile(relativePath, dependencies, environment = {}) {
  const source = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports, { env: environment });
  return output.exports;
}

// Exercise the actual homepage adapter, Shopify mapper, installed Storefront
// SDK, and cancellation boundary. Only upstream HTTP is replaced; no provider
// request, credential, or Next cache backend is needed for these regressions.
async function createHomepage(fetch, configured = true) {
  const shopify = await compile("src/lib/shopify.ts", {
    "server-only": {},
    "@shopify/storefront-api-client": {
      createStorefrontApiClient: (options) => createStorefrontApiClient({ ...options, customFetchApi: fetch }),
    },
    "@/data/products": { TONE_BY_HANDLE: {}, TONE_CYCLE: ["warm"] },
    "@/lib/store/product-copy.js": { normalizeExpectedShipDateLanguage },
    "@/lib/store/catalog-loader": { loadCatalog },
  }, configured ? {
    SHOPIFY_STORE_DOMAIN: "fixture.myshopify.com",
    SHOPIFY_STOREFRONT_ACCESS_TOKEN: "fixture-not-a-credential",
  } : {});
  return compile("src/lib/store/homepage-catalog.ts", {
    "server-only": {},
    "@/lib/shopify": shopify,
  });
}

function productResponse(amount = "48.00") {
  return Response.json({ data: { products: { nodes: [{
    id: "gid://shopify/Product/1", handle: "byob-tank", title: "BYOB Tank",
    description: "Cotton tank.", descriptionHtml: "<p>Cotton tank.</p>",
    featuredImage: null, images: { nodes: [] }, options: [], metafields: [],
    priceRange: { minVariantPrice: { amount, currencyCode: "USD" } },
    variants: { nodes: [{
      id: "gid://shopify/ProductVariant/1", title: "M", availableForSale: true,
      selectedOptions: [{ name: "Size", value: "M" }], price: { amount, currencyCode: "USD" },
    }] },
  }] } } });
}

test("homepage reads fresh Shopify products without a separate cache dependency", async () => {
  const requests = [];
  const { getHomepageCatalog } = await createHomepage(async (url, init) => {
    requests.push({ url, init });
    return productResponse(requests.length === 1 ? "48.00" : "52.00");
  });
  const first = await getHomepageCatalog();
  const second = await getHomepageCatalog();
  assert.equal(first.status, "ready");
  assert.equal(first.products[0].id, "byob-tank");
  assert.equal(first.products[0].price, "$ 48");
  assert.equal(second.products[0].price, "$ 52");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.method, "POST");
  assert.ok(requests[0].init.signal instanceof AbortSignal);
});

test("homepage distinguishes unconfigured from a successful empty catalog", async () => {
  let requests = 0;
  const fetch = async () => { requests += 1; return Response.json({ data: { products: { nodes: [] } } }); };
  const unconfigured = await createHomepage(fetch, false);
  assert.deepEqual(await unconfigured.getHomepageCatalog(), { status: "unconfigured", products: [] });
  assert.equal(requests, 0);
  const configured = await createHomepage(fetch);
  assert.deepEqual(await configured.getHomepageCatalog(), { status: "empty", products: [] });
  assert.equal(requests, 1);
});

test("a failed homepage read never poisons recovery or returns a stale success", async () => {
  let requests = 0;
  const { getHomepageCatalog } = await createHomepage(async () => {
    requests += 1;
    if (requests === 1) return new Response("Unavailable", { status: 503 });
    if (requests === 3) throw new Error("Network unavailable");
    return productResponse();
  });
  assert.deepEqual(await getHomepageCatalog(), { status: "unavailable", products: [] });
  assert.equal((await getHomepageCatalog()).status, "ready");
  assert.deepEqual(await getHomepageCatalog(), { status: "unavailable", products: [] });
  assert.equal((await getHomepageCatalog()).status, "ready");
  assert.equal(requests, 4);
});

test("homepage retains the five-second upstream cancellation limit and can retry afterwards", async (context) => {
  const signals = [];
  const { getHomepageCatalog } = await createHomepage(async (_url, init) => {
    signals.push(init.signal);
    if (signals.length > 1) return productResponse();
    return new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    });
  });
  context.mock.timers.enable({ apis: ["setTimeout"] });
  assert.equal(CATALOG_REQUEST_TIMEOUT_MS, 5000);
  const pending = getHomepageCatalog();
  context.mock.timers.tick(4999);
  assert.equal(signals[0].aborted, false);
  context.mock.timers.tick(1);
  assert.deepEqual(await pending, { status: "unavailable", products: [] });
  assert.equal(signals[0].aborted, true);
  assert.equal((await getHomepageCatalog()).status, "ready");
});

test("homepage and Store share fresh catalog reads while checkout still validates products", async () => {
  const [home, adapter, store, checkout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/store/homepage-catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/store/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/store/checkout/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(home, /getHomepageCatalog\(\)/);
  assert.match(home, /dynamic = "force-dynamic"/);
  assert.match(adapter, /return getCatalog\(\)/);
  assert.doesNotMatch(adapter, /unstable_cache|next\/cache|fetchedAt/);
  assert.match(store, /getCatalog\(\)/);
  assert.match(checkout, /await getProducts\(\)/);
});
