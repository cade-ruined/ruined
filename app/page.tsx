import ImmersiveParallax from "@/components/ImmersiveParallax";
import { getProducts } from "@/lib/shopify";

// The homepage IS the dive. Each room (store / records / lounge) is a
// scroll-pinned hold inside the parallax; the couch icons scrub the camera to
// the matching room, and each room's "Enter" button opens the full page
// (/store, /work, /events) for browsing. The store-room teaser shelf is fed by
// the same live Shopify catalogue as /store.
export const revalidate = 3600;

export default async function Page() {
  const products = await getProducts();
  return <ImmersiveParallax products={products} />;
}
