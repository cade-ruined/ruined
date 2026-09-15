# Operator app interface release

Approved target: `ruined-members`, production branch `codex/my-ruined-foundation`, domain `members.theruinedproject.com`.

## Scope

The operator interface uses one workspace dropdown, compact bento summaries, browse-first directories, and focused editing windows across Members, Operators, Circles, Blocks, Events, Foundations, Academy, Artifacts, Messages, Support, Work, and Settings. Saved event records now lead with Schedule, Audience, Location, Meeting, and Event details. Existing permissions, draft protections, pending guards, and consequential-action warnings remain.

The release was prepared in an isolated checkout based on the currently deployed membership commit `b2fb79c1968a05e0308a71a293902d3546d8240d`. Only the approved UI, navigation, scoped CSS, tests, and operator documentation were copied from the shared working directory.

No authentication, API, repository/data-model, database migration, environment, package, payment, Google configuration, or public-site changes are included. No member updates, invitations, event publication, provider sends, or worker invocation form part of release verification. The three existing membership schedules remain unchanged.

## Validation

- Isolated full suite: **1,063 passed; zero failed or skipped**.
- ESLint, TypeScript, production build, and whitespace checks passed.
- Local visual checks: 390×844, 1024×820, and 1440×900, including record views and focused editing windows.
- Independent release-scope and UI-safeguard review: no blocking findings.
- No production secrets or local environment files were copied into this checkout.

## Deployment and rollback checks

Verify that GitHub CI passes and Vercel reports the new commit successful under **Production – ruined-members**. Then check signed-in operator screens and anonymous access restrictions on the custom domain without submitting changes.

Previous membership deployment: `https://ruined-members-pbvv74ydd-ruined-s-projects.vercel.app` (GitHub deployment `6465837036`). Rollback only the membership project to that verified deployment if required; retain domain, environment, worker ownership, and database state.

The public project is separate. Its production was commit `b00538502b00161889e0405fb2b8ff213fc9ca1f` at preparation time; this release must not push `main`, promote a membership preview in the public project, or change public domain mappings.
