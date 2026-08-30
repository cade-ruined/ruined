import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { OAuth2Client } from "google-auth-library";

import {
  GOOGLE_CALENDAR_CALLBACK_URL,
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_CALENDAR_OAUTH_SCOPES,
  GOOGLE_CALENDAR_ORGANIZER_EMAIL,
  GoogleCalendarBootstrapError,
  assertFixedLoopbackCallback,
  readOAuthClientFile,
  validateCallbackRequestMetadata,
  validateGoogleIdTokenClaims,
  validateGrantedGoogleScopes,
  validateOAuthTokenBundle,
  writeGoogleCalendarEnvLocal,
} from "./lib/google-calendar-oauth-bootstrap.mjs";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const ENV_LOCAL_PATH = resolve(REPOSITORY_ROOT, ".env.local");
const CALLBACK_TIMEOUT_MS = 10 * 60 * 1_000;

function usage() {
  return [
    "Authorize Ruined to create Google Calendar events as Cade.",
    "",
    "Usage:",
    "  npm run google:calendar:authorize -- /path/to/google-oauth-client.json",
    "",
    `The Web OAuth client must authorize ${GOOGLE_CALENDAR_CALLBACK_URL}.`,
  ].join("\n");
}

function stateMatches(expected, received) {
  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(received, "utf8");
  return expectedBytes.length === receivedBytes.length
    && timingSafeEqual(expectedBytes, receivedBytes);
}

