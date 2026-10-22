# Add a card for a member

Administrators can open **Operations → Members → member → Membership → Membership billing** and choose **Add card securely**.

The administrator confirms they are the cardholder and permits the selected member to use the card for their first membership payment and recurring renewals. Stripe collects the card and billing details on its own hosted page, then returns to the same member record. Only masked details are displayed after a verified Stripe webhook confirms setup.

This action saves a payment method for a member who has completed registration details but has not started membership billing. It does not charge the card, accept the member's agreement, create a subscription, or grant profile access. The member still reviews their plan and terms and completes membership checkout; that checkout reuses the saved Stripe customer and can use this card for the first payment and renewals.

Existing subscriptions, in-progress paid checkouts, complimentary/operator-funded accounts, couples checkout, incomplete registration, and closed accounts retain their existing restrictions. This is not an active-subscription card-replacement tool.

## Deployment

Run the additive platform migration `20261022120000_operator_payment_method_setup.sql` before releasing the application. It permits a separate operator consent version without modifying historical consent evidence or broadening table access.

The existing `STRIPE_MEMBERSHIP_PAYMENT_SETUP_ENABLED`, `STRIPE_PAYMENT_SETUP_ACCOUNT_ID`, and Stripe configuration must be ready. The existing signed webhook handles `checkout.session.completed`, `setup_intent.succeeded`, `checkout.session.expired`, and `payment_method.detached`; no additional webhook endpoint is needed.

The stored member ID and consenting operator ID remain separate and immutable. Stripe metadata binds both to the setup attempt. Cardholder billing details do not overwrite the member's Stripe customer identity. Retries reuse the committed attempt; another operator or the member cannot resume its private setup URL.

## Validation

Database-backed tests cover administrator authorization and revocation, target and actor attribution, immutable consent, provider timeouts and replay, mismatched webhook metadata, saved-card handoff to paid checkout, and absence of subscription/agreement/payment side effects. API and component tests cover origin checks, strict inputs, explicit consent, masked authoritative status, bounded polling, safe redirects, and inert previews.

No live card or payment is needed for local validation. The preview uses sample member records and cannot save or charge cards.

## Accept and pay for a member

Administrators can use **Complete membership** on a member’s Operations record. Choose a payment schedule, review the member’s server-issued offer and the complete published agreement, and confirm that the member has authorized the administrator to accept on their behalf. The administrator must also be the cardholder and authorize the initial payment and recurring renewals. Stripe payment opens directly in the record; saving a card separately is optional.

The beneficiary remains the member. The immutable authorization and acceptance name the actual administrator, preserve the member’s name/email separately, and bind the exact agreement to the commercial reservation and plan. Delegated receipts say “Accepted by” the administrator and “On behalf of” the member. Existing member-signed receipts retain their original format and hash. This records the administrator’s assertion of authority; it does not independently establish that authority.

Payment is confirmed only through the existing verified Stripe webhook and membership payment evidence. A return URL, agreement checkbox, saved card, or newly opened Stripe form never marks the member paid. The selected payment method funds the subscription’s future renewals. No live acceptance or charge is performed by installing the feature.

Deployment order: apply `20261022120000_operator_payment_method_setup.sql` and `20261022140000_operator_membership_checkout.sql` with the platform migration runner before activating the new application build. The second migration adds immutable operator authorization and native-payment bindings. It preserves self-service identity checks and does not rewrite any existing agreement or payment. After release, an administrator must personally review the real offer and finish Stripe payment. Preview mode is an inert UI demonstration, not a provider payment test.
