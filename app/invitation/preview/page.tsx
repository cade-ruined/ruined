import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { memberInvitationPreviewSnapshot } from "@/lib/membership/invitation-preview";
import { InvitationLanding } from "@/components/membership/MemberInvitation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invitation preview", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function InvitationPreviewPage({ searchParams }: { searchParams?: Promise<{ membership?: string }> }) {
  if (getPlatformConfiguration().mode !== "preview") notFound();
  const { card, expiresAt } = memberInvitationPreviewSnapshot();
  if (!card) notFound();
  return <InvitationLanding card={card} expiresAt={expiresAt} recipientName="Alex Rivera"
    membershipType={(await searchParams)?.membership === "complimentary" ? "complimentary" : "standard"} preview />;
}
