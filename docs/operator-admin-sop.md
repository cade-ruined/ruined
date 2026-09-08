# Ruined Operator SOP

**For:** Administrators who operate the Ruined member experience

**Version:** 1.4

**Last reviewed:** 8 September 2026

## The simple mental model

The operator side answers seven questions:

1. **Overview:** What is happening right now?
2. **Members:** Who needs help?
3. **Circles and Blocks:** Where does each member belong?
4. **Foundations:** How far has each member moved?
5. **Experiences and Academy:** What are members attending and learning?
6. **Artifacts and communications:** What are members receiving and hearing?
7. **Work and System:** What needs an operator to act?

Start on **Overview**. Move into a person, Circle, Experience, or work item only when the snapshot gives you a reason.

### Where to click first

- **Members:** search first, then **Open member record**. **Allow member email** is a separate action for someone new; it does not send an invitation email or create their sign-in account. Share the sign-in address after allowing it.
- **Inside a member record:** use **Create task**, **Add internal note**, or **Correct profile detail** near the top. The linked forms are visible in the record; there is no extra “manage” drawer to find.
- **Operators:** **Choose existing member** keeps one person on one account. **Add operator** is for a new invitation; a saved invitation stays pending until the person accepts through `/access`.
- **Announcements:** **Write announcement** opens the visible draft form. Save first, then use **Review & publish** on the draft and verify the audience before selecting **Publish**.
- **Notifications:** check **Recent delivery**, then **Write notification → Review notification → Send notification**. Choose the audience explicitly. Notifications are in-app, not email or text.
- **Support:** open a request, then use **Reply to member**, **Update status**, or **Find member record**. Sending a reply and changing status are separate actions.

### One person, two separate actions

**Circle placement** gives a member their group. **Operator access** gives that same person permission to help run Ruined. Neither action completes the other, and Administrator access does not require a Circle placement.

For an existing member, open **Members → their record → Overview**:

1. **Assign Circle** opens **Circles** with that member in context. Choose a Circle with space, open **Manage members** on that Circle, review the selected person, then deliberately select **Add to [Circle name]**. A **Forming** Circle can receive its first member before activation.
2. **Review operator access** opens their separate access review. Choose the intended responsibility, review its scope, then deliberately send an invitation. For an existing pending or active operator, review the existing record instead of inviting them again.

Opening either link does not assign a Circle, send an email, or grant access. You do not need to create a second account, repeat member onboarding, or change billing to invite an existing member as an operator. Member eligibility checks still apply to Circle placement.

---

## 1. Before adding a new operator

An operator account is not open signup. An active Administrator must invite every new operator.

The first Administrator cannot be created through the operator screen; that account and role must be provisioned internally. The workflow below adds every subsequent Administrator.

Before sending an invitation:

- Confirm the person's full name and working email.
- Give each person their own account. Never share an operator login.
- Choose the smallest responsibility that fits their work:
  - **Administrator:** full access to members, programs, systems, communications, Artifacts, and other operators.
  - **Shaper:** leads the selected Circle or Circles.
  - **Guide:** supports members and Experiences inside the selected Circle or Circles.
- Give **Administrator** access only after the person has been approved to see private member, billing, and operational information.
- Look at the environment label in the header:
  - **Preview** means fixture data for safe review. Account, persistence, and communication actions are disabled or explicitly non-live; not every control will complete.
  - **Operator access / Live** means changes are recorded and communication actions may contact real people.
  - **Unavailable** means a required service is disconnected; do not try to work around it.

The deployment URL and the in-app environment are not the same thing. A Vercel preview deployment can be connected to a real database and send real communications. Confirm the intended deployment and database with the system owner before every training session.

> **Important:** Train with drafts and preview data whenever possible. Publishing an Experience or announcement—or sending a notification—can communicate with real members in a connected environment.

---

## 2. Add a new Administrator

The existing Administrator does this part.

