import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { parse } from "graphql";

function load(path, dependencies = {}, environment = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", "process", code)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, output, output.exports, { env: environment });
  return output.exports;
}
const consent = load("src/lib/marketing/consent.ts");
const requestOrigin = load("src/lib/request-origin.ts");
const variant = (id) => `gid://shopify/ProductVariant/${id}`;
const fullCartId = "gid://shopify/Cart/opaque-token?key=private-capability";
const cartCookie = `__Host-ruined-shopify-cart=${encodeURIComponent(fullCartId)}`;
const clone = (value) => structuredClone(value);
function request(lines = [{ variantId: variant(1), quantity: 1 }], extra = {}, headers = {}) {
  return new Request("https://theruinedproject.com/api/store/cart", { method: "POST", headers: {
    origin: "https://theruinedproject.com", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers,
  }, body: JSON.stringify({ lines, ...extra }) });
}
function fixture(options = {}) {
  let cart = options.cart === undefined ? null : clone(options.cart);
  let serial = 0;
  const calls = [];
  const products = options.products ?? [
    { variants: [{ id: variant(1), available: true }, { id: variant(2), available: true }, { id: variant(3), available: false }] },
    { expectedShipDate: " November 2026 ", variants: [{ id: variant(4), available: true }] },
  ];
  const newLine = (line) => ({ id: `gid://shopify/CartLine/${++serial}`, quantity: line.quantity, attributes: line.attributes ?? [], merchandise: { id: line.merchandiseId } });
  const fetch = async (document, { variables, headers, ...rest }) => {
    parse(document); // Exercise actual generated GraphQL documents, not a parallel query.
    calls.push({ document, variables: clone(variables), headers: clone(headers), ...rest });
    const operation = document.match(/\b(cartCreate|cartLinesAdd|cartLinesUpdate|cartLinesRemove)\(/)?.[1];
    if (options.before) await options.before({ operation, cart, calls });
    if (options.networkError) throw new Error("secret upstream failure");
    let payload;
    if (!operation) {
      if (options.queryError) return Response.json({ errors: [{ message: "secret upstream failure" }] });
      const result = clone(cart);
      if (options.finalMismatch && result && calls.length > 1) result.lines.nodes[0].quantity = 19;
      payload = { data: { cart: result } };
    } else {
      if (operation === "cartCreate") cart = { id: fullCartId, checkoutUrl: "https://fixture.myshopify.com/checkouts/cn/token?_cs=signed%2Bconsent", lines: { nodes: variables.lines.map(newLine), pageInfo: { hasNextPage: false } } };
      if (operation === "cartLinesRemove") {
        cart.lines.nodes = cart.lines.nodes.filter((line) => !variables.lineIds.includes(line.id));
        if (options.rotateLineIds) cart.lines.nodes.forEach((line) => { line.id += "-changed"; });
      }
      if (operation === "cartLinesUpdate") for (const update of variables.lines) Object.assign(cart.lines.nodes.find((line) => line.id === update.id), update);
      if (operation === "cartLinesAdd") cart.lines.nodes.push(...variables.lines.map(newLine));
      payload = { data: { [operation]: { cart: clone(cart), userErrors: operation === options.userError ? [{ message: "private error" }] : [], warnings: operation === options.warning ? [{ code: "MERCHANDISE_NOT_ENOUGH_STOCK" }] : [] } } };
    }
    const responseHeaders = new Headers();
    for (const cookie of options.setCookies ?? []) responseHeaders.append("set-cookie", cookie);
    return Response.json(payload, { headers: responseHeaders });
  };
  const api = load("src/lib/store/shopify-cart.ts", {
    "server-only": {}, "@/lib/marketing/consent": consent, "@/lib/request-origin": requestOrigin,
    "@/lib/shopify": { getProducts: async () => products, getShopifyStorefrontClient: () => options.unconfigured ? null : { fetch },
      resolvePublicCheckoutUrl: (value) => { const url = new URL(value); if (url.protocol !== "https:") return null; url.hostname = "checkout.theruinedproject.com"; return url.toString(); } },
  }, { NODE_ENV: "production" });
  return { calls, current: () => clone(cart), handle: (request_, checkout = false) => api.handleShopifyCartRequest(request_, { checkout }), api };
}
function existing(lines) {
  return { id: fullCartId, checkoutUrl: "https://fixture.myshopify.com/checkouts/cn/token?_cs=signed%2Bconsent", lines: {
    nodes: lines.map((line, index) => ({ id: `gid://shopify/CartLine/existing-${index}`, quantity: line.quantity, attributes: line.attributes ?? [], merchandise: { id: line.variantId } })), pageInfo: { hasNextPage: false },
  } };
}

test("cart creation verifies contents, owns preorder attributes and keeps capability in secure host-only HttpOnly cookie", async () => {
  const f = fixture();
  const response = await f.handle(request([{ variantId: variant(4), quantity: 2 }], { visitorConsent: { analytics: true, marketing: false } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.cartId, "gid://shopify/Cart/opaque-token");
  assert.equal(new URL(body.checkoutUrl).searchParams.get("_cs"), "signed+consent");
  assert.equal(new URL(body.checkoutUrl).hostname, "checkout.theruinedproject.com");
  assert.doesNotMatch(JSON.stringify(body), /private-capability/);
  const cookie = response.headers.getSetCookie().at(-1);
  assert.match(cookie, /^__Host-ruined-shopify-cart=/);
  assert.match(cookie, /Path=\/; Max-Age=259200; HttpOnly; SameSite=Lax; Secure$/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].variables.id, fullCartId);
  assert.deepEqual(f.calls[0].variables.lines, [{ merchandiseId: variant(4), quantity: 2, attributes: [{ key: "Order type", value: "Preorder" }, { key: "Expected ship date", value: "November 2026" }] }]);
  assert.ok(f.calls.every((call) => call.retries === 0 && call.signal instanceof AbortSignal));
});

test("existing cart reconciles removals, duplicate lines, quantity and stale attributes, then adds and reuses same cart for checkout", async () => {
  const f = fixture({ rotateLineIds: true, cart: existing([
    { variantId: variant(1), quantity: 1, attributes: [{ key: "Untrusted", value: "stale" }] },
    { variantId: variant(1), quantity: 2 }, { variantId: variant(2), quantity: 1 },
  ]) });
  const desired = [{ variantId: variant(1), quantity: 3 }, { variantId: variant(4), quantity: 2 }];
  const response = await f.handle(request(desired, {}, { cookie: cartCookie }), true);
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.map((call) => call.document.match(/(?:query|mutation) (\w+)/)[1]), ["RuinedCart", "RuinedCartRemove", "RuinedCartUpdate", "RuinedCartAdd", "RuinedCart"]);
  assert.deepEqual(f.calls[2].variables.lines[0].attributes, []);
  assert.match(f.calls[2].variables.lines[0].id, /-changed$/, "updates use post-removal line IDs");
  assert.equal(f.current().id, fullCartId);
  assert.equal(f.current().lines.nodes.length, 2);
  const again = await f.handle(request(desired, {}, { cookie: cartCookie }), true);
  assert.equal(again.status, 200);
  assert.equal(f.calls.length, 7, "unchanged checkout only queries existing cart");
});

test("cart can clear an existing bag but checkout rejects empty bags before Shopify", async () => {
  const f = fixture({ cart: existing([{ variantId: variant(1), quantity: 2 }]) });
  assert.equal((await f.handle(request([]), true)).status, 400);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.handle(request([], {}, { cookie: cartCookie }))).status, 200);
  assert.equal(f.current().lines.nodes.length, 0);
});

