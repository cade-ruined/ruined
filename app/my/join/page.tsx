import type { Metadata } from "next";
import Image from "next/image";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import JoinForm from "@/components/membership/JoinForm";
import {
  MembershipEntryProgress,
  MembershipEntryProgressProvider,
} from "@/components/membership/MembershipEntryProgress";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { membershipEntryStage } from "@/lib/membership/entry-stage";
import { PREVIEW_MEMBER_ONBOARDING } from "@/lib/membership/preview";
import { getMemberOnboarding } from "@/lib/membership/repository";
import { isMemberPhotoStorageConfigured } from "@/lib/membership/photos";
import { getMemberSignupPlan } from "@/lib/membership/public-signup-admission";
import { getMemberRegistration } from "@/lib/membership/registration-repository";
import { getMemberRegistrationLegalNotice } from "@/lib/membership/registration-legal";
import { MEMBER_PREVIEW_COOKIE, memberPreviewScenario, memberRegistrationPreview } from "@/lib/membership/preview-scenarios";
import { getStripePublishableKey } from "@/lib/platform/config";
import { memberRegistrationDestination, registrationPaymentDestination } from "@/lib/membership/registration-routing";

export const metadata: Metadata = {
  title: "Enter Ruined Membership",
  description: "Complete your registration for Ruined.",
};
export const dynamic = "force-dynamic";

export default async function JoinMyRuinedPage() {
  const context = await getMembershipPageContext(
    PREVIEW_MEMBER_ONBOARDING,
    getMemberOnboarding,
    "entry",
  );
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  const registration = context.state === "authenticated" && context.viewer
    ? await getMemberRegistration(context.viewer.authUserId)
    : context.state === "preview" ? memberRegistrationPreview(memberPreviewScenario((await cookies()).get(MEMBER_PREVIEW_COOKIE)?.value)) : null;
  const registrationOnly = Boolean(registration && registration.state !== "activated");
  const paidCheckoutAvailable = context.configuration.stripeActivationReady || context.configuration.stripeCheckoutReady;
  const registrationNextHref = registration ? registrationPaymentDestination(registration, paidCheckoutAvailable) : undefined;
  const registrationLegalNotice = registrationOnly && context.state === "authenticated" && context.viewer
    ? await getMemberRegistrationLegalNotice(context.viewer.authUserId)
    : null;
  const onboarding = registrationOnly && registration && (!registration.profileComplete || registrationLegalNotice)
    ? { ...context.data, requiredFieldsComplete: false }
    : context.data;
  if (context.state === "authenticated" && registrationOnly && registration && !registrationLegalNotice) {
    const destination = memberRegistrationDestination(registration, paidCheckoutAvailable);
    if (destination && destination !== "/my/join") redirect(destination);
  }
  const complimentary = context.data.membershipFunding === "operator" || context.data.membershipFunding === "complimentary";
  const sharedMembership = context.data.membershipFunding === "couple" && context.data.billingState === "active";
  if (!registrationOnly && context.state === "authenticated" && context.data.state === "completed"
    && (complimentary || context.data.billingState === "active")) {
    redirect("/my");
  }

  const initialPlan = context.state === "authenticated" && context.viewer
    ? await getMemberSignupPlan(context.viewer.authUserId) ?? "monthly"
    : "monthly";
  const publishableKey = getStripePublishableKey();
  const writable = context.state === "authenticated";
  const checkoutEnabled = !registrationOnly && writable && !complimentary && !sharedMembership && context.configuration.stripeCheckoutReady;
  const prelaunch = registrationOnly || !complimentary && !sharedMembership && context.data.billingState === "pending" && !checkoutEnabled;
  const disabledReason =
    context.state === "preview"
      ? registrationOnly ? "Preview only. Your details are not saved and no registration is created." : "Preview only. Member details and agreement acceptance are not saved."
      : writable
        ? null
        : "Membership entry is temporarily unavailable.";
  const checkoutDisabledReason = checkoutEnabled
    ? null
    : context.state === "preview"
      ? "Preview only. Connect Supabase, Postgres, and Stripe to open payment."
      : "Stripe membership payment is not fully configured yet.";
  const initialStage = membershipEntryStage(
    onboarding.requiredFieldsComplete,
    Boolean(onboarding.agreement.acceptanceId),
  );

  return (
    <main className="member-journey-page member-entry-page min-h-[72vh]">
      <MembershipEntryProgressProvider initialStage={initialStage}>
        <header className="member-entry-artwork relative isolate overflow-hidden" data-member-artwork>
          <Image
            alt="A figure moving through a monumental concrete passage toward the light."
            className="object-cover object-center"
            fill
            priority
            sizes="100vw"
            src="/after-the-fear-hero.webp"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />
          <h1 className="absolute inset-x-5 bottom-7 max-w-6xl sm:inset-x-10 sm:bottom-10">
            <span className="member-entry-title">
              Your place begins here.
            </span>
          </h1>
        </header>

        <section className="member-entry-fields" aria-label="Membership entry">
          {!prelaunch || registrationNextHref === "/my/activate" ? <MembershipEntryProgress complimentary={complimentary || sharedMembership} /> : <p className="py-4 text-xs uppercase tracking-[0.12em] text-[var(--member-muted)]">{registrationOnly ? "Registration / Your details" : "Your profile / Before launch"}</p>}
          <JoinForm
            checkoutDisabledReason={checkoutDisabledReason}
            checkoutEnabled={checkoutEnabled}
            registrationOnly={registrationOnly}
            registrationRequiresPaymentMethod={registration?.requiresPaymentMethod ?? true}
            registrationRequiresInitialPayment={registration?.requiresInitialPayment ?? false}
            registrationNextHref={registrationNextHref}
            registrationLegalNotice={registrationLegalNotice}
            disabledReason={disabledReason}
            enabled={writable}
            initialOnboarding={onboarding}
            initialPlan={initialPlan}
            minimumAge={context.configuration.minimumAge}
            photoStorageReady={isMemberPhotoStorageConfigured()}
            publishableKey={publishableKey}
            paymentSetupEnabled={context.configuration.stripePaymentSetupReady}
            preview={context.state === "preview"}
          />
        </section>
      </MembershipEntryProgressProvider>
    </main>
  );
}
