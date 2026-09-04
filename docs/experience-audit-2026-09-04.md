# Ruined experience audit

September 4, 2026 · Public website, membership, and operations

## Verdict

Keep this in a controlled pilot. The product has substantial infrastructure and a recognizable visual identity, but it is not ready for an unattended paid-member launch. The largest gaps are reliability, real launch content, and the connections between features—not a lack of pages.

The next milestone should be one member and one newly invited operator completing the entire journey without developer intervention. More interface polish should follow that proof, not substitute for it.

This was a review, not a release. No live member records, agreements, payments, permissions, messages, or deployments were changed. The existing membership form was left untouched.

## What is actually live

Verified against Vercel metadata, the live browser, and read-only counts from the connected database.

| Area | Observed state | Meaning |
| --- | --- | --- |
| Public website | `theruinedproject.com`, commit `58f24a1` | Separate production deployment; no visible member sign-in in its header or full menu. |
| Members/operators | `members.theruinedproject.com`, commit `95e1b96` | Latest signup fixes are deployed. Existing operator session works. |
| Database | 27 platform migrations recorded | The schema is installed; this does not mean launch content is populated. |
| Members | 2 records, both billing pending, program prospect, onboarding in progress | No completed fresh-member journey exists in this connected dataset. |
| Membership agreement | 0 versions | A member cannot finish agreement acceptance. |
| Circles / Blocks | 0 / 0 | Placement and a first actual Circle still need setup. |
| Foundations enrollments | 0 | Live completion has not been demonstrated with a real enrollment. |
| Academy | 0 collections, resources, or resource versions | The library shown in preview is not a populated live Academy. |
| Member Experiences | 1 archived test event; no published member event | Public community events exist separately. |
| Artifact | 1 published template with a live-mode Shopify binding recorded | The binding exists locally; this audit did not independently verify Shopify product availability. |
| Billing evidence | 0 Stripe webhook records and 0 subscription records | No successful billing lifecycle is evidenced by this database. Previous setup used Stripe test mode; live keys were not re-read in this audit. |
| Member photos | Private `member-portraits` bucket, WebP only, 3 MiB | Storage is connected and private. |
| Support / member notifications / workflow actions | No records yet | Empty queues are not proof of successful delivery. |

## Launch blockers and correctness fixes

### 1. Finish the agreement and entry release gate

There is no published membership agreement. After a successful profile save, the form deliberately says entry is closed until approved copy is available. This is a separate blocker from the save bug we repaired.

Publish owner-approved membership terms through a controlled process, confirm the price/offer and cancellation rules, and prove agreement → payment → webhook → activated access. There is no agreement-publishing control in the current operator routes, so a routine future agreement change still requires technical help.

Sources: `src/lib/membership/repository.ts:215`, `src/components/membership/JoinForm.tsx:537`, `:545`, `:565`; live aggregate query. The empty `membership_prices` table is a setup signal, not independently a Checkout failure: Checkout also uses a server-configured Stripe Price.

### 2. Repair the remaining database serialization failures

The recent signup patch fixed entry-specific writes. The same error remains elsewhere:

| Action | Actual impact | Source |
| --- | --- | --- |
| Save member profile/privacy preferences | Transaction fails and edits roll back | `src/lib/membership/repository.ts:1311` |
| Mark Timeline complete | Completion fails | `src/lib/membership/repository.ts:3006` |
| Mark Future Letter complete | Completion fails | Same completion repository path |
| Create an Artifact production job automatically | Input/address snapshots are stored as strings instead of objects | `src/lib/workflows/repository.ts:337` |
| Finish public Resend contact synchronization | Object-constrained snapshot can fail after the provider action | `src/lib/communications/outbox.ts:279` |

The first three were reproduced by executing the current repository functions, using the installed database driver's serializer, and executing the emitted inserts against the shipped table definitions in isolated PostgreSQL. All three failed with constraint error `23514`. Artifact snapshot corruption was reproduced with the actual handler and serializer. No real member data was written.

Fix the typed JSON contract across all remaining paths, add database-backed regression tests, and check existing stored values before considering a data repair. Do not weaken constraints to accommodate malformed data. The public marketing path exists in the separately deployed public commit too; a members-only deployment will not fix it.

### 3. Close the event-roster permission gap before adding scoped operators

The server checks whether a Shaper/Guide may manage an event, but it does not check whether the supplied member belongs to their permitted Circle or has an eligible lifecycle. The UI dropdown is scoped; the API is not sufficiently scoped.

