import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import EventsIndex from "@/components/events/EventsIndex";
import { getPublicCommunityEvents } from "@/lib/events/community-event-repository";
import { publicEventMetadata, publicEventSchema } from "@/lib/events/public-event-page";

export const dynamic = "force-dynamic";

// Metadata and content use the same published snapshot within this request.
const getEvents = cache(getPublicCommunityEvents);
type EventPageProps = { params: Promise<{ eventId: string }> };

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const { eventId } = await params;
  const event = (await getEvents()).find((candidate) => candidate.id === eventId);
  if (!event) notFound();
  return publicEventMetadata(event);
}

export default async function CommunityEventPage({ params }: EventPageProps) {
  const { eventId } = await params;
  const events = await getEvents();
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event) notFound();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(publicEventSchema(event)).replace(/</g, "\\u003c"),
        }}
      />
      <EventsIndex key={event.id} initialEvents={events} initialSelectedId={event.id} />
    </>
  );
}
