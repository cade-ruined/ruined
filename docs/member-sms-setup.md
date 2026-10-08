# Ruined membership text messages

## Current scope

Registration collects a separate, optional, unchecked SMS choice for membership
updates and call reminders. Promotions are excluded. The disclosure records its
version, exact phone number, authenticated member, time, and SMS terms version.
Email choices are independent. Older SMS decisions do not enroll members under
the new wording; original records are preserved.

The repository includes a disabled transport, signed inbound/status webhooks,
and a gated scheduled worker for fresh opt-in confirmations and call reminders.
This describes the implementation, not a claim that the release or real delivery
test has completed. Keep `MEMBER_SMS_ENABLED=false` and
`MEMBER_SMS_AUTOMATION_ENABLED=false`. Installing credentials alone does not send
texts. There is no promotional campaign or bulk historical confirmation backfill.

The existing RU/NED Low Volume Standard brand is approved. The campaign still
needs review and paid submission. Use [the prepared campaign
draft](member-sms-campaign-draft.md) and the existing number/service; the draft
records their identifiers and the actual fee gate encountered in the Console.

## Public review links

- Program terms and interactive opt-in example:
  https://members.theruinedproject.com/membership/text-messages
- Privacy: https://members.theruinedproject.com/privacy
- Registration entry: https://members.theruinedproject.com/membership#your-invitation
- Shared registration form in preview mode, with synthetic information:
  https://members.theruinedproject.com/assets/membership/registration-sms-opt-in.jpg

The example is explicitly a demonstration and cannot save consent. The real
form appears after invitation/email verification under **Membership updates**.
Both use the same disclosure component. Describe this distinction accurately
in carrier review; the public example is not an enrollment endpoint.

Suggested message-flow description, to verify against the actual published form:

> Members begin at the Ruined membership landing page or their personalized
> invitation, verify their email, and enter their registration information. In
> the Membership updates section they may select a separate, unchecked SMS
> checkbox for recurring Ruined membership updates and call reminders at their
> supplied mobile number. The disclosure states that consent is optional and
> not a condition of purchase or membership, message frequency varies, message
> and data rates may apply, and STOP/HELP instructions. It links our SMS terms
> and privacy policy. Email preferences and membership agreements are separate.
> A public example of that exact disclosure is available at the program URL.

The screenshot is evidence of the real shared form rendered in preview mode;
it is not a live person's signup. Verify it is publicly available after release.
Do not claim messaging is active. The public terms identify delivery as not yet
enabled, and the automation remains gated until approval and delivery testing.

## Connect the existing Twilio account

Verify Ruined's existing number, account, Messaging Service, and applicable
sender/campaign approval in its Console. Do not purchase a replacement number
or create a second account. Approval requirements depend on number type and
destination. A public opt-in page is evidence, not a guarantee of approval.

Install these as server-only production secrets/configuration in Vercel, never
in browser code or chat:

| Variable | Value |
| --- | --- |
| `MEMBER_SMS_ENABLED` | `false` until the launch checks below pass |
| `MEMBER_SMS_AUTOMATION_ENABLED` | `false` until scheduled sending is explicitly approved |
| `MEMBER_SMS_AUTOMATION_ACTIVATED_AT` | Unset until launch; then an explicit ISO UTC timestamp such as `YYYY-MM-DDTHH:mm:ssZ` |
| `TWILIO_ACCOUNT_SID` | Existing Ruined account SID |
| `TWILIO_AUTH_TOKEN` | Existing account authentication token |
| `TWILIO_MESSAGING_SERVICE_SID` | Approved service containing the number |
| `TWILIO_PHONE_NUMBER` | Existing sending number in E.164 format |
| `TWILIO_WEBHOOK_BASE_URL` | `https://members.theruinedproject.com` |
| `CRON_SECRET` | Existing server-only cron bearer secret; never place in the URL |

Configure the service's incoming-message webhook as **POST** to
`https://members.theruinedproject.com/api/twilio/inbound` without query parameters.
Use the canonical domain: the app verifies the signature against that exact
origin and checks AccountSid, To, and MessagingServiceSid when supplied.

Enable and verify **Advanced Opt-Out** on the same Messaging Service. Twilio
owns the automatic STOP/START/HELP replies; Ruined returns empty TwiML to avoid
duplicate replies. The helper's `MEMBER_SMS_HELP_MESSAGE` contains the intended
Ruined support email, frequency/rates, and STOP wording. Configure the provider's
HELP reply consistently. Do not promise automatic re-enrollment with START:
Ruined deliberately retains its local suppression pending reviewed re-enrollment.

Delivery status callbacks use
`https://members.theruinedproject.com/api/twilio/status?attempt=<attempt UUID>`.
The transport attaches this exact per-attempt URL to each request. Do not set a
generic callback that omits the attempt ID. The app verifies the signature,
account, sender, destination, service when supplied, and message identity.

## Scheduled behavior, once approved and enabled

Vercel invokes `/api/internal/communications/member-sms` every five minutes using
its `CRON_SECRET` bearer authorization. Both send switches, provider
configuration, and an explicit activation timestamp are required. Disabled
calls stop before reading membership data or contacting Twilio.

- **Opt-in confirmation:** one message per exact, fresh authenticated checkbox
  event saved after the activation timestamp, within a ten-minute window. A
  held registration can receive its requested consent acknowledgement without
  paying or having profile access. Deleted, suspended, and closed accounts are
  excluded. Confirmation is not proof of paid membership or profile activation.
