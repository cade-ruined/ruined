# Foundations 01 and the private member timeline

Part I at `/my/foundations/timeline/part-1` is a guided editor of the existing
private Timeline. The full Timeline links into it, and `/foundations/01/timeline`
on the public call deck redirects to it. An unauthenticated visit goes through
`/access` with an exact allowlisted return destination.

Every moment retains its canonical Journal entry ID, date, details, media and
history. New moments create private timeline entries through the established
`/api/my/timeline` endpoint. Meanings are stored separately from the publishable
Journal title/body. They appear in the member's full private Timeline and this
worksheet; public and generic Journal projections exclude the field.

Saving a moment does not complete a Foundations requirement. Existing member
access, Foundations launch, and explicit completion rules remain in force.
Read-only members can select and revisit all their moments.

## Saving and recovery

- Each Save updates one moment using the last timeline revision and verified
  session owner. Stale saves are rejected and leave the draft intact.
- An older client that omits meaning preserves the saved meaning. An explicit
  blank clears it. The limit is 4,000 characters.
- Drafts stay in member-layout memory, separately from regular Timeline drafts,
  scoped to the verified account. They do not use localStorage. Internal
  navigation can restore a draft; leaving/reloading warns about losing it.
- Uncertain saves must be reconciled against the latest entries before a retry.
  An uncertain new moment cannot be blindly re-added after navigation/recovery.
- Download copy contains the current saved snapshot and any unfinished moment.
  It is a local backup, not an account save.

## Release order

1. Apply the registered additive migration
   `20261008200000_foundations_timeline_meaning.sql`. It adds nullable fields to
   the current and historical journal tables; existing content is not rewritten.
2. Deploy the membership application to its member host.
3. Deploy the public Foundations deck and worksheet redirect.
4. Verify with an authorized member: sign-in return, existing event/meaning save,
   full Timeline display, refresh, and two-tab conflict recovery.

Local browser review uses `PLATFORM_MODE=preview` and
`MEMBERSHIP_FOUNDATIONS_LAUNCHED=true` only on a development server. It shows
example entries and resets them on refresh. Production launch/access gates are
not changed by this feature. No live member account or database was mutated
while preparing the implementation.
