# Stripe membership setup — September 28, 2026

## Current owner instructions

The owner revised the offer after the original no-fee portal setup. The new offer
supersedes the earlier $5,040 annual price and cancellation-without-a-fee launch
specification. Membership is for the United States, with applicable tax added at
checkout. There is a one-year minimum commitment. Early exit costs the lower of
$1,500 or the unpaid installments remaining in that initial commitment. The owner
confirmed that the charge replaces those installments and is capped at the
remaining balance; it is not added to them.

| Membership | Monthly payments | Annual payment upfront | Initial 12 monthly payments |
| --- | --- | --- | --- |
| Individual after the first 50 | $499 | $4,990 | $5,988 |
| First-50 individual, grandfathered | $349 | $3,490 | $4,188 |
| Couple | $699 | $6,990 | $8,388 |

Amounts are USD before applicable tax. Each annual price equals ten monthly
payments. Annual prices are paid upfront; the comparison is not an installment
schedule. Working assumptions disclosed to the owner: the minimum applies to the
initial 12 months, and couples receive two named adult memberships on one bill.

The owner also clarified that the first 50 means active registered users, paid or
complimentary. Cancellation ends founding benefits when membership ends. A returning
member must qualify again at rejoining; old founding status does not automatically
restore benefits. The owner confirmed that eligibility uses the current active
registered-user count when joining or rejoining: a place is available when fewer
than 50 other registered members are active, and places reopen when the active
count falls below 50. Complimentary members count without a payment requirement;
each registered person in a couple counts separately. These commercial answers are
recorded in the paid agreement. Allocation must be atomic under concurrent joins.
Do not use permanent historical member numbers as automatic eligibility, or silently
change the rate of a continuously active founding member as totals grow.
No eligibility or fee automation has been enabled by recording these decisions.
No existing pilot acceptance authorizes a paid contract or termination fee.

A new offer holds its quoted price for 60 minutes and displays the exact expiry.
Temporary pending payment holds can require another applicant to retry; they must
not alone produce a standard-rate quote while the active registered count is below 50.
A Checkout started before the offer deadline receives at least 31 minutes, recorded
once in its durable attempt so all retries use the same Stripe expiry. Unresolved
payment attempts retain their hold until confirmed terminated; abandoned quotes
with no payment attempt release after their disclosed expiry.

## Completed in live Stripe

Account: `acct_1U6AS14cnqzISerX`. Product: `prod_VKI6UIjkiDot2O`.
All six prices were independently read back and have `tax_behavior=exclusive`.
This specifies how tax is added; it does not itself enable tax collection.

| Tier / cadence | Stripe Price |
| --- | --- |
| Individual monthly | `price_1UJdWe4cnqzISerX5M3cmhmg` |
| Individual annual | `price_1UKj3o4cnqzISerXU0XE4XqR` |
| Founding individual monthly | `price_1UKj3t4cnqzISerXN7qIIjlp` |
| Founding individual annual | `price_1UKj3x4cnqzISerXDPcIzYTq` |
| Couple monthly | `price_1UKj404cnqzISerXnzOBEcus` |
| Couple annual | `price_1UKj444cnqzISerXAglLehVo` |

The superseded $5,040 annual price `price_1UJdWj4cnqzISerXbldILtgj` is archived.
No subscription was migrated, customer charged, or existing contract rewritten.
The exact readback is saved in the workspace's
`outputs/membership-terms/stripe-revised-prices-2026-09-28.json`.

The Ruined sandbox product `prod_VJySLt1C1jofdb` now mirrors all six prices and tax
behavior, independently read back. Standard monthly remains
`price_1UJKWj9rQIwIEzKeJ9okUjcw`; standard annual is now
`price_1UKjCf9rQIwIEzKeLeraUnRw`. The ignored local sandbox environment's annual
Price ID was updated without changing credentials. Founding monthly/annual are
`price_1UKjCj9rQIwIEzKeoNSBIVEq` / `price_1UKjCm9rQIwIEzKe8KR9v0eV`; couple
monthly/annual are `price_1UKjCp9rQIwIEzKegrbFc8Y2` /
`price_1UKjCt9rQIwIEzKeConBClmk`. The old sandbox $5,040 annual price is archived.
Readback: `outputs/membership-terms/stripe-revised-sandbox-prices-2026-09-28.json`.

