// Matches the storewide automatic discount configured in Shopify.
// Catalog/variant prices remain unchanged; Shopify applies it once at checkout.
import { STORE_SALE_START, STORE_SALE_END, STORE_SALE_PERCENT } from "../../../public/store-promotion-config.js";
export { STORE_SALE_START, STORE_SALE_END, STORE_SALE_PERCENT, STORE_SALE_COPY } from "../../../public/store-promotion-config.js";

/** @param {{shopifyProductGid?: string}} product */
export function isStoreSaleProduct(product) {
  return /^gid:\/\/shopify\/Product\/[1-9]\d*$/.test(product.shopifyProductGid ?? "");
}

export function isStoreSaleActive(now = Date.now()) {
  return now >= Date.parse(STORE_SALE_START) && now < Date.parse(STORE_SALE_END);
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
export function storePromotionPrice(product, variant, now = Date.now()) {
  if (!isStoreSaleProduct(product) || !variant || !isStoreSaleActive(now)) return undefined;
  const amount = Number(variant.priceAmount);
  if (!variant.priceAmount.trim() || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(variant.currencyCode)) return undefined;
  const regularCents = Math.round(amount * 100);
  const saleCents = Math.round(regularCents * (100 - STORE_SALE_PERCENT) / 100);
  return {
    amount: saleCents / 100,
    priceAmount: (saleCents / 100).toFixed(2),
    price: formatStoreMoney(saleCents / 100, variant.currencyCode),
    regularPrice: formatStoreMoney(regularCents / 100, variant.currencyCode),
    savings: (regularCents - saleCents) / 100,
  };
}
