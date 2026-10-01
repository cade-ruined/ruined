# Registration now, profiles later

## Approved experience

New standard registrations follow the same sequence whether they arrive through a personal invitation or the public Ruined Direct form:

1. Personalize/accept their invitation and confirm their email code.
2. Save their personal information and unique member tag. New held registrations require an age of at least 18 and a US address, including complimentary registrations. Existing and released members retain their normal profile editing.
3. Save a payment card securely through Stripe Setup mode, with explicit storage consent.
4. See the registration receipt and receive the visual welcome email.
5. Return to the receipt until an Operations Administrator opens their profile and queues the separate profile-ready email.

Complimentary and operator-funded registrations skip card saving. A profile and verified email alone do not finish a standard registration. Existing members receive no registration hold and keep their current access.

Saving a card, completing registration, sending either email, and opening a profile do not charge a card, start a subscription, or authorize a future charge. Paid membership still requires its separate reviewed agreement and explicit payment confirmation. Program gates such as Foundations remain independent.

## Release configuration and order

This document describes the implemented release, not confirmation that it is deployed. Before accepting new registrations:

1. Apply all pending platform migrations in the checked-in runner order, including `20260930140000_member_registration_access.sql`. It intentionally does not backfill existing members. The direct-signup and couples-placement migrations earlier in the runner are also required.
2. Configure `MEMBERSHIP_REGISTRATION_ONLY_ENABLED=true`. This enrolls only newly created members in durable holds and closes paid Checkout while registration is open. Removing the flag later does not release existing holds.
3. Retain connected Auth/database configuration, the verified Stripe account, secret and webhook, and `STRIPE_MEMBERSHIP_PAYMENT_SETUP_ENABLED=true`. Set `STRIPE_MEMBERSHIP_PAYMENT_SETUP_SIGNUP_ENABLED=true` to allow public Ruined Direct admission. `STRIPE_PAYMENT_SETUP_ACCOUNT_ID` must match the configured Stripe account. Each hold captures the account and test/live mode; a card saved elsewhere cannot satisfy it.
4. Enable `MEMBER_REGISTRATION_EMAILS_ENABLED=true` with the existing `RESEND_API_KEY`, verified `RESEND_FROM_EMAIL`, and HTTPS `NEXT_PUBLIC_SITE_URL`. The sender stays off by default. Deploy the exact public wordmark, couch image, and invitation artwork referenced by the emails.
5. Retain `CRON_SECRET` and verify the hosting plan supports the five-minute recovery cron in `vercel.json`. The protected recovery endpoint is `/api/internal/membership/registration-messages`. Completion and activation also attempt delivery immediately after their database transaction commits.
6. Verify the authentication confirmation and passwordless templates display `{{ .Token }}`. Complete a controlled production registration with an explicitly approved recipient, checking actual code delivery, Stripe saving, receipt, welcome delivery, and blocked profile routes. Separately verify an existing member retains access. Local previews and tests do not prove inbox delivery.

Never enable the intake switch on an old deployment. Deploy the migration, access checks, UI, worker, and configuration together before opening registration publicly. Keep paid release gates closed while using this flow.

## Later profile release

Open **Operations → Members → Registrations** (`/ops/registrations`). Administrators can review registrations by ready, in-progress, or open status, see welcome/activation email state, select ready members, and review the exact recipients before opening profiles.

Each release rechecks current readiness and the reviewed record version. Withdrawing a required saved card prevents release until it is saved again. A stale or failed row is reported individually. Refresh before retrying an ambiguous result. The release records the administrator action and queues one profile-ready message atomically; it does not change billing.

This is an event-based two-email sequence: registration welcome, then an administrator-triggered profile-ready email. No dated drip schedule or additional campaign messages are enabled by this work.

## Couples registering before paid launch

After saving eligible personal information, each adult can enter the other adult's email and explicitly agree to link their Circle placement. The pending choice is also available from the registration receipt. The other adult must separately verify their own email, save eligible details, and name the first adult before a pair is confirmed. No partner email is sent, and the member endpoint never reveals whether an address has an account or returns discovered profile details.

Pending requests can be corrected or removed. Confirmed pairs require operator assistance to change. Operations registrations display the entered address, pending/confirmed status. The existing database Circle guard applies to confirmed registration pairs before payment: a pair cannot be assigned to two different current Circles, and joint transfers remain atomic. Existing conflicting placement or a different commercial couple prevents confirmation rather than silently moving anyone.

Each adult still completes their own registration and required card-saving step; complimentary exemptions remain independent. A registration pair does not authorize shared billing, grant membership funding, open either profile, reserve a price, or complete the paid couples agreement. That separate mutual payment approval is still required at paid activation.

Apply `20260930200000_registration_eligibility.sql` and then `20260930210000_registration_couples.sql` before deploying the matching UI/API. Pair rows have RLS and no direct anonymous/authenticated access; the server checks verified identity, adulthood, US registration eligibility, and completed personal information.

## Delivery and access guarantees

- Email messages are queued durably and uniquely per member and event. Provider retries use the same saved payload and idempotency key. Uncertain sends outside the safe replay window become `manual_review`; they are not blindly resent.
- Welcome delivery waits if a required card has been withdrawn. A delayed welcome is cancelled after profile activation so it cannot arrive after the profile-ready message and say the profile is still closed.
- Removed, suspended, revoked, or changed-recipient accounts do not receive a stale queued message. Transactional registration emails are separate from newsletter consent.
- Held members can complete their information and manage card storage. Member pages, APIs, public profile/card visibility, direct Data API access, and paid commercial participation enforce the hold on the server/database.
- Roll back application behavior with care: leaving held records in place while deploying pre-hold code would remove application-level protections. Prefer a forward repair. Do not delete holds to reopen admission.

## Safe local previews

- `/membership?preview=payment-setup`: personalized invitation, code entry, and registration copy.
- Member **Demo account** selector: Registration · details, Registration · card, Registration · receipt.
- `/ops/registrations`: fictional recipients and disabled release actions in preview mode.
- `/api/preview/registration-email`: welcome email; add `?kind=profile_ready` for activation or `?funding=complimentary` for the no-card welcome.

Previews create no accounts, save no payment methods, send no emails, and grant no access. Email preview routes are disabled in production.
