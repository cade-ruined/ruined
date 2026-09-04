# Ruined — delivery reliability and pilot readiness

September 4, 2026. Local verification is complete. The additive Calendar
migration is applied and verified; the app release is being prepared.
The existing Stripe test webhook URL now targets the membership domain.
No invitations, emails, Calendar writes, payments, or legal publications were
made. See the [release record](membership-release-2026-09-04.md).

This follows the [first correctness batch](correctness-batch-2026-09-04.md).
It is another bounded repair batch, not a claim that the entire launch is ready.

## What changed

- **Calendar:** published events and subsequent guest/content changes have
  durable queued reconciliation. A stopped browser no longer owns the second
  sync request. Retries retain the original event identity, reconcile current
  guests, use provider ETags, and preserve cancellation intent after archival.
  Interrupted work has a lease; failed work has backoff. The private worker
  processes one event per invocation.
- **Environment isolation:** Calendar links record an immutable test/live mode.
  Historical unbound links fail closed. An active administrator can explicitly
  verify and bind an existing Ruined-owned Google event; verification itself
  only reads Google. A separate sync/cancellation action authorizes delivery.
- **Support:** failed notifications no longer disappear behind a saved reply.
  Operators can filter email problems, inspect status, and retry proven-unsent
  emails. Possible prior sends outside the protected replay window require
  review, not another automatic send. Members never see operator diagnostics.
- **Invitations:** reissuing a member allowance cannot revoke a pending
  operator invitation for the same email. Verified claims retain one member
  identity and only the exact configured operator roles and Circle scope.
- **Overview:** unresolved support and Calendar work are surfaced directly;
  actionable work appears before the historical feed on smaller screens.
  Counts respect current administrator/assigned-Circle access.
- **System:** configuration, a database read verified now, delayed work, failed
  work, and historical provider acceptance are distinct. Stripe and Calendar
  evidence is environment-specific. Email acceptance is not called inbox
  delivery.

## Pilot recipients — read-only checks

All shortened addresses were interpreted as `@theruinedproject.com`.

| Email | Existing member | Existing pending invitation |
| --- | --- | --- |
| taelor@theruinedproject.com | No | None |
| tyler@theruinedproject.com | No | None |
| mitch@theruinedproject.com | No | None |
| libby@theruinedproject.com | No | Operator invitation already exists |

Libby's operator invitation was preserved. A separate member allowance must not
silently remove or change its authority. The others are member candidates, not
implicitly authorized administrators.

“Allow email” creates a seven-day sign-in allowance; it does **not** send an
invitation email. Once ready, share `https://members.theruinedproject.com/access`.
Each person requests their own sign-in code. An allowance alone grants neither
paid benefits nor completed entry, agreement acceptance, or a Circle assignment.

## What still blocks a complete pilot

The live database read found zero published membership agreements, zero active
Circles, zero published learning resources, and zero processed Stripe webhook
events. These are current observed gaps, not fixture or local-preview data.

1. Supply and approve the exact agreement to publish; do not auto-publish a draft
   or change the acceptance record to bypass it.
2. Decide the pilot commercial path. Stripe test checkout is recommended for the
   first walkthrough, with no real charge. Complimentary membership needs its
   own explicit access policy; it is not an existing checkout bypass.
3. Create the actual pilot Circle, Shaper and meeting details, then assign the
   invited members. Circle assignment remains required for Foundations
   completion, not for beginning it.
4. Publish enough Academy material for a meaningful walkthrough and verify the
   actual First Coin product/award/fulfillment path.
5. Review and deploy both repair batches only to the membership project, apply
   the additive Calendar migration, and verify the production configuration.
   Missing Stripe keys in the **local** environment do not prove the deployed
   environment is missing them; production payment setup must be checked afresh.
6. Activate and verify an appropriately frequent worker schedule. Current
   Vercel Hobby jobs are daily fallbacks. The added Calendar fallback does not
   make unattended invites prompt. See the
   [recovery activation checklist](worker-recovery-activation.md).
7. Complete one real-recipient, approved test-mode walkthrough: allowance →
   code → saved profile/photo → exact agreement → test checkout → verified
   webhook → Circle → Foundations completion → Calendar invite/update/cancel →
   support reply and receipt. Record each result separately.

## Verification boundary

Final checks: 546 tests passed, zero failed or skipped. Full ESLint, TypeScript,
and the optimized Next.js production build passed. No connected provider was
called by those tests.

Automated checks use actual isolated PostgreSQL constraints and mocked external
providers. They cover crashes, conflicting requests, changed audiences, revoked
permissions, queue timing, provider uncertainty, and mixed environments.
Browser checks use clearly labelled local preview data; they are not proof of
real email receipt or Google invitation delivery.

Overview and System were reviewed at 390×844, 1024×820 and 1440×900. The private
Calendar worker returned 401 without scheduler credentials. The existing live
member intake tab and its unsaved form were left untouched.
