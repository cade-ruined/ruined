# Foundations cohort prepayment — release preparation

Status: local preparation; this document does not assert live configuration, agreement publication, migration application or deployment.

## Accepted behavior

New paid members explicitly review an offer and authorize payment. Registration, a saved card, or agreement acceptance alone never enrolls or charges someone. The first monthly installment or full annual price is paid at Checkout. Coverage and the initial 12-month commitment begin at the first Foundations call. The next charge is one calendar month after service starts for monthly billing, or one calendar year after service starts for annual billing. The monthly option has one payment at Checkout and 11 further installments in its initial commitment.

Foundations normally meets on the first four Thursdays of each month at 3 p.m. America/Denver, with the holiday exceptions disclosed in each offer. The first eligible cohort is November 2026: November 5, 12, 19 and Monday, November 30. December 2026 meets December 3, 10, 17 and Wednesday, December 30, skipping Christmas Eve and New Year’s Eve. The first-call cutoff and billing dates are unchanged by these final-call moves. The cutoff is exactly 24 elapsed hours before the first call. At or after the cutoff a new offer selects the following month; the member must review and authorize that offer. Calls retain their Denver hour across daylight saving changes. Billing anniversaries preserve the service start's UTC hour, matching the existing commitment ledger.

A paid member may cancel before service starts for a full refund of the initial payment, including tax, without an early-exit fee. Refund confirmation is distinct from a pending refund. Registration and any founding eligibility reserved at registration remain saved. A new checkout requires fresh consent. Profile release remains a separate operator-controlled step.

Previously accepted November 1 schedules retain their original dates and payment authorization. They are not silently converted into cohort prepayments.

## Snapshots and member review

`foundations-prepaid-v1` identifies the schedule independently of `membership-billing-v2`. A schedule stores the cohort month, America/Denver timezone, four call instants, cutoff, service start, prepaid-through date, next charge and initial commitment end. The browser-safe helper recomputes every field to validate a snapshot. Historical accepted snapshots remain valid after their cutoff.

The quoted schedule is shown with the exact selected price, payment due today, tax treatment, term and refund conditions. An unchecked authorization covers payment now, the later installments or renewal, and the accepted dates. Checkout receives the complete schedule echo for server comparison. The browser removes expired embedded Checkout; server and provider reconciliation remain authoritative for cutoff races.

The activation page reads persisted billing evidence. A return URL alone never means paid. A scheduled prepaid receipt requires confirmed payment; pending payment and pending refund remain explicit. Only a completed pre-service cancellation and confirmed refund enable review of a new membership. The paid receipt and cancellation controls are available while the profile remains held.

## Agreement artifacts

| Agreement | Source | State |
| --- | --- | --- |
| `ruined_membership-v2` | [Existing paid agreement](membership-paid-agreement-v2.md) | Preserved, including accepted November 1 schedules |
| `ruined_membership-v3` | [Prepaid cohort agreement draft](membership-paid-agreement-v3.md) | Local draft; publication and final content hash require release verification |

The v3 draft changes the payment and service timing, cohort rule, pre-service full refund, preserved registration eligibility and historical-schedule distinction. Unrelated agreement terms and the six reviewed price amounts remain unchanged.

## Verification and release checklist

- Pure schedule tests cover minimum cohort, exact cutoff equality, year rollover, first four Thursdays with the explicit November/December 2026 holiday exceptions, spring/fall daylight saving changes, strict tampering rejection, and anniversary parity across 2026–2032.
- UI tests cover fresh unchecked payment authorization, full snapshot echo, cutoff blocking, legacy scheduled billing, pending payment, refund quote and confirmation, pending refund retry using the same quote, and review-again gating after confirmed refund.
- Complete backend tests for immutable quote storage, provider initial-payment proof, schedule creation, webhook replay and ordering, paid-period reconciliation, full refunds and cutoff race refunds.
- Confirm monthly and annual provider behavior in sandbox with initial positive payment, future service start and no duplicate first-period charge.
- Complete desktop/mobile visual review, type check, lint, full test suite and production build.
- Review the exact v3 source and hash before publishing. Preserve v2 acceptance records.
- Apply additive migrations and verify configuration prerequisites before enabling the new cohort flag. Existing November 1 subscriptions must retain their original accepted behavior.
- Verify production deployment and post-release read-only readiness separately. No test member, invoice or payment evidence belongs in this public repository document.

Root release owner records the final checks, sandbox evidence location, agreement publication, migration, deployment and enablement results here after they occur.

## Release verification recorded October 5

- Stripe sandbox Test Clocks passed 11 provider checks for monthly and annual prepayment, no second charge at service start, the accepted next billing anniversary, retained first-period coverage, idempotent full prestart refund and refusal to activate refunded money. Disposable provider fixtures were removed.
- The isolated application harness passed both legacy deferred and prepaid modes with full migrations, signed local webhook snapshots, immutable consent, out-of-order/replayed events and a pending service state after upfront payment. These locally signed snapshots are not original Stripe delivery.
- Desktop and 390px mobile signup review showed the holiday dates and payment disclosures without horizontal overflow. Embedded Stripe Checkout was created and its amount/date disclosure inspected. Stripe labels the deferred recurring interval as a trial and shows “Pay and start trial”; the adjacent disclosure states the first period is paid today. Browser security-policy verification became unavailable at card entry, so a completed browser payment is not claimed. The unfinished test session was expired.
- Production publication, migration and enablement are still pending; no member has been enrolled or charged by these checks.