1. Sign in through **`/access`** on the current Ruined deployment, then select **Operations** from your member profile.
2. Open **Admin → Operators** on desktop or **Administration → Operators** on mobile. For an existing member, their record's **Review operator access** link carries their verified record details into this screen.
3. Select **Add operator** for someone new, or **Review operator access** beside the selected existing member.
4. Enter the person's **full name** and **email**, or review the prefilled member details. If an invitation or operator record already exists for that email, use that record instead.
5. Choose **Administrator**.
6. Read and check the full-access confirmation.
7. Select **Send invitation**.
8. Read the result message, then confirm that the person appears in the operator list as **Invitation pending**:
   - **Invitation sent** means the request succeeded.
   - **Invitation saved, but the email was not delivered** means access is still pending; use **Send again** if another code delivery is needed.
9. Separately give the new operator the `/access` URL for the correct Ruined deployment. The email contains a code, not a durable invitation link.

What the system does:

- Creates a seven-day operator invitation.
- Asks Supabase to send a short-lived numeric access code through the Ruined authentication system.
- Records who created the invitation and what access was granted.
- Gives an Administrator access to every area; no Circle selection is needed.

For a **Shaper** or **Guide**, choose at least one Circle before sending the invitation. Their access remains limited to those assigned Circles.

That selection defines **which Circles they may operate**, not which Circle they personally belong to as a member. Do not move their member placement to unlock an operator role.

### If the invitation must change

- **Same email:** use **Send again**. This replaces the previous pending invitation and sends a new code.
- **Different email:** revoke the pending invitation, then create a new one. The resend screen intentionally locks the original address.
- **Invitation no longer needed:** use **Revoke**.
- **Active operator should no longer have access:** use **Remove**. This immediately blocks operator actions through server-side role checks and ends active Circle staff assignments while keeping history. It does not delete the person's Supabase identity, automatically close an already-open browser session, or remove a separate Ruined member role the same person may also hold.
- **Active operator needs a different role or Circle scope:** remove the existing operator access, then issue a new invitation with the correct responsibility and scope. Active access is not edited in place.
- An Administrator cannot remove their own access, and Ruined will not allow the last active Administrator to be removed.

---

## 3. The new Administrator's first login

The new operator does this part.

1. Open **`/access`** on the current Ruined deployment.
2. Enter the exact email address that received the invitation.
3. Select **Send access code**.
4. Open the newest Ruined access email.
5. Enter the newest six-to-ten-digit numeric code.
6. Select **Continue**. A successful first login activates the operator account and normally opens their member profile.
7. Select **Operations** to open the operator **Overview**.
8. Ask the existing Administrator to confirm that the operator row now shows **Active**.

The seven-day invitation and the short-lived access code have separate expiration times. Opening the access page and selecting **Send access code** may create a newer code than the one sent with the invitation. **Always use the newest code email.**

Members and operators share the same `/access` page. The verified email determines access; there is no separate operator login. The old `/ops/access` and `/my/access` addresses redirect there. Returning operators do not need a new invitation while their operator access remains active.

**Already signed in as a member?** After the invitation is created, open `/access` on the same deployment. An existing verified session can accept the pending access without signing out or requesting another code. If the sign-in form appears, verify the newest code for the invited email. Then check **Operators** for **Active**; seeing an invitation pending is not the same as active access.

Operators receive a basic member profile without a payment requirement for operator work. This does not grant paid membership benefits or change an existing member's billing state. If their member access was deliberately revoked, suspended, or closed, valid operator access can still open **Operations** directly without restoring the member account.

### If the code does not arrive

1. Confirm the spelling of the invited email.
2. Check spam, junk, and filtered folders.
3. Wait briefly. On the access screen, select **Use another email**, enter the same address, and select **Send access code** once. This requests another code without replacing the invitation.
4. Use only the newest code.
5. If it still does not arrive, stop resending. Give the system owner the email address and exact request time so delivery can be checked.

