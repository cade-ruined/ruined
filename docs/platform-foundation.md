# Ruined Membership platform foundation

This increment establishes two private application surfaces:

- `/my` for a member's next action, Foundations, Circle, Artifacts, and account.
- `/ops` for internal member, Foundations, Circle, Block, access, and billing
  visibility.

The local preview is intentionally read-only. It uses fixture data only outside
production, displays a persistent preview marker, and disables account access,
payment, billing management, and persistence. Missing
production configuration fails closed; it never becomes preview mode and never
creates a fake session.

## System boundaries

Each system has one job:

1. **Supabase Auth** verifies passwordless identity.
2. **Postgres** owns the canonical member ID, roles, lifecycle, Circle, Block,
   Foundations, Artifact, consent, and integration state.
3. **Stripe** owns payment and subscription facts. Only verified webhook events
   update billing state; a Checkout redirect never activates membership.

The membership operating spine is additive. A durable `people` record now sits
above login and membership, so one Person may be both a member and an operator
and may accumulate verified event, learning, purchase, Artifact, leadership,
and membership history over time. Existing member and login writers remain
compatible during the dual-write release: a missing Person bridge is created in
the same transaction, while conflicting email-to-Person links fail closed and
require an audited merge.

Member access has separate admission, administrative onboarding, billing, and
standing dimensions. Payment is only one checkpoint. Administrative onboarding
can complete only after the database can prove an active member login, a
verified email, required profile completion, active billing, and an immutable
acceptance of a published agreement. Existing paid members are backfilled to
preserve their current access; new members use the stricter gate.

Pricing and Artifact definitions are versioned records in Postgres. They can be
configured after the product decisions are approved without changing the core
state model.

## Google registrant mirror

The private `Registrants` Google Sheet is an operations mirror, not another
database. A completed BYOB Nº 02 registration is committed to Postgres first. A
server-only outbox worker then upserts the canonical record into the Sheet by
registration UUID. Both the immediate lookup and daily reconciliation are
scoped to BYOB Nº 02. The daily protected job retries unfinished work and
rewrites the managed rows from Postgres so manual drift is repaired. A Google
failure never blocks or rolls back a registration.

The managed tab has exactly nine columns: Registered at, First name, Last name,
Email, Instagram, Status, Waiver accepted, Waiver version, and Registration ID.
Column I is hidden and supplies retry-safe identity. Waiver evidence, guest
records, rate-limit data, and queue payloads are never copied to Google. Dates
are written as numeric Google Sheet date values in `America/Denver`; all user
text uses RAW writes so it cannot be interpreted as a formula.

To connect the mirror:

1. Create a dedicated Google Cloud service account with the Sheets API enabled.
   Do not grant domain-wide delegation or unrelated Google Cloud roles.
2. Share only the target spreadsheet with that service-account email as an
   Editor, and name its existing tab `Registrants`.
3. Store the spreadsheet ID and base64-encoded service-account JSON in the
   production environment variables documented in `.env.example`. Never expose
   either value to the browser.
4. Set `GOOGLE_REGISTRATION_SHEET_ENABLED=true` only after the sheet share and
   production secrets are in place. `CRON_SECRET` protects both the scheduled
   and manual worker route.

The worker writes A:I with RAW values, hides the UUID column, and extends an
existing native Google Sheets table when new rows fall outside its range. If
the tab is a plain grid rather than a native table, the same managed range still
works and no table conversion is required.

## Connect Supabase and Postgres

1. Create a Supabase project and use separate development and production
   projects.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the deployment's secret settings.
   Do not commit values to the repository.
3. Add the direct or pooled Postgres connection as `DATABASE_URL`, then run:

   ```sh
   npm run db:migrate:platform
   ```

   The runner records each migration checksum in a private ledger. An unchanged
   migration is skipped on later runs, while checksum drift stops the run.
   Existing installations without ledger rows will replay the historical,
   idempotent migrations once so the ledger can be established.
4. Configure custom SMTP before production. The default Supabase mail service is
   suitable only for limited testing.
5. Configure the passwordless email template to show the code using
   `{{ .Token }}`. The app accepts Supabase's supported six-to-ten-digit email
   OTP range, not a one-click link.
6. Set `PLATFORM_MODE=connected`. The server will still show the unavailable
   state unless both Supabase public configuration and `DATABASE_URL` exist.

Member sign-in lives at `/my/access`; operator sign-in lives at `/ops/access`.
Member access is invitation-only. A first verified sign-in may claim one
unexpired, unrevoked invitation for the same normalized email; returning access
requires an existing active member account. Creating that identity leaves the
program at `prospect`; it does not activate membership. In connected mode,
Foundations, Circle, and Artifacts are server-gated until the member has active
account, billing, and onboarding state. Operator permissions are app-owned
database roles, not editable profile metadata. Shapers and guides see
assigned members only; an active `ops_admin` can see all members.

