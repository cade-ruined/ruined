import type { Product, ProductVariant } from "@/data/products";
import { isMarketingPage, marketingConsentAllowed, META_PIXEL_ID, type CustomerPrivacy } from "./consent";

type Pixel = ((...arguments_: unknown[]) => void) & { callMethod?: (...arguments_: unknown[]) => void; queue: unknown[][]; push?: Pixel; loaded: boolean; version: string; disablePushState: boolean };

declare global {
  interface Window { Shopify?: { customerPrivacy?: CustomerPrivacy }; fbq?: Pixel; _fbq?: Pixel }
  interface Navigator { globalPrivacyControl?: boolean }
}

const ATTRIBUTION_KEY = "ruined:marketing-attribution:v1";
const DENY_KEY = "ruined:marketing-denied:v1";
const ATTRIBUTION_PARAMETERS = ["fbclid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"];
let enabled = false;
let denied = true;
let lastPage = "";
const viewed = new Set<string>();

export function currentMarketingPermission(): boolean {
  return typeof window !== "undefined" && enabled && !denied
    && !hasLocalMarketingVeto()
    && (window.location.hostname === "theruinedproject.com" || window.location.hostname === "www.theruinedproject.com")
    && isMarketingPage(window.location.pathname)
    && safeMarketingLocation(window.location.href, document.referrer)
    && marketingConsentAllowed(window.Shopify?.customerPrivacy, window.navigator.globalPrivacyControl === true);
}

export function safeMarketingLocation(href: string, referrer = ""): boolean {
  const allowedKeys = new Set([...ATTRIBUTION_PARAMETERS, "variant", "color"]);
  try {
    const url = new URL(href);
    if (url.hash || [...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) return false;
    if (referrer) {
      const from = new URL(referrer);
      if (from.hash || from.search) return false;
      if (from.hostname.endsWith("theruinedproject.com") && !isMarketingPage(from.pathname)) return false;
    }
    return true;
  } catch { return false; }
}

export function hasLocalMarketingVeto(): boolean {
  try { return window.localStorage.getItem(DENY_KEY) === "true"; } catch { return true; }
}

export function grantMetaTracking(explicit = false) {
  if (explicit) {
    try { window.localStorage.removeItem(DENY_KEY); } catch { return; }
  }
  denied = hasLocalMarketingVeto();
}

export function vetoMetaTracking() {
  try { window.localStorage.setItem(DENY_KEY, "true"); } catch { /* Memory still denies tracking. */ }
  revokeMetaTracking();
}

export function configureMetaTracking(value: boolean) {
  enabled = value;
}

export function captureAttribution(search: string): Record<string, string> {
  const query = new URLSearchParams(search);
  return Object.fromEntries(ATTRIBUTION_PARAMETERS.flatMap((key) => {
    const value = query.get(key);
    return value && value.length <= 500 && !/[\u0000-\u001f]/.test(value) ? [[key, value]] : [];
  }));
}

function rememberAttribution() {
  if (!currentMarketingPermission()) return;
  try {
    const current = captureAttribution(window.location.search);
    if (Object.keys(current).length) window.sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(current));
  } catch { /* Storage may be unavailable; shopping remains usable. */ }
}

export function revokeMetaTracking() {
  denied = true;
  // If the SDK is still downloading, discard event calls rather than replaying
  // them after a visitor has withdrawn permission.
  if (window.fbq && !window.fbq.callMethod) {
    window.fbq.queue = window.fbq.queue.filter((call) => call[0] !== "trackSingle"
      && !(call[0] === "consent" && call[1] === "grant"));
  }
  window.fbq?.("consent", "revoke");
  lastPage = "";
  viewed.clear();
  try { window.sessionStorage.removeItem(ATTRIBUTION_KEY); } catch { /* Optional storage. */ }
}

function pixel(): Pixel | undefined {
  if (!currentMarketingPermission()) return undefined;
  if (!window.fbq) {
    const queue = ((...arguments_: unknown[]) => {
      if (queue.callMethod) queue.callMethod(...arguments_);
      else queue.queue.push(arguments_);
    }) as Pixel;
    queue.queue = [];
    queue.push = queue;
    queue.loaded = true;
    queue.version = "2.0";
    // Meta otherwise adds its own PageViews to pushState/replaceState, bypassing
    // our consent, private-route and duplicate-event checks.
    queue.disablePushState = true;
    window.fbq = queue;
    window._fbq ??= queue;
    // Only the three explicit commerce events below are sent. No advanced matching.
    queue("set", "autoConfig", false, META_PIXEL_ID);
    queue("init", META_PIXEL_ID);
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    script.id = "ruined-meta-pixel";
    document.head.appendChild(script);
  }
  window.fbq("consent", "grant");
  rememberAttribution();
  return window.fbq;
}

export function trackMetaPageView() {
  if (!currentMarketingPermission() || lastPage === window.location.pathname) return;
  const send = pixel();
  if (!send) return;
  lastPage = window.location.pathname;
  viewed.clear();
  send("trackSingle", META_PIXEL_ID, "PageView");
}

export function commerceEventData(product: Product, variant?: ProductVariant) {
  const productId = /^gid:\/\/shopify\/Product\/(\d+)$/.exec(product.shopifyProductGid ?? "")?.[1];
  if (!productId) return null;
  if (!variant) return { content_name: product.name, content_type: "product_group", content_ids: [productId] };
  const variantId = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/.exec(variant.id)?.[1];
  const value = Number(variant.priceAmount);
  if (!productId || !variantId || !Number.isFinite(value) || value < 0 || !/^[A-Z]{3}$/.test(variant.currencyCode)) return null;
  return {
    content_name: product.name,
    content_type: "product",
    // Commerce Manager catalog 1829789111709934 uses numeric variant content IDs.
    content_ids: [variantId],
    contents: [{ id: variantId, quantity: 1, item_price: value }],
    currency: variant.currencyCode,
    value,
  };
}

export function trackMetaProductView(product: Product, variant?: ProductVariant) {
  if (!currentMarketingPermission()) return;
  trackMetaPageView();
  const data = commerceEventData(product, variant);
  if (!data) return;
  const key = data.content_ids[0];
  if (viewed.has(key)) return;
  const send = pixel();
  if (!send) return;
  viewed.add(key);
  send("trackSingle", META_PIXEL_ID, "ViewContent", data);
}

export function trackMetaAddToCart(product: Product, variant: ProductVariant) {
  if (!variant.available || !currentMarketingPermission()) return;
  const data = commerceEventData(product, variant);
  if (data) pixel()?.("trackSingle", META_PIXEL_ID, "AddToCart", data);
}

/** Shopify owns checkout/Purchase events; only carry consented click attribution. */
export function checkoutWithAttribution(checkoutUrl: string): string {
  if (!currentMarketingPermission()) return checkoutUrl;
  try {
    const url = new URL(checkoutUrl);
    if (url.protocol !== "https:" || url.hostname !== "checkout.theruinedproject.com") return checkoutUrl;
    rememberAttribution();
    const saved = JSON.parse(window.sessionStorage.getItem(ATTRIBUTION_KEY) ?? "{}");
    for (const [key, value] of Object.entries(captureAttribution(new URLSearchParams(saved).toString()))) {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    return url.toString();
  } catch { return checkoutUrl; }
}
