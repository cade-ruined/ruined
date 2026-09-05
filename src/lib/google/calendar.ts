import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { JWT, OAuth2Client, type AuthClient } from "google-auth-library";

import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  buildGoogleCalendarCreateBody,
  buildGoogleCalendarUpdateBody,
  googleCalendarConferenceStatus,
  googleCalendarEventIsRuinedOwned,
  googleCalendarEventMatchesAppliedUpdate,
  googleCalendarEventMatchesBody,
  googleCalendarEventMatchesCreateRequest,
  googleCalendarMeetUrl,
  googleMeetRequestIdForEventState,
  normalizeGoogleCalendarEventId,
  toGoogleCalendarEventResult,
  type GoogleCalendarApiEvent,
  type GoogleCalendarEventDraft,
  type GoogleCalendarEventResult,
  type GoogleCalendarEventUpdate,
} from "@/lib/google/calendar-model";

const GOOGLE_CALENDAR_API_ROOT = "https://www.googleapis.com/calendar/v3";
const REQUEST_TIMEOUT_MS = 10_000;
const MEET_POLL_DELAYS_MS = [150, 350, 750] as const;
const MAX_UPDATE_RECONCILIATION_ATTEMPTS = 3;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CalendarServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
  type: "service_account";
};

type CalendarOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type CalendarAuthentication =
  | {
      credentials: CalendarOAuthCredentials;
      mode: "oauth";
    }
  | {
      credentials: CalendarServiceAccountCredentials;
      mode: "service_account";
    };

type GoogleCalendarConfiguration = CalendarAuthentication & {
  calendarId: string;
  organizerEmail: string;
};

export type GoogleCalendarConfigurationStatus = {
  calendarId: string;
  enabled: boolean;
  missing: string[];
  organizerEmail: string | null;
  ready: boolean;
  scope: typeof GOOGLE_CALENDAR_EVENTS_SCOPE;
};

declare global {
  var ruinedGoogleCalendarAuth: AuthClient | undefined;
  var ruinedGoogleCalendarAuthSignature: string | undefined;
}

export class GoogleCalendarApiError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super("Google Calendar could not complete the request.");
    this.name = "GoogleCalendarApiError";
    this.status = status;
  }
}

export class GoogleCalendarConflictError extends Error {
  constructor() {
    super("The Google Calendar event changed before this update.");
    this.name = "GoogleCalendarConflictError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCalendarServiceAccountCredentials(
  encoded: string,
): CalendarServiceAccountCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as unknown;
  } catch {
    throw new Error("Google Calendar service account credentials are invalid.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Google Calendar service account credentials are invalid.");
  }
  const clientEmail = parsed.client_email;
  const privateKey = parsed.private_key;
  const privateKeyId = parsed.private_key_id;
  const projectId = parsed.project_id;
  if (
    parsed.type !== "service_account"
    || typeof clientEmail !== "string"
    || !clientEmail.endsWith(".gserviceaccount.com")
    || typeof privateKey !== "string"
    || !privateKey.includes("-----BEGIN PRIVATE KEY-----")
    || !privateKey.includes("-----END PRIVATE KEY-----")
    || (privateKeyId !== undefined && typeof privateKeyId !== "string")
    || (projectId !== undefined && typeof projectId !== "string")
  ) {
    throw new Error("Google Calendar service account credentials are invalid.");
  }

  return {
    type: "service_account",
    client_email: clientEmail,
    private_key: privateKey,
    ...(privateKeyId ? { private_key_id: privateKeyId } : {}),
    ...(projectId ? { project_id: projectId } : {}),
  };
}

function normalizedOrganizerEmail(value: string | undefined): string | null {
  const email = value?.trim().toLowerCase();
  return email && EMAIL_PATTERN.test(email) ? email : null;
}

function normalizedCalendarId(value: string | undefined): string | null {
  const calendarId = value?.trim() || "primary";
  return calendarId.length <= 1_024 && !/[\u0000-\u001f\u007f\s]/.test(calendarId)
    ? calendarId
    : null;
}

function readGoogleCalendarAuthentication(): CalendarAuthentication | null {
  const clientId = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_CALENDAR_OAUTH_REFRESH_TOKEN?.trim();
  if (clientId && clientSecret && refreshToken) {
    return {
      credentials: { clientId, clientSecret, refreshToken },
      mode: "oauth",
    };
  }

  const encoded =
    process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (!encoded) return null;
  try {
    return {
      credentials: parseCalendarServiceAccountCredentials(encoded),
      mode: "service_account",
    };
  } catch {
    return null;
  }
}

