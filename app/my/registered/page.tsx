import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MemberRegistrationReceipt from "@/components/membership/MemberRegistrationReceipt";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { getMemberRegistration } from "@/lib/membership/registration-repository";
import { memberRegistrationPreview } from "@/lib/membership/preview-scenarios";
import { memberRegistrationDestination } from "@/lib/membership/registration-routing";
import { hasEligibleExplicitExperienceInvitations } from "@/lib/platform/experience-member-access";

export const metadata: Metadata = { title: "You’re registered | Ruined", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MemberRegisteredPage() {
  const context = await getMembershipPageContext<{ registration: Awaited<ReturnType<typeof getMemberRegistration>>; invitedCalendarAvailable: boolean }>(
    { registration: memberRegistrationPreview("registered"), invitedCalendarAvailable: false },
    async authUserId => {
      const registration = await getMemberRegistration(authUserId);
      let invitedCalendarAvailable = false;
      if (registration?.state === "registered" && registration.ready) {
        try {
          invitedCalendarAvailable = await hasEligibleExplicitExperienceInvitations(authUserId);
        } catch (error) {
          // Calendar is an optional next step. Its availability must not hide a
          // registration that has already been confirmed by the server.
          console.error("Registration calendar availability could not be loaded", {
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        }
      }
      return { registration, invitedCalendarAvailable };
    },
    "registration",
  );
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  const registration = context.data.registration;
  if (!registration || registration.state === "activated") redirect("/my");
  const paidCheckoutAvailable = context.configuration.stripeActivationReady || context.configuration.stripeCheckoutReady;
  if (!registration.ready) redirect(memberRegistrationDestination(registration, paidCheckoutAvailable) ?? "/my");
  if (registration.state !== "registered") return <main className="mx-auto min-h-[72vh] max-w-3xl px-5 pb-16 pt-10 text-[var(--member-ink)] sm:px-8 sm:pt-16">
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--member-red)]">Ruined membership</p>
    <h1 className="mt-4 font-[var(--font-display)] text-[clamp(2.5rem,7vw,3.75rem)] leading-[1.04] tracking-[-0.04em]">Your registration needs a final check.</h1>
    <p className="mt-6 text-base leading-relaxed text-[var(--member-muted)]">Your information is saved, but registration is not complete yet. Contact us and we’ll help finish it.</p>
    <a className="mt-6 inline-flex min-h-12 items-center border border-current px-5 py-3 text-sm font-semibold" href="mailto:connect@theruinedproject.com">Contact Ruined</a>
  </main>;
  return <MemberRegistrationReceipt
    email={context.viewer?.email ?? "you@example.com"}
    registeredAt={registration.registeredAt}
    requiresPaymentMethod={registration.requiresPaymentMethod}
    foundingPricing={registration.foundingPricing}
    initialPayment={registration.initialPayment}
    preview={context.state === "preview"}
    activationAvailable={paidCheckoutAvailable || context.state === "preview"}
    invitedCalendarAvailable={context.data.invitedCalendarAvailable}
  />;
}
