import type { Metadata } from "next";
import StoreGallery from "@/components/store/StoreGallery";
import { getProducts } from "@/lib/shopify";

export const metadata: Metadata = {
  title: "Store · Artifacts",
  description:
    "Drop 01 / SS26 — the full Artifacts catalogue. Four pieces, hand-finished, made in small numbers.",
  alternates: { canonical: "/store" },
};

// ISR: rebuild the catalogue at most hourly. For instant updates, point a
// Shopify `products/update` webhook at /api/revalidate (see that route).
export const revalidate = 3600;

export default async function StorePage() {
  const products = await getProducts();
  const dropEnd = process.env.NEXT_PUBLIC_DROP_END;
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ruined.studio";
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Ruined · Artifacts",
    itemListElement: products.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Product",
        name: product.name,
        description: product.description,
        image: product.image?.url,
        sku: product.code,
        url: `${base}/store#${product.id}`,
        offers: {
          "@type": "Offer",
          availability: product.available
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        },
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(productSchema).replace(/</g, "\\u003c"),
        }}
      />
      <StoreGallery products={products} dropEnd={dropEnd} />
    </>
  );
}
