# Ruined Operator SOP

**For:** Administrators who operate the Ruined member experience

**Version:** 1.9 — compact workspaces and records (local review)

**Last reviewed:** 15 September 2026

This revision covers the workspace dropdown, bento overview, compact record cards, and focused editing windows throughout Operations. It describes the revised interface under local review; this pass has not been deployed.

## The simple mental model

The operator side answers seven questions:

1. **Overview:** What is happening right now?
2. **Members:** Who needs help?
3. **Circles and Blocks:** Where does each member belong?
4. **Foundations:** How far has each member moved?
5. **Experiences and Academy:** What are members attending and learning?
6. **Artifacts and communications:** What are members receiving and hearing?
7. **Work and System:** What needs an operator to act?

Start on **Overview**. The People card includes **Find a member**, **All members**, and any members needing review; Administrators also see **Add a member** and **Add an operator**. Use the Circles and Foundations cards to open their workspaces. Upcoming events, work needing a decision, and recent activity link directly to their records. Shapers and Guides see only the actions and records their role allows.

The dropdown beside the Ruined logo shows your current workspace. Open it to choose **Overview**, **Work queue**, **Members**, **Operators**, **Circles**, **Blocks**, **Events**, **Foundations**, **Academy**, **Artifacts**, **Messages**, **Support**, or **Settings**. Each choice opens that page directly—there is no second navigation row. Only pages allowed by your role appear. The header stays visible as you scroll, on desktop and mobile. **Account** opens your profile and sign-out options.

Across the workspaces, browse or search first. Select a record to manage it; use the main Add/New/Write button to create something. Editing windows preserve unsaved changes and wait for a save to finish before closing. Opening a window never sends a message or changes access.

### Where to click first

- **Members:** search first, then **Open member record**. **Add member** is a separate, two-step action for someone new; it does not send an invitation email or create their sign-in account. Allow their email, then copy and share the joining instructions.
- **Inside a member record:** the photo, identity, and next-step card come first. Open **Why this step?** for context. Use **Create task**, **Add internal note**, or **Correct profile detail** near the top. Tasks and notes open their forms in the record. Profile support shows saved details first; select **Edit profile detail** to make a correction.
- **Operators:** **Choose existing member** opens a search on the same page. Find the person and select **Review access** to open their prefilled access review immediately. **View operator record** appears instead if they already have an operator record or invitation. **Add operator** opens an invitation by email; a saved invitation stays pending until the person accepts through `/access`.
- **Messages → Board posts:** select **Write announcement**, save a draft, then use **Review & publish** beside that draft and verify the audience before publishing. Edit or discard a draft; retract a published post if it should no longer appear. Retraction preserves history and cannot undo something a member already read.
- **Messages → Alerts:** check **Recent delivery**, then **Write notification → Review notification → Send notification**. Writing and review happen in one focused window. Choose the audience explicitly. Notifications are in-app, not email or text. The old Announcements and Notifications links still work.
- **Support:** open a request to read the conversation. **Reply to member** moves to the reply form; **Update status** opens a small editing window. **Find member record** opens the person's account. Sending a reply and changing status are separate actions; closing the status window does not erase a reply you are writing.

### Add a member — two steps

1. Open **Overview → Add a member**, or **Members → Add member**. Under **1. Allow email to join**, check the person's email and select **Add member**. Wait for the saved result and check its expiry. This gives that email permission to start joining; it does not send a message, create an account, activate paid membership, or grant operator access.
2. Under **2. Share sign-in instructions**, select **Copy message** or **Copy link**, then send it to that person using your normal communication method. You can also select and copy the displayed text manually. **Copying does not send anything.** The member requests their own code, completes their profile, accepts their own agreement, and follows the payment instructions in their account.

The permanent member sign-in address is **https://members.theruinedproject.com/access**. They can open it directly, enter the email you allowed, and request a code; they do not need an invitation link. Their first sign-in must happen before the seven-day invitation expires. If they miss it, allow that email again before they retry. After first acceptance, returning members use the same link without a new invitation while their access remains active. Each code still expires separately. A newsletter, customer, or contact record alone does not approve member sign-in.

After the person joins, find their member record and review the next action. Place them into a Circle when the current eligibility checks allow it. An email allowance alone is not a member record ready for Circle placement.

