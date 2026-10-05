import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { memberInvitationPreviewSnapshot } from "@/lib/membership/invitation-preview";
import MembershipOverview from "@/components/public-members/MembershipOverview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invitation preview", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function InvitationPreviewPage({ searchParams }: { searchParams?: Promise<{ membership?: string; source?: string; delivery?: string }> }) {
  if (getPlatformConfiguration().mode !== "preview") notFound();
  const { card, expiresAt } = memberInvitationPreviewSnapshot();
  if (!card) notFound();
  const params = await searchParams;
  const direct = params?.source === "ruined_direct";
  return <MembershipOverview preview paymentSetupOnly registrationOnly invitation={{
    card: direct ? { ...card, name: "The Ruined Project", memberTag: null } : card,
    expiresAt: expiresAt ?? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    recipientName: direct ? "Cherry Hill" : "Alex Rivera",
    invitationSource: direct ? "ruined_direct" : "member",
    membershipType: !direct && params?.membership === "complimentary" ? "complimentary" : "standard",
    recipientEmailRequired: params?.delivery !== "text" || params?.membership === "complimentary",
  }} />;
}
