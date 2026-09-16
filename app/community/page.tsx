import type { Metadata } from "next";
import EventsIndex from "@/components/events/EventsIndex";
import { SITE_URL } from "@/lib/site";
import { getPublicCommunityEvents } from "@/lib/events/community-event-repository";
import { sharingMetadata } from "@/lib/sharing";

export const dynamic = "force-dynamic";

const description =
  "Community gatherings from The Ruined Project in Alpine, Utah, including the monthly BYOB series.";

export const metadata: Metadata = {
  title: "Community Gatherings",
  description,
  alternates: { canonical: "/community" },
  ...sharingMetadata({
    title: "Community Gatherings",
    description,
    path: "/community",
  }),
};

export default async function CommunityPage() {
  const events = await getPublicCommunityEvents();
  const communitySchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Community Gatherings — Ruined",
    description,
    url: `${SITE_URL}/community`,
    isPartOf: {
      "@type": "WebSite",
      name: "Ruined",
      url: SITE_URL,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(communitySchema).replace(/</g, "\\u003c"),
        }}
      />
      <EventsIndex initialEvents={events} />
    </>
  );
}
