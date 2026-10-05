# Ruined Stripe integration

Stripe handles membership billing and consulting invoices. Shopify remains the retail checkout system. This guide describes the current local implementation; it does not establish that code, migrations, terms or settings are deployed.

**Release hold:** keep `STRIPE_MEMBERSHIP_COMMERCIAL_READY=false` in deployed environments until the provider and release checks below pass. This blocks new paid membership in both sandbox and live mode. Six-offer Checkout, founding eligibility, couples access, commitments, online cancellation and expanded renewal notices are implemented locally. See [release readiness](membership-release-readiness-2026-09-28.md) for deployment evidence and [policy setup](stripe-policy-setup-2026-09-28.md) for terms, catalog readbacks and unresolved tax requirements.

## Offers and Price configuration

All six offers use USD, tax-exclusive, licensed, per-unit recurring Prices, quantity one and interval count one. Payment starts at signup without a trial. Annual membership is prepaid; monthly membership has 12 initial installments and continues monthly afterward.

| Offer ID | Recurring price | Initial term before tax | Optional Price override |
| --- | --- | --- | --- |
| `individual_monthly` | $499/month | $5,988 in 12 payments | `STRIPE_MEMBERSHIP_INDIVIDUAL_MONTHLY_PRICE_ID` |
| `individual_annual` | $4,990/year | $4,990 upfront | `STRIPE_MEMBERSHIP_INDIVIDUAL_ANNUAL_PRICE_ID` |
| `founding_individual_monthly` | $349/month | $4,188 in 12 payments | `STRIPE_MEMBERSHIP_FOUNDING_INDIVIDUAL_MONTHLY_PRICE_ID` |
| `founding_individual_annual` | $3,490/year | $3,490 upfront | `STRIPE_MEMBERSHIP_FOUNDING_INDIVIDUAL_ANNUAL_PRICE_ID` |
| `couple_monthly` | $699/month | $8,388 in 12 payments | `STRIPE_MEMBERSHIP_COUPLE_MONTHLY_PRICE_ID` |
| `couple_annual` | $6,990/year | $6,990 upfront | `STRIPE_MEMBERSHIP_COUPLE_ANNUAL_PRICE_ID` |

`getMembershipPriceConfiguration()` selects `LIVE_MEMBERSHIP_PRICE_IDS` or `SANDBOX_MEMBERSHIP_PRICE_IDS` in [membership-catalog.ts](../src/lib/stripe/membership-catalog.ts) from the server key's mode. Each nonempty override above replaces only its matching entry. Another Stripe account or sandbox needs its own six overrides. The server retrieves the Price and verifies mode, active status, amount, currency, tax behavior and recurrence; different offers cannot share one Price ID.

The earlier `STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID` and `STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID` remain required by readiness configuration and support earlier consent, invoice recognition and legacy annual notices. They do **not** override v2 offers. Optional `STRIPE_MEMBERSHIP_PRICE_ID` recognizes older subscriptions only. Retain mappings required by existing contracts; configuration changes do not migrate their terms.

## Offer, consent and access flow

