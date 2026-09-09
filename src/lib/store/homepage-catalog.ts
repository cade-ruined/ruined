import "server-only";
import { getCatalog } from "@/lib/shopify";
import type { CatalogResult } from "./catalog";

// Use the same bounded, fresh read as the Store. The optional homepage cache
// failed in production while direct Store reads remained healthy; a teaser
// must not hide a working catalog because of a separate cache dependency.
export async function getHomepageCatalog(): Promise<CatalogResult> {
  return getCatalog();
}
