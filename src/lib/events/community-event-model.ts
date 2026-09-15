import { EVENTS, type StudioEvent } from "@/data/events";
import { getByobRegistrationConfig } from "@/lib/events/byob-registration-model";

export type CommunityEventInput = {
  eventKey: string;
  title: string;
  eyebrow: string;
  startsAt: string;
  timezone: string;
  location: string;
  admission: string;
  summary: string;
  imagePath: string | null;
  videoPath: string | null;
  videoPosterPath: string | null;
  publicationState: "draft" | "published" | "archived";
  eventState: StudioEvent["status"];
  registrationMode: "none" | "external" | "byob";
  registrationUrl: string | null;
  registrationOpen: boolean;
};
export type CommunityEventRecord = CommunityEventInput & { version: number; registeredCount: number; attendanceCount: number };
export type CommunityEventRegistrant = {
  id: string; name: string; email: string; instagram: string | null;
  status: "registered" | "cancelled"; registeredAt: string; waiverVersion: string; waiverAcceptedAt: string;
  attendanceState: "present" | "absent" | "not_recorded"; attendanceEventId: string | null;
};

export function studioEventFromCommunityEvent(record: CommunityEventInput): StudioEvent {
  const base = EVENTS.find((event) => event.id === record.eventKey);
  const date = new Date(record.startsAt);
  // Preserve the approved original labels when its instant/timezone have not changed.
  const unchangedDate = base && Date.parse(base.dateTime) === date.getTime() && base.timezone === record.timezone;
  return {
    ...base,
    id: record.eventKey, title: record.title, eyebrow: record.eyebrow,
    dateTime: date.toISOString(), timezone: record.timezone,
    date: unchangedDate ? base.date : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: record.timezone }).format(date),
    time: unchangedDate ? base.time : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: record.timezone }).format(date),
    location: record.location, admission: record.admission, summary: record.summary,
    image: record.imagePath ?? undefined, video: record.videoPath ?? undefined, videoPoster: record.videoPosterPath ?? undefined,
    status: record.eventState,
    registration: record.registrationMode === "none" ? undefined : {
      href: record.registrationMode === "byob" ? getByobRegistrationConfig(record.eventKey)!.registrationPath : record.registrationUrl!,
      label: "Register", status: record.registrationOpen && record.eventState !== "Ended" ? "Open" : "Closed",
    },
  };
}

export function legacyCommunityEventRecords(): CommunityEventRecord[] {
  return EVENTS.map((event) => ({
    eventKey: event.id, title: event.title, eyebrow: event.eyebrow, startsAt: event.dateTime,
    timezone: event.timezone, location: event.location, admission: event.admission, summary: event.summary,
    imagePath: event.image ?? null, videoPath: event.video ?? null, videoPosterPath: event.videoPoster ?? null,
    publicationState: "published", eventState: event.status,
    registrationMode: getByobRegistrationConfig(event.id) ? "byob" : event.registration ? "external" : "none",
    registrationUrl: getByobRegistrationConfig(event.id) ? null : event.registration?.href ?? null,
    registrationOpen: event.registration?.status === "Open", version: 0, registeredCount: 0, attendanceCount: 0,
  }));
}
