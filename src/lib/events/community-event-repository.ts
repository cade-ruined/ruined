import "server-only";

import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { EVENTS } from "@/data/events";
import { getApplicationDatabase } from "@/lib/database/server";
import { BYOB_02_EVENT_KEY, getByobRegistrationConfig } from "@/lib/events/byob-registration-model";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";
import { studioEventFromCommunityEvent, type CommunityEventInput, type CommunityEventRecord, type CommunityEventRegistrant } from "@/lib/events/community-event-model";

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
  if (!schema[0]?.ready) throw new OpsOperatingRepositoryError("conflict", "Registration is closed for this event.");
  const rows = await tx<Array<{ event_key: string }>>`
    select event_key from community_event_listings
    where event_key = ${eventKey} and publication_state = 'published'
      and registration_mode = 'byob' and registration_open and event_state <> 'Ended'
    for share
  `;
  if (!rows[0]) throw new OpsOperatingRepositoryError("conflict", "Registration is closed for this event.");
}

async function requireAdmin(tx: postgres.TransactionSql, actor: string) {
  const rows = await tx<Array<{ auth_user_id: string }>>`
    select platform_user.auth_user_id from platform_users platform_user
    join platform_role_grants role_grant on role_grant.auth_user_id = platform_user.auth_user_id
    where platform_user.auth_user_id = ${actor}::uuid and platform_user.status = 'active'
      and role_grant.role_slug = 'ops_admin' and role_grant.revoked_at is null
    for update of platform_user, role_grant
  `;
  if (!rows[0]) throw new OpsOperatingRepositoryError("forbidden", "Public community management requires Administrator access.");
}

function boundedText(value: unknown, field: string, max: number, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if ((required && !result) || result.length > max) throw new OpsOperatingRepositoryError("invalid_request", `Check ${field}.`);
  return result;
}
function media(value: unknown) {
  const path = boundedText(value, "the image or video path", 500);
  if (!path) return null;
  if (!/^\/(?!\/)[A-Za-z0-9/_.?=&%-]+$/.test(path) || path.includes("..")) {
    throw new OpsOperatingRepositoryError("invalid_request", "Use an existing site image or video path beginning with /.");
  }
  return path;
}
export function parseCommunityEventInput(value: unknown): CommunityEventInput {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const eventKey = boundedText(input.eventKey, "the event link", 80, true);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(eventKey)) throw new OpsOperatingRepositoryError("invalid_request", "Use lowercase words separated by hyphens for the event link.");
  const startsAt = boundedText(input.startsAt, "the start time", 80, true);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(startsAt) || !Number.isFinite(Date.parse(startsAt))) throw new OpsOperatingRepositoryError("invalid_request", "Choose a valid start date and time.");
  const timezone = boundedText(input.timezone, "the time zone", 100, true);
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(startsAt)); }
  catch { throw new OpsOperatingRepositoryError("invalid_request", "Choose a valid time zone."); }
  const publicationState = input.publicationState;
  const eventState = input.eventState;
  const registrationMode = input.registrationMode;
  if (!["draft", "published", "archived"].includes(String(publicationState)) || !["Upcoming", "Ongoing", "Ended"].includes(String(eventState)) || !["none", "external", "byob"].includes(String(registrationMode))) throw new OpsOperatingRepositoryError("invalid_request", "Choose valid event and registration states.");
  const nativeRegistration = getByobRegistrationConfig(eventKey);
  if (registrationMode === "byob" && !nativeRegistration) throw new OpsOperatingRepositoryError("invalid_request", "This event does not have a configured registration and waiver. Use an external registration link or no registration.");
  if (nativeRegistration && registrationMode !== "byob") throw new OpsOperatingRepositoryError("invalid_request", "Keep the existing BYOB registration. Use Registration open to open or close it.");
  const urlValue = boundedText(input.registrationUrl, "the registration link", 2000);
  let registrationUrl: string | null = null;
  if (registrationMode === "external") {
    try {
      const url = new URL(urlValue);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
      registrationUrl = url.toString();
    } catch { throw new OpsOperatingRepositoryError("invalid_request", "Enter a full https:// registration link."); }
  }
  return {
    eventKey, title: boundedText(input.title, "the title", 160, true), eyebrow: boundedText(input.eyebrow, "the short label", 100),
    startsAt: new Date(startsAt).toISOString(), timezone, location: boundedText(input.location, "the location", 300),
    admission: boundedText(input.admission, "admission details", 200), summary: boundedText(input.summary, "the description", 3000),
    imagePath: media(input.imagePath), videoPath: media(input.videoPath), videoPosterPath: media(input.videoPosterPath),
    publicationState: publicationState as CommunityEventInput["publicationState"], eventState: eventState as CommunityEventInput["eventState"],
    registrationMode: registrationMode as CommunityEventInput["registrationMode"], registrationUrl,
    registrationOpen: registrationMode !== "none" && input.registrationOpen === true,
  };
}

