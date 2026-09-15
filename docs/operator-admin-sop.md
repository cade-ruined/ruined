# Ruined Operator SOP

**For:** Administrators who operate the Ruined member experience

**Version:** 1.6

**Last reviewed:** 15 September 2026

This revision covers the Circle management window, member portraits, and saved details with editing on demand.

## The simple mental model

The operator side answers seven questions:

1. **Overview:** What is happening right now?
2. **Members:** Who needs help?
3. **Circles and Blocks:** Where does each member belong?
4. **Foundations:** How far has each member moved?
5. **Experiences and Academy:** What are members attending and learning?
6. **Artifacts and communications:** What are members receiving and hearing?
7. **Work and System:** What needs an operator to act?

Start on **Overview**. Use **Find a member** when you know who needs help. Administrators have three starting actions: **Add a member**, **Manage Circles**, and **Add an operator**. Shapers and Guides instead see **Your Circles**, **Review Foundations**, and **Events & attendance**. Follow an attention item or recent activity when you need to investigate a specific record.

Navigation is the same on desktop and mobile: **Overview**, **People**, **Circles**, **Learning & events**, **Messages**, and **Settings**. Select a group to reveal its pages without loading an unrelated page, then choose your destination. The Work queue is under Overview; Operators is under People; Blocks is under Circles. Only pages allowed by your role are shown. The navigation stays visible as you scroll.

### Where to click first

- **Members:** search first, then **Open member record**. **Add member** is a separate, two-step action for someone new; it does not send an invitation email or create their sign-in account. Allow their email, then copy and share the joining instructions.
- **Inside a member record:** use **Create task**, **Add internal note**, or **Correct profile detail** near the top. Tasks and notes open their forms in the record. Profile support shows saved details first; select **Edit profile detail** to make a correction.
- **Operators:** **Choose existing member** opens a search on the same page. Find the person and select **Review access** to open their prefilled access review immediately. **View operator record** appears instead if they already have an operator record or invitation. **Add operator** opens an invitation by email; a saved invitation stays pending until the person accepts through `/access`.
- **Messages → Board posts & alerts → Board posts:** save a draft, then use **Review & publish** and verify the audience before publishing. Edit or discard a draft; retract a published post if it should no longer appear. Retraction preserves history and cannot undo something a member already read.
- **Messages → Board posts & alerts → Alerts:** check **Recent delivery**, then **Write notification → Review notification → Send notification**. Choose the audience explicitly. Notifications are in-app, not email or text. The old Announcements and Notifications links still work.
- **Support:** open a request, then use **Reply to member**, **Update status**, or **Find member record**. Sending a reply and changing status are separate actions.

### Add a member — two steps

1. Open **Overview → Add a member**, or **People → Members → Add member**. Under **1. Allow email to join**, check the person's email and select **Add member**. Wait for the saved result and check its expiry. This gives that email permission to start joining; it does not send a message, create an account, activate paid membership, or grant operator access.
2. Under **2. Share sign-in instructions**, select **Copy message** or **Copy link**, then send it to that person using your normal communication method. You can also select and copy the displayed text manually. **Copying does not send anything.** The member requests their own code, completes their profile, accepts their own agreement, and follows the payment instructions in their account.

The permanent member sign-in address is **https://members.theruinedproject.com/access**. They can open it directly, enter the email you allowed, and request a code; they do not need an invitation link. Their first sign-in must happen before the seven-day invitation expires. If they miss it, allow that email again before they retry. After first acceptance, returning members use the same link without a new invitation while their access remains active. Each code still expires separately. A newsletter, customer, or contact record alone does not approve member sign-in.

After the person joins, find their member record and review the next action. Place them into a Circle when the current eligibility checks allow it. An email allowance alone is not a member record ready for Circle placement.

Use **Members → Pending joining** to find saved allowances after leaving or refreshing the page. Search by email, review the expiry, and copy the joining instructions. Use **Renew** for an expired allowance or **Remove** to withdraw unused permission, then confirm the exact record. Renewing or copying instructions does not send an email. Removal does not delete an existing account, end a membership, or change operator access. If the record changed elsewhere, refresh before acting.

### One person, two separate actions

**Circle placement** gives a member their group. **Operator access** gives that same person permission to help run Ruined. Neither action completes the other, and Administrator access does not require a Circle placement.

For an existing member, open **Members → their record → Overview**:

