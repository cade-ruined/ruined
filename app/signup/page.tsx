import type { Metadata } from "next";
import MembershipSignupPage from "@/components/public-members/MembershipSignupPage";
import { isMembershipBillingPlan } from "@/lib/membership/pricing";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const metadata: Metadata = {
  title: "Join Ruined",
  description: "Request your personal invitation, verify your email, and join Ruined.",
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
  return <MembershipSignupPage
    initialPlan={isMembershipBillingPlan(requestedPlan) ? requestedPlan : "monthly"}
    enabled={configuration.mode === "connected" && configuration.stripeCheckoutReady}
    preview={configuration.mode === "preview"}
    previewInvitation={configuration.mode === "preview" && params.preview === "invitation"}
  />;
}
