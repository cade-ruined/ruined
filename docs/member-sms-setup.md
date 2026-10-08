# Ruined membership text messages

## Current scope

Registration collects a separate, optional, unchecked SMS choice for membership
updates and call reminders. Promotions are excluded. The disclosure records its
version, exact phone number, authenticated member, time, and SMS terms version.
Email choices are independent. Older SMS decisions do not enroll members under
the new wording; original records are preserved.

The server includes a disabled transport and signed inbound webhook. There is
no signup caller, scheduled reminder job, campaign, or automatic backfill.
Keep `MEMBER_SMS_ENABLED=false`. Installing credentials alone does not send texts.

## Public review links

- Program terms and interactive opt-in example:
  https://members.theruinedproject.com/membership/text-messages
- Privacy: https://members.theruinedproject.com/privacy
- Registration entry: https://members.theruinedproject.com/membership#your-invitation

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

Do not claim messaging is active or that an enrollment confirmation is already
automated. The public terms identify delivery as not yet enabled.

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
| `TWILIO_ACCOUNT_SID` | Existing Ruined account SID |
| `TWILIO_AUTH_TOKEN` | Existing account authentication token |
| `TWILIO_MESSAGING_SERVICE_SID` | Approved service containing the number |
| `TWILIO_PHONE_NUMBER` | Existing sending number in E.164 format |
| `TWILIO_WEBHOOK_BASE_URL` | `https://members.theruinedproject.com` |

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

## Safeguards and operational limits

- The sender requires an active, non-deleted member, current phone, latest
  affirmative member-authored v2 consent, current SMS terms, and no suppression.
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
  A status callback and operator delivery reporting are not implemented.
- No message body or raw provider error is retained in the delivery tables.
  Suppression records are private and must survive contact edits to honor opt-out.
- A STOP cannot recall a request already accepted by Twilio. Consent is rechecked
  immediately before dispatch and concurrent changes wait for the short dispatch.

## Launch checks still required

1. Verify existing number/service ownership and applicable carrier approval.
2. Install configuration securely and verify signed inbound events while outbound
   remains disabled. Invalid signatures must not alter consent or suppression.
3. Implement an enrollment-confirmation caller and durable scheduling before
   enabling recurring reminders. The confirmation template exists, but nothing
   invokes it. Current transport eligibility is active membership only; a held
   registration must not be advertised as immediately enrolled in delivery.
4. With an explicitly authorized test recipient, verify enrollment confirmation,
   one reminder, STOP, HELP, suppression, and provider delivery evidence. Do not
   use real members as unrequested test recipients.
5. Remove the public 'not currently enabled' statement only when operationally
   true. Keep the form, terms, templates, campaign description, and actual behavior
   consistent. Do not bulk-enroll historical registrations.

## Release and rollback

Apply `20261008210000_member_sms_phone_consent.sql` and then
`20261008220000_member_sms_transport.sql` through the existing migration runner
before deploying the application. The first installs future phone-change
invalidation; the second creates private transport tables. Neither backfills
consent, sends messages, charges members, or opens profiles.

Run consent, registration, public-page, transport, and signed-webhook tests,
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
