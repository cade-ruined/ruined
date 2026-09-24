# Ruined Stripe integration

Stripe is the billing system of record for membership and consulting invoices. Shopify remains the system of record for retail products and physical-goods checkout.

## Accepted implementation shape

- Responsive web flow at `/my`.
- Stripe Embedded Checkout inside the branded membership entry page for one membership with monthly and annual recurring Prices.
- Charge upfront; no free trial, usage, seats, tiers, or volume pricing.
- Dashboard-managed dynamic payment methods.
- Stripe Customer Portal for member billing self-service after verified app authentication.
- Smart Retries and Stripe dunning emails.
- Stripe Tax through `automatic_tax`, enabled only after registrations and product tax treatment are confirmed.
- Low-volume, unique consulting invoices created manually in Stripe Dashboard and paid through the Hosted Invoice Page.
- Verified webhooks—not the Checkout success redirect—control billing state.

## Local configuration

Never paste Stripe secrets into chat, source control, client code, or a `NEXT_PUBLIC_` variable. Stripe's `pk_test_…` / `pk_live_…` publishable key is the sole browser-safe Stripe credential.

1. Copy `.env.example` to `.env.local`.
2. Add the matching test-mode `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
3. Add a test-mode `STRIPE_SECRET_KEY` (prefer a restricted key with only the permissions this integration needs).
4. Configure separate sandbox Prices: `STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID` ($499 USD every month) and `STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID` ($5,040 USD every year, paid upfront).
5. Add `DATABASE_URL`, then run `npm run db:migrate:platform`.
6. Publish the approved paid legal copy as the current `ruined_membership` row in `membership_agreement_versions` and set `STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION` to that exact version, for example `ruined_membership-v2`. No agreement text is seeded or inferred. Existing no-charge pilot agreements do not authorize payment.
7. Use the Stripe CLI or a Dashboard test webhook destination to obtain the matching `STRIPE_WEBHOOK_SECRET`.
8. Keep `STRIPE_TAX_ENABLED=false` until Stripe Tax is operationally ready and `STRIPE_MEMBERSHIP_LIVE_ENABLED=false` until the sandbox purchase/webhook checks pass and launch policies are approved.
9. Run `node --env-file=.env.local scripts/check-stripe-membership.mjs`. It reads Stripe configuration and reports readiness; it never creates products, changes billing settings or prints credentials.

Checkout readiness requires matching publishable/server key modes, both Prices, a signed webhook destination, and the approved paid agreement version. Live keys alone cannot enable purchases: the explicit live switch is also required. Existing billing management and signed webhook reconciliation remain available while new purchases are gated.

The publishable key initializes Stripe.js in the browser. Before Checkout opens,
the server verifies a durable acceptance of the exact published agreement and
its linked age attestation. The browser sends the acceptance ID, a single-attempt ID, `monthly` or `annual`,
and an explicit `recurringPaymentAccepted: true`; it cannot assert that agreement or age requirements were
met. The server still owns the member, email, Price, quantity, and creation of
each embedded Checkout Session. Only the Session client secret and actual reserved billing plan cross the
application boundary, in a non-cacheable response; it is never put in a URL or
log.

Before calling Stripe, the server reserves one open Checkout attempt per member
in Postgres. Reloads and parallel tabs reuse that reservation and Stripe
idempotency key instead of creating a second subscription. The attempt stores the
selected plan, fixed Price, exact recurring amount/currency/interval, verified
consenting account and timestamp. A different plan in another tab receives a
409 with the locked plan and must explicitly resume it. An expired remote
Session can be replaced; a network timeout or local expiry alone cannot justify
creating a new payment. An unresolved create older than 23 hours needs operator
reconciliation, because Stripe idempotency records are not retained indefinitely.

## Stripe Dashboard setup

### Product and recurring Price

Create one membership Product with two distinct, active recurring USD Prices:

- Monthly: 49,900 cents, `interval=month`, `interval_count=1`.
- Annual: 504,000 cents, `interval=year`, `interval_count=1`.

Both are licensed, per-unit, quantity-one subscriptions with flexible billing,
no trial and the first payment due at signup. The server retrieves the selected
Price and rejects the wrong amount, currency, interval, quantity transform,
pricing model, inactive status or environment. The browser cannot provide a
Price ID or amount. Decide Product tax code, inclusive/exclusive treatment,
and cancellation/refund rules before live release.

`STRIPE_MEMBERSHIP_PRICE_ID` remains optional for recognizing previously sold
legacy subscriptions during webhook reconciliation. It is never a fallback
for a new purchase. Keep it configured until those subscriptions have ended.

### Tax

Before enabling automatic tax:

- Confirm Ruined's business origin address.
- Add each required Stripe Tax registration.
- Confirm the membership Product tax code with the appropriate advisor.
- Confirm the recurring Price tax behavior.
- Test collecting and non-collecting US addresses in Stripe test mode.

The authenticated purchase flow derives the member and email from the verified
Supabase identity. It never accepts an email, Customer, Price, quantity, or
entitlement field from the browser. A first purchase creates a fresh Stripe
Customer; later billing access uses only the Customer linked to the canonical
member record. Checkout stores the collected billing address on that Customer,
and webhook reconciliation promotes it as the member's primary billing
identity. Reconciliation also records and flags any
`automatic_tax.disabled_reason` instead of allowing tax calculation to fail
silently.

Only then set `STRIPE_TAX_ENABLED=true` in that environment.

### Customer Portal

Configure the Portal for payment-method updates and cancellation. Leave plan changes disabled until a separately reviewed plan-switching flow handles proration and consent. The authenticated `/api/stripe/portal` route derives both the member and Stripe Customer from the server-side identity and stored member record; it accepts neither value from the browser. Optional `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` pins the reviewed configuration; otherwise Stripe uses the default configuration.

### Invoicing

Create consulting invoices manually in Dashboard, apply Ruined branding, and use the Hosted Invoice Page. Add `ruined_context=consulting` metadata when an invoice should appear in the app/CRM reconciliation stream. Manual invoices never activate membership.

## Webhook destination

Register `/api/stripe/webhook` for only these events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `invoice.voided`
- `invoice.marked_uncollectible`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Create the webhook destination with API version `2026-08-26.dahlia`. The
handler rejects a different snapshot shape or live/test mode instead of silently
misreading the membership subscription on `invoice.paid`. Existing endpoints on
the prior API version require a coordinated endpoint/version cutover; this
change does not silently accept older event schemas.

The endpoint verifies the raw body signature, claims each event ID in Postgres, ignores processed duplicates, and prevents older events from overwriting newer member state. It activates a member only from a fully paid invoice whose actual line matches the expected recurring Price, subscription item, quantity and currency. New-plan invoices must also match the durable Checkout plan and consent. A zero, partial, unrelated, prorated or mismatched invoice cannot activate access. A manual or mismatched invoice is recorded but cannot grant membership.

## Remaining production gates

- Approve renewal failure, cancellation, refund, grace-period, and chargeback access rules.
- Approve the age and consent policy. The current attestation is configurable and defaults to 18+, but that default is not legal approval.
- Supply test Stripe secrets and a durable Postgres connection outside source control.
- Confirm tax treatment; configure and test Stripe Tax registrations before enabling automatic tax.
- Apply and exercise the platform migration against a real Supabase/Postgres environment before enabling Checkout or the Customer Portal.
- Configure Supabase production SMTP and the six-digit OTP email template.
- Test authenticated member and operator authorization, including assignment boundaries, before production access.

## Local regression coverage

`tests/stripe-checkout-plans-runtime.test.mjs` exercises both Prices, mode and
amount rejection, same-attempt retries, plan locking, completed/expired
Sessions, zero/short/mismatched invoices, consent binding and legacy plans.
`tests/stripe-checkout-reservation-database.test.mjs` runs the complete shipped
schema in isolated PostgreSQL (PGlite), including parallel reservations and
stored recurring consent. These checks make no provider charges and do not
replace a successful sandbox Checkout, renewal, failure and cancellation run.
