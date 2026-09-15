import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

function load(path, dependencies = {}, environment = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected color helper dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports, { env: environment });
  return output.exports;
}

const colorHelpers = load("src/lib/store/product-colors.ts");
const { getProductColorOption, getProductColorImages, getProductColorHref, getVariantImage, getCatalogEntries } = colorHelpers;
const colors = ["Black", "Blue", "Grey", "Red"];
const media = (name, alt = name) => ({ url: `https://cdn.shopify.com/s/files/1/1001/4077/7793/files/${name}?v=1789413276`, alt });
const photos = Object.fromEntries(colors.map((color) => [color, [
  media(`SundayClothes-${color}HoodieFront.png`, `${color} Sunday Clothes Hoodie front`),
  media(`SundayClothes-${color}HoodieBack.png`, `${color} Sunday Clothes Hoodie back`),
]]));
function variant(id, color, size, priceAmount = "80.00", available = true, optionName = "Color") {
  return {
    id: `gid://shopify/ProductVariant/${id}`, title: `${color} / ${size}`, available,
    selectedOptions: [{ name: optionName, value: color }, { name: "Size", value: size }],
    price: `$${Number(priceAmount)}`, priceAmount, currencyCode: "USD",
  };
}
function hoodie(overrides = {}) {
  return {
    id: "sunday-clothes-hoodie", shopifyProductGid: "gid://shopify/Product/700",
    name: "Sunday Clothes Hoodie", code: "RU—009", price: "$9", available: true,
    subtitle: "", material: "Cotton", tone: "warm", image: photos.Black[0],
    options: [{ name: "Color", values: colors }, { name: "Size", values: ["S", "M"] }],
    images: [...colors.map((color) => photos[color][0]), ...colors.map((color) => photos[color][1])],
    variants: [
      variant(701, "Black", "S", "80.00"), variant(702, "Black", "M", "9.00"),
      variant(703, "Blue", "S", "76.00", false), variant(704, "Blue", "M", "82.00"),
      variant(705, "Grey", "S", "77.00", false), variant(706, "Grey", "M", "79.00", false),
      variant(707, "Red", "S", "84.00"), variant(708, "Red", "M", "83.00"),
    ],
    ...overrides,
  };
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test("color option detection supports Color and Colour in any case without confusing other options", () => {
  for (const name of ["Color", "color", "COLOR", "Colour", "cOlOuR"]) {
    const option = { name, values: colors };
    const product = hoodie({ options: [{ name: "Size", values: ["S", "M"] }, option] });
    assert.equal(getProductColorOption(product), option);
  }
  assert.equal(getProductColorOption(hoodie({ options: [{ name: "Size", values: ["S", "M"] }] })), undefined);
});

test("interleaved Sunday Clothes photographs resolve to the exact front and back of each color", () => {
  const product = hoodie();
  for (const color of colors) {
    assert.deepEqual(getProductColorImages(product, color), photos[color]);
    assert.equal(getVariantImage(product, product.variants.find((entry) => entry.selectedOptions[0].value === color)), photos[color][0]);
  }
  assert.deepEqual(getProductColorImages(product), product.images);
  assert.deepEqual(getProductColorImages(product, "Chartreuse"), product.images);
});

test("Sunday Clothes generic or empty alt text gains the correct color and view without changing source images", () => {
  const name = "Sunday Clothes Hoodie";
  const sourceImages = colors.flatMap((color) => [
    { ...photos[color][0], alt: name },
    { ...photos[color][1], alt: "" },
  ]);
  const product = freeze(hoodie({ image: sourceImages[0], images: sourceImages }));
  const before = JSON.stringify(product);
  for (const [index, color] of colors.entries()) {
    const resolved = getProductColorImages(product, color);
    assert.deepEqual(resolved.map((image) => image.alt), [`${name} — ${color}, front`, `${name} — ${color}, back`]);
    assert.deepEqual(resolved.map((image) => image.url), photos[color].map((image) => image.url));
    assert.notEqual(resolved[0], sourceImages[index * 2], "Generated alt text must belong to a derived image object");
    assert.notEqual(resolved[1], sourceImages[index * 2 + 1]);
    const selected = product.variants.find((entry) => entry.selectedOptions[0].value === color);
    assert.equal(getVariantImage(product, selected).alt, `${name} — ${color}, front`);
    assert.deepEqual(getCatalogEntries([product]).find((entry) => entry.color === color).images.map((image) => image.alt), resolved.map((image) => image.alt));
  }
  assert.equal(JSON.stringify(product), before);
  assert.deepEqual(sourceImages.map((image) => image.alt), colors.flatMap(() => [name, ""]));
});

test("authored descriptive Sunday Clothes alt text is preserved exactly", () => {
  const authoredFront = { ...photos.Blue[0], alt: "Blue cotton hoodie on concrete, with red lettering across the chest." };
  const authoredBack = { ...photos.Blue[1], alt: "Back of the blue hoodie showing its full printed composition." };
  const product = freeze(hoodie({ image: authoredFront, images: [authoredFront, authoredBack] }));
  const resolved = getProductColorImages(product, "Blue");
  assert.equal(resolved[0], authoredFront);
  assert.equal(resolved[1], authoredBack);
  assert.equal(getVariantImage(product, product.variants.find((entry) => entry.title === "Blue / M")).alt, authoredFront.alt);
});

test("color media fallback trusts only the exact Sunday Clothes handle and approved asset basenames", () => {
  const misleading = [
    media("Other-BlueHoodieFront.png", "Blue Sunday Clothes Hoodie"),
    media("SundayClothes-BlueHoodieFront-copy.png"),
    media("SundayClothes-BlueHoodieFront.png.webp"),
    media("SundayClothes-BlueHoodieDetail.png"),
    media("SundayClothes-BlackHoodieFront.png", "Blue Sunday Clothes Hoodie"),
  ];
  const product = hoodie({ images: misleading });
  assert.deepEqual(getProductColorImages(product, "Blue"), []);
  assert.equal(getVariantImage(product, product.variants.find((entry) => entry.title === "Blue / M")), undefined);
  assert.deepEqual(getProductColorImages(hoodie({ id: "another-hoodie" }), "Blue"), []);
  const encodedFront = { ...photos.Blue[0], url: photos.Blue[0].url.replace("SundayClothes-Blue", "SundayClothes%2DBlue") };
  assert.deepEqual(getProductColorImages(hoodie({ images: [encodedFront, photos.Blue[1]] }), "Blue"), [encodedFront, photos.Blue[1]]);
});

test("a color with no associated photography never receives a different color's global cover", () => {
  const product = hoodie({ images: photos.Black });
  assert.deepEqual(getProductColorImages(product, "Blue"), []);
  assert.equal(getVariantImage(product, product.variants.find((entry) => entry.title === "Blue / M")), undefined);
  const unknownVariant = { ...product.variants[0], selectedOptions: [{ name: "Color", value: "Chartreuse" }] };
  assert.equal(getVariantImage(product, unknownVariant), undefined);
  const blue = getCatalogEntries([product]).find((entry) => entry.color === "Blue");
  assert.deepEqual(blue.images, []);
  assert.equal(blue.available, true, "Missing media must not change canonical sale availability");
});

test("Shopify-assigned variant images take precedence and are deduplicated within their own color", () => {
  const assigned = media("shopify-assigned-blue.png", "Assigned blue front");
  const detail = media("shopify-assigned-blue-detail.png", "Assigned blue detail");
  const product = hoodie();
  product.variants = [
    ...product.variants,
    { ...variant(709, "Blue", "L"), image: detail },
  ].map((entry) => entry.title.startsWith("Blue /") && entry.title !== "Blue / L" ? { ...entry, image: assigned } : entry);
  const blueVariant = product.variants.find((entry) => entry.title === "Blue / M");
  const images = getProductColorImages(product, "Blue");
  assert.equal(images[0], assigned);
  assert.equal(images[1], detail);
  assert.deepEqual(images.slice(2), photos.Blue);
  assert.equal(images.filter((entry) => entry.url === assigned.url).length, 1);
  assert.equal(getVariantImage(product, blueVariant), assigned);
  assert.deepEqual(getProductColorImages(product, "Black"), photos.Black);
  assert.deepEqual(getProductColorImages({ ...product, id: "another-hoodie" }, "Blue"), [assigned, detail]);
});

test("Shopify's unassigned-variant product-cover fallback cannot turn every Sunday Clothes color black", () => {
  const product = hoodie();
  product.variants = product.variants.map((entry) => ({ ...entry, image: { ...product.image } }));
  for (const color of colors) {
    assert.deepEqual(getProductColorImages(product, color), photos[color]);
    const selectedVariant = product.variants.find((entry) => entry.selectedOptions[0].value === color);
    assert.equal(getVariantImage(product, selectedVariant).url, photos[color][0].url);
  }
  assert.deepEqual(getCatalogEntries([product]).map((entry) => entry.images), colors.map((color) => photos[color]));
  const blue = product.variants.find((entry) => entry.title === "Blue / M");
  assert.equal(getVariantImage(product, blue).url, photos.Blue[0].url);
});

test("an explicitly returned image with another known Sunday Clothes color is rejected", () => {
  const product = hoodie();
  product.variants = product.variants.map((entry) => entry.title.startsWith("Blue /")
    ? { ...entry, image: photos.Grey[0] }
    : entry);
  assert.deepEqual(getProductColorImages(product, "Blue"), photos.Blue);
  assert.equal(getVariantImage(product, product.variants.find((entry) => entry.title === "Blue / M")).url, photos.Blue[0].url);
  assert.deepEqual(getCatalogEntries([product]).find((entry) => entry.color === "Blue").images, photos.Blue);
});

test("generic multi-color cover fallback stays unassociated even when its URL query differs", () => {
  const cover = media("generic-product-cover.webp", "Product cover");
  for (const returnedCover of [cover, { ...cover, url: cover.url.replace(/\?.*$/, "?v=999&width=600") }]) {
    const product = hoodie({ id: "generic-hoodie", image: cover, images: [cover] });
    product.variants = product.variants.map((entry) => ({ ...entry, image: returnedCover }));
    const blue = product.variants.find((entry) => entry.title === "Blue / M");
    assert.deepEqual(getProductColorImages(product, "Blue"), []);
    assert.equal(getVariantImage(product, blue), undefined);
    assert.deepEqual(getCatalogEntries([product]).find((entry) => entry.color === "Blue").images, []);

    const unique = media("uniquely-assigned-blue.webp", "Blue hoodie");
    const assignedBlue = { ...blue, image: unique };
    const assignedProduct = { ...product, variants: product.variants.map((entry) => entry.id === blue.id ? assignedBlue : entry) };
    assert.deepEqual(getProductColorImages(assignedProduct, "Blue"), [unique]);
    assert.equal(getVariantImage(assignedProduct, assignedBlue), unique);
    assert.deepEqual(getProductColorImages(assignedProduct, "Black"), []);
  }
});

test("single-color and no-color variant covers remain valid when returned by Shopify", () => {
  const cover = media("single-product-cover.webp", "Garment");
  const returnedCover = { ...cover, url: cover.url.replace(/\?.*$/, "?width=600") };
  for (const options of [[{ name: "Color", values: ["Black"] }], []]) {
    const selectedVariant = { ...variant(920, "Black", "M"), image: returnedCover };
    const product = hoodie({ id: "single-product", options, image: cover, images: [cover], variants: [selectedVariant] });
    assert.equal(getVariantImage(product, selectedVariant), returnedCover);
    assert.deepEqual(getCatalogEntries([product])[0].images, [cover]);
  }
});

test("a single-color shirt retains its full editorial sequence when Shopify returns the cover as its variant image", () => {
  const cover = media("single-color-shirt-front.png", "White shirt front");
  const back = media("single-color-shirt-back.png", "White shirt back");
  const selectedVariant = { ...variant(930, "White", "M"), image: cover };
  const product = freeze(hoodie({
    id: "single-color-shirt", image: cover, images: [cover, back],
    options: [{ name: "Color", values: ["White"] }], variants: [selectedVariant],
  }));
  assert.deepEqual(getProductColorImages(product, "White"), [cover, back]);
  assert.deepEqual(getCatalogEntries([product])[0].images, [cover, back]);
  assert.equal(getVariantImage(product, selectedVariant), cover);
});

test("card URLs preserve the canonical handle and encode only validated option values", () => {
  const values = ["Pale Khaki & Bone", "Blue / Grey", "Red?next=#one"];
  const product = hoodie({ id: "hoodie / special?", options: [{ name: "Colour", values }] });
  const base = "/store/hoodie%20%2F%20special%3F";
  assert.equal(getProductColorHref(product), base);
  for (const color of ["not-listed", "?redirect=https://example.test", ""]) {
    assert.equal(getProductColorHref(product, color), base);
  }
  for (const color of values) {
    const url = new URL(getProductColorHref(product, color), "https://theruinedproject.com");
    assert.equal(url.pathname, base);
    assert.deepEqual([...url.searchParams], [["color", color]]);
    assert.equal(url.hash, "");
  }
  const normalized = new URL(getProductColorHref(product, "  blue / grey  "), "https://theruinedproject.com");
  assert.equal(normalized.searchParams.get("color"), "Blue / Grey", "Valid normalized inputs must retain Shopify's exact option value");
});

test("catalog expansion retains canonical product identity and every color's stock and numeric price", () => {
  const product = freeze(hoodie());
  const before = JSON.stringify(product);
  const entries = getCatalogEntries([product]);
  assert.equal(entries.length, 4);
  assert.equal(new Set(entries.map((entry) => entry.key)).size, 4);
  assert.deepEqual(entries.map((entry) => entry.color), colors);
  assert.deepEqual(entries.map((entry) => entry.available), [true, true, false, true]);
  assert.deepEqual(entries.map((entry) => entry.price), ["$9", "$76", "$77", "$83"]);
  for (const entry of entries) {
    assert.equal(entry.product, product, "Color cards must not create altered Product objects");
    assert.equal(entry.product.id, "sunday-clothes-hoodie");
    assert.equal(entry.product.shopifyProductGid, "gid://shopify/Product/700");
    assert.equal(entry.product.variants, product.variants);
    assert.equal(entry.product.variants.length, 8);
    assert.deepEqual(entry.images, photos[entry.color]);
    assert.equal(entry.href, `/store/sunday-clothes-hoodie?color=${entry.color}`);
  }
  assert.equal(JSON.stringify(product), before);
  assert.equal(entries.find((entry) => entry.color === "Grey").available, false, "Sold-out colors remain in the catalog");
});

test("single-color and no-color products pass through as one canonical entry with normal images", () => {
  for (const options of [[{ name: "Color", values: ["Black"] }], [{ name: "Size", values: ["S", "M"] }], []]) {
    const product = hoodie({ id: "single-product", options, images: photos.Black, variants: [variant(901, "Black", "S")] });
    assert.deepEqual(getProductColorImages(product, "Black"), photos.Black);
    const entries = getCatalogEntries([product]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].product, product);
    assert.equal(entries[0].href, "/store/single-product");
    assert.deepEqual(entries[0].images, photos.Black);
    assert.equal(getVariantImage(product, product.variants[0]), photos.Black[0]);
  }
  const imageOnly = hoodie({ id: "one-image", options: [], images: undefined });
  assert.deepEqual(getProductColorImages(imageOnly), [imageOnly.image]);
  assert.deepEqual(getProductColorImages({ ...imageOnly, image: undefined }), []);
  assert.deepEqual(getCatalogEntries([]), []);
});

