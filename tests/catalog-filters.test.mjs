import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_CATEGORIES,
  CATALOG_FITS,
  catalogFiltersHref,
  filterCatalogProducts,
  getCollectionFilters,
  getCatalogFitSelection,
  getProductCategory,
  getProductFits,
  normalizeCatalogFilters,
} from "../src/lib/store/catalog-filters.ts";

const collections = {
  staples: { handle: "staples", title: "Staples" },
  sunday: { handle: "sunday-clothes", title: "Sunday Clothes" },
  less: { handle: "less-permanent", title: "Less Permanent" },
  collared: { handle: "collared-script", title: "Collared Script" },
  byob: { handle: "byob", title: "BYOB" },
  home: { handle: "frontpage", title: "Home page" },
};
const product = (id, name, membership) => ({
  id, name, productType: "", collections: membership.map((key) => collections[key]),
  targetGenders: id === "long-sleeve-crest-polo" || id === "byob-tank" ? ["Unisex"]
    : id.startsWith("mens-") ? ["Male"] : id.startsWith("womens-") ? ["Female"] : [],
  options: id === "byob-tank" ? [{ name: "Fit", values: ["Men's", "Women's"] }] : [],
});
const products = [
  product("long-sleeve-crest-polo", "Long sleeve Crest Polo", ["staples"]),
  product("ruined-hoodie", "Staple Hoodie", ["staples"]),
  product("ruined-tee", "Staple Tee", ["staples"]),
  product("womens-crop-tee", "Women's Crop Tee", ["staples"]),
  product("mens-distressed-crop-tee", "Men's Distressed Crop Tee", ["staples"]),
  product("sunday-clothes-hoodie", "Sunday Clothes Hoodie", ["sunday"]),
  product("mens-less-permanent-tee", "Men's Less Permanent Tee", ["less"]),
  product("womens-less-permanent-crop-tee", "Women's Less Permanent Crop Tee", ["less"]),
  product("womens-crop-collared-script", "Women's Crop Collared Script", ["collared"]),
  product("mens-collared-script", "Collared Script Zip", ["collared"]),
  product("byob-tank", "BYOB Tank", ["byob", "home"]),
  product("camo-hoodie", "Camo Hoodie", ["sunday"]),
];
const ids = (items) => items.map(({ id }) => id);

test("the current twelve styles have shopper-facing categories even without Shopify product types", () => {
  const counts = Object.fromEntries(CATALOG_CATEGORIES.map(({ id }) => [id, filterCatalogProducts(products, { category: id }).length]));
  assert.deepEqual(counts, { all: 12, "tees-tanks": 6, hoodies: 3, "collared-shirts": 3 });
});

test("collections use actual Shopify membership, deduplicate, and exclude the home page group", () => {
  assert.deepEqual(getCollectionFilters(products), [collections.staples, collections.sunday, collections.less, collections.collared, collections.byob]);
  const unassigned = { id: "new-product", name: "Sunday Clothes Tee" };
  assert.deepEqual(getCollectionFilters([unassigned]), []);
  assert.equal(filterCatalogProducts([...products, unassigned], { collection: "sunday-clothes" }).length, 2);
  const future = { ...unassigned, collections: [{ handle: "studio", title: "Studio" }] };
  assert.deepEqual(getCollectionFilters([...products, future]).at(-1), future.collections[0]);
});

test("category and collection choices intersect and can honestly produce no matches", () => {
  assert.deepEqual(ids(filterCatalogProducts(products, { category: "hoodies", collection: "sunday-clothes" })), ["camo-hoodie", "sunday-clothes-hoodie"]);
  assert.deepEqual(ids(filterCatalogProducts(products, { category: "collared-shirts", collection: "staples" })), ["long-sleeve-crest-polo"]);
  assert.deepEqual(filterCatalogProducts(products, { category: "hoodies", collection: "byob" }), []);
  assert.deepEqual(ids(filterCatalogProducts(products, { category: "tees-tanks", collection: "byob" })), ["byob-tank"]);
});

test("Camo stays featured only within matching results without mutating Shopify order", () => {
  const original = ids(products);
  assert.deepEqual(ids(filterCatalogProducts(products, {})), ["camo-hoodie", ...original.filter((id) => id !== "camo-hoodie")]);
  assert.deepEqual(ids(filterCatalogProducts(products, { category: "hoodies", collection: "staples" })), ["ruined-hoodie"]);
  assert.deepEqual(ids(products), original);
});

test("unknown or retired URL filters recover independently rather than hiding the catalog", () => {
  assert.deepEqual(normalizeCatalogFilters({ category: "jackets", collection: "frontpage" }, products), { category: "all", collection: "", fit: "all" });
  assert.deepEqual(normalizeCatalogFilters({ category: "hoodies", collection: "removed-drop" }, products), { category: "hoodies", collection: "", fit: "all" });
  assert.deepEqual(normalizeCatalogFilters({ category: null, collection: "byob" }, products), { category: "all", collection: "byob", fit: "all" });
  assert.equal(filterCatalogProducts(products, { category: "junk", collection: "junk" }).length, 12);
});

test("future products use an explicit type first, conservative title inference second, and remain in All if unclassified", () => {
  assert.equal(getProductCategory({ id: "future", name: "One", productType: "Tank Tops" }), "tees-tanks");
  assert.equal(getProductCategory({ id: "future", name: "One", productType: "Sweatshirts & Hoodies" }), "hoodies");
  assert.equal(getProductCategory({ id: "future", name: "Studio Polo" }), "collared-shirts");
  assert.equal(getProductCategory({ id: "future", name: "Heavyweight T-Shirt" }), "tees-tanks");
  assert.equal(getProductCategory({ id: "future", name: "Steel Key" }), null);
  const future = { id: "future", name: "Signal Cap" };
  assert.deepEqual(filterCatalogProducts([future], {}), [future]);
  assert.deepEqual(filterCatalogProducts([future], { category: "tees-tanks" }), []);
});

