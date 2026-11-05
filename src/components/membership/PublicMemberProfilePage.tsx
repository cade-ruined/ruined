import { notFound } from "next/navigation";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { withFreshApplicationDatabaseRead } from "@/lib/database/server";
import { getPublicMemberTimelineProfile } from "@/lib/membership/public-badge-repository";
import { MEMBER_PROFILE_IDENTIFIER } from "@/lib/membership/public-card-model";
import { GUIDED_TIMELINE_PREVIEW } from "@/lib/membership/guided-timeline-preview";
import { getPreviewMemberProfile } from "@/lib/membership/member-search-preview";
import PublicJournal from "./PublicJournal";

/** Full public-profile content shared by direct links and the member profile modal. */
export default async function PublicMemberProfilePage({ identifier, embedded = false }: {
  identifier: string; embedded?: boolean;
}) {
  const configuration = getPlatformConfiguration();
  const previewMember = process.env.NODE_ENV !== "production" && configuration.mode === "preview" ? getPreviewMemberProfile(identifier) : null;
  if (previewMember) {
    const story = GUIDED_TIMELINE_PREVIEW.entries.find(entry => entry.visibility === "public")!;
    return <PublicJournal token={identifier} embedded={embedded} identity={identifier === "preview_member"
      ? { name: "Preview Member", memberTag: "preview_member", bio: "Making room for what matters. A creative practice, built one day at a time.", memberNumber: 1, avatarUrl: "/membership/foundations/beginning.webp" }
      : { name: previewMember.name, memberTag: previewMember.memberTag, bio: previewMember.bio, memberNumber: previewMember.memberNumber, avatarUrl: previewMember.avatarUrl }} badges={[{ key: "early-supporter", label: "I Was Here", description: "Joined the waitlist, then activated a Founders or Originals membership.", earnedAt: "2026-10-10T12:00:00.000Z" }]} previewEntries={[
      { id: story.id, kind: story.kind, title: story.title, body: story.body, createdAt: story.createdAt, media: [], timelineReflection: story.timelineReflection ?? undefined, eventYear: story.eventYear, eventMonth: story.eventMonth, eventDay: story.eventDay },
      { id: "preview-timeline-photo", kind: "images", title: null, body: "A little space to think. Some of the best work starts here.", createdAt: "2026-10-10T12:00:00.000Z", media: [{ url: "/membership/foundations/beginning.webp", mimeType: "image/webp" }] },
      { id: "preview-timeline-thought", kind: "text", title: null, body: "This week: less noise, more time with the people and work that matter.", createdAt: "2026-10-08T12:00:00.000Z", media: [] },
    ]} />;
  }
  if (configuration.mode !== "connected" || !MEMBER_PROFILE_IDENTIFIER.test(identifier)) notFound();
  const profile = await withFreshApplicationDatabaseRead("public-member-profile", () => getPublicMemberTimelineProfile(identifier));
  if (!profile) notFound();
  return <PublicJournal key={identifier} token={identifier} identity={profile.profile} badges={profile.badges} embedded={embedded} />;
}
