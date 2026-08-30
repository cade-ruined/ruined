import { createHash } from "node:crypto";

export const GOOGLE_CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.owned";

const MAX_ATTENDEE_COUNT = 2_000;
const MAX_ATTENDEE_NAME_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 16_384;
const MAX_LOCATION_LENGTH = 1_024;
const MAX_SUMMARY_LENGTH = 1_024;
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{4,511}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_WITH_OFFSET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const EVENT_ID_PATTERN = /^[a-v0-9]{5,1024}$/;

export type GoogleCalendarAttendee = {
  displayName?: string;
  email: string;
};

export type GoogleCalendarAllDayTime = {
  date: string;
};

export type GoogleCalendarTimedTime = {
  dateTime: string;
  timeZone?: string;
};

export type GoogleCalendarEventTime =
  | GoogleCalendarAllDayTime
  | GoogleCalendarTimedTime;

export type GoogleCalendarEventDraft = {
  attendees: GoogleCalendarAttendee[];
  description?: string | null;
  end: GoogleCalendarEventTime;
  location?: string | null;
  requestKey: string;
  sourceUrl?: string | null;
  start: GoogleCalendarEventTime;
  summary: string;
};

export type GoogleCalendarEventUpdate = GoogleCalendarEventDraft & {
  eventId: string;
  expectedEtag?: string | null;
};

export type GoogleCalendarConferenceStatus =
  | "failure"
  | "pending"
  | "success"
  | null;

export type GoogleCalendarEventResult = {
  conferenceId: string | null;
  conferenceStatus: GoogleCalendarConferenceStatus;
  etag: string | null;
  eventId: string;
  htmlUrl: string | null;
  iCalUid: string | null;
  meetReady: boolean;
  meetUrl: string | null;
  organizerEmail: string | null;
  organizerVerified: boolean;
  status: string | null;
  updatedAt: string | null;
};

export type GoogleCalendarEventBody = {
  attendees: GoogleCalendarAttendee[];
  conferenceData?: {
    conferenceId?: string;
    createRequest: {
      conferenceSolutionKey: {
        type: "hangoutsMeet";
      };
      requestId: string;
    };
  };
  description?: string;
  end: GoogleCalendarEventTime;
  extendedProperties: {
    private: Record<string, string>;
  };
  guestsCanInviteOthers: false;
  guestsCanModify: false;
  guestsCanSeeOtherGuests: false;
  id?: string;
  location?: string;
  reminders: {
    useDefault: true;
  };
  source?: {
    title: "Ruined";
    url: string;
  };
  start: GoogleCalendarEventTime;
  summary: string;
  transparency: "opaque";
  visibility: "private";
};

export type GoogleCalendarApiEvent = {
  attendees?: Array<{
    displayName?: string;
    email?: string;
  }>;
  conferenceData?: {
    conferenceId?: string;
    createRequest?: {
      requestId?: string;
      status?: {
        statusCode?: string;
      };
    };
    entryPoints?: Array<{
      entryPointType?: string;
      uri?: string;
    }>;
  };
  description?: string;
  end?: GoogleCalendarEventTime;
  etag?: string;
  extendedProperties?: {
    private?: Record<string, string>;
  };
  guestsCanInviteOthers?: boolean;
  guestsCanModify?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  hangoutLink?: string;
  htmlLink?: string;
  iCalUID?: string;
  id?: string;
  location?: string;
  organizer?: {
    email?: string;
  };
  source?: {
    title?: string;
    url?: string;
  };
  start?: GoogleCalendarEventTime;
  status?: string;
  summary?: string;
  transparency?: string;
  updated?: string;
  visibility?: string;
};

export type GoogleCalendarUpdateBodyOptions = {
  meetRequestId?: string;
};

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  label: string,
  maxLength: number,
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw new Error(`${label} is invalid.`);
  return normalized;
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function normalizedEventTime(
  value: GoogleCalendarEventTime,
  label: string,
): GoogleCalendarEventTime {
  if ("date" in value) {
    const parsed = Date.parse(`${value.date}T00:00:00Z`);
    if (
      !DATE_PATTERN.test(value.date)
      || Number.isNaN(parsed)
      || new Date(parsed).toISOString().slice(0, 10) !== value.date
    ) {
      throw new Error(`${label} date is invalid.`);
    }
    return { date: value.date };
  }

  if (
    !DATE_TIME_WITH_OFFSET_PATTERN.test(value.dateTime)
    || Number.isNaN(Date.parse(value.dateTime))
  ) {
    throw new Error(`${label} date and time must be RFC3339 with a UTC offset.`);
  }
  const timeZone = value.timeZone?.trim();
  if (timeZone && !validTimeZone(timeZone)) {
    throw new Error(`${label} time zone is invalid.`);
  }
  return {
    dateTime: value.dateTime,
    ...(timeZone ? { timeZone } : {}),
  };
}

