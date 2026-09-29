import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import MemberPaymentMethod from "@/components/membership/MemberPaymentMethod";
import MemberSettingsHeader from "@/components/membership/MemberSettingsHeader";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_ONBOARDING } from "@/lib/membership/preview";
import { getMemberOnboarding } from "@/lib/membership/repository";

export const metadata: Metadata = { title: "Payment method | Ruined", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MemberPaymentMethodPage({ searchParams }: { searchParams: Promise<{ setup?: string; view?: string }> }) {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_ONBOARDING, getMemberOnboarding, "payment-method");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <PlatformUnavailable reason="member_access" />;
  if (!context.data) return <PlatformUnavailable accessHref="/my/access" />;
  const query = await searchParams;
  const returnState = query.setup === "returned" || query.setup === "cancelled" ? query.setup : null;
  const preview = context.state === "preview";
  const initialPreviewState = preview && (query.view === "saved" || query.view === "pending") ? query.view : "not_saved";
  return <main className="member-journey-page mx-auto min-h-[70vh] max-w-3xl pb-24 font-[var(--font-body)] text-[var(--member-ink)]">
    <MemberSettingsHeader title="Payment method" />
    {!preview && !context.data.requiredFieldsComplete ? <div className="mb-5 rounded-[4px] bg-[var(--member-soft)] p-5"><p className="text-sm leading-relaxed">Finish your profile before saving a payment method. You don’t need to accept a paid membership agreement yet.</p><Link className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/my/join">Finish my profile</Link></div> : null}
    <MemberPaymentMethod preview={preview} initialPreviewState={initialPreviewState} returnState={returnState} />
  </main>;
}
