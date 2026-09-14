# Public community event operations

Release approved September 14, 2026. The listing and attendance migration is applied and checksum-verified; existing BYOB registrations remain unchanged. Operator and public-consumer application rollouts are separate releases and must both complete for website listings to reflect operator edits.

## Operator flow

- **Learning & events → Experiences → Public community** (`/ops/experiences?view=community`) lists published, draft and archived public events. **Member experiences** remains the separate, existing membership event system.
- **Add public event** creates a draft or published listing. **Manage event** edits its title, date/time/time zone, location, description, admission, existing site-media paths, visibility and registration link.
- **Previously held** leaves an event visible in the public archive. **Archived** hides the listing but keeps its registrations, consent and attendance records.
- BYOB Nº 02 retains its existing native registration form and approved waiver. Operators can open/close it, search its canonical roster, and mark attendance. Attendance corrections append history; they do not change the original registration or waiver.
- New public listings use either no registration or an external registration provider. This release does not invent new public waivers, native public registration forms, capacity limits or waitlists.
- Public Community, homepage journey events, public search and member Upcoming consume the same published listings. Empty results mean no published events; they never revive archived static content.

## Preservation and authorization

- Original BYOB registration UUIDs, event keys, waiver versions/evidence and Google Sheets row identities remain unchanged. No registrants are copied into member experience tables.
- The existing BYOB idempotency, anti-abuse checks, waiver verification and Sheets outbox remain intact. Registration now checks and locks the listing inside its transaction; closing/unpublishing cannot race a later accepted registration.
- Public administration and roster data require an active Administrator grant checked inside every repository transaction. Shapers/Guides do not gain public attendee access through their member-experience permissions.
- Edits require the latest event version. Attendance updates require the latest attendance event ID. Conflicts instruct the operator to refresh instead of silently overwriting someone else's work.
- Listings and attendance tables use RLS and grant no direct browser-role privileges. Attendance is append-only and changes are recorded in the operator audit log.
- Preview screens are read-only and do not show real attendee information.

## Release requirements

1. Review the scoped diff and register/apply `20260914221302_community_event_operations.sql` through the existing checksum-aware migration runner, after its existing dependencies. Do not edit previously applied migrations.
2. Deploy the member/operator host and public website code together. **Both hosts must use the same canonical database.** A public host without a database connection intentionally retains its existing static content and will not receive operator edits until connected.
3. The exact current BYOB 01/02 content is seeded once, including gallery linkage, media paths and dates. Do not reseed on every request. Existing galleries/credits remain in their asset registry.
4. Verify the new Public community tab with a real Administrator, the ordinary member/Shaper denial paths, and save/reload using an approved disposable draft. Verify no draft appears on the public site or in member Upcoming.
5. With approval, test publishing/archiving the disposable listing across both hosts and public search. Test attendance against a dedicated existing test registration, not a real attendee. Do not create provider sends or copy real consent evidence for a smoke test.
6. Check existing BYOB form, rate limiting, waiver matching, registration count and Sheets sync. This code does not itself run the Sheets worker or send any messages during deployment.

Missing listing schema or an intentionally unconfigured public database can use legacy published content during rollout. Once the schema exists, empty/draft/archived states are authoritative. A configured database failure throws for registration and does not silently reopen it; client public feeds show no events on failure.

## Local verification

The focused PostgreSQL-engine suite executes the actual BYOB registration migrations and new listing/attendance migration. It verifies exact seeded appearance, publish/edit/archive, stale-version conflicts, private permissions, canonical registration/waiver/Sheets preservation, immutable attendance, registration closure, and fallback/outage distinctions. Provider delivery and production browser operations still require the separate release checks above.