test("shareable filter URLs preserve attribution and reset cleanly", () => {
  const selected = catalogFiltersHref("/store", "utm_source=instagram&category=hoodies&collection=staples", { category: "tees-tanks", collection: "byob" });
  const query = new URL(selected, "https://theruinedproject.com").searchParams;
  assert.equal(query.get("utm_source"), "instagram");
  assert.equal(query.get("category"), "tees-tanks");
  assert.equal(query.get("collection"), "byob");
  assert.equal(catalogFiltersHref("/store", query.toString(), { category: "all", collection: "", fit: "all" }), "/store?utm_source=instagram");
  assert.equal(catalogFiltersHref("/store", "category=hoodies", { category: "all", collection: "", fit: "all" }), "/store");
});


test("fit filters reflect authored cuts and approved unisex classifications", () => {
  const counts = Object.fromEntries(CATALOG_FITS.map(({ id }) => [id, filterCatalogProducts(products, { fit: id }).length]));
  assert.deepEqual(counts, { all: 12, unisex: 5, mens: 4, womens: 4 });
  assert.deepEqual(ids(filterCatalogProducts(products, { fit: "unisex" })), ["camo-hoodie", "long-sleeve-crest-polo", "ruined-hoodie", "ruined-tee", "sunday-clothes-hoodie"]);
  assert.deepEqual(getProductFits(products.find(({ id }) => id === "byob-tank")), ["mens", "womens"]);
  for (const id of ["ruined-tee", "ruined-hoodie", "sunday-clothes-hoodie", "camo-hoodie"]) {
    assert.deepEqual(getProductFits(products.find((item) => item.id === id)), ["unisex"]);
  }
});

test("fit intersects with category and collection without pulling in other cuts", () => {
  assert.deepEqual(ids(filterCatalogProducts(products, { category: "tees-tanks", collection: "staples", fit: "womens" })), ["womens-crop-tee"]);
  assert.deepEqual(ids(filterCatalogProducts(products, { category: "collared-shirts", collection: "collared-script", fit: "mens" })), ["mens-collared-script"]);
  assert.deepEqual(ids(filterCatalogProducts(products, { category: "tees-tanks", collection: "byob", fit: "mens" })), ["byob-tank"]);
  assert.deepEqual(ids(filterCatalogProducts(products, { category: "tees-tanks", collection: "byob", fit: "womens" })), ["byob-tank"]);
  assert.deepEqual(filterCatalogProducts(products, { collection: "byob", fit: "unisex" }), []);
  assert.deepEqual(filterCatalogProducts(products, { category: "hoodies", fit: "womens" }), []);
  assert.deepEqual(ids(filterCatalogProducts(products, { category: "hoodies", collection: "sunday-clothes", fit: "unisex" })), ["camo-hoodie", "sunday-clothes-hoodie"]);
});

test("explicit fit options override broad taxonomy while names only fill missing metadata", () => {
  const sample = { id: "new-top", name: "Studio Top" };
  assert.deepEqual(getProductFits({ ...sample, targetGenders: ["Unisex"], options: [{ name: "Fit", values: ["Men’s", "Women's", "Men's"] }] }), ["mens", "womens"]);
  assert.deepEqual(getProductFits({ ...sample, name: "Women's Studio Top", targetGenders: ["Unisex"] }), ["unisex"]);
  assert.deepEqual(getProductFits({ ...sample, name: "Women’s Studio Top" }), ["womens"]);
  assert.deepEqual(getProductFits({ ...sample, id: "mens-studio-shirt" }), ["mens"]);
  assert.deepEqual(getProductFits({ ...sample, name: "Unisex Studio Top" }), ["unisex"]);
  assert.deepEqual(getProductFits({ ...sample, targetGenders: ["Unspecified"], options: [{ name: "Fit", values: ["Relaxed"] }] }), []);
  assert.deepEqual(getProductFits(sample), []);
});

test("fit URLs preserve other filters and campaign data, normalize invalid values, and clear together", () => {
  const selected = catalogFiltersHref("/store", "utm_source=instagram&fit=mens&collection=staples", { category: "tees-tanks", collection: "byob", fit: "womens" });
  const query = new URL(selected, "https://theruinedproject.com").searchParams;
  assert.equal(query.get("fit"), "womens");
  assert.equal(query.get("category"), "tees-tanks");
  assert.equal(query.get("collection"), "byob");
  assert.equal(query.get("utm_source"), "instagram");
  assert.deepEqual(normalizeCatalogFilters({ category: "tees-tanks", collection: "byob", fit: "invalid" }, products), { category: "tees-tanks", collection: "byob", fit: "all" });
  assert.equal(catalogFiltersHref("/store", query.toString(), { category: "all", collection: "", fit: "all" }), "/store?utm_source=instagram");
});


test("a catalog cut selects only a matching product Fit option", () => {
  const byob = products.find(({ id }) => id === "byob-tank");
  assert.equal(getCatalogFitSelection(byob, "womens"), "Women's");
  assert.equal(getCatalogFitSelection(byob, "mens"), "Men's");
  assert.equal(getCatalogFitSelection(byob, "all"), undefined);
  assert.equal(getCatalogFitSelection(byob, "unisex"), undefined);
  assert.equal(getCatalogFitSelection(products.find(({ id }) => id === "camo-hoodie"), "unisex"), undefined);
});
