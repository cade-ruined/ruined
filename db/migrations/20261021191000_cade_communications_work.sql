-- CADE-only unresolved communications. This migration creates review work, never send plans or consent.
-- Fresh installations may not have Libby yet. They install the schema and defer assignment safely.
do $migration$
declare previous_check record;
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.operator_tasks'::regclass and conname = 'operator_tasks_description_cade_limit') then
    for previous_check in select conname from pg_constraint where conrelid = 'public.operator_tasks'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%char_length(description) <= 5000%'
    loop execute format('alter table public.operator_tasks drop constraint %I', previous_check.conname); end loop;
    alter table public.operator_tasks add constraint operator_tasks_description_cade_limit check (
      description is null or char_length(description) <= case when task_type = 'communications.cade_review' then 30000 else 5000 end
    );
  end if;
end;
$migration$;

create or replace function private.ruined_seed_cade_communications_work()
returns integer language plpgsql security invoker
set search_path = pg_catalog, public, private
as $seed$
declare
  assignees uuid[];
  assignee uuid;
  brief record;
  task_id uuid;
  created_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('ruined-operator-admins'), 1);
  select array_agg(account.auth_user_id) into assignees
  from public.platform_users account
  join public.people person on person.id = account.person_id and person.status = 'active'
  where account.email_normalized = 'libby@theruinedproject.com' and account.status = 'active'
    and exists (select 1 from public.platform_role_grants role where role.auth_user_id = account.auth_user_id and role.role_slug = 'ops_admin' and role.revoked_at is null)
    and exists (select 1 from public.person_email_addresses address where address.person_id = account.person_id and address.email_normalized = account.email_normalized and address.verification_state = 'verified' and address.retired_at is null);
  if coalesce(cardinality(assignees), 0) <> 1 then
    return 0;
  end if;
  assignee := assignees[1];
  perform 1 from public.platform_users where auth_user_id = assignee for update;
  perform 1 from public.platform_role_grants where auth_user_id = assignee and role_slug = 'ops_admin' and revoked_at is null for share;
  perform 1 from public.people where id = (select person_id from public.platform_users where auth_user_id = assignee) for share;
  perform 1 from public.person_email_addresses where person_id = (select person_id from public.platform_users where auth_user_id = assignee) and email_normalized = 'libby@theruinedproject.com' and verification_state = 'verified' and retired_at is null for share;

  select array_agg(account.auth_user_id) into assignees
  from public.platform_users account
  join public.people person on person.id = account.person_id and person.status = 'active'
  where account.email_normalized = 'libby@theruinedproject.com' and account.status = 'active'
    and exists (select 1 from public.platform_role_grants role where role.auth_user_id = account.auth_user_id and role.role_slug = 'ops_admin' and role.revoked_at is null)
    and exists (select 1 from public.person_email_addresses address where address.person_id = account.person_id and address.email_normalized = account.email_normalized and address.verification_state = 'verified' and address.retired_at is null);
  if coalesce(cardinality(assignees), 0) <> 1 then
    return 0;
  end if;

  for brief in select * from (values
    ('profile-drip', 'Finalize profile drip email', 'STATUS: HELD — REVIEW WORK ONLY. No delivery is enabled by this task.

DECISIONS / DEPENDENCIES
Confirm profile access/link functionality and the three-day timing before enabling.

COMPLETE CADE SOURCE COPY AND QUESTIONS
🟡 PROFILE DRIP

TIME: 3:00 PM
ONGOING CADENCE: 3 days after “A few things worth knowing.” goes out
AI REQUEST: Create ONE item in LIBBY''S WORK QUE for this communication. Include the ENTIRE communication exactly as written below, plus every outstanding issue, placeholder, or decision identified in this communication and STATUS. Do not split this communication into multiple work-queue items. Do not queue for live deployment until all outstanding items are resolved.
STATUS: YELLOW LIGHT --- COMPLETE, BUT DO NOT QUEUE FOR LIVE DEPLOYMENT. LIBBY''S WORK QUE: Confirm profile functionality, timing, and the correct profile link.

Possible subject: Make yourself recognizable.

(NAME), your RU/NED profile is ready for a little more of you.

This week: add your profile photo + bio.

[COMPLETE YOUR PROFILE]

That''s it for now.

We''ll let you know when there''s something else worth adding.

Tyler, Libby, Cade & Mitch
RU/NED
After the fear.'),
    ('foundations-completion', 'Finalize Foundations completion email', 'STATUS: HELD — REVIEW WORK ONLY. No delivery is enabled by this task.

DECISIONS / DEPENDENCIES
Agree all completion requirements, exact send timing, Artifact award/fulfillment, leader title and downstream Circle access. Do not imply completion or award an Artifact from attendance alone.

COMPLETE CADE SOURCE COPY AND QUESTIONS
FOUNDATIONS COMPLETE

TIME: 5:30 PM
ONGOING CADENCE: 2.5 hours after FOUNDATIONS 04 ends — ONLY send once a member has completed Foundations requirements.
AI REQUEST: Create ONE item in LIBBY''S WORK QUE for this communication. Include the ENTIRE communication exactly as written below, plus every outstanding issue, placeholder, or decision identified in this communication and STATUS. Do not split this communication into multiple work-queue items. Do not queue for live deployment until all outstanding items are resolved.
STATUS: YELLOW LIGHT --- COMPLETE, BUT DO NOT QUEUE FOR LIVE DEPLOYMENT. LIBBY''S WORK QUE: Define what qualifies as "completed Foundations"; confirm the Artifact and fulfillment details; confirm the replacement title for "Shaper."

Subject: You completed Foundations.

(NAME), you did it.

Four calls.

You’ve officially completed RU/NED Foundations.

You showed up. You participated. You did the work. And you’ve now completed the starting point every RU/NED member shares.

You also earned your RU/NED Artifact.

You can’t buy it. You can’t skip ahead and get one. It belongs to the people who complete Foundations.

🟡 [ARTIFACT FULFILLMENT DETAILS]

But Foundations was never meant to be the destination.

Now, your Membership changes rhythm.

You’ll move into ongoing Membership calls with the larger RU/NED community and Circle calls with a smaller group of people you’ll get to know much more closely.

Your Membership calls will follow a new rhythm:

SEE. FACE. CUT. GROW.

Your Circle will add another layer:

WHY. BUILD.

And tomorrow, we’re going to introduce you to yours.

Your Circle.
Your 🟡 [NEW LEADER TITLE].
Your people.

Foundations is complete.

And now we keep going.

Tomorrow, you’ll meet the people you’re going with.

Keep an eye on your inbox. Your Circle is next.

Tyler, Libby, Cade & Mitch
RU/NED
After the fear.

FOUNDATIONS COMPLETION / GRADUATION LOGIC: AFTER FOUNDATIONS 04, MEMBERS NEED TO FOLLOW ONE OF TWO PATHS. IF THEY HAVE COMPLETED ALL FOUNDATIONS REQUIREMENTS, THEY ARE ELIGIBLE TO GRADUATE → SEND THE FOUNDATIONS COMPLETE EMAIL → TRIGGER THEIR ARTIFACT/GRADUATION PACKET → 24 HOURS LATER SEND THEIR CIRCLE REVEAL/NEXT STEPS AND BEGIN THEIR APPLICABLE MEMBERSHIP + CIRCLE CALL COMMUNICATIONS. IF THEY HAVE NOT COMPLETED ALL FOUNDATIONS REQUIREMENTS, DO NOT GRADUATE OR ASSIGN THEM TO A CIRCLE → SEND THE INCOMPLETE FOUNDATIONS EMAIL. ONCE THEY COMPLETE THEIR OUTSTANDING REQUIREMENTS, THEY BECOME ELIGIBLE AND ENTER THE SAME STANDARD GRADUATION → CIRCLE REVEAL → MEMBERSHIP/CIRCLE COMMUNICATION PATH ABOVE.'),
    ('circle-reveal', 'Finalize Circle reveal email', 'STATUS: HELD — REVIEW WORK ONLY. No delivery is enabled by this task.

DECISIONS / DEPENDENCIES
Confirm completion eligibility, exact reveal timing (24 hours after completion versus the draft morning), verified placement/leader and call/profile access.

COMPLETE CADE SOURCE COPY AND QUESTIONS
CIRCLE REVEAL

TIME: 10:30 AM
ONGOING CADENCE: Morning after FOUNDATIONS 04 / once Circle assignments are approved — ONLY for completed members.
AI REQUEST: Create ONE item in LIBBY''S WORK QUE for this communication. Include the ENTIRE communication exactly as written below, plus every outstanding issue, placeholder, or decision identified in this communication and STATUS. Do not split this communication into multiple work-queue items. Do not queue for live deployment until all outstanding items are resolved.
STATUS: YELLOW LIGHT --- COMPLETE, BUT DO NOT QUEUE FOR LIVE DEPLOYMENT. LIBBY''S WORK QUE: Finalize Circle assignment/name logic; replacement leader title and assigned leader; Circle profile/view access; first Membership call details/access; first Circle call details/access; full calendar link; Circle communication/access instructions.

Subject: These are your people.

(NAME), meet your Circle.

You’ve been selected to join:

🟡 [CIRCLE NAME]

Your Circle is the smaller room inside RU/NED.

It’s where you’ll have conversations that don''t make sense with 50 people listening. Where people will know your name, know what you''re working through, notice when you disappear, celebrate when something finally moves, and expect you to do the same for them.

Your 🟡 [NEW LEADER TITLE]:
🟡 [NAME]

Your Circle:
🟡 [LINK TO PROFILE / CIRCLE VIEW]

These are your people.

Your Circle will meet twice each month:

WHY — a space to go deeper into what’s underneath the work.

BUILD — a space to move forward with it.

Circle calls are intentionally smaller and more personal than Membership calls. They are never recorded.

WHAT HAPPENS NEXT

Your first Membership call:
🟡 [DATE] · [TIME] MT
🟡 [ACCESS DETAILS]

Your first Circle call:
🟡 [DATE] · [TIME] MT
🟡 [ACCESS DETAILS]

Your full call calendar:
🟡 [VIEW CALENDAR]

🟡 [CIRCLE PROFILE / COMMUNICATION ACCESS INSTRUCTIONS]

You started Foundations with a room full of people.

Now you have a smaller one inside it.

Welcome to [CIRCLE NAME].

We’ll see you there.

Tyler, Libby, Cade & Mitch
RU/NED
After the fear.'),
    ('missed-incomplete', 'Finalize missed / incomplete call protocols — work with Ty + Cade', 'STATUS: HELD — REVIEW WORK ONLY. No delivery is enabled by this task.

DECISIONS / DEPENDENCIES
ONE whole protocol decision. All included drafts remain held; create no send templates or automations. Resolve every question below with Ty and Cade.

COMPLETE CADE SOURCE COPY AND QUESTIONS
MISSED SESSION COMMUNICATIONS

IMPORTANT NOTES FOR CADE

This entire section is NOT READY FOR BUILD, TEMPLATE CREATION, OR AUTOMATION.

RU/NED still needs to determine the actual process for what happens when a member:

Misses a Foundations call

Misses a Membership call

Misses a Circle call

Attends a Foundations call but does not complete the required work

Misses a Foundations call and does not complete the required work afterward

There may also need to be a distinction between a member being MISSED versus INCOMPLETE.

The communication drafts below exist so the member-facing language is mostly prepared once the operational process is finalized. They should not be templated or automated yet.

AI REQUEST

DO NOT BUILD, TEMPLATE, OR AUTOMATE ANY COMMUNICATION IN THIS SECTION YET.

Create ONE item in LIBBY''S WORKING QUEUE for the entire Missed / Incomplete Call Protocol.

LIBBY''S WORKING QUEUE ITEM:

FINALIZE MISSED / INCOMPLETE CALL PROTOCOLS — WORK WITH TY + CADE

Identify and finalize the complete process and automation triggers for:

Missed Foundations Call / Incomplete Foundations Work

Missed Membership Call

Missed Circle Call

For each call type, determine:

What specifically counts as missed

What specifically counts as incomplete, if applicable

Whether “missed” and “incomplete” are separate states/triggers

What system/data marker identifies each state

When the system checks for the missed/incomplete state

How long after the call the first check occurs

What triggers the first communication

Whether additional follow-up communications are required

If additional communications are required, how many are sent and at what intervals

What the member must do to resolve the missed/incomplete status

What counts as complete

Applicable deadline(s)

What happens if the member completes the requirement

What happens if the member does not complete the requirement by the deadline

Whether staff intervention is required at any point

What consequence or next step occurs if requirements remain incomplete

What happens to future call/program access while something remains incomplete

What information, links, recordings, work, dates, and next-call details must dynamically populate each communication

FOUNDATIONS-SPECIFIC PROCESS TO DETERMINE

Also determine what happens when someone misses Foundations and/or fails to complete the corresponding required work.

Specifically:

Can the member simply watch the recording and complete the work independently?

What exactly must they watch/complete?

How much time do they have?

Can they continue into the next Foundation while incomplete?

Does incomplete work prevent progression?

If they do not complete it within the allowed period, are they moved into the next month''s Foundations cohort at the point where they left off?

If so, how does that reset/re-entry process work?

What happens if someone repeatedly misses or fails to complete Foundations requirements?

Once the process is finalized, translate it into explicit automation logic.

Example only — NOT FINAL LOGIC:

Member must complete X → system checks X after 24 hours → if incomplete, missed/incomplete email is sent with recording/work → member must complete within X days → system checks again → if still incomplete, Y happens.

Do not assume this is the final process. Ty, Libby, and Cade must determine the actual rules first.

INCLUDE WITH THIS WORK-QUEUE ITEM:

Include all three draft email templates below so Libby can finalize the communications at the same time the triggers/process are finalized:

Missed Foundations Call

Missed Membership Call

Missed Circle Call

Once the process, triggers, deadlines, consequences, dynamic fields, and email copy are finalized, return the entire section for final approval before anything is built or automated.

STATUS

🔴 RED LIGHT — LIBBY''S WORKING QUEUE ONLY.

The communications are mostly drafted, but the operational process does not yet exist.

Do not create templates.
Do not create triggers.
Do not build automations.
Do not deploy.

Finalize the process with Ty + Cade first.

MISSED FOUNDATIONS CALL

Trigger: TBD — must be identified as part of the Missed / Incomplete Call Protocol.

Timing: TBD

Automation/Follow-Up Cadence: TBD

Completion Requirement: TBD

Deadline: TBD

Consequence/Next Step if Incomplete: TBD

STATUS: 🔴 RED LIGHT — Draft communication only. Do not template or automate until the complete protocol and trigger logic are finalized.

Subject: You missed FOUNDATIONS [##]. Here’s what happens next.

Body of Email:

(NAME), we missed you [yesterday / at FOUNDATIONS ##].

You weren’t able to join us live for:

FOUNDATIONS [##]

Foundations is built to be participated in, not consumed alone, so being in the room matters.

We also know life happens.

Missing a live call doesn’t mean you’re done or that you’re behind for good. It does mean there are a few things you’ll need to complete before moving forward.

HERE’S WHAT HAPPENS NEXT:

1. Watch FOUNDATIONS [##]
[RECORDING LINK / ACCESS INSTRUCTIONS]

2. Complete the corresponding work
[REQUIRED WORK]

3. Complete it by
[DEADLINE]

Once those pieces are complete, you’re caught up and ready to move forward.

If you need help accessing anything, reach out to us at connect@ruined.com.

Next up: FOUNDATIONS [NEXT ##]
[DATE]
[TIME] MT

We’ll see you there.

RU/NED
After the fear.

MISSED MEMBERSHIP CALL

Trigger: TBD — must be identified as part of the Missed / Incomplete Call Protocol.

Timing: TBD

Automation/Follow-Up Cadence: TBD

Completion Requirement: TBD

Deadline: TBD

Consequence/Next Step if Incomplete: TBD

STATUS: 🔴 RED LIGHT — Draft communication only. Do not template or automate until the complete protocol and trigger logic are finalized.

INSERT EXISTING MISSED MEMBERSHIP CALL EMAIL HERE.

NOTE: Review/finalize this email once the Membership-call protocol has been determined so the communication accurately reflects what the member is actually required to do after missing a call.

MISSED CIRCLE CALL

Trigger: TBD — must be identified as part of the Missed / Incomplete Call Protocol.

Timing: TBD

Automation/Follow-Up Cadence: TBD

Completion Requirement: TBD

Deadline: TBD

Consequence/Next Step if Incomplete: TBD

STATUS: 🔴 RED LIGHT — Draft communication only. Do not template or automate until the complete protocol and trigger logic are finalized.

Subject: You missed your Circle call. Here’s what happens next.

Body of Email:

(NAME), we missed you at your Circle call.

You weren’t able to join us live for:

[CIRCLE NAME] — [WHY / BUILD]
[DATE]

Circle is built around showing up with your people, so being in the room matters.

We also know life happens.

Missing a call doesn’t mean you’re suddenly outside of your Circle. It does mean there may be something you need to do before your next one.

HERE’S WHAT HAPPENS NEXT:

1. [WATCH / REVIEW / COMPLETE]
[RECORDING / RECAP / REQUIRED ACTION — IF APPLICABLE]

2. Complete any required follow-up
[REQUIRED WORK / ACTION — IF APPLICABLE]

3. Complete it by
[DEADLINE — IF APPLICABLE]

Once you''ve completed anything required above, you''re caught up and ready for the next call.

If you need help accessing anything or have questions about what you missed, reach out to us at connect@ruined.com.

Next up: [CIRCLE NAME] — [WHY / BUILD]
[DATE]
[TIME] MT

We’ll see you there.

RU/NED
After the fear.

FAILED / INCOMPLETE FOUNDATIONS

IMPORTANT: Do not create a separate communication for this yet.

First determine whether Missed Foundations and Incomplete Foundations are actually separate operational states.

A member could potentially:

Attend the live Foundations call and complete everything required

Attend the live Foundations call but fail to complete required work

Miss the live Foundations call but complete the recording/work requirements afterward

Miss the live Foundations call and fail to complete the required recording/work

Remain incomplete beyond the final deadline

Those states may require different triggers, communications, deadlines, and consequences.

The final protocol should determine whether:

A. One Foundations email dynamically handles all applicable missed/incomplete states;

OR

B. Missed Foundations and Incomplete Foundations require separate communications/automation sequences.

STATUS: 🔴 RED LIGHT — PROCESS DECISION REQUIRED. LIBBY''S WORKING QUEUE.
'),
    ('incomplete-foundations', 'Finalize Incomplete Foundations / blocked progression email', 'STATUS: HELD — REVIEW WORK ONLY. No delivery is enabled by this task.

DECISIONS / DEPENDENCIES
A separate Foundations-tab decision: define outstanding requirements, catch-up instructions, deadline, access restrictions and re-entry before using this draft. It remains held, with no send template or automation.

COMPLETE CADE SOURCE COPY AND QUESTIONS
🟡 INCOMPLETE FOUNDATIONS / BLOCKED FROM MOVING FORWARD

ONGOING CADENCE: ONLY IF/WHEN APPLICABLE — member has one or more outstanding Foundations requirements preventing completion/Circle assignment. At completion checkpoint after FOUNDATIONS 04 → IF Foundations status ≠ COMPLETE → trigger incomplete protocol.
AI REQUEST: Create ONE item in LIBBY''S WORK QUE for this communication. Include the ENTIRE communication exactly as written below, plus every outstanding issue, placeholder, trigger, rule, or decision required to complete it. Do not split this communication into multiple work-queue items. Earmark only; do not place on the live template.
STATUS: RED LIGHT --- EARMARK ONLY. DO NOT PLACE ON THE LIVE TEMPLATE. LIBBY''S WORK QUE: Finalize the completion rules and trigger definition; outstanding-requirements logic; catch-up instructions; deadline logic; and any remaining yellow-marked placeholders.

Subject: Your Foundations still needs to be completed.

(NAME), you’ve reached the end of your Foundations month, but you still have some work to complete.

Foundations is the starting point for every RU/NED member, and completing it is what allows you to move into the ongoing rhythm of Membership and be assigned to your Circle.

Right now, we’re still missing:

🟡 [OUTSTANDING FOUNDATIONS REQUIREMENTS]

Because those pieces are incomplete, we haven’t assigned you to a Circle yet.

That doesn’t mean you’re out. It means we need to get you through the rest of Foundations before you move forward.

HERE’S WHAT YOU NEED TO DO:

🟡 [SPECIFIC COMPLETION/CATCH-UP INSTRUCTIONS]

COMPLETE BY:

🟡 [DEADLINE]

Once your outstanding Foundations requirements are complete, we’ll confirm your completion and get you ready to move into your Circle and ongoing Membership.

If you’re stuck, confused about what you still need to complete, or something is preventing you from moving forward, please don’t disappear.

Reach out to us at connect@ruined.com so we can help you figure out what comes next.

You’re not being asked to start over. We just need you to finish what you started.

RU/NED
After the fear.

FOUNDATIONS COMPLETION / GRADUATION LOGIC: AFTER FOUNDATIONS 04, MEMBERS NEED TO FOLLOW ONE OF TWO PATHS. IF THEY HAVE COMPLETED ALL FOUNDATIONS REQUIREMENTS, THEY ARE ELIGIBLE TO GRADUATE → SEND THE FOUNDATIONS COMPLETE EMAIL → TRIGGER THEIR ARTIFACT/GRADUATION PACKET → 24 HOURS LATER SEND THEIR CIRCLE REVEAL/NEXT STEPS AND BEGIN THEIR APPLICABLE MEMBERSHIP + CIRCLE CALL COMMUNICATIONS. IF THEY HAVE NOT COMPLETED ALL FOUNDATIONS REQUIREMENTS, DO NOT GRADUATE OR ASSIGN THEM TO A CIRCLE → SEND THE INCOMPLETE FOUNDATIONS EMAIL. ONCE THEY COMPLETE THEIR OUTSTANDING REQUIREMENTS, THEY BECOME ELIGIBLE AND ENTER THE SAME STANDARD GRADUATION → CIRCLE REVEAL → MEMBERSHIP/CIRCLE COMMUNICATION PATH ABOVE.'),
    ('future-events', 'Finalize future event communications', 'STATUS: HELD — REVIEW WORK ONLY. No delivery is enabled by this task.

DECISIONS / DEPENDENCIES
ONE category decision covering future events. All event drafts below remain held; create no templates or automation.

COMPLETE CADE SOURCE COPY AND QUESTIONS
EVENT COMMS

Possible future events:

LEAD — likely Jan/Feb 2027

Potential member/couples retreat — potentially fall 2027

Future BYOB / other RU/NED events

Once event details exist, member communication should follow:

Member announcement → member registration/access → reminder → logistics → final reminder → post-event

Potential benefits to decide with partners:

[TBD: Do members get first access?]

[TBD: Member discount?]

[TBD: Reserved/guaranteed inventory?]

[TBD: Member-only events?]

[TBD: How far ahead do members hear about events?]

Timing: TBD based on event

AI REQUEST: DO NOT BUILD OR AUTOMATE EVENT COMMS. Event communications are event-specific and require finalized event details, timing, access, pricing, benefits, registration, logistics, and other event-specific decisions. Keep the full Event Comms category and communication sequence in LIBBY''S WORKING QUEUE ONLY until an individual event is ready to be built.

STATUS: 🔴 RED LIGHT — LIBBY''S WORKING QUEUE ONLY. Do not build or automate at this time.

SAMPLE MEMBER ANNOUNCEMENT EMAIL

Subject: You''re hearing about this first.

Body of Email:

(NAME), we''re doing something.

[EVENT NAME]

[SHORT HUMAN DESCRIPTION OF WHAT IT IS.]

Before we announce it publicly, we wanted RU/NED members to hear about it first.

WHEN: [DATE/TIME]

WHERE: [LOCATION]

MEMBER DETAILS: [EARLY ACCESS / PRICING / REGISTRATION DETAILS]

LEARN MORE / REGISTER: [LINK]

We''ll share more as we get closer.

For now, you know before everybody else does.

RU/NED
After the fear.'),
    ('anniversary-later-years', 'Develop registration anniversary communications for year two and beyond', 'STATUS: HELD — REVIEW WORK ONLY. No delivery is enabled by this task.

DECISIONS / DEPENDENCIES
The approved automated anniversary is year one only. Define copy, meaning, timing and any verified benefit for later years before implementation.

COMPLETE CADE SOURCE COPY AND QUESTIONS
MEMBER REGISTRATION ANNIVERSARY

Trigger: Registration anniversary
Frequency: Annually
Important: Year one ALSO serves as the 1-year ongoing onboarding milestone. Do not send two separate emails.

AI REQUEST: Automate this email to send on the one-year anniversary of each active member''s registration date. Insert the member''s first name. This email replaces any separate 1-year ongoing onboarding email. Add applicable anniversary badge/trigger if applicable.

STATUS: 🟢 GREEN LIGHT — Year-one email is baked and ready to build/automate. 

Subject: A year ago today.

Body of Email:

(NAME), a year ago today, you joined RU/NED.

Since then, you''ve moved through Foundations.

You''ve sat in Membership calls.

You''ve found your Circle.

You''ve done work nobody else could do for you.

And hopefully, somewhere in all of that, something moved.

Go back for a minute and think about the person who registered a year ago.

What were they trying to figure out?

What were they carrying?

What did they want to change?

What did they have absolutely no idea was coming?

A year is long enough for a lot to happen.

We''re glad you spent part of yours here.

Happy RU/NED anniversary, (NAME).

Tyler, Libby, Cade & Mitch
RU/NED
After the fear.'),
    ('birthday-gift', 'Define the member birthday item and redeemable gift code', 'STATUS: HELD — REVIEW WORK ONLY. No delivery is enabled by this task.

DECISIONS / DEPENDENCIES
Select the designated birthday item, eligibility, seven-day single-use 100% item code, shipping and fulfillment, and provider integration. Do not send the gift promise before it is redeemable.

COMPLETE CADE SOURCE COPY AND QUESTIONS
MEMBER BIRTHDAY

Trigger: Member''s birthday
Channel: Email only
Perk: One members-only RU/NED birthday item, free
Expiration: 7 days

AI REQUEST: Automate this email to send on each active member''s birthday. Insert the member''s first name and unique birthday code. Code should provide 100% off the designated members-only RU/NED birthday item and expire after 7 days. Add applicable birthday badge/trigger if applicable.

STATUS: 🟢 GREEN LIGHT — Baked and ready to build/automate.

Subject: Happy birthday, (NAME).

Body of Email:

(NAME), happy birthday.

We considered sending you something profound about another trip around the sun.

We decided against it.

Instead, here''s something you''ll actually use:

A members-only RU/NED birthday item. On us.

YOUR CODE: [BIRTHDAY CODE + NAME]

It''s good for the next 7 days, because apparently birthdays have expiration dates now.

We hope today is a good one. Whatever that looks like for you.

Happy birthday from all of us.

Tyler, Libby, Cade & Mitch
RU/NED
After the fear.'),
    ('review-badge', 'Finalize the 30-day review link and verified badge', 'STATUS: HELD — REVIEW WORK ONLY. No delivery is enabled by this task.

DECISIONS / DEPENDENCIES
Provide the approved review destination and reliable evidence that the review was completed before awarding its badge. Anchor the email to the first attended Membership call.

COMPLETE CADE SOURCE COPY AND QUESTIONS
30-DAY MEMBER CHECK-IN

Timing: 30 days after first Membership call

AI REQUEST: Automate this email to send 30 days after the member''s first Membership call. Insert member''s first name and applicable review link. Include the associated review/badge functionality where applicable.

STATUS: 🟢 GREEN LIGHT — Baked and ready to build/automate.

Subject: You know how this works now.

Body of Email:

(NAME), you''ve been doing this long enough that RU/NED probably doesn''t feel completely new anymore.

You''ve been in Membership calls.

You''ve met your Circle.

You''ve done some of the work.

So this feels like a good time to remind you of something:

RU/NED was built to be participated in, not consumed alone.

The calls matter.

The work between them matters.

Your Circle matters.

And what you bring into all of those things matters too.

You don''t need to do RU/NED perfectly.

You do need to use it.

Show up. Do the work. Talk to your people. Ask questions. Say something when you''re stuck. Let somebody know when something finally moves.

You''re not new anymore.

You''re in it.

And we''re glad you''re here.

LOVE WHAT WE ARE DOING? LEAVE A REVIEW {LINK} + GET A BADGE

Tyler, Libby, Cade & Mitch
RU/NED
After the fear.'),
    ('survey-badge', 'Finalize the 90-day survey and completion badge', 'STATUS: HELD — REVIEW WORK ONLY. No delivery is enabled by this task.

DECISIONS / DEPENDENCIES
Provide the finalized survey link and a verified completion-to-badge process. Do not award a badge merely because the email was sent. Anchor to the first attended Membership call.

COMPLETE CADE SOURCE COPY AND QUESTIONS
90-DAY MEMBER CHECK-IN

Timing: 90 days after first Membership call

AI REQUEST: Automate this email to send 90 days after the member''s first Membership call. Insert member''s first name and the finalized short check-in link.

STATUS: 🟢 GREEN LIGHT — Copy is baked and ready to build/automate once the check-in link/form is connected.

Subject: Okay. How''s it actually going?

Body of Email:

(NAME), you''ve been inside RU/NED long enough now to have an actual opinion about it.

So we want to know:

How''s it actually going?

Not the polite answer.

What''s working?

What''s changing?

Where are you stuck?

Is there something you need that you''re not getting?

[COMPLETE THIS VERY SHORT CHECK-IN: LINK]

You don''t need to write us an essay.

Unless you want to. Then apparently we''re reading an essay.

We just want to know how you''re doing inside this thing we''re asking you to participate in.

RU/NED'),
    ('six-month-artifact', 'Finalize the six-month Artifact and member follow-through', 'STATUS: HELD — REVIEW WORK ONLY. No delivery is enabled by this task.

DECISIONS / DEPENDENCIES
Choose the exact work to revisit, confirm member access, decide the Artifact trigger and fulfillment queue. Do not promise an Artifact on an unverified trigger. Anchor to the first attended Membership call.

COMPLETE CADE SOURCE COPY AND QUESTIONS
6-MONTH MEMBER CHECK-IN

Timing: 6 months after first Membership call

AI REQUEST: Automate this email to send 6 months after the member''s first Membership call. The email must connect the member back to the applicable Foundations work identified for this milestone. Finalize which specific Foundations artifact/response is surfaced and how the member accesses it before implementation.

STATUS: 🟢 GREEN LIGHT — Copy and trigger are baked. Ready to build once the specific Foundations artifact/access logic is connected.

Subject: Go look at what you wrote.

Body of Email:

(NAME), go back six months.

Not metaphorically. We actually want you to go look.

During Foundations, you [SPECIFIC THING THEY COMPLETED — LETTER / TIMELINE / ORIGINAL RESPONSE / ETC.]

Open it.

Read what you wrote.

Then pay attention to what feels different now.

What changed?

What didn''t?

What did you think would matter that doesn''t anymore?

What matters now that wasn''t even on your radar then?

And where are you still avoiding the exact same thing?

Six months isn''t enough time to become an entirely different person.

Good.

That was never the assignment.

But it is enough time to look backward and notice movement you couldn''t see while you were in it.

Go look.

Then keep going.

Tyler, Libby, Cade & Mitch
RU/NED
After the fear.'),
    ('clothing-benefits', 'Decide clothing-drop member access and benefits', 'STATUS: HELD — REVIEW WORK ONLY. No delivery is enabled by this task.

DECISIONS / DEPENDENCIES
Determine early-access duration, members-only pieces / colorways / collections, Members Only Closet and whether any discount exists. The 25% line is conditional sample copy, not an approved benefit.

COMPLETE CADE SOURCE COPY AND QUESTIONS
CLOTHING DROPS

Timing: As-needed based on individual drop.

LIBBY''S WORKING QUEUE: Determine member-access strategy for clothing drops, including how early members receive access, whether RU/NED creates members-only items/colorways/collections, whether there is a Members Only Closet, and what member discount—if any—applies.

AI REQUEST: Create/save this as a reusable clothing-drop email template. Do not automate sending. This communication will be selected and manually adjusted with the applicable collection, access dates, link, member benefit/discount, and other drop-specific information before being reviewed and sent as-needed.

STATUS: 🟡 YELLOW LIGHT — Verbiage/template is baked and ready to create. Final details and send are manual/one-off.

Subject: You get it first.

Body of Email:

(NAME), we made something new.

And before we put it in front of everyone else, we''re giving RU/NED members first access.

[DROP / COLLECTION NAME]

MEMBER ACCESS STARTS: [DATE/TIME]

PUBLIC ACCESS STARTS: [DATE/TIME]

SHOP EARLY: [LINK]

[IF MEMBER DISCOUNT EXISTS: Your member code gets you 25% off: [CODE]]

Some pieces may be limited, so if you want something, this is your head start.

Go look.

RU/NED
After the fear.')
  ) as source(key, title, description)
  loop
    task_id := null;
    insert into public.operator_tasks(task_type, title, description, priority, status, assigned_to_auth_user_id, created_by_type, idempotency_key)
    values ('communications.cade_review', brief.title, brief.description, 'normal', 'open', assignee, 'system', 'cade-communications-20261021:' || brief.key)
    on conflict (idempotency_key) where idempotency_key is not null do nothing returning id into task_id;
    if task_id is not null then
      created_count := created_count + 1;
      insert into public.operator_task_events(operator_task_id, event_type, next_status, actor_type, evidence, dedupe_key)
      values (task_id, 'created', 'open', 'system', jsonb_build_object('source', 'cade_communications_20261021', 'reviewKey', brief.key, 'assignedTo', assignee, 'deliveryEnabled', false), 'cade-communications-20261021:' || brief.key || ':created')
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;
  return created_count;
end;
$seed$;

revoke all on function private.ruined_seed_cade_communications_work() from public, anon, authenticated;
do $permissions$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function private.ruined_seed_cade_communications_work() to service_role;
  end if;
end;
$permissions$;

select private.ruined_seed_cade_communications_work();
