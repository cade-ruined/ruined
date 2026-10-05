# November 1 membership activation

Prepared October 5, 2026. This is the implementation and verification runbook, not evidence that production is enabled or any member has confirmed billing.

The [October 5 cancellation provider check](stripe-cancellation-provider-check-2026-10-05.md) records the successful sandbox capped-fee, remaining-balance, duplicate-confirmation and stopped-renewal results, plus the limits of that verification.

Members confirm their paid membership ahead of time. Checkout shows $0 due today and a first payment on **November 1, 2026 at midnight America/Denver** (`2026-11-01T06:00:00Z`). The initial 12-month term starts then. Annual members authorize the full annual amount; monthly members authorize their accepted installment amount. Stripe handles collection from the accepted subscription. Merely saving a card or registering does not create a subscription or authorize a charge.

## Separate release settings

The intended production state for this release is:

| Setting | Intended value | Effect |
| --- | --- | --- |
| `MEMBERSHIP_REGISTRATION_ONLY_ENABLED` | `true` | Preserves registration intake and existing profile holds; closes ordinary paid signup. |
| `STRIPE_MEMBERSHIP_ACTIVATION_ENABLED` | `true` | Opens explicit paid confirmation for completed registrants at `/my/activate`. |
| `STRIPE_MEMBERSHIP_FIRST_CHARGE_AT` | `2026-11-01T06:00:00Z` | Proposes the date for newly issued prelaunch offers. |
| `STRIPE_MEMBERSHIP_COMMERCIAL_READY` | `true` | Releases the verified commercial offer implementation. |
| `STRIPE_MEMBERSHIP_LIVE_ENABLED` | `true` with live credentials | Permits live subscription authorization. |
| `STRIPE_MEMBERSHIP_BUYOUT_READY` | `true` | Enables the tested replacement-fee cancellation flow after membership starts. |
| `STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION` | Exact published paid version | Requires fresh member acceptance of the paid agreement. |
| Both billing portal IDs | Verified environment-specific configurations | Keeps v2 cancellation in the member account. |
| `STRIPE_TAX_ENABLED` | `false` unless separately enabled | Stripe Tax is optional. Its registration and fee-classification checks apply only when enabled. |

Matching server/browser Stripe modes, webhook signing secret, all six prices, database and Supabase configuration are also required. The registration terms remain separate from the paid agreement. Existing profile release, Foundations and public registration settings are not billing authorization.

## Verify and release

1. Apply the additive migrations with the checked-in platform runner, including `20261005190000_membership_first_charge.sql`. Publish the reviewed paid agreement as a new version and confirm its public page. Historical acceptances must remain unchanged.
2. Run the deferred Checkout/provider verification in an isolated Stripe sandbox. Verify $0 initial amount, exact future anchor, no proration, saved payment method, cancellation without an invoice, actual first payment and signed-webhook handling. Use no real payer charge as a test without that payer's explicit authorization.
3. Exercise the registered-member browser flow: paid-agreement acceptance, displayed amount/date, separate recurring consent, Checkout, persisted scheduled confirmation and two-step $0 cancellation. A return query alone must not show success. Verify ordinary paid signup stays closed and profile holds remain intact.
4. With production settings supplied securely, run the read-only activation check:

   ```sh
   node --experimental-strip-types --env-file=.env.local scripts/check-stripe-membership.mjs --activation
   ```

   The check requires the exact November 1 instant, an open prelaunch confirmation window, registration-only intake, activation/commercial/live/fee gates, paid version, correct prices, webhook and portals. A closed gate intentionally reports `ready: false`. It never changes Stripe or application state.
5. Verify the deployed revision and migration checksums, then apply the reviewed production settings and verify the public/member routes. Only members who complete the new consent and Checkout are scheduled for billing. No migration should bulk-enroll saved-card registrants.

The script checks configuration and provider readbacks. It does not prove deployed code, published agreement content, create/cancel permissions, successful collection, signed delivery or real browser behavior. Record those separately. Do not label a source test or simulated webhook as a real successful charge.

## Cancellation, retries and launch timing

The accepted first-charge date is stored in the commercial offer, Checkout attempt and recurring consent. Later configuration changes do not move it. A future commitment exists after verified $0 Checkout so members can cancel before any payment; paid billing/access is not inferred from the provider's `active` status or the calendar alone.

Prestart cancellation shows a $0 quote, requires explicit confirmation, cancels without proration or a final invoice, and verifies the canceled provider object and absence of invoices/items. Ambiguous invoice history and requests within the final ten seconds require billing review. A timeout retry reads the same subscription and does not create a new charge. The verified webhook releases only the matching unpaid reservation, preserving agreement and billing history.

Completed scheduled reservations survive quote expiry. An abandoned Checkout requires confirmed remote expiry/failure before its reservation can be reused; elapsed time alone cannot justify a new payment attempt. New scheduled offers stop shortly before launch to respect Stripe's minimum session lifetime. After the configured date, newly issued offers disclose payment at Checkout and require fresh consent. The `--activation` check is specifically for the prelaunch window; use `--checkout` only when deliberately opening ordinary paid signup.

A paid invoice can activate paid billing after the start date. The administrator-controlled profile-release hold remains separate; this release does not promise automatic profile release at midnight.
