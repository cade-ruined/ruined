"use client";

import { inject, pageview, track, type BeforeSendEvent } from "@vercel/analytics";
import { readBag, isShopifyVariantId } from "@/components/store/bag-store";
import { analyticsConsentAllowed, isConsentUpdatePending, isMarketingPage } from "@/lib/marketing/consent";
import { checkoutVisitorConsent, hasLocalMarketingVeto } from "@/lib/marketing/meta";
import { configureShopifyAnalytics, shopifyAnalyticsTrackingHeaders, trackShopifyAddToCart,
  trackShopifyPageView, trackShopifyProductView, type ShopifyAnalyticsConfig, type ShopifyAnalyticsItem } from "./shopify";

type Properties = Record<string, string | number | boolean | undefined>;
const eventNames = new Set(["store_product_selected", "store_product_opened", "store_product_expanded", "store_size_guide_opened",
  "store_variant_selected", "store_add_to_bag", "store_bag_viewed", "store_bag_quantity_changed",
  "store_bag_item_removed", "store_checkout_clicked", "store_checkout_redirected", "store_checkout_failed", "store_cart_sync_failed", "store_scroll_depth",
  "store_catalog_viewed", "store_filter_changed", "store_color_selected", "store_catalog_product_selected", "store_browse_stage"]);
let configuration: ShopifyAnalyticsConfig | null = null;
let injected = false;
let lastPage = "";
let generation = 0;
let cartQueue = Promise.resolve();
let cartAbort: AbortController | undefined;

const categories = new Set(["all", "tees-tanks", "hoodies", "collared-shirts"]);
const fits = new Set(["all", "unisex", "mens", "womens"]);
let catalogCollections = new Set<string>();
const publicHandle = /^[a-z0-9][a-z0-9-]{0,254}$/;
const catalogHandle = /^[a-z0-9][a-z0-9-]{0,79}$/;
const contextLifetime = 30 * 60 * 1000;
const contextLimit = 50;
type BrowseContext = { selection: string; at: number };
const productContexts = new Map<string, BrowseContext>();
const bagContexts = new Map<string, BrowseContext & { product: string }>();
const browseStages = new Set(["product_selected", "product_opened", "add_to_bag", "checkout_clicked", "checkout_redirected", "checkout_failed"]);

/** Register only handles supplied by the public catalog, never query parameters. */
export function configureCatalogAnalytics(collections: readonly { handle: string }[]) {
  catalogCollections = new Set(collections.map(({ handle }) => handle).filter(handle => catalogHandle.test(handle) && handle !== "frontpage"));
}

/** A pure label formatter. The event boundary separately validates registered collections. */
export function catalogAnalyticsSelection(filters: { category: string; collection: string; fit: string }): string {
  const category = categories.has(filters.category) ? filters.category : "all";
  const collection = catalogHandle.test(filters.collection) ? filters.collection : "all";
  const fit = fits.has(filters.fit) ? filters.fit : "all";
  return `category=${category}|collection=${collection}|fit=${fit}`;
}

function validSelection(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^category=([a-z-]+)\|collection=([a-z0-9-]+)\|fit=([a-z-]+)$/.exec(value);
  return !!match && categories.has(match[1]) && fits.has(match[3])
    && (match[2] === "all" || catalogCollections.has(match[2]));
}

function validFilter(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [kind, selected, extra] = value.split(":");
  if (extra !== undefined) return false;
  if (kind === "category") return categories.has(selected);
  if (kind === "collection") return selected === "all" || catalogCollections.has(selected);
  if (kind === "fit") return fits.has(selected);
  return kind === "reset" && selected === "all";
}

function clearBrowseContexts() {
  productContexts.clear();
  bagContexts.clear();
}

function pruneContexts<T extends BrowseContext>(contexts: Map<string, T>) {
  const cutoff = Date.now() - contextLifetime;
  for (const [key, context] of contexts) {
    if (context.at <= cutoff || !validSelection(context.selection)) contexts.delete(key);
  }
  while (contexts.size > contextLimit) contexts.delete(contexts.keys().next().value!);
}

function browseStage(selection: string, stage: string) {
  // Internal callers have already crossed the same consent and public-catalog boundary.
  track("store_browse_stage", { selection, stage });
}

