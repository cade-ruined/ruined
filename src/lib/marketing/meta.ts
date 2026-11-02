import type { Product, ProductVariant } from "@/data/products";
import { isConsentUpdatePending, isMarketingPage, marketingConsentAllowed, visitorConsentForCheckout, META_PIXEL_ID, type CustomerPrivacy } from "./consent";
import { mergePaidAttribution, paidVisitFromLocation, PAID_ATTRIBUTION_STORAGE_KEY, readPaidAttribution, type PaidAttribution } from "./attribution";

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
let capturedPaidQuery = "";
let memoryAttribution: PaidAttribution | null = null;
const viewed = new Set<string>();

export function currentMarketingPermission(): boolean {
  return typeof window !== "undefined" && enabled && !denied && !isConsentUpdatePending()
    && !hasLocalMarketingVeto()
    && window.location.protocol === "https:"
    && (window.location.hostname === "theruinedproject.com" || window.location.hostname === "www.theruinedproject.com")
    && isMarketingPage(window.location.pathname)
    && safeMarketingLocation(window.location.href, document.referrer)
    && marketingConsentAllowed(window.Shopify?.customerPrivacy, window.navigator.globalPrivacyControl === true);
}

export function safeMarketingLocation(href: string, referrer = ""): boolean {
  const allowedKeys = new Set([...ATTRIBUTION_PARAMETERS, "variant", "color"]);
  const safeQuery = (url: URL) => !url.hash && [...url.searchParams.keys()].every((key) => allowedKeys.has(key))
    && [...url.searchParams].every(([key, value]) => key === "variant" ? /^\d{1,32}$/.test(value)
      : key === "color" ? /^[a-zA-Z0-9 _-]{1,64}$/.test(value) : captureAttribution(url.search)[key] === value);
  try {
    const url = new URL(href);
    if (!safeQuery(url)) return false;
    if (referrer) {
      const from = new URL(referrer);
      const brand = from.hostname === "theruinedproject.com" || from.hostname.endsWith(".theruinedproject.com");
      const publicStore = ["theruinedproject.com", "www.theruinedproject.com"].includes(from.hostname);
      if (brand && (!publicStore || !isMarketingPage(from.pathname))) return false;
      // A normal full-page hop from our tagged landing page retains its UTMs in
      // the referrer. Permit only sanitized public-store referrers; private and
      // unknown query data must still never reach the Pixel SDK.
      if (publicStore ? !safeQuery(from) : Boolean(from.hash || from.search)) return false;
    }
    return true;
  } catch { return false; }
}

export function hasLocalMarketingVeto(): boolean {
  try { return window.localStorage.getItem(DENY_KEY) === "true"; } catch { return true; }
}

export function checkoutVisitorConsent() {
  return visitorConsentForCheckout(window.Shopify?.customerPrivacy, hasLocalMarketingVeto(), window.navigator.globalPrivacyControl === true);
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
  if (search.length > 4096) return {};
  const query = new URLSearchParams(search);
  return Object.fromEntries(ATTRIBUTION_PARAMETERS.flatMap((key) => {
    const value = query.get(key);
    const safe = key === "fbclid" ? /^[a-zA-Z0-9_-]{1,500}$/ : /^[a-zA-Z0-9][a-zA-Z0-9_. -]{0,127}$/;
    return value && query.getAll(key).length === 1 && safe.test(value) ? [[key, value]] : [];
  }));
}

function rememberAttribution(): PaidAttribution | null {
  if (!currentMarketingPermission()) return null;
  try {
    const current = captureAttribution(window.location.search);
    if (Object.keys(current).length) window.sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(current));
  } catch { /* Storage may be unavailable; shopping remains usable. */ }
  let saved: unknown = null;
  try { saved = JSON.parse(window.localStorage.getItem(PAID_ATTRIBUTION_STORAGE_KEY) ?? "null"); }
  catch { /* Invalid/unavailable storage is ignored. */ }
  const now = Date.now();
  let current = paidVisitFromLocation(window.location.search, window.location.pathname, now);
  // Only arriving from outside the storefront is a new paid visit. Repeated
  // calls and internal navigation with copied UTMs must not move the timestamp.
  const signature = current ? JSON.stringify([current.source, current.medium, current.campaignId, current.adsetId, current.adId]) : "";
  const internalReferrer = document.referrer && ["theruinedproject.com", "www.theruinedproject.com"].includes(new URL(document.referrer).hostname);
  if (signature === capturedPaidQuery || internalReferrer) current = null;
  if (signature) capturedPaidQuery = signature;
  const attribution = mergePaidAttribution(readPaidAttribution(saved, now) ?? memoryAttribution, current, now);
  memoryAttribution = attribution;
  try {
    if (attribution) window.localStorage.setItem(PAID_ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
    else window.localStorage.removeItem(PAID_ATTRIBUTION_STORAGE_KEY);
  } catch { /* The current visit can still accompany this consented checkout. */ }
  return attribution;
}

/** Revalidate consent on each request; browser storage never supplies permission. */
export function checkoutAttribution(): PaidAttribution | null {
  return rememberAttribution();
}

export function revokeMetaTracking({ forgetAttribution = true }: { forgetAttribution?: boolean } = {}) {
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
  if (forgetAttribution) {
    capturedPaidQuery = "";
    memoryAttribution = null;
    try { window.sessionStorage.removeItem(ATTRIBUTION_KEY); } catch { /* Optional storage. */ }
    try { window.localStorage.removeItem(PAID_ATTRIBUTION_STORAGE_KEY); } catch { /* Optional storage. */ }
  }
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
  // Query-only navigation can carry a new ad even when the path is unchanged.
  rememberAttribution();
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

export function trackMetaAddToCart(product: Product, variant: ProductVariant, quantity = 1) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20 || !variant.available || !currentMarketingPermission()) return;
  const data = commerceEventData(product, variant);
  if (data?.contents && data.value !== undefined) pixel()?.("trackSingle", META_PIXEL_ID, "AddToCart", {
    ...data, value: data.value * quantity,
    contents: data.contents.map((item) => ({ ...item, quantity })),
  });
}

/** Shopify owns checkout/Purchase events; only carry consented click attribution. */
export function checkoutWithAttribution(checkoutUrl: string): string {
  if (!currentMarketingPermission()) return checkoutUrl;
  try {
    const url = new URL(checkoutUrl);
    if (url.protocol !== "https:" || url.hostname !== "checkout.theruinedproject.com") return checkoutUrl;
    const attribution = rememberAttribution();
    const saved = JSON.parse(window.sessionStorage.getItem(ATTRIBUTION_KEY) ?? "{}");
    const latest = readPaidAttribution(attribution)?.latest;
    const paid: Record<string, string> = latest ? { utm_source: latest.source, utm_medium: latest.medium, utm_campaign: latest.campaignId,
      ...(latest.adsetId ? { utm_term: latest.adsetId } : {}), ...(latest.adId ? { utm_content: latest.adId } : {}) } : {};
    for (const [key, value] of Object.entries({ ...captureAttribution(new URLSearchParams(saved).toString()), ...paid })) {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    return url.toString();
  } catch { return checkoutUrl; }
}