An existing Administrator can instead open **Operators → Send again**. That action replaces the pending invitation, restarts its seven-day period, and attempts another code delivery. Use it when the invitation itself needs to be refreshed—not as the operator's first retry.

The message “an access code is on its way” protects account privacy. It does not, by itself, prove that an email reached the inbox.

---

## 4. Responsibilities and permissions

| Responsibility | What they can work with | What they cannot do |
| --- | --- | --- |
| **Administrator** | Every member, Circle, Block, Experience, Academy item, Artifact, support ticket, communication, task, system status, and operator | Cannot bypass payment, agreement, or Foundations-completion evidence; cannot remove themselves or the final Administrator |
| **Shaper** | Members, progress, community information, rosters, and meetings inside assigned Circles; can create and define assigned-Circle meetings | Cannot see administration or global management areas; cannot work outside assigned Circles |
| **Guide** | Members, progress, community information, and existing Experience rosters inside assigned Circles | Cannot see administration or global management areas; cannot work outside assigned Circles or create and define Experiences |

Shapers and Guides share the same selected-Circle data boundary, but their Experience controls differ. The **Shaper holds the Circle and can define its meetings**; a **Guide supports the work and roster inside it**. Only one active or pending Shaper can hold a Circle at a time.

The support queue is private to Administrators. Shaper or Guide access does not reveal members' support conversations.

---

## 5. What every operator section does

### Daily work

| Section | Use it for | Key things to know |
| --- | --- | --- |
| **Overview** | The latest activity, active-member count, members needing attention, Foundations movement, members without a Circle, open work, and upcoming Experiences | This is the starting point. Follow the item that needs a decision instead of browsing every record. |
| **Members** | Search by name, email, Circle, or Block; filter for attention, Foundations, or no Circle; open the complete member record | Administrators can also allow a new member email to join. That allowance **does not send an email**; the member must be directed to `/access`. |
| **Circles** | Open **Manage members** on a Circle to view its roster, add or remove members, and activate it; use the visible creation and setup sections below | A Circle holds up to ten members. Members can start Foundations without one, but they need a current assignment to an active Circle to finish. |
| **Foundations** | See who has not started, is moving, needs a Circle, or is complete | This is a progress and attention view. Operators do not manually complete Foundations. Completion requires the member-created Timeline, Future Letter, and a current assignment to an active Circle. |
| **Experiences** | Create the event calendar; manage drafts, audiences, registration, capacity, rosters, waitlists, attendance, Google Calendar invitations, Meet links, completion, cancellation, and archives | Save as a draft first. **Publish + send invite** is a real communication action when Google Calendar is connected. |
| **Work** | See prioritized member tasks, Artifact production work, and failed automations | Work highest urgency first. Claim, complete, or reopen tasks; retry an automation only when its cause is understood. The link is visible to every operator role, but the current combined queue is populated for Administrators only. |

### Manage — Administrators only

| Section | Use it for | Key things to know |
| --- | --- | --- |
| **Support** | Read signed-in members' categorized requests, reply, and track open, in-progress, waiting-for-member, and resolved tickets | Reply inside the ticket. When enabled, email alerts connect@ and the member but does not synchronize email replies. Members see only their own requests and can ask for help even when payment needs attention. |
| **Academy** | Create lessons and collections; add video, article, audio, PDF, download, or link content; choose audiences; publish, unpublish, or retire | Saving creates a new version. Members keep seeing the published version until a new version is deliberately published. |
| **Blocks** | Group multiple Circles into a larger operating unit | A Block needs at least two current Circles to activate. A Block does not change the Foundations completion rule. |
| **Artifacts** | Bind Artifact templates to Shopify, award Artifacts, move production work, and record fulfillment and tracking | Verify the live Shopify Product GID and handle in Shopify before publishing a live template. The operator binding badge does not prove the product exists in Shopify. An award opens production work and becomes part of the member record. |
| **Announcements** | Draft and publish a durable update to all active members, a Block, a Circle, or one member | Draft first and review the audience. Published announcements become part of the member experience; they are not general email blasts. |
| **Notifications** | Send an immediate in-app message to all active members, a Block, a Circle, or one member | Choose the audience, type, title, message, and optional member-app link. The page shows delivery and read state. “Delivered” means stored in the member app, not delivered by email or SMS. |

