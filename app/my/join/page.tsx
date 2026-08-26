import type { Metadata } from "next";
import { redirect } from "next/navigation";

import JoinForm from "@/components/membership/JoinForm";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getStripePublishableKey } from "@/lib/platform/config";
import { getMemberPageContext } from "@/lib/platform/page-data";

export const metadata: Metadata = {
  title: "Enter Ruined Membership",
  description: "Complete Ruined Membership entry through secure payment.",
};
export const dynamic = "force-dynamic";

export default async function JoinMyRuinedPage() {
  const context = await getMemberPageContext();
  if (context.state === "signed_out") redirect("/my/access");
  if (!context.member) return <PlatformUnavailable accessHref="/my/access" />;
  if (
    context.state === "authenticated" &&
    (context.member.billingState === "active" ||
      context.member.billingState === "attention_required")
  ) {
    redirect("/my");
  }

  const eligibleState =
    context.member.billingState === "pending" || context.member.billingState === "ended";
  const publishableKey = getStripePublishableKey();
  const enabled =
    context.state === "authenticated" &&
    context.configuration.stripeCheckoutReady &&
    eligibleState;
  const disabledReason =
    context.state === "preview"
      ? "Preview only. Connect Supabase, Postgres, and Stripe to open Checkout."
      : !eligibleState
        ? "A new Checkout session is not available for this membership state."
        : "Stripe membership Checkout is not fully configured yet.";

  return (
    <main className="grid min-h-[72vh] gap-14 border-t border-white/15 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)] lg:gap-20">
      <div>
        <div className="flex items-center justify-between gap-6 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
          <span>Ruined Membership</span>
          <span>Member entry</span>
        </div>
        <h1 className="mt-16 max-w-4xl font-[var(--font-display)] text-[clamp(3.8rem,9vw,8.8rem)] leading-[0.84] tracking-[-0.055em]">
          Your place begins here.
        </h1>
        <p className="mt-9 max-w-xl text-base leading-relaxed text-white/58">
          Your email is confirmed. Complete the membership agreement and secure payment to enter.
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
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">One threshold</p>
        <h2 className="mt-5 font-[var(--font-display)] text-4xl tracking-[-0.03em]" id="membership-entry-title">Membership entry</h2>
        <p className="mt-5 text-sm leading-relaxed text-white/52">
          Review the agreement, then complete payment without leaving Ruined Membership.
        </p>
        <JoinForm
          disabledReason={enabled ? null : disabledReason}
          email={context.member.email}
          enabled={enabled}
          minimumAge={context.configuration.minimumAge}
          publishableKey={publishableKey}
        />
      </section>
    </main>
  );
}