- **Existing valid consent:** if an eligible call becomes due and that member's
  current v2 checkbox choice has no accepted confirmation, send the same
  confirmation first, keyed to that exact consent. This also covers a valid
  choice captured before launch or a missed initial confirmation window. It
  happens only alongside an authorized, due call, not as a bulk backfill. A
  failed, blocked, or unknown confirmation is not retried under a new key and
  prevents the reminder. Provider acceptance is required before dispatching the
  reminder; it does not guarantee handset delivery or receipt order.
- **Call reminder:** one occurrence about an hour before a published call,
  processed only during the first ten minutes after that due time. The text
  shows the current call title, date/time with timezone, and a link to the
  authenticated member calendar. It does not expose a private meeting URL.
- **Recipient checks:** call recipients need an active eligible membership,
  released profile, valid current consent/phone, and current calendar audience
  entitlement. Circle/block restrictions, completed Foundations, registration
  requirements, cancellations, active assignments, and the current meeting link
  are checked again under locks immediately before dispatch.
- **Changes:** canceled/unpublished calls and changed start times invalidate the
  old occurrence. A future rescheduled start gets its own reminder occurrence;
  changing a title or link cannot authorize sending stale details. There is no
  separate automatic cancellation/change-notification text in this release.
- **Foundations:** billing/cohort dates do not create reminder events. An
  operator must publish actual accessible calendar calls with valid meeting
  links and the intended audience. No calls are synthesized from payment terms.

The worker does not replay missed standalone confirmation jobs or call reminders
after their short window. An otherwise valid consent without a confirmation can
still use the first-call confirmation path above. It processes at most 100
claimed jobs per run; monitor capacity before
expanding to large simultaneous audiences. A claimed or ambiguous attempt is
never automatically retried. Timely processing and actual delivery must be
verified before promising reminders to members.

Existing valid v2 checkbox consent can authorize future eligible call reminders
after launch; it is not rewritten or inferred. Pre-activation choices receive no
standalone catch-up confirmation, but an accepted confirmation is required at
their first eligible call. Older v1 choices, operator-entered numbers, membership
purchases, and email subscriptions do not authorize texts.

## Safeguards and operational limits

- All sends require a non-deleted, non-suspended/non-closed account, current
  phone, latest affirmative member-authored v2 consent, current SMS terms, and
  no suppression. Call reminders additionally require active membership and
  the released, authorized calendar access described above.
- Phone changes append withdrawal, including operator/direct database changes.
  An earlier accepted number cannot become eligible by being restored.
- A signed STOP suppresses the number across members, including numbers not yet
  associated with a profile, and appends withdrawals where applicable.
- START does not clear local suppression or fabricate checkbox consent. A future
  re-enrollment workflow must verify provider state and collect fresh consent.
- Each occurrence has one stable reminder key. Accepted, interrupted, or unknown
  attempts must not be retried using a new key. Reconcile unknown outcomes in
  Twilio first; the SDK's automatic retries are disabled.
- `accepted` means Twilio returned a message SID, not confirmed handset delivery.
  Signed callbacks separately record queued/sending/sent/delivered/failed/
  undelivered status, with replay and out-of-order protection. Provider error
  21610 also suppresses the number. An operator delivery dashboard is not part
  of this release; use Twilio logs and restricted delivery records for review.
- No message body or raw provider error is retained in the delivery tables.
  Suppression records are private and must survive contact edits to honor opt-out.
- A STOP cannot recall a request already accepted by Twilio. Consent is rechecked
  immediately before dispatch and concurrent changes wait for the short dispatch.

## Launch checks still required

1. Verify the existing number/service and approved brand. Review the prepared
   campaign, obtain approval for the paid submission, submit it, and wait for
   approval and successful number association. Brand approval alone is not
   campaign approval.
2. Verify production credentials and signed inbound/status handling while
   outbound remains disabled. Invalid signatures must not alter any records.
   An unsigned 403 probe confirms rejection only, not real Twilio delivery.
3. Apply the automation migration and deploy the tested worker, callback, and
   cron configuration with both send switches false and activation time unset.
   Confirm scheduler authorization and the disabled path in production.
4. Obtain authorization for a controlled test recipient and exact test messages.
   Keep the global scheduler disabled during a narrow delivery test; do not
   enable all recipients as a shortcut. Verify confirmation, a reminder, STOP,
   HELP, suppression, provider status callbacks, and handset receipt. Verify a
   canceled or inaccessible call cannot dispatch. Do not use real members as
   unrequested test recipients.
5. Once approved, choose and record the activation timestamp, enable both
   switches in the production release, and monitor the first scheduled runs.
   Do not use an old activation timestamp to replay historical choices.
6. Remove the public 'not currently enabled' statement only when operationally
   true. Keep the form, terms, templates, campaign description, and actual behavior
   consistent. Do not bulk-enroll historical registrations.

## Release and rollback

Apply `20261008210000_member_sms_phone_consent.sql` and then
`20261008220000_member_sms_transport.sql` through the existing migration runner
if not already applied, followed by `20261008230000_member_sms_automation.sql`
before deploying this release. The first installs future phone-change
invalidation; the second creates private transport tables; the third adds
durable automation jobs and delivery status fields. These migrations do not
backfill consent, send messages, charge members, or open profiles.

Run consent, registration, public-page, transport, automation, and signed-webhook tests,
lint/typecheck, CI, and desktop/mobile form checks. Verify the public URLs after
release. Until credentials exist, the inbound route should return 503 without
changing data. Sending remains disabled by default.

For rollback, disable outbound sending first. Keep signed inbound STOP processing
available if any texts have ever been sent; do not drop evidence or suppression
tables. Existing acceptance records must not be rewritten to older versions.

## Provider references

- [Active SMS opt-in requirements](https://www.twilio.com/docs/api/errors/30925)
- [Campaign and message-flow information](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info)
- [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out)
- [Webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
