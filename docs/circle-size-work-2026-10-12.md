# Circle size work

Implemented on `codex/circle-size-tasks`, based on membership release commit
`f92a49b`. This change is locally verified and has not been deployed or applied
to the live database.

## Behavior

- Active Circles below 7 or above 13 participants create high-priority Work tasks
  assigned to the active Administrator at `libby@theruinedproject.com`.
- Count the Circle Supporter once across the roster and staff assignments.
  Forming Circles wait until activation. Existing active Circles outside the
  range enter the workflow when the migration runs.
- Keep one task per continuous issue, refreshing its count and Circle name.
  Returning to 7–13 completes outstanding work; closing the Circle cancels it.
  Manual completion stays completed until recovery and a later breach.
- Evaluate the final transaction state for transfers, couples, roster removals,
  staff changes, and identity linking. Record creation, assignment, and resolution
  in the existing task event history.
- If Libby is unavailable, keep work visible and unassigned. Account/role changes
  repair system routing while preserving another operator's claim. Releasing an
  in-progress system assignment reopens it so another operator can claim it.
- Default capacity becomes 20. Existing forming/active Circles with capacity 10
  move to 20; custom capacities remain. Placement above the configured capacity
  still requires a current Administrator exception review. The healthy band and
  exception boundary are separate.
- Work and Overview link each task directly to its Circle. Work shows the current
  context and actual assignee, with existing ownership controls.

## Verification

- Full suite: 2,804 passed, zero failures.
- Final focused database/UI/ownership suites: 29 passed, including the additional
  role-revocation regression added after the full-suite run.
- TypeScript, ESLint, and production build passed.
- Local browser at 1440px and 390px: task assignment and context visible, Circle
  link opens the correct native management dialog, no horizontal overflow, and
  no page errors. Preview fixtures were used; these are not live delivery checks.
- SQL tests run the migration on isolated PGlite databases, including boundary
  counts, defaults, custom-capacity exceptions, recovery, duplicate prevention,
  transaction rollback, identity changes, and private-table/function access.
  They do not simulate simultaneous connections to a production Postgres server.

## Release

Apply `20261012211658_circle_size_work.sql` through the existing checksum migration
runner and deploy the matching membership application after publication is
authorized. Verify Libby's active Administrator account, real Circle counts, and
assigned tasks afterward. Migration backfill creates real tasks immediately;
the existing work digest may include them. No new email delivery path is added.
