# Resend email workspace

**Messages → Emails** (`/ops/messages?mode=emails`, also `/ops/emails`) gives Ruined administrators a front end for the existing Resend account. Resend supplies designs, audience groups, topics, campaign drafts and sending history. Administrators edit the copy directly within the selected design.

## Designs and copy

The workspace loads a template's current HTML, version, subject, sender, reply address and variables from Resend. Published and draft templates can both supply a design snapshot. A published template with unpublished changes is identified explicitly: Resend returns its published HTML until those changes are published. The preview reflects the version returned by Resend. This workflow does not publish or overwrite the original template.

Static designs also work. The editor exposes visible text fields while preserving the original layout, images, logos, links and conditional markup. The Ruined type rules use IvyOra for headings and Inter for body copy, with email-safe serif and sans-serif fallbacks. Font styles are applied to this composition; the source design in Resend is not overwritten. Edits replace only selected text spans or declared variables. Unsubscribe labels, hidden preheaders, decorative punctuation and active code are excluded from copy editing. Authored copy is escaped as text; the browser cannot supply replacement HTML.

Fill required variables and edit the subject and copy fields, then check the rendered preview before saving or reviewing recipients.

Copy fields allow 12,000 characters, variables 6,000, combined edits 48,000, and the completed subject 200. Numeric variables are validated. Variables in unsupported layout or active-code contexts must be corrected in Resend. Link variables must form safe absolute URLs.

The preview uses the actual rendered design in a sandboxed frame. When static copy changes, the plain-text alternative is regenerated from the edited design so it does not retain old copy. Unchanged designs retain their authored text alternative.

**Sign-off** adds a customizable short phrase in yellow (`#ffca2c`) CadeHandy2. The Personal note starts with “All the love”; existing recognized handwritten sign-offs retain their text. Change the phrase or remove it. Lettering is rendered from the actual font as a transparent PNG with an accessible text alternative and plain-text equivalent. Previews generate in memory; saving a draft or reviewing recipients stores immutable artwork in the existing public email-image bucket, under the same administrator upload limit. The reviewed URL is frozen with the email. No upload happens on each keystroke. IvyOra and Inter can fall back in inboxes that do not load web fonts; the handwriting image preserves its exact lettering when images are displayed.

**Image banner** adds an optional image to this email. Choose a JPG, PNG, or WebP from your device (up to 3 MiB), or paste a public HTTPS image URL. Add a short image description and optionally a HTTPS destination URL. Uploads go to Ruined's Supabase storage and their public URL is inserted automatically; Resend uses that image when delivering individual emails or native campaigns. The original banner stays in place if an upload fails. Replace the photo or URL to change the image, or choose **Remove banner** to restore the original design. The banner appears before the main headline, below the existing logo, and scales to the available width without cropping. It leaves the source Resend template unchanged. Banner changes invalidate the previous recipient review and saved draft selection.

Device uploads use a dedicated public `admin-email-images` bucket, separate from private member photos and journals. Only active administrators can upload through the same-origin server endpoint. Requests are bounded before multipart parsing, actual image bytes are decoded and verified, and files are resized within 1,600 × 1,600 pixels without cropping or enlargement. Metadata is removed; output is email-compatible JPEG or PNG. Invalid, animated, oversized, or unreadable files are rejected. A durable limit allows 30 upload attempts per administrator per hour. Uploads use random, immutable names; replacing or removing a banner from a draft does not delete an image that an already-sent email may use. Upload only artwork intended to be publicly accessible.

Resend's public API does not document an image-hosting upload endpoint. Its [editor upload integration](https://react.email/docs/editor/features/image-upload) expects the application to provide the hosted URL. This workspace uses the existing Ruined storage service rather than relying on Resend dashboard internals.

## Individual emails and campaigns