test("the rendered catalog keeps four correct color cards even when Shopify returns the Black cover for every variant", () => {
  const { default: StoreGallery } = load("src/components/store/StoreGallery.tsx", {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/image": { default: ({ src, alt, className, ...props }) => React.createElement("img", { src, alt, className, "aria-hidden": props["aria-hidden"] }) },
    "@/data/products": { PRODUCT_TONES: { warm: "#e5e0d5" } },
    "@/lib/store/catalog": load("src/lib/store/catalog.ts"),
    "@/lib/store/product-colors": colorHelpers,
  });
  const nodes = (node) => [node, ...(node.childNodes ?? []).flatMap(nodes)];
  const attr = (node, name) => node.attrs?.find((attribute) => attribute.name === name)?.value;
  const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
  const fallbackProduct = hoodie();
  fallbackProduct.variants = fallbackProduct.variants.map((entry) => ({ ...entry, image: fallbackProduct.image }));
  for (const product of [hoodie(), fallbackProduct]) {
    const dom = parseFragment(renderToStaticMarkup(React.createElement(StoreGallery, { products: [product] })));
    const cards = nodes(dom).filter((node) => node.tagName === "a" && attr(node, "href")?.startsWith("/store/sunday-clothes-hoodie"));
    assert.equal(cards.length, 4);
    assert.equal(new Set(cards.map((card) => attr(card, "href"))).size, 4);
    for (const [index, color] of colors.entries()) {
      const card = cards.find((node) => new URL(attr(node, "href"), "https://theruinedproject.com").searchParams.get("color") === color);
      assert.ok(card);
      assert.match(text(card), new RegExp(color));
      const images = nodes(card).filter((node) => node.tagName === "img");
      assert.deepEqual(images.map((node) => attr(node, "src")), photos[color].map((entry) => entry.url));
      assert.equal(attr(images[1], "aria-hidden"), "true");
      assert.match(attr(images[1], "class"), /group-hover:opacity-100/);
      assert.match(text(card), new RegExp(["\\$9", "\\$76", "\\$77", "\\$83"][index]));
      assert.equal(text(card).includes("Sold out"), color === "Grey");
    }
  }
});

