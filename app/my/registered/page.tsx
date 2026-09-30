import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MemberRegistrationReceipt from "@/components/membership/MemberRegistrationReceipt";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { getMemberRegistration } from "@/lib/membership/registration-repository";
import { memberRegistrationPreview } from "@/lib/membership/preview-scenarios";

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
  if (!registration.ready || registration.state !== "registered") redirect(registration.profileComplete ? "/my/payment-method" : "/my/join");
  return <MemberRegistrationReceipt
    email={context.viewer?.email ?? "you@example.com"}
    registeredAt={registration.registeredAt}
    requiresPaymentMethod={registration.requiresPaymentMethod}
    preview={context.state === "preview"}
  />;
}
