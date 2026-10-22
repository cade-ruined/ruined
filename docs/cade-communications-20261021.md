# CADE communications rollout

Source: only the four CADE tabs in the Memberships Communication Cadence document reviewed on October 21, 2026. Other document tabs are outside this change.

## Communications team

Use **Operations → Communications → Emails → By step**. Open a call sequence to edit its reminders. Registration, recurring milestone and manual templates also have saved subject/body editing; being approved does not make wording permanent.

- Registration: edit the welcome, “A few things worth knowing,” or profile-access message. Required payment facts and accepted terms remain controlled by the registration workflow.
- Calls: edit the reusable sequence to update future matching calls and cohorts. Individually customized or paused calls keep their settings.
- Birthdays, holidays and milestones: save changes while paused, inspect the saved preview, then enable only when the listed decisions are resolved.
- One-off messages: save reusable template wording, finish every placeholder, then choose and review recipients in the composer.
- Libby’s work queue: each of the 12 marked items has its own task, full source copy and outstanding decisions. Incomplete Foundations is separate from the complete Missed Session protocol.

## Behavior

A new welcome’s confirmed delivery starts the 24-hour clock for “A few things worth knowing.” It waits for actual profile access, confirmed Foundations timing and current email permission. Old welcomes do not create follow-ups. Prepared messages retain their exact bytes on retry.

Call reminders use actual scheduled call dates, type, duration and Circle name. Foundations 01 sends its morning email at 8 a.m. Mountain Time and its SMS 150 minutes before the call. Other day-of call emails are 150 minutes before their calls. Existing SMS consent and stop handling remain authoritative.

The one-year anniversary anchors to completed registration and requires actual Foundations completion, Circle membership and Membership-call attendance. The canonical badge collection independently awards the One Year badge from the registration anniversary, using its existing access, uniqueness and visibility controls. Email consent does not affect that earned milestone. Later-year anniversaries remain held. The 30-day, 90-day and six-month check-ins anchor to the first confirmed attended Membership call. Rule activation and recipient enrollment are future-only boundaries; expired milestones never backfill.

Annual closure markers show separate Thanksgiving/Black Friday, Christmas, New Year, Memorial Day, July 4 and Labor Day periods. They do not cancel or reschedule calls. Holiday emails require explicit year-specific closure, return-date and schedule-change settings.

## Held decisions

No unfinished missed-session, incomplete-work or future-event protocol sends or changes access. Profile drip, graduation and Circle-reveal emails remain held. Birthday benefits need an approved item and valid discount-code implementation. The 30-day review badge needs verified completion logic; the 90-day form needs its final URL. Six-month work and Artifact fulfillment need an explicit selection; only verified completed Timeline work is currently connected. Clothing copy does not approve the conditional 25% example.

The 12 tasks are: profile drip; Foundations completion; incomplete Foundations; Circle reveal; the full Missed Session protocol; future events; year-two-and-later anniversaries; birthday benefit; 30-day check-in; 90-day check-in; six-month work/Artifact; clothing member benefits.

## Release checks

Apply the five October 21 migrations in order before deploying the worker. They add the durable follow-up, review tasks, inactive lifecycle rules, private template overrides and the one-year badge progress rule. They do not send email or activate new lifecycle rules.

Review the actual saved design before activating the ready first-anniversary, RU/NED birthday and New Year rules. Keep all unresolved rules disabled. Preserve any operator-authored call-message overrides; stored sequences without explicit message overrides use the new approved defaults automatically.

Verify the deployed revision, live editing controls, 12 separately assigned tasks, held statuses, and future-only recurring approval. Do not invoke a live delivery worker for testing.
