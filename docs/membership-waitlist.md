# Membership waitlist

## Behavior

`/#members` contains the waitlist form directly in the walk and collects name, email, and optional phone. The former `/members` page redirects to this section; menu, footer, and search links also lead here. `POST /api/members/waitlist` normalizes the email and saves to `public.membership_waitlist` in Supabase. Repeating an email returns the same confirmation without changing its original details or position. Joining the waitlist does not create a membership, send email, or subscribe someone to general marketing.

The signup and `membership_waitlist.sheet_sync_requested` outbox event commit in one database transaction. Google delivery runs after the HTTP response. Missing Google configuration or an outage does not lose accepted signups.

The API requires a trusted origin and JSON, caps streamed bodies at 4 KiB, uses a hidden honeypot, and permits eight attempts per hashed IP/hour. `DATABASE_URL` and `COMMUNICATION_RATE_LIMIT_SECRET` are required. Supabase `anon` and `authenticated` roles have no direct access to the waitlist or rate limits; both tables enable RLS.

## Google Sheet

[Ruined Membership Waitlist](https://docs.google.com/spreadsheets/d/1TS02SX6C3jCIBQVqpnvjbqkiHm1WYcg1B0qVtYznp2E/edit?usp=drivesdk)

- Tab: `Waitlist` (100,000 rows).
- Managed A:F: Joined at (UTC), Name, Email, Phone, Status (`waiting`), Waitlist ID.
- G: Notes, for manual follow-up.
- Sync is one-way from Supabase; editing the sheet does not change the database.
- Managed rows use immutable database row allocations and RAW writes, so lost responses and concurrent retries cannot append duplicates or execute submitted formulas. Notes are never overwritten.
- Keep A:F and row order intact. Use filter views instead of sorting the actual grid. Do not insert/delete rows or move synced values. A conflicting row stops delivery safely; manual deletion of already-synced data is not automatically repaired. The hidden ID column and managed-range protection support this rule, but the owner can override protection.

The sheet grants Editor access to the existing sync identity, `ruined-byob-registrants@linen-jet-506602-e6.iam.gserviceaccount.com`.

## Database setup

For a new environment, apply the existing platform migrations, then run `npm run db:migrate:waitlist`. The waitlist runner checks the existing migration ledger and checksum, so it safely skips the migration already applied in production.

## Runtime configuration

The public Vercel project `ruined` uses these production settings:

```text
GOOGLE_MEMBERSHIP_WAITLIST_SHEET_ENABLED=true
GOOGLE_MEMBERSHIP_WAITLIST_SPREADSHEET_ID=1TS02SX6C3jCIBQVqpnvjbqkiHm1WYcg1B0qVtYznp2E
```

The worker reuses `GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER` and `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL` from the existing Google integration. Federation is restricted to the public project's production identity. Local development and other Vercel projects do not automatically have access. The existing server-only service-account JSON configuration remains supported as a fallback; do not reuse Calendar OAuth credentials.

`GET` or `POST /api/internal/integrations/membership-waitlist/process` requires `Authorization: Bearer <CRON_SECRET>`. The daily recovery cron runs at 13:00 UTC. Submissions attempt up to three queued entries immediately; the cron attempts up to 25 within a 25-second claim budget. Large backlogs may require more than one run.

Workers reclaim leases after ten minutes, retry with exponential backoff, and stop after five attempts. The response reports `claimed`, `processed`, `failed`, `skipped`, and `deadLetter`. Unresolved waitlist dead letters keep the endpoint at HTTP 503. Operator system health currently does not display this integration's queue; use the protected worker result and query below.

## Recovery

Inspect only this integration:

```sql
select status, count(*)
from public.integration_outbox
where destination = 'google'
  and aggregate_type = 'membership_waitlist'
  and event_type = 'membership_waitlist.sheet_sync_requested'
group by status;
```

After correcting the underlying permission, grid, or provider failure, requeue exhausted/failed entries and invoke the protected worker through Vercel's authenticated Cron Jobs control:

```sql
update public.integration_outbox
set status = 'pending', attempts = 0, available_at = now(),
    locked_at = null, locked_by = null, last_error = null, updated_at = now()
where destination = 'google'
  and aggregate_type = 'membership_waitlist'
  and event_type = 'membership_waitlist.sheet_sync_requested'
  and status in ('failed', 'dead_letter');
```

If the sheet's row structure was changed, restore its original grid positions first. Replaying into moved/deleted rows without restoring the structure can duplicate moved entries or misalign notes. For more than 99,999 allocated entries, expand the sheet grid and increase `MEMBERSHIP_WAITLIST_SHEET_MAX_ROW` together. Email deduplication avoids consuming new allocations on routine retries.

## Verification and release procedure — 2026-09-14

- Migration `20260914225359_membership_waitlist.sql` applied and recorded in `private.ruined_platform_migrations`; live RLS and client-role access checks passed.
- The isolated public release passed all 222 tests (including 48 focused integration and public-page checks), covering real PostgreSQL migration/repository/worker SQL with PGlite, duplicate preservation, atomic rollback, rate limiting, origin/body validation, retry ambiguity, worker leases, dead letters, row conflicts, keyless auth, and existing event/contact regressions.
- TypeScript, focused ESLint, and production build passed. Desktop and 390-pixel mobile browser checks found no horizontal overflow; invalid input, errors, retry, and success were verified.
- An isolated local Next server accepted a real test signup, confirmed persistence plus one pending outbox event, and accepted the same email without duplication. The temporary signup and its outbox event were removed.
- The Google Sheet and production settings are configured. After deploying the public project, verify a synthetic signup reaches both Supabase and the Sheet, verify a repeat creates no duplicate, and remove only the synthetic test record. Local testing cannot impersonate the production-only federation identity.

Deploy this public feature from an isolated checkout of `main`. Preserve the existing event Sheets cron and keep unrelated membership/operator and pricing work outside this release.
