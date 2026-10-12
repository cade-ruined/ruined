# Member email cadence

This release covers event-linked email reminders from the October 2026 founder test and November/future member cadence. It does not turn the entire communications document into a send list. Existing registration welcome delivery and SMS automation remain separate and unchanged.

## Explicit event classification

An operator selects a track (`founder_test` or `members`) and kind (`foundations_01` through `foundations_04`, `membership`, or `circle`) for a real scheduled event. Never infer a Foundations stage, Circle, or audience from an event title. The event supplies its current title, start/end time, timezone, and authorized calendar access.

Each approved plan belongs to one saved event. The October test and November/future timing rules do not create calls, enroll a cohort, or generate an infinite recurring schedule. An operator must create and approve the actual upcoming events and their audience rules; later cohorts need their own event plans. Listed dates are timing examples until the corresponding event, audience, and plan have been verified.

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
| Foundations, or any founder-test track | Explicit confirmed call registrations. Founder-test registrations must additionally have `source='ops'`; there is no inferred founder list. |
| Membership with `registration_mode='none'` | Canonical currently eligible members with access to that event. A reservation is not required. |
| Circle with `registration_mode='none'` | Canonical currently eligible members assigned to that specific Circle and authorized for the event. Historical assignments do not qualify. |
| Other supported calls with internal registration | Explicit confirmed call registrations and current event access. |

An explicit call-registration cancellation suppresses reminders even when the event otherwise requires no reservation. Every candidate still needs a verified current email, a current recorded opt-in for membership email reminders, and current account/membership/event eligibility. Application and provider delivery suppression and unsubscribe checks still apply. Registration or membership alone, marketing lists, and old Circle assignments do not establish permission to send.

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

1. Confirm the real future event schedule, explicit kinds/tracks, and the applicable audience source: confirmed Foundations/founder-test rosters, or canonical event/Circle eligibility for Membership/Circle calls with no reservation. Verify founder-test registrations were explicitly created by an administrator.
2. Preview each stage's recipients, rendered content, local time and expiry without sending. Confirm no historical occurrence or opted-out member appears.
3. Verify enabled/activation/provider gates and existing welcome/SMS separation; then enable only the approved future rules.
4. Inspect queued, skipped, sent, failed and uncertain outcomes. Recheck event changes and opt-outs before broadening the rollout.

The pure model/copy tests cover DST boundaries, founder/member differences, late activation/enrollment, expiration, invalid events, dynamic call details, real navigation destinations and incomplete-copy exclusions. They do not by themselves prove production configuration, audience accuracy, provider delivery, or visual rendering.

## Read-only rollout inventory — October 12, 2026

| Observed schedule | Aggregate registration inventory |
| --- | --- |
| Remaining October founder-test calls | 3 scheduled calls, each with 5 registered entries. |
| November Foundations | 4 scheduled calls, each with 1 registered entry. |
| December Membership and Circle calls | Already scheduled with `registration_mode='none'`; audience comes from current canonical eligibility rather than a required reservation. |

The October 12 preference audit found no recorded membership-email choice for the five October founders; they must make their own choice in Account before they can qualify. The one November registered member has an accepted membership-email preference. An accepted preference is only one qualification check and is not evidence of complete eligibility or delivery.

These are schedule, registration, and preference counts from the read-only production review, not qualified-recipient or delivery counts. Entries on separate calls may refer to the same person. Fully qualified counts remain pending verification of current opt-in, verified destination, event access, cancellation, and suppression status. This inventory does not establish that any cadence plan has been approved, enabled, or sent. Re-read it before rollout; no member names or personal details are included here.