async function audit(tx: postgres.TransactionSql, actor: string, action: string, id: string, before: postgres.JSONValue, after: postgres.JSONValue) {
  await tx`
    insert into operator_audit_events (actor_auth_user_id, action, subject_type, subject_id, before_snapshot, after_snapshot, metadata, dedupe_key)
    values (${actor}::uuid, ${action}, 'community_event', ${id}, ${tx.json(before)}, ${tx.json(after)}, '{}'::jsonb, ${randomUUID()})
  `;
}

export async function getOpsCommunityEvents(actor: string): Promise<CommunityEventRecord[]> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await requireAdmin(tx, actor);
    const rows = await tx<ListingRow[]>`
      select listing.*,
        (select count(*) from community_event_registrations registration where registration.event_key = listing.event_key and registration.status = 'registered') as registered_count,
        (select count(*) from community_event_registrations registration
          join lateral (select attendance_state from community_event_attendance_events where registration_id = registration.id order by id desc limit 1) attendance on attendance.attendance_state = 'present'
          where registration.event_key = listing.event_key and registration.status = 'registered') as attendance_count
      from community_event_listings listing order by starts_at desc, event_key
    `;
    return rows.map(record);
  });
}

export async function saveCommunityEvent(actor: string, raw: unknown, expectedVersion: number | null) {
  const input = parseCommunityEventInput(raw);
  if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) throw new OpsOperatingRepositoryError("invalid_request", "Refresh the event before saving.");
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await requireAdmin(tx, actor);
    await tx`select pg_advisory_xact_lock(hashtext(${input.eventKey}), 73)`;
    const existing = await tx<ListingRow[]>`select * from community_event_listings where event_key = ${input.eventKey} for update`;
    if ((expectedVersion === null && existing[0]) || (expectedVersion !== null && existing[0]?.version !== expectedVersion)) throw new OpsOperatingRepositoryError("conflict", "This event changed or its link is already in use. Refresh before saving.");
    const rows = expectedVersion === null ? await tx<ListingRow[]>`
      insert into community_event_listings (event_key, title, eyebrow, starts_at, timezone, location, admission, summary, image_path, video_path, video_poster_path, publication_state, event_state, registration_mode, registration_url, registration_open)
      values (${input.eventKey}, ${input.title}, ${input.eyebrow}, ${input.startsAt}::timestamptz, ${input.timezone}, ${input.location}, ${input.admission}, ${input.summary}, ${input.imagePath}, ${input.videoPath}, ${input.videoPosterPath}, ${input.publicationState}, ${input.eventState}, ${input.registrationMode}, ${input.registrationUrl}, ${input.registrationOpen}) returning *
    ` : await tx<ListingRow[]>`
      update community_event_listings set title = ${input.title}, eyebrow = ${input.eyebrow}, starts_at = ${input.startsAt}::timestamptz,
        timezone = ${input.timezone}, location = ${input.location}, admission = ${input.admission}, summary = ${input.summary},
        image_path = ${input.imagePath}, video_path = ${input.videoPath}, video_poster_path = ${input.videoPosterPath},
        publication_state = ${input.publicationState}, event_state = ${input.eventState}, registration_mode = ${input.registrationMode},
        registration_url = ${input.registrationUrl}, registration_open = ${input.registrationOpen}, version = version + 1, updated_at = statement_timestamp()
      where event_key = ${input.eventKey} and version = ${expectedVersion} returning *
    `;
    await audit(tx, actor, existing[0] ? "community_event.updated" : "community_event.created", input.eventKey,
      existing[0] ? record(existing[0]) : null, record(rows[0]));
    return record(rows[0]);
  });
}