Use **Members → Pending joining** to find saved allowances after leaving or refreshing the page. Search by email, review the expiry, and copy the joining instructions. Use **Renew** for an expired allowance or **Remove** to withdraw unused permission, then confirm the exact record. Renewing or copying instructions does not send an email. Removal does not delete an existing account, end a membership, or change operator access. If the record changed elsewhere, refresh before acting.

### One person, two separate actions

**Circle placement** gives a member their group. **Operator access** gives that same person permission to help run Ruined. Adding someone to a Circle does not grant operator access, and Administrator access does not require Circle placement. The **Assign Shaper** review can grant limited Shaper access to an existing Circle member when you explicitly confirm it; it never grants Administrator access.

For an existing member, open **Members → their record → Overview**:

1. **Review Circle placement** opens **Circles** with that member in context when joining is ready for placement. Choose a card with space, open **Manage Circle**, review the selected person in the Circle window, then deliberately select **Add to Circle**. If setup is blocked, use **Review joining & billing** first. A **Forming** Circle can receive its first member before activation.
2. **Review operator access** opens their separate, prefilled access review directly. Choose the intended responsibility, review the areas they will manage, then deliberately send an invitation. For an existing pending or active operator, review the existing record instead of inviting them again.

Opening either link does not assign a Circle, send an email, or grant access. You do not need to create a second account, repeat member onboarding, or change billing to invite an existing member as an operator. Member eligibility checks still apply to Circle placement.

---

## 1. Before adding a new operator

Operator access is not open signup. An active Administrator must approve it: use an invitation for a new operator, or explicitly confirm Shaper access when assigning an eligible existing Circle member as Shaper.

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
2. Open **Operators** on desktop or mobile. **Overview → Add an operator** is a shortcut to the same invitation review.
3. For an existing member, select **Choose existing member**, search by name or email, then select **Review access** beside the correct person. This opens the review without leaving Operators. Their member record's **Review operator access** link also opens that review directly. For someone new, select **Add operator**; **Already a member? Find their account** switches to member search if needed.
4. Enter the person's **full name** and **email**, or review the prefilled member details. If an invitation or operator record already exists for that email, use that record instead.
5. Choose **Administrator**.
6. Read and check the full-access confirmation.
7. Select **Send invitation**.
8. Read the result message, then confirm that the person appears in the operator list as **Invitation pending**:
   - **Invitation sent** means the invitation and code-send request succeeded; it does not prove the person has received the email or accepted access.
   - **Invitation saved, but the email was not delivered** means access is still pending; use **Send again** if another code delivery is needed.
9. Separately give the new operator the `/access` URL for the correct Ruined deployment. The email contains a code, not a durable invitation link.

What the system does:

- Creates a seven-day operator invitation.
- Asks Supabase to send a short-lived numeric access code through the Ruined authentication system.
- Records who created the invitation and the intended access. Access becomes active when the invited person accepts with their verified account.
- Gives an Administrator access to every area; no Circle selection is needed.

For a **Shaper** or **Guide**, choose at least one Circle under **Circles they help manage** before sending the invitation. Their access remains limited to those assigned Circles. When they accept, the system records their staff assignments to those Circles; a Shaper does not need the same assignment added again afterward.

That selection defines **which Circles they may operate**, not which Circle they personally belong to as a member. Do not move their member placement to unlock an operator role.

### If the invitation must change

- **Same email:** use **Send again**. This replaces the previous pending invitation and sends a new code.
- **Different email:** revoke the pending invitation, then create a new one. The resend screen intentionally locks the original address.
- **Invitation no longer needed:** use **Revoke**.
- **Active operator should no longer have access:** use **Remove**. This immediately blocks operator actions through server-side role checks and ends active Circle staff assignments while keeping history. It does not delete the person's Supabase identity, automatically close an already-open browser session, or remove a separate Ruined member role the same person may also hold.
- **Active operator needs a different role or Circle scope:** choose **Edit access** on their operator record. Choose the responsibility and managed Circles, review the change, and save. No removal-and-reinvitation loop is needed. Administrator access and restoration of inactive access require explicit confirmation. Another Administrator must change your own access.
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

