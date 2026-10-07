import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MemberRegistrationReceipt from "@/components/membership/MemberRegistrationReceipt";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { getMemberRegistration } from "@/lib/membership/registration-repository";
import { memberRegistrationPreview } from "@/lib/membership/preview-scenarios";
import { memberRegistrationDestination } from "@/lib/membership/registration-routing";

export const metadata: Metadata = { title: "You’re registered | Ruined", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MemberRegisteredPage() {
  const context = await getMembershipPageContext<{ registration: Awaited<ReturnType<typeof getMemberRegistration>> }>(
    { registration: memberRegistrationPreview("registered") },
    async authUserId => ({ registration: await getMemberRegistration(authUserId) }),
    "registration",
  );
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  const registration = context.data.registration;
  if (!registration || registration.state === "activated") redirect("/my");
  const paidCheckoutAvailable = context.configuration.stripeActivationReady || context.configuration.stripeCheckoutReady;
  if (!registration.ready) redirect(memberRegistrationDestination(registration, paidCheckoutAvailable) ?? "/my");
  if (registration.state !== "registered") return <PlatformUnavailable accessHref="/my/activate" />;
  return <MemberRegistrationReceipt
    email={context.viewer?.email ?? "you@example.com"}
    registeredAt={registration.registeredAt}
    requiresPaymentMethod={registration.requiresPaymentMethod}
    foundingPricing={registration.foundingPricing}
    initialPayment={registration.initialPayment}
    preview={context.state === "preview"}
    activationAvailable={paidCheckoutAvailable || context.state === "preview"}
  />;
}
