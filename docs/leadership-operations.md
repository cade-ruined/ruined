# Circle Supporters and placement operations

**Status:** local implementation for review. These changes, migrations, and responsibility grants have not been applied to production as part of this work.

**Reviewed:** 29 September 2026

This guide records the approved operating decisions and the corresponding app workflow. It supplements the [Operator SOP](operator-admin-sop.md). The supplied Foundations and Internal leadership PDFs are source references; this implementation does not replace or edit those PDFs.

## Approved structure

- **Member** and **Circle Supporter** are the member-facing service roles. Tyler and Mitch oversee Supporter readiness, ongoing support, and temporary coverage.
- Builder, Author, and Partner are retired leadership titles. Shaper and Guide are retired public role names. Historical role identifiers and records remain for compatibility; new Guide or direct Supporter operator invitations are not issued.
- **Builders remains a signup cohort**, alongside Founders, Originals, Pillars, and Members. Signup cohort records are not leadership permissions.
- **Administrator** is an internal access permission. Specific placement, readiness, and reimbursement decisions additionally require an explicit current responsibility grant.
- A Circle targets **10 people including its Supporter**, normally **8–12**. A member who also serves as Supporter counts once. The range is a planning target; recorded exception approval allows a larger Circle.
- Supporter service creates **discretionary reimbursement eligibility**, never a guarantee or automatic complimentary membership. Libby both approves and processes reimbursements.
- Place members before final Foundations completion. Completing the final Foundations moment reveals their Circle; welcome them immediately and include them in the next available WHY/BUILD meetings. There is no additional wait-until-next-month rule.

## Configure the actual responsibility owners

Open **Operations → Supporters**. This opens the **Leadership** page at `/ops/leadership`.

The names in the page copy express the operating policy; they do not identify accounts or grant authority. An existing Administrator must select the verified accounts explicitly. No grants are seeded by display name, email, or member number.

1. Confirm the intended people have active **Administrator** accounts under **Operators**. The responsibility form cannot promote a member or Circle Supporter to Administrator.
2. Open **Configure responsibility**.
3. Choose the correct Administrator account, responsibility, **Assign responsibility**, and a factual reason.
4. Select **Save responsibility**, then verify the name under the relevant responsibility.
5. Configure the following grants:

| Account to verify | Responsibility label | Capability identifier |
| --- | --- | --- |
| Libby | Routine Circle placement | `circle_placement` |
| Libby | Reimbursement approval and processing | `reimbursements` |
| Tyler | Circle placement exceptions | `circle_exception` |
| Tyler | Supporter readiness and coverage | `supporter_readiness` |
| Mitch | Circle placement exceptions | `circle_exception` |
| Mitch | Supporter readiness and coverage | `supporter_readiness` |

These are separate grants. Administrator access alone does not permit the listed decisions or reveal the private reimbursement ledger. An unconfigured action fails closed with a message directing the operator to configure responsibility. The app checks current account status, Administrator access, and the relevant responsibility when an action is saved.

To change an owner, use the same form with **Remove responsibility**, record why, and then assign the correct account. The original grant and revocation remain in history. Removing a responsibility does not delete membership or historical service/payment records.

## Prepare and reveal a member's Circle

### Gather preferences

Before Circle reveal, members open **My Circle → Help us find your Circle**. They can save:

- Their time zone.
- Optional weekly morning, afternoon, and evening availability.
- An optional connection from their invitation history, when one exists.

Preferences are private to the placement team. A known person's Circle is a preference, not a guarantee. The app does not expose a searchable member directory in this form.

### Review and save routine placement

1. Libby opens the member record and **Review Circle placement**, or finds the member in **Circles**.
2. Open **Review placement suggestions** to review group size, known invitation connections, shared time zone, and available overlap evidence.
3. Check the Circle's actual meeting schedule. Suggestions rank candidates; they do not create recurring schedules, place anyone automatically, or guarantee that an available slot matches every future meeting.
4. Open the chosen forming or active Circle, review the member's joining and membership eligibility, and use **Approve placement**. An existing placement uses the **Move** workflow instead.
5. Confirm the saved roster. A request, suggestion, or selected option alone is not a placement.

The count uses distinct people across the Circle's membership and Supporter assignment, so its Supporter is not counted twice. Ten is the target; 8–12 is the normal operating range. Starting or changing service for a current member does not add another person.

### Review an exception

If adding or transferring a person would take the destination above 12, the ordinary placement action does not silently bypass the target range.

1. Libby records why the larger placement is appropriate and requests review.
2. Tyler or Mitch opens **Circles → Placement exceptions**.
3. Review the named member, intended Circle, and reason.
4. Select **Approve and place** or **Decline**.
5. Approval rechecks the current source placement, member eligibility, Circle status, and projected count before saving. If the underlying record changed, reload and review it; do not assume the old request still applies.

Approval and placement are recorded together. A pending or declined review never places or moves the person. A larger Circle has no arbitrary hard cap introduced by this policy; each placement exceeding the normal range needs the recorded review.

### Final Foundations moment

An operator may prepare Circle placement while the member completes Foundations. Until completion, the member does not see that Circle's identity, roster, chat, shared resources, scoped announcements, or Circle meetings through member routes and permissions.

The member completes their own Timeline and Future Letter and needs a current assignment to an **active** Circle before final completion. A forming Circle is not sufficient. These requirements remain enforced on the server. An operator cannot substitute a role change or manual completion override for the member's work.

Completing the final Foundations moment reveals the Circle. Welcome the member immediately and point them to the next available WHY/BUILD meetings. Actual events still need to be scheduled and published through Events; this workflow does not create a monthly calendar automatically.

