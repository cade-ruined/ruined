import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";
import { compile } from "tailwindcss";

const compiled = new Map();
function load(path, dependencies, environment = {}) {
  if (!compiled.has(path)) {
    compiled.set(path, ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText);
  }
  const output = { exports: {} };
  new Function("require", "module", "exports", "window", compiled.get(path))((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports, environment.window);
  return output.exports;
}

function elements(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(elements)];
}

function content(element) {
  if (typeof element === "string" || typeof element === "number") return String(element);
  return React.isValidElement(element) ? React.Children.toArray(element.props.children).map(content).join("") : "";
}

function variant(id, color, size, available = true, priceAmount = "64.00") {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    title: `${color} / ${size}`,
    available,
    selectedOptions: [{ name: "Color", value: color }, { name: "Size", value: size }],
    price: `$${Number(priceAmount)}`,
    priceAmount,
    currencyCode: "USD",
  };
}

const product = {
  id: "script-hoodie",
  name: "Script Hoodie",
  code: "RU—009",
  price: "$64",
  image: { url: "/script-hoodie-black.png", alt: "Black Script Hoodie" },
  expectedShipDate: "2026-10-01",
  options: [{ name: "Color", values: ["Black", "Blue", "Grey"] }, { name: "Size", values: ["S", "M", "L"] }],
  variants: [
    variant(101, "Black", "S"),
    variant(102, "Black", "M", false),
    variant(103, "Black", "L"),
    variant(104, "Blue", "S", false),
    variant(105, "Blue", "M", true, "68.00"),
    variant(106, "Grey", "S", false),
  ],
};

function fixture(item = product, add = () => {}) {
  const slots = [];
  let cursor = 0;
  const calls = [];
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
  };
  const Component = load("src/components/sequence/JourneyQuickBuy.tsx", {
    react: hooks,
    "react/jsx-runtime": jsxRuntime,
    "@/components/store/bag-store": { useBag: () => ({ add(payload) { calls.push(payload); return add(payload); } }) },
  }).default;
  const render = () => { cursor = 0; return Component({ product: item }); };
  const find = (predicate) => elements(render()).find(predicate);
  const select = (name) => {
    const label = find((node) => node.type === "label" && content(node).startsWith(`${name} for ${item.name}`));
    assert.ok(label, `Missing accessible ${name} selection`);
    return elements(label).find((node) => node.type === "select");
  };
  return {
    calls, render, find, select,
    choose(name, value) { select(name).props.onChange({ currentTarget: { value } }); },
    button: () => find((node) => node.type === "button"),
    announcement: () => content(find((node) => node.props["aria-live"] === "polite")),
  };
}

test("walk quick buy requires the shopper to choose both color and size before adding", () => {
  const view = fixture();
  assert.equal(view.select("Color").props.value, "");
  assert.equal(view.select("Size").props.value, "");
  assert.equal(view.button().props.disabled, true);
  view.button().props.onClick();
  view.choose("Color", "Blue");
  assert.equal(view.button().props.disabled, true);
  view.button().props.onClick();
  assert.equal(view.calls.length, 0, "An incomplete choice must remain guarded even if a handler is called directly");
  view.choose("Size", "M");
  assert.equal(view.button().props.disabled, false);
});

test("walk quick buy sends the exact chosen variant and announces the product, color, and size", () => {
  const view = fixture();
  view.choose("Color", "Blue");
  view.choose("Size", "M");
  view.button().props.onClick();
  assert.deepEqual(view.calls, [{
    productId: "script-hoodie",
    productName: "Script Hoodie",
    productCode: "RU—009",
    variantId: "gid://shopify/ProductVariant/105",
    variantTitle: "Blue / M",
    selectedOptions: [{ name: "Color", value: "Blue" }, { name: "Size", value: "M" }],
    unitPrice: "$68",
    priceAmount: "68.00",
    currencyCode: "USD",
    image: product.image,
    expectedShipDate: "2026-10-01",
  }]);
  assert.equal(content(view.button()), "Added ✓");
  assert.equal(view.announcement(), "Script Hoodie, Blue, M added to bag.");
});

test("changing color clears size and previous success feedback before another purchase", () => {
  const view = fixture();
  view.choose("Color", "Black");
  view.choose("Size", "S");
  view.button().props.onClick();
  view.choose("Color", "Blue");
  assert.equal(view.select("Size").props.value, "");
  assert.equal(view.button().props.disabled, true);
  assert.equal(content(view.button()), "Add to bag");
  assert.equal(view.announcement(), "");
  view.button().props.onClick();
  assert.equal(view.calls.length, 1);
  view.choose("Size", "M");
  view.button().props.onClick();
  assert.deepEqual(view.calls.map((item) => item.variantId), ["gid://shopify/ProductVariant/101", "gid://shopify/ProductVariant/105"]);
});

