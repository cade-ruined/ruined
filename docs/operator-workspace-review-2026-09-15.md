# Operator workspace simplification

Status: local review only. This work has not been deployed. No production accounts, roles, Circles, meetings, messages, payments, or integrations were changed.

## Direction

Jedari influenced the organization: browse people, groups, events, and content; open the item to manage it. Ruined retains its paper, typography, restrained color, and existing account model. The goal is fewer decisions on the first screen, not fewer safeguards.

Reference: https://help.jedari.com/hc-en-us/admin-portal-101

## Changes

- One fixed app-style header replaces both navigation rows. The current-workspace dropdown opens every permitted destination directly, with native links, keyboard/outside dismissal, and no extra rail spacing. Account remains separate.
- Overview is a compact bento: People and search, paired Circle/Foundations cards on mobile, genuine attention items, upcoming events, pending work, and recent activity. Work queue and Foundations retain their compact summaries. The design borrows app-like focus and generous tap targets without replacing Ruined's visual identity.
- People opens the member directory first. Joining reviews have their own view; adding a member opens a guarded window. Member portraits, compact identity information, and a next-step card lead each record; Why this step? expands the explanation.
- Member records show one of Overview, Membership, Journey, Community, or Record at a time. Joining, contact, agreement, billing, and journey evidence use compact cards; the full account-state breakdown is expandable. Existing section links still work; forms remain mounted, pending saves block switching, and unsaved edits are retained.
- Existing Circle management remains in its focused window. Each meeting now has one management link for its details and invitations.
- Blocks are browse-first, with New Block and a scoped Manage Block window for adding, activating, or removing Circles.
- Events use compact cards and focused creation. A Circle's Schedule a meeting link carries its identity into the form. An event's Overview is a bento of Schedule, Audience, Location, Meeting, and Event details; longer descriptions and registration windows are optional disclosures. People and Activity remain separate views.
- Manage meeting opens a guarded window containing invitation send/update/retry controls, delivery details, and the optional manual link editor. The Meeting card keeps its status and relevant quick links visible. Manual-link replacement, zero-recipient warnings, real-send review, and recovery controls remain explicit. Read-only operators can open Meeting details but cannot send or change communications.
- The event title's ••• button opens Event actions for completion, archival, or cancellation when allowed. Cancellation still requires its reason and final confirmation. Pending actions and unsaved changes retain their close protections; merely opening either window sends or changes nothing.
- Public-event creation opens in a guarded window without changing its existing publication or registration behavior.
- Academy separates Lessons and Collections. New lessons and collections open in windows; secondary presentation/media settings are optional without dropping stored values or validation. Saved lessons open on Content, Audience, and Publication cards. Edit lesson and Read lesson notes open focused windows; versioned publication remains a separate action.
- Board posts and Alerts start with compact saved-message cards, history, and search instead of repeated counters and large headings. Compose and review are separate from browsing. Existing draft publishing, exact recipient review, and delivery behavior remain.
- Artifacts separate Production, Templates, and Shipping, with compact job, template, and shipment cards. Awards, template creation, product changes, and shipment editing use guarded windows; active edits survive view changes. Shopify binding and manual fulfillment behavior are unchanged.
- Support begins with search, filters, and request cards. A request centers the conversation and reply form; Update status opens a guarded window instead of a permanent sidebar. Closing status editing preserves a typed reply. Version-conflict guidance stays inside the window; member-facing support remains unchanged.
- Work queue uses compact actionable cards and category filters, with small totals instead of large counter strips. Foundations groups compact member/progress cards and keeps completed records expandable. Neither presentation change adds completion or eligibility overrides.
- Settings shows service-state cards first. Services needing attention stay expanded; healthy service details can be opened when needed. Evidence, test/live labels, failed actions, and retry gates remain available. Legacy access/billing summaries and management disclosures use the same compact treatment.
- The operator SOP reflects the local revised interface.

## Verification — earlier workspace pass

- Full automated suite, lint, TypeScript, and production build checked. The build uses the separate build-check output so the running development preview is not overwritten.
- Browser review at 390×844, 1024×820, and 1440×900 covered navigation and representative lists, records, and dialogs. Inspected screens did not overflow horizontally.
- Exercised Circle-to-meeting creation, member view switching, clean dialog closing, unsaved-edit protection, Academy creation, notifications composition, Artifact views, Blocks, and public-event creation without submitting production changes.
- Existing permissions, version checks, preview guards, and mutation payloads remain covered by regression tests.

### Current inner-page pass

- The first full automated run passed **1,171 tests**. The expanded final run passed **1,172 of 1,173**: the existing Circle-Shaper migration fixture hit its timestamp-ordering race (`revoked_at` supplied by the test before the database's default grant timestamp). Its six-test file passed on an isolated rerun without changes. Lint and TypeScript checks are clean.
- Added coverage includes Support status-window cancellation, reply preservation, pending-save protection, exact-version updates, conflict recovery, deep links, focus targets, and preview restrictions, alongside the event, member, Academy, and Artifact regressions.
- Browser review at **390×844, 1024×820, and 1440×900** checked the compact event snapshot and representative member, Circle, Academy, Artifact, message, Support, Foundations, public-event, and Settings screens. Inspected layouts did not overflow horizontally. Member record tabs remain horizontally scrollable within their own rail.
- Exercised focused editing windows, safe closing, unsaved-event-change protection, Circle management, lesson editing, Artifact views, message composition, and Support status review without submitting live changes. Missing Academy thumbnails now have a visible format fallback. Event-action errors stay inside their dialog; successful actions close it.
- The isolated production build passes without overwriting the running development preview.

## Release boundary

Preview at http://127.0.0.1:3002/ops. This is a local fixture-backed demonstration, not evidence that production services delivered an invitation or notification. The connected application uses the same components with its existing data and authorization checks.

Deployment still requires an explicit release request and a focused membership release snapshot. The shared working tree also contains unrelated work; do not deploy the repository root or indiscriminately commit its changes.
