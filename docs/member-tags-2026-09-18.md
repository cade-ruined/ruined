# Member tags

Preferred name is replaced in joining and Edit profile by a member-chosen unique `@tag`. Tags contain 3–24 lowercase ASCII letters, numbers, or underscores. The form accepts an optional `@` and normalizes case; a PostgreSQL unique index decides competing claims. A taken tag returns a specific, retryable 409 without saving any other profile or sharing changes.

Existing display names and legacy preferred-name data remain intact. New joining uses `@tag` as the initial public display name, never the private legal name. Members can customize their display name separately. If a generated `@tag` name is still unchanged when the tag changes, it follows the new tag. A claimed tag cannot be cleared, while existing named profiles without one can continue editing normally. Existing completed and in-flight paid/complimentary memberships retain their access and readiness behavior.

The tag appears on the member profile, permitted Circle profiles, enabled public cards, invitations, accessible card details, and social previews. Card/invitation sharing gates still apply; Circle tags follow directory visibility. Opaque share tokens and referral attribution remain tied to the member, so renaming a tag does not change those links or counts. Tags do not introduce public lookup routes or authentication credentials.

Apply `20260920200000_member_tags.sql` before releasing the application. It adds a nullable `person_profiles.member_tag` column with a format check and a unique partial index; existing rows and permissions are unchanged. Keep the additive column/index if rolling the application back.

Validation includes real PostgreSQL-compatible tests for uniqueness, concurrent claims, stale revisions, full-save rollback, legacy compatibility, and public consent. Standalone print proofs check the maximum tag, long display names, existing foil clearances, legacy cards, and deduplication when the tag is also the display name. These proofs do not verify browser interaction or responsive rendering; browser access remains unavailable because its security policy service cannot be verified.

Release validation: all 1,226 tests passed, ESLint and TypeScript passed, and the production build completed successfully. The standalone print renderer passed eight member/invitation/legacy/tag variants with text and foil-clearance assertions; social-preview tests rendered real 1200×630 PNGs including maximum-length names and tags. The read-only production preflight found 39 matching applied migrations and only the new member-tag migration pending.
