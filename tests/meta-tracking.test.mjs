import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";

function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, output, output.exports);
  return output.exports;
}
const consent = load("src/lib/marketing/consent.ts");
const links = load("src/lib/store/product-links.ts");
const config = { storefrontAccessToken: "a".repeat(32), storefrontRootDomain: "theruinedproject.com", checkoutRootDomain: "checkout.theruinedproject.com" };
const variant = { id: "gid://shopify/ProductVariant/52219441938753", available: true, priceAmount: "96.00", currencyCode: "USD", selectedOptions: [{ name: "Size", value: "M" }] };
const product = { id: "ruined-hoodie", shopifyProductGid: "gid://shopify/Product/10372577001793", name: "Staple Hoodie", variants: [variant] };

function storage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}
function browser(choice = { marketing: "", analytics: "" }) {
  const scripts = [];
  const requests = [];
  const timers = new Map();
  const events = new EventTarget();
  const docEvents = new EventTarget();
  const privacy = {
    currentVisitorConsent: () => choice,
    marketingAllowed: () => true, analyticsProcessingAllowed: () => true, saleOfDataAllowed: () => true,
    setTrackingConsent: (options, callback) => requests.push({ options, callback }),
  };
  globalThis.window = {
    location: new URL("https://theruinedproject.com/store/ruined-hoodie?variant=52219441938753&utm_source=facebook&fbclid=known-click"),
    navigator: {}, sessionStorage: storage(), localStorage: storage(), Shopify: { customerPrivacy: privacy },
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
    setTimeout: (callback) => { const id = timers.size + 1; timers.set(id, callback); return id; }, clearTimeout: (id) => timers.delete(id),
  };
  globalThis.document = {
    referrer: "", createElement: () => ({}), head: { appendChild: (script) => scripts.push(script) },
    addEventListener: docEvents.addEventListener.bind(docEvents), removeEventListener: docEvents.removeEventListener.bind(docEvents), dispatchEvent: docEvents.dispatchEvent.bind(docEvents),
  };
  const meta = load("src/lib/marketing/meta.ts", { "./consent": consent });
  meta.configureMetaTracking(true);
  return { scripts, requests, timers, privacy, meta, choose: (value) => { choice = value; } };
}

test("marketing needs explicit analytics and marketing choice, processing permission, and no GPC", () => {
  const b = browser();
  assert.equal(consent.marketingConsentAllowed(b.privacy), false);
  b.choose({ marketing: "yes", analytics: "no" });
  assert.equal(consent.marketingConsentAllowed(b.privacy), false);
  b.choose({ marketing: "yes", analytics: "yes" });
  assert.equal(consent.marketingConsentAllowed(b.privacy), true);
  assert.equal(consent.marketingConsentAllowed(b.privacy, true), false);
  b.privacy.saleOfDataAllowed = () => false;
  assert.equal(consent.marketingConsentAllowed(b.privacy), false);
});

test("configuration is off by default and never serializes a private token or sensitive placeholder", () => {
  for (const token of [undefined, "[SENSITIVE]", "shpat_secret", "private-token"]) {
    assert.equal(consent.publicMarketingConfig({ META_TRACKING_ENABLED: "true", SHOPIFY_STOREFRONT_ACCESS_TOKEN: token, SHOPIFY_CHECKOUT_DOMAIN: config.checkoutRootDomain }), null);
  }
  assert.equal(consent.publicMarketingConfig({ SHOPIFY_STOREFRONT_ACCESS_TOKEN: config.storefrontAccessToken, SHOPIFY_CHECKOUT_DOMAIN: config.checkoutRootDomain }), null);
  assert.deepEqual(consent.publicMarketingConfig({ META_TRACKING_ENABLED: "true", SHOPIFY_STOREFRONT_ACCESS_TOKEN: config.storefrontAccessToken, SHOPIFY_CHECKOUT_DOMAIN: config.checkoutRootDomain }), config);
});

test("no script/event exists before consent; permitted events use verified numeric catalog IDs and dedupe views", () => {
  const b = browser();
  b.meta.grantMetaTracking();
  b.meta.trackMetaPageView(); b.meta.trackMetaProductView(product, variant); b.meta.trackMetaAddToCart(product, variant);
  assert.equal(b.scripts.length, 0);
  b.choose({ marketing: "yes", analytics: "yes" });
  b.meta.grantMetaTracking(true);
  b.meta.trackMetaProductView(product); b.meta.trackMetaProductView(product); b.meta.trackMetaProductView(product, variant);
  b.meta.trackMetaAddToCart(product, variant);
  const events = window.fbq.queue.filter((call) => call[0] === "trackSingle");
  assert.deepEqual(events.map((event) => event[2]), ["PageView", "ViewContent", "ViewContent", "AddToCart"]);
  assert.deepEqual(events[1][3].content_ids, ["10372577001793"]);
  assert.deepEqual(events[2][3].content_ids, ["52219441938753"]);
  assert.equal(events[3][3].value, 96);
  assert.equal(window.fbq.disablePushState, true);
  assert.equal(b.scripts.length, 1);
  assert.equal(events.some((event) => /Purchase|InitiateCheckout/.test(event[2])), false);
});

