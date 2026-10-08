# Resend email workspace

**Messages → Emails** (`/ops/messages?mode=emails`, also `/ops/emails`) gives Ruined administrators a front end for the existing Resend account. Resend supplies designs, audience groups, topics, campaign drafts and sending history. ChatGPT revises copy within the selected design.

## Designs and copy

The workspace loads a template's current HTML, version, subject, sender, reply address and variables from Resend. Published and draft templates can both supply a design snapshot. A published template with unpublished changes is identified explicitly: the preview reflects the current version returned by Resend. This workflow does not publish or overwrite the original template.

Static designs also work. The editor exposes visible text fields while preserving the original layout, styles, images, logos, links and conditional markup. Edits replace only selected text spans or declared variables. Unsubscribe labels, hidden preheaders, decorative punctuation and active code are excluded from copy editing. Authored copy is escaped as text; the browser and model cannot supply replacement HTML.

Fill required variables before requesting a ChatGPT revision. The model receives the administrator's prompt, subject and editable text values; recipient lists, member records and design HTML are not automatically included. Returned copy must retain the exact known field and variable keys and pass the same rendering checks as manual edits. Requests use `store: false`. Administrators should still avoid unnecessary sensitive information in their prompts.

Copy fields allow 12,000 characters, variables 6,000, combined edits 48,000, and the completed subject 200. Numeric variables are validated. Variables in unsupported layout or active-code contexts must be corrected in Resend. Link variables must form safe absolute URLs.

The preview uses the actual rendered design in a sandboxed frame. When static copy changes, the plain-text alternative is regenerated from the edited design so it does not retain old copy. Unchanged designs retain their authored text alternative.

## Individual emails and campaigns

**Individual email** sends one direct or service email to one reviewed address through Resend. It respects the provider's global unsubscribe and suppression state and does not enroll the address in an audience or topic. Templates containing native campaign personalization, such as `{{{contact.first_name|friend}}}` or `{{{RESEND_UNSUBSCRIBE_URL}}}`, are campaign-only; choose an individual-email design for a direct message.

**Campaign** uses an existing Resend group and topic. Review applies global unsubscribe, suppressions and the topic's current preference, including its configured default where no explicit preference exists. Selecting a group never changes preferences. Review is limited to 1,000 contacts; narrow larger groups in Resend.

Saving a campaign creates a native Resend broadcast draft with the selected design and edited copy. Reviewing an unsaved campaign first creates that draft. Existing Resend drafts can also be opened and reviewed. Campaign unsubscribe links and contact personalization remain native markers for Resend to resolve. Required footer content, including the sender's postal address, belongs in the Resend design.

Some dashboard-created campaigns cannot be modified or sent through the provider API. The workspace reports this limitation and offers **Open in Resend** to finish there.

## Review and sending

Review stores an immutable rendered snapshot, provider campaign state where applicable, and the exact resolved recipient list. Reviews belong to the administrator who created them and expire after 30 minutes. Changed template, campaign, audience or preference state requires another review.

Sending requires an explicit administrator action. The server checks the current grant, rechecks provider state and recipients, and commits a durable send claim before contacting Resend. Campaigns send through the existing native broadcast ID. Individual emails use frozen HTML/text and a stable idempotency key. A campaign cannot be claimed through another review while its previous sending result is uncertain.

Uncertain responses are not automatically retried. Check Resend before another send. Provider acceptance is not inbox-delivery proof; history shows the provider's reported status.

The application stores review snapshots, send claims, audit events and AI usage limits. It does not maintain a second audience database or a separate background email delivery queue for this workspace.

## Configuration

Apply both migrations with the existing platform migration runner:

1. `20261008180000_admin_email.sql` — private administrator AI generation limits.
2. `20261008200000_resend_email_frontend.sql` — private immutable reviews and send claims.

New tables have row-level security and deny direct public/client access. The server uses its existing database connection and active administrator grants.

Server environment:

- `RESEND_API_KEY`: full access to the required template, segment, topic, contact, suppression, email and broadcast APIs. A sending-only key cannot power the workspace.
- `OPENAI_API_KEY`: enables ChatGPT revisions. Manual editing remains available without it.
- `OPENAI_EMAIL_MODEL`: defaults to `gpt-4.1-mini`; use a model supporting Responses structured outputs.
- `ADMIN_EMAIL_SENDING_ENABLED=true`: enables sending on a connected platform. Disabled by default.
- `RESEND_FROM_EMAIL`: optional fallback when a template has no sender. Configure a verified sender in Resend.

No new cron job or application postal-address setting is required. Resend handles campaign delivery, and its template supplies the footer. Each administrator can request 30 AI revisions per hour; failed provider requests consume that limit.

In non-production development with `PLATFORM_MODE=preview`, an optional Resend key can load real templates, groups and topics for design inspection. This preview exposes neither contacts nor sending history and cannot send or create provider drafts. Production routes require administrator authentication.

## Validation and release

Tests mock OpenAI and Resend and use an isolated database. They cover provider pagination, preferences, exact design preservation, safe substitutions, version and audience conflicts, send claims, uncertainty handling, authorization and AI output validation. The actual retrieved Resend design was separately checked for byte-identical round-tripping and precise copy edits without changing links, images or personalization.

This implementation is delivered as a draft pull request. It has not been deployed or enabled in production. Before release, apply migrations, configure credentials, complete review and deployment checks, then verify a real AI revision and one explicitly authorized send. Local tests and design previews do not establish live delivery.
