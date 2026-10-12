import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getPublicMemberTimelineProfile } from "@/lib/membership/public-badge-repository";
import { MEMBER_PROFILE_IDENTIFIER } from "@/lib/membership/public-card-model";
import PublicJournal from "@/components/membership/PublicJournal";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Profile / Ruined", description: "A Ruined member and their public Timeline.",
  robots: { index: false, follow: false }, referrer: "no-referrer", alternates: { canonical: null },
};
export default async function PublicJournalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const configuration = getPlatformConfiguration();
  if (process.env.NODE_ENV !== "production" && configuration.mode === "preview" && token === "preview_member") {
    return <PublicJournal token={token} identity={{ name: "Preview Member", memberTag: "preview_member", bio: "Making room for what matters. A creative practice, built one day at a time.", memberNumber: 1 }} previewEntries={[
      { id: "preview-timeline-photo", kind: "images", title: null, body: "A little space to think. Some of the best work starts here.", createdAt: "2026-10-10T12:00:00.000Z", media: [{ url: "/membership/foundations/beginning.webp", mimeType: "image/webp" }] },
      { id: "preview-timeline-thought", kind: "text", title: null, body: "This week: less noise, more time with the people and work that matter.", createdAt: "2026-10-08T12:00:00.000Z", media: [] },
    ]} />;
  }
  if (configuration.mode !== "connected" || !MEMBER_PROFILE_IDENTIFIER.test(token)) notFound();
  const profile = await getPublicMemberTimelineProfile(token);
  if (!profile) notFound();
  return <PublicJournal key={token} token={token} identity={profile.profile} />;
}
