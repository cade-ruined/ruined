import type { Metadata } from "next";

import MemberEmailConfirmationStatus from "@/components/platform/MemberEmailConfirmationStatus";

export const metadata: Metadata = {
  title: "Email confirmation",
  description: "Review the status of a My Ruined email confirmation.",
  referrer: "no-referrer",
};

export default function MyRuinedEmailConfirmedPage() {
  return (
    <main className="grid min-h-[68vh] gap-14 border-t border-white/15 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:gap-24">
      <div>
        <p className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-white/40">
          My Ruined / Email
        </p>
        <h1 className="mt-12 max-w-4xl font-[var(--font-header)] text-[clamp(3.8rem,9vw,8.5rem)] font-bold uppercase leading-[0.78] tracking-[-0.06em]">
          Email.
        </h1>
      </div>

      <MemberEmailConfirmationStatus />
    </main>
  );
}
