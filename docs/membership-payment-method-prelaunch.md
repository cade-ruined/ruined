# Optional payment-method preparation before launch

This is a separate, optional Stripe Checkout **setup** flow. It saves a method on a Stripe Customer; it creates no subscription, invoice or charge, reserves no founding price, and does not grant membership, badges or other access. The public waitlist and paid Checkout release gates stay in place.

## Member experience

A verified invited member completes their profile, then can choose **Save payment method securely** while paid entry is closed. The form also lives at `/my/payment-method` and is linked from the account page for unpaid self-funded members. Storage does not require acceptance of an unpublished paid agreement.

The unchecked consent explains that saving is optional, costs nothing today and does not authorize a charge or membership. Stripe hosts the payment details and collects a billing address. Ruined stores provider IDs and safe display details only. A browser return never confirms success: the page reads the durable, webhook-confirmed status and offers a manual status refresh while confirmation is pending.

The member can withdraw storage consent and remove an unused method. Removal cannot detach the payment method of an active billing relationship or an in-progress paid checkout. Paid activation always requires a fresh reviewed offer, published agreement and payment confirmation; its Checkout can reuse the validated saved Customer without automatically charging the saved method.

## Release configuration

Default: disabled. Apply `20260930110000_member_payment_methods.sql` through the normal migration runner before enabling.

Required:

- Connected database and authentication.
- Server Stripe key and matching webhook secret.
- `STRIPE_PAYMENT_SETUP_ACCOUNT_ID` set to the exact account owning the key. The service checks the provider account and mode; sandbox and live mappings remain separate.
- `STRIPE_MEMBERSHIP_PAYMENT_SETUP_ENABLED=true` only after setup-mode webhook testing.

Keep `STRIPE_MEMBERSHIP_COMMERCIAL_READY=false` and `STRIPE_MEMBERSHIP_LIVE_ENABLED=false` while paid membership is held. Setup does not require prices, tax activation, a paid agreement version or a browser Stripe key. Changing the setup flag does not authorize later charges.

Required webhook events for this feature:

- `checkout.session.completed`
- `checkout.session.expired`
- `setup_intent.succeeded`
- `payment_method.detached`

Preserve the existing billing events and exact API version configured for the deployed code. Do not change a production destination to the new API version before deploying a compatible handler. A missing mapping or database failure must remain retryable; returning 200 while discarding a failed projection is not a repair.

## Verification before enabling

Use the separate Ruined sandbox and a verified synthetic pending member. Complete hosted setup with a Stripe test method. Confirm one account-bound mapping, `saved` after a signed webhook, duplicate delivery idempotency, no subscription/charge, unchanged membership state, and safe removal. Test a canceled setup, expired attempt, wrong account/mode, unsigned callback and a concurrent paid checkout. Test and live methods are never interchangeable.

At launch, revalidate payment readiness and current prices/tax, publish the reviewed agreement, then open paid Checkout. The member reviews the final amount and confirms there; this feature contains no automatic launch-charge job.

## September 29 test webhook investigation

Four persisted failed events were main Ruined **test-mode** renewals of two August `[TEST ONLY] Ruined Founding Membership` subscriptions at $1/month. The saved error was `Membership billing cannot be linked to a verified Ruined identity.` Provider metadata used the August preview draft and stale member IDs. These are separate from tax setup and from current sandbox setup-mode testing. Retiring old test subscriptions stops future renewals; it does not rewrite failed delivery history or manufacture member identities.

Provider smoke check completed September 29 in the separate Ruined sandbox: hosted setup completed, SetupIntent succeeded, redisplay enabled and billing address collected; no PaymentIntent or subscription was created. Full authenticated staging webhook delivery must still be verified before enabling live storage. See `../payment-setup-qa-20260929/QA.md` for local evidence. With user approval, both obsolete August test subscriptions were canceled immediately with no refund; their old failed-delivery records remain historical.
