import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import MemberPaymentMethod from "@/components/membership/MemberPaymentMethod";
import MemberSettingsHeader from "@/components/membership/MemberSettingsHeader";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_ONBOARDING } from "@/lib/membership/preview";
import { getMemberRegistration } from "@/lib/membership/registration-repository";
import { MEMBER_PREVIEW_COOKIE, memberPreviewScenario, memberRegistrationPreview } from "@/lib/membership/preview-scenarios";
import { getMemberOnboarding } from "@/lib/membership/repository";
import { registrationPaymentDestination } from "@/lib/membership/registration-routing";

export const metadata: Metadata = { title: "Payment method | Ruined", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MemberPaymentMethodPage({ searchParams }: { searchParams: Promise<{ setup?: string; view?: string }> }) {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_ONBOARDING, getMemberOnboarding, "payment-method");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  const registration = context.state === "authenticated" && context.viewer
    ? await getMemberRegistration(context.viewer.authUserId)
    : context.state === "preview" ? memberRegistrationPreview(memberPreviewScenario((await cookies()).get(MEMBER_PREVIEW_COOKIE)?.value)) : null;
  const registrationOnly = Boolean(registration && registration.state !== "activated");
  const query = await searchParams;
  const returnState = query.setup === "returned" || query.setup === "cancelled" ? query.setup : null;
  if (context.state === "authenticated" && registrationOnly && registration) {
    if (!registration.profileComplete) redirect("/my/join");
    if (registration.requiresInitialPayment) redirect("/my/activate");
    if (!registration.requiresPaymentMethod) redirect("/my/registered");
    // Existing setup returns and saved-card management remain available. A new
    // payment does not need a separate setup session first.
    if (!registration.ready && !returnState && registrationPaymentDestination(registration,
      context.configuration.stripeActivationReady || context.configuration.stripeCheckoutReady) === "/my/activate") redirect("/my/activate");
  }
  const preview = context.state === "preview";
  const initialPreviewState = preview && (query.view === "saved" || query.view === "pending") ? query.view : "not_saved";
  return <main className="member-journey-page mx-auto min-h-[70vh] max-w-3xl pb-24 font-[var(--font-body)] text-[var(--member-ink)]">
    {registrationOnly ? <header className="py-7"><p className="text-xs uppercase tracking-[0.12em] text-[var(--member-muted)]">Registration / Final step</p><h1 className="mt-3 font-[var(--font-display)] text-4xl">Save your card.</h1><p className="mt-3 text-sm text-[var(--member-muted)]">Your details are saved. You won’t be charged today.</p></header> : <MemberSettingsHeader title="Payment method" />}
    {!preview && !context.data.requiredFieldsComplete ? <div className="mb-5 rounded-[4px] bg-[var(--member-soft)] p-5"><p className="text-sm leading-relaxed">Finish your profile before saving a payment method. You don’t need to accept a paid membership agreement yet.</p><Link className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/my/join">Finish my profile</Link></div> : null}
    <MemberPaymentMethod registrationOnly={registrationOnly} preview={preview} initialPreviewState={initialPreviewState} returnState={returnState} />
  </main>;
}