function browserResponse(response, statusCode, title, message) {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
  </head>
  <body style="margin:0;background:#e5e0d5;color:#2a2a2a;font-family:system-ui,sans-serif">
    <main style="max-width:42rem;margin:12vh auto;padding:2rem">
      <p style="font-size:.75rem;letter-spacing:.16em;text-transform:uppercase">Ruined Calendar</p>
      <h1 style="font-size:2rem;line-height:1.05">${title}</h1>
      <p style="font-size:1rem;line-height:1.5">${message}</p>
    </main>
  </body>
</html>`;
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Connection": "close",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function startCallbackListener(expectedState) {
  const callback = assertFixedLoopbackCallback();
  let settle;
  const codePromise = new Promise((resolveCode, rejectCode) => {
    let settled = false;
    settle = (error, code) => {
      if (settled) return;
      settled = true;
      if (error) rejectCode(error);
      else resolveCode(code);
    };
  });

  const server = createServer((request, response) => {
    const remoteAddress = request.socket.remoteAddress ?? "";
    try {
      validateCallbackRequestMetadata({
        host: request.headers.host ?? "",
        method: request.method ?? "",
        remoteAddress,
      });
    } catch {
      browserResponse(
        response,
        403,
        "Request refused",
        "This authorization callback is available only on this computer.",
      );
      return;
    }

    let requestUrl;
    try {
      requestUrl = new URL(request.url ?? "", callback.origin);
    } catch {
      browserResponse(response, 400, "Invalid request", "Return to the setup command and try again.");
      return;
    }
    if (requestUrl.pathname !== callback.pathname) {
      browserResponse(response, 404, "Not found", "Return to the Google authorization window.");
      return;
    }

    const returnedState = requestUrl.searchParams.get("state") ?? "";
    if (!stateMatches(expectedState, returnedState)) {
      browserResponse(response, 400, "Authorization refused", "The security check did not match. Run the setup command again.");
      settle(new GoogleCalendarBootstrapError(
        "Google returned an authorization with an invalid security state.",
      ));
      return;
    }
    if (requestUrl.searchParams.has("error")) {
      browserResponse(response, 400, "Authorization not completed", "No credentials were saved. Return to the setup command and try again.");
      settle(new GoogleCalendarBootstrapError(
        "Google authorization was not completed. No credentials were saved.",
      ));
      return;
    }

    const code = requestUrl.searchParams.get("code") ?? "";
    if (code.length < 8 || code.length > 8_192 || /[\u0000\r\n]/.test(code)) {
      browserResponse(response, 400, "Authorization not completed", "Google did not return a valid authorization. Run the setup command again.");
      settle(new GoogleCalendarBootstrapError(
        "Google did not return a valid authorization code.",
      ));
      return;
    }

    browserResponse(
      response,
      200,
      "Authorization received",
      "Return to Codex while Ruined verifies the account and permission. You may close this tab.",
    );
    settle(null, code);
  });
  server.maxHeadersCount = 32;
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;

  await new Promise((resolveListening, rejectListening) => {
    const onError = (error) => {
      server.off("listening", onListening);
      rejectListening(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListening();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({
      exclusive: true,
      host: callback.hostname,
      port: Number(callback.port),
    });
  }).catch(() => {
    throw new GoogleCalendarBootstrapError(
      "The secure local callback could not start. Close anything using port 53682 and try again.",
    );
  });

  const timeout = setTimeout(() => {
    settle(new GoogleCalendarBootstrapError(
      "Google authorization expired after 10 minutes. No credentials were saved.",
    ));
  }, CALLBACK_TIMEOUT_MS);

  return {
    codePromise,
    async close() {
      clearTimeout(timeout);
      if (!server.listening) return;
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

async function assertEnvLocalIsIgnored() {
  try {
    await execFileAsync(
      "git",
      ["check-ignore", "--quiet", "--no-index", ".env.local"],
      { cwd: REPOSITORY_ROOT },
    );
  } catch {
    throw new GoogleCalendarBootstrapError(
      "Refusing to save credentials because .env.local is not ignored by Git.",
    );
  }
}

async function main() {
  const argument = process.argv[2];
  if (argument === "--help" || argument === "-h") {
    console.log(usage());
    return;
  }
  if (!argument || process.argv.length !== 3 || argument.startsWith("-")) {
    throw new GoogleCalendarBootstrapError(usage());
  }

  await assertEnvLocalIsIgnored();
  assertFixedLoopbackCallback();
  const clientPath = resolve(process.cwd(), argument);
  const { clientId, clientSecret } = await readOAuthClientFile(clientPath);
  const state = randomBytes(32).toString("base64url");
  const oauth = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: GOOGLE_CALENDAR_CALLBACK_URL,
  });
  const authorizationUrl = oauth.generateAuthUrl({
    access_type: "offline",
    hd: "theruinedproject.com",
    include_granted_scopes: false,
    login_hint: GOOGLE_CALENDAR_ORGANIZER_EMAIL,
    prompt: "consent",
    scope: GOOGLE_CALENDAR_OAUTH_SCOPES,
    state,
  });

  const listener = await startCallbackListener(state);
  try {
    console.log(
      `Open this Google authorization link while signed in as ${GOOGLE_CALENDAR_ORGANIZER_EMAIL}:\n`,
    );
    console.log(authorizationUrl);
    console.log("\nWaiting for Google authorization (up to 10 minutes)…");

    const code = await listener.codePromise;
    await listener.close();

    const { tokens } = await oauth.getToken(code);
    const { accessToken, idToken, refreshToken } = validateOAuthTokenBundle(tokens);
    const ticket = await oauth.verifyIdToken({
      audience: clientId,
      idToken,
    });
    validateGoogleIdTokenClaims(ticket.getPayload(), clientId);

    let grantedScopes = tokens.scope;
    if (!grantedScopes) {
      const tokenInfo = await oauth.getTokenInfo(accessToken);
      grantedScopes = tokenInfo.scopes;
    }
    validateGrantedGoogleScopes(grantedScopes);

    await writeGoogleCalendarEnvLocal(ENV_LOCAL_PATH, {
      GOOGLE_CALENDAR_CALENDAR_ID: "primary",
      GOOGLE_CALENDAR_ENABLED: "true",
      GOOGLE_CALENDAR_OAUTH_CLIENT_ID: clientId,
      GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: clientSecret,
      GOOGLE_CALENDAR_OAUTH_REFRESH_TOKEN: refreshToken,
      GOOGLE_CALENDAR_ORGANIZER_EMAIL: GOOGLE_CALENDAR_ORGANIZER_EMAIL,
    });

    console.log(
      `\nVerified ${GOOGLE_CALENDAR_ORGANIZER_EMAIL} with ${GOOGLE_CALENDAR_EVENTS_SCOPE}.`,
    );
    console.log("The protected Google Calendar settings were saved to .env.local.");
    console.log("Restart the local Ruined server before testing invitations.");
  } finally {
    await listener.close();
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof GoogleCalendarBootstrapError
    ? error.message
    : "Google Calendar authorization failed. No credentials were saved.";
  console.error(message);
  process.exitCode = 1;
}
