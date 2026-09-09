import "server-only";
import { unstable_cache } from "next/cache";
import { getCatalog, isShopifyConfigured } from "@/lib/shopify";
import type { CatalogResult } from "./catalog";

const HOMEPAGE_CATALOG_REVALIDATE_SECONDS = 60;
const HOMEPAGE_CATALOG_MAX_AGE_MS = 120_000;

// Cache the optional homepage teaser, not product detail or purchase checks.
// Next only writes the value after this callback returns successfully.
const readCachedHomepageCatalog = unstable_cache(
  async () => {
    const catalog = await getCatalog();
    if (catalog.status !== "ready" && catalog.status !== "empty") {
      throw new Error("The public catalog is unavailable.");
    }
    return { catalog, fetchedAt: Date.now() };
  },
  ["ruined-homepage-catalog-v1", process.env.SHOPIFY_STORE_DOMAIN ?? "unconfigured"],
  { revalidate: HOMEPAGE_CATALOG_REVALIDATE_SECONDS },
);

export async function getHomepageCatalog(): Promise<CatalogResult> {
  if (!isShopifyConfigured) return { status: "unconfigured", products: [] };
  try {
    const { catalog, fetchedAt } = await readCachedHomepageCatalog();
    // Next may retain a stale success when background revalidation fails.
    // Give one refresh window, then hide the promotion instead of keeping
    // an old price or availability claim alive through an extended outage.
    if (Date.now() - fetchedAt > HOMEPAGE_CATALOG_MAX_AGE_MS) {
      return { status: "unavailable", products: [] };
    }
    return catalog;
  } catch {
    // Keep failures outside the cache: the next visit may retry immediately.
    return { status: "unavailable", products: [] };
  }
}
