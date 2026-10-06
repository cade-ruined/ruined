# Paid registration release — October 6, 2026

New, non-complimentary registrations complete after the first monthly installment or full annual payment is verified. Profiles remain held for a separate operator release. Existing registrations retain the requirement they originally accepted.

## Member flow

1. Personalized invitation or direct landing-page invitation; confirm the email code.
2. Save the required personal information and registration disclosures.
3. Review and accept the published paid membership agreement. The exact offer loads automatically.
4. Affirm the displayed payment terms; embedded Stripe payment opens automatically. Stripe's payment submission remains explicit.
5. After verified payment, open the registration confirmation automatically and queue one welcome email. No separate save-card screen, offer-loading button, or confirmation handoff is needed.

The exact offer, screen receipt and paid welcome disclose the amount, cohort's four calls, first service date, next charge, 12-month commitment, renewal and cancellation terms. Monthly enrollment pays one installment now and eleven later; annual enrollment pays the year now. Pre-service cancellation receives a full confirmed refund, including tax. Payment does not release the profile.

Couples explicitly approve sharing the bill. Approval can release an unused individual quote; it cannot replace attempted Checkout or settled payment. Complimentary and operator-funded members finish without payment. Ordinary billing visits retain cancellation controls; a successful checkout return can automatically open the receipt even when its webhook arrived first.

Completed paid registrations count toward Founding capacity while awaiting service, with each adult counted once. Their original participant eligibility is retained after a fully confirmed pre-service cancellation and refund, as promised in the agreement. This retained reservation never substitutes for current payment proof. Unresolved adjustments remain pending holds; departure after service begins ends the earlier Founding continuity. Couples retain their purchased couples price, including when their individual Founding eligibility differs at the capacity boundary.

## Release order

1. Apply `20261006220000_registration_initial_payment.sql`, then `20261006223000_registration_paid_capacity.sql`, through the checksum-aware platform migration runner. They add the per-registration requirement, payment evidence, and retained paid-registration pricing decision; existing rows default to the historical save-card behavior. The email worker requires the initial-payment migration. Preserve applied migration checksums.
2. Keep `MEMBERSHIP_REGISTRATION_ONLY_ENABLED=true`. Set `MEMBERSHIP_REGISTRATION_PREPAYMENT_REQUIRED=true` for production only after prepayment, published agreement, account/mode and activation prerequisites are verified.
3. Deploy this code with `STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED=true` and the existing paid activation readiness gates. Missing readiness closes new paid enrollment; it never silently substitutes save-card registration.
4. Verify public paid copy, deployment identity, private status authentication and unchanged historical registration requirements.

Payment requirements are immutable once a registration is created. Do not backfill existing members, replace accepted billing schedules, charge saved cards automatically, or release profiles as part of this deployment. Database migrations alone do not send emails or change subscriptions.

To pause new paid enrollment, disable `STRIPE_MEMBERSHIP_ACTIVATION_ENABLED` and redeploy, keeping the requirement and profile hold in place. Leave webhook processing and cancellation available for existing payments. Do not revert to code that ignores the new payment requirement after required registrations exist.

## Verification

- Offline application harness: full migration chain, actual offer/Checkout/webhook application code, monthly/annual/couple required registrations, one welcome per member, no saved-card account, held profiles, invalid/adjusted proof and replay behavior. Capacity-boundary checks verify the next offer after 50 confirmed people, mixed Founding eligibility for couples, retained eligibility after a settled pre-service refund, and its end after service and departure.
- Routing/UI tests: owner-only status, missing or refunded payment, agreement and payment consent, automatic offer preparation, Stripe-return ordering, ordinary cancellation access, historical and complimentary paths.
- Paid email tests: exact tax-inclusive amounts, current cohort, annual/couple responsibility, legacy approved letters, frozen payload identity and provider retry safety.
- Browser previews: desktop and 390px, paid offer and public registration copy, paid monthly and annual-couple welcome layouts. Preview is inert and does not prove a real OTP-to-payment browser journey.

Release validation: ESLint, TypeScript, all 2,416 tests and the optimized production build passed. The production database update is additive; deployment identity and final public checks are recorded separately. No live card was charged and no test welcome email was sent by these checks. A complete real browser journey through OTP, Stripe card entry and inbox delivery was not repeated during this release.
