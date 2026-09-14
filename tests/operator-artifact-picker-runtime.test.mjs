import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const product = { id: "gid://shopify/Product/123", handle: "first-coin", title: "The First Coin", featuredImage: null };
class OpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function load(path, dependencies = {}, env = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "process", code)((name) => {
    if (name in dependencies) return dependencies[name];
    if (name === "server-only") return {};
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    throw Error(`Unexpected dependency ${name}`);
  }, mod, mod.exports, { env });
  return mod.exports;
}
const repositoryError = { "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: OpsError } };
const api = {
  opsJson: (body, status = 200) => Response.json(body, { status }),
  opsRepositoryErrorResponse: (error) => Response.json({ error: error.message }, { status: { forbidden: 403, invalid_request: 400, conflict: 409 }[error.code] ?? 500 }),
};
function verifier(role, lookup, trace = []) {
  return load("src/lib/platform/ops-artifact-products.ts", {
    ...repositoryError,
    "@/lib/platform/repository": { getOperatorRole: async () => { trace.push("authorization"); return role; } },
    "@/lib/shopify": { getArtifactShopifyProduct: async (id) => { trace.push("provider"); return lookup(id); } },
  });
}

test("Artifact selection authorizes before provider access and rejects malformed or stale identities", async () => {
  const trace = [];
  await assert.rejects(verifier("guide", () => product, trace).verifyArtifactShopifySelection("guide", product.id, product.handle), (error) => error.code === "forbidden");
  assert.deepEqual(trace, ["authorization"]);
  for (const [id, handle] of [["not-a-gid", product.handle], [product.id, ""], [product.id, {}]]) {
    const calls = [];
    await assert.rejects(verifier("ops_admin", () => product, calls).verifyArtifactShopifySelection("admin", id, handle), (error) => error.code === "invalid_request");
    assert.deepEqual(calls, ["authorization"]);
  }
  for (const returned of [null, { ...product, id: "gid://shopify/Product/999" }, { ...product, handle: "renamed-product" }]) {
    await assert.rejects(verifier("ops_admin", () => returned).verifyArtifactShopifySelection("admin", product.id, product.handle), (error) => error.code === "conflict");
  }
  const serviceError = Error("Provider unavailable");
  await assert.rejects(verifier("ops_admin", () => { throw serviceError; }).verifyArtifactShopifySelection("admin", product.id, product.handle), (error) => error === serviceError);
});

test("Artifact product search fails closed for signed-out, non-admin and oversized-query requests", async () => {
  for (const scenario of [{ viewer: null, role: null, q: "coin", status: 401 }, { viewer: { authUserId: "guide" }, role: "guide", q: "coin", status: 403 }, { viewer: { authUserId: "admin" }, role: "ops_admin", q: "a".repeat(101), status: 400 }]) {
    const calls = [];
    const route = load("app/api/ops/artifact-products/route.ts", {
      ...repositoryError,
      "@/lib/auth/session": { getCurrentPlatformViewer: async () => scenario.viewer },
      "@/lib/platform/ops-api": api,
      "@/lib/platform/ops-artifact-products": verifier(scenario.role, () => { throw Error("Unexpected verification"); }),
      "@/lib/shopify": { searchArtifactShopifyProducts: async () => { calls.push("provider"); return { products: [] }; } },
    });
    assert.equal((await route.GET(new Request(`https://example.test/api/ops/artifact-products?q=${scenario.q}`))).status, scenario.status);
    assert.deepEqual(calls, []);
  }
});

test("Artifact search distinguishes true empty results from provider failures", async () => {
  for (const fail of [false, true]) {
    const route = load("app/api/ops/artifact-products/route.ts", {
      ...repositoryError,
      "@/lib/auth/session": { getCurrentPlatformViewer: async () => ({ authUserId: "admin" }) },
      "@/lib/platform/ops-api": api,
      "@/lib/platform/ops-artifact-products": verifier("ops_admin", () => product),
      "@/lib/shopify": { searchArtifactShopifyProducts: async () => { if (fail) throw Error("Provider unavailable"); return { products: [], hasMore: false }; } },
    });
    const response = await route.GET(new Request("https://example.test/api/ops/artifact-products?q=coin"));
    assert.equal(response.status, fail ? 503 : 200);
    const body = await response.json();
    assert.equal("products" in body, !fail);
    if (fail) {
      assert.match(body.error, /could not be loaded/);
      assert.match(body.error, /system owner/);
      assert.doesNotMatch(body.error, /Settings/);
    }
  }
});

test("template create and rebinding verify selection before any repository write", async () => {
  for (const [path, method] of [["app/api/ops/artifact-templates/route.ts", "POST"], ["app/api/ops/artifact-templates/[templateId]/shopify/route.ts", "PATCH"]]) {
    for (const mode of ["denied", "stale", "valid"]) {
      const trace = [];
      const route = load(path, {
        ...repositoryError,
        "@/lib/platform/ops-api": { ...api, requireOpsMutationRequest: async () => mode === "denied" ? { response: Response.json({}, { status: 403 }) } : { viewer: { authUserId: "admin" } } },
        "@/lib/platform/ops-artifact-products": verifier("ops_admin", () => mode === "stale" ? null : product, trace),
        "@/lib/platform/ops-artifact-repository": {
          createOpsArtifactTemplate: async (input) => { trace.push("write"); assert.equal(input.productGid, product.id); return {}; },
          bindOpsArtifactTemplate: async (input) => { trace.push("write"); assert.equal(input.productHandle, product.handle); return {}; },
        },
      });
      const response = await route[method](new Request("https://example.test/api/ops/artifact-templates", { method, body: JSON.stringify({ productGid: product.id, productHandle: product.handle, livemode: true, name: "Coin", slug: "coin" }), headers: { "Content-Type": "application/json" } }), { params: Promise.resolve({ templateId: "template" }) });
      assert.equal(response.status, mode === "denied" ? 403 : mode === "stale" ? 409 : method === "POST" ? 201 : 200);
      assert.deepEqual(trace, mode === "denied" ? [] : mode === "stale" ? ["authorization", "provider"] : ["authorization", "provider", "write"]);
    }
  }
});

function shopify(response, calls = []) {
  return load("src/lib/shopify.ts", {
    "@shopify/storefront-api-client": { createStorefrontApiClient: () => ({ request: async (query, options) => { calls.push({ query, options }); return response; } }) },
    "@/data/products": {}, "@/lib/store/product-copy.js": {}, "@/lib/store/catalog-loader": {},
  }, { SHOPIFY_STORE_DOMAIN: "example.myshopify.com", SHOPIFY_STOREFRONT_ACCESS_TOKEN: "test-public-token" });
}
test("Shopify helper rejects errors and malformed responses, while preserving valid empty and unpublished results", async () => {
  for (const response of [{ errors: { message: "Denied" }, data: { products: { nodes: [], pageInfo: { hasNextPage: false } } } }, {}, { data: { products: { nodes: [] } } }, { data: { products: { nodes: [{}], pageInfo: { hasNextPage: false } } } }]) {
    await assert.rejects(shopify(response).searchArtifactShopifyProducts("coin"), /could not be loaded/);
  }
  const calls = [];
  assert.deepEqual(await shopify({ data: { products: { nodes: [], pageInfo: { hasNextPage: false } } } }, calls).searchArtifactShopifyProducts('Coin" OR tag:secret'), { products: [], hasMore: false });
  assert.equal(calls[0].options.variables.query, "title:Coin* AND title:OR* AND title:tag* AND title:secret*");
  assert.equal(await shopify({ data: { product: null } }).getArtifactShopifyProduct(product.id), null);
  assert.deepEqual(await shopify({ data: { product } }).getArtifactShopifyProduct(product.id), product);
  for (const response of [{}, { errors: {}, data: { product: null } }, { data: { product: {} } }]) await assert.rejects(shopify(response).getArtifactShopifyProduct(product.id), /could not be verified/);
});

function nodes(node) { return !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
function text(node) { return node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node); }
function picker(props = {}) {
  const slots = []; let cursor = 0;
  const hooks = { ...React, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value) => { slots[i] = value; }]; }, useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; } };
  const current = { selected: null, disabled: false, preview: false, onSelect: (selected) => { current.selected = selected; }, ...props };
  const Component = load("src/components/platform/OperatorArtifactProductPicker.tsx", { react: hooks, "next/image": { __esModule: true, default: () => null }, "@/components/platform/operatorStyles": new Proxy({}, { get: () => "control" }) }).default;
  const draw = () => { cursor = 0; return Component(current); };
  const button = (label) => { const result = nodes(draw()).find((node) => node.type === "button" && text(node) === label); assert.ok(result, label); return result; };
  return { draw, button, current };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("Artifact picker preview and disabled states never access the network", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => { calls.push(url); throw Error("Unexpected network"); });
  const preview = picker({ preview: true });
  preview.button("Find products").props.onClick(); await tick();
  assert.match(text(preview.draw()), /Example product only/);
  preview.button("The First Coin (example)Select →").props.onClick();
  assert.equal(preview.current.selected.handle, "the-first-coin");
  const disabled = picker({ disabled: true });
  disabled.button("Find products").props.onClick(); await tick();
  assert.deepEqual(calls, []);
});

