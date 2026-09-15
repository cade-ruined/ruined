# Operator workspace release — 15 September 2026

Target: `members.theruinedproject.com` / Vercel `ruined-members`.
Source branch: `codex/my-ruined-foundation`.
Previous production commit: `97b432c0907ecc70c8696c8b7a4c4d4f46e54453`.

## Scope

- Circle card grid, one create action, and a focused Manage Circle window.
- Shaper and roster first; private member portraits or neutral fallback icons.
- Saved chat and resource details with explicit Edit, Save, Cancel and removal confirmation.
- Saved-first editing for member profile support, Experiences, public-event operator details, and Artifact product/shipping controls.
- Modal focus/scroll restoration and unsaved-edit/pending-request navigation guards, including the no-destination Create Circle shortcut.
- Administrator-only, owner-validated, non-cacheable member-photo proxy.
- Updated operator SOP and regression tests.

No database migrations, membership changes, invitations, Google sends, billing changes, public-event registration changes, or public-site deployment are included.

## Verification before publishing

The isolated release passed the full test suite, ESLint, TypeScript, and the Next.js production build. Local browser review covered 390×844, 1024×820, and 1440×900 layouts; Circle open/close and focus restoration; edit/cancel; guarded navigation; and read-only profile/event/artifact controls. Tests use local fixtures and do not mutate production records.

After deployment, verify the production alias and exact commit, read-only signed-in Circle/member views, and unauthenticated rejection of the photo endpoint. Roll back through the prior Vercel production deployment if required; do not force-reset shared branches.
