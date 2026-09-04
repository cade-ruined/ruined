# Ruined — first correctness repair pass

Date: September 4, 2026. Status: implemented and verified locally; not deployed.

This follows `experience-audit-2026-09-04.md`. It completes that audit's first repair batch, not the whole launch checklist. Existing unrelated work and live member records were left untouched. No database migrations, invitations, payments, provider configuration changes, or legal publications were performed.

## What changed

| Area | Repair |
| --- | --- |
| Profile and Foundations saves | Profile privacy history and Timeline/Future Letter completion evidence now reach Postgres as JSON objects, satisfying existing constraints. Future Letter text is still never submitted. |
| Artifact and email records | Artifact input/shipping snapshots and Resend contact snapshots use the same typed JSON contract. Missing shipping data remains SQL NULL. |
| Circle identity and privacy | Member and Shaper directory IDs have separate namespaces. Shaper photos, bio, and contact details follow existing explicit sharing choices and current role/account checks; private photo delivery recognizes eligible shared Shaper portraits. |
| Onboarding access | Paid Foundations members can use their assigned active Circle's events, Meet links, registration, and explicitly assigned learning resources. This does not unlock unrelated Circle, all-member event, or general Academy content. Gathering links select the actual event detail. |
| Operator rosters | Admission and promotion recheck current identity, entitlement, Circle/Block assignment and dates under transaction locks. Revoked operators cannot act. Automatic promotions skip ineligible people. Existing stale registrations remain removable; authorized operators can truthfully record historical attendance. |
| Attendance saves | Explicitly typed the optional reason passed into JSON construction, fixing a PostgreSQL parameter-type failure. |
| Timeline safety | Saves compare an immutable-history revision under the member lock. A stale tab cannot overwrite newer events, including after all events are deleted. Reload is authenticated and uncached. Conflicts and uncertain responses preserve the draft and require an explicit review of current saved events. Fields are read-only while a request is pending. Auxiliary completion metadata loads before the write, avoiding a false save-failure report after commit. |
| Alumni | Alumni with the existing revisit entitlement can read/export their own Timeline; server-side editing and completion remain denied. Suspended accounts cannot read private Timeline data. |
| Regression checks | Pinned the isolated PostgreSQL test engine as a development dependency. Previously optional database tests now run in normal `npm test`. CI now also triggers on the membership branch. This alone does not enforce deployment promotion protection. |

The existing active-Circle requirement for completing Foundations remains intact. Legacy progression-targeted events retain exact-match eligibility; this does not reintroduce promotion language in the UI.

## Verification

- Full suite: **500 tests passed, zero failed, zero skipped**.
- Full ESLint, TypeScript, production build, and whitespace/diff checks passed.
- New repository tests execute actual SQL, shipped constraints/triggers, and the installed postgres-js JSON serializer against isolated PostgreSQL. Permission tests include cross-Circle members, stale lifecycle snapshots, revoked roles, temporal assignments, waitlist ordering, and historical attendance.
- Local browser: Timeline add, edit, delete, undo, completion, and PNG preparation worked. Layout checked at **390×844, 1024×820, and 1440×900**, with no page-level horizontal overflow in those checks.
- Local Circle → Shaper profile and operator Experience → roster routes loaded. Operator roster also checked at 390×844.

Limits: browser checks used preview data. This is not proof of live OTP delivery, Stripe payment/webhooks, Calendar invitation delivery, every accessibility scenario, or multi-connection concurrency stress. Existing malformed historical snapshots were not rewritten. The original production join form was not refreshed or changed.

## What comes next

1. Review this batch, then approve its deployment separately.
2. Resolve the launch agreement and commercial offer; create the first real Circle/Shaper, meeting/Chat ownership, and useful Academy content. Verify The First Coin's Shopify product and fulfillment path.
3. Finish remaining reliability work from the audit: durable Calendar reconciliation, support delivery retry timing, meaningful service health, and operator support/notification controls.
4. Run a fresh invited-member and external-operator acceptance test end to end. Keep paid-cohort launch closed until that proof exists.
