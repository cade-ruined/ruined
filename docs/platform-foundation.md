# My Ruined platform foundation

This increment establishes two private application surfaces:

- `/my` for a member's next action, Foundations, Circle, Artifacts, and account.
- `/ops` for internal member, Circle, and integration visibility.

The local preview is intentionally read-only. It uses fixture data only outside
production, displays a persistent preview marker, and disables account access,
payment, billing management, and persistence. Missing
production configuration fails closed; it never becomes preview mode and never
creates a fake session.

## System boundaries

Each system has one job:

1. **Supabase Auth** verifies passwordless identity.
2. **Postgres** owns the canonical member ID, roles, lifecycle, Circle,
   Foundations, Artifact, consent, and integration state.
3. **Stripe** owns payment and subscription facts. Only verified webhook events
   update billing state; a Checkout redirect never activates membership.

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

   This applies the Stripe billing migration followed by the platform migration.
4. Configure custom SMTP before production. The default Supabase mail service is
   suitable only for limited testing.
5. Configure the passwordless email template to show the code using
   `{{ .Token }}`. The app accepts Supabase's supported six-to-ten-digit email
   OTP range, not a one-click link.
6. Set `PLATFORM_MODE=connected`. The server will still show the unavailable
   state unless both Supabase public configuration and `DATABASE_URL` exist.

Member sign-in lives at `/my/access`; operator sign-in lives at `/ops/access`.
Member accounts are linked to a stable Ruined member ID after verified email
access. Creating that identity leaves the program at `prospect`; it does not
activate membership. In connected mode, Foundations, Circle, and Artifacts are
server-gated until the member has active account, billing, and onboarding state.
Operator permissions are app-owned database roles, not editable profile
metadata. Circle leaders and guides see assigned members only; an active
`ops_admin` can see all members.

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
- Apply the migrations in a non-production environment and test every role,
  assignment boundary, lifecycle transition, and rollback path.
- Configure Stripe Tax only after registrations and tax treatment are approved.
- Add final Foundations content and Artifact templates as approved versions;
  never overwrite a version already used by a member or production job.
- Migrate and retest the application on Next.js 16.3.1 or later before a live
  release. The current Next.js 15 dependency still installs Sharp 0.34.5, which
  the production dependency audit flags for active high-severity libvips
  advisories; npm's supported fix crosses that major-version boundary.
