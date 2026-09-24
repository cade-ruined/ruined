# Local Stripe sandbox smoke test

This standalone developer harness runs actual Checkout, membership identity checks,
checkout reservations, Stripe signature verification, webhook processing and billing
SQL against an in-memory PGlite database. It never imports an application environment
file or connects to Supabase/Postgres. It adds no authentication bypass to the app.

The only injected boundaries are a synthetic signed-in viewer, connected-mode
readiness, the local database adapter, and disabled communications. The entire shipped
migration list is installed unchanged in PGlite. The synthetic member starts with
pending billing, a verified test email, profile completion, age consent and acceptance
of a clearly marked test-only paid agreement. No paid legal copy is published anywhere.

**This proves the payment/webhook path, not email OTP or the complete signed-in app.**
Test that full journey separately with an isolated Supabase environment before launch.

## Offline verification

Run from this checkout with no database/Supabase or live Stripe credentials loaded:

```sh
node scripts/stripe-sandbox-smoke.mjs --self-test
```

This exercises the real identity/consent guards, durable reservation reuse, signed
webhook deduplication and the host/CSRF boundaries without any Stripe API requests.
It also verifies that unhandled or unsigned events leave billing pending.

## Sandbox configuration

Use **Ruined sandbox `acct_1U6AS79rQIwIEzKe`**, not the live Ruined account. The harness
rejects live server/browser key prefixes and confirms the server key's account before
creating any Checkout Session. The browser key must be from that same sandbox.

Supply these variables through a private, git-ignored sandbox-only environment file
or your terminal's environment. Never paste secret values into chat, source, command
arguments or logs; do not use the app's `.env.local`.

| Variable | Required sandbox value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Sandbox `rk_test_…` or `sk_test_…` server key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Matching sandbox `pk_test_…` browser key |
| `STRIPE_WEBHOOK_SECRET` | Signing secret issued by the sandbox CLI listener |
| `STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID` | `price_1UJKWj9rQIwIEzKeJ9okUjcw` |
| `STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID` | `price_1UJKWo9rQIwIEzKelqeyzSWj` |

A restricted server key needs Account read for the sandbox identity check, Prices
read, Checkout Sessions write/read, Subscriptions read, and Customers read. The CLI
listener has its own sandbox authorization. Do not reuse live credentials for either.

The harness forces `STRIPE_TAX_ENABLED=false`, disables live purchases, fixes the local
return origin and uses its own test agreement version. It refuses `DATABASE_URL` and
Supabase variables. There is no database URL, real user email or SMTP configuration.

## Listener and startup

Authorize a separate Stripe CLI profile for the same Ruined sandbox. Do not use `--live`.
Forward the following snapshot events to
`http://127.0.0.1:3233/api/stripe/webhook`:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
invoice.paid
invoice.payment_failed
invoice.payment_action_required
invoice.voided
invoice.marked_uncollectible
customer.subscription.updated
customer.subscription.deleted
```

The forwarded events must use API version **`2026-08-26.dahlia`**, matching the production
webhook's schema guard. Capture the listener's `whsec_…` into the private sandbox
environment without printing it into a shared transcript. Keep the listener running.

After supplying the variables, start:

```sh
node scripts/stripe-sandbox-smoke.mjs --port 3233
```

If using the prepared private sandbox-only file, the equivalent is:

```sh
node --env-file=.sandbox-state/test.env scripts/stripe-sandbox-smoke.mjs --port 3233
```

Open `http://127.0.0.1:3233`. The server binds only `127.0.0.1`; it has no public host
option. Startup installs the local fixture and makes **no Stripe API calls**. Submitting
the sandbox Checkout form verifies the account and configured price, then calls the
actual application's Checkout route. The server key and webhook secret never enter
the page; the publishable key is intentionally browser-safe.

The single synthetic identity is shared by tabs so real reservation/plan-conflict
behavior is testable. Its generated email uses `example.test` and is not a real member.
Only use Stripe's documented sandbox payment details in the embedded Checkout.

## What to verify

1. Monthly shows $499 USD; annual shows $5,040 USD upfront. The production route must
   validate the Price amount, currency, interval and test mode.
2. Two tabs on the same plan reuse an open attempt. A different plan cannot replace an
   in-flight payment. If a 409 locks the other plan, the selector shows that plan for
   an explicit retry. Changing plans or receiving a plan conflict clears recurring
   consent so the displayed amount must be accepted again.
3. A declined sandbox payment leaves membership pending.
4. A successful sandbox payment returns to the harness. Billing becomes active only
   after the correctly signed `invoice.paid` event confirms the matching full payment.
   The status panel shows the local attempt, invoice, membership and event records.
5. Replay the same real event through the authorized sandbox CLI. The local event is
   deduplicated and membership is not activated twice.
6. Update/cancel only the created **sandbox** subscription and verify signed lifecycle
   events update the local billing state. No real member should be touched.

The communications worker is disabled. SQL-triggered jobs can exist in PGlite but
cannot send emails, create calendar events or access production services. Status output
does not include raw webhook payloads or credentials. Signature/API-version errors are
returned by the unchanged application webhook and never grant access. Stripe's
cross-site return GET is allowed to render the page; cross-site payment POSTs remain
blocked, and the return URL itself never changes billing state.

Stop with Ctrl+C. Local fixture data is erased; Stripe sandbox objects intentionally
remain for inspection. Record the sandbox Session/subscription IDs shown in the status
panel before stopping. Starting again creates a new synthetic identity. To test the
other plan after a completed payment, start a fresh process; it does not clear or cancel
the previous sandbox subscription for you. Do not call this harness from a deployed
route or use it as an authentication shortcut in the application.