A local execution of the actual repository accepted an outside-Circle member for both roles. This is a demonstrated application authorization gap, not a claim that anyone has exploited the live site.

Check the target member and event audience in the same transaction. Add negative tests for outside-Circle IDs, suspended members, expired assignments, and revoked roles.

Sources: `src/lib/platform/ops-experience-repository.ts:1295`, `:1318`; `app/api/ops/experiences/[experienceId]/registrations/route.ts:38`.

### 4. Make onboarding access match the actions members see

A paid member still completing Foundations can access their Circle, but lacks the capabilities required by some linked Meet and Academy destinations. The Circle page can therefore show a usable-looking meeting/resource button that leads to an access-denied response.

Decide which Circle meetings and learning resources are included during onboarding. Grant that access intentionally, or explain the prerequisite before showing an action. Keep the active-Circle requirement for finishing Foundations.

Sources: `src/lib/membership/access-policy.ts:14`, `:160`; `src/lib/membership/repository.ts:1371`, `:1693`.

### 5. Connect the public website and membership host properly

The public site's member icon is gated off. Its configured destination is also relative `/my`, so simply turning on the icon would send visitors into the public deployment's member routes instead of the dedicated membership host. Several return-to-website links on the membership deployment likewise use `/`, which opens its copy of the public site.

Establish canonical cross-host destinations, a visible member sign-in, and redirects for legacy member/operator URLs. Preserve the existing public site's deployment and scheduled-work ownership.

Sources: `src/lib/platform/visibility.ts:2`, `src/data/navigation.ts:8`, `src/components/platform/PlatformShell.tsx:408`, `:485`; live public header/menu inspection.

### 6. Make release verification mandatory

All 463 existing tests pass when the optional PostgreSQL engine is provided. They still miss the reproduced defects above. Many tests inspect source strings rather than exercising a complete write or permission boundary.

The CI push trigger covers `main`, while membership production tracks `codex/my-ruined-foundation`. The strongest signup test is skipped by normal CI because `PGLITE_MODULE` and its dependency are not supplied.

Add the deployed branch to CI, install the database test dependency reproducibly, require these tests, and ensure deployment promotion waits for required checks. Add browser-level lifecycle tests rather than more assertions that a particular string exists in a file.

Sources: `.github/workflows/ci.yml:5`, `tests/member-entry-json.test.mjs:183`.

## Member journey: what needs refinement

### Circle and Shaper identity

- Shaper links can open the wrong member: member and staff assignments have separate numeric ID sequences, but both are used as unnamespaced profile IDs. The route searches members first. Use a canonical person ID or namespaced assignment ID.
- Live Shaper data deliberately returns no photo, biography, location, email, or phone. The requested Email/Call/profile experience is present in preview but not wired to a privacy-approved live staff profile.
- Without a Meet URL, “View gathering” can point back to `/my/circle` rather than event details or registration.
- An unassigned member needs a direct “Request a Circle” action, including a specific-Circle request through the existing support category. The current message only says Ruined will place them.
- Add a consistent automatic Circle naming convention and capacity/readiness display before creating many Circles. Keep IDs stable if display names later change.

Sources: `src/lib/membership/repository.ts:1381`, `:1495`, `:1553`, `:1556`; `app/my/circle/people/[personId]/page.tsx:25`; `src/components/membership/MemberCircleRoom.tsx:14`.

### Foundations, Timeline, and personal writing

- Remove implementation instructions that are still rendered as lesson copy, such as “Reveal one editable prompt at a time…”.
- Reflection examples are initialized as actual answers. Start the fields empty; use examples as placeholders or clearly separated guidance.
- The Future Letter intentionally keeps its text out of the database, but members cannot export it and ordinary navigation can discard it. Keep that privacy decision explicit and offer a local download/print, a safe local-draft option, and a navigation warning.
- Timeline saves replace the full list without checking its revision. A stale second tab can soft-delete an event added in the first tab. Add optimistic concurrency or per-event mutations.
- Alumni should retain read/export access to their own Timeline if that is the intended promise. Currently the read route requires `foundations.write` even though alumni have revisit access.

Sources: `src/data/foundations.ts:343`, `:445`, `:636`, `:733`; `PresentationShell.tsx:70`, `:122`, `:1386`, `:1418`; `src/lib/membership/repository.ts:2795`, `:2870`, `:2919`.

