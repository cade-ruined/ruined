import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export const GOOGLE_CALENDAR_CALLBACK_URL =
  "http://127.0.0.1:53682/oauth2callback";
export const GOOGLE_CALENDAR_ORGANIZER_EMAIL = "cade@theruinedproject.com";
export const GOOGLE_CALENDAR_ORGANIZER_DOMAIN = "theruinedproject.com";
export const GOOGLE_CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.owned";
export const GOOGLE_CALENDAR_OAUTH_SCOPES = Object.freeze([
  "openid",
  "email",
  GOOGLE_CALENDAR_EVENTS_SCOPE,
]);

export const GOOGLE_CALENDAR_ENV_KEYS = Object.freeze([
  "GOOGLE_CALENDAR_ENABLED",
  "GOOGLE_CALENDAR_ORGANIZER_EMAIL",
  "GOOGLE_CALENDAR_CALENDAR_ID",
  "GOOGLE_CALENDAR_OAUTH_CLIENT_ID",
  "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET",
  "GOOGLE_CALENDAR_OAUTH_REFRESH_TOKEN",
]);

const GOOGLE_AUTH_URIS = new Set([
  "https://accounts.google.com/o/oauth2/auth",
  "https://accounts.google.com/o/oauth2/v2/auth",
]);
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const ENV_KEY_PATTERN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const SAFE_UNQUOTED_ENV_VALUE = /^[A-Za-z0-9_./:@+-]+$/;

export class GoogleCalendarBootstrapError extends Error {
  constructor(message) {
    super(message);
    this.name = "GoogleCalendarBootstrapError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value, label, maximumLength = 4_096) {
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || value.length > maximumLength
    || /[\u0000\r\n]/.test(value)
  ) {
    throw new GoogleCalendarBootstrapError(
      `The OAuth client file has an invalid ${label}.`,
    );
  }
  return value.trim();
}

export function assertFixedLoopbackCallback(value = GOOGLE_CALENDAR_CALLBACK_URL) {
  let callback;
  try {
    callback = new URL(value);
  } catch {
    throw new GoogleCalendarBootstrapError(
      "The OAuth callback must use Ruined's fixed loopback address.",
    );
  }

  if (
    callback.href !== GOOGLE_CALENDAR_CALLBACK_URL
    || callback.protocol !== "http:"
    || callback.hostname !== "127.0.0.1"
    || callback.port !== "53682"
    || callback.pathname !== "/oauth2callback"
    || callback.search
    || callback.hash
    || callback.username
    || callback.password
  ) {
    throw new GoogleCalendarBootstrapError(
      "The OAuth callback must use Ruined's fixed loopback address.",
    );
  }

  return callback;
}

export function parseGoogleOAuthClientJson(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new GoogleCalendarBootstrapError(
      "The selected file is not valid Google OAuth client JSON.",
    );
  }

  if (!isRecord(parsed) || !isRecord(parsed.web)) {
    throw new GoogleCalendarBootstrapError(
      "Use a Google OAuth client created as a Web application.",
    );
  }

  const clientId = requiredString(parsed.web.client_id, "client ID");
  const clientSecret = requiredString(parsed.web.client_secret, "client secret");
  const authUri = requiredString(parsed.web.auth_uri, "authorization URI");
  const tokenUri = requiredString(parsed.web.token_uri, "token URI");
  const redirectUris = parsed.web.redirect_uris;

  if (!clientId.endsWith(".apps.googleusercontent.com")) {
    throw new GoogleCalendarBootstrapError(
      "The OAuth client file has an invalid client ID.",
    );
  }
  if (!GOOGLE_AUTH_URIS.has(authUri) || tokenUri !== GOOGLE_TOKEN_URI) {
    throw new GoogleCalendarBootstrapError(
      "The OAuth client file does not use Google's authorization endpoints.",
    );
  }
  if (
    !Array.isArray(redirectUris)
    || !redirectUris.every((uri) => typeof uri === "string")
    || !redirectUris.includes(GOOGLE_CALENDAR_CALLBACK_URL)
  ) {
    throw new GoogleCalendarBootstrapError(
      `Add ${GOOGLE_CALENDAR_CALLBACK_URL} to this Web application's authorized redirect URIs, then download the JSON again.`,
    );
  }

  return { clientId, clientSecret };
}

export function isLoopbackAddress(value) {
  return value === "127.0.0.1"
    || value === "::1"
    || value === "::ffff:127.0.0.1";
}

export function validateCallbackRequestMetadata({ host, method, remoteAddress }) {
  if (!isLoopbackAddress(remoteAddress)) {
    throw new GoogleCalendarBootstrapError(
      "The OAuth callback was rejected because it did not come from this computer.",
    );
  }
  if (method !== "GET" || host !== "127.0.0.1:53682") {
    throw new GoogleCalendarBootstrapError(
      "The OAuth callback did not use Ruined's fixed loopback address.",
    );
  }
}