test("Artifact picker Enter searches without submitting parent form; selection binds exact identity and can be changed", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => { calls.push(url); return Response.json({ products: [product], hasMore: false }); });
  const f = picker();
  nodes(f.draw()).find((node) => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "First Coin" } });
  let prevented = false;
  nodes(f.draw()).find((node) => node.type === "input" && node.props.type === "search").props.onKeyDown({ key: "Enter", preventDefault() { prevented = true; } });
  await tick();
  assert.equal(prevented, true);
  assert.deepEqual(calls, ["/api/ops/artifact-products?q=First%20Coin"]);
  assert.equal(nodes(f.draw()).some((node) => node.type === "form"), false);
  f.button("The First CoinSelect →").props.onClick();
  assert.deepEqual(f.current.selected, product);
  const hidden = Object.fromEntries(nodes(f.draw()).filter((node) => node.type === "input" && node.props.type === "hidden").map((node) => [node.props.name, node.props.value]));
  assert.deepEqual(hidden, { productGid: product.id, productHandle: product.handle });
  f.button("Change product").props.onClick();
  assert.equal(f.current.selected, null);
});

test("Artifact picker visibly reports provider failure instead of showing a false empty catalog", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Store connection unavailable" }, { status: 503 }));
  const f = picker();
  f.button("Find products").props.onClick(); await tick();
  assert.match(text(f.draw()), /Store connection unavailable/);
  assert.doesNotMatch(text(f.draw()), /No matching published products/);
  assert.ok(nodes(f.draw()).some((node) => node.props?.role === "alert"));
  assert.equal(f.draw().props.disabled, false);
});