## Approve readiness and start service

Supporter selection follows **observe → co-facilitate → lead → debrief**. Tyler/Mitch make the readiness decision; the form records it rather than treating activity attendance as automatic approval.

1. Confirm the person is a current member of the intended Circle, has completed membership entry **and Foundations**, and has active eligible membership access. A pre-reveal member cannot receive Supporter operating privileges as a shortcut around the Foundations gate.
2. Explain the responsibility, support available, and discretionary reimbursement arrangement before the person accepts service. There is no guaranteed reimbursement or automatic free membership.
3. Open **Supporters → Prepare or start a Supporter**.
4. Choose the Circle and **Current Circle member**.
5. Select **Approve readiness**, record the preparation/review notes, and select **Save Supporter decision**.
6. Select the same person again, choose **Start service**, and choose **Ongoing Supporter** or **Temporary coverage**. Enter the service reason and save.
7. Verify the active service record. There can be only one current Supporter for that Circle.

Readiness alone does not start service. Service grants scoped Circle Supporter access when needed, retaining any independent Administrator access. It does not change billing, charge a card, cancel a subscription, or grant a complimentary entitlement. New direct Guide/Supporter invitations are rejected with guidance to use member entry and this workflow.

## Step down and arrange optional coverage

A person can step down immediately; finding a replacement is not a prerequisite.

1. Tyler or Mitch opens **End service / arrange coverage**.
2. Choose the active service record.
3. Choose **End now; arrange coverage separately**, or an eligible, readiness-approved current Circle member for **Temporary coverage**.
4. Record the reason and select **End service**.
5. Verify the ended record and, if selected, the new temporary service record.

When coverage is selected, its eligibility and readiness are checked in the same transaction as the departure. A failed coverage check saves neither change, so an operator can choose to end immediately without coverage instead. Service and decision history remain intact.

Removing or transferring a member out of their Circle also closes that Circle's Supporter service automatically. Scoped Supporter permission ends when no other active service scope remains. Independent member, Administrator, and complimentary grants remain. No workflow forces a person to stay until a replacement exists.

## Record discretionary reimbursements

Only the Administrator with **Reimbursement approval and processing** responsibility can view or act on these private financial records. Libby owns both decisions and processing; no Tyler/Mitch approval step is required.

The ledger records **manual external payments**. Saving, approving, or marking a record processed does not call Stripe, send a payout, issue a refund, or change membership billing.

### Add a period for review

1. Open **Supporters → Reimbursements → Add reimbursement for review**.
2. Choose the actual Supporter service record, including an ended record if appropriate.
3. Enter the USD amount and service-from/service-through dates in UTC.
4. Record the basis for review and select **Add for review**.

Only elapsed dates within the recorded service period qualify. Ending service does not erase eligibility for a prior active period. Overlapping non-declined claims for the same Supporter are rejected, including across different service assignments. Eligibility does not decide the reimbursement amount or promise approval.

### Decide

1. Review the pending record, service dates, amount, and supporting information.
2. Choose **Approve reimbursement** or **Decline reimbursement**.
3. Record the decision reason and select **Record decision**.

A declined record remains in history. A corrected request can be submitted for review; an existing record's amount, service dates, and original request are not silently overwritten. An approval is not a completed payment.

### Process and record

1. After approval, Libby makes the payment through the team's chosen payment method outside this app.
2. Open **Record completed external payment** on the approved record.
3. Enter the payment reference, actual paid-on date in UTC, and processing notes.
4. Select **Mark processed** and verify the saved reference and date.

The date must fall between approval and today. A recorded payment reference cannot be reused for another processed reimbursement. Repeated or stale requests cannot process the same approved record twice. These checks protect the ledger; the app cannot verify that an external transfer actually occurred.

## Release and operating checks

The code is currently local. No production responsibility owners, Supporter service records, reimbursements, payouts, or membership changes have been created by this implementation.

Apply the platform migrations through the existing migration runner, in this order, as part of the authorized release:

1. `20260930100000_supporter_service.sql` — responsibilities, readiness/service metadata, private reimbursement ledger, departure closure, and funding policy.
2. `20260930101000_circle_placement.sql` — preferences, suggestions' supporting data, participant counting, and placement exception records/rules.
3. `20260930102000_circle_reveal.sql` — member Circle visibility and scoped access/notification gates.
4. `20260930103000_leadership_terminology.sql` — current role terminology and retirement of new progression-title grants while retaining history.

Then configure and verify the actual responsibility accounts. Do not use preview names as production account selectors. Check a non-owner Administrator cannot make the protected decisions or read reimbursement details, and that a suspended/revoked owner no longer retains authority.

Before launch, review any existing Circle/Block Calendar meetings whose attendees were synchronized before the reveal gate. If members still in Foundations are already on those external events, use the existing meeting audience reconciliation/update workflow and verify its result. The in-app gate does not retract an email already delivered by Google. Likewise, a saved Google Chat link does not manage membership in the external Chat space; coordinate that access with the final reveal.

The release preserves existing staff assignments and historical grants. The changed funding predicate means Circle Supporter/Guide roles alone no longer provide complimentary member access; verify affected existing accounts have paid membership or a separately authorized complimentary entitlement. The migration does not collect payment or change a Stripe subscription.

Use the preview to practice selections and submissions without writing records. Check the smallest phone layout, desktop, the final Foundations completion path, service departure without a replacement, exception approval with a changed roster, and the reimbursement decision/recording path before publishing.
