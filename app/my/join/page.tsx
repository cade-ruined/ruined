import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";

import JoinForm from "@/components/membership/JoinForm";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { isAddressLookupConfigured } from "@/lib/membership/address-provider";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_ONBOARDING } from "@/lib/membership/preview";
import { getMemberOnboarding } from "@/lib/membership/repository";
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
  if (context.state === "authenticated" && context.data.state === "completed") {
    redirect("/my");
  }

  const publishableKey = getStripePublishableKey();
  const writable = context.state === "authenticated";
  const checkoutEnabled = writable && context.configuration.stripeCheckoutReady;
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

  return (
    <main className="min-h-[72vh]">
      <section className="relative isolate min-h-[22rem] overflow-hidden sm:min-h-[26rem] lg:min-h-[28rem]">
        <Image
          alt="A figure moving through a monumental concrete passage toward the light."
          className="object-cover object-center"
          fill
          priority
          sizes="(min-width: 1536px) 1472px, calc(100vw - 2rem)"
          src="/after-the-fear-hero.webp"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />
        <h1 className="absolute inset-x-5 bottom-7 max-w-5xl font-[var(--font-display)] text-[clamp(3.6rem,8vw,8rem)] leading-[0.86] tracking-[-0.055em] text-[var(--color-bone)] sm:inset-x-10 sm:bottom-10">
          Your place begins here.
        </h1>
      </section>

      <section className="mx-auto mt-14 w-full max-w-4xl sm:mt-20" aria-labelledby="membership-entry-title">
        <h2 className="font-[var(--font-display)] text-4xl tracking-[-0.03em] sm:text-5xl" id="membership-entry-title">
          Membership entry
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/52">
          These details stay private and never appear on your Circle profile.
        </p>
        <JoinForm
          addressLookupEnabled={
            context.state === "preview" || isAddressLookupConfigured()
          }
          checkoutDisabledReason={checkoutDisabledReason}
          checkoutEnabled={checkoutEnabled}
          disabledReason={disabledReason}
          enabled={writable}
          initialOnboarding={context.data}
          minimumAge={context.configuration.minimumAge}
          publishableKey={publishableKey}
        />
      </section>
    </main>
  );
}