test("expired or invalid cart cookie creates fresh cart; failed existing-cart reads never create duplicates", async () => {
  for (const cookie of [cartCookie, "__Host-ruined-shopify-cart=%malformed", `__Host-ruined-shopify-cart=${encodeURIComponent("gid://shopify/Cart/token")}`]) {
    const f = fixture();
    assert.equal((await f.handle(request(undefined, {}, { cookie }))).status, 200);
    assert.ok(f.calls.some((call) => call.document.includes("cartCreate(")));
  }
  const f = fixture({ queryError: true });
  const response = await f.handle(request(undefined, {}, { cookie: cartCookie }));
  assert.equal(response.status, 503);
  assert.equal(f.calls.length, 1);
  assert.doesNotMatch(await response.text(), /private|secret|capability/);
});

test("partial mutation failures and final mismatches return no success, checkout URL or capability cookie; retry heals snapshot", async () => {
  for (const options of [{ warning: "cartCreate" }, { userError: "cartCreate" }, { finalMismatch: true }, { networkError: true }, { unconfigured: true }]) {
    const f = fixture(options);
    const response = await f.handle(request());
    assert.equal(response.status, 503);
    assert.equal(response.headers.getSetCookie().length, 0);
    assert.deepEqual(Object.keys(await response.json()), ["error"]);
  }
  const options = { cart: existing([{ variantId: variant(1), quantity: 2 }, { variantId: variant(2), quantity: 1 }]), userError: "cartLinesUpdate" };
  const f = fixture(options);
  const desired = [{ variantId: variant(1), quantity: 3 }, { variantId: variant(4), quantity: 1 }];
  assert.equal((await f.handle(request(desired, {}, { cookie: cartCookie }))).status, 503);
  assert.equal(f.current().lines.nodes.length, 1, "earlier removal may have committed");
  delete options.userError;
  assert.equal((await f.handle(request(desired, {}, { cookie: cartCookie }))).status, 200);
  assert.equal(f.current().lines.nodes.length, 2);
});

