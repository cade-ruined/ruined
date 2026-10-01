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

The complete candidate is in `docs/membership-registration-terms-draft.md`,
between the BEGIN / END REGISTRATION TERMS CANDIDATE markers. Only that body is
member-facing. The existing published pilot agreement prohibits real cards and
must not be reused for this registration flow. The unpublished paid agreement
is a separate future offer.

The existing Privacy Policy remains at `/privacy`, revision
`privacy-2026-08-19`. It covers account/membership and fulfillment information,
consent history, communications, and Stripe and other service providers.

## Publication and deployment

1. Obtain approval for the exact registration candidate text.
2. Publish that reviewed body as a new `membership_agreement_versions` record
   with key `ruined_registration`, version `1`, its SHA-256, title, publication
   timestamp and effective timestamp. Preserve all existing pilot/paid versions
   and acceptance records. Do not publish internal draft notes.
3. Configure `MEMBERSHIP_REGISTRATION_TERMS_VERSION=ruined_registration-v1`.
   The resolver requires the configured version to be published and effective;
   it will not fall back to draft, future, pilot, or paid terms.
4. Coordinate migration `20260930220000_registration_legal_acknowledgment.sql`
   with the prepared application deployment. The new application requires the
   migration, and applying the migration makes incomplete registrations require
   acknowledgment. Do not leave the old signup UI serving after activating that
   requirement; prepare the deployment before the migration/promotion window.
5. Verify the public versioned document, shared details checkbox, stale-document
   recovery, card-saving continuation, and unaffected existing member access.

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
