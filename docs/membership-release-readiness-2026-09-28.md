# Membership release readiness — September 28, 2026

The initial production inspection was read-only. Later live Stripe Dashboard
notification and receipt updates are recorded below. No database publication,
migration application, deployment, Git push, payment, subscription change, or plan
purchase occurred. Vercel's expired saved login was refreshed through its installed
CLI; no credential values were printed or changed in the application environment.

**The owner subsequently revised the commercial offer on September 28.** The
earlier $499 / $5,040 catalog and cancellation-without-a-fee draft are superseded
as launch specifications. The revised individual, first-50, couples, commitment,
early-exit requirements are now implemented locally; tax setup and the release
checks below remain outstanding. This audit records infrastructure state and
local verification; it does not establish legal enforceability or authorize
collecting an early-exit fee from an existing pilot member. The superseded candidate was
not published or tested against production by the publication command.

The owner has since confirmed that early exit replaces remaining initial-year
installments and costs the lower of $1,500 or their unpaid remaining balance.
The first 50 count active registered users, including complimentary members.
Cancellation ends founding benefits at membership end; rejoining requires fresh
qualification within the first 50. The paid agreement now contains these rules.
Vacated places reopen whenever the current active registered count falls below
50. The local release now implements eligibility reservations, continuity history,
commitment accounting, cancellation, couples access, and renewal notices. These
changes have not been deployed or applied to the production database. They do not
rewrite existing members' accepted contracts.

## Verified Git and deployment state

| Surface | Branch | Current remote commit | Vercel production |
| --- | --- | --- | --- |
| Members | `codex/my-ruined-foundation` | `d7f58c13742d73b44c8737b8bef808b941e2dbed` | READY, `dpl_85wqX5M8YU3oimanaCFwXSVyKjD9` |
| Public | `main` | `84c5c98823d0a541deefee28fdfbeb6ea48af8d8` | READY, `dpl_4rGGnAUUNpSmnLHAm3drG4baJwdt` |
| Prepared work | `codex/stripe-direct-signup` | `c8413157f32834ded318ecc228790032888d4875` | Six commits ahead of member production; current policy edits remain local |

Member project: `prj_rhG4nC15jhDbILAI1dkx9OtzX0Ce`,
`members.theruinedproject.com`. Public project:
`prj_e8URQm88SXHmM2wXrSLzzg8SeKBn`, `theruinedproject.com`.
Both belong to team `team_kYGRhUxEAQ0ZGK3zulh3Cqdv`.
Recheck these heads immediately before any release. The public production branch
must not receive the complete member branch.

The working saved CLI is Vercel 59.11.2. Its existing cached entry point is
`/Users/cademangelson/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/index.js`.
`node <entry-point> whoami` successfully refreshed the saved session. Subsequent
supported REST reads retrieved projects, production deployments, team plan and
environment metadata. Browser access was not used for that infrastructure audit.
Supported live Stripe Dashboard access was restored later; no security policy was
bypassed.

## Live Stripe Dashboard update

The live Ruined account's successful-payment and refund receipts are on and were
verified after reload. Expiring-card, failed card-payment and failed bank-debit
emails are on. Finalized invoices and credit notes were already on and remain so.
Hosted payment-confirmation emails are on; existing confirmation reminders at
3, 5 and 7 days remain on.

Payment-method updates now link to Stripe's hosted page, replacing the obsolete
mixed-link mode whose destinations all pointed to the main website. Include
manage-subscription link is on with custom destination
`https://members.theruinedproject.com/my/account`. That setting does not establish
that the pending twelve-month commitment or early-exit flow has been implemented.
Retries, incomplete-payment/cancellation statuses, disputes and trial flags were
not changed.

Native upcoming-renewal emails were off and remain off. Their existing 7-day event
timing was retained; it does not send a renewal email or satisfy the local worker's
40- and 20-day schedule. The local worker remains independently default-off and
covers all six accepted offers: annual renewal notices for prepaid plans and
initial-commitment anniversary notices for monthly plans. The latter distinguish
the anniversary from the next monthly invoice. Keep it off until provider and
actual delivery checks pass; prevent overlapping native reminders when either
system is activated.

Public details privacy URL `https://theruinedproject.com/privacy` and support email
`cade@theruinedproject.com` were saved and read back. The paid terms URL remains
empty because the agreement is unpublished. Checkout now displays annual prices
in annual terms and shows the support email. Support phone and website display
remain off. Legal-policy links remain off because Stripe requires both published
terms and privacy URLs; enable them after the final terms URL is configured.
Store refund-policy display remains off; promotional-email terms were not accepted.

The management URL loaded the live Account page for the signed-in complimentary
member, preserving pilot v1. Paid-member cancellation behavior was not tested,
and no cancellation-confirmation switch was available on the inspected billing
page. Final version-specific terms links, affirmative acceptance, paid-member
cancellation/confirmation and actual email delivery still require verification.

