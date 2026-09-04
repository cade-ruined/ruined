# Membership reliability release — September 4, 2026

## Verified before release

- Source branch: `codex/my-ruined-foundation`; prior membership production
  commit `95e1b968b9585f203ebfc3ef91dbb604a4c9864c`.
- Destination: existing Vercel `ruined-members` project, production branch
  `codex/my-ruined-foundation`, custom domain
  `https://members.theruinedproject.com`. The public site's `main` branch and
  production commit `58f24a17118a2e8d59d74f0d0878587781d5123f` remain out of scope.
- Full suite: 546 tests passed; no failures or skips. Optimized production build,
  lint/type validation, and all 57 static pages passed with development stopped.
- Applied only `20260904225258_calendar_durable_reconciliation.sql` using the
  checksum-checked migration runner. Afterwards: 28/28 migrations applied, no
  checksum drift; Calendar RLS enabled; anonymous/authenticated browser roles
  have no direct table privileges.
- Database preflight: no pending Calendar requests, no unsent support delivery
  rows, no queued/processing/failed membership workflow actions. The only
  historical Calendar link is already cancelled. No provider work was fired.
- Calendar first invitations require explicit Publish on a ready, explicitly
  mode-bound environment for an event that has not ended. Automatic recovery
  from both worker and member actions pauses after event end. Intentional
  operator actions and cancellation recovery remain available.

## Provider configuration

- Membership is connected, with Stripe's public key in test mode and existing
  sensitive secret/webhook values present. Protected keys were not exported,
  replaced, or exposed. Presence is not proof of successful signed delivery.
- Existing test price: USD 1.00/month, a test fixture only, not a commercial
  membership offer. No real pricing decision is implied.
- Updated only the URL of existing test webhook
  `we_1U8jsH4cnqzISerX2PNTcxsI` to
  `https://members.theruinedproject.com/api/stripe/webhook`. Endpoint identity,
  signing secret, enabled events, and API version remain unchanged.
- Google communications remain explicitly test-mode. Google still sends real
  invitations in this mode; no invitations or Google event mutations were run.
- The new Calendar cron is a daily fallback. A verified frequent scheduler and
  recipient receipt are still launch checks, not implied by a passing build.
- Older deployments do not enforce the new Calendar environment checks. Do not
  use old preview hosts or roll back while they can send against the shared
  database; drain/disable them first. Public production has no Google Calendar
  configuration and was not changed by this release.

## Pilot decisions and remaining work

- Proposed first Circle: `Circle 01`, ten places, initially forming. Cade named
  `cade@theruinedproject.com` as Shaper. His existing Administrator role must be
  preserved; Shaper assignment needs its own additive, audited permission.
- Draft prepared for **The Ruined Project LLC**:
  [pilot agreement](membership-pilot-agreement-draft.md). It has not been
  published or accepted, and does not authorize real charges or paid conversion.
- Candidate members remain Taelor, Tyler, Mitch, and Libby at
  `@theruinedproject.com`. Libby's existing operator invitation must remain
  intact. No member allowances or invitations have been sent by this release.
- Still required: owner approval of exact agreement and no-charge pilot scope;
  complete member sign-in, profile/photo, agreement, test checkout and signed
  webhook, active Circle, Foundations, support and Calendar receipt tests.
- Paid launch also needs its final offer and reviewed terms, billing/tax and
  cancellation checks, privacy notice review, real Academy content, and an
  explicitly verified Artifact/Shopify fulfillment path.

## Deployment result

Pending production promotion and live smoke checks at the time of this commit.
Record the actual deployment outcome separately; do not treat this release
checklist as proof that a member completed onboarding.
