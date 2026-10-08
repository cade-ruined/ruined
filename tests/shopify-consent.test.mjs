import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as graphql from "graphql";

function load(path, dependencies = {}, environment = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", "process", code)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, output, output.exports, { env: environment });
  return output.exports;
}
const { consentQuery, proxyShopifyConsent } = load("src/lib/marketing/shopify-consent-proxy.ts", { "server-only": {}, graphql });
const consent = load("src/lib/marketing/consent.ts");
const environment = { META_TRACKING_ENABLED: "true", SHOPIFY_STORE_DOMAIN: "fixture.myshopify.com", SHOPIFY_STOREFRONT_ACCESS_TOKEN: "a".repeat(32) };
const query = 'query { consentManagement { cookies(visitorConsent:{marketing:false,analytics:false}, landingPage:"https://theruinedproject.com/store?utm_source=facebook",origReferrer:"https://www.instagram.com/") { trackingConsentCookie cookieDomain landingPageCookie origReferrerCookie shopifyUnique shopifyVisit } customerAccountUrl } }';
function request(body = { query, variables: {} }, headers = {}) {
  return new Request("https://theruinedproject.com/api/unstable/graphql.json", {
    method: "POST", headers: { origin: "https://theruinedproject.com", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body),
  });
}

test("proxy accepts both SDK consent query shapes and rejects arbitrary GraphQL structure", () => {
  assert.ok(consentQuery({ query, variables: {} }));
  assert.ok(consentQuery({ query: "query { consentManagement { cookies(visitorConsent:{}) { cookieDomain } } }" }));
  for (const invalid of [
    query.replace("query", "mutation"), query + " query { shop { name } }",
    query.replace("consentManagement", "alias:consentManagement"), query.replace("customerAccountUrl", "customerAccountUrl shop { name }"),
    query.replace("cookieDomain", "cookieDomain @skip(if:false)"), query.replace("cookieDomain", "...Fields") + " fragment Fields on ConsentCookies { cookieDomain }",
    query.replace("marketing:false", "marketing:$accept"), query.replace("marketing:false", "marketing:true,marketing:false"),
    query.replace("marketing:false", "visitorEmail:\"test@example.com\""), query.replace("trackingConsentCookie", "trackingConsentCookie nested"),
  ]) assert.equal(consentQuery({ query: invalid, variables: {} }), null, invalid);
  assert.equal(consentQuery({ query, variables: { accept: true } }), null);
  assert.equal(consentQuery({ query, upstream: "https://attacker.example" }), null);
});

test("consent proxy filters credentials/cookies, fixes upstream, and preserves separate opaque Shopify Set-Cookie values", async () => {
  const allowed = ["_shopify_essential=opaque; Path=/; HttpOnly; Secure; SameSite=Lax", "_shopify_analytics=; Max-Age=0; Domain=.theruinedproject.com; Path=/", "_tracking_consent=old; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/"];
  let received;
  const result = await proxyShopifyConsent(request(undefined, {
    cookie: "session=secret; _shopify_essential=opaque; sb-auth=private; _shopify_y=legacy; _shopify_marketing=advertising",
    authorization: "Bearer private", "x-shopify-storefront-access-token": "attacker", "x-shopify-uniquetoken": "unique", "x-shopify-visittoken": "visit", "shopify-storefront-consent-management": "1",
    referer: "https://theruinedproject.com/auth/callback?code=secret",
  }), environment, async (url, options) => {
    received = { url, options };
    const headers = new Headers({ "content-type": "application/json", "server-timing": "private", "access-control-allow-origin": "*" });
    [...allowed, "session=do-not-copy; Path=/"].forEach((cookie) => headers.append("Set-Cookie", cookie));
    return new Response('{"data":{"consentManagement":{}}}', { headers });
  });
  assert.equal(result.status, 200);
  assert.equal(received.url, "https://fixture.myshopify.com/api/unstable/graphql.json");
  assert.equal(received.options.headers.get("cookie"), "_shopify_essential=opaque; _shopify_y=legacy; _shopify_marketing=advertising");
  assert.equal(received.options.headers.get("authorization"), null);
  assert.equal(received.options.headers.get("referer"), "https://theruinedproject.com/");
  assert.equal(received.options.headers.get("x-shopify-storefront-access-token"), environment.SHOPIFY_STOREFRONT_ACCESS_TOKEN);
  assert.equal(received.options.headers.get("x-shopify-uniquetoken"), "unique");
  assert.equal(received.options.headers.get("x-shopify-visittoken"), "visit");
  assert.equal(received.options.headers.get("shopify-storefront-consent-management"), "1");
  assert.equal(received.options.redirect, "error");
  assert.equal(received.options.cache, "no-store");
  assert.deepEqual(result.headers.getSetCookie(), allowed);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(result.headers.get("server-timing"), null);
  assert.equal(result.headers.get("access-control-allow-origin"), null);
});

