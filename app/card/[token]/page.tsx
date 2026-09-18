import { publicMemberCardIdentity } from "@/lib/membership/public-card-model";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicMemberCard } from "@/lib/membership/public-card-repository";
import { MEMBER_CARD_TOKEN } from "@/lib/membership/public-card-model";
import PublicMemberCardPage from "@/components/membership/card/PublicMemberCardPage";

export const dynamic = "force-dynamic";
export const revalidate = 0;
type Props = { params: Promise<{ token: string }> };
const origin = "https://members.theruinedproject.com";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const card = MEMBER_CARD_TOKEN.test(token) ? await getPublicMemberCard(token) : null;
  if (!card) return { title: "Card unavailable", description: "This member card is unavailable.", robots: { index: false, follow: false }, openGraph: { title: "Card unavailable", description: "This member card is unavailable.", images: [] }, twitter: { title: "Card unavailable", description: "This member card is unavailable.", images: [] }, alternates: { canonical: null } };
  const url = `${origin}/card/${token}`, image = `${origin}/api/cards/${token}/image`;
  return { title: `${publicMemberCardIdentity(card)} / Member card`, description: "A member of Ruined. An introduction shared by its owner.", robots: { index: false, follow: false }, alternates: { canonical: url }, referrer: "no-referrer", openGraph: { type: "profile", title: `${publicMemberCardIdentity(card)} / Ruined`, description: "A little introduction.", url, images: [{ url: image, width: 1200, height: 630, alt: `${publicMemberCardIdentity(card)}'s Ruined member card` }] }, twitter: { card: "summary_large_image", title: `${publicMemberCardIdentity(card)} / Ruined`, description: "A little introduction.", images: [image] } };
}

export default async function PublicCardPage({ params }: Props) {
  const { token } = await params;
  if (!MEMBER_CARD_TOKEN.test(token)) notFound();
  const card = await getPublicMemberCard(token);
  if (!card) notFound();
  return <PublicMemberCardPage card={card} />;
}
