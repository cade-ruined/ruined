import ImmersiveParallax from "@/components/ImmersiveParallax";
import MobileImmersiveJourney from "@/components/MobileImmersiveJourney";
import { getHomepageCatalog } from "@/lib/store/homepage-catalog";

// The portrait journey is the resilient server-rendered homepage. Fine-pointer
// desktops progressively upgrade to the scroll-scrubbed dive; touch devices
// keep a lightweight, single-viewport swipe journey.
// Cache successful catalog teasers briefly, but never cache a failed page read.
export const dynamic = "force-dynamic";

export default async function Page() {
  const catalog = await getHomepageCatalog();
  const products = catalog.products;

  return (
    <>
      <ImmersiveParallax
        products={products}
        catalogStatus={catalog.status}
        fallback={<MobileImmersiveJourney products={products} catalogStatus={catalog.status} />}
      />
    </>
  );
}
