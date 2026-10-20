import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as colors from "../src/lib/store/product-colors.ts";
import * as fits from "../src/lib/store/product-fit-images.ts";
import * as links from "../src/lib/store/product-links.ts";
import * as catalogFilters from "../src/lib/store/catalog-filters.ts";

function hooks() {
  const slots = [], effects = [];
  let cursor = 0;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
  const react = {
    ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useId() { return "guide-test"; },
    useMemo(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: callback() }; return slots[i].value; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  return { react, render(component, props) { cursor = 0; const result = component(props); effects.splice(0).forEach(run => run()); return result; }, cleanup() { slots.forEach(slot => slot?.cleanup?.()); } };
}
function load(path, dependencies, environment = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(environment), compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(environment));
  return loaded.exports.default ?? loaded.exports;
}
const elements = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
const text = node => typeof node === "string" ? node : React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : "";
const Stub = () => null;
const SizeGuide = () => null;
const product = {
  id: "hoodie", shopifyProductGid: "gid://shopify/Product/123", name: "Hoodie", code: "RU-1", subtitle: "", material: "", origin: "", care: "", tone: "shadow", price: "$64",
  options: [{ name: "Color", values: ["Black", "Blue"] }, { name: "Size", values: ["S", "M"] }],
  variants: ["Black", "Blue"].flatMap((color, i) => ["S", "M"].map((size, j) => ({
    id: `gid://shopify/ProductVariant/${i * 2 + j + 1}`, title: `${color} / ${size}`, available: true, price: "$64", priceAmount: "64.00", currencyCode: "USD",
    selectedOptions: [{ name: "Color", value: color }, { name: "Size", value: size }],
  }))),
};
const bagItem = { key: "hoodie::1", productId: product.id, productName: product.name, productCode: product.code, variantId: product.variants[0].id, variantTitle: product.variants[0].title, selectedOptions: product.variants[0].selectedOptions, unitPrice: "$64", priceAmount: "64.00", currencyCode: "USD", quantity: 1 };
function fixture(path, props = {}, options = {}) {
  const state = hooks(), events = [], calls = [], mutations = [], metaAdds = [];
  const childStates = new Map();
  let renderingState = state;
  const hookProxy = { ...React, ...Object.fromEntries(["useState", "useRef", "useId", "useMemo", "useCallback", "useEffect"].map(name => [name, (...args) => renderingState.react[name](...args)])) };
  let allowed = options.allowed ?? true, params = new URLSearchParams(), currentProps = props;
  let items = options.items ?? [bagItem], hydrated = options.hydrated ?? true;
  let mutationFails = false, redirectFails = false;
  const window = new EventTarget();
  window.location = { pathname: "/store/hoodie", search: "", assign(url) { if (redirectFails) throw new Error("private redirect detail"); calls.push({ redirect: url }); } };
  window.history = { replaceState() {}, pushState(_state, _title, url) { const next = new URL(url, "https://store.test"); params = next.searchParams; window.location.search = next.search; calls.push({ navigation: url }); } };
  const dependencies = {
    react: hookProxy, "react/jsx-runtime": jsxRuntime,
    "next/link": { default: Stub }, "next/image": { default: Stub }, "next/navigation": { useSearchParams: () => params },
    "@/data/products": { PRODUCT_TONES: { shadow: "#000" } },
    "@/lib/store/product-colors": colors, "@/lib/store/product-fit-images": fits, "@/lib/store/product-links": links,
    "@/lib/store/catalog": { catalogNotice: () => ({}) },
    "@/lib/store/catalog-filters": catalogFilters,
    "@/lib/marketing/consent": { MARKETING_CONSENT_EVENT: "consent" },
    "@/lib/marketing/meta": { trackMetaProductView() {}, trackMetaAddToCart(product, variant, quantity) { metaAdds.push({ product, variant, quantity }); }, checkoutVisitorConsent: () => undefined, checkoutWithAttribution: value => value },
    "@/lib/analytics/shopify": { shopifyAnalyticsTrackingHeaders: () => allowed ? { "X-Shopify-UniqueToken": "unique", "X-Shopify-VisitToken": "visit" } : {} },
    "@/lib/analytics/storefront": { configureCatalogAnalytics: () => {}, catalogAnalyticsSelection: ({category, collection, fit}) => `category=${category}|collection=${collection || "all"}|fit=${fit}`, trackStoreEvent(name, properties) { if (!allowed) return false; events.push({ name, properties }); return true; }, flushStoreCart: () => options.flush?.() ?? Promise.resolve() },
    "@/data/store-policies": { FREE_STANDARD_SHIPPING_COPY: "Shipping" },
    "@/data/product-size-guides": { getProductSizeGuide: () => ({ fit: "Unisex" }), getProductSizeGuideConfig: () => ({ sizeOption: "Size", fitOption: "Fit" }) },
    "./ProductGallery": { default: Stub }, "./ProductPurchase": { default: Stub }, "./ProductSizeGuideDialog": { default: SizeGuide }, "./BagLink": { default: Stub },
  };
  const mutate = (action, value) => { if (mutationFails) throw new Error("storage private detail"); mutations.push({ action, value }); };
  const bag = { useBag: () => ({ items, hydrated, count: items.reduce((sum, item) => sum + item.quantity, 0), add: value => { mutate("add", value); return options.add ? options.add(value) : (options.addedQuantity ?? 1); }, setQuantity: (key, quantity) => mutate("quantity", { key, quantity }), remove: key => mutate("remove", key), clear: () => mutate("clear") }), isShopifyVariantId: value => value.startsWith("gid://shopify/ProductVariant/") };
  dependencies["./bag-store"] = bag;
  dependencies["@/components/store/bag-store"] = bag;
  const Component = load(path, dependencies, {
    window,
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body), headers: init.headers }); return options.response ? options.response() : { ok: true, json: async () => ({ checkoutUrl: "https://checkout.example.test/secret-checkout" }) }; },
  });
  const render = () => { renderingState = state; return state.render(Component, currentProps); };
  return {
    render, renderChild: (node) => {
      const key = node.key ?? node.type;
      if (!childStates.has(key)) childStates.set(key, hooks());
      renderingState = childStates.get(key);
      return renderingState.render(node.type, node.props);
    }, events, calls, mutations, metaAdds, cleanup: state.cleanup,
    setAllowed(value) { allowed = value; }, consent() { window.dispatchEvent(new Event("consent")); },
    setProps(value) { currentProps = value; }, setParams(value) { params = new URLSearchParams(value); },
    setItems(value) { items = value; }, setHydrated(value) { hydrated = value; }, failMutation() { mutationFails = true; }, failRedirect() { redirectFails = true; },
    named(name) { return events.filter(event => event.name === name); },
    button(label) { return elements(render()).find(node => node.type === "button" && (text(node) === label || node.props["aria-label"] === label)); },
  };
}

