# Profile header and permanent member numbers

The owner profile uses the larger portrait and split sans/serif name treatment from the development design. Mobile portraits are 156px wide (128px below 360px); desktop portraits are 208px. The exact supplied Polaroid frame and leaf geometry are unchanged. The red @tag sits below the name. Edit profile, My Card and My Invitation share one row, with 44px touch targets; Member since is separate.

A custom public display name remains the heading. When that name is the generated @tag, the authenticated owner's header uses their private full name. This presentation is local to /my and never changes the public profile/card/invitation projections. Missing full names use My profile rather than repeating the tag.

The badge beside the leaf derives from a permanent member number:

| Numbers | Badge |
| --- | --- |
| 1–5 | Founders |
| 6–50 | Originals |
| 51–100 | Pillars |
| 101–200 | Builders |
| 201 onward | Members |

Numbers are shown as No. 0001 (at least four digits) and are assigned upon completed membership entry, not pending registration or payment alone. Completed complimentary membership qualifies. Test-only payments do not consume permanent places. Existing genuine completed entries are ordered by recorded access/completion history. Numbers remain assigned across cancellation/reactivation and are never recycled after deletion. A transactional counter avoids gaps from failed transactions.

The development preview carries an explicit sample number in its fixture. The component never invents a number for an unnumbered account.

Browser inspection is unavailable because the browser's security policy service cannot be verified. Source-level responsive review and native font-width checks are available; these do not constitute a rendered browser or device visual inspection.

Validation: all 1,235 regression tests passed; TypeScript and lint checks passed. The production build passed. Header checks cover owner-name privacy, custom names, missing names, long names, tier boundaries, and mobile action sizing. Database tests cover historical ordering, eligibility, concurrent allocation, rollback, cancellation, deletion, and browser-role restrictions.
