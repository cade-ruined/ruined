# Monthly Foundations cutoff and payment carry-forward

The cutoff is 24 elapsed hours before each group's first Foundations call. Selection checks successive months until it finds an open cutoff, including when a first-of-month call closes in the previous month.

A payment completed on November 4, 2026 at or after 3 PM America/Denver covers the December group starting December 3. Monthly renewal is January 3, 2027; annual renewal is December 3, 2027. There is no second initial payment and no automatic cutoff cancellation or refund. Selection uses the original invoice's verified payment time, not webhook arrival or reconciliation time.

## Paid registration

The original accepted offer, invoice, agreement and payment evidence remain immutable. A separate rollover ledger holds the effective group, service dates and commitment dates. Enrollment remains held until Stripe's same subscription has been verified with the shifted renewal date. Provider calls use an idempotency key and also inspect the subscription before retrying, so recovery after a provider success/database timeout does not extend the dates again.

Stripe emits a zero-dollar `subscription_update` invoice for this extension. It is accepted only when it matches the exact prepaid-period extension, subscription, price and unchanged settled initial payment. It does not count as another payment. Membership activation, member confirmation, emails, cohort email audiences, cancellation dates and renewal notices read the effective schedule after completion.

Rollover runs immediately after the original payment transaction commits, then rechecks the subscription before registration fulfillment. The scheduled worker remains the recovery path. While dates are being confirmed, the member page shows a separate pending state, refreshes automatically and offers no second checkout. The zero-dollar adjustment cannot qualify as a paid renewal once prepaid coverage ends.

Ordinary member-requested cancellation and refunds are unchanged. A missed cutoff itself no longer invokes the refund worker.

## Complimentary registration

Completed complimentary registration fixes a group using the same monthly rule. Existing explicit member-group invitations are preserved. All four matching published calls receive automatic registrations, which queue Google Calendar synchronization. Existing cancellations, waitlists and manual choices remain intact; expired reminders are not replayed.

An administrator may approve an exception with a reason. Changing a complimentary member's Foundations 1 group records an append-only exception and removes only obsolete future automatic invitations. Founders' standing invitations remain unchanged. A paid member's individual call exception does not silently change their billing contract.

## Release prerequisites

1. Apply `20261104190000_paid_foundations_cohort_rollover.sql`, then `20261104190000_complimentary_foundations_cohorts.sql`, using the migration runner. Do not alter previous migrations or agreement records.
2. Publish the exact `docs/membership-paid-agreement-v4.md` with the existing agreement publication workflow, preserving the predecessor's signed content and receipts.
3. Configure `STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION=ruined_membership-v4` for the new deployment. Earlier versions explicitly promise a refund for missed cutoffs; late payments under those old terms are held for review, not automatically reassigned, cancelled or refunded. The release checker rejects a carry-forward release using those old terms.
4. Deploy the corresponding application code and verify the prepaid, registration-email, cadence and Google Calendar workers are healthy. No new email permission or SMS consent is manufactured by these changes.
5. Confirm future groups' actual calls are published and bound to the matching group. Enrollment cannot invent unpublished calls or Google Meet links.

## Verification

The disposable `scripts/stripe-cohort-rollover-smoke.mjs` runs the shipped provider implementation using isolated sandbox credentials only, with database and email credentials excluded. Monthly and annual tests confirmed the original payment is retained, service and renewal dates move to December, repeated reconciliation preserves the same payment and adjustment, and advancing to the new service start creates no additional charge. Test-clock customers and their subscriptions are deleted afterward.

Local tests cover exact cutoffs, month/year boundaries, delayed confirmations, original consent immutability, pending/provider-failure holds, completed-rollover activation, email audiences and complimentary enrollment/administrator exceptions. Production release and live member changes are separate from these tests.
