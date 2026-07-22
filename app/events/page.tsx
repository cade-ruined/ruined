import type { Metadata } from "next";
import EventsIndex from "@/components/events/EventsIndex";
import { EVENTS } from "@/data/events";

export const metadata: Metadata = {
  title: "Events · Studio Programme",
  description:
    "Open studios, conversations, installations, and late sessions from Ruined at Studio No. 17.",
  alternates: { canonical: "/events" },
};

export default function EventsPage() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ruined.studio";
  const eventSchema = EVENTS.filter((event) => event.status === "Upcoming").map((event) => ({
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    startDate: event.dateTime,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    description: event.summary,
    image: `${base}${event.image}`,
    location: {
      "@type": "Place",
      name: event.location,
      address: "Utah, United States",
    },
    organizer: { "@type": "Organization", name: "Ruined", url: base },
    url: `${base}/events#${event.id}`,
  }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(eventSchema).replace(/</g, "\\u003c"),
        }}
      />
      <EventsIndex />
    </>
  );
}
