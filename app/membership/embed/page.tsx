import type { Metadata } from "next";
import MembershipEmbed from "@/components/public-members/MembershipEmbed";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const metadata: Metadata = {
  title: "Membership",
  robots: { index: false, follow: false },
  alternates: { canonical: "https://members.theruinedproject.com/membership" },
};

export default async function MembershipEmbedPage({ searchParams }: { searchParams: Promise<{ preview?: string | string[] }> }) {
  const params = await searchParams;
  const configuration = getPlatformConfiguration();
  const setupPreview = configuration.mode === "preview" && params.preview === "payment-setup";
  return <MembershipEmbed
    prepaymentRequired={configuration.membershipPrepaymentRequired}
    registrationOnly={configuration.membershipRegistrationOnly || setupPreview}
    preview={configuration.mode === "preview"}
    signupEnabled={configuration.mode === "connected" && configuration.membershipSignupReady === true}
    paymentSetupOnly={setupPreview || (configuration.membershipSignupReady === true && !configuration.stripeCheckoutReady)}
  />;
}
