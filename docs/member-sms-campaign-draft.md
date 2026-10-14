# Ruined membership SMS campaign — resubmission draft

Updated October 14, 2026 for rejected campaign
`CM1964ed2428424f5a584f230e93395445`. This is prepared application copy, not a
claim of deployment, successful live consent capture, resubmission, carrier
approval, or live sending. Verify the published flow against the checklist below
before using this draft. Keep outbound texts disabled until the launch checks in
[member-sms-setup.md](member-sms-setup.md) pass.

## Rejection and correction

The campaign submitted October 8, 2026 at 22:21:32.493 UTC was rejected with
**30896 — Opt-in Error**. The reviewer reported that the submitted opt-in page
lacked a functional submit button and that a static mockup did not demonstrate a
working registration flow.

The correction replaces the non-submitting example at
`https://members.theruinedproject.com/membership/text-messages` with a real SMS
preferences form. It presents a mobile-number field, a separate unchecked SMS
consent checkbox, the disclosure and policy links, and a submit control. Saving
requires a verified email session; signing in does not itself give SMS consent.
The authenticated save records the phone and consent evidence through the
existing consent ledger, independently of email preferences. No purchase is
required to save this choice. Registration remains a second consent path.

**Release status:** implementation and local consent/browser checks are complete; production deployment and live verification are pending. The old
example or its preview screenshots must not be presented as proof that the
corrected form saves consent. Record the actual release and verification results
before resubmission.

## Existing provider resources

Edit the existing rejected campaign. Do not create another brand, service,
campaign, or number to work around this rejection.

| Field | Selection |
| --- | --- |
| Twilio account | My First Twilio Account — confirm the existing Ruined account in Console |
| Campaign SID | `CM1964ed2428424f5a584f230e93395445` |
| Brand | Existing RU/NED Low Volume Standard brand; confirm current status |
| Brand Registration SID | `BNd36e78426b0c9c5bba8a66c13f412ce1` |
| Messaging Service SID | `MGcd9068f9df84039b73e8a5936b286268` |
| Sending number | `+13857071129` — confirm association in Console |
| Campaign use case | Existing `LOW_VOLUME` |
| Descriptive campaign name, if requested | Ruined membership updates and call reminders |
| Message category, if requested | Account notifications; membership scheduling reminders |
| Customer type | Direct business sending to its own members |

Twilio's current [30896 guidance](https://www.twilio.com/docs/api/errors/30896)
says to edit and resubmit the same campaign and that this does not incur a new
vetting fee. Review any current Console acknowledgement before committing to new
charges or terms. Brand approval alone is not campaign approval.

## Campaign description

After the release checklist passes, use this in the campaign description field:

> RU/NED (Ruined) will send non-promotional membership updates and scheduled call reminders to its own members who explicitly opt in through its website. Members can save their SMS preference on the public text-message page after verifying their email, or choose SMS while completing their authenticated membership registration. Messages include an enrollment confirmation and reminders for published membership or Circle calls the member is eligible to attend, with a link to the member calendar. Message frequency varies with the member's call schedule. This program does not send promotional offers, prospecting messages, third-party advertising, or purchased-list messages. Sending is currently disabled pending campaign approval and delivery testing.

## How members consent

After verifying both paths, use this in the message-flow / how-end-users-consent
field. Both website paths must remain in the submitted description:

> Members opt in through either of two website flows. (1) At https://members.theruinedproject.com/membership/text-messages, they enter their mobile number, actively select a separate SMS checkbox, and submit their text-message preference. The form is publicly visible and functional; saving requires signing in with a verified email session. Users who need to sign in are directed through email verification and back to this page to complete their choice. No purchase is required. (2) Members may instead begin at https://members.theruinedproject.com/membership#your-invitation or a personalized invitation, verify their email, and complete their registration details. Under Membership updates, they enter their mobile number, actively select the separate SMS checkbox, and save their details. The checkbox is unchecked for a new choice and says: "I agree to receive recurring text messages from Ruined about membership updates and call reminders." Both forms disclose that consent is optional and not a condition of purchase or membership, message frequency varies, message and data rates may apply, and to reply STOP to unsubscribe or HELP for help. Both link https://members.theruinedproject.com/privacy and https://members.theruinedproject.com/membership/text-messages. A successful save records the authenticated member, exact number, consent wording/version, and time. Email preferences and membership agreements are separate. Entering a phone number or signing in alone does not opt in. We do not use verbal, imported-list, purchased-list, or text-keyword enrollment. START alone does not restore a stopped subscription; members must contact support to arrange fresh consent. Legacy SMS preferences without this checkbox evidence do not enroll recipients. Delivery is not currently enabled.

The sign-in gate is part of the real flow. Include public URLs for current
screenshots of any gated steps that the reviewer cannot directly reach,
including the authenticated registration consent form. Capture the implemented
flow with authorized test details and redact personal information. Screenshots
supplement the functioning forms; they do not replace the submit action or its
successful result. Add the verified hosted evidence URLs to the submitted
message-flow field. These URLs and completion evidence remain pending.

