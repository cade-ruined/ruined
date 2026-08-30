# Google Calendar operator setup

Ruined creates Calendar invitations directly as `cade@theruinedproject.com`.
The preferred production configuration uses that organizer's OAuth refresh
grant. No member or operator signs in to Google through the Ruined app, and the
app does not expose an OAuth callback.

## Direct organizer OAuth setup

1. In the Ruined Google Cloud project, enable the Google Calendar API.
2. Configure the Google Auth Platform audience as **Internal** and create a
   **Web application** OAuth client named `Ruined Calendar Operator`.
3. Add this exact authorized redirect URI to that client, then download its
   client JSON:

   `http://127.0.0.1:53682/oauth2callback`

4. From the repository root, start Ruined's one-time local authorization tool
   with the path to that downloaded file:

   ```sh
   npm run google:calendar:authorize -- /path/to/google-oauth-client.json
   ```

5. Open the URL printed by the tool and sign in specifically as
   `cade@theruinedproject.com`. The tool requests offline access to identity
   verification and exactly this Calendar scope:

   `https://www.googleapis.com/auth/calendar.events.owned`

6. The temporary listener accepts only the fixed loopback callback, shuts down
   after the attempt, verifies the OAuth audience, verified Workspace email,
   hosted domain, and granted Calendar scope, then securely updates only the
   six Google Calendar keys in the Git-ignored `.env.local`. It never prints the
   client secret, authorization code, access token, ID token, or refresh token.
   Existing unrelated `.env.local` settings are preserved.
7. Confirm that `cade@theruinedproject.com` is an active Workspace user with
   Calendar and Google Meet available before enabling invitations.

The helper is intentionally local and one-time; the Ruined app does not expose
an OAuth callback route. Copy the three OAuth values to each production secret
store through its protected environment controls. Never paste them into an
operator form, commit them, or expose them with a `NEXT_PUBLIC_` name.

Authorizing a different account changes who owns and sends every invitation.
If the organizer changes after events have been published, existing linked
events intentionally require an explicit cutover rather than being silently
adopted by the new organizer.

Official references:

- [Google web-server OAuth authorization](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Creating events and unique Meet conferences](https://developers.google.com/workspace/calendar/api/guides/create-events)

## Ruined environment

Set these independently in each environment:

```dotenv
GOOGLE_CALENDAR_ENABLED=true
GOOGLE_CALENDAR_ORGANIZER_EMAIL=cade@theruinedproject.com
GOOGLE_CALENDAR_CALENDAR_ID=primary
GOOGLE_CALENDAR_OAUTH_CLIENT_ID=<OAuth client ID>
GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET=<OAuth client secret>
GOOGLE_CALENDAR_OAUTH_REFRESH_TOKEN=<offline refresh token>
```

The runtime prefers OAuth only when all three OAuth values are present. Partial
OAuth configuration is ignored. For backward compatibility, environments that
do not have the complete OAuth set can continue using:

```dotenv
GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_BASE64=<base64 service-account JSON>
```

That fallback still requires a dedicated service account with domain-wide
delegation for only `calendar.events.owned`, impersonating the configured
organizer. Calendar credentials remain separate from
`GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64`.

## Runtime behavior

- One stable Ruined request key becomes one deterministic Google event ID, so a
  retried create cannot produce a second invitation.
- Every event requests its own Google Meet conference. Conference details are
  never copied between events.
- Creates, updates, and cancellations use `sendUpdates=all` so Google emails
  every attendee affected by that change.
- Member registrations and cancellations reconcile an existing published invite
  after the Ruined registration transaction commits. A Google failure never
  rolls back or loses the member's place.
- Attendees cannot modify the event, add guests, or see the other guests.
- Updates carry a stable logical request key. A retry refetches the provider
  event, verifies Ruined ownership and organizer identity, compares the actual
  event content, and reconciles against Google's current ETag.
- A cancellation deletes the organizer's event and sends cancellation notices.
- The app uses only the `calendar.events.owned` OAuth scope. It cannot manage
  Calendar settings, calendars, sharing rules, events on calendars the
  organizer does not own, or unrelated Google Workspace products.

Keep `GOOGLE_CALENDAR_ENABLED=false` until the organizer, OAuth grant, secrets,
and a real test invitation have all been verified in that environment.
