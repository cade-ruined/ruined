import "server-only";
import { createStorefrontApiClient } from "@shopify/storefront-api-client";
import {
  PRODUCTS,
  TONE_BY_HANDLE,
  TONE_CYCLE,
  type Product,
  type ProductTone,
} from "@/data/products";

// ─── Storefront API client ──────────────────────────────────────────────────
// Server-only (this module imports `server-only`, so it can never be bundled
// into a client component). Configure via env:
//
//   SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
//   SHOPIFY_STOREFRONT_ACCESS_TOKEN=...          (public Storefront token)
//   SHOPIFY_API_VERSION=2024-10                  (optional)
//
// With no creds the helpers gracefully fall back to the local catalogue so the
// app builds and renders everywhere (CI, previews, first clone).

const domain = process.env.SHOPIFY_STORE_DOMAIN;
const publicAccessToken = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const apiVersion = process.env.SHOPIFY_API_VERSION ?? "2026-07";

export const isShopifyConfigured = Boolean(domain && publicAccessToken);

const client = isShopifyConfigured
  ? createStorefrontApiClient({
      storeDomain: domain!,
      apiVersion,
      publicAccessToken: publicAccessToken!,
    })
  : null;

// ─── GraphQL ────────────────────────────────────────────────────────────────

const PRODUCTS_QUERY = `#graphql
  query Products($first: Int!) {
    products(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        handle
        title
        description
        featuredImage { url altText }
        priceRange { minVariantPrice { amount currencyCode } }
        variants(first: 1) { nodes { id availableForSale } }
        metafields(identifiers: [
          { namespace: "custom", key: "code" }
          { namespace: "custom", key: "subtitle" }
          { namespace: "custom", key: "material" }
          { namespace: "custom", key: "origin" }
          { namespace: "custom", key: "care" }
          { namespace: "custom", key: "tone" }
        ]) { key value }
      }
    }
  }
`;

const CART_CREATE = `#graphql
  mutation CartCreate($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) {
      cart { checkoutUrl }
      userErrors { field message }
    }
  }
`;

type SFMoney = { amount: string; currencyCode: string };
type SFMetafield = { key: string; value: string } | null;
type SFProductNode = {
  id: string;
  handle: string;
  title: string;
  description: string;
  featuredImage: { url: string; altText: string | null } | null;
  priceRange: { minVariantPrice: SFMoney };
  variants: { nodes: { id: string; availableForSale: boolean }[] };
  metafields: SFMetafield[];
};
type SFProductsResponse = { products: { nodes: SFProductNode[] } };
type SFCartCreateResponse = {
  cartCreate: { cart: { checkoutUrl: string } | null };
};

// ─── Mapping (Shopify → our Product) ─────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
};

function formatPrice({ amount, currencyCode }: SFMoney): string {
  const symbol = CURRENCY_SYMBOLS[currencyCode] ?? `${currencyCode} `;
  const value = Math.round(Number(amount));
  return `${symbol} ${value.toLocaleString("en-GB")}`;
}

function toMetaMap(metafields: SFMetafield[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const field of metafields ?? []) {
    if (field?.key && field.value) map[field.key] = field.value;
  }
  return map;
}

function resolveTone(metaTone: string | undefined, handle: string, index: number): ProductTone {
  if (metaTone === "warm" || metaTone === "shadow" || metaTone === "atelier") {
    return metaTone;
  }
  return TONE_BY_HANDLE[handle] ?? TONE_CYCLE[index % TONE_CYCLE.length];
}

function mapProduct(node: SFProductNode, index: number): Product {
  const meta = toMetaMap(node.metafields);
  const variant = node.variants.nodes[0];
  return {
    id: node.handle,
    code: meta.code ?? `RU—${String(index + 1).padStart(3, "0")}`,
    name: node.title,
    subtitle: meta.subtitle ?? "",
    price: formatPrice(node.priceRange.minVariantPrice),
    description: node.description,
    material: meta.material ?? "",
    origin: meta.origin ?? "",
    care: meta.care ?? "",
    tone: resolveTone(meta.tone, node.handle, index),
    image: node.featuredImage
      ? { url: node.featuredImage.url, alt: node.featuredImage.altText ?? node.title }
      : undefined,
    variantId: variant?.id,
    available: variant?.availableForSale ?? false,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * The full drop catalogue. Pulls live from Shopify when configured; otherwise
 * returns the local fallback. Safe to call from server components / route
 * handlers — pair with `export const revalidate = N` (ISR) on the page.
 */
export async function getProducts(): Promise<Product[]> {
  if (!client) return PRODUCTS;
  try {
    const { data, errors } = await client.request<SFProductsResponse>(
      PRODUCTS_QUERY,
      { variables: { first: 50 } }
    );
    const nodes = data?.products?.nodes;
    if (errors || !nodes?.length) return PRODUCTS;
    return nodes.map(mapProduct);
  } catch {
    // Network/credential issues should never blank the store.
    return PRODUCTS;
  }
}

/**
 * Creates a Shopify cart for a single variant and returns its hosted checkout
 * URL (Shopify owns payments/PCI/tax). Returns null if unconfigured or on error
 * so callers can degrade to an enquiry flow.
 */
export async function createCheckoutUrl(
  variantId: string,
  quantity = 1
): Promise<string | null> {
  if (!client) return null;
  try {
    const { data, errors } = await client.request<SFCartCreateResponse>(
      CART_CREATE,
      { variables: { lines: [{ merchandiseId: variantId, quantity }] } }
    );
    if (errors) return null;
    return data?.cartCreate?.cart?.checkoutUrl ?? null;
  } catch {
    return null;
  }
}
