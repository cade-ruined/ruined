# Ruined membership SMS campaign — review draft

Prepared October 8, 2026. This is application copy, not evidence of carrier
approval or live sending. Keep outbound texts disabled until the launch checks
in [member-sms-setup.md](member-sms-setup.md) pass. Do not submit the paid
registration without the account owner's approval.

## Existing provider resources

Use these existing resources; do not create another brand, service, or number.

| Field | Selection |
| --- | --- |
| Twilio account | Existing Ruined account (confirm in the Console) |
| Approved brand | RU/NED — Low Volume Standard |
| Brand SID | Select the approved RU/NED brand in the Console |
| Messaging Service | Existing service created October 5, 2026 at 19:45 UTC |
| Sending number | `+13857071129` |
| Campaign use case | Low Volume / Low Volume Mixed (`LOW_VOLUME`), as offered for this brand |
| Descriptive campaign name, if requested | Ruined membership updates and call reminders |
| Message category, if requested | Account notifications; membership scheduling reminders |
| Customer type | Direct business sending to its own members |

The existing approved brand was verified in the Console before this draft was
prepared. No campaign approval is implied. The Console's current selections and
fees must be reviewed before submission.

The Console currently shows **$15 per campaign vetting request** and
**$1.50/month for Low Volume Mixed**, excluding message, carrier, and number
charges. Review the final billing acknowledgement for any minimum billing period
or additional terms before committing. The initial fee acknowledgement blocks
access to the campaign form, so this file is the prepared draft; do not claim a
Console draft has been saved unless it is actually saved and verified there.

## Campaign description

Copy this into the campaign description field:

> RU/NED (Ruined) will send non-promotional membership updates and scheduled call reminders to its own members who explicitly opt in through the Ruined registration form. Messages include an enrollment confirmation and reminders for published membership or Circle calls the member is eligible to attend, with a link to the member calendar. Message frequency varies with the member's call schedule. This program does not send promotional offers, prospecting messages, third-party advertising, or purchased-list messages. Sending is currently disabled while registration and delivery testing are completed.

## How members consent

Copy this into the message-flow / how-end-users-consent field:

> Members begin at https://members.theruinedproject.com/membership#your-invitation or a personalized invitation, confirm their email with a code, and complete their registration details. Under Membership updates, they enter their mobile number and may actively select a separate SMS checkbox, unchecked for new members: "I agree to receive recurring text messages from Ruined about membership updates and call reminders." The adjacent disclosure says consent is optional and not a condition of purchase or membership, message frequency varies, message and data rates may apply, and to reply STOP to unsubscribe or HELP for help. It links https://members.theruinedproject.com/membership/text-messages and https://members.theruinedproject.com/privacy. Saving the registration records the authenticated member, exact number, consent wording/version, and time. Email preferences and membership agreements are separate. Entering a phone number alone does not opt in. The public SMS page shows the same disclosure in a clearly labeled interactive example; the example cannot submit enrollment. Actual enrollment requires email verification. A screenshot of the shared registration form in preview mode with synthetic information is at https://members.theruinedproject.com/assets/membership/registration-sms-opt-in.jpg. We do not use verbal, imported-list, purchased-list, or text-keyword enrollment. START alone does not restore a stopped subscription; members must contact support to arrange fresh consent. Legacy SMS preferences without this checkbox evidence do not enroll recipients. Delivery is not currently enabled.

The public example must not be described as the actual enrollment form. For the
login-gated form, include this publicly hosted screenshot of the real shared
registration form in preview mode, with synthetic information:
https://members.theruinedproject.com/assets/membership/registration-sms-opt-in.jpg.
The SMS terms page links it and labels it as preview evidence. Check that it
loads and shows the current mobile field, unchecked SMS box, disclosure, and
policy links without real member information before submission.

## Sample messages

These are representative of the application's templates. Bracketed portions are
variables, not a promise that any particular call has been scheduled. The
calendar is authenticated; the SMS never contains an access token or private
meeting-room URL.

**Sample 1 — consent confirmation**

> Ruined: You opted in to membership updates and call reminders. Message frequency varies. Message and data rates may apply. For help, reply HELP or email connect@theruinedproject.com. Reply STOP to unsubscribe.

**Sample 2 — call reminder**

> Ruined: [Call title] starts [weekday, month, day, time, timezone]. View details and join: https://members.theruinedproject.com/my/experiences. Reply STOP to unsubscribe or HELP for help.

Use these two samples. They represent confirmation and call reminders; do not
add hypothetical promotions, payment demands, or automatic cancellation notices
that are outside the implemented program.

## Links, content, and opt-in selections

| Form question | Answer |
| --- | --- |
| Contains embedded links? | Yes — `https://members.theruinedproject.com/my/experiences` |
| Contains embedded phone numbers? | No — templates do not include a phone number; the sending number is not message content |
| Age-gated content? | No |
| Direct lending / loan arrangements? | No |
| Affiliate marketing? | No |
| Purchased or shared contact lists? | No |
| Opt-in method | Website form; separate, optional checkbox |
| Opt-in keywords for enrolling new recipients | None; leave blank when the field is optional |
| Privacy URL | `https://members.theruinedproject.com/privacy` |
| Program terms URL | `https://members.theruinedproject.com/membership/text-messages` |
| Public program / consent evidence | `https://members.theruinedproject.com/membership/text-messages` |
| Registration-form screenshot | `https://members.theruinedproject.com/assets/membership/registration-sms-opt-in.jpg` |
| Support | `connect@theruinedproject.com` |

If the Console imports START/UNSTOP/YES from Advanced Opt-Out, do not represent
those as sufficient application enrollment. They are provider unblock/restart
requests; Ruined keeps its own suppression until reviewed re-enrollment. Keep
the description above explicit about that distinction.

## STOP, HELP, and restart handling

Advanced Opt-Out owns the automatic keyword replies. The application's signed
inbound webhook returns empty TwiML and updates consent/suppression without
creating a second reply. Match these saved service settings in campaign fields
if the Console requests them.

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

## Before submitting

1. Open the public policy and evidence links without signing in. Confirm that
   their wording matches this draft and the actual registration form.
2. Confirm the existing brand, service, and number above are selected. Review
   current Console fees and obtain approval for the paid submission.
3. Save as a draft if supported. Saving application copy does not approve the
   campaign, associate the number successfully, or enable outbound messages.
4. After approval, confirm the same number is registered to the approved campaign,
   finish the authorized delivery/STOP/HELP test, and explicitly approve launch.

## Provider requirements consulted

Twilio requires a sender/recipient/purpose description, a consent flow, two to
five representative samples, and the appropriate use case. For a private
opt-in flow, provide publicly hosted evidence. Its guidance identifies
`LOW_VOLUME` for a Low-Volume Standard brand and requires active checkbox choice.

- [Campaign fields and consent evidence](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info#campaign-details)
- [Unchecked SMS opt-in](https://www.twilio.com/docs/api/errors/30925)
- [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out)
