# Member access and complimentary operators

Release approved September 14, 2026. The complimentary-operator database migration is applied and checksum-verified. The reviewed member/operator application release includes these changes; live user activation still requires the operator to complete their own profile and agreement.

## Approved behavior

- All current operators (Administrator, Shaper, Guide) receive complimentary membership through their active, canonical operator role. Invitations alone do not grant benefits.
- Operators complete their own profile and accept the published agreement, then activate membership without a new Stripe payment.
- No one is marked paid. Existing Stripe subscriptions are not cancelled or modified by this change.
- Suspension, closed accounts, incomplete entry, expired cancellation access, revoked member roles, and restricted Circle/event audiences remain enforced. A Circle remains required to complete Foundations.
- Removing the last operator role removes complimentary funding. Actual paid membership can still provide access independently.
- Profile, Account, Foundations, Circle controls, events, notifications, and operator summaries use the shared access rules. Timeline/requirement writes recheck access inside the transaction.
- Timeline is named “My Timeline.”

## Demo

Local preview: http://127.0.0.1:3002/my

The demo selector offers joining, in-Foundations, active, complimentary operator, and paused accounts. It changes a local preview cookie only, never real roles, payment, or member records. Samples are explicitly dated August 27, 2026. Profile/billing writes are disabled. The selector endpoint is unavailable in production.

## Email investigation and completed action

- Supabase uses custom Resend SMTP; the default Supabase team-only sender restriction is not the current configuration.
- Tyler’s expired invitation was renewed once on September 14 and expires September 21, 2026. One fresh sign-in email was sent. Resend recorded delivery at 18:04:31 UTC on September 14. Do not automatically resend it as a release step.
- Libby’s available records show a delivered access email and successful sign-in on September 8. They do not establish delivery for a newer attempt. Obtain the page and approximate time of a fresh failed attempt before drawing a new conclusion.
- Provider “delivered” means accepted by the recipient mail server, not that the user saw or opened it.
- The login page now acknowledges requests without claiming inbox delivery and gives a support reference. Responses remain generic to avoid disclosing whether an email has an account.

## Release order

1. Isolate the approved membership changes from the unrelated public-site/operator work in the shared checkout. Do not publish the entire dirty worktree without reviewing scope.
2. Inspect the live migration ledger and back up using the existing project process. Apply the additive `20260914181653_operator_complimentary_membership.sql` through the existing platform migration runner before deploying code that calls its functions. Do not edit previously applied migrations.
3. Deploy the reviewed application to the membership host. Do not enable preview mode in production.
4. Verify with an existing operator: unified sign-in, profile/agreement checkpoint, complimentary activation, Account label, Foundations, Circle placement, and event eligibility. Confirm payment records remain unchanged.
5. Verify an ordinary member still follows normal payment requirements; test restrictions and revocations with dedicated test records rather than suspending real operators.
6. Reconcile existing connected Calendar audiences through the established worker and verify delivery logs. Do not create new event invites merely to test this release.
7. For Libby, inspect a fresh request reference and delivery event rather than repeatedly sending codes.

Local verification includes the full automated suite, type/lint checks, an isolated production build, actual PostgreSQL-engine tests for complimentary activation and protected writers, and in-app browser checks of account/profile and joining/paused/operator states. Live complimentary activation remains unverified until release.
