import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getMemberPageContext } from "@/lib/platform/page-data";

export const metadata: Metadata = {
  title: "Payment confirmation",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MembershipCheckoutCompletePage() {
  const context = await getMemberPageContext();
  if (context.state === "signed_out") redirect("/my/access");
  if (context.member?.billingState === "active") redirect("/my");

  return (
    <main className="min-h-[70vh] text-white">
      <div className="mx-auto max-w-4xl border-t border-white/20 pt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">
          Confirmation in progress
        </p>
        <h1 className="mt-12 font-[var(--font-display)] text-[clamp(3.7rem,10vw,8rem)] leading-[0.84] tracking-[-0.055em]">
          The door is opening.
        </h1>
        <p className="mt-8 max-w-xl text-base leading-relaxed text-white/58">
          Stripe is confirming your payment now. Ruined Membership opens as soon as that secure confirmation reaches us.
        </p>
        <Link className="mt-10 inline-flex border-b border-white/40 pb-1 text-xs font-semibold uppercase tracking-[0.16em] text-white" href="/my">
          Enter Ruined Membership
        </Link>
        <p className="mt-6 max-w-lg text-xs leading-relaxed text-white/38">
          If the membership home is not ready yet, wait a moment and open it again. The return screen never activates access by itself.
        </p>
      </div>
    </main>
  );
}
