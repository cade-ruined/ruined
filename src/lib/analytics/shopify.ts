import {
  AnalyticsEventName,
  AnalyticsPageType,
  getTrackingValues,
  sendShopifyAnalytics,
  ShopifySalesChannel,
  type ShopifyAnalytics,
  type ShopifyAnalyticsProduct,
  type ShopifyPageViewPayload,
} from "@shopify/hydrogen-react";

export type ShopifyAnalyticsConfig = {
  shopId: string;
  currency: string;
  acceptedLanguage?: string;
};

/** `value` is the total for this quantity, not the unit price. */
export type ShopifyAnalyticsItem = {
  product_id: string;
  variant_id: string;
  product_handle: string;
  quantity: number;
  value: number;
  currency: string;
  product_name?: string;
  variant_name?: string;
  source?: "product_page" | "quick_buy";
};

let configuration: ShopifyAnalyticsConfig | null = null;
let configurationIdentity = "";
let canTrack: () => boolean = () => false;
let lastPage = "";
const viewedProducts = new Set<string>();

export function configureShopifyAnalytics(config: ShopifyAnalyticsConfig | null, permission: () => boolean = () => false) {
  const next = config && /^gid:\/\/shopify\/Shop\/\d+$/.test(config.shopId)
    && /^[A-Z]{3}$/.test(config.currency) ? { ...config } : null;
  if (next) {
    const identity = JSON.stringify([next.shopId, next.currency, next.acceptedLanguage]);
    // An effect cleanup disables sending without making its next setup count
    // the same visit twice. A genuinely different shop still starts fresh.
    if (configurationIdentity !== identity) {
      lastPage = "";
      viewedProducts.clear();
      configurationIdentity = identity;
    }
  }
  configuration = next;
  canTrack = permission;
}

function storefrontPath(path: string) {
  return path === "/" || path === "/store" || path === "/bag"
    || /^\/store\/[a-z0-9][a-z0-9-]*\/?$/.test(path);
}

function storefrontHost(host: string) {
  return host === "theruinedproject.com" || host === "www.theruinedproject.com";
}

function permissionGranted() {
  try {
    const privacy = typeof window === "undefined" ? undefined : window.Shopify?.customerPrivacy;
    return Boolean(configuration && privacy?.consentStatus === "loaded" && canTrack()
      && window.navigator.globalPrivacyControl !== true
      && privacy.currentVisitorConsent().analytics === "yes" && privacy.analyticsProcessingAllowed());
  } catch { return false; }
}

/** SDK token readers are authoritative; never create or parse Shopify cookies here. */
function trackingValues() {
  if (!permissionGranted()) return null;
  try {
    const values = getTrackingValues();
    const valid = (value: unknown): value is string => typeof value === "string"
      && /^[A-Za-z0-9._~-]{1,256}$/.test(value);
    return valid(values.uniqueToken) && valid(values.visitToken) ? values : null;
  } catch { return null; }
}

export function shopifyAnalyticsTrackingHeaders(): Record<string, string> {
  if (typeof window === "undefined" || window.location.protocol !== "https:" || !storefrontHost(window.location.hostname)
    || !storefrontPath(window.location.pathname)) return {};
  const values = trackingValues();
  return values ? { "X-Shopify-UniqueToken": values.uniqueToken, "X-Shopify-VisitToken": values.visitToken } : {};
}