function trackBrowseProgress(name: string, properties: Properties, safe: Record<string, string | number>) {
  pruneContexts(productContexts);
  pruneContexts(bagContexts);
  const product = safe.product;
  if (name === "store_catalog_product_selected" && typeof product === "string") {
    const selection = String(safe.selection);
    productContexts.delete(product);
    productContexts.set(product, { selection, at: Date.now() });
    pruneContexts(productContexts);
    browseStage(selection, "product_selected");
  } else if ((name === "store_product_opened" || name === "store_add_to_bag") && typeof product === "string") {
    const context = productContexts.get(product);
    // A quick-buy addition is a different discovery path and cannot borrow a
    // previous product-page or modal context, including for the same variant.
    if (name === "store_add_to_bag" && typeof properties.variant_id === "string") bagContexts.delete(properties.variant_id);
    if (!["product_page", "product_modal"].includes(String(properties.source)) || !context) return;
    browseStage(context.selection, name === "store_product_opened" ? "product_opened" : "add_to_bag");
    if (name === "store_add_to_bag" && typeof properties.variant_id === "string" && isShopifyVariantId(properties.variant_id)) {
      bagContexts.set(properties.variant_id, { ...context, product, at: Date.now() });
      pruneContexts(bagContexts);
    }
  } else if (["store_checkout_clicked", "store_checkout_redirected", "store_checkout_failed"].includes(name)) {
    const selections = new Set<string>();
    for (const line of readBag()) {
      const context = bagContexts.get(line.variantId);
      if (context && context.product === line.productId) selections.add(context.selection);
    }
    for (const selection of selections) browseStage(selection, name.replace("store_", ""));
  } else if (name === "store_bag_item_removed") {
    const remaining = new Set(readBag().map(line => line.variantId));
    for (const variant of bagContexts.keys()) if (!remaining.has(variant)) bagContexts.delete(variant);
  }
}

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
    clearBrowseContexts();
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

function safeProperties(name: string, properties: Properties): Record<string, string | number> | null {
  const result: Record<string, string | number> = {};
  if (name === "store_catalog_viewed" || name === "store_filter_changed") {
    const results = properties.results;
    if (typeof results !== "number" || !Number.isInteger(results) || results < 0 || results > 10000) return null;
    if (name === "store_catalog_viewed") return validSelection(properties.selection) ? { selection: properties.selection, results } : null;
    return validFilter(properties.filter) ? { filter: properties.filter, results } : null;
  }
  if (name === "store_catalog_product_selected") {
    return typeof properties.product_handle === "string" && publicHandle.test(properties.product_handle) && validSelection(properties.selection)
      ? { product: properties.product_handle, selection: properties.selection } : null;
  }
  if (name === "store_product_expanded") {
    return typeof properties.product_handle === "string" && publicHandle.test(properties.product_handle)
      && properties.source === "product_modal"
      ? { product: properties.product_handle, source: properties.source } : null;
  }
  if (name === "store_color_selected") {
    return typeof properties.product_handle === "string" && publicHandle.test(properties.product_handle)
      && typeof properties.option_value === "string" && /^[\w ()/.'’,-]{1,64}$/.test(properties.option_value)
      ? { product: properties.product_handle, color: properties.option_value } : null;
  }
  if (name === "store_browse_stage") {
    return validSelection(properties.selection) && typeof properties.stage === "string" && browseStages.has(properties.stage)
      ? { selection: properties.selection, stage: properties.stage } : null;
  }
  if (name === "store_cart_sync_failed") {
    return ["invalid_bag", "unavailable", "network"].includes(String(properties.error_category))
      ? { reason: String(properties.error_category) } : result;
  }
  const handle = properties.product_handle;
  if (typeof handle === "string" && /^[a-z0-9][a-z0-9-]{0,254}$/.test(handle)) result.product = handle;
  const source = properties.source;
  if (typeof source === "string" && ["store", "product_page", "product_modal", "quick_buy", "bag"].includes(source)) result.source = source;
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
  if (!storeAnalyticsAllowed()) {
    clearBrowseContexts();
    return false;
  }
  if (!eventNames.has(name)) return false;
  const safe = safeProperties(name, properties);
  if (!safe) return false;
  refreshStoreAnalytics();
  track(name, safe);
  trackBrowseProgress(name, properties, safe);
  if (name === "store_product_opened") trackShopifyProductView(properties as ShopifyAnalyticsItem);
  if (name === "store_add_to_bag") queueCartSync(properties as ShopifyAnalyticsItem);
  else if (name === "store_bag_quantity_changed" || name === "store_bag_item_removed") queueCartSync();
  return true;
}