Active operators receive complimentary membership once the complimentary-membership release is applied. This does not mark anyone as paid or alter Stripe billing. They must still complete their own profile and agreement; suspended, closed, or deliberately revoked member access is not silently restored. Valid operator access can still open **Operations** directly.

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
| **Overview** | Find a member or open the People, Circles, Foundations, upcoming events, and work cards | Administrators see Add a member and Add an operator. Shapers and Guides see tasks inside their existing Circle responsibilities. |
| **Members** | Search and filter the directory, then open the complete member record and its next action | Administrators can search private email details and use Add member. Its two steps allow an email and prepare instructions to share; the allowance **does not send an email**. |
| **Circles** | Search the card grid by Circle, Shaper, or Block; open **Manage Circle** for a focused window with the Shaper and member portraits first, followed by Chat, meetings, and resources | Choose **Add a member** to search, **Move** to transfer someone, or **Edit** to change saved information. **+ Create a Circle** appears once at the top. A Circle holds up to ten members and must be active to finish Foundations. |
| **Foundations** | Review compact member cards grouped by Circle needed, Moving, and Not started; expand Complete for finished members | This is a progress and attention view. Operators do not manually complete Foundations. Completion requires the member-created Timeline, Future Letter, and a current assignment to an active Circle. |
| **Events** | Choose **Member events** for Circle/member Experiences, audiences, waitlists, attendance, Calendar and Meet; choose **Public events** for website listings and BYOB rosters | Select a record to open it. **+ New experience** opens a draft window. Member and public tabs retain their separate registration records; a public listing does not automatically get BYOB waivers or member Calendar invitations. |
| **Work queue** | Filter compact work cards by Tasks, Artifacts, or Failed actions | Work highest urgency first. Claim, complete, or reopen tasks from the card; retry an automation only when its cause is understood. The link is visible to every operator role, but the current combined queue is populated for Administrators only. |

### Specialist tools — Administrators only

| Section | Use it for | Key things to know |
| --- | --- | --- |
| **Support** | Search or filter request cards, then read and reply in the conversation | **Update status** opens a separate window. When enabled, email alerts connect@ and the member but does not synchronize email replies. Members see only their own requests and can ask for help even when payment needs attention. |
| **Academy** | Browse **Lessons** or **Collections**; use **+ New lesson** or **+ New collection** to open a creation window | A lesson opens on Content, Audience, and Publication cards. **Edit lesson** opens its editor. Saving creates a new version. Members keep seeing the published version until a new version is deliberately published. |
| **Blocks** | Open **Manage Block** beside a Block to review its Circles, add a Circle, activate, or remove a Circle. **+ New Block** opens a separate creation window. | A Block needs at least two current Circles to activate. A Block does not change the Foundations completion rule. Removing a Circle preserves history and may close the Block if fewer than two remain. |
| **Artifacts** | Switch between **Production**, **Templates**, and **Shipping**; review the saved cards, then use **Award an Artifact**, **+ New template**, or **+ Add tracking** for the intended task | Each action opens a focused window. The selected storefront product is checked again before saving. An award opens production work, not a Shopify order. Future unpublishing or deletion in Shopify can still make a saved link unavailable. |
| **Messages → Board posts** | Draft and publish a durable announcement to all active members, a Block, a Circle, or one member | **Write announcement** creates a draft. Review the audience before publishing. Posts appear on the member announcement board; no email or text is sent. |
| **Messages → Alerts** | Review notification delivery and send an immediate in-app alert | **Write notification** opens the message window; **Review notification** precedes the final send. “Delivered” means stored in the member app, not delivered by email or SMS. |

### Access and health — Administrators only

| Section | Use it for | Key things to know |
| --- | --- | --- |
| **Operators** | Under People, invite by email or from an existing member; edit responsibility and managed Circles; resend/revoke invitations; remove or explicitly restore access | A pending invitation lasts seven days. Non-admin roles require at least one managed Circle, separate from personal membership placement. All changes are recorded. |
| **Settings** | Check identity, database, Stripe, notification delivery, Google Calendar, and failed automations | Services needing attention are expanded; open other cards for evidence and details. Test/live labels remain visible. Opens independently of member-dashboard queries, but still requires active Administrator access and a working database. Shopify binding health appears in Artifacts. Green can mean configured or previously successful, not a fresh end-to-end provider test. |

---

## 6. The member record

Open a member from **Members**. A compact profile header identifies the person; the next-step card shows who should act and links to the action. Expand **Why this step?** when you need the explanation. Choose one of five views; only the selected view is shown:

