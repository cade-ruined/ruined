import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import { parseFragment } from "parse5";
import ts from "typescript";
import * as ranch from "../src/lib/store/ranch-catalog.js";
import * as promotion from "../src/lib/store/store-promotion.js";
import * as colors from "../src/lib/store/product-colors.ts";
import * as filters from "../src/lib/store/catalog-filters.ts";
import * as fits from "../src/lib/store/product-fit-images.ts";
import * as links from "../src/lib/store/product-links.ts";

function load(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports);
  return output.exports;
}
const price = load("src/components/store/ProductPrice.tsx", {
  "react/jsx-runtime": jsxRuntime, "@/lib/store/ranch-catalog.js": ranch, "@/lib/store/store-promotion.js": promotion,
  "@/lib/store/use-promotion-time": { usePromotionTime: () => Date.parse(promotion.STORE_SALE_START) },
});
let query = "";
const { default: StoreGallery } = load("src/components/store/StoreGallery.tsx", {
  react: React, "react/jsx-runtime": jsxRuntime,
  "next/navigation": { usePathname: () => "/store", useSearchParams: () => new URLSearchParams(query) },
  "next/link": { default: ({ children, ...props }) => { delete props.scroll; return React.createElement("a", props, children); } },
  "next/image": { default: ({ src, alt, className }) => React.createElement("img", { src, alt, className }) },
  "@/data/products": { PRODUCT_TONES: { shadow: "#222" } },
  "@/lib/analytics/storefront": { configureCatalogAnalytics: () => {}, catalogAnalyticsSelection: () => "all", trackStoreEvent: () => false },
  "@/lib/marketing/consent": { MARKETING_CONSENT_EVENT: "consent" },
  "@/lib/store/catalog": { catalogNotice: () => ({}) },
  "@/lib/store/product-colors": colors, "@/lib/store/catalog-filters": filters, "@/lib/store/product-fit-images": fits,
  "@/lib/store/product-links": links, "@/lib/store/ranch-catalog.js": ranch,
  "./ProductPrice": price, "./StoreVideoHeader": { default: () => null },
  "./StoreFilterDrawer": { default: ({ resultCount, children }) => React.createElement("div", { "data-filter-results": resultCount }, children) },
  "./StoreGallery.module.css": { default: {} },
});
const definitions = [
  ["mens-ruined-ranch-hoodie", "Men's Ruined Ranch Hoodie", "Mens", "Top"],
  ["womens-ruined-ranch-crop-hoodie", "Women's Ruined Ranch Crop Hoodie", "Womens", "Top"],
  ["mens-ruined-ranch-sweatpants", "Men's Ruined Ranch Sweatpants", "Mens", "Bottom"],
  ["womens-ruined-ranch-sweatpants", "Women's Ruined Ranch Sweatpants", "Womens", "Bottom"],
];
const choices = ["Black", "Blue", "Brown"];
const products = definitions.map(([id, name, gender, garment], index) => {
  const images = choices.flatMap(color => (garment === "Top" ? ["", "_Back"] : [""]).map(view => ({
    url: `https://cdn.shopify.com/files/RR_${gender}_${garment}_${color}${view}_Concrete_Flash.png`, alt: `${name} ${color}${view}`,
  })));
  const amount = garment === "Top" ? "96.00" : "77.00";
  return { id, name, shopifyProductGid: ranch.RANCH_PRODUCT_IDS[index], code: `RR-${index}`, price: `$${Number(amount)}`, tone: "shadow", available: true,
    productType: garment === "Top" ? "Hoodie" : "Sweatpants", collections: [{ handle: "ruined-ranch", title: "Ruined Ranch" }],
    options: [{ name: "Color", values: choices }, { name: "Size", values: ["S", "M"] }], image: images[0], images,
    variants: choices.flatMap((color, ci) => ["S", "M"].map((size, si) => ({ id: `gid://shopify/ProductVariant/${index + 1}${ci}${si}`, title: `${color} / ${size}`, price: `$${Number(amount)}`, priceAmount: amount, currencyCode: "USD", available: !(index === 0 && color === "Blue"), selectedOptions: [{ name: "Color", value: color }, { name: "Size", value: size }] }))),
  };
});
const all = node => [node, ...(node.childNodes ?? []).flatMap(all)];
const attr = (node, key) => node.attrs?.find(item => item.name === key)?.value;
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join(" ").replace(/\s+/g, " ").trim();
function render(items = products, search = "") {
  query = search;
  const root = parseFragment(renderToStaticMarkup(React.createElement(StoreGallery, { products: items })));
  const nodes = all(root);
  return { nodes, cards: nodes.filter(node => attr(node, "data-product-handle")), status: text(nodes.find(node => attr(node, "role") === "status")), drawerCount: Number(attr(nodes.find(node => attr(node, "data-filter-results")), "data-filter-results")) };
}

