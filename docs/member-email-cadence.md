# Member email cadence

This release covers event-linked email reminders from the October 2026 founder test and November/future member cadence. It does not turn the entire communications document into a send list. Existing registration welcome delivery and SMS automation remain separate and unchanged.

## Operations management

Open **Messages → Recurring emails**, or use **Recurring emails** inside the email workspace. The canonical page is `/ops/messages?mode=automations`; `/ops/email-automations` remains supported.

The manager lists approved reusable sequences and individual call plans, with search, status filters, next scheduled reminders, and delivery counts. Opening an existing record shows its saved design and each message stage, timing and audience rules, inherited calls or individual overrides, and recent delivery activity. Inspect a specific call to see its current eligible and excluded recipients and reasons. These reads do not create an approval, change a roster, or send email.

**Edit design** loads the saved template fields and bindings. Changes and resumptions go through the existing full message and recipient review before activation. Pausing a sequence pauses its inherited calls; independent approvals and individually paused calls keep their own settings. Timing and the main message follow the approved cadence rules described below; this manager does not introduce arbitrary schedules or rewrite the approved copy.

Next scheduled reminders are opportunities to send, not promises of delivery. Eligibility is rechecked at dispatch. A recorded `sent` result means the email provider accepted the message; inbox delivery, bounces, and complaints are separate provider events. Missing provider access is shown explicitly, and saved approvals remain inspectable when the live template catalog is unavailable.

Welcome/profile-ready emails, renewal notices, and the internal work summary appear separately with their existing management links and configuration status. Configuration readiness is not evidence of a successful scheduler run or email delivery. Unfinished protocols stay in their own inactive section.

## Copy approval — October 12, 2026

Cade approved the email wording shown in this chat: the Foundations introduction, one-week/two-day preparation message, Foundations 01 and 02–04 reminders, Membership reminders, Circle reminders, and shared personalized call details, account links, and sign-off. The wording is implemented in `src/lib/communications/member-email-cadence-copy.ts` at reviewed commit `ac1fc6f148955007c04f97cf72bda3c444e0118e` (SHA-256 `b86736317c0b41c7394a983212c08ac129b98421a42ef11a70776b3da8d96866`).

This records approval of the message copy. Published Resend design binding, call/cohort classification, recipient verification, deployment, and sequence activation remain rollout steps. Unfinished protocols remain inactive; this approval does not change reminder preferences, activate sending, or backfill past messages.

## Reusable sequences and event classification

An administrator approves a published Resend design once for a track (`founder_test` or `members`) and kind (`foundations_01` through `foundations_04`, `membership`, or `circle`). The approval includes every reminder stage, the design's fixed text and variable bindings, and its application to current and future matching calls. A sequence may be approved before any matching calls or recipients exist. Example recipients are informational, not a frozen list to copy into another cohort.

Published future calls inherit their matching approved sequence during reconciliation. Explicit email-sequence classification on the event takes precedence, including an explicit “none.” An ordinary `weekly_call` for a member audience can inherit Membership reminders; a `circle_meeting` for a Circle can inherit Circle reminders. Generic `member_event` records are not assumed to be Membership calls. Foundations calls require an explicit stage and track; member-cohort calls also require the cohort month. Titles never determine classification.

Actual calls still need to be scheduled with their working Meet link. Creating a new cohort's classified calls is enough for the approved sequences to apply: separate email approval for every call is no longer required. The system does not create an infinite calendar or alter accepted member schedules.

An individual call's approval overrides inheritance. Paused calls stay paused. Pausing a sequence stops all of its inherited deliveries, including queued work. Updating or resuming an approved sequence refreshes unchanged, active inherited plans for future stages only. A call whose saved details or audience change requires an individual review; reconciliation never silently accepts those changes.

| Event / track | Email stages |
| --- | --- |
| Foundations 01 / members | Orientation 16 calendar days before; one week 7 calendar days before; 24 hours before; event date at 08:00 America/Denver |
| Foundations 01 / founder test | 48 hours before; 24 hours before; 150 minutes before |
| Foundations 02–04 / either track | 24 hours before; 150 minutes before |
| Membership or Circle / either track | 24 hours before; 150 minutes before |

