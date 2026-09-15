# Meeting scheduler release — September 15, 2026

## Scope

- Start/end scheduling and editing use a date plus a list of 48 half-hour times.
- Existing odd-minute meeting times remain unchanged until deliberately edited;
  no silent rounding. Moving an odd-minute meeting to another date requires
  choosing an available half-hour time.
- End time remains optional, with one Clear action and unchanged unsaved-change
  protection. Existing timezone/DST conversion and API payloads are retained.
- Circle activation guidance now explicitly allows scheduling meetings later.
  Its administrator confirmation and existing member requirements are unchanged.

This is a membership-only release based on
`4eb2820883fd7b1f4bb2ca107b93916047f8e693`. It contains only four UI components,
five test files, and operator/release documentation. No configuration, database,
API, authentication, dependency, public-site, billing, or Google changes are
included. The local preview-default change is not included in this release.

## Verification

- Exact isolated release: 1,070 tests passed with no failures or skips; lint and
  production build passed. Type validation is also part of the release checks.
- Independent scoped review found no blockers; 89 targeted checks passed.
- Browser checks at 390×844, 1024×820, and 1440×900 confirmed the controls fit
  without horizontal overflow. Both lists expose only :00 and :30 choices.
- Form selection was tested without saving, publishing, activating a Circle,
  or sending invitations. Unsaved test values were discarded.

## Deployment and rollback

Target: `ruined-members`, branch `codex/my-ruined-foundation`, domain
`members.theruinedproject.com`. Do not promote this branch to public production.
At preparation, public `main` independently pointed to
`db2e604f637d1717aa5473841429fdf773127afd`; it is not changed by this release.

Deployment and live checks are pending when this document is committed. Verify
the resulting membership commit/deployment, CI, live create/edit controls, and
anonymous access protections before reporting completion. Do not submit live
forms merely to test the release.

Previous membership production: commit `4eb2820`, deployment
`https://ruined-members-cq16pxkhf-ruined-s-projects.vercel.app` (GitHub deployment
6469522844). Roll back only the membership project if needed; keep its domain,
environment, schedules, and all business records unchanged.
