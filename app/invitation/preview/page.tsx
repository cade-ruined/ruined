import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { memberInvitationPreviewSnapshot } from "@/lib/membership/invitation-preview";
import { InvitationLanding } from "@/components/membership/MemberInvitation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invitation preview", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function InvitationPreviewPage({ searchParams }: { searchParams?: Promise<{ membership?: string; source?: string }> }) {
  if (getPlatformConfiguration().mode !== "preview") notFound();
  const { card, expiresAt } = memberInvitationPreviewSnapshot();
  if (!card) notFound();
  const params = await searchParams;
  const direct = params?.source === "ruined_direct";
  return <InvitationLanding card={card} expiresAt={expiresAt} recipientName={direct ? "Cherry Hill" : "Alex Rivera"}
    invitationSource={direct ? "ruined_direct" : "member"}
    membershipType={!direct && params?.membership === "complimentary" ? "complimentary" : "standard"} preview />;
}
