# Profile release welcome

Profile release opens `/my` directly. The existing profile-release and membership access rules remain authoritative; this change does not release any profiles.

## Member experience

- The profile identity appears first, followed by an optional three-item “Make yourself at home” guide.
- Profile credit comes from an existing portrait, nonblank bio and member tag. Private Journal credit comes from a nondeleted, nonfuture entry that is not explicitly shared to the public Timeline. Calendar credit records an actual rendered Calendar visit, not a prefetched link.
- Dismissal and Calendar visits are stored per member on the server. The guide can be reopened from the profile, and refreshes on return. Members can use all of their existing features without finishing it.
- “Write privately” opens the Journal composer directly. Unfinished and recovered drafts are protected. The “Add to Timeline” checkbox controls public sharing.
- A short, replayable “A quick look around” disclosure explains the profile, Journal, Timeline, Calendar, Circle and badges.
- Existing pending badges do not cover the first profile visit with a dialog. An explicit notice opens the reveal. New awards after an action can still celebrate normally.
- Real Foundations attendance can now earn In the Room. Practice calls and merely receiving an invitation do not qualify. See `member-badge-operations.md` for evidence requirements.

## Release requirements

Apply both additive migrations before deploying:

1. `20261026210000_foundations_first_call_badge.sql`
2. `20261026211000_member_welcome_state.sql`

Both are registered in `scripts/migrate-platform.mjs`. The welcome table has no anonymous or authenticated Data API grants; writes use verified server identity and released-profile access. Optional progress errors leave the profile usable.

Local preview mode renders the same UI with disposable sample data and never writes welcome progress or Journal entries to production. Preview progress resets when its route remounts; cross-device persistence is verified in database/API tests, not claimed from that preview.

This feature does not create founder posts, edit member profiles, send launch messages, or activate unreleased member accounts. Prepare those launch contents separately with their authors.
