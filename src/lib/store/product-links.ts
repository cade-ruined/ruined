import type { Product, ProductVariant } from "@/data/products";

export function requestedProductVariant(product: Product, requested: string | null): ProductVariant | undefined {
  if (!requested) return undefined;
  const id = /^\d+$/.test(requested) ? `gid://shopify/ProductVariant/${requested}` : requested;
  return product.variants.find((variant) => variant.id === id);
}

/** Keep campaign parameters while changing only the product selection. */
export function productSelectionHref(
  pathname: string,
  currentSearch: string,
  selection: { color?: string; variant?: string | null },
): string {
  const query = new URLSearchParams(currentSearch);
  if (selection.color !== undefined) query.set("color", selection.color);
  if (selection.variant === null) query.delete("variant");
  else if (selection.variant !== undefined) {
    const id = /^(?:gid:\/\/shopify\/ProductVariant\/)?(\d+)$/.exec(selection.variant)?.[1];
    if (id) query.set("variant", id);
  }
  return `${pathname}${query.size ? `?${query}` : ""}`;
}
