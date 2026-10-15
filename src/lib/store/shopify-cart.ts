import "server-only";
import { isSameOriginRequest } from "@/lib/request-origin";
import { getProducts, getShopifyStorefrontClient, resolvePublicCheckoutUrl, type CheckoutLine } from "@/lib/shopify";
import { validVisitorConsent, type VisitorConsent } from "@/lib/marketing/consent";

const MAX_BODY_BYTES = 16384;
const MAX_LINES = 25;
const MAX_QUANTITY = 20;
const VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const ALLOWED_LINE_FIELDS = new Set(["variantId", "quantity"]);
const SHOPIFY_COOKIES = new Set(["_shopify_essential", "_shopify_analytics", "_shopify_marketing", "_tracking_consent", "_shopify_y", "_shopify_s"]);
const CART_FIELDS = `id checkoutUrl lines(first: 250) {
  nodes { id quantity attributes { key value } merchandise { ... on ProductVariant { id } } }
  pageInfo { hasNextPage }
}`;
const CART_QUERY = `query RuinedCart($id: ID!, $visitorConsent: VisitorConsent) @inContext(visitorConsent: $visitorConsent) {
  cart(id: $id) { ${CART_FIELDS} }
}`;
const MUTATIONS = {
  cartCreate: `mutation RuinedCartCreate($lines: [CartLineInput!]!, $visitorConsent: VisitorConsent) @inContext(visitorConsent: $visitorConsent) {
    cartCreate(input: { lines: $lines })`,
  cartLinesAdd: `mutation RuinedCartAdd($cartId: ID!, $lines: [CartLineInput!]!, $visitorConsent: VisitorConsent) @inContext(visitorConsent: $visitorConsent) {
    cartLinesAdd(cartId: $cartId, lines: $lines)`,
  cartLinesUpdate: `mutation RuinedCartUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!, $visitorConsent: VisitorConsent) @inContext(visitorConsent: $visitorConsent) {
    cartLinesUpdate(cartId: $cartId, lines: $lines)`,
  cartLinesRemove: `mutation RuinedCartRemove($cartId: ID!, $lineIds: [ID!]!, $visitorConsent: VisitorConsent) @inContext(visitorConsent: $visitorConsent) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds)`,
};
type Attribute = { key: string; value: string };
type CartLine = { id: string; quantity: number; attributes: Attribute[]; merchandise: { id: string } };
type Cart = { id: string; checkoutUrl: string; lines: { nodes: CartLine[]; pageInfo: { hasNextPage: boolean } } };
type RequestBody = { lines?: unknown; visitorConsent?: unknown };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Shopify's token is opaque and may change format. The secret is only stored in
// the HttpOnly cookie; analytics receives the same GID with its query removed.
function cartIdentity(value: unknown): { full: string; publicId: string } | null {
  if (typeof value !== "string" || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "gid:" || url.host !== "shopify" || !/^\/Cart\/[^/]+$/.test(url.pathname)
      || url.username || url.password || url.hash || url.searchParams.size !== 1 || !url.searchParams.get("key")) return null;
    return { full: value, publicId: `gid://shopify${url.pathname}` };
  } catch { return null; }
}

