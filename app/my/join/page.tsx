import type { Metadata } from "next";
import { redirect } from "next/navigation";

import JoinForm from "@/components/membership/JoinForm";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_ONBOARDING } from "@/lib/membership/preview";
import { getMemberOnboarding } from "@/lib/membership/repository";
import { getStripePublishableKey } from "@/lib/platform/config";

export const metadata: Metadata = {
  title: "Enter Ruined Membership",
  description: "Complete the administrative side of Ruined Membership.",
};
export const dynamic = "force-dynamic";

export default async function JoinMyRuinedPage() {
  const context = await getMembershipPageContext(
    PREVIEW_MEMBER_ONBOARDING,
    getMemberOnboarding,
    "entry",
  );
  if (context.state === "signed_out") redirect("/my/access");
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
    <main className="grid min-h-[72vh] gap-14 border-t border-white/15 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,38rem)] lg:gap-20">
      <div>
        <div className="flex items-center justify-between gap-6 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
          <span>Ruined Membership</span>
          <span>Administrative entry</span>
        </div>
        <h1 className="mt-16 max-w-4xl font-[var(--font-display)] text-[clamp(3.8rem,9vw,8.8rem)] leading-[0.84] tracking-[-0.055em]">
          Your place begins here.
        </h1>
        <p className="mt-9 max-w-xl text-base leading-relaxed text-white/58">
          Your email is confirmed. Save the practical details, accept the exact published agreement, then complete secure payment. Most people finish in five to seven minutes.
        </p>
        <div className="mt-14 aspect-[16/10] max-w-3xl border border-white/15 bg-[#171310] p-5">
          <div className="flex h-full items-end border-l border-white/18 pl-5">
            <p className="font-[var(--font-handwritten)] text-xl text-[var(--color-poster)]">
              MEMBER PORTRAIT / ARRIVAL
            </p>
          </div>
        </div>
      </div>

      <section className="lg:pt-16" aria-labelledby="membership-entry-title">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">
          Three thresholds
        </p>
        <h2 className="mt-5 font-[var(--font-display)] text-4xl tracking-[-0.03em]" id="membership-entry-title">
          Membership entry
        </h2>
        <p className="mt-5 text-sm leading-relaxed text-white/52">
          Private administrative details remain separate from what your Circle can see.
        </p>
        <JoinForm
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
