import type { Metadata } from "next";
import MembershipSignupPage from "@/components/public-members/MembershipSignupPage";
import { isMembershipBillingPlan } from "@/lib/membership/pricing";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const metadata: Metadata = {
  title: "Join Ruined",
  description: "Choose your membership, verify your email, and join Ruined.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const requestedPlan = (await searchParams).plan;
  const configuration = getPlatformConfiguration();
  return <MembershipSignupPage
    initialPlan={isMembershipBillingPlan(requestedPlan) ? requestedPlan : "monthly"}
    enabled={configuration.mode === "connected" && configuration.stripeCheckoutReady}
    preview={configuration.mode === "preview"}
  />;
}