function eventTimeValue(value: GoogleCalendarEventTime): number {
  return "date" in value
    ? Date.parse(`${value.date}T00:00:00Z`)
    : Date.parse(value.dateTime);
}

function normalizedSourceUrl(value: string | null | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Calendar source URL is invalid.");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== "443")
  ) {
    throw new Error("Calendar source URL is invalid.");
  }
  parsed.hash = "";
  return parsed.toString();
}

export function normalizeGoogleCalendarRequestKey(value: string): string {
  const normalized = value.trim();
  if (!REQUEST_KEY_PATTERN.test(normalized)) {
    throw new Error("Google Calendar request key is invalid.");
  }
  return normalized;
}

export function googleCalendarRequestHash(requestKey: string): string {
  return createHash("sha256")
    .update(normalizeGoogleCalendarRequestKey(requestKey), "utf8")
    .digest("hex");
}

/**
 * Google accepts custom event IDs using base32hex characters. A SHA-256 hex
 * digest is a valid subset and gives retrying creates one stable remote ID.
 */
export function googleCalendarEventIdForRequestKey(requestKey: string): string {
  return `ruined${googleCalendarRequestHash(requestKey)}`;
}

export function normalizeGoogleCalendarEventId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!EVENT_ID_PATTERN.test(normalized)) {
    throw new Error("Google Calendar event ID is invalid.");
  }
  return normalized;
}

/** A Meet request ID is unique to one logical event and stable across retries. */
export function googleMeetRequestIdForRequestKey(requestKey: string): string {
  return `ruinedmeet${createHash("sha256")
    .update(`meet:${normalizeGoogleCalendarRequestKey(requestKey)}`, "utf8")
    .digest("hex")}`;
}

/**
 * A failed or missing conference needs a new Google request ID. Deriving it
 * from the latest provider state makes the recovery stable for ambiguous
 * retries, but different after Google has recorded a failed attempt.
 */
export function googleMeetRequestIdForEventState(
  requestKey: string,
  event: GoogleCalendarApiEvent,
): string {
  const providerState = [
    event.etag ?? "",
    event.updated ?? "",
    event.conferenceData?.createRequest?.requestId ?? "",
    event.conferenceData?.createRequest?.status?.statusCode ?? "",
  ].join("\n");
  return `ruinedmeet${createHash("sha256")
    .update(
      `meet-recovery:${normalizeGoogleCalendarRequestKey(requestKey)}:${providerState}`,
      "utf8",
    )
    .digest("hex")}`;
}

