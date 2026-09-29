import type { Metadata } from "next";
import MembershipOverview from "@/components/public-members/MembershipOverview";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const metadata: Metadata = {
  title: "Membership",
  description: "Good company. Real work. Explore Ruined membership, what’s included, and how to join.",
};

export default async function MembershipOverviewPage({ searchParams }: { searchParams: Promise<{ preview?: string | string[] }> }) {
  const params = await searchParams;
  const configuration = getPlatformConfiguration();
  return <MembershipOverview preview={configuration.mode === "preview"} signupEnabled={configuration.mode === "connected" && configuration.membershipSignupReady === true} paymentSetupOnly={(configuration.mode === "preview" && params?.preview === "payment-setup") || (configuration.membershipSignupReady === true && !configuration.stripeCheckoutReady)} />;
}
