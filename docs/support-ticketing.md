# Member support

Members open **Support** to choose a help topic, send a question, and follow the conversation. Operators with administrator access use **Operations → Support** to read requests, reply, and update their status. Support is available to an authenticated account even if membership payment needs attention.

Topics cover account/sign-in, membership/billing, Circle placement, Foundations, Academy, events, artifacts/orders, and anything else. Never ask members to send a password, login code, full payment-card number, or other unnecessary sensitive information.

## The operator routine

1. Open the support queue and check new or reopened requests.
2. Choose a request and read the existing conversation before replying.
3. Mark it **In progress** while you work. Use **Waiting for member** when you need an answer. Mark it **Resolved** when the question is handled.
4. Reply in the ticket so the member has one complete record. A member’s follow-up returns the conversation to the active queue.

The queue is restricted to active administrators. Being a Shaper or having Circle access does not grant access to everyone’s private support questions. Members can read only their own requests.

## What email does—and does not do

Once enabled, a new request alerts **connect@theruinedproject.com** and sends the member a receipt. Member follow-ups notify connect@. Operator replies notify the member at their current verified account email, provided it still matches the request’s original verified email.

Email contains a request number and a link—not the member’s question, profile details, or operator reply. The link still requires sign-in and the correct permissions. When signed out, the shared login returns the person to that support request after their account is verified; it does not grant access to someone else’s request or to the operator queue.

**Email replies are not synchronized into tickets.** Both parties should select **Reply in Ruined**. If someone replies directly to connect@, that message remains in the mailbox and must be handled there or copied into the appropriate ticket by an authorized operator. Google Chat is not part of the ticket thread.

If someone cannot sign in, use **connect@theruinedproject.com** directly. This first version is an authenticated support portal, not an anonymous submission form.

## Activation checklist

This implementation is not proof that the live database, email service, or deployment has been activated. The new migration must be applied through the existing platform migration runner before database-backed tickets work:

- `db/migrations/20260903183622_support_ticketing.sql`
- Apply only to the intended environment after reviewing the migration. Do not modify an already-applied migration.
- Verify private support tables have RLS enabled and no direct `anon` or `authenticated` grants.
- Confirm the shared site URL is the environment where recipients should sign in.

Support email is **off by default**. The server requires all of:

- `SUPPORT_EMAIL_ENABLED=true`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` using an approved, verified sender
- `NEXT_PUBLIC_SITE_URL` set to the site’s HTTPS origin, without credentials, path, query, or fragment. HTTP loopback is accepted only outside production.

Support email is transactional and does not depend on marketing topics or `RESEND_MARKETING_ENABLED`. While disabled or incompletely configured, delivery records remain queued without consuming retries. No configuration values or message bodies are included in worker status/error responses.

The existing protected `/api/internal/communications/process` endpoint processes both the marketing queue and the separate support queue. It requires the configured `CRON_SECRET` bearer credential. A failure or missing marketing configuration does not prevent a ready support worker from running.

**Scheduling matters:** the current shared scheduled job runs once daily. Immediate processing after a ticket action handles ordinary notifications, but retrying a failed send requires another worker run within 23 hours. Before live rollout, confirm a suitable retry schedule or arrange a manual protected worker run after delivery errors. Do not assume the daily schedule provides timely support email retries. Any hosting-plan or schedule change requires its own review.

## Delivery safety and recovery

- Each ticket message has at most one delivery per audience. The worker uses a stable provider idempotency key and a five-minute lease to avoid duplicate sends during overlapping runs.
- Transient failures retry with increasing delay, up to five provider attempts. Old uncertain deliveries stop automatic sending after 23 hours from their first attempt, before Resend’s 24-hour idempotency retention expires.
- Invalid/stale recipients, permanent provider failures, and exhausted retries become **dead-letter** records for manual review. Their ticket remains saved and usable in the app.
- The protected worker reports counts for sent, failed, deferred, and dead-letter deliveries. `sent` means the provider accepted the email, not that it reached an inbox; this feature does not currently synchronize bounce or inbound-email webhooks.
- An administrator/developer should check the provider delivery record before taking any action on a dead letter. Do not reset attempts or reuse a completed delivery with a new key without verifying whether it was already sent. There is no operator-facing resend button in this version.

Before turning on production delivery, use an approved test account to verify: create → receipt + connect@ alert → operator reply → member notification → follow-up → resolve. Also test an account with billing attention required, unauthorized cross-member access, and a simulated delivery failure. Do not send test messages to real members without approval.