export function googleMeetRequestHash(requestId: string): string {
  const normalized = requestId.trim();
  if (!/^ruinedmeet[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("Google Meet request ID is invalid.");
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function normalizeGoogleCalendarAttendees(
  attendees: GoogleCalendarAttendee[],
  organizerEmail: string,
): GoogleCalendarAttendee[] {
  if (attendees.length > MAX_ATTENDEE_COUNT) {
    throw new Error("A Google Calendar event cannot include more than 2,000 attendees.");
  }

  const organizer = organizerEmail.trim().toLowerCase();
  const normalized = new Map<string, GoogleCalendarAttendee>();
  for (const attendee of attendees) {
    const email = attendee.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) throw new Error("Calendar attendee email is invalid.");
    if (email === organizer) continue;

    const displayName = attendee.displayName?.trim();
    if (
      displayName
      && (displayName.length > MAX_ATTENDEE_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(displayName))
    ) {
      throw new Error("Calendar attendee name is invalid.");
    }
    const previous = normalized.get(email);
    normalized.set(email, {
      email,
      ...((displayName || previous?.displayName)
        ? { displayName: displayName || previous?.displayName }
        : {}),
    });
  }
  return [...normalized.values()].sort((left, right) =>
    left.email.localeCompare(right.email),
  );
}

function normalizedDraft(
  input: GoogleCalendarEventDraft,
  organizerEmail: string,
): Omit<GoogleCalendarEventBody, "conferenceData" | "id"> {
  const start = normalizedEventTime(input.start, "Calendar start");
  const end = normalizedEventTime(input.end, "Calendar end");
  if (("date" in start) !== ("date" in end)) {
    throw new Error("Calendar start and end must use the same time format.");
  }
  if (eventTimeValue(end) <= eventTimeValue(start)) {
    throw new Error("Calendar end must be after its start.");
  }

  const description = optionalText(
    input.description,
    "Calendar description",
    MAX_DESCRIPTION_LENGTH,
  );
  const location = optionalText(input.location, "Calendar location", MAX_LOCATION_LENGTH);
  const sourceUrl = normalizedSourceUrl(input.sourceUrl);

  return {
    attendees: normalizeGoogleCalendarAttendees(input.attendees, organizerEmail),
    ...(description ? { description } : {}),
    end,
    extendedProperties: {
      private: {},
    },
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    guestsCanSeeOtherGuests: false,
    ...(location ? { location } : {}),
    reminders: { useDefault: true },
    ...(sourceUrl ? { source: { title: "Ruined", url: sourceUrl } } : {}),
    start,
    summary: requiredText(input.summary, "Calendar summary", MAX_SUMMARY_LENGTH),
    transparency: "opaque",
    visibility: "private",
  };
}

export function buildGoogleCalendarCreateBody(
  input: GoogleCalendarEventDraft,
  organizerEmail: string,
): GoogleCalendarEventBody {
  const requestHash = googleCalendarRequestHash(input.requestKey);
  return {
    ...normalizedDraft(input, organizerEmail),
    conferenceData: {
      createRequest: {
        conferenceSolutionKey: { type: "hangoutsMeet" },
        requestId: googleMeetRequestIdForRequestKey(input.requestKey),
      },
    },
    extendedProperties: {
      private: {
        ruinedCreateRequest: requestHash,
      },
    },
    id: googleCalendarEventIdForRequestKey(input.requestKey),
  };
}

export function buildGoogleCalendarUpdateBody(
  input: GoogleCalendarEventUpdate,
  organizerEmail: string,
  existingPrivateProperties: Record<string, string> = {},
  options: GoogleCalendarUpdateBodyOptions = {},
): GoogleCalendarEventBody {
  const normalized = normalizedDraft(input, organizerEmail);
  const meetRequestId = options.meetRequestId?.trim();
  if (meetRequestId) googleMeetRequestHash(meetRequestId);
  return {
    ...normalized,
    ...(meetRequestId
      ? {
          conferenceData: {
            createRequest: {
              conferenceSolutionKey: { type: "hangoutsMeet" as const },
              requestId: meetRequestId,
            },
          },
        }
      : {}),
    description: normalized.description ?? "",
    extendedProperties: {
      private: {
        ...existingPrivateProperties,
        ruinedUpdateRequest: googleCalendarRequestHash(input.requestKey),
        ...(meetRequestId
          ? { ruinedMeetRequest: googleMeetRequestHash(meetRequestId) }
          : {}),
      },
    },
    location: normalized.location ?? "",
  };
}

function normalizedProviderEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

export function googleCalendarOrganizerEmail(
  event: GoogleCalendarApiEvent,
): string | null {
  return normalizedProviderEmail(event.organizer?.email);
}

function privateProperty(
  event: GoogleCalendarApiEvent,
  key: string,
): string | null {
  const value = event.extendedProperties?.private?.[key];
  return typeof value === "string" && value ? value : null;
}

export function googleCalendarEventMatchesCreateRequest(
  event: GoogleCalendarApiEvent,
  requestKey: string,
  organizerEmail: string,
): boolean {
  let eventId: string;
  try {
    eventId = normalizeGoogleCalendarEventId(event.id ?? "");
  } catch {
    return false;
  }
  return (
    eventId === googleCalendarEventIdForRequestKey(requestKey)
    && privateProperty(event, "ruinedCreateRequest")
      === googleCalendarRequestHash(requestKey)
    && googleCalendarOrganizerEmail(event)
      === normalizedProviderEmail(organizerEmail)
  );
}

export function googleCalendarEventIsRuinedOwned(
  event: GoogleCalendarApiEvent,
  organizerEmail: string,
): boolean {
  const createRequest = privateProperty(event, "ruinedCreateRequest");
  let eventId: string;
  try {
    eventId = normalizeGoogleCalendarEventId(event.id ?? "");
  } catch {
    return false;
  }
  return (
    eventId.startsWith("ruined")
    && /^[a-f0-9]{64}$/.test(createRequest ?? "")
    && googleCalendarOrganizerEmail(event)
      === normalizedProviderEmail(organizerEmail)
  );
}

function comparableAttendeeEmails(
  attendees: GoogleCalendarApiEvent["attendees"] | GoogleCalendarAttendee[],
): string[] | null {
  const emails: string[] = [];
  for (const attendee of attendees ?? []) {
    const email = normalizedProviderEmail(attendee.email);
    if (!email) return null;
    emails.push(email);
  }
  return [...new Set(emails)].sort((left, right) => left.localeCompare(right));
}

function calendarTimesMatch(
  provider: GoogleCalendarEventTime | undefined,
  desired: GoogleCalendarEventTime,
): boolean {
  if (!provider || ("date" in provider) !== ("date" in desired)) return false;
  if ("date" in desired) {
    return "date" in provider && provider.date === desired.date;
  }
  if (!("dateTime" in provider)) return false;
  if (Date.parse(provider.dateTime) !== Date.parse(desired.dateTime)) return false;
  return !desired.timeZone || provider.timeZone === desired.timeZone;
}

function sourceMatches(
  provider: GoogleCalendarApiEvent["source"],
  desired: GoogleCalendarEventBody["source"],
): boolean {
  if (!desired) return true;
  return provider?.title === desired.title && provider.url === desired.url;
}

/**
 * Compares the member-visible source of truth. Provider-only response fields,
 * attendee response statuses, and display-name normalization are intentionally
 * ignored; a human edit to copy, timing, place, audience, or privacy is not.
 */
export function googleCalendarEventMatchesBody(
  event: GoogleCalendarApiEvent,
  body: GoogleCalendarEventBody,
): boolean {
  const providerAttendees = comparableAttendeeEmails(event.attendees);
  const desiredAttendees = comparableAttendeeEmails(body.attendees);
  return (
    event.summary === body.summary
    && (event.description ?? "") === (body.description ?? "")
    && (event.location ?? "") === (body.location ?? "")
    && calendarTimesMatch(event.start, body.start)
    && calendarTimesMatch(event.end, body.end)
    && providerAttendees !== null
    && desiredAttendees !== null
    && providerAttendees.length === desiredAttendees.length
    && providerAttendees.every((email, index) => email === desiredAttendees[index])
    && event.guestsCanInviteOthers === body.guestsCanInviteOthers
    && (event.guestsCanModify ?? false) === body.guestsCanModify
    && event.guestsCanSeeOtherGuests === body.guestsCanSeeOtherGuests
    && (event.transparency ?? "opaque") === body.transparency
    && event.visibility === body.visibility
    && sourceMatches(event.source, body.source)
  );
}

/** Confirms an ambiguous PATCH actually committed this exact logical update. */
export function googleCalendarEventMatchesAppliedUpdate(
  event: GoogleCalendarApiEvent,
  body: GoogleCalendarEventBody,
): boolean {
  const expectedUpdate = body.extendedProperties.private.ruinedUpdateRequest;
  const expectedMeet = body.extendedProperties.private.ruinedMeetRequest;
  return (
    Boolean(expectedUpdate)
    && privateProperty(event, "ruinedUpdateRequest") === expectedUpdate
    && (!expectedMeet
      || privateProperty(event, "ruinedMeetRequest") === expectedMeet)
    && googleCalendarEventMatchesBody(event, body)
  );
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || (url.port && url.port !== "443")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function safeMeetUrl(value: unknown): string | null {
  const safe = safeHttpsUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  return url.hostname === "meet.google.com" ? safe : null;
}

export function googleCalendarConferenceStatus(
  event: GoogleCalendarApiEvent,
): GoogleCalendarConferenceStatus {
  if (googleCalendarMeetUrl(event)) return "success";
  const status = event.conferenceData?.createRequest?.status?.statusCode;
  return status === "pending" || status === "success" || status === "failure"
    ? status
    : null;
}

export function googleCalendarMeetUrl(event: GoogleCalendarApiEvent): string | null {
  const direct = safeMeetUrl(event.hangoutLink);
  if (direct) return direct;
  for (const entryPoint of event.conferenceData?.entryPoints ?? []) {
    if (entryPoint.entryPointType !== "video") continue;
    const candidate = safeMeetUrl(entryPoint.uri);
    if (candidate) return candidate;
  }
  return null;
}

export function toGoogleCalendarEventResult(
  event: GoogleCalendarApiEvent,
  expectedOrganizerEmail: string,
): GoogleCalendarEventResult {
  if (typeof event.id !== "string" || !event.id.trim()) {
    throw new Error("Google Calendar returned an event without an ID.");
  }
  const meetUrl = googleCalendarMeetUrl(event);
  const conferenceStatus = googleCalendarConferenceStatus(event);
  const organizerEmail = googleCalendarOrganizerEmail(event);
  return {
    conferenceId:
      typeof event.conferenceData?.conferenceId === "string"
        ? event.conferenceData.conferenceId
        : null,
    conferenceStatus,
    etag: typeof event.etag === "string" ? event.etag : null,
    eventId: event.id,
    htmlUrl: safeHttpsUrl(event.htmlLink),
    iCalUid: typeof event.iCalUID === "string" ? event.iCalUID : null,
    meetReady: conferenceStatus === "success" && Boolean(meetUrl),
    meetUrl,
    organizerEmail,
    organizerVerified:
      organizerEmail === normalizedProviderEmail(expectedOrganizerEmail),
    status: typeof event.status === "string" ? event.status : null,
    updatedAt: typeof event.updated === "string" ? event.updated : null,
  };
}