1. **Review Circle placement** opens **Circles** with that member in context when joining is ready for placement. Choose a card with space, open **Manage Circle**, review the selected person in the Circle window, then deliberately select **Add to Circle**. If setup is blocked, use **Review joining & billing** first. A **Forming** Circle can receive its first member before activation.
2. **Review operator access** opens their separate, prefilled access review directly. Choose the intended responsibility, review the areas they will manage, then deliberately send an invitation. For an existing pending or active operator, review the existing record instead of inviting them again.

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
2. Open **People → Operators** on desktop or mobile. **Overview → Add an operator** is a shortcut to the same invitation review.
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
| **Overview** | Find a member, choose one of the three starting tasks, or review attention items, recent activity, and upcoming Experiences | Administrators see Add a member, Manage Circles, and Add an operator. Shapers and Guides see tasks inside their existing Circle responsibilities. |
| **Members** | Search and filter the directory, then open the complete member record and its next action | Administrators can search private email details and use Add member. Its two steps allow an email and prepare instructions to share; the allowance **does not send an email**. |
| **Circles** | Search the card grid by Circle, Shaper, or Block; open **Manage Circle** for a focused window with the Shaper and member portraits first, followed by Chat, meetings, and resources | Choose **Add a member** to search, **Move** to transfer someone, or **Edit** to change saved information. **+ Create a Circle** appears once at the top. A Circle holds up to ten members and must be active to finish Foundations. |
| **Foundations** | See who has not started, is moving, needs a Circle, or is complete | This is a progress and attention view. Operators do not manually complete Foundations. Completion requires the member-created Timeline, Future Letter, and a current assignment to an active Circle. |
| **Experiences** | Choose **Member experiences** for Circle/member events, audiences, waitlists, attendance, Calendar and Meet; choose **Public community** for website event listings and BYOB rosters | The two tabs retain their separate registration records. **Publish + queue invitations** on a member Experience authorizes real communication; check Calendar status afterward. New public listings can link to external registration; they do not automatically get BYOB waivers or member Calendar invitations. |
| **Work** | See prioritized member tasks, Artifact production work, and failed automations | Work highest urgency first. Claim, complete, or reopen tasks; retry an automation only when its cause is understood. The link is visible to every operator role, but the current combined queue is populated for Administrators only. |

### Specialist tools — Administrators only

| Section | Use it for | Key things to know |
| --- | --- | --- |
| **Support** | Read signed-in members' categorized requests, reply, and track open, in-progress, waiting-for-member, and resolved tickets | Reply inside the ticket. When enabled, email alerts connect@ and the member but does not synchronize email replies. Members see only their own requests and can ask for help even when payment needs attention. |
| **Academy** | Create lessons and collections; add video, article, audio, PDF, download, or link content; choose audiences; publish, unpublish, or retire | Saving creates a new version. Members keep seeing the published version until a new version is deliberately published. |
| **Blocks** | Group multiple Circles into a larger operating unit | A Block needs at least two current Circles to activate. A Block does not change the Foundations completion rule. |
| **Artifacts** | Find an existing Shopify product by name, select it for a template, award Artifacts, and record fulfillment and tracking | The selected storefront product is checked again before saving. An award opens production work, not a Shopify order. Future unpublishing or deletion in Shopify can still make a saved link unavailable. |
| **Announcements** | Draft and publish a durable update to all active members, a Block, a Circle, or one member | Draft first and review the audience. Posts appear on the member announcement board; no email or text is sent. |
| **Notifications** | Send an immediate in-app message to all active members, a Block, a Circle, or one member | Choose the audience, type, title, message, and optional member-app link. The page shows delivery and read state. “Delivered” means stored in the member app, not delivered by email or SMS. |

### Access and health — Administrators only

| Section | Use it for | Key things to know |
| --- | --- | --- |
| **Operators** | Under People, invite by email or from an existing member; edit responsibility and managed Circles; resend/revoke invitations; remove or explicitly restore access | A pending invitation lasts seven days. Non-admin roles require at least one managed Circle, separate from personal membership placement. All changes are recorded. |
| **Settings** | Check identity, database, Stripe, notification delivery, Google Calendar, and failed automations | Opens independently of member-dashboard queries, but still requires active Administrator access and a working database. Shopify binding health appears in Artifacts. Green can mean configured or previously successful, not a fresh end-to-end provider test. |

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

