# Membership launch preparation

Prepared September 25, 2026. **Keep the public waitlist until Cade authorizes the final launch.**
This preparation does not open paid signup, publish paid terms, or deploy the pending integration.

## Prepared

- Monthly and annual signup begins with a personalized **Ruined Direct** invitation,
  followed by verified-email admission, profile and agreement steps,
  separate recurring consent, Stripe Checkout and signed billing reconciliation.
- A real $499 sandbox payment: paid invoice, active membership, completed onboarding,
  duplicate-event protection, and period-end cancellation retaining paid access.
- An offline full-schema journey through the real application handlers. Supabase
  transport/session lookup and Stripe responses are substituted; this is not proof
  of real OTP inbox delivery or browser session persistence.
- A separately reviewable paid agreement draft in `membership-paid-agreement-draft.md`.
  No existing acceptance or published pilot agreement has been changed.
- Live catalog in the Ruined account `acct_1U6AS14cnqzISerX`:

| Item | ID | Price |
| --- | --- | --- |
| Ruined Membership | `prod_VKI6UIjkiDot2O` | Same membership for both billing periods |
| Monthly | `price_1UJdWe4cnqzISerX5M3cmhmg` | $499 USD each month |
| Annual | `price_1UJdWj4cnqzISerXbldILtgj` | $5,040 USD each year, paid upfront |

Tax behavior remains unspecified; no product tax classification was guessed.
Live Stripe Tax settings have an origin address, but no registrations were recorded
at the time of the check. This does not establish whether tax is owed.

## Current hold

The existing public three-field form and its waitlist behavior remain unchanged.
The members Vercel project has only these new production settings staged:

```text
STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID=price_1UJdWe4cnqzISerX5M3cmhmg
STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID=price_1UJdWj4cnqzISerXbldILtgj
STRIPE_MEMBERSHIP_LIVE_ENABLED=false
```

No deployment was triggered. Existing Stripe credentials were not replaced.
The current members publishable key is still **test mode**; the protected server
key and webhook secret were not retrieved. The exact paid-agreement version is
unset, and no live webhook or billing portal configuration exists yet.

The live flag is a **live-payment gate**, not a universal sandbox switch. Test
credentials intentionally bypass it for local testing. Keep the paid-agreement
version unset in production until approved terms and matching live credentials
are ready. Never combine these live Price IDs with test credentials for a purchase.

## Finish before the launch switch

1. Confirm cancellation/refund policy, failed-renewal access handling, applicable
   renewal notices, and tax treatment. Review the concrete paid agreement draft;
   do not infer paid consent from existing no-charge pilot acceptances.
2. Install matching live publishable and restricted server keys in the members
   project. Store server and webhook secrets as sensitive environment variables.
   Configure the reviewed billing portal, and create the live webhook at
   `https://members.theruinedproject.com/api/stripe/webhook` using API version
   `2026-08-26.dahlia` and the events in `stripe-integration.md`.
3. Apply the three pending additive migrations with the checksum-aware platform
   migration runner: `20260929000000_public_member_signup.sql`,
   `20260929001000_membership_checkout_plans.sql`, and
   `20260929002000_ruined_direct_invitations.sql`. All 50 existing production
   migration checksums matched during the readiness check.
4. Publish the approved paid agreement as a new version and configure its exact
   `STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION`. Preserve the five existing pilot
   acceptances and their text. Do not pre-accept the paid agreement for anyone.
5. Deploy the prepared members release with live checkout still disabled. Complete
   the real email/OTP/browser-session check and verify configuration with
   `scripts/check-stripe-membership.mjs`. Confirm the intended tax calculation if
   automatic tax is enabled; no registrations means enabling it alone is insufficient.
6. On explicit final-launch instruction, set the members live flag to `true` and
   redeploy. Verify the member purchase path, then release the focused public
   transition from the waitlist to membership signup. The public transition is a
   separate release; changing the Stripe flag alone does not rewrite that form.

No live payment should be submitted as a test without the payer's explicit authorization.

## Release targets

| Site | Vercel project | Production branch | Verified base |
| --- | --- | --- | --- |
| Public | `ruined` | `main` | `84c5c98823d0a541deefee28fdfbeb6ea48af8d8` |
| Members | `ruined-members` | `codex/my-ruined-foundation` | `d7f58c13742d73b44c8737b8bef808b941e2dbed` |

Recheck these heads before release. Do not merge the complete members branch into
public `main`, and do not include unrelated changes from the primary working copy.

If new purchases must be closed after launch, disable the live flag and redeploy;
keep signed webhook processing and existing-member billing management available.

## Ruined Direct invitations

After final launch, self-serve signup collects name, email, and the selected plan.
It queues the same spinning-card invitation, issued by The Ruined Project with a
fixed 48-hour lifetime. The email contains the private invitation URL; the signup
response never exposes its token or whether an address is eligible. Opening the
card leads into the existing verified-email, profile, agreement, and payment flow.

Operations → Members → Ruined Direct shows creation, delivery, acceptance, expiry,
and paid joining. Accepted means verified entry, not a paid member. Joined is
recorded after completed onboarding and paid activation and survives later
cancellation. Direct invitations never grant complimentary access or add member
referral credit; existing first-referrer attribution remains intact.

The launch gate is checked at issuance, card loading, verification, and claim.
Queued direct emails remain held while launch is closed. Existing member-issued
invitations keep their own eligibility rules. Retrying self-serve signup reuses
an open invitation without changing its original plan, recipient, or deadline.
Expired invitations can be replaced with a new 48-hour invitation. Existing joined
members sign in instead of generating a new direct acquisition.

Local preview only: `/signup?preview=invitation` and
`/invitation/preview?source=ruined_direct`. These controls require preview mode and
cannot submit requests, send email, or open signup in production. The default
closed `/signup` shows the waitlist.

Before release, verify a real direct email lands in the intended mailbox and its
card completes the actual OTP/browser-session journey. Automated tests substitute
mail and authentication providers; they do not prove real delivery.