### Administration — Administrators only

| Section | Use it for | Key things to know |
| --- | --- | --- |
| **Operators** | Invite Administrators, Shapers, and Guides; assign Circle scope; resend or revoke invitations; remove access | A pending invitation lasts seven days. Non-admin roles require at least one Circle. All changes are recorded. |
| **System** | Check Supabase identity, Postgres records, Stripe billing connection, notification delivery, Google Calendar, and failed automations | This is the first place to look when something that should happen automatically does not happen. Shopify binding health appears in Artifacts rather than here. A green status reflects configuration or recorded success; it is not always a live end-to-end provider test. |

---

## 6. The member record

Open a member from **Members**. Their record is organized into five parts:

| Part | What it tells you |
| --- | --- |
| **Overview** | The person's current states and the next item most likely to need a decision |
| **Membership** | Administrative onboarding, contact details, agreement evidence, Stripe billing state, cancellation state, and Profile support controls |
| **Journey** | Foundations progress, earned Artifacts, and Experience participation |
| **Community** | Current Circle, Block, Shaper, meetings, and shared resources |
| **Record** | Internal tasks, notes, visible task/note forms, audited state corrections, and operating history |

### How to support a member safely

- Use **Profile support** to correct one verified detail at a time. Record why the correction is needed.
- Use a **task** when someone must follow up. Add a clear owner through Claim, a priority, and a due date when useful.
- Use an **internal note** only for factual information needed to serve the member. Choose the correct category.
- Use a **state correction** only when there is reliable evidence that the record is wrong. Every correction requires a reason and retains the prior state.
- Payment, agreement acceptance, and Foundations completion cannot be corrected with an operator override.
- Treat private profile, accessibility, billing, address, and contact information as confidential. Do not copy it into broad notes or communications.

---

## 7. Core operating workflows

### A. Place a member into a Circle

1. Open **Members → the member's record → Overview → Assign Circle**, or open **Circles** directly. The member-record link carries the person into the Circle page; the banner asks you to choose a Circle and open **Manage members**.
2. Find a **Forming** or **Active** Circle with space. Select **Manage members** on that Circle. Its roster and actions open directly underneath it—there is no separate global assignment form.
3. Under **Add member**, review the selected person or choose another eligible member. Read any eligibility message, then select **Add to [Circle name]** once. Confirm the saved result and updated roster. Merely choosing a person or opening the panel does not change their placement.
4. If a new Circle is needed, use the visible **Create a Circle** section below the Circle list. Enter its name and select **Create Circle**. It begins **Forming** with ten places; return to its **Manage members** panel to add the first member.
5. Use **Shapers & resources** below the Circle list to assign the Shaper and approved, published resources. These setup controls are visible, not hidden inside another drawer. Each resource keeps its exact selected version.
6. Create the private Google Chat space in Google, then save its approved URL in the Circle's Chat link field. Ruined links to existing spaces; it does not create them.
7. When a forming Circle has at least one member and is ready to run, open its **Manage members** panel and select **Activate [Circle name]**, then **Confirm activation**. Review Shaper coverage, Chat, resources, and the first meeting beforehand. **Add members before activation.** Activation changes the whole Circle, not just the selected member.
8. Circle roster and Block changes queue Calendar audience updates for linked Experiences. Check the affected Experience's Calendar status; use **Sync invitations** when an immediate explicit sync is needed. A saved roster or pending update does not prove that Google has delivered invitations.

