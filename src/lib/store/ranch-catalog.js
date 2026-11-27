/** @typedef {import("../../data/products").Product} Product */

// Shopify identities are stable even when a product title or route changes.
export const RANCH_PRODUCT_IDS = Object.freeze([
  "gid://shopify/Product/15541729755457",
  "gid://shopify/Product/15541730345281",
  "gid://shopify/Product/15541730607425",
  "gid://shopify/Product/15541730967873",
]);

/** @type {Record<string, {gender: "Mens" | "Womens", garment: "Top" | "Bottom", color: string}>} */
const STYLES = {
  [RANCH_PRODUCT_IDS[0]]: { gender: "Mens", garment: "Top", color: "Blue" },
  [RANCH_PRODUCT_IDS[1]]: { gender: "Womens", garment: "Top", color: "Brown" },
  [RANCH_PRODUCT_IDS[2]]: { gender: "Mens", garment: "Bottom", color: "Black" },
  [RANCH_PRODUCT_IDS[3]]: { gender: "Womens", garment: "Bottom", color: "Blue" },
};

/** @param {{shopifyProductGid?: string}} product */
export function isRanchProduct(product) {
  return Boolean(product.shopifyProductGid && Object.hasOwn(STYLES, product.shopifyProductGid));
}

/** @param {{shopifyProductGid?: string}} product */
export function getRanchStyle(product) {
  return product.shopifyProductGid && Object.hasOwn(STYLES, product.shopifyProductGid)
    ? STYLES[product.shopifyProductGid] : undefined;
}

/** @param {Product[]} products */
export function getRanchProducts(products) {
  return RANCH_PRODUCT_IDS.flatMap((id) => {
    const product = products.find(({ shopifyProductGid }) => shopifyProductGid === id);
    return product ? [product] : [];
  });
}

/** Resolve only published products and colors actually present in Shopify.
 * @param {Product[]} products
 */
export function getRanchRackSelections(products) {
  return getRanchProducts(products).map((product) => {
    const preferred = getRanchStyle(product)?.color;
    const colors = product.options?.find(({ name }) => /^colou?r$/i.test(name.trim()))?.values ?? [];
    return { product, color: colors.find((color) => color.toLowerCase() === preferred?.toLowerCase()) ?? colors[0] };
  });
}

/** Never link to an unverified collection filter before Shopify publishes it.
 * @param {Product[]} products
 */
export function getRanchCollectionHref(products) {
  return getRanchProducts(products).some((product) => product.collections?.some(({ handle }) => handle === "ruined-ranch"))
    ? "/store?collection=ruined-ranch" : "/store";
}
