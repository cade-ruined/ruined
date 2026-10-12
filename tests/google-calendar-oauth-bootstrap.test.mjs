import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_CALENDAR_CALLBACK_URL,
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  assertFixedLoopbackCallback,
  mergeGoogleCalendarEnv,
  parseGoogleCalendarBootstrapArgs,
  parseGoogleOAuthClientJson,
  redactOAuthSecrets,
  validateCallbackRequestMetadata,
  validateGoogleIdTokenClaims,
  validateGrantedGoogleScopes,
  validateOAuthTokenBundle,
  validateOrganizerEmail,
} from "../scripts/lib/google-calendar-oauth-bootstrap.mjs";

const clientId = "test-client.apps.googleusercontent.com";

function clientJson(change = {}) {
  return JSON.stringify({
    web: {
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      client_id: clientId,
      client_secret: "test-client-secret",
      redirect_uris: [GOOGLE_CALENDAR_CALLBACK_URL],
      token_uri: "https://oauth2.googleapis.com/token",
      ...change,
    },
  });
}

test("the bootstrap accepts only Google's Web client and fixed IPv4 loopback callback", () => {
  assert.deepEqual(parseGoogleOAuthClientJson(clientJson()), {
    clientId,
    clientSecret: "test-client-secret",
  });
  assert.equal(assertFixedLoopbackCallback().href, GOOGLE_CALENDAR_CALLBACK_URL);
  assert.throws(
    () => parseGoogleOAuthClientJson(JSON.stringify({ installed: {} })),
    /Web application/,
  );
  assert.throws(
    () => parseGoogleOAuthClientJson(clientJson({ redirect_uris: ["http://localhost:53682/oauth2callback"] })),
    /authorized redirect URIs/,
  );
  assert.throws(
    () => assertFixedLoopbackCallback("http://0.0.0.0:53682/oauth2callback"),
    /fixed loopback/,
  );
});

test("the callback metadata rejects non-loopback, alternate hosts, and non-GET requests", () => {
  assert.doesNotThrow(() => validateCallbackRequestMetadata({
    host: "127.0.0.1:53682",
    method: "GET",
    remoteAddress: "127.0.0.1",
  }));
  assert.throws(() => validateCallbackRequestMetadata({
    host: "127.0.0.1:53682",
    method: "GET",
    remoteAddress: "192.0.2.4",
  }), /did not come from this computer/);
  assert.throws(() => validateCallbackRequestMetadata({
    host: "localhost:53682",
    method: "GET",
    remoteAddress: "127.0.0.1",
  }), /fixed loopback/);
  assert.throws(() => validateCallbackRequestMetadata({
    host: "127.0.0.1:53682",
    method: "POST",
    remoteAddress: "127.0.0.1",
  }), /fixed loopback/);
});

test("organizer selection supports explicit Workspace accounts and retains the Cade default", () => {
  assert.deepEqual(parseGoogleCalendarBootstrapArgs(["client.json"]), {
    help: false,
    clientPath: "client.json",
    organizerEmail: "cade@theruinedproject.com",
  });
  for (const args of [
    ["client.json", "--organizer", "CONNECT@theruinedproject.com"],
    ["--organizer", "connect@theruinedproject.com", "client.json"],
    ["client.json", "connect@theruinedproject.com"],
  ]) {
    assert.deepEqual(parseGoogleCalendarBootstrapArgs(args), {
      help: false,
      clientPath: "client.json",
      organizerEmail: "connect@theruinedproject.com",
    });
  }
  assert.deepEqual(parseGoogleCalendarBootstrapArgs(["--help"]), { help: true });
  for (const args of [
    [],
    ["client.json", "--organizer"],
    ["client.json", "--organizer", "--help"],
    ["client.json", "--organizer", "connect@theruinedproject.com", "--organizer", "cade@theruinedproject.com"],
    ["client.json", "--organizer", "connect@theruinedproject.com", "cade@theruinedproject.com"],
    ["client.json", "connect@theruinedproject.com", "extra"],
    ["client.json", "--unknown"],
  ]) {
    assert.throws(() => parseGoogleCalendarBootstrapArgs(args));
  }
  for (const email of [
    "connect@gmail.com",
    "connect@theruinedproject.com.example.com",
    "connect@@theruinedproject.com",
    "Connect <connect@theruinedproject.com>",
    "connect@theruinedproject.com\n",
    "@theruinedproject.com",
    "",
    null,
  ]) {
    assert.throws(() => validateOrganizerEmail(email));
  }
});

test("identity validation defaults to Cade and still verifies Workspace domain and OAuth audience", () => {
  assert.deepEqual(validateGoogleIdTokenClaims({
    aud: clientId,
    email: "CADE@theruinedproject.com",
    email_verified: true,
    hd: "theruinedproject.com",
  }, clientId), {
    email: "cade@theruinedproject.com",
    hostedDomain: "theruinedproject.com",
  });
  assert.throws(() => validateGoogleIdTokenClaims({
    aud: "other.apps.googleusercontent.com",
    email: "cade@theruinedproject.com",
    email_verified: true,
    hd: "theruinedproject.com",
  }, clientId), /different OAuth client/);
  assert.throws(() => validateGoogleIdTokenClaims({
    aud: clientId,
    email: "connect@theruinedproject.com",
    email_verified: true,
    hd: "theruinedproject.com",
  }, clientId), /Authorize exactly cade/);
  assert.throws(() => validateGoogleIdTokenClaims({
    aud: clientId,
    email: "cade@theruinedproject.com",
    email_verified: true,
    hd: "example.com",
  }, clientId), /must belong to theruinedproject/);
});

