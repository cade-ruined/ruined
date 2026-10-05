import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMemberRegistrationDestination } from "@/lib/membership/registration-repository";
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
  if (context.state === "authenticated") {
    if (!context.viewer) return <PlatformUnavailable accessHref="/my/access" />;
    let registrationDestination: string | null;
    try {
      registrationDestination = await getMemberRegistrationDestination(context.viewer.authUserId);
    } catch (error) {
      console.error("Registration completion access could not be checked", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      return <PlatformUnavailable accessHref="/my/access" />;
    }
    if (registrationDestination) redirect(registrationDestination);
  }
  if (context.member?.billingState === "active") redirect("/my");

  return (
    <main className="member-journey-page member-confirmation-page min-h-[70vh] text-[var(--member-muted)]">
      <div className="mx-auto max-w-4xl border-t border-[var(--member-rule)] pt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">
          Confirmation in progress
        </p>
        <h1 className="mt-12 font-[var(--font-display)] text-[clamp(3.7rem,10vw,8rem)] leading-[0.84] tracking-[-0.055em]">
          Confirmation in progress.
        </h1>
        <p className="mt-8 max-w-xl text-base leading-relaxed text-[var(--member-muted)]">
          Stripe is confirming your checkout. Check Membership billing for the confirmed payment status. Your profile opens separately when Ruined releases it.
        </p>
        <Link className="mt-10 inline-flex border-b border-[var(--member-rule)] pb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--member-muted)]" href="/my/activate">
          Check membership billing
        </Link>
        <p className="mt-6 max-w-lg text-xs leading-relaxed text-[var(--member-muted)]">
          If billing confirmation is still pending, wait a moment and check again. Returning from Checkout does not itself confirm payment or open profile access.
        </p>
      </div>
    </main>
  );
}