## Legacy and commitment billing portals

The live portal configuration `bpc_1UKifa4cnqzISerXTqs4WXt5` was created under the
previous period-end policy. It enables invoices, payment-method updates and
end-of-current-billing-period cancellation without proration. Subscription changes,
pauses, mandatory cancellation reasons and customer identity changes are disabled.
Its privacy URL is `https://theruinedproject.com/privacy`; its membership terms URL
is unset. Hosted login: https://billing.stripe.com/p/login/6oU6oA8Zme795uI5Mibwk00.

**This configuration does not enforce the new annual commitment or early-exit fee.**
A monthly period-end cancellation ends a monthly subscription. Do not use it as
proof that the new minimum term is implemented, and do not silently add a fee from
a cancellation webhook. The implemented local flow distinguishes stopping future renewal
from buying out the initial commitment, shows the exact obligation before consent,
and provides online cancellation with retained paid access. Existing member
terms must remain applicable to their own subscriptions.

The sandbox configuration `bpc_1UJKXr9rQIwIEzKedmvGlTuD` belongs to
`acct_1U6AS79rQIwIEzKe`; it has the same earlier period-end settings. Never pair a
live configuration ID with test credentials. The local sandbox harness has the
sandbox ID; production credentials/settings have not been switched.

The separate commitment portal is created and read back in the sandbox as
`bpc_1UKkLr9rQIwIEzKeqBefDPDr`. It permits invoice history and payment-method updates;
native cancellation, plan changes and hosted login are disabled. The account
cancellation flow handles accepted commitments instead. Its non-secret readback is
`outputs/membership-terms/stripe-commitment-portal-sandbox-2026-09-28.json`.
The ignored sandbox environment now contains this configuration ID.

Before paid launch, create the matching live commitment configuration and disable
the old live public portal login link: that shared link can otherwise expose the
legacy cancellation controls to new commitment customers. Authenticated legacy
member sessions can still select the existing legacy configuration explicitly.
The local readiness script checks this bypass; the application also verifies
Stripe subscriptions before routing a customer whose first invoice webhook has
not yet created its local commitment.

## Tax setup

Live Tax status is active with a Utah origin, but Stripe has no tax registrations.
The account-wide default code is `txcd_99999999` (general physical goods), and the
membership product has no explicit classification. Leave unrelated store defaults
alone. The owner confirmed a Utah LLC, an EIN and Shopify collection in Utah only,
but answered that the separate sales-tax permit is unknown. Do not treat this as
proof that a permit exists or that Ruined is definitely unregistered.

Check the existing Utah TAP business account and license email for an issued Sales
and Use Tax account. If none exists, apply through Utah's TC-69 registration flow;
the Utah LLC registration and EIN do not replace it. No state application or Stripe
registration has been submitted. Check combined business activity when assessing
registrations; Stripe-only volume is not the whole store.
The current mixed membership needs a product classification under current law.
Utah's July 1, 2026 digital/streaming changes make old streaming-exemption advice
unreliable. See `membership-tax-review-2026-09-28.md`.

Do not add assumed registrations or turn on automatic tax as a substitute for
resolving registration and classification. The exclusive price behavior is ready
for the eventual verified tax setup.

## Email, legal links and browser access

Supported Browser access was subsequently restored in the live Ruined account.
The earlier security-policy refusal was not bypassed. The following Dashboard
settings were saved and verified; successful-payment and refund receipts were
also verified after reload:

| Setting | Verified state |
| --- | --- |
| Successful-payment receipts | On |
| Refund receipts | On |
| Expiring-card emails | On |
| Failed card-payment emails | On |
| Failed bank-debit-payment emails | On |
| Payment-method update destination | Stripe-hosted page; obsolete mixed-link mode pointing all links to the main website was replaced |
| Include manage-subscription link | On; custom destination `https://members.theruinedproject.com/my/account` |
| Hosted payment-confirmation emails | On |
| Payment-confirmation reminders | Existing 3-, 5- and 7-day reminders remain on |
| Finalized invoices and credit notes | Already on; retained |
| Native upcoming-renewal emails | Off before and after the update |
| Upcoming-renewal event timing | Existing 7-day timing retained; this is an event setting, not an enabled renewal email |

