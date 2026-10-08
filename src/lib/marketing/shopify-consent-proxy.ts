import "server-only";
import { Kind, parse, print, visit, type FieldNode, type SelectionSetNode } from "graphql";

const MAX_BODY_BYTES = 8192;
const COOKIE_NAMES = new Set(["_shopify_essential", "_shopify_analytics", "_shopify_marketing", "_tracking_consent", "_shopify_y", "_shopify_s"]);
const CONSENT_FIELDS = new Set(["marketing", "analytics", "preferences", "saleOfData"]);
const COOKIE_FIELDS = new Set(["trackingConsentCookie", "cookieDomain", "landingPageCookie", "origReferrerCookie", "shopifyUnique", "shopifyVisit"]);

function fields(selection: SelectionSetNode | undefined): readonly FieldNode[] {
  if (!selection?.selections.length) throw new Error("Missing fields");
  const names = new Set<string>();
  return selection.selections.map((node) => {
    if (node.kind !== Kind.FIELD || node.alias || node.directives?.length || names.has(node.name.value)) throw new Error("Invalid field");
    names.add(node.name.value);
    return node;
  });
}

/** Only the SDK's consent query family is accepted, never arbitrary Storefront operations. */
export function consentQuery(body: unknown): string | null {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some((key) => !["query", "variables"].includes(key)) || typeof input.query !== "string") return null;
    if (input.variables !== undefined && (!input.variables || typeof input.variables !== "object" || Array.isArray(input.variables) || Object.keys(input.variables).length)) return null;
    const document = parse(input.query, { maxTokens: 250 });
    const operation = document.definitions[0];
    if (document.definitions.length !== 1 || operation.kind !== Kind.OPERATION_DEFINITION || operation.operation !== "query"
      || operation.variableDefinitions?.length || operation.directives?.length) return null;
    const roots = fields(operation.selectionSet);
    const root = roots[0];
    if (roots.length !== 1 || root.name.value !== "consentManagement" || root.arguments?.length) return null;
    const selections = fields(root.selectionSet);
    if (!selections.some((field) => field.name.value === "cookies")) return null;
    for (const field of selections) {
      if (field.name.value === "customerAccountUrl") {
        if (field.arguments?.length || field.selectionSet) return null;
        continue;
      }
      if (field.name.value !== "cookies") return null;
      const arguments_ = field.arguments ?? [];
      const argumentNames = new Set<string>();
      for (const argument of arguments_) {
        const name = argument.name.value;
        if (argumentNames.has(name)) return null;
        argumentNames.add(name);
        if (name === "visitorConsent") {
          if (argument.value.kind !== Kind.OBJECT) return null;
          const choices = new Set<string>();
          for (const choice of argument.value.fields) {
            if (!CONSENT_FIELDS.has(choice.name.value) || choices.has(choice.name.value) || choice.value.kind !== Kind.BOOLEAN) return null;
            choices.add(choice.name.value);
          }
        } else if (!["origReferrer", "landingPage"].includes(name) || argument.value.kind !== Kind.STRING || argument.value.value.length > 4096) return null;
      }
      if (!argumentNames.has("visitorConsent")) return null;
      for (const selected of fields(field.selectionSet)) {
        if (!COOKIE_FIELDS.has(selected.name.value) || selected.arguments?.length || selected.selectionSet) return null;
      }
    }
    return print(visit(document, { Argument(node) {
      if (!["origReferrer", "landingPage"].includes(node.name.value) || node.value.kind !== Kind.STRING) return;
      let value = "";
      try {
        const relativeLanding = node.name.value === "landingPage" && node.value.value.startsWith("/") && !node.value.value.startsWith("//");
        const url = relativeLanding ? new URL(node.value.value, "https://theruinedproject.com") : new URL(node.value.value);
        if (url.protocol === "https:" || url.protocol === "http:") {
          const publicPath = /^\/(?:store(?:\/[a-z0-9][a-z0-9-]*)?|bag)?\/?$/.test(url.pathname);
          value = `${relativeLanding ? "" : url.origin}${node.name.value === "landingPage" && publicPath ? url.pathname : "/"}`;
        }
      } catch { /* No private or malformed URL metadata is sent upstream. */ }
      return { ...node, value: { ...node.value, value } };
    } }));
  } catch { return null; }
}

async function boundedBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new Error("Body too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("Body too large"); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function error(status: number) {
  return Response.json({ errors: [{ message: "Cookie preferences are unavailable." }] }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function proxyShopifyConsent(request: Request, environment: Record<string, string | undefined>, upstreamFetch: typeof fetch = fetch): Promise<Response> {
  const origin = new URL(request.url).origin;
  // Same-site sibling domains are not same-origin. This endpoint can change consent.
  if (request.method !== "POST" || request.headers.get("origin") !== origin
    || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) return error(403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return error(415);
  const domain = environment.SHOPIFY_STORE_DOMAIN?.trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/$/, "");
  const token = environment.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim();
  if (environment.META_TRACKING_ENABLED !== "true" || !domain || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) || !token || !/^[a-f0-9]{32}$/i.test(token)) return error(503);
  let query: string | null;
  try { query = consentQuery(await boundedBody(request)); } catch { return error(400); }
  if (!query) return error(400);
  const headers = new Headers({ "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": token });
  for (const name of ["accept", "accept-language", "origin", "user-agent", "x-shopify-uniquetoken", "x-shopify-visittoken"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("referer", `${origin}/`);
  if (request.headers.get("shopify-storefront-consent-management") === "1") headers.set("Shopify-Storefront-Consent-Management", "1");
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .filter((part) => COOKIE_NAMES.has(part.slice(0, part.indexOf("="))));
  if (cookies.length) headers.set("cookie", cookies.join("; "));
  try {
    const upstream = await upstreamFetch(`https://${domain}/api/unstable/graphql.json`, {
      method: "POST", headers, body: JSON.stringify({ query, variables: {} }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    });
    const responseHeaders = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
    // Preserve each opaque Shopify cookie, including deletion/expiry attributes.
    // Never forward application/auth cookies or rewrite the Shopify Domain.
    for (const cookie of upstream.headers.getSetCookie()) {
      if (COOKIE_NAMES.has(cookie.slice(0, cookie.indexOf("=")))) responseHeaders.append("Set-Cookie", cookie);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch { return error(502); }
}
