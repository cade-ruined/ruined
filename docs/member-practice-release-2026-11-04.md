# Account-backed Practice

The member profile now links to Practice. The Foundations and Monthly tabs place the assignment first, with the complete supporting deck and recap separate. Existing `/my/foundations` links redirect to Practice; the approved F1 document stays at its protected route.

## Work and access

- F1: keep three complete private timeline entries to earn the F1 Badge. Each entry records when, what happened, its meaning, and how that meaning shaped the member. Existing private Timeline records remain canonical; this does not publish them to the public Timeline.
- F2 and F3: locked until the operator releases their supporting decks. Assignment and badge requirements remain to be announced.
- F4: locked until release. Keeping a private future-self letter earns the F4 Badge.
- TIME: opens December 1, 2026 at 07:00 UTC (midnight America/Denver). A chosen action and funded MY 168 time plan earn the TIME Badge.
- Practice uses existing member/profile eligibility and permits Foundations before Circle placement. Read-only members can revisit saved work; write access remains separately checked.

Drafts save to the authenticated account. Owner checks, revision comparisons, serialized saves, explicit Keep receipts, and same-tab recovery protect interrupted work and competing tabs. Personal answers are not saved in browser storage. The deck only remembers slide position, under an opaque member-specific key.

## Release and recap emails

Administrators open `/ops/foundations` → **Practice releases & recap emails**, or `/ops/practice`.

F1 is already available through the existing Foundations launch gate. Its recap requires a deliberate **Release recap** action. F4 uses **Release assignment & send recap**. The operator first reviews the recap and currently eligible recipient count. The review is short-lived and bound to that operator and the current audience.

F2/F3 support a separate deck-only release. Their assignments remain TBD and no recap is sent by that action. TIME opens and queues its recap on December 1 using the existing member-lifecycle scheduled worker.

Installing this update does not enqueue an F1 or F4 email. Delivery checks current membership, released profile, verified email, consent, and local/provider suppression. Recipients are unique per release; frozen payloads and provider idempotency protect retries. An uncertain delivery beyond the retry window requires manual review. Missed scheduled releases older than seven days are not sent later. Member erasure also removes pending delivery data.

## Deployment

Apply these additive migrations with the existing checksum-verifying runner before the application release:

1. `20261104180000_member_practice.sql`
2. `20261104190000_member_practice_release_emails.sql`

The membership production branch is `codex/my-ruined-foundation`, deployed to `members.theruinedproject.com`. No production reflections, letters, plans, release actions, or recap sends are created by deployment verification.

If the application must be rolled back, retain the new tables and member work. Do not roll back by dropping stored work or resetting existing member records. Any deliberate release already performed must be reviewed separately before changing its availability or delivery state.