1. Open **People → Members → the member's record → Overview → Review Circle placement**, or open **Circles → Circles** directly. If the record instead says **Review joining & billing**, resolve that prerequisite first. The member-record link carries the person into the Circle page; the banner asks you to choose a Circle and open **Manage Circle**.
2. Find a **Forming** or **Active** Circle card with space. Select **Manage Circle**. A window opens with the Circle name, Shaper, and roster. Close it with **×** or Escape to return to the grid; unsaved edits require confirmation before discarding.
3. Open **Add a member**, review the selected person or search by name or email. Read any eligibility message, then select **Add to Circle** once. Confirm the saved result and updated roster. Merely choosing a person or opening the window does not change their placement.
4. If a new Circle is needed, select **+ Create a Circle** at the top. Enter its name and select **Create Circle**, or choose **Cancel** without saving. It begins **Forming** with ten places and opens its management window for adding the first member.
5. The **Shaper** appears first in the window. Choose an existing active Shaper when unassigned, or use **Edit Shaper** to review a current assignment. Removing the current Shaper requires confirmation before a replacement can be assigned. If needed, **Invite someone as a Shaper**, select this Circle in the invitation, then verify their assignment after acceptance. Under **Resources**, use **Add resource** to share an approved, published lesson or document; each resource keeps its exact selected version.
6. Under **Circle chat**, paste the private Google Chat space URL and select **Set chat link**. A saved link shows **Open chat**, **Copy link**, and **Edit**; choose **Edit** only when changing or removing it. **Cancel** keeps the saved link. Create the space and manage its participants in Google; Ruined does not do those tasks. To arrange the first meeting, select **Schedule a meeting** in the same window—the Circle audience is already selected.
7. When a forming Circle has at least one member and is ready to run, open **Manage Circle** and select **Activate [Circle name]**, then **Confirm activation**. Review Shaper coverage, Chat, resources, and the first meeting beforehand. **Add members before activation.** Activation changes the whole Circle, not just the selected member.
8. Circle roster and Block changes queue Calendar audience updates for linked Experiences. Check the affected Experience's Calendar status; use **Sync invitations** when an immediate explicit sync is needed. A saved roster or pending update does not prove that Google has delivered invitations.

Only unassigned members with an active account, active billing, and onboarding/active program state can be added. The server also verifies current membership and eligibility when saving. If a person is missing or blocked, review the stated prerequisite in their record; do not change payment or agreement evidence to bypass it. A current roster still includes people whose payment or account later changed, so their existing placements can be reviewed accurately.

**To remove a member:** open **Manage Circle** on their Circle, find the person in its roster, and select **Remove** beside their name. Read the inline confirmation, then select **Confirm removal** only if that placement should end. **Cancel** leaves it unchanged. This ends the placement, not the account, operator role, or historical Foundations proof. If another operator has moved the person since you opened the page, refresh and review their new Circle instead of retrying the old removal.

Ending the last current member assignment automatically archives an active Circle. If that leaves an active Block with fewer than two current Circles, the Block archives too. Ending a Circle's Block assignment can trigger the same Block closure, so check affected Experiences before confirming either action.

Foundations completion creates an automatic Artifact award and production job only when that Foundations version is linked to a published Artifact template version. Without that configuration, the member can complete Foundations but no automatic Artifact work is created.

### B. Create and run an Experience

1. For a Circle meeting, open **Circles → Manage Circle → Schedule a meeting**. The Circle is preselected and members do not need to reserve a place. For other events, open **Experiences → New Experience**.
2. Choose the type and audience: all active members, public, invite only, Circle, or Block.
3. Enter the start, end, timezone, place, and member-facing details.
4. Choose registration:
   - **Managed here:** Ruined handles capacity, registration, and optional waitlist.
   - **No reservation:** the Experience is informational.
   - **External link:** registration happens elsewhere.
5. Save the Experience as a **draft**.
6. Open the Experience and verify every field, the audience, and the roster.
7. When ready, choose **Publish + queue invitations** if Google Calendar is connected. Processing creates one Calendar event and a unique Google Meet, then asks Google to send attendee invitations. Check **Google Calendar** status afterward; a saved or published event is not proof that invitations were sent or reached an inbox.
8. Manage additions, cancellations, waitlist movement, and attendance from the roster. Full managed events can waitlist automatically; promotions follow the waiting order when a place opens. Final attendance is recorded only after the Experience begins.
9. Afterward, mark the Experience **Complete**. Use **Cancel** only with a clear reason; Google sends cancellation updates for connected events. Archive closed records when appropriate.

For Circle, Block, and all-member Experiences, the system resolves the current eligible audience. For public and invite-only Experiences, only confirmed registrations are invited. Waitlisted and cancelled places are excluded.

**Already have a meeting link?** Under the Circle's **Chat & meetings**, select **Set meeting link** or **Manage meeting link** beside the correct meeting. Paste its Google Meet URL into the visible **Meeting link** form and save. Saving a link does not invite anyone. If you subsequently use Calendar invitations, Google creates its own meeting link and replaces the manually entered one; once Calendar manages a meeting, use its invitation controls instead of editing that link manually.

**Changing a Circle's chat:** return to its **Chat & meetings**, select **Edit**, replace the URL, and select **Save chat link**. Removing the saved link requires confirmation and only disconnects it from Ruined. It does not delete a Google space, remove participants, or change Google access. Add and remove Google Chat participants separately when Circle membership changes.