test("product views wait for consent and do not repeat for variant changes or consent notifications", () => {
  const view = fixture("src/components/store/ProductDetail.tsx", { product }, { allowed: false });
  view.render(); assert.equal(view.events.length, 0);
  view.setAllowed(true); view.consent(); view.consent();
  view.setParams("variant=gid%3A%2F%2Fshopify%2FProductVariant%2F4"); view.render();
  assert.equal(view.named("store_product_opened").length, 1);
  assert.deepEqual(view.events[0].properties, { product_id: product.shopifyProductGid, product_handle: product.id, source: "product_page", variant_id: product.variants[0].id, quantity: 1, value: 64, currency: "USD" });
  view.setProps({ product: { ...product, id: "other", shopifyProductGid: "gid://shopify/Product/456" } }); view.render();
  assert.equal(view.named("store_product_opened").length, 2);
  view.cleanup(); view.consent(); assert.equal(view.named("store_product_opened").length, 2);
});

test("product controls record catalog choices and successful adds, with the exact variant totals", () => {
  const view = fixture("src/components/store/ProductPurchase.tsx", { product, initialColor: "Black" });
  view.button("M").props.onClick();
  const guide = elements(view.render()).find(node => node.type === SizeGuide);
  guide.props.onOpen();
  view.button("Add to bag").props.onClick();
  assert.deepEqual(view.named("store_variant_selected")[0].properties, { product_id: product.shopifyProductGid, product_handle: product.id, source: "product_page", option_name: "Size", option_value: "M" });
  assert.equal(view.named("store_size_guide_opened").length, 1);
  assert.deepEqual(view.named("store_add_to_bag")[0].properties, { product_id: product.shopifyProductGid, product_handle: product.id, variant_id: product.variants[1].id, source: "product_page", quantity: 1, value: 64, currency: "USD" });
  view.failMutation(); assert.throws(() => view.button("Added to bag").props.onClick());
  assert.equal(view.named("store_add_to_bag").length, 1, "failed storage cannot produce a successful add event");
});