Retries, incomplete-payment/cancellation statuses, dispute handling and trial
flags were not changed. No test email was initiated, and these
switches do not establish successful delivery or implementation of the new
commitment and cancellation model.

The privacy URL `https://theruinedproject.com/privacy` and explicit public support
email `cade@theruinedproject.com` were saved and verified in Public details, with
the exact privacy URL read back after reopening the form. The paid terms URL remains empty because no
paid agreement is published. This support-setting update does not rewrite the
contact address in existing agreements or acceptance records.

Checkout now displays annual prices in annual terms and shows the support email.
Support phone and website display remain off. Legal-policy display remains off:
Stripe explicitly requires both a terms URL and privacy URL before displaying
the links. After the final paid terms URL is published and configured, enable
that display and verify the integration's required affirmative checkbox. Store
refund-policy display remains off; promotional-email terms were not accepted.
No cancellation-confirmation switch was available on the inspected billing page.

The management URL loaded the live Account page under the existing signed-in
complimentary membership, with pilot v1 still shown. This verifies the route,
not the pending paid-member cancellation behavior or email delivery.

Workspace screenshot evidence, outside this repository:

- `outputs/membership-terms/stripe-billing-notifications-saved-2026-09-28.png`
- `outputs/membership-terms/stripe-receipts-saved-2026-09-28.png`
- `outputs/membership-terms/stripe-public-policy-links-saved-2026-09-28.png`
- `outputs/membership-terms/stripe-checkout-support-saved-2026-09-28.png`
- `outputs/membership-terms/stripe-dashboard-readback-2026-09-28.json`

Remaining Dashboard and release checks:

1. After setting the final terms URL, enable legal-policy links in [Checkout settings](https://dashboard.stripe.com/settings/checkout). Support-email display and annual pricing display are saved and verified.
2. After the final agreement is published and its version URL works, set the correct [Public details](https://dashboard.stripe.com/settings/public) terms URL and portal terms URL. Do not substitute Shopify store terms, the no-charge pilot or a placeholder. Check the effect of account-wide policy settings on other Checkout uses.
3. Verify the exact version-specific membership checkbox and the paid-member cancellation flow and confirmation. The management URL resolves, but that does not prove the new commitment or early-exit handling exists.
4. Verify actual receipt/notification delivery only through a separately authorized test. No test email was sent during this settings update.
5. Install matching live restricted/publishable keys and webhook signing secret securely in the members deployment. Do not paste secret keys into chat.

The local renewal queue targets 40 and 20 days before annual prepaid renewals,
inside Utah, California and Mastercard notice windows across the two sends. It
uses current Stripe invoice-preview amounts, tax and cancellation instructions,
persistent delivery evidence and duplicate protection. It is default-off and has
not sent email. It covers all six exact accepted offers and includes monthly
initial-commitment anniversaries. Monthly notices distinguish the anniversary
from the next monthly invoice; they do not promise a new annual commitment. Native renewal emails currently remain off; inspect for
overlap if either system is later enabled. Keep the independent
`STRIPE_MEMBERSHIP_RENEWAL_EMAILS_ENABLED=false` flag off: the commercial purchase
gate does not itself stop this worker. The retained 7-day native event setting
does not implement the worker's two-notice schedule. No customer or test-recipient
email has been sent.

## Publication and deployment

Only pilot v1 is published. Five pilot acceptances remain intact. The approved
commercial decisions are incorporated into the paid agreement and the separate
version-2 publication candidate, `outputs/membership-terms/paid-agreement-v2-candidate.md`
in the enclosing workspace. The candidate contains only member-facing terms;
internal review and implementation notes stay in the repository draft. It remains
unpublished. The earlier `proposed-paid-agreement-body.md` is superseded and must
not be published.

A new publication command provides a read-only dry-run, exact body/predecessor
hash validation, atomic publication, and preservation of prior agreements,
acceptances and receipts. Its offline regression checks use real schema triggers.
No production publication or migration has run.

Candidate publication inputs (offline validation passed; read the current database
with the default dry-run before any publication):

- Title: `Ruined Membership — Paid Agreement`
- Version: `2` (`ruined_membership-v2`)
- Body SHA-256: `4573c9472e5051690492489b8b831118975c8075fe4e984d61152817a0ac948e`
- Expected predecessor: `3759041d-83e3-4fac-b788-f508445d0003`, version `1`
- Predecessor body SHA-256: `ce1980c20b7ed5c22e719b43625b37366d22bed9d2838063677fb47185a642df`

From this repository, with `DATABASE_URL` already provided securely, the read-only
check is:

```sh
node scripts/publish-membership-agreement.mjs \
  --file ../../outputs/membership-terms/paid-agreement-v2-candidate.md \
  --title 'Ruined Membership — Paid Agreement' \
  --version 2 \
  --expected-body-sha256 4573c9472e5051690492489b8b831118975c8075fe4e984d61152817a0ac948e \
  --predecessor-id 3759041d-83e3-4fac-b788-f508445d0003 \
  --predecessor-version 1 \
  --predecessor-sha256 ce1980c20b7ed5c22e719b43625b37366d22bed9d2838063677fb47185a642df
```

The command omits `--apply` and does not infer or impersonate a publication actor.
This check has not been run against production for the new candidate.

Publication is effective immediately and replaces the one current
`ruined_membership` agreement. The existing onboarding query would immediately
show v2 to members whose pilot onboarding is incomplete, and an old v1 acceptance
form would reject with a reload requirement. Prior v1 agreement bodies, acceptances
and receipts are preserved. Publication does not itself charge, reaccept, change
complimentary funding or enable paid signup. Verify onboarding and explicit paid
authorization before publication; a pilot acceptance is never authorization for
the new commitment or fee. Do not publish merely to populate Stripe's terms link.

Vercel access was restored through normal CLI session refresh. Production heads
are unchanged. The current team is Hobby, which restricts commercial use; arrange
commercial-eligible hosting before a paid launch. The new cron uses a daily schedule
rather than an unsupported hourly Hobby schedule. No plan was upgraded or purchased.
See `membership-release-readiness-2026-09-28.md` for current project IDs, heads,
migration checksums and environment evidence.

Application work remains local. Live purchases stay closed, with an additional
`STRIPE_MEMBERSHIP_COMMERCIAL_READY=false` hold for both live and test credentials. Do not
enable it until founder eligibility, couples access, commitments, cancellation,
taxes and the exact accepted agreement are implemented and verified. Local browser checks cover signup/account layout at 320px and signup at desktop
width; component tests cover cancellation confirmation and error/retry states.
Full provider Checkout/cancellation verification, live credential pairing, actual
email delivery and commercial hosting remain release dependencies. Dashboard access and
notification-switch verification are now complete. Preserve the public waitlist.

Flexible-billing cancellation timestamps are now preserved through signed webhooks,
stored subscription records and the Account view. The account distinguishes a
subscription's exact end date from an earlier payment date and does not promise
unrestricted access. This adds a second local migration after the notice queue;
neither new migration has been applied to production.

## Verification

Final local verification results are recorded in
`membership-release-readiness-2026-09-28.md`. These checks include the complete
migration schema, six offers, atomic founding reservations and re-entry,
complimentary and couples access, immutable paid consent, cancellation accounting,
invoice retry protection, portal routing, renewal notices and prior-agreement
preservation. Local browser verification inspected 320px and desktop signup
layouts without horizontal overflow. Paid-provider behavior is separately unverified.

Both live and sandbox catalogs were independently read back from Stripe. Live
Dashboard notification and receipt settings were saved and verified; the new
commitment portal was created only in the sandbox. No deployment, production
migration, paid agreement publication, email, fee or live payment was initiated
by this implementation. Those settings and local tests do not resolve tax setup
or establish actual email delivery.

## Sources

- [Stripe customer portal](https://docs.stripe.com/customer-management).
- [Stripe customer emails](https://docs.stripe.com/billing/revenue-recovery/customer-emails).
- [Stripe tax registrations](https://docs.stripe.com/tax/registering).
- [Shopify US tax registrations](https://help.shopify.com/en/manual/taxes/us/us-tax-manage).
- [Utah automatic-renewal law](https://le.utah.gov/xcode/Title13/Chapter70/C13-70_2025010120240501.pdf).
- [California automatic-renewal law](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17602.).
- [Mastercard recurring-billing guidance](https://support.stripe.com/questions/guidance-for-mastercard-recurring-billing-compliance-updates?locale=en-GB).
- [Vercel Hobby restrictions](https://vercel.com/docs/plans/hobby).