export function getGoogleCalendarConfigurationStatus(): GoogleCalendarConfigurationStatus {
  const enabled = process.env.GOOGLE_CALENDAR_ENABLED === "true";
  const organizerEmail = normalizedOrganizerEmail(
    process.env.GOOGLE_CALENDAR_ORGANIZER_EMAIL,
  );
  const calendarId = normalizedCalendarId(process.env.GOOGLE_CALENDAR_CALENDAR_ID);
  const authentication = readGoogleCalendarAuthentication();
  const missing = [
    ...(!enabled ? ["GOOGLE_CALENDAR_ENABLED"] : []),
    ...(!organizerEmail ? ["GOOGLE_CALENDAR_ORGANIZER_EMAIL"] : []),
    ...(!calendarId ? ["GOOGLE_CALENDAR_CALENDAR_ID (invalid)"] : []),
    ...(!authentication
      ? ["Google Calendar OAuth refresh credentials or service-account JSON"]
      : []),
  ];

  return {
    calendarId: calendarId ?? "primary",
    enabled,
    missing,
    organizerEmail,
    ready: missing.length === 0,
    scope: GOOGLE_CALENDAR_EVENTS_SCOPE,
  };
}

function requireGoogleCalendarConfiguration(): GoogleCalendarConfiguration {
  const status = getGoogleCalendarConfigurationStatus();
  if (!status.ready || !status.organizerEmail) {
    throw new Error("Google Calendar is not configured.");
  }
  const authentication = readGoogleCalendarAuthentication();
  if (!authentication) throw new Error("Google Calendar is not configured.");

  return {
    ...authentication,
    calendarId: status.calendarId,
    organizerEmail: status.organizerEmail,
  };
}

function googleCalendarAuthSignature(
  configuration: GoogleCalendarConfiguration,
): string {
  return createHash("sha256")
    .update(JSON.stringify(configuration))
    .digest("hex");
}

function getGoogleCalendarAuth(
  configuration: GoogleCalendarConfiguration,
): AuthClient {
  const signature = googleCalendarAuthSignature(configuration);
  if (
    globalThis.ruinedGoogleCalendarAuth
    && globalThis.ruinedGoogleCalendarAuthSignature === signature
  ) {
    return globalThis.ruinedGoogleCalendarAuth;
  }

  let auth: AuthClient;
  if (configuration.mode === "oauth") {
    auth = new OAuth2Client({
      clientId: configuration.credentials.clientId,
      clientSecret: configuration.credentials.clientSecret,
    });
    auth.setCredentials({
      refresh_token: configuration.credentials.refreshToken,
    });
  } else {
    auth = new JWT({
      email: configuration.credentials.client_email,
      key: configuration.credentials.private_key,
      keyId: configuration.credentials.private_key_id,
      scopes: [GOOGLE_CALENDAR_EVENTS_SCOPE],
      subject: configuration.organizerEmail,
    });
  }
  globalThis.ruinedGoogleCalendarAuth = auth;
  globalThis.ruinedGoogleCalendarAuthSignature = signature;
  return auth;
}

function calendarEventUrl(calendarId: string, eventId?: string): string {
  const calendar = encodeURIComponent(calendarId);
  return eventId
    ? `${GOOGLE_CALENDAR_API_ROOT}/calendars/${calendar}/events/${encodeURIComponent(eventId)}`
    : `${GOOGLE_CALENDAR_API_ROOT}/calendars/${calendar}/events`;
}

function errorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === "number") return error.status;
  const response = error.response;
  return isRecord(response) && typeof response.status === "number"
    ? response.status
    : null;
}

