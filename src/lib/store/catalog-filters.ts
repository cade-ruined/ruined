import type { Product, ProductCollection } from "@/data/products";

export const CATALOG_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "tees-tanks", label: "Tees & Tanks" },
  { id: "hoodies", label: "Hoodies" },
  { id: "collared-shirts", label: "Collared Shirts" },
] as const;

export const CATALOG_FITS = [
  { id: "all", label: "All fits" },
  { id: "unisex", label: "Unisex" },
  { id: "mens", label: "Men’s" },
  { id: "womens", label: "Women’s" },
] as const;

export type CatalogFit = (typeof CATALOG_FITS)[number]["id"];
export type ProductFit = Exclude<CatalogFit, "all">;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number]["id"];
export type ProductCategory = Exclude<CatalogCategory, "all">;
export type CatalogFilters = { category: CatalogCategory; collection: string; fit: CatalogFit };
export type CatalogFilterInput = { category?: string | null; collection?: string | null; fit?: string | null };

const COLLECTION_ORDER = ["staples", "sunday-clothes", "less-permanent", "collared-script", "byob"];
const EXCLUDED_COLLECTIONS = new Set(["frontpage"]);

// Existing Shopify products mostly have no productType. These stable handles
// preserve their placement while new products can be classified by their type.
const CATEGORY_BY_HANDLE: Record<string, ProductCategory> = {
  "camo-hoodie": "hoodies",
  "ruined-hoodie": "hoodies",
  "sunday-clothes-hoodie": "hoodies",
  "ruined-tee": "tees-tanks",
  "womens-crop-tee": "tees-tanks",
  "mens-distressed-crop-tee": "tees-tanks",
  "mens-less-permanent-tee": "tees-tanks",
  "womens-less-permanent-crop-tee": "tees-tanks",
  "byob-tank": "tees-tanks",
  "long-sleeve-crest-polo": "collared-shirts",
  "womens-crop-collared-script": "collared-shirts",
  "mens-collared-script": "collared-shirts",
};

function categoryFromText(text: string): ProductCategory | null {
  if (/\b(?:hoodies?|hooded)\b/i.test(text)) return "hoodies";
  if (/\b(?:collared|polos?)\b/i.test(text)) return "collared-shirts";
  if (/\b(?:tees?|t[ -]?shirts?|tanks?)\b/i.test(text)) return "tees-tanks";
  return null;
}

export function getProductCategory(product: Product): ProductCategory | null {
  return categoryFromText(product.productType ?? "")
    ?? CATEGORY_BY_HANDLE[product.id]
    ?? categoryFromText(product.name);
}

// These existing cuts were confirmed as unisex by Ruined. Their Shopify
// target-gender fields are currently empty; new pieces still need authored data.
const APPROVED_FITS_BY_HANDLE: Record<string, ProductFit[]> = {
  "camo-hoodie": ["unisex"],
  "ruined-hoodie": ["unisex"],
  "sunday-clothes-hoodie": ["unisex"],
  "ruined-tee": ["unisex"],
};

function fitFromLabel(value: string): ProductFit | null {
  const normalized = value.toLowerCase().replace(/[’']/g, "").trim();
  if (["men", "mens", "male"].includes(normalized)) return "mens";
  if (["women", "womens", "female"].includes(normalized)) return "womens";
  if (normalized === "unisex") return "unisex";
  return null;
}

function recognizedFits(values: string[]): ProductFit[] {
  return [...new Set(values.map(fitFromLabel).filter((fit): fit is ProductFit => fit !== null))];
}

/** Actual cuts take precedence over a broad Shopify target-gender label.
 * BYOB has separate Men's and Women's options, not a single unisex cut.
 * A missing label never implies unisex; unclassified pieces remain in All.
 */
export function getProductFits(product: Product): ProductFit[] {
  const variantFits = recognizedFits((product.options ?? [])
    .filter(({ name }) => name.toLowerCase() === "fit")
    .flatMap(({ values }) => values));
  if (variantFits.length) return variantFits;
  const taxonomyFits = recognizedFits(product.targetGenders ?? []);
  if (taxonomyFits.length) return taxonomyFits;
  if (APPROVED_FITS_BY_HANDLE[product.id]) return [...APPROVED_FITS_BY_HANDLE[product.id]];
  const explicitName = `${product.name} ${product.id}`;
  const titleFits: ProductFit[] = [];
  if (/\bmen(?:[’']s|s)?\b/i.test(explicitName)) titleFits.push("mens");
  if (/\bwomen(?:[’']s|s)?\b/i.test(explicitName)) titleFits.push("womens");
  if (/\bunisex\b/i.test(product.name)) titleFits.push("unisex");
  return titleFits;
}

/** Preserve an explicit catalog cut when opening a product with Fit variants. */
export function getCatalogFitSelection(product: Product, fit: CatalogFit): string | undefined {
  if (fit === "all") return undefined;
  return (product.options ?? []).find(({ name }) => name.toLowerCase() === "fit")
    ?.values.find((value) => fitFromLabel(value) === fit);
}

/** Use Shopify membership, not product names, to assign story collections. */
export function getCollectionFilters(products: Product[]): ProductCollection[] {
  const collections = new Map<string, ProductCollection>();
  for (const product of products) {
    for (const collection of product.collections ?? []) {
      if (collection.handle && collection.title && !EXCLUDED_COLLECTIONS.has(collection.handle)) {
        collections.set(collection.handle, { handle: collection.handle, title: collection.title });
      }
    }
  }
  return [...collections.values()].sort((left, right) => {
    const leftIndex = COLLECTION_ORDER.indexOf(left.handle);
    const rightIndex = COLLECTION_ORDER.indexOf(right.handle);
    const leftRank = leftIndex < 0 ? COLLECTION_ORDER.length : leftIndex;
    const rightRank = rightIndex < 0 ? COLLECTION_ORDER.length : rightIndex;
    return leftRank - rightRank || left.title.localeCompare(right.title);
  });
}

/** Invalid or retired query values fall back to the unfiltered selection. */
export function normalizeCatalogFilters(input: CatalogFilterInput, products: Product[]): CatalogFilters {
  const category = CATALOG_CATEGORIES.find(({ id }) => id === input.category)?.id ?? "all";
  const collection = getCollectionFilters(products).some(({ handle }) => handle === input.collection)
    ? input.collection!
    : "";
  const fit = CATALOG_FITS.find(({ id }) => id === input.fit)?.id ?? "all";
  return { category, collection, fit };
}

export function filterCatalogProducts(products: Product[], input: CatalogFilterInput): Product[] {
  const { category, collection, fit } = normalizeCatalogFilters(input, products);
  const matching = products.filter((product) =>
    (category === "all" || getProductCategory(product) === category)
    && (collection === "" || product.collections?.some(({ handle }) => handle === collection))
    && (fit === "all" || getProductFits(product).includes(fit)),
  );
  // Feature Camo explicitly, without overriding filters or changing the order
  // of the remaining Shopify catalog.
  return [
    ...matching.filter(({ id }) => id === "camo-hoodie"),
    ...matching.filter(({ id }) => id !== "camo-hoodie"),
  ];
}

/** Change catalog filters without dropping inbound campaign attribution. */
export function catalogFiltersHref(pathname: string, currentSearch: string, filters: CatalogFilters): string {
  const query = new URLSearchParams(currentSearch);
  for (const key of ["category", "collection", "fit"] as const) {
    if (!filters[key] || filters[key] === "all") query.delete(key);
    else query.set(key, filters[key]);
  }
  return `${pathname}${query.size ? `?${query}` : ""}`;
}
