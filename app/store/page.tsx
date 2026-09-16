import type { Metadata } from "next";
import StoreGallery from "@/components/store/StoreGallery";
import { getProducts } from "@/lib/shopify";
import { sharingMetadata } from "@/lib/sharing";

// Shopify is the source of truth. Do not preserve a build-time empty catalogue
// while a Draft product is being prepared for a later Headless release.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Store",
  description: "Apparel from Ruined.",
  alternates: { canonical: "/store" },
  ...sharingMetadata({
    title: "Store",
    description: "Apparel from Ruined.",
    path: "/store",
  }),
};

export default async function StorePage() {
  const products = await getProducts();

  return <StoreGallery products={products} />;
}
