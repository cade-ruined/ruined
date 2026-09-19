import { publicMemberCardIdentity } from "@/lib/membership/public-card-model";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvitationLanding } from "@/components/membership/MemberInvitation";
import { getPublicMemberInvitation } from "@/lib/membership/invitation-repository";
import { MEMBER_INVITATION_TOKEN } from "@/lib/membership/invitation-model";

export const dynamic = "force-dynamic";
export const revalidate = 0;
type Props = { params: Promise<{ token: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const invitation = MEMBER_INVITATION_TOKEN.test(token) ? await getPublicMemberInvitation(token) : null;
  const title = invitation ? `An invitation from ${publicMemberCardIdentity(invitation.card)}` : "Invitation unavailable";
  const description = invitation ? "A personal invitation to Ruined." : "This invitation is unavailable.";
  return { title, description, referrer: "no-referrer", robots: { index: false, follow: false }, alternates: { canonical: null }, openGraph: { title, description, images: [] }, twitter: { card: "summary", title, description, images: [] } };
}
export default async function InvitationPage({ params }: Props) {
  const { token } = await params;
  if (!MEMBER_INVITATION_TOKEN.test(token)) notFound();
  const invitation = await getPublicMemberInvitation(token);
  if (!invitation) notFound();
  return <InvitationLanding card={invitation.card} expiresAt={invitation.expiresAt} token={token} />;
}