| Part | What it tells you |
| --- | --- |
| **Overview** | The person's current states and the next item most likely to need a decision |
| **Membership** | Administrative onboarding, contact details, agreement evidence, Stripe billing state, cancellation state, and Profile support controls |
| **Journey** | Foundations progress, earned Artifacts, and Experience participation |
| **Community** | Current Circle, Block, Shaper, meetings, and shared resources |
| **Record** | Internal tasks, notes, visible task/note forms, audited state corrections, and operating history |

The views keep their forms mounted, so switching does not reset an unfinished note, task, or correction. A pending save must finish before switching. If you have unsaved edits, choose **Keep editing** or **Switch view — keep edits**; switching is not a save. Shortcuts such as **Create task**, **Add internal note**, and **Correct profile detail** open the appropriate view and move to that control.

Membership groups joining, contact, agreement, and billing into separate cards. Open **Detailed account states** only when you need the full state breakdown. This is the same evidence and access policy, not a new shortcut around joining requirements.

### Read the next action: who acts, and what is ready?

The directory and member record show **Member**, **Operator**, or **Support** beside the next action. This identifies who must do the work; it is not permission to perform it on someone else's behalf.

| Guidance | What to do |
| --- | --- |
| **Member · Complete joining** | Share the sign-in instructions. The member verifies their own email, fills in their profile, accepts the agreement, and completes payment themselves. Review the missing requirement under Membership. |
| **Member · Continue Foundations** | Help them understand the next step, but leave their Timeline, Future Letter, and completion work with them. |
| **Operator · Review Circle placement** | An Administrator reviews current eligibility, chooses a Circle with space, then explicitly adds the member. Shapers and Guides refer placement changes to an Administrator. |
| **Operator · Review Circle activation** | The placement is already saved. An Administrator activates the forming Circle when the group is ready; do not add the person again. |
| **Support · Check payment/joining confirmation** | Evidence may already be recorded while another status has not caught up. Ask the system owner or Support to investigate; do not ask the member to pay or accept the agreement again. |
| **Support · Review a suspension, pause, or ended membership** | Review the recorded restriction with an Administrator. Circle placement or an operator invitation must not be used to bypass it. |

**Waiting** means another action or confirmation is outstanding. **Blocked** means a restriction or uncertain state needs review. **Ready** applies to the named next action, not every membership benefit. A green billing label alone does not prove joining is complete. These labels guide review; the server checks current eligibility again when an action is saved.

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

1. Open **Members → the member's record → Overview → Review Circle placement**, or open **Circles** directly. If the record instead says **Review joining & billing**, resolve that prerequisite first. The member-record link carries the person into the Circle page; the banner asks you to choose a Circle and open **Manage Circle**.
2. Find a **Forming** or **Active** Circle card with space. Select **Manage Circle**. A window opens with the Circle name, Shaper, and roster. Close it with **×** or Escape to return to the grid; unsaved edits require confirmation before discarding.
3. Open **Add a member**, review the selected person or search by name or email. Read any eligibility message, then select **Add to Circle** once. Confirm the saved result and updated roster. Merely choosing a person or opening the window does not change their placement.
4. If a new Circle is needed, select **+ Create a Circle** at the top. Enter its name and select **Create Circle**, or choose **Cancel** without saving. It begins **Forming** with ten places and opens its management window for adding the first member.
5. The **Shaper** appears first in the window. Select **Assign Shaper**, then choose from **Circle members** or **Existing Shapers**. If the member needs Shaper access, check the confirmation and select **Save Shaper**. This grants Circle-level operator access, not administrator access; existing administrator permissions are kept. Unavailable members show a reason—review that person's record instead of bypassing an account or membership restriction. Use **Edit Shaper** to review a current assignment; removal requires confirmation before selecting a replacement. Someone new can still be invited as a Shaper through **Operators**. Under **Resources**, use **Add resource** to share an approved, published lesson or document; each resource keeps its exact selected version.
6. Under **Circle chat**, paste the private Google Chat space URL and select **Set chat link**. To find it, open the private space in Google Chat, click its name at the top, and choose **Copy link to this space**. **Where do I find the link?** keeps these instructions available during setup or editing. A saved link shows **Open chat**, **Copy link**, and **Edit**; choose **Edit** only when changing or removing it. **Cancel** keeps the saved link. Keep the space private and add or invite participants in Google Chat separately; saving a link in Ruined does not grant Google access or send invitations. To arrange the first meeting, select **Schedule a meeting** in the same window—the Circle audience is already selected.
7. When a forming Circle has at least one member, an Administrator can open **Manage Circle** and select **Activate [Circle name]**, then **Confirm activation**. **A first meeting is not required; schedule meetings later. Add members before activation.** Activation changes the whole Circle, not just the selected member, and does not create a meeting or send invitations.
8. Circle roster and Block changes queue Calendar audience updates for linked Experiences. Open the affected Experience's **Overview → Meeting** and check the status. Use **Refresh status** for a queued change. Open **Manage meeting** for **Update invitations** or **Retry invitations** when available; these are deliberate communication actions. A saved roster or pending update does not prove that Google has delivered invitations.