Authenticated `/my/join` requests a server-selected offer from `/api/stripe/membership-offer` before displaying price and payment consent. Founding eligibility counts current active registered people, paid and complimentary, plus completed registrations awaiting first membership activation, deduplicated by person. A completed eligible saved-card registration now pins its individual Founding decision before paid activation; see [registration confirmation](member-registration-launch.md#founding-confirmation-at-completed-registration). Continuous founders retain their awarded rate as membership grows; cancellation ends that membership spell and rejoining requires a fresh decision. Historical member numbers do not determine eligibility.

Concurrent Checkout holds preserve an accepted founding place without counting as completed registrations or active members. When the last place is held but fewer than 50 people are active or awaiting activation after completed registration, another signup receives `409 founding_place_pending` and a retry option, not a standard-price quote. Complimentary final activation also waits for the hold to resolve. Couples require two named adults with separate verified accounts, complete US profiles, age attestations and current paid-agreement acceptances. The payer shares a targeted link from `/api/stripe/couple-authorization`; the signed-in partner explicitly approves it. No invitation email is sent. Both people count toward membership and receive access from the shared subscription.

Quotes last 60 minutes and show their exact deadline. Starting Checkout during that window stores an expiry at least 31 minutes from creation to satisfy Stripe's session minimum; retries reuse it. Unused quotes can expire or be released. A payment attempt requires confirmed terminal provider status before releasing its hold; a local timeout cannot justify a second charge. Uncertain creates beyond the 23-hour replay window require reconciliation.

The member reviews the actual price, initial total, renewals, tax and capped replacement-fee rule, then checks fresh payment consent. Checkout binds the quote/reservation ID, matching attempt ID, current agreement acceptance and server-selected Price. Immutable `membership-billing-v2` consent records the offer, amount, initial 12-month total, $1,500 cap and participants. Metadata carries the same version, offer and reservation. One open attempt per member and stable Stripe idempotency keys protect retries; an earlier Checkout cannot silently adopt v2 terms.

Embedded Checkout uses Dashboard-managed dynamic payment methods, requires a billing address and restricts shipping-address collection to the US. Saved profiles must also be US-based. V2 invoice verification independently requires a US billing address; shipping restrictions alone do not restrict billing country. Verify both address paths in sandbox. Only a matching, fully paid, provider-verified invoice activates membership and creates the accepted commitment; the success redirect cannot grant access. Couples billing state reaches both approved participants. Complimentary/pilot access never automatically authorizes payment.

## Portal and cancellation

Both explicit portal configurations must be active, match the environment, permit invoice history/payment-method updates and disable plan changes:

| Variable | Cancellation policy |
| --- | --- |
| `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` | Earlier contracts: period-end cancellation, `proration_behavior=none`. |
| `STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID` | V2 contracts: Stripe cancellation disabled; use My Ruined → Account. |

The authenticated portal route derives the customer from the member and checks provider subscriptions before allowing legacy controls during a delayed v2 webhook. It never falls back to an account default. Disable shared hosted portal login pages that expose cancellation; the readiness checker scans active configurations for this commitment bypass.

`/api/stripe/cancellation` quotes the exact access/end date and fee before explicit confirmation. Turning off renewal is free: initial monthly obligations continue through their term; annual and later monthly access lasts through the paid period. Initial-term early exit replaces unpaid remaining installments with the lower of that balance or $1,500, plus applicable tax, preserving already-paid access.

Fee handling requires `STRIPE_MEMBERSHIP_BUYOUT_READY=true`; automatic tax additionally requires the reviewed `STRIPE_MEMBERSHIP_BUYOUT_TAX_CODE`. Keep the fee gate false until classification and provider tests pass. Separate no-fee renewal cancellation remains available.

Early-exit quoting reads subscriptions, customer/cash balances, invoices, invoice payments, PaymentIntents, charges, refunds, credit notes and pending invoice items. Unpaid/partial or adjusted invoices, refunds, disputes, balances, pending items, schedules, pauses or changed evidence require billing review. Confirmation rechecks evidence and stops ordinary future installments before creating one exact replacement invoice. It excludes unrelated items and discounts, uses `auto_advance=false`, and verifies final fee/tax totals. Payment is a separate action on Stripe's Hosted Invoice Page. Failed fee payment does not restore replaced installments; a fee invoice cannot activate membership.

## Environment and restricted-key permissions

Use matching sandbox `rk_test_…` and `pk_test_…` credentials, with separate live secrets. Prefer a restricted server key. Only `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` belongs in browser configuration; keep server keys and webhook signing secrets outside source control and logs.

These capabilities follow the current SDK calls. Grant the applicable restricted-key scopes and verify the actual key against each flow; a successful Price read alone is insufficient.

| Capability | Operations used |
| --- | --- |
| Checkout Sessions | Create and retrieve. |
| Prices | Retrieve all six configured Prices. |
| Customers / cash balance | Retrieve, including cash-balance expansion; allow customer creation through Checkout. |
| Subscriptions | Retrieve/list and update cancellation timing. |
| Customer Portal | Retrieve/list configurations and create sessions. |
| Invoices | Retrieve/list/preview; create, finalize and void replacement-fee invoices. |
| Invoice Items | List pending items and create the replacement-fee line. |
| Invoice Payments | List by invoice and payment for settlement and adjustment mapping. |
| PaymentIntents / Charges | Retrieve, including expanded latest-charge evidence. |
| Refunds / Credit Notes | Read/list adjustment evidence; no refund or credit-note creation. |
| Tax Calculations | Create fee calculations when tax is enabled. |
| Tax Registrations | Read active registrations for tax readiness. |
| Webhook Endpoints | Read/list for the readiness checker. |

The sandbox smoke harness also reads the Stripe Account to verify the intended account. Runtime does not create catalogs, change portal configurations, issue refunds or create charges directly. Provider-read failures must not bypass settlement checks or produce a guessed cancellation balance.

Configure `DATABASE_URL`, Supabase account/session settings, `NEXT_PUBLIC_SITE_URL`, matching Stripe keys, the destination-specific `STRIPE_WEBHOOK_SECRET`, earlier monthly/annual Price variables, needed six-offer overrides, both portal IDs and the exact `STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION`. Keep commercial, live, fee and renewal-email gates false during setup.

Apply reviewed migrations with `npm run db:migrate:platform` against the intended environment. Publish the separately reviewed, hashed agreement using `scripts/publish-membership-agreement.mjs`, beginning with its read-only dry-run before an authorized `--apply`. Publication immediately changes the current agreement for incomplete onboarding; historical agreements, acceptances, receipts and complimentary rights remain intact. Do not manually replace agreement rows or pre-accept terms for members.

With secrets supplied securely, run:

```sh
node --env-file=.env.local scripts/check-stripe-membership.mjs
```

This read-only check inspects all six Prices, the webhook destination, both portals, hosted-login bypasses and applicable tax registrations, plus commercial/fee flags. A closed release gate intentionally reports not ready. It does not prove migration/publication status, every restricted permission, email delivery or deployment success.

## Tax and published terms

Applicable tax is added to the advertised price. Before enabling `STRIPE_TAX_ENABLED`, verify the business origin, actual state registrations, membership Product classification and separate early-exit fee classification. An EIN, Utah LLC or Shopify tax collection does not verify a state sales-tax permit or transfer registrations into Stripe. Test collecting and non-collecting US addresses; zero tax alone does not establish exemption. Webhooks record `automatic_tax.disabled_reason` for follow-up.

Publish and verify `/membership/agreement/ruined_membership-vN`, then set that exact URL in the environment's Stripe public terms setting and applicable portal profiles. Checkout requires Stripe's terms checkbox in addition to app payment consent. `/terms` remains the store policy; `/api/my/agreement/receipt` is private. A no-charge pilot or unpublished URL cannot substitute for paid authorization.

## Webhook destination

Register `/api/stripe/webhook` with API version `2026-08-26.dahlia` and all 20 events:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
invoice.paid
invoice.payment_failed
invoice.payment_action_required
invoice.voided
invoice.marked_uncollectible
customer.subscription.updated
customer.subscription.deleted
credit_note.created
credit_note.updated
credit_note.voided
charge.refunded
charge.dispute.created
charge.dispute.closed
refund.created
refund.updated
refund.failed
```

The handler verifies raw-body signatures and version/mode, durably claims event IDs, ignores processed duplicates and prevents stale state projections. Older endpoint versions require coordinated cutover. V2 activation checks subscription/Price/quantity, full payment, consent, commercial participants and fresh provider settlement evidence. Zero, partial, mismatched, adjusted or disputed payments cannot establish a new activation. Refund, credit-note and dispute events invalidate cancellation-ledger evidence for reconciliation. Consulting, replacement-fee and unrelated invoices cannot activate access.

## Renewal notices and release verification

The default-off `/api/internal/stripe/renewals/process` worker covers all three annual offers, all three initial monthly commitment anniversaries and configured earlier standard annual subscriptions. It queues 40- and 20-day notices, deduplicates durably, previews dues/tax and rechecks cancellation before sending. Monthly notices distinguish the initial-term end from the next monthly bill; they do not promise a new annual commitment. Missed windows, changed evidence and uncertain delivery produce explicit retry/manual-review states.

Verify the deployed daily job recorded in `vercel.json`. Configure `CRON_SECRET`, `RESEND_API_KEY`, verified `RESEND_FROM_EMAIL`, HTTPS site origin and the applicable portal. Sandbox notices require `STRIPE_MEMBERSHIP_RENEWAL_TEST_RECIPIENT` and go only to that approved inbox. Keep `STRIPE_MEMBERSHIP_RENEWAL_EMAILS_ENABLED=false` until delivery and queue operation are verified. Review native Stripe renewal emails to avoid duplication. Smart Retries, dunning, receipts and payment methods remain provider settings.

Consulting invoices are created manually in Dashboard and paid through the Hosted Invoice Page. Use `ruined_context=consulting` for app reconciliation; these invoices never authorize membership.

Before releasing paid membership:

- Resolve tax registration/classification, publish the reviewed terms and configure Stripe terms URLs.
- Apply migrations and deploy the intended members environment; verify authentication, couples approval, published terms and responsive member controls.
- Verify all six Prices, both portal policies, shared-login restrictions, the 20-event destination and restricted-key permissions.
- Complete sandbox Checkout with signed webhooks, duplicate/retry handling, couples access, payment failure, renewal delivery, both cancellation paths, adjustment review and hosted fee payment.
- Enable fee and renewal gates only after their checks pass. Release commercial checkout deliberately; live mode additionally requires `STRIPE_MEMBERSHIP_LIVE_ENABLED=true`. Existing contract management and webhook reconciliation remain available while new purchases are held.

Local real-schema, runtime and UI tests cover these flows; `npm run check` runs the repository checks. They do not replace provider acceptance testing or prove a live deployment.
