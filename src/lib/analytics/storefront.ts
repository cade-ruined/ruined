"use client";

import { inject, pageview, track, type BeforeSendEvent } from "@vercel/analytics";
import { readBag, isShopifyVariantId } from "@/components/store/bag-store";
import { analyticsConsentAllowed, isConsentUpdatePending, isMarketingPage } from "@/lib/marketing/consent";
import { checkoutVisitorConsent, hasLocalMarketingVeto } from "@/lib/marketing/meta";
import { configureShopifyAnalytics, shopifyAnalyticsTrackingHeaders, trackShopifyAddToCart,
  trackShopifyPageView, trackShopifyProductView, type ShopifyAnalyticsConfig, type ShopifyAnalyticsItem } from "./shopify";

type Properties = Record<string, string | number | boolean | undefined>;
const eventNames = new Set(["store_product_selected", "store_product_opened", "store_size_guide_opened",
  "store_variant_selected", "store_add_to_bag", "store_bag_viewed", "store_bag_quantity_changed",
  "store_bag_item_removed", "store_checkout_clicked", "store_checkout_redirected", "store_checkout_failed", "store_cart_sync_failed", "store_scroll_depth"]);
let configuration: ShopifyAnalyticsConfig | null = null;
let injected = false;
let lastPage = "";
let generation = 0;
let cartQueue = Promise.resolve();
let cartAbort: AbortController | undefined;

export function storeAnalyticsAllowed(): boolean {
  if (!configuration || typeof window === "undefined" || isConsentUpdatePending()) return false;
  const { protocol, hostname, pathname } = window.location;
  return protocol === "https:" && ["theruinedproject.com", "www.theruinedproject.com"].includes(hostname)
    && isMarketingPage(pathname) && !hasLocalMarketingVeto()
    && analyticsConsentAllowed(window.Shopify?.customerPrivacy, window.navigator.globalPrivacyControl === true);
}

/** No query, hash, private route, user identifier or free-form input is reported. */
export function beforeStoreAnalyticsSend(event: BeforeSendEvent): BeforeSendEvent | null {
  if (!storeAnalyticsAllowed()) return null;
  try {
    const url = new URL(event.url, window.location.origin);
    if (url.origin !== window.location.origin || !isMarketingPage(url.pathname)) return null;
    // Vercel's SDK owns referrer collection. Drop a hit when its raw referrer
    // could include private data rather than passing undocumented payload fields.
    if (document.referrer) {
      const referrer = new URL(document.referrer);
      const brand = referrer.hostname === "theruinedproject.com" || referrer.hostname.endsWith(".theruinedproject.com");
      if (referrer.search || referrer.hash || (brand && (!isMarketingPage(referrer.pathname)
        || !["theruinedproject.com", "www.theruinedproject.com"].includes(referrer.hostname)))) return null;
    }
    return { ...event, url: `${url.origin}${url.pathname}` };
  } catch { return null; }
}

export function refreshStoreAnalytics() {
  if (!storeAnalyticsAllowed()) {
    generation++;
    if (typeof window !== "undefined" && !isMarketingPage(window.location.pathname)) lastPage = "";
    cartAbort?.abort();
    if (typeof window !== "undefined" && window.vaq) window.vaq = window.vaq.filter(([kind]) => kind !== "event" && kind !== "pageview");
    trackShopifyPageView();
    return;
  }
  if (!injected) {
    inject({ mode: "production", disableAutoTrack: true, beforeSend: beforeStoreAnalyticsSend, debug: false });
    injected = true;
  }
  const pathname = window.location.pathname;
  if (lastPage !== pathname) {
    pageview({ path: pathname, route: pathname.startsWith("/store/") ? "/store/[slug]" : pathname });
    lastPage = pathname;
  }
  trackShopifyPageView();
}

export function configureStoreAnalytics(config: ShopifyAnalyticsConfig | null) {
  configuration = config;
  configureShopifyAnalytics(config, storeAnalyticsAllowed);
  refreshStoreAnalytics();
}

