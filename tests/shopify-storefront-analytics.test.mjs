import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as sdk from "@shopify/hydrogen-react";

function load(dependency) {
  const code = ts.transpileModule(readFileSync(new URL("../src/lib/analytics/shopify.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.equal(name, "@shopify/hydrogen-react");
    return dependency;
  }, output, output.exports);
  return output.exports;
}

const config = { shopId: "gid://shopify/Shop/12345", currency: "USD", acceptedLanguage: "EN" };
const item = { product_id: "gid://shopify/Product/123", variant_id: "gid://shopify/ProductVariant/456",
  product_handle: "ruined-hoodie", quantity: 2, value: 192, currency: "USD", product_name: "Ruined Hoodie", variant_name: "Black / M" };

function fixture({ realSender = false } = {}) {
  let consent = "yes", permission = true, tokens = { uniqueToken: "unique-test-token", visitToken: "visit-test-token" };
  const events = [];
  const privacy = {
    consentStatus: "loaded", config: { asyncConsent: true },
    currentVisitorConsent: () => ({ analytics: consent, marketing: "no", sale_of_data: "no" }),
    analyticsProcessingAllowed: () => true, marketingAllowed: () => false, saleOfDataAllowed: () => false,
    __internal: { uniqueToken: () => tokens.uniqueToken, visitToken: () => tokens.visitToken },
  };
  globalThis.window = {
    location: new URL("https://theruinedproject.com/store/ruined-hoodie?email=private@example.test&token=secret#private-note"),
    navigator: { userAgent: "Browser test" }, Shopify: { customerPrivacy: privacy },
  };
  globalThis.document = { cookie: "", referrer: "https://search.example.test/results?q=private+query#private-fragment", title: "Private user input" };
  const bridge = load(realSender ? sdk : { ...sdk, getTrackingValues: () => tokens,
    sendShopifyAnalytics: (event, domain) => { events.push({ event, domain }); return Promise.resolve(); } });
  bridge.configureShopifyAnalytics(config, () => permission);
  return { bridge, events, privacy,
    setConsent: value => { consent = value; }, setPermission: value => { permission = value; },
    setTokens: value => { tokens = value; },
  };
}

test("Shopify measures a consented page once and adds product detail without duplicating the page", () => {
  const { bridge, events } = fixture();
  bridge.trackShopifyPageView(); bridge.trackShopifyPageView();
  bridge.trackShopifyProductView(item); bridge.trackShopifyProductView({ ...item, variant_id: "789" });
  assert.deepEqual(events.map(({ event }) => event.eventName), [sdk.AnalyticsEventName.PAGE_VIEW_2, sdk.AnalyticsEventName.PRODUCT_VIEW]);
  const payload = events[0].event.payload;
  assert.equal(payload.url, "https://theruinedproject.com/store/ruined-hoodie");
  assert.equal(payload.canonicalUrl, payload.url); assert.equal(payload.search, "");
  assert.equal(payload.title, "Product — Ruined"); assert.equal(payload.referrer, "https://search.example.test/");
  assert.equal(payload.shopifySalesChannel, "headless"); assert.equal(payload.hasUserConsent, true);
  assert.equal(payload.marketingAllowed, false, "analytics does not require marketing opt-in");
  assert.equal(payload.saleOfDataAllowed, false);
  assert.equal(events[1].event.payload.products[0].price, "96");
  assert.equal(JSON.stringify(events).includes("private"), false);
  assert.ok(events.every(entry => entry.domain === "checkout.theruinedproject.com"));
  window.location = new URL("https://theruinedproject.com/bag");
  bridge.trackShopifyPageView();
  window.location = new URL("https://theruinedproject.com/store/ruined-hoodie");
  bridge.trackShopifyProductView(item);
  assert.deepEqual(events.map(({ event }) => event.eventName), ["PAGE_VIEW_2", "PRODUCT_VIEW", "PAGE_VIEW_2", "PAGE_VIEW_2", "PRODUCT_VIEW"]);
});

test("pending, denied, failed, unavailable and GPC states neither emit nor expose tracking headers", () => {
  const b = fixture();
  const attempt = () => {
    b.bridge.trackShopifyPageView(); b.bridge.trackShopifyProductView(item);
    b.bridge.trackShopifyAddToCart("gid://shopify/Cart/cart-test", item);
    assert.deepEqual(b.bridge.shopifyAnalyticsTrackingHeaders(), {});
  };
  b.setPermission(false); attempt(); b.setPermission(true);
  b.privacy.consentStatus = "loading"; attempt(); b.privacy.consentStatus = "loaded";
  b.setConsent(""); attempt(); b.setConsent("no"); attempt(); b.setConsent("yes");
  window.navigator.globalPrivacyControl = true; attempt(); window.navigator.globalPrivacyControl = false;
  b.privacy.analyticsProcessingAllowed = () => false; attempt();
  b.privacy.analyticsProcessingAllowed = () => { throw new Error("SDK unavailable"); }; attempt();
  b.privacy.analyticsProcessingAllowed = () => true;
  for (const tokens of [{ uniqueToken: "", visitToken: "" }, { uniqueToken: "token", visitToken: "" }, { uniqueToken: "bad\r\nheader", visitToken: "token" }]) { b.setTokens(tokens); attempt(); }
  assert.equal(b.events.length, 0);
  b.setTokens({ uniqueToken: "new-unique", visitToken: "new-visit" });
  b.bridge.trackShopifyPageView();
  assert.equal(b.events.length, 1, "only the current permitted page is sent; declined cart activity is not replayed");
  assert.deepEqual(b.bridge.shopifyAnalyticsTrackingHeaders(), { "X-Shopify-UniqueToken": "new-unique", "X-Shopify-VisitToken": "new-visit" });
});

test("effect cleanup and setup preserve deduplication while disabling sends during cleanup", () => {
  const { bridge, events } = fixture();
  bridge.trackShopifyProductView(item);
  bridge.configureShopifyAnalytics(null);
  bridge.trackShopifyPageView(); bridge.trackShopifyProductView(item);
  bridge.trackShopifyAddToCart("gid://shopify/Cart/cart-test", item);
  assert.deepEqual(bridge.shopifyAnalyticsTrackingHeaders(), {});
  bridge.configureShopifyAnalytics({ acceptedLanguage: "EN", currency: "USD", shopId: config.shopId }, () => true);
  bridge.trackShopifyPageView(); bridge.trackShopifyProductView(item);
  assert.deepEqual(events.map(({ event }) => event.eventName), ["PAGE_VIEW_2", "PRODUCT_VIEW"]);
  bridge.configureShopifyAnalytics({ ...config, shopId: "gid://shopify/Shop/999" }, () => true);
  bridge.trackShopifyProductView(item);
  assert.deepEqual(events.map(({ event }) => event.eventName), ["PAGE_VIEW_2", "PRODUCT_VIEW", "PAGE_VIEW_2", "PRODUCT_VIEW"]);
  assert.equal(events[2].event.payload.shopId, "gid://shopify/Shop/999");
});

test("homepage product views require an explicit quick-buy interaction and count once per displayed product", () => {
  const { bridge, events } = fixture();
  window.location = new URL("https://theruinedproject.com/");
  bridge.trackShopifyPageView();
  bridge.trackShopifyProductView(item);
  bridge.trackShopifyProductView({ ...item, source: "product_page" });
  assert.deepEqual(events.map(({ event }) => event.eventName), ["PAGE_VIEW_2"]);
  bridge.trackShopifyProductView({ ...item, source: "quick_buy" });
  bridge.trackShopifyProductView({ ...item, source: "quick_buy", variant_id: "789" });
  assert.deepEqual(events.map(({ event }) => event.eventName), ["PAGE_VIEW_2", "PRODUCT_VIEW"]);
  assert.equal(events[1].event.payload.url, "https://theruinedproject.com/");
  assert.equal(events[1].event.payload.resourceId, item.product_id);
  window.location = new URL("https://theruinedproject.com/store");
  bridge.trackShopifyProductView({ ...item, source: "quick_buy" });
  assert.equal(events.length, 2, "inline quick-buy cannot create impressions on unrelated paths");
});

test("private routes, membership hosts and previews never emit Shopify analytics", () => {
  const { bridge, events } = fixture();
  for (const href of ["https://theruinedproject.com/my", "https://theruinedproject.com/profile/libby", "https://theruinedproject.com/card/capability",
    "https://theruinedproject.com/invitation/private", "https://members.theruinedproject.com/store/ruined-hoodie",
    "https://preview.vercel.app/store/ruined-hoodie", "http://theruinedproject.com/store/ruined-hoodie"]) {
    window.location = new URL(href);
    bridge.trackShopifyPageView(); bridge.trackShopifyProductView(item); bridge.trackShopifyAddToCart("gid://shopify/Cart/cart-test", item);
    assert.deepEqual(bridge.shopifyAnalyticsTrackingHeaders(), {});
  }
  assert.equal(events.length, 0);
  window.location = new URL("https://theruinedproject.com/store/ruined-hoodie");
  document.referrer = "https://members.theruinedproject.com/my/journal?token=private";
  bridge.trackShopifyPageView(); assert.equal(events[0].event.payload.referrer, "");
});

test("confirmed additions use real keyless cart IDs, canonical product IDs and truthful quantities", () => {
  const { bridge, events } = fixture();
  bridge.trackShopifyAddToCart("gid://shopify/Cart/cart-test?key=PRIVATE_CAPABILITY", { ...item, product_id: "123", variant_id: "456" });
  assert.equal(events.length, 1);
  const { event } = events[0];
  assert.equal(event.eventName, "ADD_TO_CART"); assert.equal(event.payload.cartId, "gid://shopify/Cart/cart-test");
  assert.equal(event.payload.totalValue, 192); assert.equal(event.payload.products[0].quantity, 2);
  assert.equal(event.payload.products[0].productGid, "gid://shopify/Product/123");
  assert.equal(event.payload.products[0].variantGid, "gid://shopify/ProductVariant/456");
  assert.equal(JSON.stringify(event).includes("PRIVATE_CAPABILITY"), false);
  for (const cart of ["", "local-cart", "gid://shopify/Order/cart-test", "gid://shopify/Cart/cart-test#private"]) bridge.trackShopifyAddToCart(cart, item);
  for (const change of [{ product_id: "local:hoodie" }, { variant_id: "bad" }, { quantity: 0 }, { quantity: 21 }, { quantity: 1.5 }, { value: NaN }, { value: -1 }, { currency: "usd" }]) {
    bridge.trackShopifyAddToCart("gid://shopify/Cart/cart-test", { ...item, ...change });
  }
  assert.equal(events.length, 1);
});

test("published SDK receives the same session tokens and never emits checkout or purchase events", async () => {
  const { bridge } = fixture({ realSender: true });
  const requests = [], originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => { requests.push({ url, data: JSON.parse(options.body) }); return { ok: true, text: async () => "" }; };
  try {
    bridge.trackShopifyPageView(); bridge.trackShopifyProductView(item);
    bridge.trackShopifyAddToCart("gid://shopify/Cart/cart-test?key=PRIVATE_CAPABILITY", item);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 3);
    const emitted = requests.flatMap(request => request.data.events);
    assert.ok(emitted.some(event => event.schema_id === "trekkie_storefront_page_view/1.4"));
    assert.equal(emitted.filter(event => event.payload.event_name === "page_rendered").length, 1);
    assert.equal(emitted.filter(event => event.payload.event_name === "product_page_rendered").length, 1);
    const added = emitted.find(event => event.payload.event_name === "product_added_to_cart");
    assert.equal(added.payload.cart_token, "cart-test");
    for (const event of emitted) {
      assert.equal(event.payload.unique_token ?? event.payload.uniqToken, "unique-test-token");
      assert.equal(event.payload.deprecated_visit_token ?? event.payload.visitToken, "visit-test-token");
    }
    const body = JSON.stringify(requests);
    assert.doesNotMatch(body, /PRIVATE_CAPABILITY|private@example|Private user|checkout_started|checkout_completed|Purchase|InitiateCheckout/);
  } finally { globalThis.fetch = originalFetch; }
});

test("invalid configuration and SDK failures cannot break shopping", () => {
  const { bridge, events } = fixture();
  bridge.configureShopifyAnalytics({ ...config, shopId: "not-a-shop" }, () => true);
  bridge.trackShopifyPageView(); assert.equal(events.length, 0);
  const throwing = load({ ...sdk, getTrackingValues: () => { throw new Error("Not ready"); } });
  throwing.configureShopifyAnalytics(config, () => true);
  assert.doesNotThrow(() => throwing.trackShopifyAddToCart("gid://shopify/Cart/cart-test", item));
  const rejecting = load({ ...sdk, getTrackingValues: () => ({ uniqueToken: "unique", visitToken: "visit" }), sendShopifyAnalytics: () => Promise.reject(new Error("Unavailable")) });
  rejecting.configureShopifyAnalytics(config, () => true);
  assert.doesNotThrow(() => rejecting.trackShopifyPageView());
});