test("a selected variant's higher price is disclosed before adding and clears when its selection changes", () => {
  const view = fixture();
  const disclosedPrice = () => view.find((node) => node.type === "p" && node.props["aria-live"] === "polite");
  assert.equal(disclosedPrice(), undefined);
  view.choose("Color", "Black");
  view.choose("Size", "S");
  assert.equal(disclosedPrice(), undefined, "The matching card price need not be repeated");
  view.choose("Color", "Blue");
  view.choose("Size", "M");
  assert.equal(content(disclosedPrice()), "$68");
  assert.equal(view.calls.length, 0, "The price must be visible before purchase");
  view.choose("Color", "Black");
  assert.equal(disclosedPrice(), undefined, "An incomplete choice must not retain the previous variant's price");
});

test("unavailable colors and unavailable or missing size combinations cannot be purchased", () => {
  const view = fixture();
  const option = (name, value) => elements(view.select(name)).find((node) => node.type === "option" && node.props.value === value);
  assert.equal(option("Color", "Grey").props.disabled, true);
  assert.equal(option("Color", "Blue").props.disabled, false);
  view.choose("Color", "Black");
  assert.equal(option("Size", "S").props.disabled, false);
  assert.equal(option("Size", "M").props.disabled, true);
  view.choose("Size", "M");
  assert.equal(view.button().props.disabled, true);
  view.button().props.onClick();
  view.choose("Color", "Blue");
  assert.equal(option("Size", "S").props.disabled, true);
  assert.equal(option("Size", "M").props.disabled, false);
  assert.equal(option("Size", "L").props.disabled, true, "A combination absent from Shopify is unavailable");
  view.choose("Size", "L");
  view.button().props.onClick();
  assert.equal(view.calls.length, 0);
});

test("a fixed color is carried into the purchased variant without a redundant color control", () => {
  const item = {
    ...product,
    options: [{ name: "Color", values: ["White"] }, { name: "Size", values: ["S", "M"] }],
    variants: [variant(201, "White", "S"), variant(202, "White", "M")],
  };
  const view = fixture(item);
  assert.equal(elements(view.render()).filter((node) => node.type === "select").length, 1);
  assert.equal(view.button().props.disabled, true);
  view.choose("Size", "M");
  view.button().props.onClick();
  assert.equal(view.calls[0].variantId, "gid://shopify/ProductVariant/202");
  assert.deepEqual(view.calls[0].selectedOptions, [{ name: "Color", value: "White" }, { name: "Size", value: "M" }]);
});

test("a single default variant needs no dropdown and does not announce Default Title", () => {
  const item = {
    ...product,
    options: [{ name: "Title", values: ["Default Title"] }],
    variants: [{ ...variant(301, "Black", "S"), title: "Default Title", selectedOptions: [{ name: "Title", value: "Default Title" }] }],
  };
  const view = fixture(item);
  assert.equal(elements(view.render()).filter((node) => node.type === "select").length, 0);
  assert.equal(view.button().props.disabled, false);
  view.button().props.onClick();
  assert.equal(view.calls[0].variantId, "gid://shopify/ProductVariant/301");
  assert.equal(view.announcement(), "Script Hoodie added to bag.");
});

test("fully sold-out and variantless products stay disabled even when handlers are invoked", () => {
  for (const variants of [product.variants.map((item) => ({ ...item, available: false })), []]) {
    const view = fixture({ ...product, available: true, variants });
    assert.equal(content(view.button()), "Sold out");
    assert.equal(view.button().props.disabled, true);
    assert.ok(elements(view.render()).filter((node) => node.type === "select").every((node) => node.props.disabled));
    view.choose("Color", "Black");
    view.choose("Size", "S");
    view.button().props.onClick();
    assert.equal(view.calls.length, 0);
    assert.equal(view.announcement(), "");
  }
});

test("a bag failure keeps the selection, reports failure, and confirms only a successful retry", () => {
  let fail = true;
  const view = fixture(product, () => { if (fail) throw new Error("Bag unavailable"); });
  view.choose("Color", "Blue");
  view.choose("Size", "M");
  view.button().props.onClick();
  assert.equal(content(view.button()), "Add to bag");
  assert.equal(view.announcement(), "");
  assert.match(content(view.find((node) => node.props.role === "alert")), /Couldn’t save to bag/);
  assert.equal(view.select("Color").props.value, "Blue");
  assert.equal(view.select("Size").props.value, "M");
  fail = false;
  view.button().props.onClick();
  assert.equal(view.calls.length, 2);
  assert.equal(view.find((node) => node.props.role === "alert"), undefined);
  assert.equal(content(view.button()), "Added ✓");
});