Only eligible, unassigned members with an active account, valid paid or complimentary membership access, and the required joining/program state can be added. The server verifies current membership and eligibility when saving. If a person is missing or blocked, review the stated prerequisite in their record; do not change payment or agreement evidence to bypass it. A current roster still includes people whose payment or account later changed, so their existing placements can be reviewed accurately.

**To remove a member:** open **Manage Circle** on their Circle, find the person in its roster, and select **Remove** beside their name. Read the inline confirmation, then select **Confirm removal** only if that placement should end. **Cancel** leaves it unchanged. This ends the placement, not the account, operator role, or historical Foundations proof. If another operator has moved the person since you opened the page, refresh and review their new Circle instead of retrying the old removal.

Ending the last current member assignment automatically archives an active Circle. If that leaves an active Block with fewer than two current Circles, the Block archives too. Ending a Circle's Block assignment can trigger the same Block closure, so check affected Experiences before confirming either action.

Foundations completion creates an automatic Artifact award and production job only when that Foundations version is linked to a published Artifact template version. Without that configuration, the member can complete Foundations but no automatic Artifact work is created.

### B. Create and run an Experience

1. For a Circle meeting, open **Circles → Manage Circle → Schedule a meeting**. The Circle is preselected and members do not need to reserve a place. For other member events, open **Events → Member events → + New experience**. The form opens in a window; the event cards stay behind it.
2. Enter the title, start, end, timezone, and audience. Use the additional options for type, place, and member-facing details when needed. A new draft is not a message or an invitation.
3. Choose registration when applicable:
   - **Managed here:** Ruined handles capacity, registration, and optional waitlist.
   - **No reservation:** the Experience is informational.
   - **External link:** registration happens elsewhere.
4. Select **Save draft & continue**. Nothing is published or sent. Closing a changed form requires a discard confirmation; a pending save must finish first.
5. In the saved record, **Overview** shows compact **Schedule**, **Audience**, **Location**, **Meeting**, and **Event details** cards. Longer descriptions and registration windows expand when needed. **People** contains reservations, waitlist, and attendance. **Activity** contains the operating history. Select **Edit** near the title to change the saved details in a focused window.
6. Select **Review & publish** near the title. Review the exact event, time, audience, and invitation count in the confirmation window. For a configured, unelapsed event, **Publish + queue invitations** authorizes real Google communication. The system creates a Calendar event and a unique Meet link when processing succeeds. If Calendar needs attention or the event has ended, the review explains that publishing will not automatically send invitations.
7. Check **Overview → Meeting** after publishing. **Invitation queued** or **Update queued** means delivery is still pending; use **Refresh status**. **Invitations are current** indicates the recorded Google sync succeeded, not that each recipient read an email. Open **Manage meeting** to review the recipient count and available controls. For an unlinked published event, **Send invitations** explicitly starts delivery; **Update invitations** updates an existing event. **Retry invitations** is a recovery action for a queued change. Opening or closing the window sends nothing, and pending actions must finish before it closes.
8. Use **People** for additions, cancellations, waitlist movement, and attendance. Full managed events can waitlist automatically; promotions follow the waiting order when a place opens. Final attendance is recorded only after the Experience begins.
9. Afterward, select **•••** beside the event title to open **Event actions** and mark the Experience **Complete**. **Cancel Experience** requires a reason and confirmation in that window. A connected cancellation is queued; check Meeting status rather than assuming Google delivered it. **Archive** appears for eligible closed or draft records. If an archived cancellation still needs delivery, **Manage meeting → Send cancellation** remains available when permissions and configuration allow it. Closing the actions window does not complete, archive, or cancel anything; unfinished cancellation edits require confirmation before discarding.