test("quick buy records first interaction instead of hidden mount and retries only its view after consent", () => {
  const view = fixture("src/components/sequence/JourneyQuickBuy.tsx", { product }, { allowed: false });
  const choose = (name, value) => elements(view.render()).find(node => node.type === "label" && text(node).startsWith(name)).props.children[1].props.onChange({ currentTarget: { value } });
  view.render(); view.setAllowed(true); view.consent(); assert.equal(view.events.length, 0);
  view.setAllowed(false); choose("Color", "Blue");
  view.setAllowed(true); view.consent(); view.consent();
  assert.equal(view.named("store_product_opened").length, 1);
  assert.equal(view.named("store_variant_selected").length, 0, "denied choices are not replayed");
  choose("Size", "M"); view.button("Add to bag").props.onClick();
  assert.equal(view.named("store_product_opened").length, 1);
  assert.equal(view.named("store_add_to_bag")[0].properties.source, "quick_buy");
  assert.equal(view.named("store_add_to_bag")[0].properties.variant_id, product.variants[3].id);
  view.failMutation(); view.button("Added ✓").props.onClick();
  assert.equal(view.named("store_add_to_bag").length, 1);
  view.cleanup();
});

test("bag view waits for hydration and consent, then remains one view across cart changes", () => {
  const view = fixture("src/components/store/BagPageClient.tsx", { products: [product], email: "private@example.test" }, { allowed: false, hydrated: false });
  view.render(); view.setAllowed(true); view.consent(); assert.equal(view.events.length, 0);
  view.setHydrated(true); view.render();
  assert.deepEqual(view.named("store_bag_viewed")[0].properties, { source: "bag", quantity: 1, value: 64, currency: "USD" });
  view.setItems([{ ...bagItem, quantity: 2 }]); view.render(); view.consent();
  assert.equal(view.named("store_bag_viewed").length, 1);
  view.cleanup();
});

test("bag actions count actual quantity changes and removals without leaking stale bag metadata", () => {
  const view = fixture("src/components/store/BagPageClient.tsx", { products: [product], email: "private@example.test" });
  view.button("Decrease quantity").props.onClick();
  assert.equal(view.named("store_bag_quantity_changed").length, 0);
  view.button("Increase quantity").props.onClick();
  assert.equal(view.named("store_bag_quantity_changed")[0].properties.quantity, 2);
  view.button("Remove").props.onClick();
  assert.equal(view.named("store_bag_item_removed").length, 1);
  view.button("Clear").props.onClick(); assert.equal(view.named("store_bag_item_removed").length, 2);
  view.setItems([{ ...bagItem, variantId: "unknown-person@example.test", productId: "private local text" }]);
  view.button("Remove").props.onClick(); assert.equal(view.named("store_bag_item_removed").length, 2);
  assert.doesNotMatch(JSON.stringify(view.events), /private@example|private local|unknown-person/);
  view.cleanup();
});

