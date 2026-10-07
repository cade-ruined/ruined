# Local Stripe sandbox smoke test

This standalone developer harness runs actual Checkout, membership identity checks,
checkout reservations, Stripe signature verification, webhook processing and billing
SQL against an in-memory PGlite database. It never imports an application environment
file or connects to Supabase/Postgres. It adds no authentication bypass to the app.

The only injected boundaries are a synthetic signed-in viewer, connected-mode
readiness, the local database adapter, and disabled communications. A loader-scoped
invalid database marker satisfies presence checks, but the actual process rejects a
database URL and importing the PostgreSQL driver is forbidden. The entire shipped
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

This exercises the real commercial-offer and Checkout routes, immutable first-charge
consent, durable reservation reuse, signed webhook deduplication and host/CSRF boundaries
without Stripe API requests. A subscription event before Checkout completion leaves
billing pending. Completion creates the future-start commitment and reserves the
commercial offer without an invoice or access. A later full paid invoice runs the real
billing/onboarding transactions and database triggers. A separate scenario verifies
fee-free cancellation before the first payment, release of the reservation and a late
Checkout completion that cannot reopen it. Provider responses are synthetic in this
offline test; no external payment is made.

Use the new prepaid scenario separately:

```sh
node scripts/stripe-sandbox-smoke.mjs --self-test --prepaid
```

It creates a synthetic v3 acceptance and tests both monthly and annual cohort
quotes. Missing or altered schedule consent cannot create a session. The exact
Checkout input has one recurring price plus a one-time charge for the first period;
recurring collection starts at the accepted prepaid-through date. The test resumes
the same session, then replays signed synthetic subscription, Checkout and paid
invoice events through the real application projection. It checks the durable
payment proof and confirms that service remains pending before the cohort starts.
Unmocked provider requests are blocked locally. This is not evidence of actual
Stripe collection, future service activation or a real refund.

To exercise the current automatic payment-form flow, run:

```sh
node scripts/stripe-sandbox-smoke.mjs --self-test --prepaid --native-consent
```

This adds pending native Stripe consent: opening the form stores no payment
approval. Only a retrieved completed session with accepted Stripe terms can record
the immutable consent receipt. The fixture rejects missing consent and mismatched
member, agreement, amount, currency, customer, subscription and line items. It also
checks invoice-first delivery with a newer event timestamp than the later-arriving
Checkout completion, session-binding races and duplicate events. The option is
restricted to offline self-tests; the legacy test above continues to cover existing
browser-approved attempts.

The fixture provides a named Person profile before setting profile completion, and
sets the agreement checkpoint from the saved acceptance timestamp in PostgreSQL.
These prerequisites matter: setting a checkpoint before acceptance or leaving the
profile unnamed causes the real onboarding trigger to reject the paid-invoice
transaction. The harness does not weaken those production guards.

## Sandbox configuration

Use **Ruined sandbox `acct_1U6AS79rQIwIEzKe`**, not the live Ruined account. The harness
rejects live server/browser key prefixes and confirms the server key's account before
creating any Checkout Session or replaying a provider snapshot. The browser key must be from that same sandbox.

Supply these variables through a private, git-ignored sandbox-only environment file
or your terminal's environment. Never paste secret values into chat, source, command
arguments or logs; do not use the app's `.env.local`.

| Variable | Required sandbox value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Sandbox `rk_test_…` or `sk_test_…` server key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Matching sandbox `pk_test_…` browser key |
| `STRIPE_WEBHOOK_SECRET` | Sandbox-only signing secret (matching the listener when forwarding real events) |
| `STRIPE_MEMBERSHIP_FIRST_CHARGE_AT` | Optional future UTC date; `--deferred` defaults to `2026-11-01T06:00:00Z` |
| `STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID` | `price_1UJKWj9rQIwIEzKeJ9okUjcw` |
| `STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID` | `price_1UJKWo9rQIwIEzKelqeyzSWj` |

