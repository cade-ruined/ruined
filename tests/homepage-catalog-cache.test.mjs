import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import ts from "typescript";

const require = createRequire(import.meta.url);
// Next initializes this global in its server bootstrap; supply that same
// runtime primitive while importing its cache in this isolated test process.
const previousAsyncLocalStorage = globalThis.AsyncLocalStorage;
globalThis.AsyncLocalStorage = AsyncLocalStorage;
const nextCache = require("next/cache");
const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external");
if (previousAsyncLocalStorage === undefined) delete globalThis.AsyncLocalStorage;
else globalThis.AsyncLocalStorage = previousAsyncLocalStorage;
const source = await readFile(new URL("../src/lib/store/homepage-catalog.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadModule(getCatalog, cache = nextCache, configured = true) {
  const output = { exports: {} };
  const dependencies = {
    "server-only": {},
    "next/cache": cache,
    "@/lib/shopify": { getCatalog, isShopifyConfigured: configured },
  };
  new Function("require", "module", "exports", "process", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports, { env: { SHOPIFY_STORE_DOMAIN: "fixture.myshopify.com" } });
  return output.exports;
}

// Use the installed Next cache implementation with an isolated test cache
// backend. This exercises real callback/write ordering without a server or IO.
test("Next caches successful homepage reads but never persists unavailable as a successful empty catalog", async (context) => {
  const previousCache = globalThis.__incrementalCache;
  const values = new Map();
  const writes = [];
  let requests = 0;
  let response = { status: "unavailable", products: [] };
  globalThis.__incrementalCache = {
    generateSimpleCacheKey: async (key) => key,
    get: async (key) => values.has(key) ? { value: values.get(key), isStale: false } : null,
    set: async (key, value) => { writes.push(value); values.set(key, value); },
  };
  context.after(() => {
    if (previousCache === undefined) delete globalThis.__incrementalCache;
    else globalThis.__incrementalCache = previousCache;
  });
  const { getHomepageCatalog } = loadModule(async () => { requests += 1; return response; });

  assert.deepEqual(await getHomepageCatalog(), { status: "unavailable", products: [] });
  assert.equal(writes.length, 0, "a failed read must not become a cached empty catalog");
  assert.deepEqual(await getHomepageCatalog(), { status: "unavailable", products: [] });
  assert.equal(requests, 2, "the next read retries after failure");
  assert.equal(writes.length, 0);

  response = { status: "empty", products: [] };
  assert.deepEqual(await getHomepageCatalog(), response);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].revalidate, 60);
  assert.equal(JSON.parse(writes[0].data.body).catalog.status, "empty");
  assert.deepEqual(await getHomepageCatalog(), response);
  assert.equal(requests, 3, "a fresh successful empty result is reused");

  values.clear();
  response = { status: "ready", products: [{ id: "real-piece", price: "$ 48" }] };
  assert.deepEqual(await getHomepageCatalog(), response);
  assert.deepEqual(await getHomepageCatalog(), response);
  assert.equal(requests, 4, "available teaser products share the same short cache");
  assert.equal(writes.length, 2);
});

test("missing configuration stays distinct and never touches the homepage cache", async () => {
  let called = false;
  const { getHomepageCatalog } = loadModule(async () => { called = true; throw new Error("Unexpected read"); }, {
    unstable_cache: () => async () => { called = true; throw new Error("Unexpected cache read"); },
  }, false);
  assert.deepEqual(await getHomepageCatalog(), { status: "unconfigured", products: [] });
  assert.equal(called, false);
});

test("a force-dynamic App Router page still reuses its explicit successful data cache", async () => {
  const values = new Map();
  let requests = 0;
  const workStore = {
    forceDynamic: true,
    route: "/",
    pendingRevalidates: {},
    incrementalCache: {
      generateSimpleCacheKey: async (key) => key,
      get: async (key) => values.has(key) ? { value: values.get(key), isStale: false } : null,
      set: async (key, value) => { values.set(key, value); },
    },
  };
  const { getHomepageCatalog } = loadModule(async () => {
    requests += 1;
    return { status: "ready", products: [{ id: "real-piece", price: "$ 48" }] };
  });
  await workAsyncStorage.run(workStore, async () => {
    assert.equal((await getHomepageCatalog()).status, "ready");
    await Promise.all(Object.values(workStore.pendingRevalidates));
    assert.equal((await getHomepageCatalog()).status, "ready");
  });
  assert.equal(requests, 1);
  assert.equal(values.size, 1);
});

test("an extended outage cannot keep stale homepage product claims visible indefinitely", async () => {
  const { getHomepageCatalog } = loadModule(async () => { throw new Error("Unexpected read"); }, {
    unstable_cache: () => async () => ({
      catalog: { status: "ready", products: [{ id: "old-piece", price: "$ 32" }] },
      fetchedAt: Date.now() - 121_000,
    }),
  });
  assert.deepEqual(await getHomepageCatalog(), { status: "unavailable", products: [] });
});

test("cached homepage teasers remain separate from fresh Store and checkout catalog reads", async () => {
  const [home, store, shopify, checkout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/store/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/shopify.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/store/checkout/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(home, /getHomepageCatalog\(\)/);
  assert.match(home, /dynamic = "force-dynamic"/);
  assert.match(store, /getCatalog\(\)/);
  assert.doesNotMatch(shopify, /unstable_cache|getHomepageCatalog/);
  assert.match(checkout, /await getProducts\(\)/);
});