Only unassigned members with an active account, active billing, and onboarding/active program state can be added. The server also verifies current membership and eligibility when saving. If a person is missing or blocked, review the stated prerequisite in their record; do not change payment or agreement evidence to bypass it. A current roster still includes people whose payment or account later changed, so their existing placements can be reviewed accurately.

**To remove a member:** open **Manage members** on their Circle, find the person in its roster, and select **Remove** beside their name. Read the inline confirmation, then select **Confirm removal** only if that placement should end. **Cancel** leaves it unchanged. This ends the placement, not the account, operator role, or historical Foundations proof. If another operator has moved the person since you opened the page, refresh and review their new Circle instead of retrying the old removal.

Ending the last current member assignment automatically archives an active Circle. If that leaves an active Block with fewer than two current Circles, the Block archives too. Ending a Circle's Block assignment can trigger the same Block closure, so check affected Experiences before confirming either action.

Foundations completion creates an automatic Artifact award and production job only when that Foundations version is linked to a published Artifact template version. Without that configuration, the member can complete Foundations but no automatic Artifact work is created.

### B. Create and run an Experience

1. Open **Experiences → Add an Experience**.
2. Choose the type and audience: all active members, public, invite only, Circle, or Block.
3. Enter the start, end, timezone, place, and member-facing details.
4. Choose registration:
   - **Managed here:** Ruined handles capacity, registration, and optional waitlist.
   - **No reservation:** the Experience is informational.
   - **External link:** registration happens elsewhere.
5. Save the Experience as a **draft**.
6. Open the Experience and verify every field, the audience, and the roster.
7. When ready, choose **Publish + send invite** if Google Calendar is connected. Ruined creates one Calendar event and a unique Google Meet, then sends attendee invitations.
8. Manage additions, cancellations, waitlist movement, and attendance from the roster. Full managed events can waitlist automatically; promotions follow the waiting order when a place opens. Final attendance is recorded only after the Experience begins.
9. Afterward, mark the Experience **Complete**. Use **Cancel** only with a clear reason; Google sends cancellation updates for connected events. Archive closed records when appropriate.

For Circle, Block, and all-member Experiences, the system resolves the current eligible audience. For public and invite-only Experiences, only confirmed registrations are invited. Waitlisted and cancelled places are excluded.

### C. Publish Academy content

1. Create a lesson draft and choose its content type.
2. Add the member-facing title, summary, content, video or resource link, thumbnail, captions, and duration when applicable. Academy media is currently URL-based; there is no operator upload or hosting tool.
3. Add it to a collection if useful.
4. Choose exactly who can see it: all members, selected Circles, or selected Blocks.
5. Review the draft, then **Publish**.
6. To revise it, save a new version. Do not overwrite a version members have already used.
7. **Unpublish** removes it from the member Academy. **Retire** closes it as historical content.

### D. Award and fulfill an Artifact

1. Confirm the Shopify product exists and is live.
2. In **Artifacts → Templates + Shopify**, verify the Product GID, handle, and live/test setting.
3. In **Award an Artifact**, choose the member, exact Artifact version, how it was acquired, and the reason.
4. Submit once. The system protects against accidental duplicate requests and opens production work. It does not create a Shopify order.
5. Move the production job through its real states: Collecting, Ready for Production, In Production, Review, Ready, and Fulfilled.
6. Add carrier, service, tracking number, and tracking link when shipped.
7. Update shipment state as evidence arrives. Every tracking correction requires a reason. Select **Delivered** only with delivery evidence: it is terminal and automatically fulfills the shipment, production job, award, and member Artifact state.

The Product GID is the durable Shopify identity. The handle is the current storefront path. The binding must still be checked in Shopify; database consistency alone does not prove that the product exists or is published. A missing or unavailable live product leaves the Artifact visible to the member but without a storefront link. Fulfillment and carrier updates are manual until external automation is added.

### E. Communicate with members

Use the tool that matches the message:

