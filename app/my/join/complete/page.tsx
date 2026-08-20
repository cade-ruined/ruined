import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Payment confirmation",
  robots: { index: false, follow: false },
};

export default function MembershipCheckoutCompletePage() {
  return (
    <main className="min-h-screen bg-[#080605] px-5 pb-20 pt-[calc(var(--ruined-header-height)+4rem)] text-white sm:px-8 lg:px-12">
      <div className="mx-auto max-w-3xl border-t border-white/20 pt-5">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.24em] text-[var(--color-poster)]">
          Confirmation in progress
        </p>
        <h1 className="mt-12 font-[var(--font-header)] text-[clamp(3.7rem,10vw,8rem)] font-bold uppercase leading-[0.8] tracking-[-0.06em]">
          Almost inside.
        </h1>
        <p className="mt-8 max-w-xl text-base leading-relaxed text-white/58">
          Stripe is confirming the paid invoice now. Membership access opens only after that verified confirmation reaches Ruined—not from this page alone.
        </p>
        <Link className="mt-10 inline-flex border-b border-white/40 pb-1 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-white" href="/my">
          Return to My Ruined
        </Link>
      </div>
    </main>
  );
}
