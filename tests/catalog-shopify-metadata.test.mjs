import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { loadCatalog } from "../src/lib/store/catalog-loader.ts";

function shopifyAdapter(node) {
  let requestedQuery = "";
  const dependencies = {
    "server-only": {},
    "@shopify/storefront-api-client": {
      createStorefrontApiClient: () => ({ request: async (query) => {
        requestedQuery = query;
        return { data: { products: { nodes: [node] } } };
      } }),
    },
    "@/data/products": { TONE_BY_HANDLE: {}, TONE_CYCLE: ["warm"] },
    "@/lib/store/product-copy.js": { normalizeExpectedShipDateLanguage: (copy) => copy },
    "@/lib/store/catalog-loader": { loadCatalog },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/shopify.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports, { env: {
    SHOPIFY_STORE_DOMAIN: "fixture.myshopify.com",
    SHOPIFY_STOREFRONT_ACCESS_TOKEN: "test-token-not-a-credential",
  } });
  return { getCatalog: output.exports.getCatalog, query: () => requestedQuery };
}

const node = {
  id: "gid://shopify/Product/1", handle: "byob-tank", title: "BYOB Tank",
  productType: "Tank Tops", collections: { nodes: [{ handle: "byob", title: "BYOB" }, { handle: "frontpage", title: "Home page" }] },
  targetGender: { references: { nodes: [{ fields: [{ key: "label", value: "Unisex" }, { key: "taxonomy_reference", value: "gid://shopify/TaxonomyValue/20" }] }] } },
  description: "Cotton tank.", descriptionHtml: "<p>Cotton tank.</p>",
  featuredImage: null, images: { nodes: [] },
  priceRange: { minVariantPrice: { amount: "48", currencyCode: "USD" } },
  options: [{ name: "Size", values: ["M"] }], metafields: [],
  variants: { nodes: [{ id: "gid://shopify/ProductVariant/1", title: "M", availableForSale: true,
    selectedOptions: [{ name: "Size", value: "M" }], price: { amount: "48", currencyCode: "USD" } }] },
};

test("the live catalog adapter requests and maps Shopify collection membership and type", async () => {
  const api = shopifyAdapter(node);
  const result = await api.getCatalog();
  assert.equal(result.status, "ready");
  assert.match(api.query(), /\bproductType\b/);
  assert.match(api.query(), /collections\(first: 50\)\s*\{\s*nodes\s*\{\s*handle title\s*\}/);
  assert.equal(result.products[0].productType, "Tank Tops");
  assert.match(api.query(), /targetGender: metafield\(namespace: "shopify", key: "target-gender"\)/);
  assert.deepEqual(result.products[0].targetGenders, ["Unisex"]);
  assert.deepEqual(result.products[0].collections, node.collections.nodes);
  assert.equal(result.products[0].variants[0].id, node.variants.nodes[0].id);
});

test("older product responses without collection metadata remain usable", async () => {
  const legacyNode = { ...node };
  delete legacyNode.productType;
  delete legacyNode.collections;
  delete legacyNode.targetGender;
  const result = await shopifyAdapter(legacyNode).getCatalog();
  assert.equal(result.status, "ready");
  assert.equal(result.products[0].productType, "");
  assert.deepEqual(result.products[0].collections, []);
  assert.deepEqual(result.products[0].targetGenders, []);
});


test("fit taxonomy maps only authored labels and tolerates null or non-metaobject references", async () => {
  const result = await shopifyAdapter({ ...node, targetGender: { references: { nodes: [
    {}, { fields: [{ key: "label", value: "Male" }, { key: "label", value: "Male" }] },
    { fields: [{ key: "label", value: "Female" }, { key: "taxonomy_reference", value: "gid://shopify/TaxonomyValue/18" }] },
  ] } } }).getCatalog();
  assert.deepEqual(result.products[0].targetGenders, ["Male", "Female"]);
  assert.deepEqual((await shopifyAdapter({ ...node, targetGender: null }).getCatalog()).products[0].targetGenders, []);
});