test("checkout waits for cart synchronization and records click followed by redirect without checkout identifiers", async () => {
  let finishSync;
  const syncing = new Promise(resolve => { finishSync = resolve; });
  const view = fixture("src/components/store/BagPageClient.tsx", { products: [product], email: "private@example.test" }, { flush: () => syncing });
  const pending = view.button("Secure checkout").props.onClick();
  assert.equal(view.named("store_checkout_clicked").length, 1);
  assert.equal(view.calls.length, 0, "POST must wait for the sync cookie to settle");
  for (const label of ["Decrease quantity", "Increase quantity", "Remove", "Clear"]) {
    const control = view.button(label);
    assert.equal(control.props.disabled, true, `${label} stays locked while checkout is preparing`);
    control.props.onClick();
  }
  assert.deepEqual(view.mutations, [], "handlers cannot change the submitted bag while checkout is pending");
  assert.equal(view.button("Preparing secure checkout…").props.disabled, true);
  finishSync(); await pending;
  assert.equal(view.calls[0].url, "/api/store/checkout");
  assert.deepEqual(view.calls[0].body.lines, [{ variantId: bagItem.variantId, quantity: 1 }]);
  assert.equal(view.calls[0].headers["X-Shopify-UniqueToken"], "unique");
  assert.equal(view.calls[0].headers["X-Shopify-VisitToken"], "visit");
  assert.equal(view.named("store_checkout_redirected").length, 1);
  assert.equal(view.named("store_checkout_failed").length, 0);
  assert.doesNotMatch(JSON.stringify(view.events), /secret-checkout|checkoutUrl|private@example/);
  view.cleanup();
});

test("checkout errors use fixed categories and never copy server, network, or redirect messages", async () => {
  for (const [category, response, redirect] of [
    ["network", () => { throw new Error("personal network message"); }, false],
    ["checkout_unavailable", () => ({ ok: false, json: async () => ({ error: "personal server message" }) }), false],
    ["invalid_response", () => ({ ok: true, json: async () => ({}) }), false],
    ["redirect_failed", undefined, true],
  ]) {
    const view = fixture("src/components/store/BagPageClient.tsx", { products: [product], email: "private@example.test" }, { response });
    if (redirect) view.failRedirect();
    await view.button("Secure checkout").props.onClick();
    assert.equal(view.named("store_checkout_failed")[0].properties.error_category, category);
    for (const label of ["Decrease quantity", "Increase quantity", "Remove", "Clear"]) {
      assert.equal(view.button(label).props.disabled, false, `${label} unlocks after a checkout failure`);
    }
    view.button("Increase quantity").props.onClick();
    assert.deepEqual(view.mutations, [{ action: "quantity", value: { key: bagItem.key, quantity: 2 } }]);
    assert.equal(view.named("store_checkout_redirected").length, 0);
    assert.doesNotMatch(JSON.stringify(view.events), /personal|private redirect|private@example/);
    view.cleanup();
  }
});


test("catalog selection records only an activated product link", () => {
  const view = fixture("src/components/store/StoreGallery.tsx", { products: [product] });
  const tree = view.render();
  assert.equal(view.named("store_product_selected").length, 0);
  const card = elements(tree).find(node => node.props.product?.id === product.id);
  const cardTree = view.renderChild(card);
  elements(cardTree).find(node => node.props.href?.startsWith("/store/hoodie")).props.onClick();
  assert.deepEqual(view.named("store_product_selected"), [{ name: "store_product_selected", properties: { product_id: product.shopifyProductGid, product_handle: product.id, source: "store" } }]);
  assert.deepEqual(view.named("store_catalog_product_selected")[0].properties, { product_handle: product.id, selection: "category=all|collection=all|fit=all" });
});

test("size guide notifies only after opening the native dialog", () => {
  const state = hooks();
  let opens = 0;
  const document = { body: { style: { overflow: "auto" } } };
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const Component = load("src/components/store/ProductSizeGuideDialog.tsx", { react: state.react, "react/jsx-runtime": jsxRuntime, "next/image": { default: Stub } }, { document, requestAnimationFrame: callback => callback() });
  const tree = state.render(Component, { guide: { fit: "Unisex", label: "Size", image: { width: 1000, height: 800, cropTop: 0, src: "/guide.png", alt: "Size chart" } }, onOpen() { assert.equal(dialog.open, true); opens++; } });
  elements(tree).find(node => node.type === "dialog").props.ref.current = dialog;
  const trigger = elements(tree).find(node => node.type === "button" && text(node) === "Size guide");
  assert.equal(opens, 0);
  trigger.props.onClick(); trigger.props.onClick();
  assert.equal(opens, 1, "already-open dialog does not count again");
  elements(tree).find(node => node.type === "button" && text(node) === "Close").props.onClick();
  trigger.props.onClick(); assert.equal(opens, 2);
  state.cleanup();
});

