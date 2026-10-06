import type { Metadata } from "next";
import MembershipOverview from "@/components/public-members/MembershipOverview";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const metadata: Metadata = {
  title: "Membership",
  description: "Start with Foundations: four live virtual sessions, completed once. Explore Ruined’s monthly work, small Circles, membership pricing, and your personal invitation.",
};

export default async function MembershipOverviewPage({ searchParams }: { searchParams: Promise<{ preview?: string | string[] }> }) {
  const params = await searchParams;
  const configuration = getPlatformConfiguration();
  return <MembershipOverview prepaymentRequired={configuration.membershipPrepaymentRequired} registrationOnly={configuration.membershipRegistrationOnly || (configuration.mode === "preview" && params?.preview === "payment-setup")} preview={configuration.mode === "preview"} signupEnabled={configuration.mode === "connected" && configuration.membershipSignupReady === true} paymentSetupOnly={(configuration.mode === "preview" && params?.preview === "payment-setup") || (configuration.membershipSignupReady === true && !configuration.stripeCheckoutReady)} />;
}
