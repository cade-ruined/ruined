# Registration policy acknowledgment

Prepared locally; not deployed or applied to the production database.

Both the direct and invited signup paths reach the same details form. Incomplete
registrations must accept the linked Membership Terms and acknowledge the Privacy
Policy before saving their details. Links open separately so entered details stay
in place. A document change requires a reload and a fresh unchecked acknowledgment.

The transaction saves the exact registration terms, version, hash, notice, actor
and timestamp as separate evidence with the privacy acknowledgment. It does not
create a paid membership agreement acceptance, subscription, or charge permission.
Payment-method setup and registration readiness also enforce the acknowledgment.
Already completed or activated registrations are not reopened by this change.

## Document to review

The Founding-rate candidate is in
`docs/membership-registration-terms-v2-draft.md`, between the BEGIN / END
REGISTRATION TERMS CANDIDATE markers. Only that body is member-facing. It copies
the v1 body and changes only the rate-reservation paragraphs in sections 3 and 4.
The unchanged v1 source remains in `docs/membership-registration-terms-draft.md`.
The published registration v1 wording says no rate is reserved; it must not be
presented as the new Founding-rate policy.

The existing pilot agreement prohibits real cards and must not be reused for
registration. The unpublished paid agreement is a separate future offer. This
release changes neither pilot nor paid agreement content.

The existing Privacy Policy remains at `/privacy`, revision
`privacy-2026-08-19`. It covers account/membership and fulfillment information,
consent history, communications, and Stripe and other service providers.

## Publication and deployment

These are instructions for a future authorized release. Preparing this candidate
does not publish terms, configure an environment, or apply migrations.

1. Obtain approval for the exact v2 candidate body. Extract only the text between
   its candidate markers, excluding the marker lines and surrounding blank
   lines. Preserve all remaining UTF-8 text and line breaks; compute SHA-256 over
   exactly the bytes that will be stored as `body_text`.
2. Prepare a new `membership_agreement_versions` record with a new ID,
   `agreement_key='ruined_registration'`, `version=2`,
   `title='Ruined Membership Registration Terms and Conditions'`, the approved
   `body_text`, and its `content_sha256`. Do not update v1's body, hash, version,
   or acceptance evidence. Do not publish the draft header or internal notes.
3. Prepare the application deployment with
   `MEMBERSHIP_REGISTRATION_TERMS_VERSION=ruined_registration-v2`. Keep paid
   agreement configuration unchanged. Confirm the registration-acknowledgment
   migration `20260930220000_registration_legal_acknowledgment.sql` is already
   applied; coordinate the new migrations
   `20261002140000_registration_founding_pricing.sql` and
   `20261002150000_payment_setup_consent_v2.sql` before promoting the prepared
   application. The pricing backfill creates decisions, not acceptance records
   or replacement welcome messages. If an unsettled Checkout occupies the last
   Founding place, its `P4205` failure rolls the pricing migration back; let that
   Checkout settle before retrying rather than assigning a different rate.
4. In the publication transaction, retire the currently published
   `ruined_registration` v1 record by setting `status='retired'` and `retired_at`,
   then publish v2 with `status='published'`, `published_at`, and `effective_at`
   set to the approved release time. The database allows one published version
   per agreement key, so retirement and publication must commit together. Keep
   v1 readable at its historical versioned URL. Promote the prepared v2-configured
   application in the same release window; do not leave the application pointing
   to retired v1. The resolver requires the configured version to be published
   and effective and does not fall back to another document.
5. Verify `/membership/agreement/ruined_registration-v2` against the approved
   stored body and hash, and verify that
   `/membership/agreement/ruined_registration-v1` still displays the unchanged
   historical text. Check a new registration's terms link, unchecked
   acknowledgment, stale-document reload, card-saving continuation, and Founding
   confirmation. Confirm that existing accepted registrations keep their prior
   acceptance and access without a retroactive resubmission prompt.

The registration document version `ruined_registration-v2` and the separate
card-storage consent version `save-payment-method-v2` identify different records.
New card setup uses the new storage text; existing setup attempts retain their
original version and text. Neither version authorizes a charge. Do not rewrite,
backfill, or automatically resubmit v2 acceptance for anyone who already accepted
v1, including someone whose registration is still incomplete. The existing legal
acknowledgment remains authoritative; publishing v2 only changes the document
offered when a new acknowledgment is required.

The local signup demo may display the candidate with a clear draft notice. Demo
checks never create acceptance records and are not evidence of live acceptance.

## Optional membership communications

The details form records separate preferences for membership updates and call
reminders. The user confirmed these do not include promotions or offers. Email
updates default on only when the member has no saved choice. Text reminders
start unchecked and require an active choice for the submitted phone number.
Neither is required to register; both are independent of the legal acknowledgment.

Keep verification, welcome, profile-ready, billing, security, and support emails
transactional. These preferences must not enroll a Resend marketing topic or
override an existing provider unsubscribe. The existing service segments are not
proof of optional reminder consent.

This change captures preferences; it does not connect a text-message service or
start a reminder campaign. Before enabling either reminder sender, filter its
audience by the latest destination-bound preference, honor provider suppression,
and implement a working channel-specific opt-out. SMS delivery also requires
sender registration and a supported STOP/HELP flow. Until self-service preference
editing is available, preference changes are handled by
connect@theruinedproject.com as stated in the form and draft terms.

The shared registration form explicitly clears text selection when its number
changes. Legacy profile-only requests that omit preferences retain previous
destination-bound decisions; returning to an older consented number can make
that historical decision applicable again. Before enabling SMS delivery, extend
phone-change invalidation to those paths as well, or require a fresh confirmation
of the current number as part of SMS enrollment.

Documented provider requirements for the default selection:

- [Twilio error 30925: active SMS opt-in](https://www.twilio.com/docs/api/errors/30925)
- [Resend marketing email consent](https://resend.com/blog/how-to-properly-get-email-consent)

The email default here is an optional membership-service preference, not a record
of affirmative marketing consent. Do not reuse it for promotional campaigns.