For Circle, Block, and all-member Experiences, the system resolves the current eligible audience. For public and invite-only Experiences, only confirmed registrations are invited. Waitlisted and cancelled places are excluded.

**Why does Meeting show zero eligible recipients?** The Circle roster and the invitation audience are not the same count. Circle invitations require an **active** Circle and current placement, completed joining, active member access, and a verified primary email. Complimentary operator funding can satisfy the membership-funding requirement; it does not bypass the other checks. The organizer is not invited to their own event. A **Forming** Circle can hold members but does not yet qualify them for Circle invitations. Select **Review Circle** or **Review people** and inspect the actual prerequisite; do not invent payment evidence or add duplicate reservations as a shortcut. Public and invite-only events can legitimately begin with no registrations. Publishing with zero recipients can still create an organizer-only Google event.

**Already have a meeting link?** Open the correct Experience, then **Overview → Meeting → Manage meeting**. Paste its Google Meet URL into the optional editor and save. Saving a link does not invite anyone. Publishing with automatic Calendar delivery—or later selecting **Send invitations**—creates Google's own meeting link and replaces the manually entered one. The publish review warns about that replacement. Once Calendar manages the meeting, use its invitation controls instead of editing the link manually. A saved link appears as **Open Google Meet** when the Google connection and event state allow it.

**Delivery setup needs attention:** organizer or test/live mismatches must be reviewed by an Administrator. **Verify & bind to test/live** verifies the existing Google record and binds its mode; it does not send invitations. Follow with the indicated explicit update, retry, or cancellation only after checking the audience. Past events do not send automatic updates, but an operator may still choose an explicit recovery action. Do not use test/live binding as a workaround for the wrong organizer.

For a website listing, use **Events → Public events** instead. Its public publication and registration controls are separate from the member Experience workflow; creating a public listing does not create a member Calendar event.

**Changing a Circle's chat:** return to its **Chat & meetings**, select **Edit**, replace the URL, and select **Save chat link**. Removing the saved link requires confirmation and only disconnects it from Ruined. It does not delete a Google space, remove participants, or change Google access. Add and remove Google Chat participants separately when Circle membership changes.

### C. Publish Academy content

1. Open **Academy → Lessons**. Search for an existing lesson first; otherwise select **+ New lesson** to open its draft window and choose the content type.
2. Add the member-facing title, format, summary, content or source link, collection, and audience. Open the optional media/presentation settings for thumbnail, captions, duration, and other metadata when needed. Academy media is currently URL-based; there is no operator upload or hosting tool.
3. Add it to an existing collection if useful. To create one, use **Collections → + New collection**; use **Manage collection** on its saved card to edit or publish it.
4. Choose exactly who can see it: all members, selected Circles, or selected Blocks.
5. Select **Create lesson draft**, then review the saved **Content**, **Audience**, and **Publication** cards and choose **Publish**. Use **Open source** or **Read lesson notes** to inspect the content. Merely opening or closing a window publishes nothing.
6. To revise an existing lesson, open its card and select **Edit lesson**. Make the changes and choose **Save new draft version**, then **Publish latest changes** from the saved record. The current published lesson stays available until the replacement is deliberately published. Do not unpublish just to make an edit.
7. **Unpublish** removes it from the member Academy. **Retire** closes it as historical content; **Discard draft** handles an unused draft. Both require confirmation and preserve the record. Use the **Retired** or **All** filter to find it afterward. Move a collection's remaining lessons before retiring that collection.

### D. Award and fulfill an Artifact

1. Confirm the Shopify product exists and is live.
2. Open **Artifacts → Templates**. Use **+ New template** for a new Artifact, or **Edit product / Connect product** on an existing template. Search the product name in the focused window, select the correct result, and review the live/test setting. Product identifiers are filled automatically and verified with Shopify. **Publish template** publishes the new template; **Save product** publishes a new binding version for an existing one.
3. Select **Award an Artifact**. In the window, choose the member, exact Artifact version, how it was acquired, and the reason.
4. Submit once. The system protects against accidental duplicate requests and opens production work. It does not create a Shopify order. Opening or closing the award window does not award anything.
5. Under **Production**, move the job through its real states: Collecting, Ready for Production, In Production, Review, Ready, and Fulfilled.
6. When shipped, open **Shipping → + Add tracking** and enter the carrier, service, tracking number, and tracking link for the correct production job.
7. Use **Edit shipment** on an existing shipment to change its record in a focused window, then **Save shipment**. Every tracking correction requires a reason. Select **Delivered** only with delivery evidence: it is terminal and automatically fulfills the shipment, production job, award, and member Artifact state.