test("an explicitly selected organizer must match Google's verified identity exactly", () => {
  const claims = {
    aud: clientId,
    email: "connect@theruinedproject.com",
    email_verified: true,
    hd: "theruinedproject.com",
  };
  assert.deepEqual(validateGoogleIdTokenClaims(claims, clientId, "connect@theruinedproject.com"), {
    email: "connect@theruinedproject.com",
    hostedDomain: "theruinedproject.com",
  });
  assert.throws(() => validateGoogleIdTokenClaims({
    ...claims, email: "cade@theruinedproject.com",
  }, clientId, "connect@theruinedproject.com"), /Authorize exactly connect/);
  assert.throws(() => validateGoogleIdTokenClaims({
    ...claims, email_verified: false,
  }, clientId, "connect@theruinedproject.com"), /email is not verified/);
  assert.throws(() => validateGoogleIdTokenClaims({
    ...claims, hd: "example.com",
  }, clientId, "connect@theruinedproject.com"), /must belong to theruinedproject/);
  assert.throws(() => validateGoogleIdTokenClaims({
    ...claims, aud: "other.apps.googleusercontent.com",
  }, clientId, "connect@theruinedproject.com"), /different OAuth client/);
  assert.throws(() => validateGoogleIdTokenClaims({
    ...claims, email: "connect@example.com",
  }, clientId, "connect@example.com"), /organizer must be/);
});

test("scope and token validation require the narrow Calendar grant and an offline refresh token", () => {
  const scopes = validateGrantedGoogleScopes([
    "openid",
    "email",
    GOOGLE_CALENDAR_EVENTS_SCOPE,
  ]);
  assert.equal(scopes.has(GOOGLE_CALENDAR_EVENTS_SCOPE), true);
  assert.throws(
    () => validateGrantedGoogleScopes(["openid", "email"]),
    /did not grant Ruined permission/,
  );
  assert.throws(
    () => validateGrantedGoogleScopes([
      GOOGLE_CALENDAR_EVENTS_SCOPE,
      "https://www.googleapis.com/auth/calendar",
    ]),
    /broader Calendar access/,
  );
  assert.deepEqual(validateOAuthTokenBundle({
    access_token: "test-access-token",
    id_token: "test-id-token",
    refresh_token: "test-refresh-token",
  }), {
    accessToken: "test-access-token",
    idToken: "test-id-token",
    refreshToken: "test-refresh-token",
  });
  assert.throws(() => validateOAuthTokenBundle({
    access_token: "test-access-token",
    id_token: "test-id-token",
  }), /refresh token/);
});

test("the env merge changes only Calendar keys, removes target duplicates, and preserves unrelated content", () => {
  const existing = [
    "# existing local settings",
    "DATABASE_URL=postgres://example.invalid/database",
    "GOOGLE_CALENDAR_ENABLED=false",
    "UNRELATED=value with spaces",
    "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET=old-secret",
    "GOOGLE_CALENDAR_ENABLED=duplicate",
    "",
  ].join("\r\n");
  const merged = mergeGoogleCalendarEnv(existing, {
    GOOGLE_CALENDAR_CALENDAR_ID: "primary",
    GOOGLE_CALENDAR_ENABLED: "true",
    GOOGLE_CALENDAR_OAUTH_CLIENT_ID: clientId,
    GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: "new-client-secret",
    GOOGLE_CALENDAR_OAUTH_REFRESH_TOKEN: "test-refresh-token",
    GOOGLE_CALENDAR_ORGANIZER_EMAIL: "connect@theruinedproject.com",
  });

  assert.match(merged, /^# existing local settings\r\nDATABASE_URL=/);
  assert.match(merged, /\r\nUNRELATED=value with spaces\r\n/);
  assert.equal((merged.match(/^GOOGLE_CALENDAR_ENABLED=/gm) ?? []).length, 1);
  assert.match(merged, /^GOOGLE_CALENDAR_ENABLED=true$/m);
  assert.match(merged, /^GOOGLE_CALENDAR_ORGANIZER_EMAIL=connect@theruinedproject\.com$/m);
  assert.match(merged, /^GOOGLE_CALENDAR_CALENDAR_ID=primary$/m);
  assert.match(merged, /^GOOGLE_CALENDAR_OAUTH_CLIENT_ID=test-client\.apps\.googleusercontent\.com$/m);
  assert.match(merged, /^GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET=new-client-secret$/m);
  assert.match(merged, /^GOOGLE_CALENDAR_OAUTH_REFRESH_TOKEN=test-refresh-token$/m);
  assert.doesNotMatch(merged, /old-secret|duplicate/);
});

test("diagnostic redaction removes known secrets and OAuth query credentials", () => {
  const secret = "super-secret-value";
  const redacted = redactOAuthSecrets(
    `failure ${secret} client_secret=visible&code=authorization-code access_token=access`,
    [secret],
  );
  assert.doesNotMatch(redacted, /super-secret-value|authorization-code|visible|access$/);
  assert.match(redacted, /\[REDACTED\]/);
});