test("decline removes queued events immediately and survives SDK failure and a fresh tracker load", () => {
  const b = browser({ marketing: "yes", analytics: "yes" });
  b.meta.grantMetaTracking(true); b.meta.trackMetaProductView(product, variant);
  b.meta.vetoMetaTracking();
  b.meta.trackMetaAddToCart(product, variant);
  assert.equal(window.fbq.queue.some((call) => call[0] === "trackSingle"), false);
  const fresh = load("src/lib/marketing/meta.ts", { "./consent": consent });
  fresh.configureMetaTracking(true); fresh.grantMetaTracking();
  assert.equal(fresh.currentMarketingPermission(), false);
});

test("sensitive URLs, private routes/referrers, and GPC block SDK events", () => {
  const b = browser({ marketing: "yes", analytics: "yes" });
  b.meta.grantMetaTracking(true);
  for (const href of ["https://theruinedproject.com/my", "https://theruinedproject.com/store?token=secret", "https://theruinedproject.com/store#credential"]) {
    window.location = new URL(href); b.meta.trackMetaPageView();
  }
  window.location = new URL("https://theruinedproject.com/store"); document.referrer = "https://members.theruinedproject.com/my";
  b.meta.trackMetaPageView();
  document.referrer = ""; window.navigator.globalPrivacyControl = true;
  b.meta.trackMetaPageView();
  assert.equal(b.scripts.length, 0);
});

test("catalog deep link selects exact variant; color changes keep campaign data and remove stale variant", () => {
  const query = "utm_content=Facebook_UA&utm_source=facebook&variant=52219441938753&fbclid=click-1";
  assert.equal(links.requestedProductVariant(product, new URLSearchParams(query).get("variant")), variant);
  assert.equal(links.requestedProductVariant(product, "99999"), undefined);
  const changed = links.productSelectionHref("/store/ruined-hoodie", query, { color: "Black", variant: null });
  const params = new URL(changed, "https://theruinedproject.com").searchParams;
  assert.equal(params.get("utm_source"), "facebook"); assert.equal(params.get("fbclid"), "click-1");
  assert.equal(params.get("variant"), null); assert.equal(params.get("color"), "Black");
  assert.match(links.productSelectionHref("/store/ruined-hoodie", params.toString(), { variant: variant.id }), /variant=52219441938753/);
});

test("only consented known attribution reaches the existing Shopify checkout URL", () => {
  const b = browser();
  const checkout = "https://checkout.theruinedproject.com/checkouts/cn/cart-token?key=checkout-key";
  assert.equal(b.meta.checkoutWithAttribution(checkout), checkout);
  b.choose({ marketing: "yes", analytics: "yes" }); b.meta.grantMetaTracking(true);
  const url = new URL(b.meta.checkoutWithAttribution(checkout));
  assert.equal(url.searchParams.get("key"), "checkout-key");
  assert.equal(url.searchParams.get("fbclid"), "known-click");
  assert.equal(url.searchParams.get("variant"), null);
  b.meta.vetoMetaTracking();
  assert.equal(b.meta.checkoutWithAttribution(checkout), checkout);
  assert.deepEqual(b.meta.captureAttribution("utm_source=facebook&email=private&token=secret"), { utm_source: "facebook" });
});

function componentHarness(b) {
  const slots = [];
  const effects = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value) => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, dependencies) { const i = cursor++; if (!slots[i] || dependencies.some((value, j) => value !== slots[i][j])) { slots[i] = dependencies; effects.push(fn); } },
  };
  const Component = load("src/components/MarketingConsent.tsx", {
    react: hooks, "react/jsx-runtime": jsxRuntime, "next/link": { default: "a" },
    "next/navigation": { usePathname: () => window.location.pathname },
    "@/lib/marketing/consent": consent, "@/lib/marketing/meta": b.meta,
  }).default;
  const elements = (node) => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
  const render = () => { cursor = 0; const tree = elements(Component({ config })); effects.splice(0).forEach((effect) => effect()); return tree; };
  const button = (name) => render().find((node) => node.type === "button" && node.props.children === name);
  return { render, button };
}

test("actual consent provider sends headless config, stays off through pending/timeout, and never overlaps writes", async () => {
  const b = browser();
  const view = componentHarness(b); view.render(); await Promise.resolve();
  view.button("Allow optional cookies").props.onClick();
  assert.equal(b.requests.length, 1);
  assert.deepEqual(b.requests[0].options, { ...config, headlessStorefront: true, marketing: true, analytics: true });
  b.choose({ marketing: "yes", analytics: "yes" });
  document.dispatchEvent(new Event("visitorConsentCollected"));
  b.meta.trackMetaAddToCart(product, variant);
  assert.equal(b.scripts.length, 0);
  [...b.timers.values()].forEach((timer) => timer());
  assert.equal(view.button("Reject optional cookies").props.disabled, true);
  view.button("Reject optional cookies").props.onClick();
  assert.equal(b.requests.length, 1);
  b.requests[0].callback();
  assert.equal(b.scripts.length, 1);
  window.dispatchEvent(new Event(consent.MARKETING_PREFERENCES_EVENT));
  view.button("Reject optional cookies").props.onClick();
  b.meta.trackMetaAddToCart(product, variant);
  assert.equal(b.meta.currentMarketingPermission(), false);
  b.requests[1].callback({ error: "Offline" });
  assert.equal(b.meta.hasLocalMarketingVeto(), true);
});
