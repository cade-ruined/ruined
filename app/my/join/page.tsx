import type { Metadata } from "next";
import { redirect } from "next/navigation";

import JoinForm from "@/components/membership/JoinForm";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMemberPageContext } from "@/lib/platform/page-data";

export const metadata: Metadata = {
  title: "Join My Ruined",
  description: "Start a Ruined membership through secure Stripe Checkout.",
};
export const dynamic = "force-dynamic";

export default async function JoinMyRuinedPage() {
  const context = await getMemberPageContext();
  if (context.state === "signed_out") redirect("/my/access");
  if (!context.member) return <PlatformUnavailable accessHref="/my/access" />;

  const eligibleState =
    context.member.billingState === "pending" || context.member.billingState === "ended";
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
    <main className="grid min-h-[68vh] gap-14 border-t border-white/15 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:gap-24">
      <div>
        <div className="flex items-center justify-between gap-6 font-mono text-[0.58rem] uppercase tracking-[0.22em] text-white/40">
          <span>My Ruined / Membership</span>
          <span>Entry 01</span>
        </div>
        <h1 className="mt-16 max-w-4xl font-[var(--font-header)] text-[clamp(3.8rem,9vw,8.8rem)] font-bold uppercase leading-[0.78] tracking-[-0.065em]">
          Enter on purpose.
        </h1>
      </div>

      <section className="lg:pt-16" aria-labelledby="membership-entry-title">
        <p className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-[var(--color-poster)]">Self-serve membership</p>
        <h2 className="ui-heading mt-5 text-3xl font-semibold tracking-[-0.03em]" id="membership-entry-title">Membership entry</h2>
        <p className="mt-5 text-sm leading-relaxed text-white/52">
          Your verified account supplies the identity. Stripe remains responsible for the final recurring price, interval, tax, and payment details.
        </p>
        <JoinForm
          disabledReason={enabled ? null : disabledReason}
          email={context.member.email}
          enabled={enabled}
          minimumAge={context.configuration.minimumAge}
        />
      </section>
    </main>
  );
}
