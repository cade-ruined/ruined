import type { Metadata } from "next";
import EventsIndex from "@/components/events/EventsIndex";
import { EVENTS } from "@/data/events";

export const metadata: Metadata = {
  title: "Community · Studio Gatherings",
  description:
    "Gatherings from The Ruined Project.",
  alternates: { canonical: "/community" },
};

export default function CommunityPage() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ruined.studio";
  const eventSchema = EVENTS.filter((event) => event.status === "Upcoming").map((event) => ({
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    startDate: event.dateTime,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    description: event.summary,
    ...(event.image ? { image: `${base}${event.image}` } : {}),
    location: {
      "@type": "Place",
      name: event.location,
      address: event.location,
    },
    organizer: { "@type": "Organization", name: "Ruined", url: base },
    url: `${base}/community#${event.id}`,
  }));

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(eventSchema).replace(/</g, "\\u003c") }} />
      <EventsIndex />
    </>
  );
}
