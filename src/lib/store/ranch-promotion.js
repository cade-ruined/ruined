import { isRanchProduct } from "./ranch-catalog.js";

// Matches the product-scoped automatic discount configured in Shopify.
// Catalog/variant prices remain unchanged; Shopify applies it once at checkout.
export const RANCH_SALE_START = "2026-11-27T19:27:26Z";
export const RANCH_SALE_END = "2026-12-01T06:59:59Z";
export const RANCH_SALE_COPY = "40% off Ruined Ranch through Monday, November 30, 11:59 p.m. MT. Automatically applied at checkout.";

export function isRanchSaleActive(now = Date.now()) {
  return now >= Date.parse(RANCH_SALE_START) && now < Date.parse(RANCH_SALE_END);
}

/** @param {number} amount @param {string} currency */
export function formatStoreMoney(amount, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * @param {{shopifyProductGid?: string}} product
 * @param {{priceAmount: string, currencyCode: string} | undefined} variant
 * @param {number} [now]
 */
export function ranchPromotionPrice(product, variant, now = Date.now()) {
  if (!isRanchProduct(product) || !variant || !isRanchSaleActive(now)) return undefined;
  const amount = Number(variant.priceAmount);
  if (!variant.priceAmount.trim() || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(variant.currencyCode)) return undefined;
  const regularCents = Math.round(amount * 100);
  const saleCents = Math.round(regularCents * 60 / 100);
  return {
    amount: saleCents / 100,
    priceAmount: (saleCents / 100).toFixed(2),
    price: formatStoreMoney(saleCents / 100, variant.currencyCode),
    regularPrice: formatStoreMoney(regularCents / 100, variant.currencyCode),
    savings: (regularCents - saleCents) / 100,
  };
}
