import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const environment = {
  STOREFRONT_ANALYTICS_ENABLED: "true", SHOPIFY_STORE_DOMAIN: "fixture.myshopify.com",
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: "a".repeat(32),
};
const metadata = { data: {
  shop: { id: "gid://shopify/Shop/123", name: "Not requested" },
  localization: { country: { currency: { isoCode: "USD" } }, language: { isoCode: "EN" } },
} };

function fixture(respond = () => metadata) {
  const code = ts.transpileModule(readFileSync(new URL("../src/lib/analytics/config.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls = [], caches = [], values = new Map();
  const dependencies = {
    "server-only": {},
    "next/cache": { unstable_cache: (callback, keys, options) => {
      caches.push({ keys, options });
      return async () => {
        const key = JSON.stringify(keys);
        if (values.has(key)) return values.get(key);
        const value = await callback();
        values.set(key, value);
        return value;
      };
    } },
    "@shopify/storefront-api-client": { createStorefrontApiClient: (options) => ({
      request: async (query) => { calls.push({ options, query }); return respond(); },
    }) },
  };
  const output = { exports: {} };
  new Function("require", "module", "exports", "process", code)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, output, output.exports, { env: environment });
  return { config: output.exports.publicStorefrontAnalyticsConfig, calls, caches };
}

test("public analytics configuration is explicitly enabled and rejects untrusted credentials before requesting or caching", async () => {
  const { config, calls, caches } = fixture();
  for (const changes of [
    { STOREFRONT_ANALYTICS_ENABLED: undefined, META_TRACKING_ENABLED: "true" },
    { STOREFRONT_ANALYTICS_ENABLED: "false" }, { STOREFRONT_ANALYTICS_ENABLED: "TRUE" },
    { SHOPIFY_STORE_DOMAIN: undefined }, { SHOPIFY_STORE_DOMAIN: "attacker.example" },
    { SHOPIFY_STORE_DOMAIN: "fixture.myshopify.com@attacker.example" },
    { SHOPIFY_STORE_DOMAIN: "fixture.myshopify.com:443" },
    { SHOPIFY_STORE_DOMAIN: "fixture.myshopify.com/private" },
    { SHOPIFY_STOREFRONT_ACCESS_TOKEN: undefined }, { SHOPIFY_STOREFRONT_ACCESS_TOKEN: "shpat_private" },
    { SHOPIFY_API_VERSION: "unstable" }, { SHOPIFY_API_VERSION: "2026-13" },
  ]) assert.equal(await config({ ...environment, ...changes }), null);
  assert.equal(calls.length, 0);
  assert.equal(caches.length, 0);
});

test("configuration exposes only queried public metadata and caches it for one hour independently of Meta", async () => {
  const { config, calls, caches } = fixture();
  const result = await config();
  assert.deepEqual(result, { shopId: "gid://shopify/Shop/123", currency: "USD", acceptedLanguage: "EN" });
  assert.equal(await config({ ...environment, META_TRACKING_ENABLED: "false" }), result);
  assert.equal(calls.length, 1);
  assert.match(calls[0].query, /shop\s*\{\s*id\s*\}/);
  assert.match(calls[0].query, /localization\s*\{\s*country\s*\{\s*currency\s*\{\s*isoCode\s*\}\s*\}\s*language\s*\{\s*isoCode\s*\}\s*\}/);
  assert.doesNotMatch(calls[0].query, /customer|email|name|mutation/i);
  assert.equal(calls[0].options.storeDomain, "fixture.myshopify.com");
  assert.equal(calls[0].options.publicAccessToken, environment.SHOPIFY_STOREFRONT_ACCESS_TOKEN);
  assert.equal(calls[0].options.apiVersion, "2026-07");
  assert.equal(calls[0].options.retries, 0);
  assert.equal(calls[0].options.privateAccessToken, undefined);
  assert.deepEqual(caches[0], { keys: ["storefront-analytics-shop-v1", "fixture.myshopify.com", "2026-07"], options: { revalidate: 3600 } });
  assert.doesNotMatch(JSON.stringify({ result, caches }), /aaaaaaaa|myshopify.*token|Not requested/);
});

test("cache scope uses normalized shop and supported API version, never credentials or visitor data", async () => {
  const { config, calls } = fixture();
  await config({ ...environment, SHOPIFY_STORE_DOMAIN: " https://FIXTURE.myshopify.com/ " });
  await config(environment);
  assert.equal(calls.length, 1);
  await config({ ...environment, SHOPIFY_STORE_DOMAIN: "another.myshopify.com" });
  await config({ ...environment, SHOPIFY_API_VERSION: "2026-10" });
  await config({ ...environment, SHOPIFY_API_VERSION: "2024-10" });
  assert.deepEqual(calls.map(({ options }) => [options.storeDomain, options.apiVersion]), [
    ["fixture.myshopify.com", "2026-07"], ["another.myshopify.com", "2026-07"],
    ["fixture.myshopify.com", "2026-10"], ["fixture.myshopify.com", "2025-10"],
  ]);
});

test("invalid or failed shop metadata fails closed without caching the failure or blocking later recovery", async () => {
  for (const invalid of [
    {}, { errors: { message: "Unavailable" }, ...metadata },
    { data: { ...metadata.data, shop: { id: "123" } } },
    { data: { ...metadata.data, shop: { id: "gid://shopify/Customer/123" } } },
    { data: { ...metadata.data, localization: { country: { currency: { isoCode: "usd" } }, language: { isoCode: "EN" } } } },
    { data: { ...metadata.data, localization: { country: { currency: { isoCode: "USD" } }, language: { isoCode: "private?value" } } } },
    new Error("Offline"),
  ]) {
    let response = invalid;
    const { config, calls } = fixture(() => { if (response instanceof Error) throw response; return response; });
    assert.equal(await config(environment), null);
    response = metadata;
    assert.deepEqual(await config(environment), { shopId: "gid://shopify/Shop/123", currency: "USD", acceptedLanguage: "EN" });
    assert.equal(calls.length, 2);
  }
});

test("metadata transport has a bounded timeout, forbids credential redirects, and caches no raw response", async () => {
  const { config, calls } = fixture();
  await config(environment);
  const originalFetch = globalThis.fetch;
  let received;
  globalThis.fetch = async (url, options) => { received = { url, options }; return new Response("{}"); };
  try {
    await calls[0].options.customFetchApi("https://fixture.myshopify.com/api/2026-07/graphql.json", { method: "POST" });
    assert.equal(received.options.method, "POST");
    assert.equal(received.options.redirect, "error");
    assert.equal(received.options.cache, "no-store");
    assert.ok(received.options.signal instanceof AbortSignal);
    assert.equal(received.options.signal.aborted, false);
  } finally { globalThis.fetch = originalFetch; }
});
