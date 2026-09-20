import type { Metadata } from "next";
import Image from "next/image";
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
import { getStripePublishableKey } from "@/lib/platform/config";

export const metadata: Metadata = {
  title: "Enter Ruined Membership",
  description: "Complete your Ruined Membership profile.",
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
  const complimentary = context.data.membershipFunding === "operator" || context.data.membershipFunding === "complimentary";
  if (context.state === "authenticated" && context.data.state === "completed"
    && (complimentary || context.data.billingState === "active")) {
    redirect("/my");
  }

  const publishableKey = getStripePublishableKey();
  const writable = context.state === "authenticated";
  const checkoutEnabled = writable && !complimentary && context.configuration.stripeCheckoutReady;
  const disabledReason =
    context.state === "preview"
      ? "Preview only. Member details and agreement acceptance are not saved."
      : writable
        ? null
        : "Membership entry is temporarily unavailable.";
  const checkoutDisabledReason = checkoutEnabled
    ? null
    : context.state === "preview"
      ? "Preview only. Connect Supabase, Postgres, and Stripe to open payment."
      : "Stripe membership payment is not fully configured yet.";
  const initialStage = membershipEntryStage(
    context.data.requiredFieldsComplete,
    Boolean(context.data.agreement.acceptanceId),
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
          <MembershipEntryProgress complimentary={complimentary} />
          <JoinForm
            checkoutDisabledReason={checkoutDisabledReason}
            checkoutEnabled={checkoutEnabled}
            disabledReason={disabledReason}
            enabled={writable}
            initialOnboarding={context.data}
            minimumAge={context.configuration.minimumAge}
            photoStorageReady={isMemberPhotoStorageConfigured()}
            publishableKey={publishableKey}
          />
        </section>
      </MembershipEntryProgressProvider>
    </main>
  );
}