Workspace evidence outside the repository:

- `outputs/membership-terms/stripe-billing-notifications-saved-2026-09-28.png`
- `outputs/membership-terms/stripe-receipts-saved-2026-09-28.png`
- `outputs/membership-terms/stripe-public-policy-links-saved-2026-09-28.png`
- `outputs/membership-terms/stripe-checkout-support-saved-2026-09-28.png`
- `outputs/membership-terms/stripe-dashboard-readback-2026-09-28.json`

No test email, real charge, deployment, migration or membership release was
initiated in this Dashboard update. Actual email delivery remains untested.

## Hosting constraints

The live Vercel team reports plan **Hobby**. Hourly cron expressions would reject
deployment: Hobby supports a daily run, with invocation during the scheduled hour.
Use a daily idempotent worker that handles its complete due-notice window while
the current plan is in place. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Separately, Vercel restricts Hobby to non-commercial personal use. Paid membership
requires an eligible commercial hosting arrangement. No upgrade or purchase was
made. [Vercel Hobby documentation](https://vercel.com/docs/plans/hobby).

## Member production configuration at the earlier read-only audit

Only non-secret values were decrypted for this audit. Sensitive server, webhook,
database, Supabase and cron values were not retrieved from Vercel.

| Variable | Current production configuration |
| --- | --- |
| `PLATFORM_MODE` | `connected` |
| `NEXT_PUBLIC_SITE_URL` | `https://members.theruinedproject.com` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Test mode; key omitted |
| `STRIPE_SECRET_KEY` | Present, sensitive; mode not verified |
| `STRIPE_WEBHOOK_SECRET` | Present, sensitive; destination/mode not verified |
| `STRIPE_MEMBERSHIP_LIVE_ENABLED` | `false` |
| `STRIPE_TAX_ENABLED` | `false` |
| `STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID` | `price_1UJdWe4cnqzISerX5M3cmhmg` — earlier live catalog |
| `STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID` | `price_1UJdWj4cnqzISerXbldILtgj` — earlier live catalog |
| `STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION` | Absent |
| `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` | Absent |
| Legacy `STRIPE_MEMBERSHIP_AGREEMENT_VERSION` | `preview-draft-2026-08-26` |

These are the earlier verified project settings, not a fresh readback after the
Dashboard update. The annual Price ID listed here has since been archived in
Stripe; the revised six-offer catalog is recorded in `stripe-policy-setup-2026-09-28.md`.
An existing production deployment retains its build-time environment. Live Price IDs must
not be combined with the existing test publishable key for purchases. Keep the
paid-agreement version unset while credentials and the new commercial offer are
unresolved: test credentials bypass the live-only flag in the existing readiness
logic. A false live flag alone is not a universal sandbox-off switch. Local code
now also defaults `STRIPE_MEMBERSHIP_COMMERCIAL_READY=false`, blocking new paid
signup for both live and test credentials. Do not enable that gate before the new
offer's commitment, eligibility, couples, cancellation and tax handling is ready.

## Database and agreement evidence

Read-only transaction against the existing production database verified 50 applied
migrations with matching local SHA-256 values, no checksum drift, and these three
pending files in the then-53-entry runner:

- `20260929000000_public_member_signup.sql`
- `20260929001000_membership_checkout_plans.sql`
- `20260929002000_ruined_direct_invitations.sql`

The final local runner now contains 60 migrations, including ten September 29
files. All ten remain unapplied to production in this task. The complete runner
was exercised in local real-schema tests. Recompute the production ledger
comparison against the final release snapshot; do not reuse the earlier
production count as proof that later files were applied or verified there. Apply reviewed additive changes through
`npm run db:migrate:platform`, using the existing database environment and the
runner's checksum/advisory-lock protections. Do not alter already-applied SQL.

Only `ruined_membership` version **1** exists. It is published and effective since
`2026-09-05T01:23:56.943Z`, titled `Ruined Membership — Pilot Agreement`.
Its ID is `3759041d-83e3-4fac-b788-f508445d0003`; its exact SHA-256 is
`ce1980c20b7ed5c22e719b43625b37366d22bed9d2838063677fb47185a642df`.
There are **five** acceptances, all associated with completed onboarding. One
additional onboarding is in progress and has no pilot acceptance. No member
identity or acceptance contents were disclosed by this audit.

The database allows only one published version per agreement key. Publishing v2
must retire v1 and insert v2 in one transaction. Retiring v1 preserves its body,
hash, original publication dates, five acceptance snapshots and receipts. The
public versioned route supports effective retired agreements. Pending onboarding
reads the current published version and would switch immediately to v2; an old
form attempting to accept retired v1 is rejected. Completed members with active
access are not automatically charged or re-enrolled by publication.

## Local publication command and verification

`scripts/publish-membership-agreement.mjs` is dry-run by default. It requires a
separate member-facing UTF-8 Markdown file, title, successor version, exact file
SHA-256, and explicit predecessor ID/version/SHA-256. Internal draft headings,
notes and placeholders are rejected. It never extracts agreement text from a
mixed internal draft and never automatically adopts the predecessor's actor.
An optional actor must be explicitly supplied and resolve to an active platform
identity; otherwise `created_by_auth_user_id` is null.

Run `node scripts/publish-membership-agreement.mjs --help` for arguments. Supply
`DATABASE_URL` through the environment, never as a command-line argument. Adding
`--apply` is the sole publication switch and belongs only to the final reviewed
publication action. The command does not enable payments or accept terms for any
member. An exact published retry is idempotent; conflicting existing content or a
stale predecessor is rejected.

Apply locks the agreement and briefly pauses acceptance/receipt writes, then
compares database-only evidence fingerprints and immutable agreement content
before committing. All failures during that transaction roll back retirement
and publication together. After an interrupted connection, rerun a dry-run to
determine whether the exact version was committed.

The offline PGlite regression uses the actual platform migrations and triggers.
It proves dry-run makes no changes, five pilot acceptances and five receipts stay
identical, the old body remains immutable, stale predecessor hashes reject,
failure after retirement rolls back, exact retries add no row, conflicting v2
content rejects, and no publication actor is inferred. Both tests passed, and
targeted ESLint passed. No production apply or superseded-candidate dry-run ran.

## Focused release route after the revised offer is settled

1. Resolve the issued Utah sales-tax permit and membership/early-exit tax
   classification, and arrange commercial-eligible hosting. The owner-approved
   prices, eligibility, couples, commitments, consent and cancellation flow are
   implemented locally; complete sandbox provider acceptance checks.
2. Verify the final additive migration ledger and backups, then apply the reviewed
   migrations through the platform runner. Keep pilot evidence unchanged.
3. Commit only the reviewed member release; validate lint, typecheck, tests,
   build, phone/desktop behavior, and CI. Fast-forward the member production branch
   only when its remote base still matches the reviewed base.
4. Deploy the member release with purchases and new notice sending gated off.
   Verify the agreement route and existing member entry/account paths on the
   production host. Preserve the public waitlist.
5. Publish only the final reviewed agreement version with its reviewed hash;
   verify the public version URL, matching Stripe policy configuration and
   matching payment credentials before any launch switch.
6. Verify signed webhook handling, price and consent parity, cancellation or
   early-exit behavior under the approved rules, receipts/notices and actual
   access dates before enabling paid signup. Do not submit a live test charge.

## Final local implementation verification

The final executable changes passed **1,743 tests, zero failures and zero skips**,
ESLint, TypeScript and the production build. `git diff --check` passed. The
full test run uses actual migration schemas and application handlers with
controlled provider responses; it does not establish a live-provider end-to-end
result. Local browser checks inspected 320px and desktop signup layouts with no
horizontal overflow, including the couple choice. Account layout was also
inspected at 320px. Cancellation consent, fees, failures and retries were checked
with component and server runtime tests; preview mode does not execute billing.

Coverage includes concurrent first-50 reservations, complimentary activation,
rejoining, couples access, exact paid consent, signed invoice activation, capped
replacement fees, balance/credit safeguards, retries after uncertain invoice
creation, portal routing before the first invoice webhook, all six renewal offers,
and preservation of pilot agreement evidence. A temporary held place prompts a
retry instead of offering standard pricing while fewer than 50 people are active.

The member-facing candidate SHA-256 is
`4573c9472e5051690492489b8b831118975c8075fe4e984d61152817a0ac948e`.
Its review copy and internal draft body match; publication remains pending.
The full local runner contains 60 migrations, ten pending relative to the earlier
production audit. No production migration or agreement publication was performed.

Sandbox commitment portal `bpc_1UKkLr9rQIwIEzKeqBefDPDr` was created and read back.
The matching live portal, disabling the old public legacy portal login, complete
webhook event configuration and restricted-key permissions remain release work.
The ignored local sandbox environment has no commercial-ready flag or configured
site origin, so the read-only readiness command correctly reported not ready.
It was not treated as successful provider acceptance testing.

Before the paid launch: resolve the issued Utah sales-tax registration and both
membership/early-exit tax classifications; arrange commercial-eligible hosting;
complete the controlled sandbox checkout/cancellation/renewal and authorized
email-delivery checks; then apply the reviewed migrations, publish the exact
agreement, configure and deploy the member release with matching credentials.
Purchases, automated fee processing and renewal sending remain gated off until
the corresponding checks pass. Existing pilot acceptances do not authorize fees.
