import type { Metadata } from "next";

import MemberEmailConfirmationStatus from "@/components/platform/MemberEmailConfirmationStatus";

export const metadata: Metadata = {
  title: "Email confirmation",
  description: "Review the status of a Ruined Membership email confirmation.",
  referrer: "no-referrer",
};

export default function MyRuinedEmailConfirmedPage() {
  return (
    <main className="grid min-h-[68vh] gap-14 border-t border-white/15 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:gap-24">
      <div>
        <p className="font-[var(--font-handwritten)] text-xl text-[var(--color-poster)]">
          RUINED MEMBERSHIP / EMAIL
        </p>
        <h1 className="mt-12 max-w-4xl font-[var(--font-display)] text-[clamp(3.8rem,9vw,8.5rem)] leading-[0.84] tracking-[-0.055em]">
          A place with your name on it.
        </h1>
      </div>

      <MemberEmailConfirmationStatus />
    </main>
  );
}