The Timeline's local carousel image preparation worked during this audit. The existing add-event → list → generator structure is worth retaining. Test multi-page exports, long titles, unusual dates, large histories, and save conflicts as a separate acceptance matrix.

### Academy

The library interface and versioned publishing system exist, but the real content library is empty. Operators currently need direct media/thumbnail/caption URLs and manually entered duration.

There is also a concrete publishing mismatch: authoring accepts any HTTPS media URL, while the page's security policy permits native video only from the site and configured Supabase origin. A valid external MP4 can save successfully and then be blocked from playing.

Choose an approved hosting model, align URL validation with the security policy, and require a playable preview before publication. Add a simple upload/provider workflow, duration detection, thumbnail defaults, captions, audience chips, and operator search. Do not add unnecessary LMS complexity.

Sources: `src/lib/platform/ops-academy-repository.ts:159`, `:326`; `src/components/membership/MemberLearningArticle.tsx:64`; `next.config.mjs:22`; `OperatorAcademyActions.tsx:89`, `:160`.

### Events and communications

Internal event registration, capacity, waitlist, and attendance controls exist. Remaining operating gaps are walk-in/external-event attendance, event cover images, and duplicate/recurring meetings. Public community attendance and private member attendance need an explicit reconciliation rule.

Google Meet/Calendar has real integration code and a previously successful live record. However, event publication currently commits in the app and then relies on a second browser request to update Calendar. Circle changes mark invitations pending; no scheduled Calendar reconciler completes them. A closed browser or provider failure can leave stale invitations until an operator notices.

Move follow-through into a durable server-owned queue. Show exactly who will be invited before sending, and make changes/cancellations converge even after the browser closes.

Google Chat currently means stored links, not automatic space membership. Define who adds/removes members. Leaving a Circle or losing Ruined access does not itself revoke previously granted Google Chat access.

Sources: `OperatorExperienceRecord.tsx:316`; `calendar-audience-invalidation.ts:24`; `ops-calendar-repository.ts:1495`; `ops-experience-repository.ts:1311`, `:1536`; `ops-operating-repository.ts:2304`.

### Artifacts

Keep The First Coin as the first complete fulfillment journey. Product binding, versioned templates, awards, production states, and shipment history are implemented.

“Live binding” currently means a valid-looking GID/handle and matching local integration record—not a verified purchasable/published Shopify product. Verify product/handle/publication against Shopify before presenting it as ready.

Fulfillment is a manually managed Ruined ledger, not Shopify order/fulfillment automation. Operators also lack a consolidated production work order containing the immutable recipient/address snapshot, personalization, variant, and instructions. Decide whether Shopify or Ruined owns fulfillment, then make one complete path obvious.

Sources: `ops-artifact-repository.ts:224`, `:316`, `:423`; `ops-operating-repository.ts:2065`; `app/api/revalidate/route.ts`.

## Operations: make the work obvious

| Improvement | Why it matters | Evidence |
| --- | --- | --- |
| Add support and unsent Calendar changes to Overview | The default “Open work”/attention area omits support tickets. An operator has to remember another destination. | `OpsOverview.tsx:85`; `ops-operating-repository.ts:1477` |
| Give Shapers/Guides a real scoped queue, or hide Work | They currently receive empty categories and “All clear,” plus a link to admin-only System. | `PlatformShell.tsx:24`; `ops-operating-repository.ts:1215`; `OperatorWorkQueue.tsx:106` |
| Group address corrections | The support UI saves one field, while the server requires five address fields together. An operator cannot add a missing address. | `OperatorProfileSupport.tsx:101`; `ops-profile-repository.ts:365` |
| Reuse the member phone control | The operator placeholder includes spaces that its server validator rejects. | `OperatorProfileSupport.tsx:182`; `ops-profile-repository.ts:353` |
| Standardize recoverable form errors | Profile support and notifications can stay stuck Saving/Sending when the network request rejects. | `OperatorProfileSupport.tsx:90`; `OperatorNotificationCenter.tsx:59` |
| Add notification audience review | The default is all active members, followed by immediate sending. Show recipient count and preview; require explicit audience choice. | `OperatorNotificationCenter.tsx:65`, `:112` |
| Make support searchable beyond the latest 200 | Client filtering only searches the returned subset; an old unresolved ticket can disappear from practical discovery. | `support/repository.ts:92`; `OperatorSupport.tsx:15` |
| Create a Circle detail workspace | Multiple global forms and nested accordions force operators to repeatedly select the same Circle. Show its ten seats, Shaper, resources, Chat, meeting, and readiness together. | `OpsSection.tsx:182`; `app/ops/circles/page.tsx:66` |