- **Support ticket:** a private member question and its replies. Open **Manage → Support**, read the conversation, reply, and set **In progress**, **Waiting for member**, or **Resolved**. A member follow-up returns it to the active queue. Someone unable to sign in must email **connect@theruinedproject.com** directly. See [Member support](support-ticketing.md) for email behavior and activation checks.
- **Announcement:** a durable member update that should remain visible. There is currently no edit or retract control after publishing.
- **Notification:** an immediate in-app prompt or reminder with optional action link.
- **Google Calendar:** an external invitation for a scheduled Experience, with a Meet link when configured.
- **Google Chat:** the Circle's ongoing conversation space. Ruined links to Chat; it does not copy or store the conversation.

Before publishing or sending, read the audience out loud and verify it a second time. There is no reason to use “all active members” when a Circle, Block, or one person is the true audience.

### F. Clear the work queue

1. Open **Work** and begin with **Overdue**, **Due today**, or **Urgent**.
2. For a task, select **Claim**, do the work, then **Complete**. Reopen it only when more work is genuinely needed.
3. For an Artifact, open the production record and update its real state.
4. For a failed automation, open **System**, read the failure, and retry only after the underlying connection or data issue is resolved.
5. If retries are exhausted or the reason is unclear, create an operator task for the system owner instead of repeatedly retrying.

---

## 8. Daily and weekly rhythm

### Daily — about ten minutes

1. Open **Overview**.
2. Check **Needs attention**, **Without a Circle**, **Open work**, and new or reopened **Support** requests.
3. Work the highest-priority item.
4. Check the next Experiences for roster or waitlist changes.
5. Confirm no important automation is failing in **System**.

### Weekly

1. Review members moving through Foundations and those blocked by no active Circle.
2. Review Circle capacity, Shaper coverage, resources, and Chat links.
3. Review the upcoming Experience calendar and close attendance on completed events.
4. Review Academy drafts and audience settings.
5. Review Artifact production and shipments.
6. Review announcement drafts, upcoming Calendar invitations, and recent notification delivery/read state.
7. Review pending or expired operator invitations.

---

## 9. Rules that protect the system

1. **A member may begin Foundations without a Circle, but completion requires the Timeline, Future Letter, and a current assignment to an active Circle.**
2. **Do not use a state correction as a shortcut.** Payment, agreement acceptance, and Foundations completion require real evidence and cannot be overridden.
3. **Draft first where the tool supports it.** Experiences, announcements, and Academy items can be reviewed before publishing. Notifications send immediately when **Send notification** is selected and currently cannot be retracted, so verify the audience and message before that final action.
4. **End or revoke; do not erase history.** Circle, Block, Shaper, operator, event, and Artifact records preserve what happened.
5. **Use the narrowest audience.** Check it before every publish or send.
6. **Use the narrowest operator role.** Administrator is not the default.
7. **Do not store secrets in the portal.** Google, Supabase, Stripe, Shopify, and email credentials belong in protected system settings, never member notes or operator forms.
8. **Keep notes necessary and factual.** Private information is visible only for operating the membership.
9. **Treat status labels as evidence, not magic.** Published, Connected, or Delivered may describe the Ruined record rather than prove a third-party email, Shopify order, carrier scan, or Calendar inbox delivery.

---

## 10. Common problems

