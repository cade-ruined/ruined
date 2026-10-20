import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, dependencies, environment) {
  const source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(environment), source)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(environment));
  return loaded.exports;
}
const config = { shopId: "gid://shopify/Shop/123", currency: "USD" };
const product = { product_id: "gid://shopify/Product/456", variant_id: "gid://shopify/ProductVariant/789", product_handle: "byob-tank", source: "product_page", quantity: 1, value: 48, currency: "USD" };
const line = { variantId: product.variant_id, quantity: 1 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(options = {}) {
  const window = new EventTarget();
  window.location = new URL(options.url ?? "https://theruinedproject.com/store/byob-tank");
  window.navigator = { globalPrivacyControl: false };
  window.vaq = [];
  let choice = "yes", processing = true, veto = false, lines = [line], bridgePermission = () => false;
  let now = Date.now();
  window.Shopify = { customerPrivacy: { consentStatus: "loaded", currentVisitorConsent: () => ({ analytics: choice, marketing: choice }), analyticsProcessingAllowed: () => processing } };
  const document = { referrer: "" };
  const calls = { injections: [], pages: [], events: [], requests: [], productViews: [], adds: [], bridgePages: [] };
  const consent = load("src/lib/marketing/consent.ts", {}, { window });
  consent.setConsentUpdatePending(options.pending ?? false);
  const sdk = {
    inject(value) { calls.injections.push(value); window.vaq.push(["beforeSend", value.beforeSend]); },
    pageview(value) { calls.pages.push(value); window.vaq.push(["pageview", value]); },
    track(name, properties) { calls.events.push({ name, properties }); window.vaq.push(["event", { name, properties }]); },
  };
  const bridge = {
    configureShopifyAnalytics(_config, permission) { bridgePermission = permission; },
    shopifyAnalyticsTrackingHeaders: () => bridgePermission() ? { "X-Shopify-UniqueToken": "unique", "X-Shopify-VisitToken": "visit" } : {},
    trackShopifyPageView() { if (bridgePermission()) calls.bridgePages.push(window.location.pathname); },
    trackShopifyProductView(item) { if (bridgePermission()) calls.productViews.push(item); },
    trackShopifyAddToCart(cartId, item) { if (bridgePermission()) calls.adds.push({ cartId, item }); },
  };
  const analytics = load("src/lib/analytics/storefront.ts", {
    "@vercel/analytics": sdk,
    "@/components/store/bag-store": { readBag: () => lines, isShopifyVariantId: value => /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(value) },
    "@/lib/marketing/consent": consent,
    "@/lib/marketing/meta": { hasLocalMarketingVeto: () => veto, checkoutVisitorConsent: () => ({ analytics: choice === "yes", marketing: choice === "yes" }) },
    "./shopify": bridge,
  }, { window, document, Date: { now: () => now }, fetch: async (url, init) => {
    const request = { url, init, body: JSON.parse(init.body) };
    calls.requests.push(request);
    return options.fetch ? options.fetch(request, calls.requests.length) : { ok: true, json: async () => ({ cartId: "gid://shopify/Cart/cart123" }) };
  } });
  return { analytics, consent, calls, window, document,
    configure: () => analytics.configureStoreAnalytics(config),
    setChoice(value) { choice = value; }, setProcessing(value) { processing = value; }, setVeto(value) { veto = value; }, setLines(value) { lines = value; }, setNow(value) { now = value; },
  };
}

test("store analytics does not inject, queue, synchronize, or dispatch before explicit ready permission", async () => {
  for (const deny of [
    view => view.consent.setConsentUpdatePending(true),
    view => { view.window.Shopify.customerPrivacy.consentStatus = "loading"; },
    view => view.setChoice(""), view => view.setChoice("no"), view => view.setProcessing(false), view => view.setVeto(true),
    view => { view.window.navigator.globalPrivacyControl = true; },
    view => { view.window.location = new URL("https://members.theruinedproject.com/my"); },
    view => { view.window.location = new URL("https://theruinedproject.com/my/profile"); },
    view => { view.window.location = new URL("http://theruinedproject.com/store"); },
  ]) {
    const view = fixture(); deny(view); view.configure();
    assert.equal(view.analytics.storeAnalyticsAllowed(), false);
    assert.equal(view.analytics.trackStoreEvent("store_add_to_bag", product), false);
    await view.analytics.flushStoreCart();
    for (const key of Object.keys(view.calls)) assert.equal(view.calls[key].length, 0, key);
    assert.equal(view.window.vaq.length, 0);
  }
});

test("GPC disables checkout analytics even with saved Allow and without a Sec-GPC header", () => {
  const view = fixture();
  const privacy = view.window.Shopify.customerPrivacy;
  privacy.currentVisitorConsent = () => ({ analytics: "yes", marketing: "yes", sale_of_data: "yes", preferences: "yes" });
  assert.deepEqual(view.consent.visitorConsentForCheckout(privacy, false, false), {
    marketing: true, analytics: true, preferences: true, saleOfData: true,
  });
  assert.deepEqual(view.consent.visitorConsentForCheckout(privacy, false, true), {
    marketing: false, analytics: false, preferences: true, saleOfData: false,
  });
  view.consent.setConsentUpdatePending(true);
  assert.deepEqual(view.consent.visitorConsentForCheckout(privacy, false, true), {
    marketing: false, analytics: false, saleOfData: false,
  });
});

test("permission injects manual tracking once and pageviews ignore query changes and setup replay", () => {
  const view = fixture(); view.configure(); view.analytics.refreshStoreAnalytics();
  assert.equal(view.calls.injections.length, 1);
  assert.equal(view.calls.injections[0].disableAutoTrack, true);
  assert.equal(typeof view.calls.injections[0].beforeSend, "function");
  view.window.location = new URL("https://theruinedproject.com/store/byob-tank?variant=789&email=secret#private");
  view.analytics.refreshStoreAnalytics();
  view.configure();
  assert.deepEqual(view.calls.pages, [{ path: "/store/byob-tank", route: "/store/[slug]" }]);
  view.window.location = new URL("https://theruinedproject.com/bag"); view.analytics.refreshStoreAnalytics();
  view.window.location = new URL("https://theruinedproject.com/my"); view.analytics.refreshStoreAnalytics();
  view.window.location = new URL("https://theruinedproject.com/bag"); view.analytics.refreshStoreAnalytics();
  assert.deepEqual(view.calls.pages.map(page => page.path), ["/store/byob-tank", "/bag", "/bag"]);
  assert.equal(view.calls.injections.length, 1);
});

test("withdrawal removes queued events and pageviews while retaining the SDK privacy hook", () => {
  const view = fixture(); view.configure();
  view.analytics.trackStoreEvent("store_size_guide_opened", product);
  assert.ok(view.window.vaq.some(([kind]) => kind === "event"));
  view.setChoice("no"); view.analytics.refreshStoreAnalytics();
  assert.deepEqual(view.window.vaq.map(([kind]) => kind), ["beforeSend"]);
  assert.equal(view.analytics.beforeStoreAnalyticsSend({ type: "event", url: "https://theruinedproject.com/store/byob-tank" }), null);
  assert.equal(view.analytics.trackStoreEvent("store_size_guide_opened", product), false);
});

test("SDK output strips URL query/hash and rejects private, foreign, or sensitive-referrer URLs", () => {
  const view = fixture(); view.configure();
  const safe = view.analytics.beforeStoreAnalyticsSend({ type: "pageview", url: "https://theruinedproject.com/store/byob-tank?email=private%40example.test#secret" });
  assert.deepEqual(safe, { type: "pageview", url: "https://theruinedproject.com/store/byob-tank" });
  for (const url of ["https://theruinedproject.com/my/profile", "https://theruinedproject.com/ops/members", "https://members.theruinedproject.com/store", "https://unrelated.example/store", "https://theruinedproject.com/store/name%40example.test"]) {
    assert.equal(view.analytics.beforeStoreAnalyticsSend({ type: "event", url }), null, url);
  }
  for (const referrer of ["https://theruinedproject.com/my", "https://members.theruinedproject.com/my", "https://example.test/?email=private", "https://example.test/#secret"]) {
    view.document.referrer = referrer;
    assert.equal(view.analytics.beforeStoreAnalyticsSend({ type: "event", url: "https://theruinedproject.com/store" }), null, referrer);
  }
});

test("custom events use the explicit two-property allowlist including authored fit names", () => {
  const view = fixture(); view.configure();
  assert.equal(view.analytics.trackStoreEvent("unknown_event", { secret: "private" }), false);
  view.analytics.trackStoreEvent("store_add_to_bag", { ...product, email: "private@example.test", token: "secret" });
  view.analytics.trackStoreEvent("store_variant_selected", { ...product, option_name: "Fit", option_value: "Women's" });
  view.analytics.trackStoreEvent("store_checkout_failed", { source: "bag", quantity: 2, value: 96, error_category: "network", error: "private@example.test" });
  view.analytics.trackStoreEvent("store_scroll_depth", { percent: 75, email: "private@example.test" });
  assert.deepEqual(view.calls.events.map(({ properties }) => properties), [
    { product: "byob-tank", source: "product_page" },
    { product: "byob-tank", option: "Fit: Women's" },
    { quantity: 2, reason: "network" },
    { percent: 75 },
  ]);
  for (const event of view.calls.events) assert.ok(Object.keys(event.properties).length <= 2);
  assert.doesNotMatch(JSON.stringify(view.calls.events), /private@example|secret|variant_id|product_id/);
});

test("product-open events dispatch the commerce bridge only while tracking is allowed", () => {
  const view = fixture(); view.configure();
  view.analytics.trackStoreEvent("store_product_opened", product);
  assert.deepEqual(view.calls.productViews, [product]);
  view.setVeto(true);
  assert.equal(view.analytics.trackStoreEvent("store_product_opened", product), false);
  assert.equal(view.calls.productViews.length, 1);
});

test("cart requests serialize immutable snapshots and additions wait for Shopify confirmation", async () => {
  const first = deferred();
  const view = fixture({ fetch: (_request, index) => index === 1 ? first.promise : { ok: true, json: async () => ({ cartId: "gid://shopify/Cart/cart123" }) } });
  view.configure();
  const startingLines = [{ ...line }, { variantId: "local:private-name", quantity: 1 }];
  view.setLines(startingLines);
  view.analytics.trackStoreEvent("store_add_to_bag", product);
  startingLines[0].quantity = 19;
  view.setLines([{ ...line, quantity: 2 }]);
  view.analytics.trackStoreEvent("store_bag_quantity_changed", { ...product, quantity: 2, value: 96 });
  await tick();
  assert.equal(view.calls.requests.length, 1);
  assert.deepEqual(view.calls.requests[0].body.lines, [line]);
  assert.equal(view.calls.requests[0].init.credentials, "same-origin");
  assert.equal(view.calls.requests[0].init.headers["X-Shopify-UniqueToken"], "unique");
  assert.equal(view.calls.adds.length, 0);
  first.resolve({ ok: true, json: async () => ({ cartId: "gid://shopify/Cart/cart123" }) });
  await view.analytics.flushStoreCart();
  assert.equal(view.calls.requests.length, 2);
  assert.deepEqual(view.calls.requests[1].body.lines, [{ ...line, quantity: 2 }]);
  assert.deepEqual(view.calls.adds, [{ cartId: "gid://shopify/Cart/cart123", item: product }]);
});

test("checkout flush drains a new cart snapshot appended while an earlier one is pending", async () => {
  const first = deferred(), second = deferred();
  const view = fixture({ fetch: (_request, index) => index === 1 ? first.promise : second.promise });
  view.configure(); view.analytics.trackStoreEvent("store_add_to_bag", product);
  let finished = false;
  const flush = view.analytics.flushStoreCart().then(() => { finished = true; });
  await tick();
  view.setLines([{ ...line, quantity: 2 }]);
  view.analytics.trackStoreEvent("store_bag_quantity_changed", { ...product, quantity: 2 });
  first.resolve({ ok: true, json: async () => ({ cartId: "gid://shopify/Cart/cart123" }) });
  await tick();
  assert.equal(view.calls.requests.length, 2);
  assert.equal(finished, false, "checkout cannot race a newer cookie/cart response");
  second.resolve({ ok: true, json: async () => ({ cartId: "gid://shopify/Cart/cart123" }) });
  await flush; assert.equal(finished, true);
});

test("cart failures report fixed reasons without raw errors and do not poison later shopping or checkout", async () => {
  for (const [failure, reason] of [
    [() => { throw new Error("private@example.test ?key=secret"); }, "network"],
    [() => { throw new DOMException("private@example.test", "TimeoutError"); }, "network"],
    [() => ({ ok: false, status: 400, json: async () => ({ error: "private@example.test" }) }), "invalid_bag"],
    [() => ({ ok: false, status: 503 }), "unavailable"],
    [() => ({ ok: true, json: async () => { throw new Error("private@example.test"); } }), "unavailable"],
    [() => ({ ok: true, json: async () => null }), "unavailable"],
    [() => ({ ok: true, json: async () => ({ cartId: "gid://shopify/Cart/cart123?key=secret" }) }), "unavailable"],
  ]) {
    const view = fixture({ fetch: (_request, index) => index === 1 ? failure() : { ok: true, json: async () => ({ cartId: "gid://shopify/Cart/cart123" }) } });
    view.configure(); view.analytics.trackStoreEvent("store_add_to_bag", product);
    await view.analytics.flushStoreCart(); assert.equal(view.calls.adds.length, 0);
    assert.deepEqual(view.calls.events.filter(event => event.name === "store_cart_sync_failed"), [
      { name: "store_cart_sync_failed", properties: { reason } },
    ]);
    assert.doesNotMatch(JSON.stringify(view.calls.events), /private@example|secret|key=/);
    assert.equal(view.calls.events.some(event => event.name === "store_checkout_failed"), false);
    view.analytics.trackStoreEvent("store_add_to_bag", product);
    await view.analytics.flushStoreCart(); assert.equal(view.calls.adds.length, 1);
    assert.equal(view.calls.events.filter(event => event.name === "store_cart_sync_failed").length, 1);
  }
});

test("aborted, denied and stale cart requests never report a background sync failure", async () => {
  for (const mode of ["abort", "deny", "pending", "stale", "private_route"]) {
    const pending = deferred();
    const view = fixture({ fetch: () => pending.promise });
    view.configure(); view.analytics.trackStoreEvent("store_add_to_bag", product);
    await tick(); assert.equal(view.calls.requests.length, 1);
    if (mode === "deny") view.setChoice("no");
    if (mode === "pending") view.consent.setConsentUpdatePending(true);
    if (mode === "private_route") view.window.location = new URL("https://theruinedproject.com/my/profile");
    if (mode === "stale") {
      view.setChoice("no"); view.analytics.refreshStoreAnalytics();
      view.setChoice("yes"); view.analytics.refreshStoreAnalytics();
    }
    if (mode === "abort") pending.reject(new DOMException("The request was cancelled", "AbortError"));
    else pending.resolve({ ok: false, status: 503 });
    await view.analytics.flushStoreCart();
    assert.equal(view.calls.adds.length, 0, mode);
    assert.equal(view.calls.events.some(event => event.name === "store_cart_sync_failed"), false, mode);
  }
});

test("withdrawal invalidates queued snapshots and suppresses an already pending addition", async () => {
  const pending = deferred();
  const view = fixture({ fetch: () => pending.promise });
  view.configure(); view.analytics.trackStoreEvent("store_add_to_bag", product);
  view.setLines([{ ...line, quantity: 2 }]);
  view.analytics.trackStoreEvent("store_bag_quantity_changed", { ...product, quantity: 2 });
  await tick(); assert.equal(view.calls.requests.length, 1);
  view.setChoice("no"); view.analytics.refreshStoreAnalytics();
  assert.equal(view.calls.requests[0].init.signal.aborted, true, "withdrawal aborts the response that could overwrite newer consent cookies");
  pending.resolve({ ok: true, json: async () => ({ cartId: "gid://shopify/Cart/cart123" }) });
  await view.analytics.flushStoreCart();
  assert.equal(view.calls.requests.length, 1);
  assert.equal(view.calls.adds.length, 0);
  view.setChoice("yes"); view.analytics.refreshStoreAnalytics(); await view.analytics.flushStoreCart();
  assert.equal(view.calls.requests.length, 1, "old cart events cannot replay after permission returns");
});


test("the analytics component keeps one queued pageview through StrictMode effect cleanup and setup", () => {
  const view = fixture(), effects = [];
  const Component = load("src/components/StorefrontAnalytics.tsx", {
    react: { useEffect: callback => effects.push(callback) },
    "next/navigation": { usePathname: () => view.window.location.pathname },
    "@/lib/marketing/consent": view.consent,
    "@/lib/analytics/storefront": view.analytics,
  }, { window: view.window, document: view.document }).default;
  Component({ config });
  const cleanups = effects.splice(0).map(callback => callback());
  cleanups.forEach(cleanup => cleanup?.());
  Component({ config });
  const finalCleanups = effects.splice(0).map(callback => callback());
  assert.equal(view.calls.pages.length, 1);
  assert.equal(view.window.vaq.filter(([kind]) => kind === "pageview").length, 1, "SDK loading after StrictMode replay still receives the pageview");
  finalCleanups.forEach(cleanup => cleanup?.());
});


const allSelection = "category=all|collection=all|fit=all";
const hoodieSelection = "category=hoodies|collection=sunday-clothes|fit=unisex";
const tankSelection = "category=tees-tanks|collection=byob|fit=womens";
function registerCatalog(view) {
  view.analytics.configureCatalogAnalytics([{ handle: "sunday-clothes" }, { handle: "byob" }, { handle: "frontpage" }]);
}
function stages(view) { return view.calls.events.filter(event => event.name === "store_browse_stage").map(event => event.properties); }
function selectFromCatalog(view, selection = tankSelection, handle = product.product_handle) {
  return view.analytics.trackStoreEvent("store_catalog_product_selected", { product_handle: handle, selection });
}

test("catalog analytics records public selections and zero results without raw query values", () => {
  const view = fixture(); view.configure(); registerCatalog(view);
  assert.equal(view.analytics.catalogAnalyticsSelection({ category: "all", collection: "", fit: "all" }), allSelection);
  assert.equal(view.analytics.catalogAnalyticsSelection({ category: "hoodies", collection: "sunday-clothes", fit: "unisex" }), hoodieSelection);
  const external = { query: "email=private@example.test", source: "?token=secret", member: "private" };
  assert.equal(view.analytics.trackStoreEvent("store_catalog_viewed", { selection: hoodieSelection, results: 2, ...external }), true);
  assert.equal(view.analytics.trackStoreEvent("store_filter_changed", { filter: "fit:womens", results: 0, ...external }), true);
  assert.equal(view.analytics.trackStoreEvent("store_catalog_viewed", { selection: "category=hoodies|collection=sunday-clothes|fit=womens", results: 0 }), true);
  assert.equal(view.analytics.trackStoreEvent("store_filter_changed", { filter: "reset:all", results: 12 }), true);
  assert.equal(view.analytics.trackStoreEvent("store_color_selected", { product_handle: "sunday-clothes-hoodie", option_value: "Grey", ...external }), true);
  assert.deepEqual(view.calls.events.map(event => event.properties), [
    { selection: hoodieSelection, results: 2 }, { filter: "fit:womens", results: 0 },
    { selection: "category=hoodies|collection=sunday-clothes|fit=womens", results: 0 },
    { filter: "reset:all", results: 12 }, { product: "sunday-clothes-hoodie", color: "Grey" },
  ]);
  for (const event of view.calls.events) assert.ok(Object.keys(event.properties).length <= 2);
  assert.doesNotMatch(JSON.stringify(view.calls.events), /email|private|secret|query|token/);
});

test("catalog event boundary rejects unregistered filters, malformed selections, and unsafe colors", () => {
  const view = fixture(); view.configure(); registerCatalog(view);
  for (const selection of [
    "category=all|collection=private-person|fit=all", "category=all|collection=frontpage|fit=all",
    "category=unknown|collection=all|fit=all", "category=all|collection=all|fit=private",
    "category=all|collection=all|fit=all&email=private@example.test", "?category=hoodies", "",
  ]) {
    assert.equal(view.analytics.trackStoreEvent("store_catalog_viewed", { selection, results: 1 }), false, selection);
    assert.equal(selectFromCatalog(view, selection), false, selection);
  }
  for (const filter of ["collection:private-person", "collection:frontpage", "fit:private", "category:unknown", "reset:private", "fit:mens:private"]) {
    assert.equal(view.analytics.trackStoreEvent("store_filter_changed", { filter, results: 1 }), false, filter);
  }
  for (const results of [-1, 0.5, Infinity, 10001, "1", undefined]) {
    assert.equal(view.analytics.trackStoreEvent("store_catalog_viewed", { selection: allSelection, results }), false);
  }
  for (const option_value of ["private@example.test", "red?token=secret", "", "x".repeat(65)]) {
    assert.equal(view.analytics.trackStoreEvent("store_color_selected", { product_handle: "byob-tank", option_value }), false);
  }
  assert.equal(view.analytics.trackStoreEvent("store_browse_stage", { selection: allSelection, stage: "purchased" }), false);
  assert.equal(view.calls.events.length, 0);
  view.analytics.configureCatalogAnalytics([{ handle: "sunday-clothes" }]);
  assert.equal(selectFromCatalog(view, tankSelection), false, "retired collections stop reporting");
});

test("browse stages follow the selected product and only actual added bag lines to checkout", async () => {
  const view = fixture(); view.configure(); registerCatalog(view);
  const other = { ...product, product_handle: "sunday-clothes-hoodie", variant_id: "gid://shopify/ProductVariant/999" };
  const bagLine = { ...line, productId: product.product_handle };
  view.setLines([bagLine]);
  selectFromCatalog(view);
  view.analytics.trackStoreEvent("store_product_opened", product);
  view.analytics.trackStoreEvent("store_add_to_bag", product);
  // Looking at another product must not replace the added product's discovery source.
  selectFromCatalog(view, hoodieSelection, other.product_handle);
  view.analytics.trackStoreEvent("store_product_opened", other);
  view.analytics.trackStoreEvent("store_checkout_clicked", { quantity: 1, value: 48 });
  view.analytics.trackStoreEvent("store_checkout_redirected", { quantity: 1, value: 48 });
  assert.deepEqual(stages(view), [
    { selection: tankSelection, stage: "product_selected" },
    { selection: tankSelection, stage: "product_opened" },
    { selection: tankSelection, stage: "add_to_bag" },
    { selection: hoodieSelection, stage: "product_selected" },
    { selection: hoodieSelection, stage: "product_opened" },
    { selection: tankSelection, stage: "checkout_clicked" },
    { selection: tankSelection, stage: "checkout_redirected" },
  ]);
  assert.equal(view.calls.events.some(event => event.properties.stage === "purchased"), false);
  await view.analytics.flushStoreCart();
  assert.equal(view.calls.adds.length, 1, "native Shopify add-to-cart behavior is preserved");
});

test("checkout deduplicates matching selections and never attributes unrelated or removed variants", async () => {
  const view = fixture(); view.configure(); registerCatalog(view);
  const second = { ...product, variant_id: "gid://shopify/ProductVariant/790" };
  selectFromCatalog(view);
  view.analytics.trackStoreEvent("store_add_to_bag", product);
  view.analytics.trackStoreEvent("store_add_to_bag", second);
  view.setLines([{ ...line, productId: product.product_handle }, { variantId: second.variant_id, productId: product.product_handle, quantity: 1 }]);
  view.analytics.trackStoreEvent("store_checkout_clicked", { quantity: 2 });
  assert.equal(stages(view).filter(event => event.stage === "checkout_clicked").length, 1);
  view.setLines([{ ...line, productId: "different-product" }]);
  view.analytics.trackStoreEvent("store_checkout_failed", { quantity: 1, error_category: "network" });
  assert.equal(stages(view).some(event => event.stage === "checkout_failed"), false);
  view.setLines([]);
  view.analytics.trackStoreEvent("store_bag_item_removed", { ...product, source: "bag" });
  view.setLines([{ ...line, productId: product.product_handle }]);
  view.analytics.trackStoreEvent("store_checkout_redirected", { quantity: 1 });
  assert.equal(stages(view).some(event => event.stage === "checkout_redirected"), false, "removed contexts cannot return through an old saved bag");
  await view.analytics.flushStoreCart();
});

test("quick-buy and a fresh document cannot inherit catalog discovery attribution", async () => {
  const view = fixture(); view.configure(); registerCatalog(view);
  view.setLines([{ ...line, productId: product.product_handle }]);
  selectFromCatalog(view);
  view.analytics.trackStoreEvent("store_add_to_bag", product);
  view.analytics.trackStoreEvent("store_product_opened", { ...product, source: "quick_buy" });
  view.analytics.trackStoreEvent("store_add_to_bag", { ...product, source: "quick_buy" });
  view.analytics.trackStoreEvent("store_checkout_clicked", { quantity: 2 });
  assert.deepEqual(stages(view).map(event => event.stage), ["product_selected", "add_to_bag"]);
  const reloaded = fixture(); reloaded.configure(); registerCatalog(reloaded);
  reloaded.setLines([{ ...line, productId: product.product_handle }]);
  reloaded.analytics.trackStoreEvent("store_checkout_clicked", { quantity: 2 });
  assert.deepEqual(stages(reloaded), [], "attribution is deliberately not persisted across reloads");
  await view.analytics.flushStoreCart();
});

test("unknown, denied, pending, GPC, and private navigation erase browse context without replay", async () => {
  for (const mode of ["unknown", "denied", "pending", "gpc", "private"]) {
    const view = fixture(); view.configure(); registerCatalog(view);
    view.setLines([{ ...line, productId: product.product_handle }]);
    selectFromCatalog(view);
    view.analytics.trackStoreEvent("store_add_to_bag", product);
    if (mode === "unknown") view.setChoice("");
    if (mode === "denied") view.setChoice("no");
    if (mode === "pending") view.consent.setConsentUpdatePending(true);
    if (mode === "gpc") view.window.navigator.globalPrivacyControl = true;
    if (mode === "private") view.window.location = new URL("https://theruinedproject.com/my/profile");
    view.analytics.refreshStoreAnalytics();
    const before = view.calls.events.length;
    assert.equal(selectFromCatalog(view, hoodieSelection), false, mode);
    assert.equal(view.analytics.trackStoreEvent("store_color_selected", { product_handle: "sunday-clothes-hoodie", option_value: "Blue" }), false, mode);
    view.setChoice("yes"); view.consent.setConsentUpdatePending(false);
    view.window.navigator.globalPrivacyControl = false;
    view.window.location = new URL("https://theruinedproject.com/bag");
    view.analytics.refreshStoreAnalytics();
    view.analytics.trackStoreEvent("store_checkout_clicked", { quantity: 1 });
    assert.equal(view.calls.events.length, before + 1, mode);
    assert.equal(stages(view).some(event => event.stage === "checkout_clicked"), false, mode);
    await view.analytics.flushStoreCart();
  }
});

test("browse attribution expires and keeps a bounded recent set", () => {
  const view = fixture(); view.configure(); registerCatalog(view);
  view.setNow(1000);
  for (let index = 0; index < 51; index++) selectFromCatalog(view, allSelection, `product-${index}`);
  view.analytics.trackStoreEvent("store_product_opened", { ...product, product_handle: "product-0" });
  view.analytics.trackStoreEvent("store_product_opened", { ...product, product_handle: "product-50" });
  assert.equal(stages(view).filter(event => event.stage === "product_opened").length, 1, "oldest context is evicted");
  view.setNow(1000 + 30 * 60 * 1000);
  view.analytics.trackStoreEvent("store_product_opened", { ...product, product_handle: "product-50" });
  assert.equal(stages(view).filter(event => event.stage === "product_opened").length, 1, "thirty-minute contexts expire");
});