The product search uses products published to the connected Ruined storefront. If an item is missing, check its publication in Shopify rather than pasting an identifier. Existing saved bindings can become unavailable if the product later changes or is removed. Fulfillment and carrier updates remain manual; this workflow does not automatically create or fulfill Shopify orders.

### E. Communicate with members

Use the tool that matches the message:

- **Support ticket:** a private member question and its replies. Open **Support** from the workspace dropdown, search or filter the request cards, then read the conversation. **Reply to member** opens the reply area; **Update status** opens a separate window for **In progress**, **Waiting for member**, or **Resolved**. Closing it leaves an unfinished reply intact. If another operator changed the request, follow **Reload request** instead of overwriting their update. A member follow-up returns it to the active queue. Someone unable to sign in must email **connect@theruinedproject.com** directly. See [Member support](support-ticketing.md) for email behavior and activation checks.
- **Board post:** open **Messages → Board posts → Write announcement**, save a draft, then **Review & publish**. Drafts can be edited or discarded; a published post can be retracted, preserving history. Retraction cannot undo something already read. Board posts send no email or text.
- **Alert:** open **Messages → Alerts → Write notification**, then **Review notification**. Check the exact audience and optional action link before **Send notification**. It appears in the member notification center, not email or text. Inspect **Recent delivery** before retrying an uncertain send.
- **Google Calendar:** an external invitation for a scheduled Experience, with a Meet link when configured.
- **Google Chat:** the Circle's ongoing conversation space. Ruined links to Chat; it does not copy or store the conversation.

Before publishing or sending, read the audience out loud and verify it a second time. There is no reason to use “all active members” when a Circle, Block, or one person is the true audience.

### F. Clear the work queue

1. Open **Work queue** from the workspace dropdown or Overview. Use **All work**, **Tasks**, **Artifacts**, or **Failed actions** to narrow the cards, then begin with the highest urgency and earliest due items.
2. For a task, select **Claim**, do the work, then **Complete**. Reopen it only when more work is genuinely needed.
3. For an Artifact, open the production record and update its real state.
4. For a failed automation, open **Settings**, read the failure, and retry only after the underlying connection or data issue is resolved. The older `/ops/system` address still opens this workspace.
5. If retries are exhausted or the reason is unclear, create an operator task for the system owner instead of repeatedly retrying.

---

## 8. Daily and weekly rhythm

### Daily — about ten minutes