function safeProperties(name: string, properties: Properties): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  if (name === "store_cart_sync_failed") {
    return ["invalid_bag", "unavailable", "network"].includes(String(properties.error_category))
      ? { reason: String(properties.error_category) } : result;
  }
  const handle = properties.product_handle;
  if (typeof handle === "string" && /^[a-z0-9][a-z0-9-]{0,254}$/.test(handle)) result.product = handle;
  const source = properties.source;
  if (typeof source === "string" && ["store", "product_page", "quick_buy", "bag"].includes(source)) result.source = source;
  if (name === "store_variant_selected") {
    delete result.source;
    const option = properties.option_name, value = properties.option_value;
    // Values come only from catalog choices, never search boxes or user text.
    if (typeof option === "string" && typeof value === "string" && /^[\w ()/.'-]{1,32}$/.test(option) && /^[\w ()/.'-]{1,64}$/.test(value)) result.option = `${option}: ${value}`;
  }
  if (name.startsWith("store_checkout_") || name === "store_bag_viewed") {
    delete result.source;
    if (typeof properties.quantity === "number" && Number.isInteger(properties.quantity) && properties.quantity >= 0 && properties.quantity <= 500) result.quantity = properties.quantity;
    if (typeof properties.value === "number" && Number.isFinite(properties.value) && properties.value >= 0) result.value = Math.round(properties.value * 100) / 100;
  }
  if (name === "store_checkout_failed") {
    delete result.value;
    if (["network", "checkout_unavailable", "invalid_response", "redirect_failed"].includes(String(properties.error_category))) result.reason = String(properties.error_category);
  }
  if (name === "store_scroll_depth" && [25, 50, 75, 100].includes(Number(properties.percent))) result.percent = Number(properties.percent);
  // The current Vercel plan supports two custom properties per event.
  return Object.fromEntries(Object.entries(result).slice(0, 2));
}

function queueCartSync(item?: ShopifyAnalyticsItem) {
  const currentGeneration = generation;
  const lines = readBag().filter(line => isShopifyVariantId(line.variantId)).map(({ variantId, quantity }) => ({ variantId, quantity }));
  cartQueue = cartQueue.then(async () => {
    if (generation !== currentGeneration || !storeAnalyticsAllowed()) return;
    const controller = new AbortController();
    cartAbort = controller;
    const reportFailure = (reason: "invalid_bag" | "unavailable" | "network") => {
      if (generation === currentGeneration && !controller.signal.aborted && storeAnalyticsAllowed()) {
        trackStoreEvent("store_cart_sync_failed", { error_category: reason });
      }
    };
    try {
      let response: Response;
      try {
        response = await fetch("/api/store/cart", {
          method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
          headers: { "Content-Type": "application/json", ...shopifyAnalyticsTrackingHeaders() },
          body: JSON.stringify({ lines, visitorConsent: checkoutVisitorConsent() }),
        });
      } catch (error) {
        // Consent/navigation cancellation is not a shopping failure. A timeout
        // still reports a network problem while the same visitor permits it.
        if (!(error instanceof Error && error.name === "AbortError")) reportFailure("network");
        return;
      }
      if (!response.ok) {
        reportFailure(response.status === 400 ? "invalid_bag" : "unavailable");
        return;
      }
      let payload: { cartId?: unknown } | null;
      try { payload = await response.json() as typeof payload; }
      catch { reportFailure("unavailable"); return; }
      if (typeof payload?.cartId !== "string" || !/^gid:\/\/shopify\/Cart\/[A-Za-z0-9_-]{4,256}$/.test(payload.cartId)) {
        reportFailure("unavailable");
        return;
      }
      if (item && generation === currentGeneration && storeAnalyticsAllowed()) {
        trackShopifyAddToCart(payload.cartId, item);
      }
    } finally {
      if (cartAbort === controller) cartAbort = undefined;
    }
  }).catch(() => { /* Checkout always reconciles independently if background sync fails. */ });
}

/** Wait for the latest serialized snapshot without making analytics a checkout dependency. */
export async function flushStoreCart(): Promise<void> {
  let pending: Promise<void>;
  do { pending = cartQueue; await pending; } while (pending !== cartQueue);
}

export function trackStoreEvent(name: string, properties: Properties = {}): boolean {
  if (!eventNames.has(name) || !storeAnalyticsAllowed()) return false;
  refreshStoreAnalytics();
  track(name, safeProperties(name, properties));
  if (name === "store_product_opened") trackShopifyProductView(properties as ShopifyAnalyticsItem);
  if (name === "store_add_to_bag") queueCartSync(properties as ShopifyAnalyticsItem);
  else if (name === "store_bag_quantity_changed" || name === "store_bag_item_removed") queueCartSync();
  return true;
}