export function validateGoogleIdTokenClaims(payload, expectedAudience) {
  if (!isRecord(payload)) {
    throw new GoogleCalendarBootstrapError(
      "Google did not return a verifiable identity.",
    );
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const email = typeof payload.email === "string"
    ? payload.email.trim().toLowerCase()
    : "";
  const hostedDomain = typeof payload.hd === "string"
    ? payload.hd.trim().toLowerCase()
    : "";

  if (!audiences.includes(expectedAudience)) {
    throw new GoogleCalendarBootstrapError(
      "Google returned an identity for a different OAuth client.",
    );
  }
  if (payload.email_verified !== true) {
    throw new GoogleCalendarBootstrapError(
      "The Google account email is not verified.",
    );
  }
  if (email !== GOOGLE_CALENDAR_ORGANIZER_EMAIL) {
    throw new GoogleCalendarBootstrapError(
      `Authorize exactly ${GOOGLE_CALENDAR_ORGANIZER_EMAIL}.`,
    );
  }
  if (hostedDomain !== GOOGLE_CALENDAR_ORGANIZER_DOMAIN) {
    throw new GoogleCalendarBootstrapError(
      `The authorized account must belong to ${GOOGLE_CALENDAR_ORGANIZER_DOMAIN}.`,
    );
  }

  return { email, hostedDomain };
}

export function normalizeGrantedScopes(value) {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s+/)
      : [];
  return new Set(
    candidates
      .filter((scope) => typeof scope === "string")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

export function validateGrantedGoogleScopes(value) {
  const scopes = normalizeGrantedScopes(value);
  if (!scopes.has(GOOGLE_CALENDAR_EVENTS_SCOPE)) {
    throw new GoogleCalendarBootstrapError(
      "Google did not grant Ruined permission to manage Cade's owned events.",
    );
  }

  const unexpectedCalendarScopes = [...scopes].filter(
    (scope) => scope.startsWith("https://www.googleapis.com/auth/calendar")
      && scope !== GOOGLE_CALENDAR_EVENTS_SCOPE,
  );
  if (unexpectedCalendarScopes.length > 0) {
    throw new GoogleCalendarBootstrapError(
      "Google returned broader Calendar access than Ruined requests. Remove the old grant and authorize again.",
    );
  }

  return scopes;
}

export function validateOAuthTokenBundle(tokens) {
  if (!isRecord(tokens)) {
    throw new GoogleCalendarBootstrapError(
      "Google did not return OAuth credentials.",
    );
  }
  const refreshToken = requiredString(tokens.refresh_token, "refresh token", 16_384);
  const accessToken = requiredString(tokens.access_token, "access token", 16_384);
  const idToken = requiredString(tokens.id_token, "ID token", 32_768);
  return { accessToken, idToken, refreshToken };
}

function dotenvValue(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 32_768
    || /[\u0000\r\n]/.test(value)
  ) {
    throw new GoogleCalendarBootstrapError(
      "A Google Calendar environment value is invalid.",
    );
  }
  return SAFE_UNQUOTED_ENV_VALUE.test(value) ? value : JSON.stringify(value);
}

export function mergeGoogleCalendarEnv(source, values) {
  const expectedKeys = new Set(GOOGLE_CALENDAR_ENV_KEYS);
  if (
    !isRecord(values)
    || Object.keys(values).length !== expectedKeys.size
    || Object.keys(values).some((key) => !expectedKeys.has(key))
    || [...expectedKeys].some((key) => typeof values[key] !== "string")
  ) {
    throw new GoogleCalendarBootstrapError(
      "The Google Calendar environment update is incomplete.",
    );
  }

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = source.endsWith("\n");
  const lines = source.length === 0 ? [] : source.split(/\r?\n/);
  if (hadTrailingNewline) lines.pop();

  const written = new Set();
  const merged = [];
  for (const line of lines) {
    const key = ENV_KEY_PATTERN.exec(line)?.[1];
    if (!key || !expectedKeys.has(key)) {
      merged.push(line);
      continue;
    }
    if (written.has(key)) continue;
    merged.push(`${key}=${dotenvValue(values[key])}`);
    written.add(key);
  }
  for (const key of GOOGLE_CALENDAR_ENV_KEYS) {
    if (!written.has(key)) merged.push(`${key}=${dotenvValue(values[key])}`);
  }

  return `${merged.join(newline)}${newline}`;
}

export function redactOAuthSecrets(value, secrets = []) {
  let result = typeof value === "string" ? value : String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) {
      result = result.split(secret).join("[REDACTED]");
    }
  }
  return result.replace(
    /\b(client_secret|refresh_token|access_token|id_token|code)=([^&\s]+)/gi,
    "$1=[REDACTED]",
  );
}

export async function readOAuthClientFile(path) {
  const metadata = await lstat(path).catch(() => null);
  if (
    !metadata
    || !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.size <= 0
    || metadata.size > 64 * 1_024
  ) {
    throw new GoogleCalendarBootstrapError(
      "Choose the downloaded Google Web OAuth client JSON file.",
    );
  }
  return parseGoogleOAuthClientJson(await readFile(path, "utf8"));
}

export async function writeGoogleCalendarEnvLocal(path, values) {
  const existingMetadata = await lstat(path).catch(() => null);
  if (existingMetadata?.isSymbolicLink()) {
    throw new GoogleCalendarBootstrapError(
      ".env.local must be a regular local file, not a symbolic link.",
    );
  }
  if (existingMetadata && !existingMetadata.isFile()) {
    throw new GoogleCalendarBootstrapError(
      ".env.local must be a regular local file.",
    );
  }

  const existing = existingMetadata ? await readFile(path, "utf8") : "";
  const merged = mergeGoogleCalendarEnv(existing, values);
  const temporaryPath = join(
    dirname(path),
    `.env.local.google-calendar-${process.pid}-${Date.now()}`,
  );

  let handle;
  try {
    handle = await open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(merged, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