function persistedBag() {
  let saved = "[]", fail = false;
  const events = [];
  const window = new EventTarget();
  window.localStorage = {
    getItem: () => saved,
    setItem(_key, value) { if (fail) throw new DOMException("Storage denied", "SecurityError"); saved = value; },
  };
  window.addEventListener("ruined:bag-change", () => events.push("change"));
  const bag = load("src/components/store/bag-store.ts", { react: {
    ...React, useState: initial => [initial, () => {}], useEffect() {}, useCallback: callback => callback, useMemo: callback => callback(),
  } }, { window });
  return { ...bag, events, failWrites() { fail = true; } };
}

test("the real bag returns only persisted quantity increases, including a partial increase at its cap", () => {
  const bag = persistedBag();
  assert.equal(bag.addBagItem({ ...bagItem, quantity: 18 }), 18);
  assert.equal(bag.addBagItem({ ...bagItem, quantity: 5 }), 2);
  assert.equal(bag.readBag()[0].quantity, 20);
  assert.equal(bag.useBag().add(bagItem), 0, "the hook preserves the zero delta at the cap");
  assert.equal(bag.readBag()[0].quantity, 20);
  const eventsBeforeFailure = bag.events.length;
  bag.failWrites();
  assert.throws(() => bag.addBagItem({ ...bagItem, variantId: product.variants[1].id }), /Storage denied/);
  assert.equal(bag.events.length, eventsBeforeFailure, "a failed write cannot report a bag change");
  assert.equal(bag.readBag().length, 1);
});

test("both purchase controls suppress UI and Meta add events when the real bag reaches 20", () => {
  for (const path of ["src/components/store/ProductPurchase.tsx", "src/components/sequence/JourneyQuickBuy.tsx"]) {
    const bag = persistedBag();
    bag.addBagItem({ ...bagItem, quantity: 19 });
    const view = fixture(path, { product, initialColor: "Black" }, { add: bag.addBagItem });
    if (path.includes("JourneyQuickBuy")) {
      const choose = (name, value) => elements(view.render()).find(node => node.type === "label" && text(node).startsWith(name)).props.children[1].props.onChange({ currentTarget: { value } });
      choose("Color", "Black"); choose("Size", "S");
    } else view.button("S").props.onClick();
    view.button("Add to bag").props.onClick();
    assert.equal(bag.readBag()[0].quantity, 20);
    const successLabel = path.includes("JourneyQuickBuy") ? "Added ✓" : "Added to bag";
    view.button(successLabel).props.onClick();
    assert.equal(bag.readBag()[0].quantity, 20);
    assert.equal(view.named("store_add_to_bag").length, 1, path);
    assert.equal(view.named("store_add_to_bag")[0].properties.quantity, 1);
    assert.equal(view.named("store_add_to_bag")[0].properties.value, 64);
    assert.equal(view.metaAdds.length, 1, path);
    assert.equal(view.metaAdds[0].quantity, 1);
    assert.ok(view.button("Add to bag"), "a capped click must not announce another successful addition");
    view.cleanup();
  }
});

test("purchase controls pass the returned added quantity and its total value to both trackers", () => {
  for (const path of ["src/components/store/ProductPurchase.tsx", "src/components/sequence/JourneyQuickBuy.tsx"]) {
    const view = fixture(path, { product, initialColor: "Black" }, { addedQuantity: 2 });
    if (path.includes("JourneyQuickBuy")) {
      const choose = (name, value) => elements(view.render()).find(node => node.type === "label" && text(node).startsWith(name)).props.children[1].props.onChange({ currentTarget: { value } });
      choose("Color", "Black"); choose("Size", "S");
    } else view.button("S").props.onClick();
    view.button("Add to bag").props.onClick();
    assert.equal(view.named("store_add_to_bag")[0].properties.quantity, 2);
    assert.equal(view.named("store_add_to_bag")[0].properties.value, 128);
    assert.equal(view.metaAdds[0].quantity, 2);
    view.cleanup();
  }
});


