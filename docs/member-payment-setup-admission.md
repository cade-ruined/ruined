# Public signup before paid membership opens

Public admission and saving a payment method have separate gates. Everything stays on the waitlist by default.

| Configuration | Public signup | Existing invited accounts | Charges |
| --- | --- | --- | --- |
| Both payment paths closed | Waitlist | Existing account access is retained | None |
| `STRIPE_MEMBERSHIP_PAYMENT_SETUP_ENABLED=true`, signup flag absent | Waitlist | Eligible verified accounts may optionally save a method | None |
| Setup enabled and `STRIPE_MEMBERSHIP_PAYMENT_SETUP_SIGNUP_ENABLED=true` | Ruined Direct invitation → verified email → profile → optional payment-method storage | Same optional storage | None |
| Paid Checkout fully ready | Ruined Direct invitation → verified email → profile → agreement → reviewed paid checkout | Normal membership entry | Only after explicit checkout confirmation |

Setup additionally requires connected Auth/database, Stripe secret/webhook configuration, and `STRIPE_PAYMENT_SETUP_ACCOUNT_ID` matching the Stripe account. The signup flag alone cannot bypass those requirements. Paid readiness and live/commercial release flags are unchanged.

`configuration.membershipSignupReady` is the single admission decision used by direct invitation issuance, public card loading, email delivery, verification preflight, and atomic acceptance. Closing both paths prevents new direct admission and delivery without disabling a previously verified account's sign-in.

During setup-only admission, monthly/annual is a preference. It does not reserve a price, founding offer, or membership place. The account remains pending with entry access only; saving a payment method creates no subscription, payment, active membership, or earned badge. The member reviews the then-current offer and membership agreement and explicitly confirms payment when paid checkout opens.

The same 48-hour recipient-bound invitations, rate limits, anti-enumeration response, verified-email requirement, and suspended/removed-account restrictions apply to both admission paths. Member-issued and complimentary invitations retain their existing rules.