A member may start and continue Foundations before being placed in a Circle.
Only the final completion transition requires a current assignment to an active,
audited Circle. The database verifies the assignment and Circle time window at
the completion timestamp and stores that assignment as durable proof. Member
reflections remain ephemeral. The member's Timeline is the intentional
exception: it stores only Year, Title, and optional Details, with an immutable
version for every edit. The Future Letter itself is never stored; only its
completion marker is retained. Future Ruined Foundations versions default to
requiring both Timeline and Future Letter markers. The already-published
historical version is not rewritten, but the completion guard applies the same
default to future completion attempts on that version. Enrollments completed
before this migration remain historical evidence and are not reopened.

## Circle communication with Google

Ruined remains the member and operator home. Google Chat owns Circle
conversation, and Google Meet owns live gatherings; the portal does not iframe
either product or copy Chat messages into Postgres.

Operators connect a private Chat space to a Circle. An Experience can also use a
manually supplied Meet room as a fallback, but the normal workflow is now
Calendar-owned: **Publish + send invite** creates one private Google Calendar
event, one unique Meet conference, and attendee invitations from the configured
Ruined Workspace organizer. Editing the Experience or changing its roster marks
that same event for reconciliation. A member registration, cancellation, or
automatic waitlist promotion commits in Ruined first and then reconciles that
same invitation; if Google is unavailable, the member's place remains correct
and the durable operator state stays pending for retry. Cancelling an Experience
sends a Calendar cancellation instead of silently deleting Ruined history.

Circle and Block Experiences resolve current, eligible members in the assigned
group. All-member Experiences resolve every current eligible member. Public and
invite-only Experiences invite only confirmed registrations, including guests
who are not members. An explicit
waitlist or cancellation is always excluded, and only a verified primary email
is sent to Google. The private Calendar ledgers store current sync state,
retry-safe operator intent, provider acknowledgement, and per-person
reconciliation evidence. They do not claim that an email reached an inbox and
they never store Google credentials or tokens. Each link permanently records
both the Calendar ID and delegated organizer email so changing server settings
cannot silently move an existing event to another Workspace account.

The existing `integration_entity_links` table continues to store protected
`circle -> chat_space` and `experience -> meet_space` destinations. Member pages
receive only protected Ruined routes. Those routes re-check active membership,
the current Circle or Experience audience, and the approved Google host before
redirecting.

Set `GOOGLE_COMMUNICATIONS_LIVEMODE=false` for test mappings or `true` for live
mappings. An omitted or invalid value exposes no links and rejects operator
writes. Before enabling the controls, apply the complete platform migration so
the Experience, audit, mode-aware integration, and private Calendar sync tables
all exist.

Calendar delivery is independently fail-closed. Keep
`GOOGLE_CALENDAR_ENABLED=false` until the dedicated service account is created,
the Calendar API is enabled, and a Workspace super administrator grants
domain-wide delegation for only `calendar.events.owned`. Configure
`GOOGLE_CALENDAR_ORGANIZER_EMAIL=connect@theruinedproject.com`, keep its Calendar
ID as `primary` unless a dedicated owned calendar is selected, and store the
base64 service-account JSON only in the server environment. This credential is
intentionally separate from the Google Sheets service account. Prove the setup
with a private test Experience before enabling production invitations.

## Membership operating spine

The five ordered operating-spine migrations add these boundaries without
deleting or rewriting existing records:

1. **Person and access:** neutral Person identity, verified email bridges,
   private/public profile separation, dual member/operator roles, and audited
   identity merges.
2. **Lifecycle and agreements:** administrative onboarding, standing,
   cancellation, immutable agreement versions and acceptance
   snapshots, and deterministic database-backed receipts. Checkout attempts
   bind to the acceptance UUID that authorized them.
3. **Community and learning:** closed-by-default directory preferences,
   Circle staff, Circle meetings and other experiences, registration and
   attendance, versioned learning resources, audience targeting, Circle
   resources, and member saves.
4. **Foundations and automation:** versioned Timeline entries, requirement
   markers, member milestones, Artifact awards, internal domain events,
   idempotent workflow actions, and a Person activity ledger. Unlinked public or
   Shopify activity can be attached later through an append-only verified link;
   the source row is never rewritten.
5. **Communication and operations:** targeted announcements, per-member
   notifications and read state, append-only operator notes with separate
   redactions, tasks and task events, constrained overrides, and operator audit
   events.

The additive Shaper and Circle-resource migration retires accountability pairing
without deleting its historical records. It closes active pairs, changes any
pair-only contact preference to private, rejects new pairs, and removes their
member read policy. Circle leadership now uses append-preserving Shaper
assignments, while Circle resources pin an exact published version and are ended
rather than overwritten.

All new public tables enable row-level security and begin with explicit revoked
privileges. Browser-readable tables receive narrowly scoped self or entitlement
policies; operator and worker writes continue through the trusted server
connection. Billing, agreement acceptance, and Foundations completion are not
operator-overridable.