test("Shopify maps each variant's assigned image without changing its canonical ID or options", async () => {
  const selectedOptions = [{ name: "Color", value: "Blue" }, { name: "Size", value: "M" }];
  const baseVariant = {
    id: "gid://shopify/ProductVariant/704", title: "Blue / M", availableForSale: true,
    selectedOptions, price: { amount: "82.00", currencyCode: "USD" },
  };
  const product = {
    id: "gid://shopify/Product/700", handle: "sunday-clothes-hoodie", title: "Sunday Clothes Hoodie",
    description: "Cotton hoodie.", descriptionHtml: "<p>Cotton hoodie.</p>",
    featuredImage: { url: photos.Black[0].url, altText: photos.Black[0].alt },
    images: { nodes: [] }, priceRange: { minVariantPrice: baseVariant.price },
    options: [{ name: "Color", values: ["Blue", "Black"] }, { name: "Size", values: ["M", "S"] }],
    variants: { nodes: [
      { ...baseVariant, image: { url: photos.Blue[0].url, altText: "Assigned blue front", width: 1080, height: 1440 } },
      { ...baseVariant, id: "gid://shopify/ProductVariant/705", title: "Black / S", selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "S" }] },
      { ...baseVariant, id: "gid://shopify/ProductVariant/706", image: null },
    ] },
    metafields: [],
  };
  const requests = [];
  const api = load("src/lib/shopify.ts", {
    "server-only": {},
    "@shopify/storefront-api-client": { createStorefrontApiClient: () => ({ request: async (query) => {
      requests.push(query);
      return { data: { products: { nodes: [product] } } };
    } }) },
    "@/data/products": { TONE_BY_HANDLE: {}, TONE_CYCLE: ["warm"] },
    "@/lib/store/product-copy.js": { normalizeExpectedShipDateLanguage: (value) => value },
    "@/lib/store/catalog-loader": load("src/lib/store/catalog-loader.ts"),
  }, { SHOPIFY_STORE_DOMAIN: "test.myshopify.com", SHOPIFY_STOREFRONT_ACCESS_TOKEN: "test-token-not-a-credential" });
  const [mapped] = await api.getProducts();
  assert.ok(mapped);
  assert.equal(mapped.id, "sunday-clothes-hoodie");
  assert.deepEqual(mapped.options, product.options);
  assert.deepEqual(mapped.variants.map((entry) => entry.id), product.variants.nodes.map((entry) => entry.id));
  assert.deepEqual(mapped.variants[0].selectedOptions, selectedOptions);
  assert.deepEqual(mapped.variants[0].image, { url: photos.Blue[0].url, alt: "Assigned blue front", width: 1080, height: 1440 });
  assert.equal(Object.hasOwn(mapped.variants[1], "image"), false);
  assert.equal(Object.hasOwn(mapped.variants[2], "image"), false);
  assert.equal(mapped.image.url, photos.Black[0].url, "Mapping variant media must not replace the canonical product cover");
  assert.match(requests[0], /variants\(first:\s*100\)[\s\S]*image\s*\{\s*url\s+altText\s+width\s+height\s*\}/);
});