export async function getCommunityRoster(actor: string, eventKey: string, query = "", page = 1) {
  const sql = getApplicationDatabase();
  const search = query.trim().slice(0, 120);
  const requestedPage = Math.max(1, Math.floor(Number.isFinite(page) ? page : 1));
  return sql.begin(async (tx) => {
    await requireAdmin(tx, actor);
    const total = await tx<Array<{ count: number | string }>>`
      select count(*) as count from community_event_registrations
      where event_key = ${eventKey} and (${search} = '' or position(lower(${search}) in lower(registrant_name || ' ' || email_normalized)) > 0)
    `;
    const count = Number(total[0].count);
    const currentPage = Math.min(requestedPage, Math.max(1, Math.ceil(count / 50)));
    const rows = await tx<Array<{
      id: string; registrant_name: string; email_normalized: string; instagram_handle: string | null; status: "registered" | "cancelled";
      created_at: Date; waiver_version: string; waiver_accepted_at: Date; attendance_state: CommunityEventRegistrant["attendanceState"] | null; attendance_id: string | null;
    }>>`
      select registration.id, registrant_name, email_normalized, instagram_handle, status, registration.created_at, waiver_version, waiver_accepted_at,
        attendance.attendance_state, attendance.id::text as attendance_id
      from community_event_registrations registration
      left join lateral (select id, attendance_state from community_event_attendance_events where registration_id = registration.id order by id desc limit 1) attendance on true
      where event_key = ${eventKey} and (${search} = '' or position(lower(${search}) in lower(registrant_name || ' ' || email_normalized)) > 0)
      order by registration.created_at desc, registration.id limit 50 offset ${(currentPage - 1) * 50}
    `;
    return { count, page: currentPage, pageCount: Math.max(1, Math.ceil(count / 50)), registrations: rows.map((row): CommunityEventRegistrant => ({
      id: row.id, name: row.registrant_name, email: row.email_normalized, instagram: row.instagram_handle,
      status: row.status, registeredAt: iso(row.created_at), waiverVersion: row.waiver_version, waiverAcceptedAt: iso(row.waiver_accepted_at),
      attendanceState: row.attendance_state ?? "not_recorded", attendanceEventId: row.attendance_id,
    })) };
  });
}

export async function recordCommunityAttendance(actor: string, eventKey: string, registrationId: string, attendanceState: string, expectedEventId: string | null) {
  if (!["present", "absent", "not_recorded"].includes(attendanceState) || !/^[0-9a-f-]{36}$/i.test(registrationId) || (expectedEventId !== null && !/^\d+$/.test(expectedEventId))) throw new OpsOperatingRepositoryError("invalid_request", "Check the selected registration and attendance.");
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await requireAdmin(tx, actor);
    const registration = await tx<Array<{ id: string; status: string }>>`select id, status from community_event_registrations where id = ${registrationId}::uuid and event_key = ${eventKey} for update`;
    if (!registration[0]) throw new OpsOperatingRepositoryError("not_found", "That registration does not belong to this event.");
    if (registration[0].status !== "registered") throw new OpsOperatingRepositoryError("conflict", "Cancelled registrations cannot be checked in.");
    const latest = await tx<Array<{ id: string; attendance_state: string }>>`select id::text, attendance_state from community_event_attendance_events where registration_id = ${registrationId}::uuid order by id desc limit 1`;
    if ((latest[0]?.id ?? null) !== expectedEventId) throw new OpsOperatingRepositoryError("conflict", "Attendance was changed by another operator. Refresh first.");
    const rows = await tx<Array<{ id: string }>>`insert into community_event_attendance_events (registration_id, attendance_state, actor_auth_user_id) values (${registrationId}::uuid, ${attendanceState}, ${actor}::uuid) returning id::text`;
    await audit(tx, actor, "community_event.attendance_recorded", eventKey, { registrationId, attendanceState: latest[0]?.attendance_state ?? "not_recorded" }, { registrationId, attendanceState, attendanceEventId: rows[0].id });
    return { attendanceEventId: rows[0].id };
  });
}
