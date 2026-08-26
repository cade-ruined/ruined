# Ruined Stripe integration

Stripe is the billing system of record for membership and consulting invoices. Shopify remains the system of record for retail products and physical-goods checkout.

## Accepted implementation shape

- Responsive web flow at `/my`.
- Stripe Embedded Checkout inside the branded membership entry page for one flat recurring membership Price.
- Charge upfront; no free trial, usage, seats, tiers, or volume pricing.
- Dashboard-managed dynamic payment methods.
- Stripe Customer Portal for member billing self-service after app authentication exists.
- Smart Retries and Stripe dunning emails.
- Stripe Tax through `automatic_tax`, enabled only after registrations and product tax treatment are confirmed.
- Low-volume, unique consulting invoices created manually in Stripe Dashboard and paid through the Hosted Invoice Page.
- Verified webhooks—not the Checkout success redirect—control billing state.

## Local configuration

Never paste Stripe secrets into chat, source control, client code, or a `NEXT_PUBLIC_` variable. Stripe's `pk_test_…` / `pk_live_…` publishable key is the sole browser-safe Stripe credential.

1. Copy `.env.example` to `.env.local`.
2. Add the matching test-mode `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
3. Add a test-mode `STRIPE_SECRET_KEY` (prefer a restricted key with only the permissions this integration needs).
4. Add the recurring test Price as `STRIPE_MEMBERSHIP_PRICE_ID` after price and cadence are approved.
5. Set a real `STRIPE_MEMBERSHIP_AGREEMENT_VERSION`.
6. Add `DATABASE_URL`, then run `npm run db:migrate:platform`. This applies the billing migration first and the platform migration second.
7. Use the Stripe CLI or a Dashboard test webhook destination to obtain the matching `STRIPE_WEBHOOK_SECRET`.
8. Keep `STRIPE_TAX_ENABLED=false` until Stripe Tax is operationally ready.

The publishable key initializes Stripe.js in the browser. The server still owns the member, email, Price, quantity, consent evidence, and creation of each embedded Checkout Session. Only the Session client secret crosses the application boundary, in a non-cacheable response; it is never put in a URL or log.

Before calling Stripe, the server reserves one open Checkout attempt per member
in Postgres. Reloads and parallel tabs reuse that reservation and Stripe
idempotency key instead of creating a second subscription.

## Stripe Dashboard setup

### Product and recurring Price

Create one membership Product and one recurring Price after Ruined approves:

- Amount and currency.
- Monthly or annual cadence.
- Product tax code and inclusive/exclusive tax behavior.
- Cancellation, refund, failed-renewal grace, and chargeback policy.

Put the resulting `price_…` identifier in `STRIPE_MEMBERSHIP_PRICE_ID`. Never allow the browser to choose a Price ID or amount.

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

Configure the Portal for payment-method updates and cancellation. Leave plan changes disabled while Ruined has one plan. The authenticated `/api/stripe/portal` route derives both the member and Stripe Customer from the server-side identity and stored member record; it accepts neither value from the browser.

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

Create the webhook destination with API version `2026-07-29.dahlia`. The
handler rejects a different snapshot shape instead of silently missing the
membership subscription on `invoice.paid`.

The endpoint verifies the raw body signature, claims each event ID in Postgres, ignores processed duplicates, and prevents older events from overwriting newer member state. It activates a member only from a paid invoice tied to the expected membership Price. A manual or mismatched invoice is recorded but cannot grant membership.

## Remaining production gates

- Approve membership price and cadence.
- Approve renewal failure, cancellation, refund, grace-period, and chargeback access rules.
- Approve the age and consent policy. The current attestation is configurable and defaults to 16+, but that default is not legal approval.
- Supply test Stripe secrets and a durable Postgres connection outside source control.
- Configure and test Stripe Tax registration and product tax treatment.
- Apply and exercise the platform migration against a real Supabase/Postgres environment before enabling Checkout or the Customer Portal.
- Configure Supabase production SMTP and the six-digit OTP email template.
- Test authenticated member and operator authorization, including assignment boundaries, before production access.
