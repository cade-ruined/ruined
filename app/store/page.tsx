import type { Metadata } from "next";
import StoreGallery from "@/components/store/StoreGallery";
import { getProducts } from "@/lib/shopify";

// Shopify is the source of truth. Do not preserve a build-time empty catalogue
// while a Draft product is being prepared for a later Headless release.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Store",
  description: "Garments and objects from Ruined.",
  alternates: { canonical: "/store" },
};

export default async function StorePage() {
  const products = await getProducts();

  return <StoreGallery products={products} />;
}
