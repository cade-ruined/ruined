# Experience loading and member-first Shapers

## Release scope

Target: the existing `ruined-members` project and `members.theruinedproject.com`.
Prepared on membership commit `65042ff7e8d4068f5917d9242867f739e11221f7`, preserving the BYOB October signup, shared attendee sync, and updated event tests. No public-site deployment, payment configuration change, operator invitation, Circle assignment, event publication, or Calendar send is part of this release.

## Changes

- Circle Shaper selection lists that Circle’s full current roster first. New Shaper access requires explicit confirmation; existing administrators keep their permissions. Changed identity, access, standing, placement, or invitation state is rechecked before saving. Assignment and access audit records commit together.
- The private Circle staffing trigger accepts an existing active administrator as Shaper without a second role grant. Member-facing Shaper reads retain directory-sharing preferences and active-access checks.
- Google Chat setup includes collapsed instructions for copying a private space’s link. Google invitations and space membership remain separate from storing the link in Ruined.
- Experience and Calendar display reads use non-locking snapshots. Actual admissions and sends still recheck the same eligibility policy under the existing row locks. This resolves PostgreSQL `25006` on populated meeting pages without weakening write authorization.
- Missing Experience records remain 404s. Access loss stays denied. Other load failures offer a fresh page request and a link back to Experiences, not a misleading passwordless-login prompt. Error logs include a safe SQLSTATE, never database messages or member details.

## Database

Applied only `20260915174319_circle_shaper_admin_eligibility.sql` on 15 September 2026 at 18:24:55 UTC, using the existing advisory lock and atomic checksum ledger. SHA-256: `6c5c1adeffef6abf83fb384515eb44fee53dc5a77c92cddb0dca280a2a036987`.

The old trigger definition was fingerprint-checked before replacement. The committed result retains the private schema, empty search path, existing security-definer behavior, and revoked execution for public clients. No business rows were changed. Existing migration registrations are preserved; unrelated pending migrations were not run.

## Verification

- Real PostgreSQL fixtures reproduce the original read-only locking failure, then verify that the actual event-record loader succeeds without row locks, writes, or provider calls.
- Admission/send tests retain locking and deny newly revoked access after a stale display snapshot.
- Circle tests cover full rosters, confirmation, existing administrators, revoked/suspended accounts, placement changes, pending invitations, duplicate retries, and atomic rollback.
- Page tests distinguish missing records, denied access, unavailable services, and ordinary load failures without leaking private error text.
- Desktop/tablet/mobile Circle controls were reviewed at 1440×900, 1024×820, and 390×844. No actual member or Shaper assignment was submitted during browser checks.
- A separate production-mode build uses preview data and does not overwrite the active local development cache.
- All 331 focused release tests passed, with no skipped tests. The production build, type checks, lint checks, and before/after Supabase security advisors passed.

The affected saved `Founders Circle meeting` must remain a draft with no meeting link or invitations created by release verification. Verify the live page after deployment through the signed-in browser; do not use Publish or Calendar send controls as a smoke test.
