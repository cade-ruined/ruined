import ImmersiveParallax from "@/components/ImmersiveParallax";
import MobileImmersiveJourney from "@/components/MobileImmersiveJourney";
import { getProducts } from "@/lib/shopify";

// The portrait journey is the resilient server-rendered homepage. Fine-pointer
// desktops progressively upgrade to the frame-sequence dive; touch devices and
// reduced-motion visitors keep the lightweight native-scroll experience.
export const revalidate = 3600;

export default async function Page() {
  const products = await getProducts();
  return (
    <ImmersiveParallax
      products={products}
      fallback={<MobileImmersiveJourney />}
    />
  );
}