| Problem | What to do |
| --- | --- |
| New operator has no code | Confirm the email, wait briefly, send once more, and use the newest code. If it still does not arrive, stop and give the system owner the email and exact time. |
| Invitation expired | Open **Operators** and use **Send again**. This creates a new seven-day invitation. |
| Wrong email was invited | Revoke the pending invitation, then add the operator again with the correct email. |
| Active operator needs a new role or Circle scope | Remove the current operator access, then send a new invitation with the correct responsibility and scope. |
| Operator lands on the member side | This is expected. Select **Operations** from the profile; no second login is needed. If the link is missing, confirm the verified email and active operator role with an Administrator. |
| Operator cannot see a section | Check their role and assigned Circles in **Operators**. Manage and Administration sections require Administrator access. |
| Operator is shown as suspended | The current operator screen has no Restore action. Escalate to the system owner; do not create a duplicate invitation. |
| Circle placement keeps taking me back to Members | Open **Circles**, choose the intended Circle, and select **Manage members**. Choose the person under **Add member**, then select **Add to [Circle name]**. A member-record link only carries the person into this flow; it does not save a placement. |
| Member is missing from Circle assignment | Confirm active account, active billing, onboarding/active program state, and no current Circle. Read the eligibility message and review the member record rather than changing states as a shortcut. |
| Cannot activate an empty Circle | Open that Circle's **Manage members**, add its first eligible member while it is **Forming**, then select **Activate [Circle name] → Confirm activation** when the group is ready. |
| Removal says the member's Circle changed | Refresh the roster and review the member's current Circle. The old request was rejected without removing their new placement. |
| Existing member still shows Invitation pending | Have them open `/access` on the same deployment; verify the newest code only if asked. Refresh Operators and check for Active before considering another invitation. |
| Administrator invitation seems to require a Circle | Check the selected responsibility. Administrator requires no Circle; Shaper and Guide require an operator Circle scope, separate from their personal member placement. |
| Member cannot finish Foundations | Confirm the Timeline and Future Letter are complete and the member has a current assignment to an **active** Circle. A forming Circle is not enough. |
| Calendar invite did not send | Open the Experience, check its Calendar state, then check **System** and **Work**. Do not republish repeatedly. |
| Academy item is not visible | Confirm it is published and has the correct audience. Draft changes remain invisible until published. |
| Artifact cannot be awarded | Confirm a published Artifact template version is bound, then verify that its live product exists and is published in Shopify. |
| A service shows Attention or Disconnected | Stop the dependent workflow, check **System**, and escalate with the exact action and time. Do not invent a manual workaround. |

---

## 11. Suggested first training session — 45 minutes

1. **5 minutes — Access:** sign in through `/access`, switch from the member profile to **Operations**, and explain numeric codes, environment labels, and sign out.
2. **5 minutes — Navigation:** show Daily work, Manage, and Admin on desktop or Administration on mobile.
3. **10 minutes — Member record:** find a member, read the five sections, create a test task, and explain private notes and corrections.
4. **10 minutes — Circle:** open one Circle's **Manage members**, show the roster and add/remove/activation confirmations, then show the visible creation, Shaper, resource, and Chat setup controls below. Explain the Foundations gate; do not confirm changes to real members during a demonstration.
5. **10 minutes — Experience:** build a draft event, inspect roster/waitlist/attendance, and explain what **Publish + send invite** does. Do not publish during training unless using approved test recipients.
6. **5 minutes — Communications and System:** compare announcements, notifications, Calendar, and Chat; show where failed work appears.

### Training is complete when the new Administrator can:

- Sign in without help.
- Explain the difference between Preview and connected/live work.
- Find a member who needs attention.
- Explain Circle, Shaper, Block, and the Foundations completion rule.
- Create a task and an Experience draft.
- Explain the difference between an announcement, notification, Calendar invitation, and Chat link.
- Add a lower-access operator without accidentally granting Administrator access.
- Find System health and know when to stop and escalate.

---

## Short glossary

- **Member:** the person receiving the Ruined membership experience.
- **Circle:** the member's primary group, with up to ten members.
- **Shaper:** the person who holds and leads a Circle.
- **Guide:** an operator who supports selected Circles.
- **Block:** a larger operating group made from at least two Circles.
- **Foundations:** the member's core Ruined work; an active Circle is required for final completion.
- **Experience:** a meeting, event, call, session, challenge, or retreat.
- **Academy:** the member learning library.
- **Artifact:** a physical or digital object awarded, gifted, or purchased and tracked through production and fulfillment.
- **Work item:** a task, Artifact job, or failed automation that needs an operator decision.
