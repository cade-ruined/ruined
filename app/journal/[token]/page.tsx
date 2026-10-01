import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getPublicMemberTimelineProfile } from "@/lib/membership/public-badge-repository";
import { MEMBER_CARD_TOKEN } from "@/lib/membership/public-card-model";
import PublicJournal from "@/components/membership/PublicJournal";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Timeline / Ruined", description: "Moments shared by a Ruined member.",
  robots: { index: false, follow: false }, referrer: "no-referrer", alternates: { canonical: null },
};
export default async function PublicJournalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (getPlatformConfiguration().mode !== "connected" || !MEMBER_CARD_TOKEN.test(token)) notFound();
  const profile = await getPublicMemberTimelineProfile(token);
  if (!profile) notFound();
  const { card, badges } = profile;
  return <PublicJournal key={token} token={token} identity={{ name: card.name, memberTag: card.memberTag, avatarUrl: card.avatarUrl, bio: card.bio, labels: card.labels }} badges={badges} />;
}