test("Shopify consent metadata strips queries, hashes and private page paths", () => {
  const sanitized = consentQuery({ query: query.replace("https://theruinedproject.com/store?utm_source=facebook", "https://theruinedproject.com/my?token=private#fragment").replace("https://www.instagram.com/", "https://members.theruinedproject.com/auth?code=secret") });
  assert.doesNotMatch(sanitized, /private|secret|token=|auth|fragment/);
  assert.match(sanitized, /landingPage: "https:\/\/theruinedproject.com\/"/);
  assert.match(sanitized, /origReferrer: "https:\/\/members.theruinedproject.com\/"/);
  assert.match(consentQuery({ query }), /landingPage: "https:\/\/theruinedproject.com\/store"/);
  assert.doesNotMatch(consentQuery({ query }), /utm_source/);
  assert.match(consentQuery({ query: query.replace("https://theruinedproject.com/store?utm_source=facebook", "/store/ruined-hoodie?variant=123&utm_source=facebook") }), /landingPage: "\/store\/ruined-hoodie"/);
  assert.match(consentQuery({ query: query.replace("https://theruinedproject.com/store?utm_source=facebook", "/my?token=secret") }), /landingPage: "\/"/);
});

test("Storefront API version floors legacy configuration at supported consent version and preserves newer versions", () => {
  for (const [configured, expected] of [["2024-10", "2025-10"], ["2025-10", "2025-10"], ["2026-07", "2026-07"], ["2026-10", "2026-10"], [undefined, "2026-07"]]) {
    let received;
    load("src/lib/shopify.ts", {
      "server-only": {}, "@shopify/storefront-api-client": { createStorefrontApiClient: (options) => { received = options; return {}; } },
      "@/data/products": {}, "@/lib/store/product-copy.js": {}, "@/lib/store/catalog-loader": {},
    }, { ...environment, SHOPIFY_API_VERSION: configured });
    assert.equal(received.apiVersion, expected);
  }
});

test("proxy rejects cross-origin, sibling-origin, missing Origin, oversized bodies and untrusted configuration before upstream", async () => {
  const never = () => assert.fail("Invalid requests must not reach Shopify");
  for (const headers of [{ origin: "https://attacker.example" }, { origin: "https://members.theruinedproject.com" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }]) {
    assert.equal((await proxyShopifyConsent(request(undefined, headers), environment, never)).status, 403);
  }
  const missing = request(); missing.headers.delete("origin");
  assert.equal((await proxyShopifyConsent(missing, environment, never)).status, 403);
  assert.equal((await proxyShopifyConsent(request(undefined, { "content-type": "text/plain" }), environment, never)).status, 415);
  assert.equal((await proxyShopifyConsent(request({ query: "x".repeat(9000) }), environment, never)).status, 400);
  assert.equal((await proxyShopifyConsent(request({ query: "query { shop { name } }" }), environment, never)).status, 400);
  for (const domain of ["attacker.example", "fixture.myshopify.com@attacker.example", "fixture.myshopify.com:443", "fixture.myshopify.com/path"]) {
    assert.equal((await proxyShopifyConsent(request(), { ...environment, SHOPIFY_STORE_DOMAIN: domain }, never)).status, 503);
  }
  assert.equal((await proxyShopifyConsent(request(), { ...environment, SHOPIFY_STOREFRONT_ACCESS_TOKEN: "shpat_private" }, never)).status, 503);
});

