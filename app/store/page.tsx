import type { Metadata } from "next";
import StoreGallery from "@/components/store/StoreGallery";
import { getCatalog } from "@/lib/shopify";
import { sharingMetadata } from "@/lib/sharing";

// Shopify is the source of truth. Do not preserve a build-time empty catalogue
// while a Draft product is being prepared for a later Headless release.
export const dynamic = "force-dynamic";

const description = "Shop Ruined apparel: hoodies, tees, tanks, and everyday pieces. Explore the collection, materials, fit, and available colors.";

export const metadata: Metadata = {
  title: "Store",
  description,
  alternates: { canonical: "/store" },
  ...sharingMetadata({
    title: "Store",
    description,
    path: "/store",
  }),
};

export default async function StorePage() {
  const catalog = await getCatalog();

  return <StoreGallery products={catalog.products} catalogStatus={catalog.status} />;
}