test("catalog filters compose, retain campaign parameters, and recover from no results", () => {
  const products = [
    { ...product, id: "camo-hoodie", name: "Camo Hoodie", collections: [{ handle: "sunday-clothes", title: "Sunday Clothes" }] },
    { ...product, id: "ruined-tee", name: "Staple Tee", collections: [{ handle: "staples", title: "Staples" }] },
  ];
  const view = fixture("src/components/store/StoreGallery.tsx", { products });
  view.setParams("utm_source=instagram");
  view.button("Hoodies").props.onClick();
  assert.equal(new URL(view.calls.at(-1).navigation, "https://test").searchParams.get("utm_source"), "instagram");
  let tree = view.render();
  assert.deepEqual(elements(tree).filter(node => node.props.product).map(node => node.props.product.id), ["camo-hoodie"]);
  elements(tree).find(node => node.type === "select").props.onChange({ currentTarget: { value: "staples" } });
  tree = view.render();
  assert.ok(text(tree).includes("No pieces in this combination."));
  view.button("View all pieces").props.onClick();
  assert.equal(view.calls.at(-1).navigation, "/store/hoodie?utm_source=instagram");
  assert.equal(elements(view.render()).filter(node => node.props.product).length, 2);
  view.setParams("category=tees-tanks&collection=staples");
  assert.deepEqual(elements(view.render()).filter(node => node.props.product).map(node => node.props.product.id), ["ruined-tee"], "restored URL drives the selection");
});

test("one style card changes its image and destination when a color is selected", () => {
  const view = fixture("src/components/store/StoreGallery.tsx", { products: [product] });
  const cards = elements(view.render()).filter(node => node.props.product);
  assert.equal(cards.length, 1);
  let tree = view.renderChild(cards[0]);
  const colorButtons = elements(tree).filter(node => node.type === "button");
  assert.equal(colorButtons.length, 2);
  assert.equal(colorButtons[0].props["aria-pressed"], true);
  colorButtons[1].props.onClick();
  tree = view.renderChild(cards[0]);
  const link = elements(tree).find(node => node.props.href?.startsWith("/store/hoodie"));
  assert.equal(link.props.href, "/store/hoodie?color=Blue");
  assert.equal(elements(tree).filter(node => node.type === "button")[1].props["aria-pressed"], true);
  assert.equal(view.named("store_product_selected").length, 0, "a swatch does not count as opening a product");
  assert.deepEqual(view.named("store_color_selected").map(event => event.properties), [{ product_handle: product.id, option_value: "Blue" }]);
  elements(tree).filter(node => node.type === "button")[1].props.onClick();
  assert.equal(view.named("store_color_selected").length, 1, "current color is a no-op");
  link.props.onClick();
  assert.equal(view.named("store_product_selected").length, 1);
});


test("catalog views retry after consent without replaying denied filters or colors", () => {
  const view = fixture("src/components/store/StoreGallery.tsx", { products: [product] }, {allowed:false});
  view.render();
  view.button("Hoodies").props.onClick();
  view.render();
  const card = elements(view.render()).find(node => node.props.product);
  elements(view.renderChild(card)).filter(node => node.type === "button")[1].props.onClick();
  assert.equal(view.events.length, 0);
  view.setAllowed(true); view.consent(); view.consent(); view.render();
  assert.deepEqual(view.named("store_catalog_viewed").map(event => event.properties), [{selection:"category=hoodies|collection=all|fit=all",results:1}]);
  assert.equal(view.named("store_filter_changed").length, 0);
  assert.equal(view.named("store_color_selected").length, 0);
  view.button("Hoodies").props.onClick();
  assert.equal(view.named("store_filter_changed").length, 0);
  view.button("Tees & Tanks").props.onClick(); view.render();
  assert.deepEqual(view.named("store_filter_changed")[0].properties, {filter:"category:tees-tanks",results:0});
  assert.deepEqual(view.named("store_catalog_viewed").at(-1).properties, {selection:"category=tees-tanks|collection=all|fit=all",results:0});
  view.button("View all pieces").props.onClick(); view.render();
  assert.deepEqual(view.named("store_filter_changed").at(-1).properties, {filter:"reset:all",results:1});
  view.setParams("category=hoodies"); view.render();
  assert.equal(view.named("store_filter_changed").length, 2, "URL restoration records the current view, not a fabricated click");
  view.cleanup();
});