1. Open **Overview**.
2. Check **Needs attention**, **Ready for a Circle**, **Open work**, and new or reopened **Support** requests available to your role.
3. Work the highest-priority item.
4. Check the next Experiences for roster or waitlist changes.
5. Confirm no important automation is failing in **Settings**.

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
| Active operator needs a new role or Circle scope | Open **Operators → Edit access** on the correct record. Review the responsibility, managed Circles, required confirmation, and reason before **Save access**. Do not remove and reinvite them. Another Administrator must change your own access. |
| Operator lands on the member side | This is expected. Select **Operations** from the profile; no second login is needed. If the link is missing, confirm the verified email and active operator role with an Administrator. |
| Operator cannot see a section | Check their role and managed Circles under **Operators**. Administrator-only workspaces are hidden from Shapers and Guides; mobile uses the same destinations as desktop. |
| I added a member but they received no email | Add member allows their email; it does not send. Complete step 2: Copy message or Copy link, then send those instructions to the person yourself. |
| I cannot find the person to invite as an operator | Open **Operators → Choose existing member**, search by name or email, and use **Review access**. An existing operator or invitation has **View operator record** instead. Do not create a second account. |
| Operator is shown as suspended | An approved Administrator can open **Edit access**, explicitly confirm restoration, enter a reason, and choose **Restore and save access**. Member billing and lifecycle restrictions still apply. Do not create a duplicate invitation or restore access without approval. |
| Circle placement keeps taking me back to Members | Open **Circles**, choose the intended Circle, and select **Manage Circle**. Choose the person under **Add member**, then select **Add to [Circle name]**. A member-record link only carries the person into this flow; it does not save a placement. |
| Member is missing from Circle assignment | Confirm active account, valid paid or complimentary membership access, the required joining/program state, and no current Circle. Read the eligibility message and review the member record rather than changing states as a shortcut. |
| Cannot activate an empty Circle | Open **Manage Circle**, add its first eligible member while it is **Forming**, then select **Activate [Circle name] → Confirm activation** when the group is ready. |
| Removal says the member's Circle changed | Refresh the roster and review the member's current Circle. The old request was rejected without removing their new placement. |
| Existing member still shows Invitation pending | Have them open `/access` on the same deployment; verify the newest code only if asked. Refresh Operators and check for Active before considering another invitation. |
| Administrator invitation seems to require a Circle | Check the selected responsibility. Administrator requires no Circle; Shaper and Guide require an operator Circle scope, separate from their personal member placement. |
| Member cannot finish Foundations | Confirm the Timeline and Future Letter are complete and the member has a current assignment to an **active** Circle. A forming Circle is not enough. |
| Calendar invite did not send | Open the Experience's **Overview → Meeting** and check its status. Use **Refresh status** for queued work and **Manage meeting** for audience details and available recovery actions. Review **Settings** and **Work queue** for failures before choosing an explicit retry. Do not republish repeatedly. |
| Meeting shows zero eligible recipients | Use **Review Circle** or **Review people**. A forming Circle, incomplete joining, restricted access, unverified email, or organizer-only audience can explain zero; public/invite-only events also need confirmed registrations. Review the actual evidence before changing anything. |
| Academy item is not visible | Confirm it is published and has the correct audience. Draft changes remain invisible until published. |
| Artifact cannot be awarded | Confirm a published Artifact template version is bound, then verify that its live product exists and is published in Shopify. |
| A service shows Attention or Disconnected | Stop the dependent workflow, check **Settings**, and escalate with the exact action and time. Do not invent a manual workaround. |

---

## 11. Suggested first training session — 45 minutes

1. **5 minutes — Access:** sign in through `/access`, switch from the member profile to **Operations**, and explain numeric codes, environment labels, and sign out.
2. **5 minutes — Navigation:** show Overview search and its cards, then use the workspace dropdown to open Members, Circles, Events, Academy, Artifacts, Messages, Support, and Settings. Each selection opens its workspace directly; there is no second navigation row. Demonstrate the same paths on mobile and opening/closing one focused task window without saving.
3. **10 minutes — Member record:** find a member, switch among the five views, show a task or note form, and demonstrate keeping unsaved edits when switching. Explain private notes and corrections; only save a test task in an approved training environment.
4. **10 minutes — Circle:** choose a card and open **Manage Circle**, show the roster and add/remove/activation confirmations, then the Shaper, resource, and Chat setup controls. Show the top **+ Create a Circle** form and cancel it. Explain the Foundations gate; do not confirm changes to real members during a demonstration.
5. **10 minutes — Experience:** open **Events → Member events → + New experience**, save a draft only, then show the Overview cards, People, and Activity. Open **Manage meeting** and **••• Event actions**, then close them without acting. Open **Review & publish** and explain the recipient count, link replacement, and queued-versus-sent distinction; close the review without publishing. Do not publish during training unless using approved test recipients and explicit approval.
6. **5 minutes — Communications and Settings:** compare Board posts, Alerts, Calendar, and Chat; show where delivery and failed work appear. Opening **Write announcement** or **Write notification** is safe; saving or sending is a separate decision.

### Training is complete when the new Administrator can:

- Sign in without help.
- Explain the difference between Preview and connected/live work.
- Find a member who needs attention.
- Read who owns the next action and distinguish Ready, Waiting, and Blocked without overriding member evidence.
- Add a member through allowance and shared instructions, without claiming an email was sent automatically.
- Explain Circle, Shaper, Block, and the Foundations completion rule.
- Create a task and an Experience draft.
- Explain the difference between an announcement, notification, Calendar invitation, and Chat link.
- Add a lower-access operator without accidentally granting Administrator access.
- Find service health in Settings and know when to stop and escalate.

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