The goal is to let an operator answer three questions immediately: **What needs me? What can I do here? Did it work?**

## Reliability and stewardship

### Replace misleading health indicators

The live System page showed five connected services and zero needing attention, even though Stripe and Notifications showed no successful run. Most statuses mean configuration exists; they do not prove the service worked.

Use **Configured / Verified / Delayed / Failed / Test mode**. Include oldest pending work, last worker run, failed Stripe events, support email delivery, and a direct recovery action. Treat never-used integrations as unverified.

Sources: `src/lib/platform/config.ts:25`; `ops-operating-repository.ts:2628`, `:2634`; `OperatorSystemHealth.tsx:22`.

### Align recovery schedules with the promises

Support retries stop after 23 hours, but the scheduled communications worker runs every 24 hours. A failure during the daily run can age out before the next scheduled retry. Membership workflows similarly back off in minutes but only receive daily scheduled recovery, with bounded batches.

Use a sufficiently frequent, monitored recovery mechanism and keep the existing leases, deduplication, and dead-letter safety. Confirm hosting limits/cost before changing schedules.

Sources: `src/lib/support/delivery.ts:11`, `:149`; `vercel.json:6`; `src/lib/workflows/repository.ts:243`.

### Complete the operational safety plan

- Verify backups and perform a restore rehearsal, including private photo/media objects. This audit did not verify backup availability or recovery time.
- Use a dedicated least-privilege application database role. The audited connection uses `postgres` with RLS bypass; this is not evidence of a public data leak, but it makes server authorization bugs more consequential.
- All 108 inspected public tables had RLS enabled, and none granted anonymous SELECT. This is a useful baseline, not a complete proof of every authenticated policy.
- Document privacy/export/deletion handling, retention of sensitive writing/support/profile data, and provider access removal. Do not promise self-service controls that do not exist.
- Separate or explicitly reconcile test billing data before taking live payments. Do not treat switching Stripe keys as the entire cutover.
- Decide grandfathered pricing, cancellation/grace/refund/dispute handling, and how older subscriptions retain access. The webhook currently expects one configured Price.
- Keep a repeatable operator training dataset outside production. Demo records need internally consistent dates and completion states; some current previews show a completed Artifact while Foundations is still 73% complete.