async function calendarRequest<T>(
  configuration: GoogleCalendarConfiguration,
  options: Parameters<AuthClient["request"]>[0],
): Promise<T> {
  try {
    const response = await getGoogleCalendarAuth(configuration).request<T>({
      ...options,
      timeout: REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    throw new GoogleCalendarApiError(errorStatus(error));
  }
}

async function getGoogleCalendarApiEvent(
  configuration: GoogleCalendarConfiguration,
  eventId: string,
): Promise<GoogleCalendarApiEvent> {
  const normalizedEventId = normalizeGoogleCalendarEventId(eventId);
  return calendarRequest<GoogleCalendarApiEvent>(configuration, {
    method: "GET",
    retry: true,
    retryConfig: {
      httpMethodsToRetry: ["GET"],
      noResponseRetries: 2,
      retry: 2,
      statusCodesToRetry: [[408, 408], [429, 429], [500, 599]],
    },
    url: calendarEventUrl(configuration.calendarId, normalizedEventId),
  });
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForGoogleMeet(
  configuration: GoogleCalendarConfiguration,
  event: GoogleCalendarApiEvent,
): Promise<GoogleCalendarApiEvent> {
  if (googleCalendarMeetUrl(event) || googleCalendarConferenceStatus(event) === "failure") {
    return event;
  }
  if (!event.id) return event;

  let current = event;
  for (const delay of MEET_POLL_DELAYS_MS) {
    await pause(delay);
    current = await getGoogleCalendarApiEvent(configuration, event.id);
    if (
      googleCalendarMeetUrl(current)
      || googleCalendarConferenceStatus(current) === "failure"
    ) {
      break;
    }
  }
  return current;
}

function isAmbiguousWriteFailure(error: unknown): boolean {
  if (!(error instanceof GoogleCalendarApiError)) return false;
  return (
    error.status === null
    || error.status === 408
    || error.status === 409
    || error.status === 412
    || error.status === 429
    || (error.status >= 500 && error.status <= 599)
  );
}

function requireRuinedOwnedEvent(
  event: GoogleCalendarApiEvent,
  configuration: GoogleCalendarConfiguration,
): GoogleCalendarApiEvent {
  if (!googleCalendarEventIsRuinedOwned(event, configuration.organizerEmail)) {
    throw new GoogleCalendarConflictError();
  }
  return event;
}

async function getRuinedOwnedGoogleCalendarEvent(
  configuration: GoogleCalendarConfiguration,
  eventId: string,
): Promise<GoogleCalendarApiEvent> {
  return requireRuinedOwnedEvent(
    await getGoogleCalendarApiEvent(configuration, eventId),
    configuration,
  );
}

async function requireMatchingCreatedEvent(
  configuration: GoogleCalendarConfiguration,
  input: GoogleCalendarEventDraft,
  event: GoogleCalendarApiEvent,
): Promise<GoogleCalendarApiEvent> {
  if (
    googleCalendarEventMatchesCreateRequest(
      event,
      input.requestKey,
      configuration.organizerEmail,
    )
  ) {
    return event;
  }

  const expectedId = buildGoogleCalendarCreateBody(
    input,
    configuration.organizerEmail,
  ).id;
  if (!expectedId) throw new GoogleCalendarConflictError();
  const current = await getGoogleCalendarApiEvent(configuration, expectedId);
  if (
    !googleCalendarEventMatchesCreateRequest(
      current,
      input.requestKey,
      configuration.organizerEmail,
    )
  ) {
    throw new GoogleCalendarConflictError();
  }
  return current;
}

export async function getGoogleCalendarEvent(
  eventId: string,
): Promise<GoogleCalendarEventResult> {
  const configuration = requireGoogleCalendarConfiguration();
  const event = await getGoogleCalendarApiEvent(configuration, eventId);
  return toGoogleCalendarEventResult(event, configuration.organizerEmail);
}

/** Read-only verification for an explicit operator binding/recovery action. */
export async function getRuinedOwnedGoogleCalendarEventResult(eventId: string): Promise<GoogleCalendarEventResult> {
  const configuration = requireGoogleCalendarConfiguration();
  return toGoogleCalendarEventResult(
    await getRuinedOwnedGoogleCalendarEvent(configuration, eventId), configuration.organizerEmail,
  );
}

export async function createGoogleCalendarEvent(
  input: GoogleCalendarEventDraft & { recoverExisting?: boolean },
): Promise<GoogleCalendarEventResult> {
  const configuration = requireGoogleCalendarConfiguration();
  const body = buildGoogleCalendarCreateBody(input, configuration.organizerEmail);
  let event: GoogleCalendarApiEvent | undefined;

  if (input.recoverExisting && body.id) {
    try { event = await getGoogleCalendarApiEvent(configuration, body.id); }
    catch (error) {
      if (!(error instanceof GoogleCalendarApiError) || error.status !== 404) throw error;
    }
  }

  if (!event) try {
    event = await calendarRequest<GoogleCalendarApiEvent>(configuration, {
      data: body,
      method: "POST",
      params: {
        conferenceDataVersion: 1,
        sendUpdates: "all",
      },
      url: calendarEventUrl(configuration.calendarId),
    });
  } catch (error) {
    if (!isAmbiguousWriteFailure(error) || !body.id) {
      throw error;
    }
    try {
      event = await getGoogleCalendarApiEvent(configuration, body.id);
    } catch (reconciliationError) {
      if (
        reconciliationError instanceof GoogleCalendarApiError
        && reconciliationError.status === 404
      ) {
        throw error;
      }
      throw reconciliationError;
    }
  }

  event = await requireMatchingCreatedEvent(configuration, input, event);
  // A deterministic ID proves identity, not freshness. An earlier ambiguous
  // create may have different text or attendees; reconcile before saying synced.
  if (!googleCalendarEventMatchesBody(event, body)) {
    return updateGoogleCalendarEvent({ ...input, eventId: event.id!, expectedEtag: event.etag ?? null });
  }

  return toGoogleCalendarEventResult(
    await waitForGoogleMeet(configuration, event),
    configuration.organizerEmail,
  );
}

export async function updateGoogleCalendarEvent(
  input: GoogleCalendarEventUpdate,
): Promise<GoogleCalendarEventResult> {
  const configuration = requireGoogleCalendarConfiguration();
  const eventId = normalizeGoogleCalendarEventId(input.eventId);
  // The repository ETag is a useful audit value, but the app owns the desired
  // event state. Always refetch, compare content as well as request markers,
  // and condition the PATCH on Google's current ETag.
  let current = await getRuinedOwnedGoogleCalendarEvent(configuration, eventId);

  for (let attempt = 0; attempt < MAX_UPDATE_RECONCILIATION_ATTEMPTS; attempt += 1) {
    const conferenceStatus = googleCalendarConferenceStatus(current);
    const needsMeetRequest =
      !googleCalendarMeetUrl(current) && conferenceStatus !== "pending";
    const body = buildGoogleCalendarUpdateBody(
      input,
      configuration.organizerEmail,
      current.extendedProperties?.private,
      {
        ...(needsMeetRequest
          ? {
              meetRequestId: googleMeetRequestIdForEventState(
                input.requestKey,
                current,
              ),
            }
          : {}),
      },
    );

    if (
      googleCalendarEventMatchesAppliedUpdate(current, body)
      && !needsMeetRequest
    ) {
      const settled = await waitForGoogleMeet(configuration, current);
      return toGoogleCalendarEventResult(
        settled,
        configuration.organizerEmail,
      );
    }
    if (!current.etag) throw new GoogleCalendarConflictError();

    try {
      let event = await calendarRequest<GoogleCalendarApiEvent>(configuration, {
        data: body,
        headers: { "If-Match": current.etag },
        method: "PATCH",
        params: {
          conferenceDataVersion: 1,
          sendUpdates: "all",
        },
        url: calendarEventUrl(configuration.calendarId, eventId),
      });
      if (
        !googleCalendarEventIsRuinedOwned(event, configuration.organizerEmail)
        || !googleCalendarEventMatchesAppliedUpdate(event, body)
      ) {
        event = await getRuinedOwnedGoogleCalendarEvent(configuration, eventId);
      }
      if (!googleCalendarEventMatchesAppliedUpdate(event, body)) {
        current = event;
        continue;
      }
      const settled = await waitForGoogleMeet(configuration, event);
      return toGoogleCalendarEventResult(
        settled,
        configuration.organizerEmail,
      );
    } catch (error) {
      if (!isAmbiguousWriteFailure(error)) throw error;
      current = await getRuinedOwnedGoogleCalendarEvent(configuration, eventId);
      if (googleCalendarEventMatchesAppliedUpdate(current, body)) {
        const settled = await waitForGoogleMeet(configuration, current);
        return toGoogleCalendarEventResult(
          settled,
          configuration.organizerEmail,
        );
      }
    }
  }

  throw new GoogleCalendarConflictError();
}

/**
 * Google represents a deleted organizer event as cancelled and emails every
 * attendee when sendUpdates is `all`. Repeating a completed cancellation is a
 * success because the remote event is already gone.
 */
export async function cancelGoogleCalendarEvent(eventId: string): Promise<void> {
  const configuration = requireGoogleCalendarConfiguration();
  const normalizedEventId = normalizeGoogleCalendarEventId(eventId);
  try {
    await calendarRequest<unknown>(configuration, {
      method: "DELETE",
      params: { sendUpdates: "all" },
      url: calendarEventUrl(configuration.calendarId, normalizedEventId),
    });
  } catch (error) {
    if (error instanceof GoogleCalendarApiError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
}

export const deleteGoogleCalendarEvent = cancelGoogleCalendarEvent;