The schema deliberately supplies infrastructure rather than inventing business
facts. It does not seed agreement language, learning content, fulfillment
instructions, event schedules, or announcement copy. Those records must be
published through the operator workflow after approval. The sole approved
Artifact seed is The First Coin v1 and its verified live Shopify binding.

## Operator control surfaces

The operator portal is the working control layer for the member experience:

- `/ops/circles` assigns and ends Shapers, manages Circle membership, and pins
  exact published resources without overwriting history. Accountability pairing
  and promotion-style progression are retired from the active experience.
- `/ops/experiences` creates and publishes events, manages capacity, ordered
  waitlists, roster changes, attendance, cancellation, completion, archive
  history, and permissioned Google Calendar invitations with a unique Meet.
- `/ops/academy` creates immutable learning versions, collections, audiences,
  video sources, captions, downloads, publishing, unpublishing, and retirement.
- `/ops/artifacts` manages immutable templates, exact live Shopify bindings,
  retry-safe awards, production work, fulfillment, tracking corrections, and
  delivery reconciliation across the shipment, award, job, and member state.
- `/ops/members/[memberId]` supports targeted profile corrections under operator
  authorization. Private profile reads and changed field categories are audited;
  private values are not copied into audit evidence.
- `/ops/announcements` publishes audience-targeted member communications, while
  `/ops/notifications` sends retry-safe in-app notifications to all active
  members, one Block, one Circle, or one member and shows delivery/read state.

Every mutation re-checks the operator's current server-side role and scope.
Direct member reads remain protected by row-level security, and former, unpaid,
or administratively incomplete members cannot read member updates.

### Artifact products

An earned Artifact remains a Ruined membership record, while Shopify remains the
product catalogue. A published `artifact_template_versions` record may bind the
two inside its immutable `production_specification`:

```json
{
  "shopify": {
    "product_gid": "gid://shopify/Product/123456789",
    "product_handle": "the-first-coin"
  }
}
```

The Product GID is the durable identity; the handle is only a route snapshot.
Member pages resolve the GID against the current live Storefront catalogue and
use Shopify's current handle and featured image. Missing, unpublished, or
unconfigured products leave the Artifact visible but produce no storefront link.
Do not publish the binding until the Shopify product exists. The first approved
Artifact is **The First Coin**, described as **A hand-forged artifact.**

A Block is the layer above a Circle: one Block contains multiple current
Circles. It helps operators organize the membership but adds no Foundations
gate. A Block cannot activate with fewer than two current Circles. If later
changes leave it below that minimum, it closes automatically while every prior
Circle relationship remains in history. Members can see only their own Block's
name and state; they cannot enumerate its other Circles or members.

The initial operator records and role grants must be provisioned internally
before `/ops` is connected. Do not enable open operator account creation.

## Connect Stripe

Use test mode first. Configure the server-only Stripe variables in
`.env.example`, create the approved recurring Price, register the signed webhook
events in `docs/stripe-integration.md`, and keep `STRIPE_TAX_ENABLED=false` until
registrations, origin, product tax code, and Price tax behavior are confirmed.

Checkout is available only when Supabase, Postgres, and all required Stripe
configuration are present. It derives the member and email from verified
identity and uses the server-configured Price at quantity one. `invoice.paid`
for that recorded membership subscription is the canonical activation event.

## Production gates

- Approve membership amount, currency, cadence, cancellation, refund, renewal
  failure, grace-period, and chargeback rules.
- Approve the 16+ age/consent policy and versioned agreement text.
- Configure Supabase custom SMTP and test OTP delivery, expiry, reuse, and
  account recovery.
- Before applying the membership migration, audit every legacy Circle marked
  `active`, `completed`, or `archived`. Each must have its real start time,
  activation time, activation actor, and any required end time. Do not invent
  missing evidence; remediate it from an authoritative operational record.
- Drain member and operator writes before starting the entire
  `npm run db:migrate:platform` command, and keep them drained until it exits.
  This includes the one-time historical replay. The membership migration takes
  one fail-fast `ACCESS EXCLUSIVE NOWAIT` lock across the affected tables; a
  lock conflict aborts the run instead of waiting behind live traffic.
- Apply the migrations in a non-production environment first and test every
  role, assignment boundary, lifecycle transition, rollback path, and legacy
  Circle preflight before scheduling the production maintenance window.
- Deploy dual-write application code before making the nullable Person and
  Checkout acceptance bridges mandatory. Observe legacy/open records, backfill
  from authoritative evidence, then enforce `NOT NULL` in a later cutover
  migration rather than changing an applied migration.
- Configure Stripe Tax only after registrations and tax treatment are approved.
- Add final Foundations content and Artifact templates as approved versions;
  never overwrite a version already used by a member or production job.
- Keep the production dependency audit at zero before release. The current
  Next.js 15.5.24 tree resolves the prior nested Sharp advisory without a major
  framework migration; rerun `npm audit --omit=dev` after every lockfile change.
