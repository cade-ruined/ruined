import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMemberPageContext } from "@/lib/platform/page-data";
import { privateSharingMetadata } from "@/lib/sharing";

export const metadata: Metadata = {
  ...privateSharingMetadata,
  title: "Payment confirmation",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MembershipCheckoutCompletePage() {
  const context = await getMemberPageContext();
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (context.state === "unavailable") return <PlatformUnavailable accessHref="/my/access" />;
  if (context.member?.billingState === "active") redirect("/my");

  return (
    <main className="member-journey-page member-confirmation-page min-h-[70vh] text-[var(--member-muted)]">
      <div className="mx-auto max-w-4xl border-t border-[var(--member-rule)] pt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">
          Confirmation in progress
        </p>
        <h1 className="mt-12 font-[var(--font-display)] text-[clamp(3.7rem,10vw,8rem)] leading-[0.84] tracking-[-0.055em]">
          The door is opening.
        </h1>
        <p className="mt-8 max-w-xl text-base leading-relaxed text-[var(--member-muted)]">
          Stripe is confirming your payment now. Ruined Membership opens as soon as that secure confirmation reaches us.
        </p>
        <Link className="mt-10 inline-flex border-b border-[var(--member-rule)] pb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--member-muted)]" href="/my">
          Enter Ruined Membership
        </Link>
        <p className="mt-6 max-w-lg text-xs leading-relaxed text-[var(--member-muted)]">
          If the membership home is not ready yet, wait a moment and open it again. The return screen never activates access by itself.
        </p>
      </div>
    </main>
  );
}