A restricted server key needs Account read for the sandbox identity check, Prices
read, Checkout Sessions write/read, Subscriptions read/write for test cancellation,
Customers read, Invoices read, pending Invoice Items read and Events read for original
event replay. The CLI
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

After supplying the variables, start the historical deferred scenario:

```sh
node scripts/stripe-sandbox-smoke.mjs --deferred --port 3233
```

If using the prepared private sandbox-only file, the equivalent is:

```sh
node --env-file=.sandbox-state/test.env scripts/stripe-sandbox-smoke.mjs --deferred --port 3233
```

For a new prepaid cohort scenario, use `--prepaid` instead of `--deferred`:

```sh
node scripts/stripe-sandbox-smoke.mjs --prepaid --port 3233
```

These modes are mutually exclusive. Prepaid mode forces the cohort flag on, selects
the synthetic v3 agreement and clears a deferred first-charge date. The browser
shows and echoes the complete server-issued schedule. Its cancellation confirmation
shows the exact refund amount when the quote includes one. The harness publishes
no agreement and enables no production flag. To exercise provider-backed prepaid
verification and refunds, the sandbox key also needs Invoice Payments, Payment
Intents, Charges, Credit Notes and Refunds read access, plus Refunds write for an
explicit cancellation action.

Open `http://127.0.0.1:3233`. The server binds only `127.0.0.1`; it has no public host
option. Startup installs the local fixture and makes **no Stripe API calls**. Reviewing the offer verifies the account and calls the actual offer route. Confirming
the displayed amount and first-charge date then calls the actual Checkout route. The server key and webhook secret never enter
the page; the publishable key is intentionally browser-safe.

The single synthetic identity is shared by tabs so real reservation/plan-conflict
behavior is testable. Its generated email uses `example.test` and is not a real member.
Only use Stripe's documented sandbox payment details in the embedded Checkout.

## What to verify

1. The empty isolated database gives the synthetic member the founding offer: $349
   monthly or $3,490 annually. In deferred mode Checkout shows $0 today and the exact
   first full-payment date. The production route validates amount, currency, interval
   and test mode against the server-issued offer. Without a future configured date,
   normal immediate billing applies. In prepaid mode, Checkout instead collects the first monthly installment or full annual amount now, while service begins on the displayed first Foundations call.
2. Two tabs on the same plan reuse an open attempt. A different plan cannot replace an
   in-flight payment. If a 409 locks the other plan, the selector shows that plan for
   an explicit retry. Changing plans or receiving a plan conflict clears recurring
   consent so the displayed amount must be accepted again.
3. Deferred Checkout completion returns to the harness with billing pending, no
   invoices, a reserved commercial offer and a commitment beginning on the first-charge
   date. A declined immediate payment also leaves membership pending.
4. Billing becomes active only after the correctly signed `invoice.paid` event confirms
   the matching full payment. The status panel shows attempts, reservations, commitments,
   invoices and event records.
5. Replay the same real event through the authorized sandbox CLI. The local event is
   deduplicated and membership is not activated twice.
6. Use the prestart cancellation button to exercise the real quote/confirm routes.
   Verify no fee, no invoice, a canceled sandbox subscription and—after the signed
   canceled subscription event—a released reservation with billing still pending.
   No real member should be touched. For prepaid membership, verify the full initial-payment refund and its confirmed status; a canceled subscription alone does not prove refund completion.

The **Verify signed Stripe events** button replays original matching sandbox Events
using a local signature and preserves their API version. If the sandbox account's
Event default is older than the app's pinned version, the unchanged app rejects it.
The separate **Verify current Stripe snapshots** button retrieves current provider
objects through the pinned API and sends explicitly named `evt_local_snapshot_*`
local events. Its result identifies this provenance; it proves application projection
of real provider objects, not delivery of an original provider webhook. Use a correctly
versioned real endpoint/listener to verify provider delivery separately.

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
