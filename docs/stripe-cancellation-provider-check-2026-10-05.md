# Cancellation provider check — October 5, 2026

The disposable provider smoke completed successfully in isolated Ruined sandbox `acct_1U6AS79rQIwIEzKe` using API version `2026-08-26.dahlia`. It exercised the current application cancellation policy, provider reconciliation and cancellation service against real Stripe sandbox subscriptions and invoices. Application persistence was substituted with an in-memory adapter; durable database behavior is covered separately by repository tests.

## Verified

- One paid $349 Founding installment produced the capped $1,500 early-exit quote and one exact hosted invoice.
- Eleven actual sandbox installments produced a $349 remaining-balance quote and one exact hosted invoice, below the cap.
- Both replacement invoices stayed open and unpaid with `auto_advance=false`; no automatic fee collection occurred.
- Provider cancellation was scheduled at the fully paid period end.
- Duplicate confirmations retained the existing invoice and effective date. Stripe may rotate the signed hosted invoice URL between reads; the invoice identity remains stable.
- Test Clock advancement proved the capped subscription did not renew again and the below-cap exit prevented the twelfth ordinary installment.
- The script deleted its Test Clock, customers and associated fixtures on completion. It supplied no customer email addresses, mail credentials or production database connection. No live payment or email was sent.

This check did not submit payment through the Hosted Invoice Page, prove signed webhook delivery, or exercise production write permissions. The fee remains a separate member-initiated hosted payment action. The check does not establish tax treatment; automatic tax was disabled.

## Repeat

Use a private sandbox-only environment file. The script rejects live keys, database/Supabase connections and mail credentials, and verifies the expected account before mutation:

```sh
node --env-file=/absolute/path/to/private-sandbox.env scripts/stripe-cancellation-provider-smoke.mjs
```

The script advances eleven monthly installments and can take several minutes. It prints checks without credentials or customer data and attempts fixture cleanup on success or failure. A cleanup warning requires provider reconciliation.

## Renewal notice checks

The existing renewal policy, queue/database, rendering and worker tests passed: **10 tests**. They cover all six offers, exact invoice previews, 40/20-day timing, cancellation immediately before sending, queue deduplication and leases, stable payload/idempotency keys, the 23-hour uncertain-delivery limit, and authenticated cron error reporting.

No renewal email was sent. Existing production registration emails can establish the shared sender/transport works, but do not establish this renewal worker's actual delivery. The sender remains separately gated by `STRIPE_MEMBERSHIP_RENEWAL_EMAILS_ENABLED`; test mode also requires an explicitly designated test recipient. New November 1 contracts do not become due for these first-year/annual notices during the launch period. The daily renewal cron and any intended sending configuration must be verified in the deployed environment.
