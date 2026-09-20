import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { memberInvitationPreviewSnapshot } from "@/lib/membership/invitation-preview";
import { InvitationLanding } from "@/components/membership/MemberInvitation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invitation preview", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function InvitationPreviewPage() {
  if (getPlatformConfiguration().mode !== "preview") notFound();
  const { card, expiresAt } = memberInvitationPreviewSnapshot();
  if (!card) notFound();
  return <InvitationLanding card={card} expiresAt={expiresAt} recipientName="Alex Rivera" preview />;
}