### C. Publish Academy content

1. Create a lesson draft and choose its content type.
2. Add the member-facing title, summary, content, video or resource link, thumbnail, captions, and duration when applicable. Academy media is currently URL-based; there is no operator upload or hosting tool.
3. Add it to a collection if useful.
4. Choose exactly who can see it: all members, selected Circles, or selected Blocks.
5. Review the draft, then **Publish**.
6. To revise it, save a new version, then **Publish latest changes**. The current published lesson stays available until the replacement is deliberately published. Do not unpublish just to make an edit.
7. **Unpublish** removes it from the member Academy. **Retire** closes it as historical content. Unused lesson and collection drafts can also be retired after confirmation; the record is retained and can be found with the Retired or All filter.

### D. Award and fulfill an Artifact

1. Confirm the Shopify product exists and is live.
2. In **Artifacts → Templates + Shopify**, search the product name, select the correct result, and review the live/test setting. Product identifiers are filled automatically and verified with Shopify before saving.
3. In **Award an Artifact**, choose the member, exact Artifact version, how it was acquired, and the reason.
4. Submit once. The system protects against accidental duplicate requests and opens production work. It does not create a Shopify order.
5. Move the production job through its real states: Collecting, Ready for Production, In Production, Review, Ready, and Fulfilled.
6. Add carrier, service, tracking number, and tracking link when shipped.
7. Update shipment state as evidence arrives. Every tracking correction requires a reason. Select **Delivered** only with delivery evidence: it is terminal and automatically fulfills the shipment, production job, award, and member Artifact state.

The product search uses products published to the connected Ruined storefront. If an item is missing, check its publication in Shopify rather than pasting an identifier. Existing saved bindings can become unavailable if the product later changes or is removed. Fulfillment and carrier updates remain manual; this workflow does not automatically create or fulfill Shopify orders.

### E. Communicate with members

Use the tool that matches the message:

- **Support ticket:** a private member question and its replies. Open **Messages → Support**, read the conversation, reply, and set **In progress**, **Waiting for member**, or **Resolved**. A member follow-up returns it to the active queue. Someone unable to sign in must email **connect@theruinedproject.com** directly. See [Member support](support-ticketing.md) for email behavior and activation checks.
- **Announcement:** a durable post on the member announcement board. It sends no email or text. There is currently no edit or retract control after publishing.
- **Notification:** an immediate alert in the member notification center, with an optional action link. It sends no email or text.
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
2. Check **Needs attention**, **Ready for a Circle**, **Open work**, and new or reopened **Support** requests available to your role.
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
| Operator cannot see a section | Check their role and managed Circles under **People → Operators**. Administrator-only pages are hidden from Shapers and Guides; mobile uses the same groups as desktop. |
| I added a member but they received no email | Add member allows their email; it does not send. Complete step 2: Copy message or Copy link, then send those instructions to the person yourself. |
| I cannot find the person to invite as an operator | Open **People → Operators → Choose existing member**, search by name or email, and use **Review access**. An existing operator or invitation has **View operator record** instead. Do not create a second account. |
| Operator is shown as suspended | The current operator screen has no Restore action. Escalate to the system owner; do not create a duplicate invitation. |
| Circle placement keeps taking me back to Members | Open **Circles**, choose the intended Circle, and select **Manage Circle**. Choose the person under **Add member**, then select **Add to [Circle name]**. A member-record link only carries the person into this flow; it does not save a placement. |
| Member is missing from Circle assignment | Confirm active account, active billing, onboarding/active program state, and no current Circle. Read the eligibility message and review the member record rather than changing states as a shortcut. |
| Cannot activate an empty Circle | Open **Manage Circle**, add its first eligible member while it is **Forming**, then select **Activate [Circle name] → Confirm activation** when the group is ready. |
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
2. **5 minutes — Navigation:** show Overview search and its three tasks, then People, Circles, Learning & events, Messages, and Settings. Selecting a group reveals its pages without navigating away. Demonstrate the same paths on mobile; there is no separate Administration menu to learn.
3. **10 minutes — Member record:** find a member, read the five sections, create a test task, and explain private notes and corrections.
4. **10 minutes — Circle:** choose a card and open **Manage Circle**, show the roster and add/remove/activation confirmations, then the Shaper, resource, and Chat setup controls. Show the top **+ Create a Circle** form and cancel it. Explain the Foundations gate; do not confirm changes to real members during a demonstration.
5. **10 minutes — Experience:** build a draft event, inspect roster/waitlist/attendance, and explain what **Publish + queue invitations** does and where to check its status. Do not publish during training unless using approved test recipients.
6. **5 minutes — Communications and System:** compare announcements, notifications, Calendar, and Chat; show where failed work appears.

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
