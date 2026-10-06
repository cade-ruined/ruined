import type { Metadata } from "next";
import MembershipSignupPage from "@/components/public-members/MembershipSignupPage";
import { isMembershipBillingPlan } from "@/lib/membership/pricing";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const metadata: Metadata = {
  title: "Join Ruined",
  description: "Create your personal invitation, confirm your email with a code, and join Ruined.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: {
  searchParams: Promise<{ plan?: string | string[]; preview?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedPlan = params.plan;
  const configuration = getPlatformConfiguration();
  const setupPreview = configuration.mode === "preview" && params.preview === "payment-setup";
  return <MembershipSignupPage
    prepaymentRequired={configuration.membershipPrepaymentRequired} registrationOnly={configuration.membershipRegistrationOnly || setupPreview}
    initialPlan={isMembershipBillingPlan(requestedPlan) ? requestedPlan : "monthly"}
    enabled={configuration.mode === "connected" && configuration.membershipSignupReady === true}
    paymentSetupOnly={setupPreview || (configuration.membershipSignupReady === true && !configuration.stripeCheckoutReady)}
    preview={configuration.mode === "preview"}
    previewInvitation={configuration.mode === "preview" && (params.preview === "invitation" || setupPreview)}
  />;
}
