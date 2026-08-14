import ImmersiveParallax from "@/components/ImmersiveParallax";
import MobileImmersiveJourney from "@/components/MobileImmersiveJourney";
import LobbyPopupSequence from "@/components/LobbyPopupSequence";

// The portrait journey is the resilient server-rendered homepage. Fine-pointer
// desktops progressively upgrade to the scroll-scrubbed dive; touch devices
// keep a lightweight, single-viewport swipe journey.
export const revalidate = 3600;

export default async function Page() {
  return (
    <>
      <ImmersiveParallax
        fallback={<MobileImmersiveJourney />}
      />
      <LobbyPopupSequence />
    </>
  );
}
