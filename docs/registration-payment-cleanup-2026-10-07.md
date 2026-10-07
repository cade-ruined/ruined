# Registration and payment cleanup — October 7, 2026

Older registrations with complete information can go directly to paid checkout while payments are available. They no longer have to save a card separately before choosing to pay. New paid registrations keep the same direct checkout path. Exact pricing and explicit acceptance of the membership and payment terms remain required.

Verified prepaid payment now appears as **Payment received** for both new registrations and historical save-card registrations. Operator registration filters separate information needed, payment needed, paid, complimentary, and cases needing review. The profile-access filter says **Awaiting profile access** rather than implying that every registration is ready to open.

## Preserved behavior

- Historical registration requirements and completed registration records remain unchanged. This is a voluntary route to payment, not a backfill or automatic charge.
- A saved card alone does not count as payment. Unresolved billing arrangements or payment evidence stay in review rather than prompting duplicate payment.
- Paid evidence remains tied to the correct person, account, mode, reservation, accepted consent, invoice, subscription and schedule. Refunds and adjustments invalidate proof as before.
- Profile access requires a separate operator release. Complimentary members do not pay; couples retain their shared billing and per-adult eligibility checks.
- Welcome-message identity and delivery history are preserved. A later profile-ready email accurately acknowledges a historical save-card member's subsequently verified payment. This release sends no emails itself.
- Existing card management and returns from already-open card-saving sessions remain supported. Historical card-saving registration remains available when paid checkout is closed.

## Release order

1. Apply `20261007110000_member_payment_evidence.sql`, then `20261007111000_legacy_registration_checkout.sql` through the checksum-aware migration runner before deploying the application.
2. Keep the existing production payment and registration-only flags. No new environment variables are required.
3. Deploy and verify the exact production commit, operator filters, and complimentary checkout copy.

Both migrations replace private helpers and guards without modifying member rows, subscriptions, messages or profile-access records. Applied migration checksums must remain intact.

## Validation

- ESLint, TypeScript, 2,478 tests and the optimized production build passed.
- The offline native-consent/prepaid harness passed against the complete migration chain: new and historical monthly, annual and couple registration; signed webhook settlement; one welcome per adult; held profiles; Founding capacity and pricing; invalid proof; refunds, adjustments and replay.
- Browser checks passed at desktop and 390px: operator payment filters, saved-card versus complimentary status, and the paid member offer with its amount, service start, next charge and terms. No horizontal overflow at 390px.
- The browser preview was inert. A real Stripe payment and inbox delivery were not repeated during this cleanup; no live card was charged by validation.
