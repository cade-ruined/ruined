import type { Product } from "@/data/products";

export type CatalogStatus = "ready" | "empty" | "unavailable" | "unconfigured";

export type CatalogResult = {
  status: CatalogStatus;
  products: Product[];
};

// Public copy deliberately does not expose provider configuration or errors.
export function catalogNotice(status: CatalogStatus) {
  if (status === "empty") {
    return {
      heading: "No pieces listed right now.",
      detail: "Check back for the next release, or get in touch with Ruined.",
      retry: false,
    };
  }

  return {
    heading: "We couldn’t load the catalog.",
    detail: "Try again, or get in touch if you need help with a piece.",
    retry: true,
  };
}