**Individual email** sends one direct or service email to one reviewed address through Resend. It respects the provider's global unsubscribe and suppression state and does not enroll the address in an audience or topic. Templates containing native campaign personalization, such as `{{{contact.first_name|friend}}}` or `{{{RESEND_UNSUBSCRIBE_URL}}}`, are campaign-only; choose an individual-email design for a direct message.

**Campaign** uses an existing Resend group and topic. Review applies global unsubscribe, suppressions and the topic's current preference, including its configured default where no explicit preference exists. Selecting a group never changes preferences. Review is limited to 1,000 contacts; narrow larger groups in Resend.

Saving a campaign creates a native Resend broadcast draft with the selected design and edited copy. Reviewing an unsaved campaign first creates that draft. Existing Resend drafts can also be opened and reviewed. Campaign unsubscribe links and contact personalization remain native markers for Resend to resolve. Required footer content, including the sender's postal address, belongs in the Resend design.

Some dashboard-created campaigns cannot be modified or sent through the provider API. The workspace reports this limitation and offers **Open in Resend** to finish there.

## Review and sending

Review stores an immutable rendered snapshot, provider campaign state where applicable, and the exact resolved recipient list. Reviews belong to the administrator who created them and expire after 30 minutes. Changed template, campaign, audience or preference state requires another review.

Sending requires an explicit administrator action. The server checks the current grant, rechecks provider state and recipients, and commits a durable send claim before contacting Resend. Campaigns send through the existing native broadcast ID. Individual emails use frozen HTML/text and a stable idempotency key. A campaign cannot be claimed through another review while its previous sending result is uncertain.

Uncertain responses are not automatically retried. Check Resend before another send. Provider acceptance is not inbox-delivery proof; history shows the provider's reported status.

The application stores review snapshots, send claims, audit events and image-upload usage limits. It does not maintain a second audience database or a separate background email delivery queue for this workspace.

## Configuration

Keep these migrations in the existing platform migration runner. They are already applied in production; new installations apply them through the same runner:

1. `20261008180000_admin_email.sql` — historical AI generation limits, now inactive. Preserve the applied migration and checksum.
2. `20261008200000_resend_email_frontend.sql` — private immutable reviews and send claims.
3. `20261008210000_admin_email_images.sql` — private upload usage limits and the dedicated public email-image bucket.

New tables have row-level security and deny direct public/client access. The server uses its existing database connection and active administrator grants.

Server environment:

- `RESEND_API_KEY`: full access to the required template, segment, topic, contact, suppression, email and broadcast APIs. A sending-only key cannot power the workspace.
- `ADMIN_EMAIL_SENDING_ENABLED=true`: enables sending on a connected platform. Disabled by default.
- `RESEND_FROM_EMAIL`: optional fallback when a template has no sender. Configure a verified sender in Resend.
- Existing `NEXT_PUBLIC_SUPABASE_URL` and server-only `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) enable device uploads. The email-image bucket must be public; an existing private bucket with the same name is not silently made public. Uploads never reuse private member-media buckets.

No OpenAI credentials or ChatGPT setup is required. No new cron job or application postal-address setting is required. Resend handles campaign delivery, and its template supplies the footer.

In non-production development with `PLATFORM_MODE=preview`, an optional Resend key can load real templates, groups and topics for design inspection. This preview exposes neither contacts nor sending history and cannot send or create provider drafts. Device photos stay in the browser for a clearly labeled local preview; they are not uploaded or included in API requests. Production routes require administrator authentication.

## Validation and release

Tests mock Resend and Supabase Storage and use an isolated database. They cover provider pagination, preferences, exact design preservation, safe substitutions, version and audience conflicts, send claims, uncertainty handling, authorization, image validation and storage permissions. The actual retrieved Resend design was separately checked for byte-identical round-tripping and precise copy edits without changing links, images or personalization.

Removing the writing assistant requires no database changes. Keep existing review history, upload limits, images and historical migrations intact. Verify manual editing, image uploads, recipient review and sending safeguards, then complete deployment checks. Local tests and design previews do not establish live delivery.