test("fit choices intersect, report their result count, and clear with the other filters", () => {
  const products = [
    {...product,id:"camo-hoodie",name:"Camo Hoodie",collections:[{handle:"sunday-clothes",title:"Sunday Clothes"}]},
    {...product,id:"womens-crop-tee",name:"Women's Crop Tee",collections:[{handle:"staples",title:"Staples"}]},
  ];
  const view = fixture("src/components/store/StoreGallery.tsx",{products});
  const fit = elements(view.render()).find(node=>node.type==="select" && node.props["aria-label"]==="Fit");
  fit.props.onChange({currentTarget:{value:"unisex"}});
  assert.deepEqual(view.named("store_filter_changed")[0].properties,{filter:"fit:unisex",results:1});
  assert.match(view.calls.at(-1).navigation,/fit=unisex/);
  const cards = elements(view.render()).filter(node=>node.props.product);
  assert.deepEqual(cards.map(node=>node.props.product.id),["camo-hoodie"]);
  elements(view.renderChild(cards[0])).find(node=>node.props.href?.startsWith("/store/")).props.onClick();
  assert.equal(view.named("store_catalog_product_selected")[0].properties.selection,"category=all|collection=all|fit=unisex");
  view.button("Clear filters").props.onClick();
  assert.doesNotMatch(view.calls.at(-1).navigation,/fit=/);
});

test("product color events cover actual changes and exclude size choices and repeated colors", () => {
  const view=fixture("src/components/store/ProductPurchase.tsx",{product,initialColor:"Black"});
  view.button("Black").props.onClick(); view.button("M").props.onClick();
  assert.equal(view.named("store_color_selected").length,0);
  view.button("Blue").props.onClick(); view.button("Blue").props.onClick();
  assert.deepEqual(view.named("store_color_selected").map(event=>event.properties),[{product_handle:product.id,option_value:"Blue"}]);
});

test("a fitted catalog card uses only the selected cut's photo, price, stock, and destination", () => {
  const tank = {
    ...product, id: "byob-tank", name: "BYOB Tank",
    image: {url:"/mens-back.png",alt:"BYOB Tank — Men's — back"},
    images: [
      {url:"/mens-back.png",alt:"BYOB Tank — Men's — back"},
      {url:"/womens-back.png",alt:"BYOB Tank — Women's — back"},
      {url:"/womens-front.png",alt:"BYOB Tank — Women's — front"},
    ],
    options:[{name:"Fit",values:["Men's","Women's"]},{name:"Size",values:["S"]}],
    variants:[
      {id:"gid://shopify/ProductVariant/10",available:true,price:"$48",priceAmount:"48",selectedOptions:[{name:"Fit",value:"Men's"},{name:"Size",value:"S"}]},
      {id:"gid://shopify/ProductVariant/11",available:false,price:"$68",priceAmount:"68",selectedOptions:[{name:"Fit",value:"Women's"},{name:"Size",value:"S"}]},
    ],
  };
  const view=fixture("src/components/store/StoreGallery.tsx",{products:[tank]});
  view.setParams("fit=womens");
  const card=elements(view.render()).find(node=>node.props.product);
  const tree=view.renderChild(card);
  const href=elements(tree).find(node=>node.props.href).props.href;
  assert.equal(new URL(href,"https://store.test").searchParams.get("fit"),"Women's");
  assert.deepEqual(elements(tree).filter(node=>node.props.src).map(node=>node.props.src),["/womens-back.png","/womens-front.png"]);
  assert.match(text(tree),/\$68/);
  assert.match(text(tree),/Sold out/);
  assert.doesNotMatch(text(tree),/\$48|Available/);
});
