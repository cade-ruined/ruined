# Member onboarding checkpoints

Operations now shows email verification, registration information, payment information, payment received, and profile access separately, followed by one next action. Registrations, the member directory, member records, and system registration tasks use the same evidence model.

## Evidence and exceptions

- A saved card does not mark payment received. Normal paid Checkout can satisfy payment-information collection without a separate SetupIntent record.
- Payment uses the existing account/mode/participant/invoice/refund-validated proof. Historical or uncertain billing is flagged for review before requesting another payment.
- Current complimentary funding marks payment checkpoints Not required. Shared memberships get one payment task for the payer.
- Legacy profiles retain access. Unknown historical dates remain unknown. This presentation does not grant access or initiate billing.
- The profile-release selector recommends only rows whose next step is profile access; existing backend authority, version checks, and explicit confirmation remain required.

## Queue and deployment

Apply `20261008100000_registration_checkpoint_work.sql` before releasing the application. It adds a private RLS-protected ledger and makes no member changes. The existing five-minute worker creates enrollment follow-ups from the next checkpoint, including incomplete registrations that never saved a card.

Existing billing tasks are adopted with their IDs, claims, and history. Operator completion/cancellation remains durable. When evidence changes, the system resolves obsolete work with an audit event; manual tasks are untouched. Task completion itself does not charge, release access, or send a member email.

After deployment, verify a no-card registration receives a payment follow-up and that existing saved-card tasks retain their identities and claims. Existing payment/profile completion records must remain unchanged.

## Validation before release

- 2,515 tests passed, including actual reader SQL and task reconciliation against PGlite, shared billing, complimentary changes, refunds, claim preservation, stale selections, and access controls.
- Lint, TypeScript, and production build passed.
- Offline native-consent/prepayment harness passed against the full migration schema; no provider calls or charges.
- Local desktop and 390px registration UI checked; filters and unpaid-profile selection checked. Member next-action links use native same-page anchors so billing/journey panels reveal correctly; browser-checked with sample evidence, including the full checkpoint display.
- Read-only production evidence confirmed Aaron has no payment information, while Geoff and Tanner have saved payment information. All three still require payment. A dry run found 22 eligible registrations: 13 payment, eight information, one profile-access follow-up.

Hosted CI, migration, deployment and live queue reconciliation are checked during release; local success alone is not proof of production completion.
