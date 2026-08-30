import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  buildGoogleCalendarCreateBody,
  buildGoogleCalendarUpdateBody,
  googleCalendarEventIdForRequestKey,
  googleCalendarEventMatchesAppliedUpdate,
  googleCalendarEventMatchesCreateRequest,
  googleCalendarMeetUrl,
  googleMeetRequestIdForEventState,
  googleMeetRequestIdForRequestKey,
  normalizeGoogleCalendarEventId,
  toGoogleCalendarEventResult,
  type GoogleCalendarEventDraft,
  type GoogleCalendarApiEvent,
} from "../src/lib/google/calendar-model.ts";

async function source(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const draft: GoogleCalendarEventDraft = {
  attendees: [
    { displayName: "Zed", email: "ZED@example.com" },
    { displayName: "Cade", email: "cade@example.com" },
    { email: "zed@example.com" },
    { displayName: "Ruined", email: "connect@theruinedproject.com" },
  ],
  description: "  Bring what you are building.  ",
  end: { dateTime: "2026-09-12T21:00:00-06:00", timeZone: "America/Denver" },
  location: "  Ruined House  ",
  requestKey: "experience:2f901be8-1111-4444-8888-f85385f83a10:create:v1",
  sourceUrl: "https://theruinedproject.com/my/experiences/example#details",
  start: { dateTime: "2026-09-12T18:00:00-06:00", timeZone: "America/Denver" },
  summary: "  Every Second Friday  ",
};

test("Calendar create bodies are private, deterministic, and request one unique Meet", () => {
  const body = buildGoogleCalendarCreateBody(draft, "connect@theruinedproject.com");
  const again = buildGoogleCalendarCreateBody(draft, "connect@theruinedproject.com");
  const otherEvent = buildGoogleCalendarCreateBody(
    { ...draft, requestKey: `${draft.requestKey}:other` },
    "connect@theruinedproject.com",
  );

  assert.equal(
    GOOGLE_CALENDAR_EVENTS_SCOPE,
    "https://www.googleapis.com/auth/calendar.events.owned",
  );
  assert.equal(body.id, again.id);
  assert.equal(
    body.conferenceData?.createRequest.requestId,
    again.conferenceData?.createRequest.requestId,
  );
  assert.notEqual(body.id, otherEvent.id);
  assert.notEqual(
    body.conferenceData?.createRequest.requestId,
    otherEvent.conferenceData?.createRequest.requestId,
  );
  assert.match(body.id ?? "", /^ruined[a-f0-9]{64}$/);
  assert.match(
    body.conferenceData?.createRequest.requestId ?? "",
    /^ruinedmeet[a-f0-9]{64}$/,
  );
  assert.equal(body.conferenceData?.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
  assert.equal(body.guestsCanInviteOthers, false);
  assert.equal(body.guestsCanModify, false);
  assert.equal(body.guestsCanSeeOtherGuests, false);
  assert.equal(body.visibility, "private");
  assert.equal(body.summary, "Every Second Friday");
  assert.equal(body.description, "Bring what you are building.");
  assert.equal(body.location, "Ruined House");
  assert.equal(body.source?.url, "https://theruinedproject.com/my/experiences/example");
  assert.deepEqual(body.attendees, [
    { displayName: "Cade", email: "cade@example.com" },
    { displayName: "Zed", email: "zed@example.com" },
  ]);
  assert.match(body.extendedProperties.private.ruinedCreateRequest, /^[a-f0-9]{64}$/);
});

test("Calendar updates retain private metadata, clear optional copy, and dedupe by update key", () => {
  const body = buildGoogleCalendarUpdateBody(
    {
      ...draft,
      description: null,
      eventId: googleCalendarEventIdForRequestKey(draft.requestKey),
      location: "",
      requestKey: `${draft.requestKey}:update:7`,
    },
    "connect@theruinedproject.com",
    { ruinedCreateRequest: "created", unrelatedPrivateValue: "preserved" },
  );

  assert.equal(body.description, "");
  assert.equal(body.location, "");
  assert.equal(body.extendedProperties.private.ruinedCreateRequest, "created");
  assert.equal(body.extendedProperties.private.unrelatedPrivateValue, "preserved");
  assert.match(body.extendedProperties.private.ruinedUpdateRequest, /^[a-f0-9]{64}$/);
  assert.equal(body.conferenceData, undefined, "an update must preserve the existing Meet");
});

test("Calendar update reconciliation compares desired content, not only its request marker", () => {
  const body = buildGoogleCalendarUpdateBody(
    {
      ...draft,
      eventId: googleCalendarEventIdForRequestKey(draft.requestKey),
      requestKey: `${draft.requestKey}:update:8`,
    },
    "connect@theruinedproject.com",
    { ruinedCreateRequest: "a".repeat(64) },
  );
  const providerEvent: GoogleCalendarApiEvent = {
    attendees: body.attendees,
    description: body.description,
    end: body.end,
    etag: '"provider-etag"',
    extendedProperties: body.extendedProperties,
    guestsCanInviteOthers: body.guestsCanInviteOthers,
    guestsCanModify: body.guestsCanModify,
    guestsCanSeeOtherGuests: body.guestsCanSeeOtherGuests,
    id: googleCalendarEventIdForRequestKey(draft.requestKey),
    location: body.location,
    organizer: { email: "CONNECT@theruinedproject.com" },
    source: body.source,
    start: body.start,
    summary: body.summary,
    transparency: body.transparency,
    visibility: body.visibility,
  };

  assert.equal(googleCalendarEventMatchesAppliedUpdate(providerEvent, body), true);
  assert.equal(
    googleCalendarEventMatchesAppliedUpdate(
      {
        ...providerEvent,
        guestsCanModify: undefined,
        transparency: undefined,
      },
      body,
    ),
    true,
    "Google may omit default false and opaque values from an event response",
  );
  assert.equal(
    googleCalendarEventMatchesAppliedUpdate(
      { ...providerEvent, guestsCanModify: true },
      body,
    ),
    false,
  );
  assert.equal(
    googleCalendarEventMatchesAppliedUpdate(
      { ...providerEvent, transparency: "transparent" },
      body,
    ),
    false,
  );
  assert.equal(
    googleCalendarEventMatchesAppliedUpdate(
      { ...providerEvent, summary: "Human-edited title" },
      body,
    ),
    false,
  );
  assert.equal(
    googleCalendarEventMatchesAppliedUpdate(
      { ...providerEvent, attendees: [{ email: "someone-else@example.com" }] },
      body,
    ),
    false,
  );
});

test("missing or failed Meet recovery is stable for one provider state and unique for the next", () => {
  const event: GoogleCalendarApiEvent = {
    conferenceData: {
      createRequest: {
        requestId: googleMeetRequestIdForRequestKey(draft.requestKey),
        status: { statusCode: "failure" },
      },
    },
    etag: '"failed-1"',
    updated: "2026-08-29T04:00:00.000Z",
  };
  const requestId = googleMeetRequestIdForEventState(
    `${draft.requestKey}:update:9`,
    event,
  );
  assert.equal(
    requestId,
    googleMeetRequestIdForEventState(`${draft.requestKey}:update:9`, event),
  );
  assert.notEqual(
    requestId,
    googleMeetRequestIdForEventState(`${draft.requestKey}:update:9`, {
      ...event,
      etag: '"failed-2"',
    }),
  );

  const body = buildGoogleCalendarUpdateBody(
    {
      ...draft,
      eventId: googleCalendarEventIdForRequestKey(draft.requestKey),
      requestKey: `${draft.requestKey}:update:9`,
    },
    "connect@theruinedproject.com",
    { ruinedCreateRequest: "a".repeat(64) },
    { meetRequestId: requestId },
  );
  assert.equal(body.conferenceData?.createRequest.requestId, requestId);
  assert.match(
    body.extendedProperties.private.ruinedMeetRequest ?? "",
    /^[a-f0-9]{64}$/,
  );
});

test("create recovery accepts only the exact Ruined request and delegated organizer", () => {
  const body = buildGoogleCalendarCreateBody(
    draft,
    "connect@theruinedproject.com",
  );
  const event: GoogleCalendarApiEvent = {
    extendedProperties: body.extendedProperties,
    id: body.id,
    organizer: { email: "CONNECT@theruinedproject.com" },
  };
  assert.equal(
    googleCalendarEventMatchesCreateRequest(
      event,
      draft.requestKey,
      "connect@theruinedproject.com",
    ),
    true,
  );
  assert.equal(
    googleCalendarEventMatchesCreateRequest(
      {
        ...event,
        extendedProperties: {
          private: { ruinedCreateRequest: "b".repeat(64) },
        },
      },
      draft.requestKey,
      "connect@theruinedproject.com",
    ),
    false,
  );
  assert.equal(
    googleCalendarEventMatchesCreateRequest(
      { ...event, organizer: { email: "other@theruinedproject.com" } },
      draft.requestKey,
      "connect@theruinedproject.com",
    ),
    false,
  );
});

test("Calendar event and Meet identifiers reject unsafe or provider-invalid values", () => {
  const eventId = googleCalendarEventIdForRequestKey(draft.requestKey);
  assert.equal(normalizeGoogleCalendarEventId(eventId.toUpperCase()), eventId);
  assert.throws(() => normalizeGoogleCalendarEventId("../../calendar"), /event ID is invalid/);
  assert.throws(() => googleMeetRequestIdForRequestKey("bad key"), /request key is invalid/);
});

test("Calendar event validation rejects malformed dates, time ranges, URLs, and attendees", () => {
  const build = (change: Partial<GoogleCalendarEventDraft>) =>
    buildGoogleCalendarCreateBody({ ...draft, ...change }, "connect@theruinedproject.com");

  assert.throws(
    () => build({ start: { date: "2026-02-30" }, end: { date: "2026-03-01" } }),
    /date is invalid/,
  );
  assert.throws(
    () => build({ start: { dateTime: "2026-09-12T18:00:00" } }),
    /must be RFC3339 with a UTC offset/,
  );
  assert.throws(
    () => build({ end: draft.start }),
    /end must be after its start/,
  );
  assert.throws(
    () => build({ sourceUrl: "http://theruinedproject.com/my" }),
    /source URL is invalid/,
  );
  assert.throws(
    () => build({ attendees: [{ email: "not-an-email" }] }),
    /attendee email is invalid/,
  );
});

test("Calendar responses expose only safe URLs and the Meet generation status", () => {
  const result = toGoogleCalendarEventResult({
    conferenceData: {
      conferenceId: "abc-defg-hij",
      createRequest: { status: { statusCode: "success" } },
      entryPoints: [
        { entryPointType: "video", uri: "https://evil.example/room" },
        { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
      ],
    },
    etag: '"etag"',
    htmlLink: "https://calendar.google.com/calendar/event?eid=one",
    iCalUID: "one@google.com",
    id: googleCalendarEventIdForRequestKey(draft.requestKey),
    organizer: { email: "connect@theruinedproject.com" },
    status: "confirmed",
    updated: "2026-08-29T01:02:03.000Z",
  }, "connect@theruinedproject.com");

  assert.equal(result.conferenceStatus, "success");
  assert.equal(result.conferenceId, "abc-defg-hij");
  assert.equal(result.iCalUid, "one@google.com");
  assert.equal(result.meetUrl, "https://meet.google.com/abc-defg-hij");
  assert.equal(result.organizerEmail, "connect@theruinedproject.com");
  assert.equal(result.organizerVerified, true);
  assert.equal(result.meetReady, true);
  assert.equal(
    googleCalendarMeetUrl({ hangoutLink: "javascript:alert(1)" }),
    null,
  );
});

test("the runtime client supports organizer OAuth and delegated fallback without changing invite safety", async () => {
  const [client, environment, documentation] = await Promise.all([
    source("src/lib/google/calendar.ts"),
    source(".env.example"),
    source("docs/google-calendar-operator-setup.md"),
  ]);

  assert.match(client, /^import "server-only";/);
  assert.match(client, /new OAuth2Client\(\{/);
  assert.match(client, /clientId: configuration\.credentials\.clientId/);
  assert.match(client, /clientSecret: configuration\.credentials\.clientSecret/);
  assert.match(client, /auth\.setCredentials\(\{[\s\S]*refresh_token:/);
  assert.match(client, /configuration\.mode === "oauth"[\s\S]*new OAuth2Client/);
  assert.match(
    client,
    /if \(clientId && clientSecret && refreshToken\)[\s\S]*mode: "oauth"[\s\S]*GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_BASE64/,
  );
  assert.match(client, /new JWT\(\{[\s\S]*subject: configuration\.organizerEmail/);
  assert.match(client, /scopes: \[GOOGLE_CALENDAR_EVENTS_SCOPE\]/);
  assert.match(client, /conferenceDataVersion: 1/);
  assert.ok((client.match(/sendUpdates: "all"/g) ?? []).length >= 3);
  assert.match(client, /isAmbiguousWriteFailure[\s\S]*getGoogleCalendarApiEvent/);
  assert.match(client, /googleCalendarEventMatchesAppliedUpdate/);
  assert.match(client, /googleCalendarEventMatchesCreateRequest/);
  assert.match(client, /googleMeetRequestIdForEventState/);
  assert.match(client, /"If-Match": current\.etag/);
  assert.match(client, /waitForGoogleMeet\(configuration, event\)/);
  assert.match(client, /error\.status === 404/);
  assert.doesNotMatch(client, /GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64/);

  for (const name of [
    "GOOGLE_CALENDAR_ENABLED",
    "GOOGLE_CALENDAR_ORGANIZER_EMAIL",
    "GOOGLE_CALENDAR_CALENDAR_ID",
    "GOOGLE_CALENDAR_OAUTH_CLIENT_ID",
    "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET",
    "GOOGLE_CALENDAR_OAUTH_REFRESH_TOKEN",
    "GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_BASE64",
  ]) {
    assert.match(environment, new RegExp(`(?:^|\\n)${name}=`));
    assert.match(client, new RegExp(`process\\.env\\.${name}`));
    assert.match(documentation, new RegExp(name));
  }
  assert.doesNotMatch(environment, /NEXT_PUBLIC_GOOGLE_CALENDAR/);
  assert.match(documentation, /cade@theruinedproject\.com/);
  assert.match(documentation, /prefers OAuth only when all three OAuth values are present/);
  assert.match(documentation, /backward compatibility/);
  assert.match(documentation, /calendar\.events\.owned/);
  assert.match(client, /Google Calendar OAuth refresh credentials or service-account JSON/);
  const statusSource = client.slice(
    client.indexOf("export function getGoogleCalendarConfigurationStatus"),
    client.indexOf("function requireGoogleCalendarConfiguration"),
  );
  assert.doesNotMatch(
    statusSource,
    /OAUTH_CLIENT_SECRET|OAUTH_REFRESH_TOKEN|clientSecret|refreshToken/,
  );
});
