# Member journey design

The approved profile now defines the member experience: IvyOra editorial headings, Inter controls, CadeHandy2 personal labels, realistic paper and ink materials, and Signal Yellow for the next action. The existing wordmark, leaf, fonts, and Polaroid frame are preserved.

## Navigation and screens

`MemberJourneyShell` supplies the desktop sidebar and four-item mobile navigation: Profile, My Circle, Foundations, Events. Search reaches the remaining member tools. The topbar has an explicit Paper/Ink switch; Settings also offers System appearance. The choice persists across member pages. Sign-in and joining use a quieter version of this frame, and the Foundations reader retains a focused layout.

The profile contains Journal, Timeline, Saved, and About. Timeline reuses the existing editor, persistence, conflict handling, and exports. About retains the actual member record and distinguishes attended from credited events and earned, gifted, and purchased artifacts. No username, founding-member status, or membership number is invented. Circle keeps the existing circular portrait cluster and consent-filtered directory.

## Journal

Journal entries are private to their authenticated owner. Circle visibility preferences do not publish entries. Text entries require body text; image and video entries accept an optional caption and title. Titles are limited to 160 characters, body text to 20,000, galleries to eight JPG/PNG/WebP images at 8 MiB each, and video to one MP4/WebM at 50 MiB. Cards use Blue for words, Tan for images, and Verdigris for video. Saved entries are available in the Saved tab; pagination exposes older entries.

The journal API derives ownership from the current session and member policy, checks mutation origins, bounds streamed JSON bodies, and keeps responses private and uncached. Client-generated entry IDs make retries idempotent. Signed uploads target a separate staging object; actual image decoding and video container checks precede attaching media. Images are rotated, resized, converted to WebP, and stripped of metadata. The verified object cannot be replaced using the staging upload token. Media reads check the owner before issuing an expiring private Storage URL; native video playback uses Storage's range support.

A member can reserve up to 100 media uploads a day and 1 GiB of storage. Unverified reservations conservatively count as 50 MiB. Unfinished uploads expire after 24 hours and are removed during the next upload preparation; published media is retained. Drafts remain in memory while the profile stays mounted. Refresh warns about an unfinished draft; leaving the profile ends that draft. Preview data and uploads remain temporary and never write to the member database.

## Release verification

The private journal migration is `db/migrations/20260916230000_member_journal.sql`, registered with the established checksum-checked migration runner. Application and release evidence are recorded in `member-journey-release-2026-09-16.md`. It creates private journal tables and the dedicated private `member-journal` Storage bucket; it does not modify the portrait bucket. The existing Supabase server key and Postgres configuration are used. Confirm the migration and bucket using a staging member, then exercise text, galleries, video, retrying a save, pagination, and two-member access isolation before production rollout.

The release also requires visual browser verification in both appearances at 320, 390, 1024, and 1440 pixels, including the native dialogs and the actual Foundations reader. Browser inspection was blocked by the app's unavailable security-check service during this implementation; no visual pass is claimed.
