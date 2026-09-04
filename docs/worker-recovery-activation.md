# Worker recovery activation

Prepared September 4, 2026. Not activated by this change.

## Current limit

The membership Vercel team is on Hobby (verified read-only September 4).
Hobby supports daily cron jobs, with execution possible anywhere inside the
scheduled hour. Adding a five-minute Vercel cron would fail deployment.
The checked-in daily jobs are fallbacks, not prompt-delivery guarantees.

The database currently has Vault installed, but not `pg_cron` or `pg_net`.
An existing Supabase scheduler is the next option to evaluate; this does not
require signing up for another provider or upgrading Vercel. It still consumes
database and hosting resources, so verify usage limits before activation.

Sources: [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing),
[Supabase scheduled HTTP requests and Vault](https://supabase.com/docs/guides/functions/schedule-functions).

## Activation checklist

1. Approve and deploy the reliability changes only to `ruined-members`.
   Apply the Calendar reconciliation migration first. Keep the public site and
   its worker ownership unchanged.
2. Verify the membership production host, `CRON_SECRET`, integration switches,
   and explicit `GOOGLE_COMMUNICATIONS_LIVEMODE` value. Test mode is not a
   sandbox for Google: it still creates real invitations and sends email.
3. Check extension availability and operational limits in the existing Supabase
   project. Enable `pg_cron` and `pg_net` only as a separately reviewed setup
   change. Do not expose scheduler functions, Vault, or keys to browser roles.
4. Store the production host and the existing server-only cron secret in Vault.
   Scheduled SQL should read the secret from Vault at execution time, never
   embed it in the job definition or print it in logs.
5. Register named, environment-specific jobs to POST every five minutes to
   these membership-only endpoints, with the bearer secret:

   - `/api/internal/communications/process` — transactional support retries;
     retain `RESEND_MARKETING_ENABLED=false` on this host.
   - `/api/internal/membership/process` — membership workflow processing.
   - `/api/internal/integrations/google-calendar/process` — one Calendar event
     per invocation, with its durable lease preventing duplicate claims.

   Allow sufficient HTTP timeout for each worker. A scheduler timeout is not
   proof that a send failed; worker leases and idempotency remain authoritative.
6. Verify job registration without firing the queues. Then run one explicitly
   approved test-recipient scenario and observe request response, durable queue
   state, provider acceptance, and recipient receipt separately. A 200 response
   with `ready: false` is not a healthy worker.
7. Confirm that no other host is processing these membership queues in a
   different environment. Verify the queue drains after a deliberate temporary
   failure and survives a stopped worker. Keep daily Vercel fallback passes;
   durable claims must make overlapping calls safe.
8. Check volume before expansion. At one Calendar event per five-minute call,
   normal throughput is at most 12 events per hour, not 12 attendees. Increase
   frequency or bounded batch capacity only after measuring provider latency,
   quota, host duration, and database load.

## Recovery boundaries

- A Calendar link with no saved environment must be explicitly verified and
  bound by an administrator before automatic delivery. Never infer its mode
  merely from the host being visited.
- A previous Google creation that may have succeeded is read back by its
  deterministic event ID and reconciled to the current audience and content.
- A support email the provider definitely rejected may be retried. An ambiguous
  send outside the provider idempotency window is held for manual delivery
  review, not automatically resent. Provider acceptance is not inbox receipt.
- Scheduling does not publish an agreement, activate payment, assign a Circle,
  or grant operator access.

## Pause or rollback

Pause only the named membership scheduler jobs. Do not delete queues, reset
attempt histories, rotate secrets, or change public-site jobs to clear a delay.
After a code rollback, keep the additive database migration and recheck worker
compatibility. Review any in-flight provider operation before retrying it.
