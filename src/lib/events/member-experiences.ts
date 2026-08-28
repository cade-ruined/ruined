import { EVENTS, type StudioEvent } from "@/data/events";
import type { MemberExperienceSummary } from "@/lib/membership/model";

const ABSOLUTE_DATE_TIME = /(?:Z|[+-]\d{2}:\d{2})$/;
const PUBLIC_EVENT_IDS = new Set(EVENTS.map((event) => event.id));

function eventStartsAt(event: StudioEvent) {
  if (!ABSOLUTE_DATE_TIME.test(event.dateTime)) {
    throw new Error(`Public event ${event.id} needs an absolute dateTime with a timezone.`);
  }
  const timestamp = Date.parse(event.dateTime);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Public event ${event.id} has an invalid dateTime.`);
  }
  return new Date(timestamp).toISOString();
}

export function publicEventDetailHref(eventId: string) {
  return PUBLIC_EVENT_IDS.has(eventId)
    ? `/community#${encodeURIComponent(eventId)}`
    : null;
}

export function memberExperienceFromStudioEvent(
  event: StudioEvent,
): MemberExperienceSummary {
  const registrationOpen = event.registration?.status === "Open";
  const registrationClosed = event.registration?.status === "Closed";
  return {
    audienceLabel: "Ruined community",
    detailHref: `/community#${encodeURIComponent(event.id)}`,
    endsAt: null,
    id: `public-event-${event.id}`,
    kind: "public_event",
    locationLabel: event.location || null,
    meetingUrl: null,
    registrationHref: registrationOpen ? event.registration?.href ?? null : null,
    registrationState: registrationOpen
      ? "external"
      : registrationClosed
        ? "closed"
        : "none",
    startsAt: eventStartsAt(event),
    summary: event.summary || null,
    timezone: event.timezone,
    title: event.title,
  };
}

export function getUpcomingPublicMemberExperiences(now = Date.now()) {
  return EVENTS
    .filter((event) => event.status !== "Ended")
    .map((event) => ({ event, experience: memberExperienceFromStudioEvent(event) }))
    .filter(({ event, experience }) => (
      event.status === "Ongoing" || Date.parse(experience.startsAt) >= now
    ))
    .map(({ experience }) => experience)
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
}

export function mergeUpcomingPublicMemberExperiences(
  memberExperiences: MemberExperienceSummary[],
  now = Date.now(),
) {
  const merged = [...memberExperiences];

  for (const publicExperience of getUpcomingPublicMemberExperiences(now)) {
    const existingIndex = merged.findIndex(
      (experience) => experience.detailHref === publicExperience.detailHref,
    );
    if (existingIndex < 0) {
      merged.push(publicExperience);
      continue;
    }

    const existing = merged[existingIndex];
    const existingOwnsRegistration =
      Boolean(existing.registrationHref)
      || !["closed", "none"].includes(existing.registrationState);
    merged[existingIndex] = {
      ...existing,
      ...publicExperience,
      endsAt: existing.endsAt ?? publicExperience.endsAt,
      id: existing.id,
      meetingUrl: existing.meetingUrl,
      registrationHref: existingOwnsRegistration
        ? existing.registrationHref
        : publicExperience.registrationHref,
      registrationState: existingOwnsRegistration
        ? existing.registrationState
        : publicExperience.registrationState,
    };
  }

  return merged.sort(
    (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
  );
}
