import type { StudioEvent } from "@/data/events";

function localDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}

/** Listings have a start but no end time. Archive after their local event day,
 * rather than treating an event as finished as soon as it begins. */
export function publicEventDateHasPassed(event: Pick<StudioEvent, "dateTime" | "dateOnly" | "timezone">, now = new Date()) {
  const start = new Date(event.dateTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(now.getTime())) return false;
  const timeZone = event.timezone || "America/Denver";
  const eventDate = event.dateOnly ? event.dateTime.slice(0, 10) : localDateKey(start, timeZone);
  return eventDate < localDateKey(now, timeZone);
}

/** Public presentation only: never change an operator's record or revive an
 * ended event. The repository still owns publication/archival visibility. */
export function resolvePublicEventDate(event: StudioEvent, now = new Date()): StudioEvent {
  if (event.status !== "Ended" && !publicEventDateHasPassed(event, now)) return event;
  const placeholder = /^(?:details to come|coming soon|tbd|tba)\.?$/i;
  return {
    ...event,
    status: "Ended",
    registration: event.registration ? { ...event.registration, status: "Closed" } : undefined,
    location: placeholder.test(event.location.trim()) ? "" : event.location,
    time: placeholder.test(event.time.trim()) ? "" : event.time,
    summary: event.summary.replace(/\s*Location and registration details coming soon\./gi, "").trim(),
  };
}
