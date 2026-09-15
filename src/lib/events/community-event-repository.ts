import "server-only";

import type postgres from "postgres";
import { EVENTS } from "@/data/events";
import { getApplicationDatabase } from "@/lib/database/server";
import { BYOB_02_EVENT_KEY } from "@/lib/events/byob-registration-model";
import { studioEventFromCommunityEvent, type CommunityEventInput, type CommunityEventRecord } from "@/lib/events/community-event-model";

export class CommunityEventRegistrationClosedError extends Error {
  constructor() {
    super("Registration is closed for this event.");
    this.name = "CommunityEventRegistrationClosedError";
  }
}

type ListingRow = {
  event_key: string; title: string; eyebrow: string; starts_at: Date | string; timezone: string;
  location: string; admission: string; summary: string; image_path: string | null; video_path: string | null;
  video_poster_path: string | null; publication_state: CommunityEventInput["publicationState"];
  event_state: CommunityEventInput["eventState"]; registration_mode: CommunityEventInput["registrationMode"];
  registration_url: string | null; registration_open: boolean; version: number;
  registered_count?: number | string; attendance_count?: number | string;
};
const iso = (value: Date | string) => new Date(value).toISOString();
function record(row: ListingRow): CommunityEventRecord {
  return {
    eventKey: row.event_key, title: row.title, eyebrow: row.eyebrow, startsAt: iso(row.starts_at),
    timezone: row.timezone, location: row.location, admission: row.admission, summary: row.summary,
    imagePath: row.image_path, videoPath: row.video_path, videoPosterPath: row.video_poster_path,
    publicationState: row.publication_state, eventState: row.event_state, registrationMode: row.registration_mode,
    registrationUrl: row.registration_url, registrationOpen: row.registration_open, version: row.version,
    registeredCount: Number(row.registered_count ?? 0), attendanceCount: Number(row.attendance_count ?? 0),
  };
}

/** Missing legacy schema is different from a configured database failing. */
export async function getPublicCommunityEvents() {
  if (!process.env.DATABASE_URL?.trim()) return EVENTS;
  const sql = getApplicationDatabase();
  const schema = await sql<Array<{ ready: boolean }>>`select to_regclass('public.community_event_listings') is not null as ready`;
  if (!schema[0]?.ready) return EVENTS;
  const rows = await sql<ListingRow[]>`
    select * from community_event_listings where publication_state = 'published'
    order by starts_at, event_key
  `;
  // An empty published set is intentional, never a reason to revive static events.
  return rows.map((row) => studioEventFromCommunityEvent(record(row)));
}

export async function assertCommunityEventRegistrationOpen(tx: postgres.TransactionSql, eventKey: string) {
  const schema = await tx<Array<{ ready: boolean }>>`select to_regclass('public.community_event_listings') is not null as ready`;
  if (!schema[0]?.ready && eventKey === BYOB_02_EVENT_KEY) return; // Only the original route predates listings.
  if (!schema[0]?.ready) throw new CommunityEventRegistrationClosedError();
  const rows = await tx<Array<{ event_key: string }>>`
    select event_key from community_event_listings
    where event_key = ${eventKey} and publication_state = 'published'
      and registration_mode = 'byob' and registration_open and event_state <> 'Ended'
    for share
  `;
  if (!rows[0]) throw new CommunityEventRegistrationClosedError();
}