function safeReferrer(): string {
  try {
    if (!document.referrer) return "";
    const url = new URL(document.referrer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const sameBrand = url.hostname === "theruinedproject.com" || url.hostname.endsWith(".theruinedproject.com");
    if (sameBrand && (!storefrontHost(url.hostname) || !storefrontPath(url.pathname))) return "";
    return `${url.origin}/`;
  } catch { return ""; }
}

function pagePayload(): ShopifyPageViewPayload | null {
  if (typeof window === "undefined" || typeof document === "undefined" || !configuration) return null;
  const { hostname, pathname, protocol, origin } = window.location;
  if (protocol !== "https:" || !storefrontHost(hostname) || !storefrontPath(pathname)) return null;
  const values = trackingValues();
  if (!values) return null;
  const pageType = pathname === "/" ? AnalyticsPageType.home : pathname === "/bag" ? AnalyticsPageType.cart
    : pathname === "/store" ? AnalyticsPageType.collection : AnalyticsPageType.product;
  const title = pathname === "/" ? "Ruined" : pathname === "/bag" ? "Bag — Ruined"
    : pathname === "/store" ? "Store — Ruined" : "Product — Ruined";
  const privacy = window.Shopify!.customerPrivacy!;
  const allowed = (read: () => boolean) => { try { return read(); } catch { return false; } };
  // Deliberately construct browser fields: SDK browser helpers include raw URL,
  // document title, search and referrer, which may contain private user input.
  return {
    hasUserConsent: true,
    shopId: configuration.shopId,
    currency: configuration.currency as ShopifyPageViewPayload["currency"],
    acceptedLanguage: (/^[A-Z]{2}(?:_[A-Z]{2})?$/.test(configuration.acceptedLanguage ?? "")
      ? configuration.acceptedLanguage : "EN") as ShopifyPageViewPayload["acceptedLanguage"],
    shopifySalesChannel: ShopifySalesChannel.headless,
    uniqueToken: values.uniqueToken,
    visitToken: values.visitToken,
    url: `${origin}${pathname}`,
    canonicalUrl: `${origin}${pathname}`,
    path: pathname,
    search: "",
    referrer: safeReferrer(),
    title,
    userAgent: window.navigator.userAgent ?? "",
    navigationType: "unknown",
    navigationApi: "unknown",
    pageType,
    analyticsAllowed: true,
    marketingAllowed: allowed(() => privacy.marketingAllowed()),
    saleOfDataAllowed: allowed(() => privacy.saleOfDataAllowed()),
  };
}

function send(event: ShopifyAnalytics) {
  // No retries or consent-delayed replay: a declined visit is never backfilled.
  if (!permissionGranted()) return;
  try { void sendShopifyAnalytics(event, "checkout.theruinedproject.com").catch(() => {}); }
  catch { /* Measurement must never interrupt shopping. */ }
}

export function trackShopifyPageView() {
  const payload = pagePayload();
  if (!payload) {
    if (typeof window !== "undefined" && !storefrontPath(window.location.pathname)) {
      lastPage = "";
      viewedProducts.clear();
    }
    return;
  }
  const key = `${payload.visitToken}:${payload.url}`;
  if (key === lastPage) return;
  lastPage = key;
  viewedProducts.clear();
  // PAGE_VIEW_2 records the session/page only. Product details below use a
  // separate PRODUCT_VIEW, so late product data cannot count a second page.
  send({ eventName: AnalyticsEventName.PAGE_VIEW_2, payload });
}

function gid(value: string, kind: "Product" | "ProductVariant") {
  const numeric = /^\d+$/.test(value) ? value : new RegExp(`^gid://shopify/${kind}/(\\d+)$`).exec(value)?.[1];
  return numeric ? `gid://shopify/${kind}/${numeric}` : null;
}

function productData(item: ShopifyAnalyticsItem): ShopifyAnalyticsProduct | null {
  const productGid = gid(item.product_id, "Product");
  const variantGid = gid(item.variant_id, "ProductVariant");
  if (!productGid || !variantGid || !/^[a-z0-9][a-z0-9-]{0,254}$/.test(item.product_handle)
    || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20
    || !Number.isFinite(item.value) || item.value < 0 || !/^[A-Z]{3}$/.test(item.currency)) return null;
  return { productGid, variantGid, name: item.product_name?.slice(0, 255) || item.product_handle,
    variantName: item.variant_name?.slice(0, 255) || "", brand: "Ruined",
    price: String(item.value / item.quantity), quantity: item.quantity };
}

export function trackShopifyProductView(item: ShopifyAnalyticsItem) {
  const payload = pagePayload();
  const product = productData(item);
  if (!payload || !product) return;
  const productPage = payload.path.replace(/\/$/, "") === `/store/${item.product_handle}`;
  const inlineQuickBuy = payload.path === "/" && item.source === "quick_buy";
  if (!productPage && !inlineQuickBuy) return;
  trackShopifyPageView();
  if (viewedProducts.has(product.productGid)) return;
  viewedProducts.add(product.productGid);
  send({ eventName: AnalyticsEventName.PRODUCT_VIEW,
    payload: { ...payload, currency: item.currency as ShopifyPageViewPayload["currency"],
      resourceId: product.productGid, products: [product], totalValue: item.value } });
}

/** Only call after Shopify has confirmed this addition to a real cart. */
export function trackShopifyAddToCart(cartId: string, item: ShopifyAnalyticsItem) {
  const payload = pagePayload();
  const product = productData(item);
  const keylessId = /^gid:\/\/shopify\/Cart\/([A-Za-z0-9_-]{4,256})(?:\?[^#]*)?$/.exec(cartId)?.[1];
  if (!payload || !product || !keylessId) return;
  send({ eventName: AnalyticsEventName.ADD_TO_CART,
    payload: { ...payload, currency: item.currency as ShopifyPageViewPayload["currency"],
      cartId: `gid://shopify/Cart/${keylessId}`, products: [product], totalValue: item.value } });
}