function cookieName() { return process.env.NODE_ENV === "production" ? "__Host-ruined-shopify-cart" : "ruined-shopify-cart"; }
function savedCartId(request: Request): string | null {
  const values = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName()}=`));
  if (values.length !== 1) return null;
  try { return cartIdentity(decodeURIComponent(values[0].slice(cookieName().length + 1)))?.full ?? null; }
  catch { return null; }
}

async function boundedBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new Error("Invalid body");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid body");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("Invalid body"); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function requestedLines(value: unknown, checkout: boolean): Map<string, number> | null {
  if (!Array.isArray(value) || (checkout && !value.length) || value.length > MAX_LINES) return null;
  const requested = new Map<string, number>();
  for (const line of value) {
    if (!record(line) || Object.keys(line).some((field) => !ALLOWED_LINE_FIELDS.has(field))
      || typeof line.variantId !== "string" || !VARIANT_ID.test(line.variantId)
      || typeof line.quantity !== "number" || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) return null;
    const quantity = (requested.get(line.variantId) ?? 0) + line.quantity;
    if (quantity > MAX_QUANTITY) return null;
    requested.set(line.variantId, quantity);
  }
  return requested;
}

function attributesKey(attributes: Attribute[]): string {
  return JSON.stringify(attributes.map(({ key, value }) => [key, value]).sort(([a], [b]) => a.localeCompare(b)));
}
function readCart(value: unknown): Cart {
  if (!record(value) || !cartIdentity(value.id) || typeof value.checkoutUrl !== "string" || !record(value.lines)
    || !Array.isArray(value.lines.nodes) || value.lines.nodes.length > 250 || !record(value.lines.pageInfo)
    || value.lines.pageInfo.hasNextPage !== false) throw new Error("Invalid cart");
  const ids = new Set<string>();
  for (const line of value.lines.nodes) {
    if (!record(line) || typeof line.id !== "string" || !line.id || ids.has(line.id) || !Number.isInteger(line.quantity)
      || (line.quantity as number) < 1 || !record(line.merchandise) || typeof line.merchandise.id !== "string"
      || !Array.isArray(line.attributes) || !line.attributes.every((attribute) => record(attribute)
        && typeof attribute.key === "string" && typeof attribute.value === "string")) throw new Error("Invalid cart line");
    ids.add(line.id);
  }
  return value as Cart;
}

function allowedCookie(name: string, consent: VisitorConsent | undefined): boolean {
  return SHOPIFY_COOKIES.has(name) && (name === "_shopify_essential" || name === "_tracking_consent"
    || (name === "_shopify_marketing" ? consent?.marketing === true : consent?.analytics === true));
}
function storefrontHeaders(request: Request, consent: VisitorConsent | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  const gpc = request.headers.get("sec-gpc") === "1";
  if (gpc) headers["Sec-GPC"] = "1";
  const unique = request.headers.get("x-shopify-uniquetoken");
  const visit = request.headers.get("x-shopify-visittoken");
  const validToken = (value: string | null): value is string => Boolean(value && value.length <= 2048 && /^[\x21-\x7e]+$/.test(value));
  if (consent?.analytics === true && !gpc && validToken(unique) && validToken(visit)) {
    headers["X-Shopify-UniqueToken"] = unique;
    headers["X-Shopify-VisitToken"] = visit;
  }
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .filter((part) => part.length <= 4096 && allowedCookie(part.slice(0, part.indexOf("=")), consent));
  if (cookies.length) headers.Cookie = cookies.join("; ");
  return headers;
}

async function synchronizeCart(request: Request, lines: CheckoutLine[], visitorConsent: VisitorConsent | undefined) {
  const client = getShopifyStorefrontClient();
  if (!client) throw new Error("Shopify unavailable");
  const headers = storefrontHeaders(request, visitorConsent);
  const responseCookies = new Map<string, string>();
  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(20000)]);
  async function execute(document: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    deadline.throwIfAborted();
    // No automatic retry of mutations: a lost response can still have committed.
    const response = await client!.fetch(document, {
      variables: { ...variables, ...(visitorConsent ? { visitorConsent } : {}) }, headers, retries: 0, signal: deadline,
    });
    if (!response.ok) throw new Error("Shopify unavailable");
    for (const cookie of response.headers.getSetCookie()) {
      const name = cookie.slice(0, cookie.indexOf("="));
      // Consent cookies are opaque. Keep separate values and original attributes.
      if (allowedCookie(name, visitorConsent)) responseCookies.set(name, cookie);
    }
    const payload: unknown = await response.json();
    if (!record(payload) || payload.errors || !record(payload.data)) throw new Error("Shopify unavailable");
    return payload.data;
  }
  async function query(id: string): Promise<Cart | null> {
    const result = await execute(CART_QUERY, { id });
    if (result.cart === null) return null;
    const cart = readCart(result.cart);
    if (cart.id !== id) throw new Error("Cart changed");
    return cart;
  }
  async function mutate(name: keyof typeof MUTATIONS, variables: Record<string, unknown>): Promise<Cart> {
    const document = `${MUTATIONS[name]} { cart { ${CART_FIELDS} } userErrors { message } warnings { code } } }`;
    const result = (await execute(document, variables))[name];
    if (!record(result) || !Array.isArray(result.userErrors) || result.userErrors.length
      || !Array.isArray(result.warnings) || result.warnings.length) throw new Error("Cart was not saved");
    return readCart(result.cart);
  }
  const id = savedCartId(request);
  let cart = id ? await query(id) : null;
  if (!cart) {
    cart = await mutate("cartCreate", { lines: lines.map(({ variantId, quantity, attributes }) => ({ merchandiseId: variantId, quantity, attributes: attributes ?? [] })) });
  } else {
    const desired = new Map(lines.map((line) => [line.variantId, line]));
    const existing = new Map<string, CartLine>();
    const remove: string[] = [];
    for (const line of cart.lines.nodes) {
      if (!desired.has(line.merchandise.id) || existing.has(line.merchandise.id)) remove.push(line.id);
      else existing.set(line.merchandise.id, line);
    }
    // Shopify line IDs can change after a mutation. Every next operation uses
    // the cart returned by the previous one rather than stale line IDs.
    const cartId = cart.id;
    if (remove.length) cart = await mutate("cartLinesRemove", { cartId, lineIds: remove });
    if (cart.id !== cartId) throw new Error("Cart changed");
    const update = cart.lines.nodes.flatMap((current) => {
      const line = desired.get(current.merchandise.id);
      if (!line) return [];
      const attributes = line.attributes ?? [];
      return current.quantity !== line.quantity || attributesKey(current.attributes) !== attributesKey(attributes)
        ? [{ id: current.id, quantity: line.quantity, attributes }] : [];
    });
    if (update.length) cart = await mutate("cartLinesUpdate", { cartId, lines: update });
    if (cart.id !== cartId) throw new Error("Cart changed");
    const present = new Set(cart.lines.nodes.map((line) => line.merchandise.id));
    const add = lines.filter((line) => !present.has(line.variantId)).map((line) => ({
      merchandiseId: line.variantId, quantity: line.quantity, attributes: line.attributes ?? [],
    }));
    // Shopify has no transaction across mutations. A partial failure returns no
    // success; the next serialized desired snapshot reconciles committed work.
    if (add.length) cart = await mutate("cartLinesAdd", { cartId, lines: add });
    if (cart.id !== cartId) throw new Error("Cart changed");
  }
  // Re-read even after a successful mutation: Shopify can adjust quantities or
  // another tab can change this cart. Never report an unverified add/checkout.
  const verified = await query(cart.id);
  if (!verified || verified.lines.nodes.length !== lines.length) throw new Error("Cart changed");
  const desired = new Map(lines.map((line) => [line.variantId, line]));
  for (const line of verified.lines.nodes) {
    const expected = desired.get(line.merchandise.id);
    if (!expected || line.quantity !== expected.quantity || attributesKey(line.attributes) !== attributesKey(expected.attributes ?? [])) throw new Error("Cart changed");
    desired.delete(line.merchandise.id);
  }
  const identity = cartIdentity(verified.id)!;
  const checkoutUrl = resolvePublicCheckoutUrl(verified.checkoutUrl);
  if (!checkoutUrl || encodeURIComponent(identity.full).length > 3500) throw new Error("Invalid checkout");
  return { identity, checkoutUrl, responseCookies: [...responseCookies.values()] };
}

function error(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleShopifyCartRequest(request: Request, { checkout }: { checkout: boolean }): Promise<Response> {
  if (request.method !== "POST" || !isSameOriginRequest(request)
    || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) return error(403, "The bag request could not be verified.");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return error(415, "The bag could not be read.");
  let body: RequestBody;
  try {
    const value = await boundedBody(request);
    if (!record(value) || Object.keys(value).some((key) => !["lines", "visitorConsent"].includes(key)) || !validVisitorConsent(value.visitorConsent)) throw new Error("Invalid body");
    body = value;
  } catch { return error(400, "The bag or checkout preferences could not be read."); }
  const requested = requestedLines(body.lines, checkout);
  if (!requested) return error(400, "The bag is empty, too large, or contains an invalid piece.");
  try {
    const products = await getProducts();
    if (!products.length && requested.size) throw new Error("Catalogue unavailable");
    const catalogueVariants = new Map(products.flatMap((product) => product.variants.map((variant) => [variant.id, { product, variant }] as const)));
    const lines: CheckoutLine[] = [];
    for (const [variantId, quantity] of requested) {
      const catalogueLine = catalogueVariants.get(variantId);
      if (!catalogueLine?.variant.available) return error(400, "One of the selected pieces is unavailable.");
      const expectedShipDate = catalogueLine.product.expectedShipDate?.trim();
      lines.push({ variantId, quantity, ...(expectedShipDate ? { attributes: [
        { key: "Order type", value: "Preorder" }, { key: "Expected ship date", value: expectedShipDate },
      ] } : {}) });
    }
    // GPC overrides even an old/stale client preference. Shopping still works.
    const consent = request.headers.get("sec-gpc") === "1"
      ? { ...(body.visitorConsent as VisitorConsent | undefined), analytics: false, marketing: false, saleOfData: false }
      : body.visitorConsent as VisitorConsent | undefined;
    const result = await synchronizeCart(request, lines, consent);
    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const cookie of result.responseCookies) headers.append("Set-Cookie", cookie);
    headers.append("Set-Cookie", `${cookieName()}=${encodeURIComponent(result.identity.full)}; Path=/; Max-Age=259200; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return Response.json({ cartId: result.identity.publicId, checkoutUrl: result.checkoutUrl }, { headers });
  } catch { return error(503, "Checkout is temporarily unavailable. Your bag is still saved."); }
}
