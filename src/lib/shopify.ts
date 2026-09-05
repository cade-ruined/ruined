import "server-only";
import { createStorefrontApiClient } from "@shopify/storefront-api-client";
import {
  TONE_BY_HANDLE,
  TONE_CYCLE,
  type Product,
  type ProductOption,
  type ProductVariant,
  type ProductTone,
} from "@/data/products";
import { normalizeExpectedShipDateLanguage } from "@/lib/store/product-copy.js";

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
const publicCheckoutDomain = process.env.SHOPIFY_CHECKOUT_DOMAIN?.trim().toLowerCase();

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
        descriptionHtml
        featuredImage { url altText }
        images(first: 12) {
          nodes { url altText width height }
        }
        priceRange { minVariantPrice { amount currencyCode } }
        options { name values }
        variants(first: 100) {
          nodes {
            id
            title
            availableForSale
            selectedOptions { name value }
            price { amount currencyCode }
          }
        }
        metafields(identifiers: [
          { namespace: "custom", key: "code" }
          { namespace: "custom", key: "subtitle" }
          { namespace: "custom", key: "material" }
          { namespace: "custom", key: "origin" }
          { namespace: "custom", key: "care" }
          { namespace: "custom", key: "tone" }
          { namespace: "custom", key: "expected_ship_date" }
        ]) { key value }
      }
    }
  }
`;
const POLICIES_QUERY = `#graphql
  query Policies {
    shop {
      shippingPolicy { title body }
      refundPolicy { title body }
      termsOfService { title body }
    }
  }
