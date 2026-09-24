import type { Metadata } from "next";
import MembershipOverview from "@/components/public-members/MembershipOverview";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const metadata: Metadata = {
  title: "Membership",
  description: "Good company. Real work. Explore Ruined membership, what’s included, and how to join.",
};

export default function MembershipOverviewPage() {
  const configuration = getPlatformConfiguration();
  return <MembershipOverview preview={configuration.mode === "preview"} signupEnabled={configuration.mode === "connected" && configuration.stripeCheckoutReady} />;
}