test("proxy forwards read/token fallback without requiring a marker and fails closed on upstream errors", async () => {
  const result = await proxyShopifyConsent(request({ query: "query { consentManagement { cookies(visitorConsent:{}) { cookieDomain } } }" }), environment, async (_url, options) => {
    assert.equal(options.headers.get("shopify-storefront-consent-management"), null);
    return new Response('{"data":{}}');
  });
  assert.equal(result.status, 200);
  assert.equal((await proxyShopifyConsent(request(), environment, async () => { throw new Error("Offline"); })).status, 502);
});

test("checkout validates booleans and passes actual choices to Shopify without changing signed consent in its URL", async () => {
  const calls = [];
  const api = load("src/lib/shopify.ts", {
    "server-only": {}, "@shopify/storefront-api-client": { createStorefrontApiClient: () => ({ request: async (document, options) => {
      calls.push({ document, options });
      return { data: { cartCreate: { cart: { checkoutUrl: "https://fixture.myshopify.com/checkouts/cn/id?_cs=shopify%2Bsigned%3D&key=key" }, userErrors: [], warnings: [] } } };
    } }) },
    "@/data/products": {}, "@/lib/store/product-copy.js": {}, "@/lib/store/catalog-loader": {},
  }, { ...environment, SHOPIFY_CHECKOUT_DOMAIN: "checkout.theruinedproject.com" });
  const choice = { marketing: false, analytics: true, saleOfData: false };
  const checkoutUrl = await api.createCheckoutUrl([{ variantId: "gid://shopify/ProductVariant/52219441938753", quantity: 1 }], 1, choice);
  assert.match(calls[0].document, /\$visitorConsent: VisitorConsent/);
  assert.match(calls[0].document, /@inContext\(visitorConsent: \$visitorConsent\)/);
  assert.deepEqual(calls[0].options.variables.visitorConsent, choice);
  assert.equal(new URL(checkoutUrl).searchParams.get("_cs"), "shopify+signed=");
  assert.equal(new URL(checkoutUrl).hostname, "checkout.theruinedproject.com");
  await api.createCheckoutUrl("gid://shopify/ProductVariant/52219441938753");
  assert.equal(Object.hasOwn(calls[1].options.variables, "visitorConsent"), false);
  for (const invalid of [null, [], { marketing: "yes" }, { analytics: 1 }, { email: "person@example.com" }, { consent: true }]) assert.equal(consent.validVisitorConsent(invalid), false);
  assert.equal(consent.validVisitorConsent(choice), true);
  assert.equal(consent.validVisitorConsent(undefined), true);
});

test("checkout endpoint rejects malformed consent and forwards valid consent with trusted catalogue lines", async () => {
  const calls = [];
  const route = load("app/api/store/checkout/route.ts", {
    "next/server": { NextResponse: Response }, "@/lib/marketing/consent": consent,
    "@/lib/shopify": { getProducts: async () => [{ variants: [{ id: "gid://shopify/ProductVariant/1", available: true }] }], createCheckoutUrl: async (...arguments_) => { calls.push(arguments_); return "https://checkout.theruinedproject.com/checkouts/id?_cs=opaque"; } },
  });
  const checkout = (visitorConsent) => new Request("https://theruinedproject.com/api/store/checkout", { method: "POST", body: JSON.stringify({ lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }], visitorConsent }) });
  assert.equal((await route.POST(checkout({ marketing: "yes" }))).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await route.POST(checkout({ marketing: false, analytics: false }))).status, 200);
  assert.deepEqual(calls[0][2], { marketing: false, analytics: false });
  assert.deepEqual(calls[0][0], [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }]);
});