The 16-day and seven-day offsets preserve the event's local clock across daylight saving transitions. The 48-hour, 24-hour, and 150-minute offsets are elapsed time. The members' first-session morning reminder remains 08:00 in Denver, and is omitted if the call starts at or before that time. Each occurrence expires 30 minutes after its due time, or at the event start, whichever comes first. The end boundary is exclusive.

For November 5, 2026 at 15:00 Denver time, this yields October 20 at 15:00, October 29 at 15:00, November 4 at 15:00, and November 5 at 08:00. The November 30 holiday-adjusted session is driven by its saved event date, not a recurring Thursday assumption. Copy uses actual call duration. An early-morning call whose 150-minute reminder lands on the previous date says “Coming up,” not “Today.”

## Activation and dispatch boundaries

Set `MEMBER_EMAIL_CADENCE_ENABLED=true` and a deliberate `MEMBER_EMAIL_CADENCE_ACTIVATED_AT` UTC ISO timestamp, for example `2026-10-12T18:00:00Z`. Missing/invalid activation fails closed. `ready` describes valid activation configuration; workers must also check `enabled`, production/provider configuration, and current activation time before database or delivery work.

Only occurrences due on or after activation and enrollment may dispatch. They must still be inside the 30-minute window. Do not catch up historical October 6–9 or September/October waitlist sends. Enabling an event after one of its windows started does not replay that reminder. Future October founder reminders require the explicit founder-test track and an approved test audience; a note in the source document is not a founder enrollment instruction.

Recipient selection follows the saved event and approved cadence classification:

| Call type | Candidate audience |
| --- | --- |
| Foundations / members | Confirmed private call invitations, including create-only cohort enrollment from authoritative paid reservations whose accepted cohort month and session time match the explicitly classified call. |
| Any founder-test track | Explicit confirmed call registrations with `source='ops'`; there is no inferred founder list or automatic founder enrollment. |
| Membership with `registration_mode='none'` | Canonical currently eligible members with access to that event. A reservation is not required. |
| Circle with `registration_mode='none'` | Canonical currently eligible members assigned to that specific Circle and authorized for the event. Historical assignments do not qualify. |
| Other supported calls with internal registration | Explicit confirmed call registrations and current event access. |

An explicit call-registration cancellation suppresses reminders even when the event otherwise requires no reservation. Every candidate still needs a verified current email, a current authorized preference for membership email reminders, and current account/membership/event eligibility. Application and provider delivery suppression and unsubscribe checks still apply. Registration or membership alone, marketing lists, and old Circle assignments do not establish permission to send.

Email preferences may be recorded by the member or through an explicitly approved, audited admin change. An admin change is stored as `source='ops'` with a recorded actor, `action='operator_email_preference_enabled'`, `operatorApproved=true`, `memberAffirmed=false`, and a nonblank string `approvalReference`; both origins require `requested=true` and `marketingConsent=false` for the current email address. Admin approval is not described as the member's own affirmation. Legacy operator, migration, or checkout records do not qualify. The latest member withdrawal wins, SMS evidence is unchanged, and provider suppression or unsubscribe is never overridden. This release adds no public admin preference-writing endpoint.

Cohort reconciliation uses the canonical paid-reservation evidence and the member's immutable accepted `billing_schedule`, including its version and exact `callStartsAt` entry. It does not reconstruct accepted terms from the latest calendar. It requires current invitation eligibility and an active administrator behind the approved sequence. Enrollment only creates missing registrations; any existing cancellation, waitlist, or other registration state is preserved. Late payments are picked up on a later pass, with no replay of earlier reminders. Complimentary members and founder tests retain their explicitly managed rosters.

Recheck cancellation, schedule, enrollment, preference, and destination changes immediately before sending. Each member/event/schedule/stage must have a durable deduplication identity. Expired, superseded, or no-longer-qualified work is skipped; delivery retries must not replay an uncertain successful send.