test("real bag persistence failures never announce success or dispatch a bag-change event", () => {
  let denyStorage = true;
  const writes = [];
  const events = [];
  const bag = load("src/components/store/bag-store.ts", { react: React }, {
    window: {
      localStorage: {
        getItem: () => null,
        setItem(key, value) {
          if (denyStorage) throw new DOMException("Storage denied", "SecurityError");
          writes.push({ key, value: JSON.parse(value) });
        },
      },
      dispatchEvent(event) { events.push(event.type); },
    },
  });
  const view = fixture(product, bag.addBagItem);
  view.choose("Color", "Blue");
  view.choose("Size", "M");
  view.button().props.onClick();
  assert.equal(view.announcement(), "");
  assert.ok(view.find((node) => node.props.role === "alert"));
  assert.deepEqual(writes, []);
  assert.deepEqual(events, []);
  denyStorage = false;
  view.button().props.onClick();
  assert.equal(writes[0].key, "ruined:bag:v1");
  assert.equal(writes[0].value[0].variantId, "gid://shopify/ProductVariant/105");
  assert.equal(writes[0].value[0].quantity, 1);
  assert.deepEqual(events, ["ruined:bag-change"]);
  assert.equal(view.announcement(), "Script Hoodie, Blue, M added to bag.");
});

test("quick-buy gestures stay local without canceling native controls or capturing keyboard and pointer release", () => {
  const view = fixture();
  const panel = view.render();
  assert.equal(panel.props["data-journey-quick-buy"], product.id);
  for (const handler of ["onPointerDown", "onWheel", "onClick"]) {
    let stopped = 0;
    let prevented = 0;
    panel.props[handler]({ stopPropagation() { stopped++; }, preventDefault() { prevented++; } });
    assert.equal(stopped, 1, `${handler} must not reach the mobile walk stage`);
    assert.equal(prevented, 0, `${handler} must preserve the browser's native control action`);
  }
  for (const node of elements(panel)) {
    for (const handler of ["onKeyDown", "onKeyUp", "onPointerUp", "onPointerCancel", "onPointerMove"]) {
      assert.equal(node.props[handler], undefined, `${handler} must remain with the native control or enclosing stage`);
    }
  }
});

test("the walk shelf renders three purchase panels beside product links and a full-catalog route", async () => {
  const QuickBuy = load("src/components/sequence/JourneyQuickBuy.tsx", {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@/components/store/bag-store": { useBag: () => ({ add() {} }) },
  }).default;
  const { JourneyStoreIndex } = load("src/components/sequence/JourneyIndexes.tsx", {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/image": { default: ({ src, alt }) => React.createElement("img", { src, alt }) },
    "@/data/navigation": { EXPLORE_ROOMS: [] },
    "@/data/public-membership": { MEMBERSHIP_INTRO: {} },
    "@/lib/store/catalog": load("src/lib/store/catalog.ts", {}),
    "./JourneyQuickBuy": { default: QuickBuy },
  });
  const items = Array.from({ length: 5 }, (_, index) => ({ ...product, id: `piece-${index + 1}`, name: `Piece ${index + 1}` }));
  const dom = parseFragment(renderToStaticMarkup(React.createElement(JourneyStoreIndex, { products: items, catalogStatus: "ready" })));
  const nodes = (node) => [node, ...(node.childNodes ?? []).flatMap(nodes)];
  const attr = (node, name) => node.attrs?.find((attribute) => attribute.name === name)?.value;
  const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
  const all = nodes(dom);
  const cards = all.filter((node) => attr(node, "data-journey-product-card") !== undefined);
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((node) => attr(node, "data-journey-product-card")), ["piece-1", "piece-2", "piece-3"]);
  for (const card of cards) {
    const children = nodes(card);
    assert.equal(children.filter((node) => attr(node, "data-journey-quick-buy") !== undefined).length, 1);
    assert.equal(children.filter((node) => node.tagName === "select").length, 2);
    assert.equal(children.filter((node) => node.tagName === "button").length, 1);
    const link = children.find((node) => node.tagName === "a");
    assert.equal(attr(link, "href"), `/store/${attr(card, "data-journey-product-card")}`);
    assert.equal(nodes(link).some((node) => ["select", "button"].includes(node.tagName)), false);
  }
  const heading = all.find((node) => node.tagName === "h2" && text(node) === "On the Rack");
  assert.ok(heading);
  const headingStyles = await compile("@tailwind utilities;");
  const generatedHeadingCss = headingStyles.build(attr(heading, "class").split(/\s+/));
  assert.match(generatedHeadingCss, /font-family: var\(--font-cadehandy2\) !important/, "The handwritten face must survive the site's important global heading rule");
  assert.match(generatedHeadingCss, /white-space: nowrap/);
  for (const narrowItems of [[], [items[0]]]) {
    const narrowDom = parseFragment(renderToStaticMarkup(React.createElement(JourneyStoreIndex, { products: narrowItems })));
    const narrowHeading = nodes(narrowDom).find((node) => node.tagName === "h2" && text(node) === "On the Rack");
    const narrowCss = headingStyles.build(attr(narrowHeading, "class").split(/\s+/));
    assert.match(narrowCss, /font-size: 1\.375rem/, "Zero- and one-product shelves use smaller lettering inside their 18rem width");
    assert.match(narrowCss, /white-space: nowrap/);
  }
  const catalogLink = all.find((node) => node.tagName === "a" && attr(node, "href") === "/store");
  assert.match(text(catalogLink), /Off the Rack/);
  assert.match(attr(catalogLink, "aria-label"), /full catalog/);
});
