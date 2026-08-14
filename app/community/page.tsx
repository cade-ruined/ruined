import type { Metadata } from "next";
import EventsIndex from "@/components/events/EventsIndex";
import { SITE_URL } from "@/lib/site";

const description =
  "Community gatherings from The Ruined Project in Alpine, Utah, including the monthly BYOB series.";

export const metadata: Metadata = {
  title: "Community Gatherings",
  description,
  alternates: { canonical: "/community" },
  openGraph: {
    type: "website",
    title: "Community Gatherings — Ruined",
    description,
    url: "/community",
    images: [
      {
        url: "/opengraph-image.jpg",
        width: 1200,
        height: 630,
        alt: "The Ruined Project",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Community Gatherings — Ruined",
    description,
    images: ["/twitter-image.jpg"],
  },
};

export default function CommunityPage() {
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
      <EventsIndex />
    </>
  );
}
