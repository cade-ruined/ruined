import type { Metadata } from "next";
import type { StudioEvent } from "@/data/events";
import { SITE_URL } from "@/lib/site";
import { sharingMetadata } from "@/lib/sharing";

export function publicEventHref(eventId: string) {
  return `/community/${encodeURIComponent(eventId)}`;
}

function eventDescription(event: StudioEvent) {
  return [
    event.summary.trim(),
    `${event.date}${event.dateOnly ? "" : ` · ${event.time}`}.`,
    event.location.trim(),
  ].filter(Boolean).join(" ");
}

export function publicEventMetadata(event: StudioEvent): Metadata {
  const path = publicEventHref(event.id);
  const description = eventDescription(event);
  return {
    title: event.title,
    description,
    alternates: { canonical: path },
    ...sharingMetadata({
      title: event.title,
      description,
      path,
      ...(event.image ? {
        image: { url: event.image, alt: `${event.title} event artwork` },
      } : {}),
    }),
  };
}

/** Announcements may have a date before a venue is confirmed. Keep those as
 * ordinary pages instead of publishing incomplete or invented event facts.
 */
export function publicEventSchema(event: StudioEvent) {
  const url = `${SITE_URL}${publicEventHref(event.id)}`;
  const base = {
    "@context": "https://schema.org",
    name: event.title,
    description: eventDescription(event),
    url,
    ...(event.image ? { image: new URL(event.image, SITE_URL).href } : {}),
  };
  const location = event.location.trim();
  const venueConfirmed = Boolean(location)
    && !/\b(tbd|tba|to (?:be announced|come|be confirmed|be determined)|coming soon|not (?:yet )?announced)\b/i.test(location);
  const validDate = Number.isFinite(Date.parse(event.dateTime));
  if (!venueConfirmed || !validDate) {
    return { ...base, "@type": "WebPage", "@id": `${url}#webpage` };
  }
  return {
    ...base,
    "@type": "Event",
    "@id": `${url}#event`,
    startDate: event.dateOnly ? event.dateTime.slice(0, 10) : event.dateTime,
    location: { "@type": "Place", name: location },
    organizer: {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Ruined",
      url: SITE_URL,
    },
  };
}
