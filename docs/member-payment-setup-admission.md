# Public signup before paid membership opens

For the registration-only launch with required card saving and profiles opened later, see [Registration now, profiles later](member-registration-launch.md). That opt-in mode overrides the optional-card experience below for new members only.

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

The public landing page personalizes the card as the visitor enters their name. Name and email are visible beside the card; there is no pricing-to-registration gate. Submitting creates a tracked `ruined_direct` invitation and sends the verification code immediately through `/api/membership/signup/start`. The visitor enters the code in the same form, then continues to the server-selected profile step. Direct signup does not require opening a second invitation email or separately accepting the card. The verified claim records acceptance and preserves the original attribution.

The direct-signup context is kept in a private HttpOnly cookie. Invitation tokens and eligibility are not returned in JSON. Request retries retain the original invitation and deadline; blocked and returning identities receive the same public response. Preview mode can show the code step but never sends an email, verifies an identity, or creates an account.

Both the authentication signup-confirmation and passwordless email templates must display the provider's `{{ .Token }}` code. Existing confirmation-link fallback remains available, but the intended path is entering the emailed code in the form. No production template or email-delivery claim follows from a local preview check.

The same 48-hour recipient-bound invitations, rate limits, anti-enumeration response, verified-email requirement, and suspended/removed-account restrictions apply to both admission paths. Member-issued and complimentary invitations retain their existing rules.
