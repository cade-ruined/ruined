# Administrator email composer

The admin workspace includes **Messages → Emails** at `/ops/messages?mode=emails` (also `/ops/emails`). Administrators can ask ChatGPT to write or revise copy, edit the subject, preview text and body, save drafts, review the resolved recipient list, and explicitly queue delivery. Board posts and app alerts remain separate message types.

## Audience and review

- **Individual addresses**: up to 250 addresses, normalized and deduplicated. Eligibility follows the chosen purpose.
- **General updates**: marketing to contacts with a confirmed general Ruined updates subscription.
- **Members**: canonical registered members; marketing additionally requires their general-updates subscription.
- **Service**: membership service notices to registered members only. This is not a way to bypass marketing preferences.

Review shows included recipients and an excluded count. The server saves the review against the administrator, draft version, content and exact resolved recipient set. Sending requires that same review, no more than 30 minutes old. Changes to copy or audience require another review. Queued copy and recipients are immutable, and resubmitting the same approved request returns its original queue.

Drafting sends only the administrator's prompt and optional editable copy to OpenAI. Recipient lists and member records are not added to the model request. An administrator can include sensitive information in their own prompt; use the same care as when drafting in any connected writing tool. Responses are requested with `store: false`. The model has no tools or sending capability.

## Configuration

Apply `20261008180000_admin_email.sql` using the existing platform migration runner. The new tables use row-level security and deny direct public/client access. The server uses its existing database connection and active administrator checks.

Server environment:

- `OPENAI_API_KEY`: OpenAI API project key for drafting. Keep this in deployment secrets, never in public configuration or source control.
- `OPENAI_EMAIL_MODEL`: defaults to `gpt-4.1-mini`; select a model supporting Responses structured outputs.
- `ADMIN_EMAIL_SENDING_ENABLED=true`: enable the delivery queue.
- Existing `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL` and `CRON_SECRET`.
- Marketing also requires `RESEND_MARKETING_ENABLED=true`, `RESEND_TOPIC_UPDATES_ID` and `ADMIN_EMAIL_POSTAL_ADDRESS` (included in the marketing footer).

Missing OpenAI configuration leaves manual drafting available. Sending stays unavailable until delivery configuration is complete. Each administrator may request 30 generations per hour; the limit is stored in the database and also applies to failed provider requests.

## Delivery

Each recipient receives a separate email, keeping other addresses private. Delivery rechecks membership/consent and suppression. Marketing also checks current Resend preferences. Emails use escaped plain text rendered into a restrained HTML template; model-generated HTML is never executed.

A successful send action means **queued**, not delivered. An after-response batch begins processing promptly; `/api/internal/communications/admin-emails` runs every five minutes for remaining recipients and retries. It requires `CRON_SECRET`. Provider acceptance is shown as **sent**; this is not inbox-delivery proof.

The queue stores immutable provider payloads and stable per-recipient idempotency keys. Ambiguous sends past the safe retry window require manual review rather than risking duplicate mail. The history displays pending, sending, sent, failed, skipped and review-needed counts.

Marketing emails include a token-protected unsubscribe link and one-click unsubscribe headers. Opening the landing page does not change preferences; a confirmed POST does. Unsubscribing updates the local general-updates preference immediately and queues the existing Resend contact sync. Essential account and membership emails are separate.

## Verification and release

The focused runtime tests cover authorization, review/version conflicts, eligibility, unsubscribe, immutable queue payloads, provider failures and retry behavior. AI tests use mocked OpenAI responses and check input limits, refusal/incomplete handling, and that recipient data is excluded. Browser QA should cover desktop and narrow mobile widths, saving/reopening a draft, revising, reviewing, and send confirmation.

Before enabling production, configure the secrets, apply the migration, deploy this branch to the membership application, and verify a real generation and a single explicitly approved recipient. Local mocked-provider tests do not establish live OpenAI access or live email delivery.

Implementation references: [OpenAI Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-4.1 mini model](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