Calendar links use `/my/experiences#experience-{id}`; profile links use `/my`. Members manage email reminders at `/my/account#email-reminders`, and each cadence email links directly to that account section. This email-only setting does not change SMS preferences. Templates receive plain text, not arbitrary recipient HTML. The copy includes one “All the love” closing; renderers must not append a second closing from their design.

## Deliberately inactive document workflows

| Workflow | Decision or data required before a later release |
| --- | --- |
| Registration welcome | Already automated; reconcile the existing workflow instead of adding another welcome. |
| Getting-started information / profile drips | Approved copy, actual available feature/action, completion state and links. |
| Foundations completion / Artifact earned | Final completion definition and fulfillment details. Source's 17:30 send conflicts with “2.5 hours after” a 16:30 end. |
| Missed sessions / incomplete work | Separate attendance from work completion; define required tasks, deadlines, reminder count, consequence and human follow-up. |
| Circle reveal | Completed status plus approved Circle assignment, leader/contact details, and actual next-call access. |
| Birthday / anniversary | Canonical dates, eligible member status, benefit decision, unique code/expiry, optional gift fulfillment; avoid duplicate year-one anniversary. |
| 30/90-day / six-month retention | Define first-call anchor, survey/response owner, escalation rules and which prior work to revisit. |
| Store drops / discounts / event promotions | Approved offer and eligible consented audience, timing, inventory, access and final links. The source's 25% apparel example conflicts with its later 10%/15% question. |
| Holidays / urgent changes / Circle changes | Approved dates and content, affected recipients, publication/change workflow; separate SMS channel qualification. |
| IG stories / personal texts / retention calls / gifts | Separate human or channel-specific work; never convert automatically into member emails. |
| Done / Not Doing / historical drafts | Excluded from activation and backfill. |

Source audit also found “Tomorrow” on a day-of Membership draft and conflicting Circle durations (60 versus 90 minutes). This implementation uses stage-appropriate subjects and the actual saved event schedule. It omits every unresolved task, recording, deadline, completion promise, and placeholder. New protocols require explicit rules and review before becoming active.

## Rollout verification

1. Confirm the real future event schedule, explicit kinds/tracks/cohort months, and the applicable audience source: accepted paid cohort schedules or confirmed private invitations for Foundations, explicit founder-test rosters, or canonical event/Circle eligibility for Membership/Circle calls. Check the event's email-sequence classification rather than its title.
2. Approve each reusable sequence's complete stage previews and Resend design. Inspect matching calls and any example recipients. Confirm no historical occurrence or opted-out member is eligible for delivery. Use individual plans only for exceptions.
3. Verify enabled/activation/provider gates and existing welcome/SMS separation; then enable only the approved future rules.
4. Inspect queued, skipped, sent, failed and uncertain outcomes. Recheck event changes and opt-outs before broadening the rollout.

The pure model/copy tests cover DST boundaries, founder/member differences, late activation/enrollment, expiration, invalid events, dynamic call details, real navigation destinations and incomplete-copy exclusions. They do not by themselves prove production configuration, audience accuracy, provider delivery, or visual rendering.

## Read-only rollout inventory — October 12, 2026

| Observed schedule | Aggregate registration inventory |
| --- | --- |
| Remaining October founder-test calls | 3 scheduled calls, each with 5 registered entries. |
| November Foundations | 4 scheduled calls, each with 1 registered entry. |
| December Membership and Circle calls | Already scheduled with `registration_mode='none'`; audience comes from current canonical eligibility rather than a required reservation. |

The October 12 preference audit found no recorded membership-email choice for the five October founders. They require a later member choice or explicitly approved and audited admin preference record before they can qualify. The one November registered member has an accepted membership-email preference. An authorized preference is only one qualification check and is not evidence of complete eligibility or delivery.

These are schedule, registration, and preference counts from the read-only production review, not qualified-recipient or delivery counts. Entries on separate calls may refer to the same person. Fully qualified counts remain pending verification of current opt-in, verified destination, event access, cancellation, and suppression status. This inventory does not establish that any cadence plan has been approved, enabled, or sent. Re-read it before rollout; no member names or personal details are included here.
