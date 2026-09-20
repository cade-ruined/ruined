import { publicMemberCardIdentity } from "@/lib/membership/public-card-model";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvitationLanding } from "@/components/membership/MemberInvitation";
import { getPublicMemberInvitation } from "@/lib/membership/invitation-repository";
import { MEMBER_INVITATION_TOKEN } from "@/lib/membership/invitation-model";

export const dynamic = "force-dynamic";
export const revalidate = 0;
type Props = { params: Promise<{ token: string }> };
const origin = "https://members.theruinedproject.com";
const shareMedia = `${origin}/membership/card/share/invitation-spin-v1`;
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const invitation = MEMBER_INVITATION_TOKEN.test(token) ? await getPublicMemberInvitation(token) : null;
  const title = invitation ? `An invitation from ${publicMemberCardIdentity(invitation.card)}` : "Invitation unavailable";
  const description = invitation ? "A personal invitation to Ruined." : "This invitation is unavailable.";
  // Messaging apps fetch these without running the interactive card. The media
  // contains brand artwork only: a cached preview must not retain a member's
  // identity or an outdated invitation deadline. The page still validates access.
  const images = invitation ? [{
    url: `${shareMedia}.jpg`, width: 960, height: 720, type: "image/jpeg",
    alt: "A worn Ruined invitation card, with a photograph of a couch in the desert.",
  }] : [];
  return {
    title, description, referrer: "no-referrer", robots: { index: false, follow: false },
    alternates: { canonical: null },
    openGraph: {
      type: "website", siteName: "Ruined", title, description,
      ...(invitation ? { url: `${origin}/invitation/${token}` } : {}),
      images,
      // Apple Messages supports direct downloadable MP4 previews. Other clients
      // keep the poster; og:image GIF animation is not consistently supported.
      videos: invitation ? [{
        url: `${shareMedia}.mp4`, secureUrl: `${shareMedia}.mp4`,
        type: "video/mp4", width: 960, height: 720,
      }] : [],
    },
    twitter: { card: invitation ? "summary_large_image" : "summary", title, description, images },
  };
}
export default async function InvitationPage({ params }: Props) {
  const { token } = await params;
  if (!MEMBER_INVITATION_TOKEN.test(token)) notFound();
  const invitation = await getPublicMemberInvitation(token);
  if (!invitation) notFound();
  return <InvitationLanding card={invitation.card} expiresAt={invitation.expiresAt} token={token} />;
}
