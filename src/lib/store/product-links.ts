import type { Product, ProductVariant } from "@/data/products";

export function requestedProductVariant(product: Product, requested: string | null): ProductVariant | undefined {
  if (!requested) return undefined;
  const id = /^\d+$/.test(requested) ? `gid://shopify/ProductVariant/${requested}` : requested;
  return product.variants.find((variant) => variant.id === id);
}

/** Only accept an actual option value, never arbitrary fit text from a URL. */
export function requestedProductFit(product: Product, requested: string | null): string | undefined {
  return product.options.find(({ name }) => name.toLowerCase() === "fit")
    ?.values.find((value) => value === requested);
}

/** Keep a selected catalog cut without carrying a variant from the other cut. */
export function getProductFitHref(product: Product, baseHref: string, fit?: string): string {
  const selectedFit = requestedProductFit(product, fit ?? null);
  if (!selectedFit) return baseHref;
  const url = new URL(baseHref, "https://theruinedproject.com");
  return productSelectionHref(url.pathname, url.search, { fit: selectedFit, variant: null }) + url.hash;
}

/** Keep campaign parameters while changing only the product selection. */
export function productSelectionHref(
  pathname: string,
  currentSearch: string,
  selection: { color?: string; fit?: string; variant?: string | null },
): string {
  const query = new URLSearchParams(currentSearch);
  if (selection.color !== undefined) query.set("color", selection.color);
  if (selection.fit !== undefined) query.set("fit", selection.fit);
  if (selection.variant === null) query.delete("variant");
  else if (selection.variant !== undefined) {
    const id = /^(?:gid:\/\/shopify\/ProductVariant\/)?(\d+)$/.exec(selection.variant)?.[1];
    if (id) query.set("variant", id);
  }
  return `${pathname}${query.size ? `?${query}` : ""}`;
}
