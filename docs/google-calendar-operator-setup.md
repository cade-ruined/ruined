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

## Durable delivery and recovery

Explicitly publishing an event that has not ended records its first Calendar
invitation in the same transaction as the Experience change, only when Calendar
is configured and ready with an explicit test/live mode. Ordinary edits never
create the first invitation for an older, already-published event. Edits,
cancellations, and Circle/Block roster changes record desired revisions for an
existing Calendar link. Closing the browser cannot discard that work. The
explicit **Sync invitations** and **Send cancellation** controls remain
available; a separate browser request is no longer required after save.

If an event ends before an invitation or update is delivered, automatic delivery
pauses and the Calendar panel shows **Review past event**. The worker does not
claim or repeatedly retry that paused work. An operator can review it and choose
an explicit Calendar action; cancellations continue to recover automatically,
including for archived events with a recorded cancellation.

The protected `/api/internal/integrations/google-calendar/process` endpoint
accepts GET or POST with the configured `CRON_SECRET` bearer credential. It
processes one invitation per call. Provider requests occur outside database
transactions, with a ten-minute durable reservation lease and a five-minute
maximum route execution window. Failed provider requests retry with exponential
backoff from 30 seconds to one hour. An interrupted request is recoverable after
its lease expires. Newer revisions supersede stale snapshots; recovered creates
verify the deterministic provider identity and reconcile current contents before
reporting success. A cancelled Experience still delivers its cancellation if it
is archived before the worker runs.

The Vercel schedule is only a daily fallback on the current Hobby plan. Timely
automatic delivery requires activation of a supported frequent scheduler; see
[`worker-recovery-activation.md`](worker-recovery-activation.md). This code change
does not activate that scheduler or send a test invitation.

## Verify older invitations after the delivery-mode migration

Apply `20260904225258_calendar_durable_reconciliation.sql` before releasing code
that reads its fields. It does not guess whether existing invitations are test
or live. Unbound records are visible as **Verify delivery mode**, and cannot send.
Disable or drain Calendar producers running older code before the migration and
cutover, including other hosts sharing the database. The additive migration
cannot impose the new mode checks on an old application or rollback deployment.

1. An active administrator opens the Experience's Google Calendar panel.
2. Confirm the selected organizer and explicitly configured test/live mode.
3. Choose **Verify & bind to test** or **Verify & bind to live** and confirm.
4. The app only reads Google, verifies the saved Ruined event and organizer,
   rechecks administrator access and record version, and audits the binding.
   It sends nothing and pauses background delivery for that record.
5. Choose **Sync invitations** or **Send cancellation** to authorize the pending
   delivery. A subsequent authorized Experience/roster edit also resumes delivery.

The binding cannot later be changed to another mode. A missing event, changed
organizer, unrelated provider event, or legacy record without a saved provider ID
fails closed and requires owner review; the app does not create a replacement.
Google Calendar has no email sandbox: **test** is an isolation label, and an
explicit test send still emails its actual selected recipients.

Verification for this change is isolated PostgreSQL plus mocked provider HTTP;
production migration, legacy binding, scheduler activation, and real invitation
smoke testing remain separate release steps.