## Sample messages

These represent the application's templates. Bracketed portions are variables,
not a promise that any particular call has been scheduled. The calendar is
authenticated; the SMS never contains an access token or private meeting URL.

**Sample 1 — consent confirmation**

> Ruined: You opted in to membership updates and call reminders. Message frequency varies. Message and data rates may apply. For help, reply HELP or email connect@theruinedproject.com. Reply STOP to unsubscribe.

**Sample 2 — call reminder**

> Ruined: [Call title] starts [weekday, month, day, time, timezone]. View details and join: https://members.theruinedproject.com/my/experiences. Reply STOP to unsubscribe or HELP for help.

Use these two samples. Do not add hypothetical promotions, payment demands, or
automatic cancellation notices outside the implemented program.

## Links, content, and opt-in selections

| Form question | Answer |
| --- | --- |
| Contains embedded links? | Yes — `https://members.theruinedproject.com/my/experiences` |
| Contains embedded phone numbers? | No — templates do not include a phone number; the sending number is not message content |
| Age-gated content? | No |
| Direct lending / loan arrangements? | No |
| Affiliate marketing? | No |
| Purchased or shared contact lists? | No |
| Opt-in method | Two website forms; separate, optional checkbox and authenticated save |
| Opt-in keywords for enrolling new recipients | None; leave blank when the field is optional |
| Privacy URL | `https://members.theruinedproject.com/privacy` |
| Program terms and public preferences form | `https://members.theruinedproject.com/membership/text-messages` |
| Registration entry | `https://members.theruinedproject.com/membership#your-invitation` |
| Current hosted evidence for gated steps | Pending capture, publication, and verification |
| Support | `connect@theruinedproject.com` |

If Console imports START/UNSTOP/YES from Advanced Opt-Out, do not represent those
as sufficient application enrollment. They are provider unblock/restart
requests; Ruined keeps its own suppression until reviewed re-enrollment.

## STOP, HELP, and restart handling

Advanced Opt-Out owns automatic keyword replies. The application's signed
inbound webhook returns empty TwiML and updates consent/suppression without
creating a second reply. Match the saved service settings in campaign fields if
Console requests them, after checking their current values.

| Purpose | Keywords |
| --- | --- |
| Opt out | `STOP,CANCEL,END,OPTOUT,QUIT,REVOKE,STOPALL,UNSUBSCRIBE` |
| Help | `HELP,INFO` |
| Provider restart acknowledgement | `START,UNSTOP,YES` |

**STOP reply**

> Ruined: You are unsubscribed from membership texts. No more messages will be sent. For help, contact connect@theruinedproject.com.

**HELP reply**

> Ruined membership reminders: For help, email connect@theruinedproject.com. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe.

**START / restart acknowledgement**

> Ruined: Restart request received. Contact connect@theruinedproject.com to complete a fresh opt-in. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to unsubscribe.

The consent confirmation in Sample 1 is an application message for an eligible
fresh checkbox choice. It is not the service's START auto-reply.

## Before resubmitting

All items remain pending until evidence is recorded for the corrected release.

1. Deploy the corrected public form and authenticated persistence endpoint with
   both SMS send switches disabled. Open the public form and policies without
   signing in on desktop and mobile. Verify the phone field, unchecked SMS
   choice, disclosure, policy links, and visible submit control.
2. Exercise the real sign-in/return path and successful save using an authorized
   test account and number. Verify the saved phone and consent evidence, reload
   behavior, and the on-screen success result. Confirm blank/invalid input does
   not create consent and that saving SMS does not change email preferences.
   No purchase or enabled outbound sending is needed for this test.
3. Verify the registration path still saves the same SMS consent independently
   of email preferences and membership terms. Capture and publicly host current
   evidence of gated steps with no private member data. Add those URLs to the
   message flow and check every URL from a signed-out browser.
4. Confirm form copy, policies, campaign description, both consent methods, and
   sample messages match the published behavior. Record the deployment and test
   results in [member-sms-setup.md](member-sms-setup.md). Do not use an old mockup
   or a preview screenshot as proof of a successful submission.
5. Open the existing campaign `CM1964ed2428424f5a584f230e93395445`, confirm the
   existing brand/service/number, update the rejected submission, and resubmit
   when authorized. Record the actual result; preparing this file does not
   submit anything or establish approval.
6. After campaign approval, confirm the number association, complete the
   authorized delivery/STOP/HELP test, and explicitly approve launch before
   enabling outbound messages.

## Provider requirements consulted

Twilio requires a message flow that describes every consent path, public policy
and terms links, and hosted evidence for steps a reviewer cannot access. Sample
messages must match the use case and identify the brand.

- [30896 rejection and resubmission guidance](https://www.twilio.com/docs/api/errors/30896)
- [Campaign fields and consent evidence](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info#campaign-details)
- [Unchecked SMS opt-in](https://www.twilio.com/docs/api/errors/30925)
- [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out)