test("strict request boundary rejects cross-origin, private fields, noninteger/overflow quantities and forged preorder data before upstream", async () => {
  const f = fixture();
  const invalid = [
    request(undefined, { cartId: fullCartId }), request(undefined, { buyerIdentity: { email: "private@example.com" } }),
    request(undefined, { visitorConsent: { analytics: "yes" } }), request(undefined, { visitorConsent: null }),
    request([{ variantId: variant(1), quantity: 1, attributes: [] }]), request([{ variantId: variant(1), quantity: 1.1 }]),
    request([{ variantId: variant(1), quantity: 0 }]), request([{ variantId: variant(1), quantity: 21 }]),
    request([{ variantId: variant(1), quantity: 20 }, { variantId: variant(1), quantity: 1 }]),
    request([{ variantId: "gid://shopify/Product/1", quantity: 1 }]), request(Array.from({ length: 26 }, () => ({ variantId: variant(1), quantity: 1 }))),
    request([{ variantId: variant(3), quantity: 1 }]), request([{ variantId: variant(999), quantity: 1 }]),
  ];
  for (const req of invalid) assert.equal((await f.handle(req)).status, 400);
  for (const headers of [{ origin: "https://attacker.example" }, { origin: "https://members.theruinedproject.com" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal((await f.handle(request(undefined, {}, headers))).status, 403);
  }
  const missingOrigin = request(); missingOrigin.headers.delete("origin");
  assert.equal((await f.handle(missingOrigin)).status, 403);
  assert.equal((await f.handle(request(undefined, {}, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await f.handle(request(undefined, { padding: "a".repeat(17000) }))).status, 400);
  assert.equal(f.calls.length, 0);
});

test("consent-gated token/cookie forwarding excludes application credentials and GPC overrides stale consent without blocking purchase", async () => {
  for (const choice of [undefined, { analytics: false, marketing: false }, { analytics: true, marketing: false }]) {
    const f = fixture({ setCookies: ["_shopify_essential=opaque; HttpOnly; Secure", "_shopify_analytics=next; Secure", "session=private; HttpOnly"] });
    const response = await f.handle(request(undefined, { visitorConsent: choice }, {
      "x-shopify-uniquetoken": "unique", "x-shopify-visittoken": "visit", authorization: "Bearer secret",
      cookie: "session=secret; sb-auth=private; _shopify_essential=opaque; _shopify_analytics=analytics; _shopify_marketing=marketing; _tracking_consent=choice",
      "shopify-storefront-buyer-ip": "1.2.3.4", referer: "https://theruinedproject.com/my?token=private",
    }), true);
    assert.equal(response.status, 200);
    for (const call of f.calls) {
      assert.equal(call.headers["X-Shopify-UniqueToken"], choice?.analytics ? "unique" : undefined);
      assert.equal(call.headers["X-Shopify-VisitToken"], choice?.analytics ? "visit" : undefined);
      assert.doesNotMatch(JSON.stringify(call.headers), /secret|private|1\.2\.3\.4|marketing/);
      assert.match(call.headers.Cookie, /_shopify_essential=opaque/);
      assert.equal(call.headers.Cookie.includes("_shopify_analytics"), choice?.analytics === true);
      assert.deepEqual(call.variables.visitorConsent, choice);
    }
    assert.ok(!response.headers.getSetCookie().some((cookie) => cookie.startsWith("session=")));
    assert.equal(response.headers.getSetCookie().some((cookie) => cookie.startsWith("_shopify_analytics=")), choice?.analytics === true);
  }
  const f = fixture();
  assert.equal((await f.handle(request(undefined, { visitorConsent: { analytics: true, marketing: true, saleOfData: true } }, {
    "sec-gpc": "1", "x-shopify-uniquetoken": "unique", "x-shopify-visittoken": "visit", cookie: "_shopify_analytics=denied; _shopify_marketing=denied",
  }), true)).status, 200);
  for (const call of f.calls) {
    assert.deepEqual(call.variables.visitorConsent, { analytics: false, marketing: false, saleOfData: false });
    assert.deepEqual(call.headers, { "Sec-GPC": "1" });
  }
});

test("tracking headers require both safe tokens and malformed/truncated upstream carts fail closed", async () => {
  for (const headers of [{ "x-shopify-uniquetoken": "unique" }, { "x-shopify-uniquetoken": "two tokens", "x-shopify-visittoken": "visit" }, { "x-shopify-uniquetoken": "a".repeat(2049), "x-shopify-visittoken": "visit" }]) {
    const f = fixture();
    assert.equal((await f.handle(request(undefined, { visitorConsent: { analytics: true } }, headers))).status, 200);
    assert.ok(f.calls.every((call) => !call.headers["X-Shopify-UniqueToken"] && !call.headers["X-Shopify-VisitToken"]));
  }
  for (const mutate of [
    (cart) => { cart.lines.pageInfo.hasNextPage = true; }, (cart) => { cart.lines.nodes[0].attributes = null; },
    (cart) => { cart.lines.nodes.push(clone(cart.lines.nodes[0])); }, (cart) => { cart.id = "gid://shopify/Cart/other?key=other"; },
  ]) {
    const cart = existing([{ variantId: variant(1), quantity: 1 }]); mutate(cart);
    const f = fixture({ cart });
    assert.equal((await f.handle(request(undefined, {}, { cookie: cartCookie }))).status, 503);
    assert.equal(f.calls.length, 1);
  }
});

test("both routes call the same cart boundary with distinct empty-bag policies", async () => {
  for (const [routeName, checkout] of [["cart", false], ["checkout", true]]) {
    const received = [];
    const route = load(`app/api/store/${routeName}/route.ts`, { "@/lib/store/shopify-cart": { handleShopifyCartRequest: async (...args) => { received.push(args); return new Response("ok"); } } });
    const req = request();
    assert.equal((await route.POST(req)).status, 200);
    assert.equal(received[0][0], req);
    assert.deepEqual(received[0][1], { checkout });
  }
});


test("a disconnected cart client cannot continue with later snapshot mutations", async () => {
  const controller = new AbortController();
  const f = fixture({ cart: existing([{ variantId: variant(1), quantity: 1 }]), before: () => controller.abort() });
  const original = request([{ variantId: variant(1), quantity: 2 }], {}, { cookie: cartCookie });
  const req = new Request(original, { signal: controller.signal });
  const response = await f.handle(req);
  assert.equal(response.status, 503);
  assert.equal(f.calls.length, 1);
  assert.equal(f.current().lines.nodes[0].quantity, 1);
  assert.equal(response.headers.getSetCookie().length, 0);
});


test("cart uses actual Host through Next's internal hostname without trusting forwarded hosts", async () => {
  const valid = fixture();
  const loopback = new Request("http://localhost:3327/api/store/cart", {
    method: "POST", headers: { origin: "http://127.0.0.1:3327", host: "127.0.0.1:3327", "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ lines: [{ variantId: variant(1), quantity: 1 }] }),
  });
  assert.equal((await valid.handle(loopback)).status, 200);
  assert.equal(valid.calls.length, 2);

  const invalid = fixture();
  for (const headers of [
    { host: "members.theruinedproject.com" },
    { host: "theruinedproject.com:444" },
    { host: "attacker.example", "x-forwarded-host": "theruinedproject.com" },
    { host: "theruinedproject.com/path" },
    { host: "theruinedproject.com@attacker.example" },
    { origin: "https://theruinedproject.com/path" },
    { origin: "https://person@theruinedproject.com" },
    { origin: "http://theruinedproject.com", host: "theruinedproject.com" },
  ]) assert.equal((await invalid.handle(request(undefined, {}, headers))).status, 403);
  assert.equal(invalid.calls.length, 0);
});