`;
export type ShopifyPolicy = { title: string; body: string };

type ShopifyPolicies = {
  shipping: ShopifyPolicy | null;
  returns: ShopifyPolicy | null;
  terms: ShopifyPolicy | null;
};

const EMPTY_POLICIES: ShopifyPolicies = {
  shipping: null,
  returns: null,
  terms: null,
};

export async function getShopPolicies(): Promise<ShopifyPolicies> {
  if (!client) return EMPTY_POLICIES;

  try {
    const { data, errors } = await client.request<{
      shop: {
        shippingPolicy: ShopifyPolicy | null;
        refundPolicy: ShopifyPolicy | null;
        termsOfService: ShopifyPolicy | null;
      };
    }>(POLICIES_QUERY);

    if (errors) return EMPTY_POLICIES;

    return {
      shipping: data?.shop.shippingPolicy ?? null,
      returns: data?.shop.refundPolicy ?? null,
      terms: data?.shop.termsOfService ?? null,
    };
  } catch {
    return EMPTY_POLICIES;
  }
}

const CART_CREATE = `#graphql
  mutation CartCreate($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) {
      cart { checkoutUrl }
      userErrors { field message }
      warnings { code message target }
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
  descriptionHtml: string;
  featuredImage: { url: string; altText: string | null } | null;
  images: {
    nodes: {
      url: string;
      altText: string | null;
      width: number | null;
      height: number | null;
    }[];
  };
  priceRange: { minVariantPrice: SFMoney };
  options: { name: string; values: string[] }[];
  variants: {
    nodes: {
      id: string;
      title: string;
      availableForSale: boolean;
      selectedOptions: { name: string; value: string }[];
      price: SFMoney;
    }[];
  };
  metafields: SFMetafield[];
};
type SFProductsResponse = { products: { nodes: SFProductNode[] } };
type SFCartCreateResponse = {
  cartCreate: {
    cart: { checkoutUrl: string } | null;
    userErrors: { field: string[] | null; message: string }[];
    warnings: { code: string; message: string; target: string | null }[];
  };
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
  const expectedShipDate = meta.expected_ship_date || undefined;
  const images = (node.images?.nodes ?? []).map((image) => ({
    url: image.url,
    alt: image.altText ?? node.title,
    ...(image.width ? { width: image.width } : {}),
    ...(image.height ? { height: image.height } : {}),
  }));
  const featuredImage = node.featuredImage
    ? { url: node.featuredImage.url, alt: node.featuredImage.altText ?? node.title }
    : images[0];
  const variants: ProductVariant[] = node.variants.nodes.map((variant) => ({
    id: variant.id,
    title: variant.title,
    available: variant.availableForSale,
    selectedOptions: variant.selectedOptions,
    price: formatPrice(variant.price),
    priceAmount: variant.price.amount,
    currencyCode: variant.price.currencyCode,
  }));
  const options: ProductOption[] = (node.options ?? [])
    .filter(
      (option) =>
        !(option.name === "Title" && option.values.length === 1 && option.values[0] === "Default Title")
    )
    .map((option) => ({ name: option.name, values: option.values }));
  const defaultVariant = variants.find((variant) => variant.available) ?? variants[0];
  return {
    id: node.handle,
    shopifyProductGid: node.id,
    code: meta.code ?? `RU—${String(index + 1).padStart(3, "0")}`,
    name: node.title,
    subtitle: meta.subtitle ?? "",
    price: formatPrice(node.priceRange.minVariantPrice),
    description: normalizeExpectedShipDateLanguage(node.description, expectedShipDate),
    descriptionHtml: node.descriptionHtml,
    material: meta.material ?? "",
    origin: meta.origin ?? "",
    care: meta.care ?? "",
    tone: resolveTone(meta.tone, node.handle, index),
    image: featuredImage,
    images: images.length ? images : featuredImage ? [featuredImage] : [],
    options,
    variants,
    expectedShipDate,
    variantId: defaultVariant?.id,
    available: variants.some((variant) => variant.available),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * The full drop catalogue. Pulls live from Shopify when configured; otherwise
 * returns the local fallback. Safe to call from server components / route
 * handlers — pair with `export const revalidate = N` (ISR) on the page.
 */
export async function getProducts(): Promise<Product[]> {
  if (!client) return [];
  try {
    const { data, errors } = await client.request<SFProductsResponse>(
      PRODUCTS_QUERY,
      { variables: { first: 50 } }
    );
    const nodes = data?.products?.nodes;
    if (errors || !nodes?.length) return [];
    return nodes.map(mapProduct);
  } catch {
    // Network/credential issues should never blank the store.
    return [];
  }
}

/**
 * Creates a Shopify cart for a single variant and returns its hosted checkout
 * URL (Shopify owns payments/PCI/tax). Returns null if unconfigured or on error
 * so callers can degrade to an enquiry flow.
 */
export type CheckoutLine = {
  variantId: string;
  quantity: number;
  attributes?: { key: string; value: string }[];
};

const CHECKOUT_HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function resolvePublicCheckoutUrl(checkoutUrl: string): string | null {
  try {
    const url = new URL(checkoutUrl);
    if (url.protocol !== "https:") return null;
    if (!publicCheckoutDomain) return url.toString();
    if (!CHECKOUT_HOSTNAME.test(publicCheckoutDomain)) return null;
    url.hostname = publicCheckoutDomain;
    url.port = "";
    return url.toString();
  } catch {
    return null;
  }
}

export async function createCheckoutUrl(
  input: string | CheckoutLine[],
  quantity = 1
): Promise<string | null> {
  if (!client) return null;
  const lines: {
    merchandiseId: string;
    quantity: number;
    attributes?: { key: string; value: string }[];
  }[] =
    typeof input === "string"
      ? [{ merchandiseId: input, quantity }]
      : input.map((line) => ({
          merchandiseId: line.variantId,
          quantity: line.quantity,
          ...(line.attributes?.length ? { attributes: line.attributes } : {}),
        }));
  if (!lines.length) return null;
  try {
    const { data, errors } = await client.request<SFCartCreateResponse>(
      CART_CREATE,
      { variables: { lines } }
    );
    const result = data?.cartCreate;
    if (
      errors ||
      !result ||
      result.userErrors.length > 0 ||
      result.warnings.length > 0
    ) return null;
    return result.cart?.checkoutUrl
      ? resolvePublicCheckoutUrl(result.cart.checkoutUrl)
      : null;
  } catch {
    return null;
  }
}
