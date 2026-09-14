# Ruined operator browser workflows

Release approved September 14, 2026. The three database updates below are applied and checksum-verified; application rollout targets the existing membership production branch. No live member records, access grants, Circle placements, payments, shipments, or messages were changed by the release. Existing public listings are seeded once by their migration.

## What changed

- **Navigation:** choosing a group reveals its pages without loading an unrelated destination. The sticky navigation keeps the current page clear. Work is under Overview, Operators under People, Blocks under Circles, and connection health under Settings.
- **People:** pending joining permissions remain searchable after leaving the page. Review, copy, renew, and remove actions identify the exact invitation and preserve the first-sign-in expiry. Copying or renewing a member allowance does not send an email. Operator responsibility and managed Circles can be edited directly, with reasons and explicit confirmation for elevated/restored access.
- **Circles:** search and status filtering precede the list. The selected Circle contains its roster, member transfer/removal controls, Shaper, Google communication links, and resources. Selecting a different Circle loads its own controls, never the previous Circle's resources.
- **Member records:** returning to Members retains the search, filter, and page. Circle links open the correct workspace. Return destinations accept only the internal member directory, not arbitrary URLs.
- **Events:** Member experiences and Public community share one workspace with clear tabs. Public listings can be created, edited, and archived in the browser. Existing BYOB registration and waiver records remain canonical; roster search and attendance use those records without copying them into the member event system.
- **Academy:** publish updated drafts while the current lesson stays live, retire unused drafts, and filter retired content out of ordinary work. Audience selection uses explicit checkboxes instead of keyboard-modifier selection. Preview lesson links show the chosen lesson rather than always opening the same sample.
- **Messages:** Board posts and Alerts are together, with Support separate. Draft posts can be corrected or discarded; published posts can be retracted without deleting history. Retraction does not undo something already read. Alerts remain in-app, not email or SMS.
- **Artifacts:** find a published Shopify product by name and select it instead of pasting product IDs. The server verifies the product before saving its binding. Existing awards, production, shipment, and tracking controls remain separate from Shopify ordering.
- **Settings:** connection health no longer depends on loading the member dashboard first. Authentication and Administrator access are still required; an unavailable database does not become a bypass.

### Circle chat and meeting follow-up

- Every Circle has a visible **Chat & meetings** action. The selected workspace shows its chat link and meetings before its roster, with **Set chat link**, **Open chat**, and **Copy link** directly available.
- **Schedule a meeting** opens a draft form with the exact authorized Circle preselected. Unknown, duplicated, or unauthorized scheduling context shows a recovery path instead of defaulting to a broader audience. Circle staff remain limited to current assignments.
- Existing meetings link to the visible **Meeting link** section and Calendar invitation controls. Calendar-managed links are not editable through that form. Saving a manual link does not send an invitation; Calendar automation creates its own Meet room.
- **Publish + queue invitations** describes the real behavior. Operators still need to check Calendar status, and Google Chat participants must be managed in Google. No Google provider requests or production changes were made for this follow-up.

## Safeguards retained

Every write remains subject to server-side role checks. Access changes protect the acting Administrator and the final active Administrator; Circle staff conflicts are checked before saving. Stale invitations, content versions, and attendance states are rejected instead of overwriting newer work. Audit and historical records remain intact. Preview paths do not send messages or write real records.

## Release order

1. Review and isolate the approved changes from the shared checkout's unrelated unfinished work. Do not deploy the entire dirty worktree by default.
2. Inspect the live migration ledger and the project's backup/recovery state. Use the existing checksum-aware platform migration runner; do not modify previously applied migrations. The runner currently orders the pending additions as:
   - `20260914181653_operator_complimentary_membership.sql` — earlier approved member-access work.
   - `20260914221302_community_event_operations.sql` — public listings and attendance.
   - `20260914221725_academy_unused_draft_retirement.sql` — safe retirement of unused drafts.
3. Deploy the reviewed member/operator code and public-event consumers to their respective hosts. Public and member hosts must use the same canonical database for operator event edits to reach the public website. Never enable preview mode on a production host.
4. Sign in as an existing Administrator and check Members, Circles, Operators, Academy, Events, Messages, Artifacts, Support, and Settings. Confirm an ordinary member cannot open operator tools and a Shaper remains limited to the assigned Circles.
5. With approval, save and reload a dedicated disposable draft to prove live persistence. Check unpublished content stays private. Test permission changes, attendance, retraction, and retirement only against agreed test records; do not alter real members for a smoke test.
6. Check existing email, Google Calendar/Meet, BYOB/Sheets, Shopify, and billing integrations using their established health checks and logs. Deployment is not permission to send new invitations, create orders, charge cards, or notify members.

## Remaining boundaries

- This is not a new media-hosting system. Academy video, captions, and download files need hosted URLs; public event images/video use existing site-media paths. Uploading fresh event media from the operator browser is not included.
- New public events use external registration or no registration. Only the existing BYOB 02 form uses its existing approved native waiver. New native public waivers, capacity, and waitlists are not created by this release.
- Shopify product selection does not create a product, order, shipping label, or automatic fulfillment. Shipment/tracking entry records what the operator has arranged.
- Provider credentials, mail delivery, Calendar delegation, payment activation, and legal/tax approval still have separate setup and verification requirements. A passing local check is not proof of production provider delivery.

## Verification

The shared development review passed **959 automated tests**. The isolated release, excluding unrelated public redesign and waitlist work, passed **870 automated tests**, lint, type checking, and a production build. Database tests execute actual migrations and repository queries in an isolated PostgreSQL engine, including denied access, stale changes, canonical BYOB preservation, and content retirement.

Production database verification: 33 recorded migrations have matching checksums, including the separately released waitlist migration. The two new community tables enforce RLS and deny direct anonymous/authenticated browser-role access. Member, role-grant, Circle-assignment, public-registration and Academy-resource counts were unchanged. The only historical failed Calendar request belongs to a cancelled, archived event; no queued/processing Calendar or membership workflow jobs were present. The free Supabase plan has no scheduled backups; exact pre/post affected definitions and constraints are retained in the ignored local `.backups/operator-release-2026-09-14/` directory, not committed as customer data.

The in-app browser was checked at **390×844**, **1024×820**, and **1440×900**. Reviews covered sticky navigation, the selected Circle workspace, operator access editing, event tabs and forms, Academy, Messages, and Artifact controls. The communication follow-up was also reviewed at those sizes: saved and empty chat states, switching Circles, exact-Circle scheduling, and visible Calendar-managed meeting setup, without horizontal overflow. This verifies the local interface and isolated behavior, not production save/reload or provider sends.

See `operator-admin-sop.md` for operator instructions, `community-operations-release-2026-09-14.md` for event-specific rollout details, and `member-access-parity-release-2026-09-14.md` for the earlier complimentary-membership release dependency.