The database recommendation follows [Supabase's RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security); application permission checks remain essential when using a bypass-capable server role. Current provider changes were checked against the [Supabase changelog](https://supabase.com/changelog).

## Visual and language pass

Retain the supplied Polaroid, paper textures, Inter/Ivy/CadeHandy2 hierarchy, small corner radii, hard shadows, and the established palette—including corrected yellow `#FFCA2C`. The Circle cluster and member-profile identity are recognizable. No new visual theme is needed.

Prioritize these refinements:

1. **One clear navigation system per purpose.** Keep the public hamburger and member FAB, but give the FAB an understandable visible label. Eleven equally weighted destinations are too many; group Profile/Account/Edit, and nest Timeline under Foundations while retaining a contextual shortcut.
2. **Design the first visit, not only the populated profile.** The live profile currently leads with “Name not added,” stock photography, zero progress, no dates, and an empty archive. Present one welcoming completion action; defer empty sections until they carry value. Avoid implying the stock image is their portrait.
3. **Remove repeated actions.** The main Foundations card repeats its own title as its CTA, while another card links to Foundations again. Upcoming also appears twice. Make each placement earn its space: next action, current status, or full history—not three versions of the same link.
4. **Bring urgent operator work above long activity feeds on mobile.** The mobile overview starts with a tall statistics block. Unanswered support, pending invites, and failed deliveries should be actionable before the operator scrolls through history.
5. **Consolidate identity controls.** The live mobile member header wraps Sign out onto another row, consuming space before the profile. Put secondary account actions in one compact account control while preserving access to Support and Operations.
6. **Use plain, member-facing language.** Replace “administrative side,” implementation instructions, and redundant labels. Rename navigation “Learn” to “Academy” if Academy is the product name. Explain statuses like Artifact “Collecting” in ordinary terms when they require action.
7. **Use real photography where it matters most.** Shaper portraits, the first Circle, event covers, and the actual First Coin will establish credibility more effectively than more generated placeholder scenes.

Responsive spot checks covered 390×844, 1024×820, and 1440×900 across representative live/preview member and operator screens. The sampled layouts had no page-level horizontal overflow. This was not a full accessibility certification or every-route/browser/device matrix. Contrast, keyboard paths, screen-reader announcements, captions, zoom, long names, empty states, and failure states still belong in acceptance testing.

## What is worth keeping

- One verified identity with separate member/operator permissions.
- Invitation-led access and server-owned role grants.
- Private photo delivery and explicit Circle sharing preferences.
- An active Circle as a server-enforced Foundations completion gate.
- Exact agreement versioning and durable acceptance architecture.
- Server-owned Stripe Price/member identity and webhook-driven activation.
- Event capacity, waitlist promotion, attendance history, and timezone handling.
- Versioned Academy publication and audience targeting.
- Artifact versioning and shipment correction history.
- Support ownership checks, idempotency, concurrency checks, and queued email.
- Calendar identity/organizer safeguards and durable synchronization records.
- Separate deployment/worker ownership and documented rollback boundaries.

These do not need to be rebuilt. They need their edge cases repaired and their connections exercised.

## Recommended delivery order

### Pass 1 — Correctness and access

Repair remaining JSON writes; close roster authorization; fix Shaper identity/contact mapping; align onboarding entitlements; prevent stale Timeline overwrites; make these failures reproducible in mandatory tests.

### Pass 2 — One launch-ready Circle

Approve/publish the agreement and commercial configuration. Create one real Circle and Shaper, schedule its first meeting, connect its Chat with explicit ownership, publish a small useful Academy set, and verify The First Coin's product and fulfillment workflow. Decide operator/member entitlements and the first 30-day delivery cadence.

### Pass 3 — Operator confidence

Correct System health, automate Calendar recovery, fix support retry timing, add support to Overview, repair profile-support forms, add notification review, and consolidate Circle management. Provide a short role-specific SOP based on the actual verified interface.

### Pass 4 — Brand and usability refinement

Apply the visual/language changes above, replace critical placeholders, and test the same tasks on phone, tablet, and desktop. Connect the public-site sign-in and canonical host navigation as part of the coordinated release.

### Pass 5 — Controlled acceptance pilot

Use approved test recipients and sandbox payments first. Do not infer permission to send invitations, accept agreements, or charge from this audit.

- New operator receives an invitation, signs in, and sees only their intended permissions.
- New member receives a code, confirms email, uploads a portrait, saves the profile, and can reload without losing fields.
- Member accepts approved terms themselves, completes the intended payment test, and access changes only from the verified webhook.
- Member requests/receives the intended Circle, opens the correct Shaper profile, and joins the assigned meeting/material without contradictory access denial.
- Circle/roster changes update Calendar; cancellation removes/updates the invitation even if the operator closes their browser.
- Member edits their profile, saves Timeline events across reloads, exports a multi-image carousel, and keeps their Future Letter locally if desired.
- Foundations cannot complete without a Circle; completion with all requirements awards The First Coin exactly once.
- Operator can fulfill it from one complete work order and the member sees accurate tracking.
- Support reaches the correct inbox; operator reply reaches the member; failed delivery is visible and safely retried.
- Notification audience preview matches actual recipients; duplicate submission does not duplicate delivery.
- Suspended/revoked/unassigned users lose the correct access, including an explicit Google Chat offboarding step.
- Network loss, expired sign-in, duplicate clicks, concurrent edits, and provider failures produce recoverable outcomes.

Only after this should a live paid cohort be opened with a named operator responsible for support, placement, weekly delivery, and fulfillment.

## Verification boundaries

Reviewed routes, UI components, repositories, migrations, provider code, deployment contract, and tests. Used separate reviewers for member/access, operator workflows, and integrations. Inspected live public navigation, authenticated operator Overview/System, and the current member profile; reviewed populated local member/operations previews at representative sizes. Prepared a local Timeline PNG successfully without modifying live data. Both anonymous support API checks (`/api/my/support` and `/api/ops/support`) returned HTTP 401, as expected.

Fresh automated result: **463 passed, 0 failed, 0 skipped** with the isolated PostgreSQL engine supplied. Additional local probes reproduced the three JSON constraint failures, Artifact snapshot type defect, and missing roster authorization.

Not performed: a new OTP delivery, fresh invitation acceptance, real agreement acceptance, payment, provider-message delivery, live roster mutation, Shopify availability verification, backup restore, load test, or exhaustive penetration/accessibility audit. These remain explicit acceptance work—not implied successes.
