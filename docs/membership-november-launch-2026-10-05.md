# November 1 membership billing release

Prepared October 5, 2026. This record separates implemented behavior from verified production release. Update the completion fields below after each check; an unchecked item is not evidence of completion.

## Authorized behavior

Members may confirm paid membership ahead of time. Their first charge is **November 1, 2026 at 12:00 a.m. America/Denver**, equivalent to **2026-11-01T06:00:00Z**. Advance confirmation charges **$0 today**. A saved card or registration alone never starts billing; every payer must separately accept the published agreement, review the server-issued offer and date, and explicitly confirm recurring payment through Stripe.

The paid initial term is 12 months. Monthly plans pay 12 installments, then renew monthly; annual plans pay upfront, then renew annually. Successful payment and manual profile release remain separate. Neither advance confirmation nor a return from Checkout opens a held profile.

A confirmed cancellation before the first charge ends the scheduled subscription with no fee or remaining-installment obligation. The registration and its confirmed founding eligibility remain recorded. A member may explicitly review a new offer after a verified prestart cancellation; a new checkout still requires fresh payment consent. Provider uncertainty or an invoice race requires review and never produces a false cancellation confirmation.

## Reviewed agreement and prices

| Item | Reviewed value |
| --- | --- |
| Agreement version | `ruined_membership-v2` |
| Public version route after publication | [/membership/agreement/ruined_membership-v2](https://members.theruinedproject.com/membership/agreement/ruined_membership-v2) |
| Exact reviewed source | [membership-paid-agreement-v2.md](membership-paid-agreement-v2.md) |
| Reviewed source SHA-256 | `15f7888d5e741a20767d3a1ece5c850c2eee43f9d78075e1484dea00b3740a6f` |

| Membership | Monthly installment | Initial monthly-plan total | Annual payment |
| --- | ---: | ---: | ---: |
| Individual | $499 | $5,988 | $4,990 |
| Founding individual, when eligible | $349 | $4,188 | $3,490 |
| Couples, two named adults | $699 | $8,388 | $6,990 |

All prices are USD before applicable tax. The UI renders the exact published agreement, including its price table, without changing its stored text or acceptance hash. This document does not change the reviewed terms.

## Implementation

- `/my/activate` is accessible while a registration is held. It shows agreement review, the selected offer, the first-charge date, a fresh unchecked payment authorization, and persisted billing status. Existing registration and profile restrictions remain intact.
- Offer reservations and checkout consent record an immutable first-charge date. Stripe Checkout uses the future billing anchor with no prorations. After November 1, new purchases use immediate checkout rather than a past anchor.
- Completed, verified Stripe events create the scheduled commitment. A paid membership invoice remains necessary for paid billing activation. The return URL is only a request to refresh the recorded state.
- Scheduled, pending-payment, active, canceled and review-required states are distinguished. The displayed initial commitment end date comes from the accepted contract.
- Prestart cancellation uses the existing quote/confirm endpoint and verified provider cancellation. Only a durable prestart cancellation enables the new-offer action; ordinary canceled subscriptions do not receive that shortcut.
- The commitment billing portal provides invoices and payment-method management. Commitment cancellation stays in Ruined's billing controls. Public agreement navigation links to `/my/activate`, so held members can reach those controls.
- [20261005190000_membership_first_charge.sql](../db/migrations/20261005190000_membership_first_charge.sql) adds the required date and cancellation handling without releasing profiles or enrolling saved-card registrations.

## Release record

| Item | Status at preparation |
| --- | --- |
| User decision | Confirm ahead of time; first charge November 1 at midnight Mountain Time |
| Commitment portal | Created: `bpc_1UNH8n4cnqzISerX7QOFC6bs` |
| Legacy hosted portal login | Disabled |
| Additive production migration | Applied; all 82 earlier migration checksums matched. New migration SHA-256 `de272d68391396ba557c287cb1a16ae07916a7087df6e8d8c353c720ac6cceec`. |
| Paid agreement publication | Published as `4af5dd69-d058-4f14-93d3-7f79e6f08a2c`; exact reviewed SHA verified; all 5 prior acceptances and 5 receipts unchanged. |
| Activation release flags | Not enabled |
| Production deployment | Pending release owner update |
| Production signed-in checkout smoke check | Pending release owner update |
| Completed sandbox Checkout and webhook lifecycle | Actual embedded Checkout completed with $0 / no_payment_required; pinned-API snapshots signed locally processed through full application schema. No-charge cancellation and fresh offer passed; synthetic customer deleted. |

The portal state above is reported by the release owner. No production charge, automatic enrollment, profile release or completed deployment is implied by this preparation record.

## Required release checks

- [x] Confirm additive migration completion and the production migration ledger.
- [x] Publish the exact reviewed agreement as `ruined_membership-v2`; verify stored body and SHA-256. Public route readback follows deployment.
- [x] Verify the reviewed portal configuration and that alternate hosted login cannot bypass commitment cancellation.
- [ ] Deploy the verified commit and record deployment URL and revision.
- [ ] Set the first-charge timestamp to `2026-11-01T06:00:00Z`; enable the reviewed commercial, live, buyout and activation gates only after their checks pass. Keep registration/profile release separate.
- [ ] Run activation-specific Stripe readiness checks and record the result. Ordinary checkout readiness is a separate target.
- [x] Verify desktop and mobile views and no held-profile access.
- [x] Verify completed sandbox Checkout, locally signed pinned-API snapshots, $0 before start, first paid invoice behavior and prestart cancellation. Original sandbox events use an older API version and are correctly rejected. This does not claim original Stripe webhook delivery or a real payment.
- [ ] Verify the live member entry route, agreement link, date and price disclosures with no real charge initiated during verification.
- [ ] Record any remaining blocker accurately; do not mark release complete based on source tests alone.

## Validation and evidence

Scoped implementation checks completed: **76 affected UI/access/signup tests passed**, plus a real Timeline persistence regression confirming that the narrow agreement guard did not add a dependency to unrelated repository reads. Scoped TypeScript, lint and diff checks passed. The release owner must fill in the final full-suite, build, deployment and production results below.

| Final check | Result |
| --- | --- |
| Full automated suite | 2,196 passed; zero failures or skips. |
| Production build | Passed; TypeScript and ESLint passed. |
| Browser QA: desktop/mobile | Passed: agreement table, unchecked exact-date offer, scheduled amount/end date, cancellation and 390px layout without horizontal overflow. |
| Provider lifecycle validation | Full first installment at simulated anchor; no invoices before start or after prestart cancel. Paid-term fee cap/remaining balance and no future renewals passed. |
| Deployed revision and URL | Pending |
| Production readiness | Pending |

External evidence is stored outside this worktree in `../../outputs/membership-november-launch/`. It is not copied into this document. Relevant files are `provider-sandbox-check.json`, `production-before.json`, `migration-before-apply.json`, `migration-audit.json`, `typecheck.log`, `lint.log`, `build.log`, `full-test-release.log`, and `activation-desktop.jpg`. The earlier `full-test.log` records an initial failing run and must not be used as the final test result. Final screenshots and deployment evidence may be added there by the release owner. Do not add secrets or member records to this report.

Renewal notification evidence: all 10 queue/policy/dispatch tests passed; the production Resend sender domain is verified and sender/key/cron configuration exists. No renewal email was sent during this release, so new renewal-template inbox delivery remains unverified. No new contracts are due for renewal at launch.
