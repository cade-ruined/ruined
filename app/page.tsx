import ImmersiveParallax from "@/components/ImmersiveParallax";
import StoreSection from "@/components/sections/StoreSection";
import WorkSection from "@/components/sections/WorkSection";
import AboutSection from "@/components/sections/AboutSection";

export default function Page() {
  return (
    <>
      <ImmersiveParallax />
      <StoreSection />
      <WorkSection />
      <AboutSection />
    </>
  );
}
