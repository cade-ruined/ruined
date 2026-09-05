import assert from "node:assert/strict";
import * as buffer from "node:buffer";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const organizer = "calendar@example.test";
const draft = {
  attendees: [{ email: "current-member@example.test" }],
  description: "Current details.",
  end: { dateTime: "2026-09-12T21:00:00-06:00", timeZone: "America/Denver" },
  location: "Current venue",
  requestKey: "experience:11111111-1111-4111-8111-111111111111:create:v1",
  sourceUrl: "https://members.example.test/my/experiences/example",
  start: { dateTime: "2026-09-12T18:00:00-06:00", timeZone: "America/Denver" },
  summary: "Current Circle gathering",
};

async function compile(path, dependencies, context = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  // The actual provider client runs with isolated configuration and auth cache.
  // Neither real credentials nor a network-capable auth implementation is used.
  new Function("require", "module", "exports", "process", "globalThis", compiled)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports, { env: context.env ?? {} }, {});
  return cjsModule.exports;
}

const model = await compile("src/lib/google/calendar-model.ts", { "node:crypto": crypto });

async function clientFixture(respond) {
  const calls = [];
  class MockOAuthClient {
    setCredentials() {}
    async request(options) {
      calls.push(structuredClone(options));
      return { data: structuredClone(await respond(options, calls.length)) };
    }
  }
  class UnexpectedServiceAccount {
    constructor() { throw new Error("Service-account authentication is outside this isolated fixture."); }
  }
  const client = await compile("src/lib/google/calendar.ts", {
    "server-only": {},
    "node:buffer": buffer,
    "node:crypto": crypto,
    "google-auth-library": { OAuth2Client: MockOAuthClient, JWT: UnexpectedServiceAccount },
    "@/lib/google/calendar-model": model,
  }, {
    env: {
      GOOGLE_CALENDAR_ENABLED: "true",
      GOOGLE_CALENDAR_ORGANIZER_EMAIL: organizer,
      GOOGLE_CALENDAR_CALENDAR_ID: "primary",
      GOOGLE_CALENDAR_OAUTH_CLIENT_ID: "isolated-client",
      GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: "isolated-secret",
      GOOGLE_CALENDAR_OAUTH_REFRESH_TOKEN: "isolated-refresh",
    },
  });
  return { client, calls };
}

function remoteEvent(input = draft, overrides = {}) {
  const body = model.buildGoogleCalendarCreateBody(input, organizer);
  return {
    ...body,
    etag: '"remote-v1"',
    organizer: { email: organizer },
    status: "confirmed",
    conferenceData: {
      conferenceId: "abc-defg-hij",
      createRequest: { requestId: body.conferenceData.createRequest.requestId, status: { statusCode: "success" } },
      entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }],
    },
    ...overrides,
  };
}

function providerError(status) {
  return Object.assign(new Error("Simulated provider response"), { response: { status } });
}

function assertReadOnly(calls) {
  assert.ok(calls.length > 0);
  assert.ok(calls.every((call) => call.method === "GET"));
}

test("recovering an unchanged create reads the existing event without another invitation write", async () => {
  const remote = remoteEvent();
  const { client, calls } = await clientFixture(() => remote);
  const result = await client.createGoogleCalendarEvent({ ...draft, recoverExisting: true });
  assert.deepEqual(calls.map((call) => call.method), ["GET"]);
  assert.ok(calls[0].url.endsWith(`/events/${remote.id}`));
  assert.equal(result.eventId, remote.id);
  assert.equal(result.meetReady, true);
  assert.equal(result.organizerVerified, true);
});

test("recovery updates stale text and attendees using the latest provider ETag, never another create", async () => {
  let remote = remoteEvent({ ...draft, summary: "Obsolete title", attendees: [{ email: "removed-member@example.test" }] });
  const { client, calls } = await clientFixture((options, count) => {
    if (options.method === "GET") {
      if (count === 2) remote = { ...remote, etag: '"freshly-read-v2"' };
      return remote;
    }
    assert.equal(options.method, "PATCH");
    assert.equal(options.headers["If-Match"], '"freshly-read-v2"');
    remote = { ...remote, ...options.data, etag: '"applied-v3"' };
    return remote;
  });
  const result = await client.createGoogleCalendarEvent({ ...draft, recoverExisting: true });
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "PATCH"]);
  assert.equal(calls[2].params.sendUpdates, "all");
  assert.equal(remote.summary, draft.summary);
  assert.deepEqual(remote.attendees, draft.attendees);
  assert.equal(result.etag, '"applied-v3"');
  assert.ok(model.googleCalendarEventMatchesBody(remote, model.buildGoogleCalendarCreateBody(draft, organizer)));
});