test("Ranch shows twelve fixed-color listings with correct views, links, prices and availability", () => {
  const before = JSON.stringify(products);
  const { cards, status, drawerCount } = render();
  assert.equal(cards.length, 12); assert.equal(status, "12 items"); assert.equal(drawerCount, 12);
  for (const [index, product] of products.entries()) {
    const productCards = cards.filter(card => attr(card, "data-product-handle") === product.id);
    assert.deepEqual(productCards.map(card => attr(card, "data-product-color")), choices);
    for (const card of productCards) {
      const color = attr(card, "data-product-color"), nodes = all(card), imageNodes = nodes.filter(node => node.tagName === "img");
      assert.equal(attr(nodes.find(node => node.tagName === "a"), "href"), `/store/${product.id}?color=${color}`);
      assert.equal(imageNodes.length, index < 2 ? 2 : 1);
      assert.match(attr(imageNodes[0], "src"), new RegExp(`_${color}_Concrete_Flash\\.png$`));
      if (index < 2) assert.match(attr(imageNodes[1], "src"), new RegExp(`_${color}_Back_Concrete_Flash\\.png$`));
      assert.ok(imageNodes.every(node => attr(node, "class").includes("object-contain")));
      assert.equal(nodes.filter(node => node.tagName === "button").length, 0, "A fixed-color listing must not switch into another card's color");
      assert.ok(text(card).includes(index < 2 ? "$67.20" : "$53.90"));
      assert.ok(text(card).includes(index < 2 ? "$96" : "$77"));
      assert.equal(text(card).includes("Sold out"), index === 0 && color === "Blue");
      assert.doesNotMatch(text(card), /Made to order/i);
    }
  }
  assert.equal(JSON.stringify(products), before, "Product identities, variants and base prices stay unchanged");
});

test("filters and their result counts use color listings while other products remain grouped", () => {
  const legacy = { ...products[0], id: "sunday-clothes-hoodie", name: "Sunday Clothes Hoodie", shopifyProductGid: "gid://shopify/Product/999", collections: [], options: [{ name: "Color", values: ["Black", "Blue"] }], variants: products[0].variants.filter(variant => variant.selectedOptions[0].value !== "Brown") };
  const combined = [...products, legacy];
  const unfiltered = render(combined);
  assert.equal(unfiltered.cards.length, 13); assert.equal(unfiltered.status, "13 items");
  const legacyCards = unfiltered.cards.filter(card => attr(card, "data-product-handle") === legacy.id);
  assert.ok(text(legacyCards[0]).includes("$67.20"), "Non-Ranch Shopify products receive the storewide sale");
  assert.ok(text(legacyCards[0]).includes("30% off storewide"));
  assert.equal(legacyCards.length, 1); assert.equal(all(legacyCards[0]).filter(node => node.tagName === "button").length, 2);
  const pants = render(combined, "category=pants&collection=ruined-ranch");
  assert.equal(pants.cards.length, 6); assert.equal(pants.drawerCount, 6); assert.equal(pants.status, "6 items of 13");
  const womens = render(combined, "category=hoodies&fit=womens&collection=ruined-ranch");
  assert.equal(womens.cards.length, 3); assert.equal(womens.drawerCount, 3); assert.equal(womens.status, "3 items of 13");
});