test("an ambiguous create response reconciles an existing stale event before returning success", async () => {
  let remote = remoteEvent({ ...draft, description: "Earlier details", attendees: [{ email: "previous-member@example.test" }] });
  const { client, calls } = await clientFixture((options) => {
    if (options.method === "POST") throw providerError(409);
    if (options.method === "PATCH") remote = { ...remote, ...options.data, etag: '"reconciled"' };
    return remote;
  });
  const result = await client.createGoogleCalendarEvent(draft);
  assert.deepEqual(calls.map((call) => call.method), ["POST", "GET", "GET", "PATCH"]);
  assert.deepEqual(remote.attendees, draft.attendees);
  assert.equal(remote.description, draft.description);
  assert.equal(result.etag, '"reconciled"');
});

test("GET-first recovery creates only after an explicit missing-event response", async () => {
  const { client, calls } = await clientFixture((options) => {
    if (options.method === "GET") throw providerError(404);
    assert.equal(options.method, "POST");
    return remoteEvent();
  });
  await client.createGoogleCalendarEvent({ ...draft, recoverExisting: true });
  assert.deepEqual(calls.map((call) => call.method), ["GET", "POST"]);
  assert.equal(calls[1].data.id, model.googleCalendarEventIdForRequestKey(draft.requestKey));
  assert.equal(calls[1].params.sendUpdates, "all");
  assert.equal(calls[1].params.conferenceDataVersion, 1);
});

test("failed provider reads never become permission-bypassing or duplicate creates", async () => {
  for (const status of [401, 403, 410, 429, 500]) {
    const { client, calls } = await clientFixture(() => { throw providerError(status); });
    await assert.rejects(client.createGoogleCalendarEvent({ ...draft, recoverExisting: true }),
      (error) => error instanceof client.GoogleCalendarApiError && error.status === status);
    assert.deepEqual(calls.map((call) => call.method), ["GET"]);
  }
});

test("recovery refuses unrelated or differently owned events before attempting a write", async () => {
  const variants = [
    { organizer: { email: "different-owner@example.test" } },
    { extendedProperties: { private: {} } },
    { extendedProperties: { private: { ruinedCreateRequest: "f".repeat(64) } } },
    { id: model.googleCalendarEventIdForRequestKey(`${draft.requestKey}:different`) },
  ];
  for (const overrides of variants) {
    const { client, calls } = await clientFixture(() => remoteEvent(draft, overrides));
    await assert.rejects(client.createGoogleCalendarEvent({ ...draft, recoverExisting: true }), client.GoogleCalendarConflictError);
    assertReadOnly(calls);
  }
});

test("explicit binding verification is read-only and requires Ruined ownership and organizer", async () => {
  const remote = remoteEvent();
  const { client, calls } = await clientFixture(() => remote);
  const result = await client.getRuinedOwnedGoogleCalendarEventResult(remote.id);
  assert.equal(result.eventId, remote.id);
  assert.equal(result.organizerVerified, true);
  assertReadOnly(calls);
  for (const overrides of [{ organizer: { email: "other@example.test" } }, { extendedProperties: { private: {} } }]) {
    const fixture = await clientFixture(() => remoteEvent(draft, overrides));
    await assert.rejects(fixture.client.getRuinedOwnedGoogleCalendarEventResult(remote.id), fixture.client.GoogleCalendarConflictError);
    assertReadOnly(fixture.calls);
  }
});

test("repeated cancellation treats both deleted-event responses as success, but preserves authorization failures", async () => {
  const id = model.googleCalendarEventIdForRequestKey(draft.requestKey);
  for (const status of [404, 410, 403, 500]) {
    const { client, calls } = await clientFixture(() => { throw providerError(status); });
    if (status === 404 || status === 410) await client.cancelGoogleCalendarEvent(id);
    else await assert.rejects(client.cancelGoogleCalendarEvent(id),
      (error) => error instanceof client.GoogleCalendarApiError && error.status === status);
    assert.deepEqual(calls.map((call) => call.method), ["DELETE"]);
    assert.equal(calls[0].params.sendUpdates, "all");
    assert.ok(calls[0].url.endsWith(`/events/${id}`));
  }
});
