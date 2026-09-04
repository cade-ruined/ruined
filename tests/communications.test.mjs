import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

async function source(file) {
  return fs.readFile(path.join(root, file), "utf8");
}

test("communications schema is private, consent-aware, and queues Resend delivery", async () => {
  const [migration, platformMigration, runner] = await Promise.all([
    source("db/migrations/20260819_communications.sql"),
    source("db/migrations/20260819_platform_foundation.sql"),
    source("scripts/migrate-platform.mjs"),
  ]);

  for (const table of [
    "communication_contacts",
    "communication_subscriptions",
    "communication_consent_events",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists ${table}`));
    assert.match(migration, new RegExp(`alter table ${table} enable row level security`));
  }

  assert.match(migration, /communication_consent_events_no_update/);
  assert.match(migration, /check \(topic in \('store', 'artifacts', 'about'\)\)/);
  assert.match(migration, /from anon, authenticated/);
  assert.match(migration, /destination in \('shopify', 'stripe', 'google', 'resend'\)/);
  assert.match(platformMigration, /destination in \('shopify', 'stripe', 'google', 'resend'\)/);
  assert.match(runner, /20260819_communications\.sql/);
});

test("public signup requires explicit general consent and writes through the server", async () => {
  const [route, repository, model, form, journey, gate] = await Promise.all([
    source("app/api/communications/subscribe/route.ts"),
    source("src/lib/communications/repository.ts"),
    source("src/lib/communications/model.ts"),
    source("src/components/EmailSignupForm.tsx"),
    source("src/components/sequence/JourneyComingSoon.tsx"),
    source("src/components/ComingSoonGate.tsx"),
  ]);

  assert.match(route, /isTrustedPlatformOrigin\(request\)/);
  assert.match(route, /MAX_BODY_LENGTH/);
  assert.match(route, /body\.consent === true/);
  assert.doesNotMatch(route, /body\.source|isCommunicationSource/);
  assert.match(route, /subscribeToGeneralUpdates\(email\)/);
  assert.match(route, /process\.env\.DATABASE_URL/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_SUPABASE|SUPABASE_SECRET_KEY/);

  assert.match(repository, /sql\.begin/);
  assert.match(repository, /pg_advisory_xact_lock/);
  assert.match(repository, /insert into communication_consent_events/);
  assert.match(repository, /insert into integration_outbox/);
  assert.match(repository, /'resend'/);
  assert.match(repository, /'pending_confirmation'/);
  assert.match(repository, /current\?\.status === "pending_confirmation"/);
  assert.match(repository, /on conflict \(dedupe_key\) do nothing/);
  assert.match(repository, /const source = GENERAL_COMMUNICATION_SOURCE/);
  assert.doesNotMatch(repository, /'email', \$\{email\}/);

  assert.match(model, /GENERAL_COMMUNICATION_SOURCE = "about"/);
  assert.match(model, /COMMUNICATION_SOURCES = \["store", "artifacts", "about"\]/);
  assert.match(model, /EMAIL_CONSENT_VERSION = "ruined-general-updates-v1"/);
  assert.match(model, /Email me about Ruined updates\. Unsubscribe anytime\./);
  assert.doesNotMatch(model, /Email me when the Store opens|Email me when Artifacts launches/);
  assert.match(form, /\/api\/communications\/subscribe/);
  assert.match(form, /name="consent"/);
  assert.match(form, /EMAIL_CONSENT_NOTICES\[GENERAL_COMMUNICATION_SOURCE\]/);
  assert.doesNotMatch(form, /source[:,]/);
  assert.match(journey, /<EmailSignupForm variant="panel" \/>/);
  assert.doesNotMatch(journey, /<EmailSignupForm[^>]*source=/);
  assert.match(gate, /\{signup && <EmailSignupForm \/>\}/);
  assert.doesNotMatch(gate, /<EmailSignupForm[^>]*source=/);
});

test("public configuration and privacy copy no longer depend on HubSpot", async () => {
  const [environment, privacy] = await Promise.all([
    source(".env.example"),
    source("app/privacy/page.tsx"),
  ]);

  assert.doesNotMatch(environment, /HUBSPOT_/);
  assert.match(environment, /RESEND_API_KEY=/);
  assert.match(environment, /RESEND_TOPIC_UPDATES_ID=/);
  assert.match(environment, /RESEND_TOPIC_STORE_ID=/);
  assert.match(environment, /RESEND_TOPIC_ARTIFACTS_ID=/);
  assert.doesNotMatch(privacy, /HubSpot/);
  assert.match(privacy, /Supabase data and account services/);
  assert.match(privacy, /Resend email delivery/);
});

test("confirmation credentials are hashed at rest and queued without a raw email", async () => {
  const [migration, repository, worker] = await Promise.all([
    source("db/migrations/20260819_communications.sql"),
    source("src/lib/communications/repository.ts"),
    source("src/lib/communications/worker.ts"),
  ]);

  assert.match(migration, /create table if not exists communication_confirmation_tokens/);
  assert.match(migration, /token_hash text not null unique/);
  assert.match(migration, /token_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /alter table communication_confirmation_tokens enable row level security/);

  assert.match(repository, /createHash\("sha256"\)\.update\(token, "utf8"\)\.digest\("hex"\)/);
  assert.match(repository, /const confirmationToken = randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(repository, /const confirmationTokenHash = hashConfirmationToken\(confirmationToken\)/);
  assert.match(repository, /insert into communication_confirmation_tokens[\s\S]*?\$\{confirmationTokenHash\}/);
  assert.match(repository, /'confirmation_token', \$\{confirmationToken\}::text/);
  assert.doesNotMatch(repository, /'email',\s*\$\{email\}/);
  assert.match(
    repository,
    /resend:communication-contact:\$\{record\.contactId\}:subscription:\$\{record\.subscriptionId\}:v\$\{updated\.version\}/,
  );
  assert.doesNotMatch(
    repository,
    /resend:communication-contact:\$\{record\.contactId\}:v\$\{updated\.version\}/,
  );
  assert.match(worker, /getConfirmationDeliveryContext\([\s\S]*?email: context\.email/);
  assert.doesNotMatch(worker, /payloadString\(event, "email"\)/);
});

test("signup rate limiting is durable and returns a bounded 429 response", async () => {
  const [migration, repository, route] = await Promise.all([
    source("db/migrations/20260819_communications.sql"),
    source("src/lib/communications/repository.ts"),
    source("app/api/communications/subscribe/route.ts"),
  ]);

  assert.match(migration, /create table if not exists communication_signup_rate_limits/);
  assert.match(migration, /primary key \(fingerprint_hash, window_started_at\)/);
  assert.match(migration, /window_started_at = date_trunc\('hour', window_started_at\)/);
  assert.match(migration, /alter table communication_signup_rate_limits enable row level security/);

  assert.match(repository, /insert into communication_signup_rate_limits/);
  assert.match(repository, /on conflict \(fingerprint_hash, window_started_at\) do update/);
  assert.match(repository, /where communication_signup_rate_limits\.attempts < \$\{SIGNUP_ATTEMPTS_PER_HOUR\}/);
  assert.match(route, /consumeCommunicationSignupRateLimit\(fingerprint\)/);
  assert.match(route, /\{ error: "Too many requests" \}/);
  assert.match(route, /status: 429, headers: \{ "Retry-After": "3600" \}/);
});

test("Resend outbox work is locked, retried, dead-lettered, and scrubbed", async () => {
  const [outbox, worker] = await Promise.all([
    source("src/lib/communications/outbox.ts"),
    source("src/lib/communications/worker.ts"),
  ]);

  assert.match(outbox, /for update skip locked/);
  assert.match(outbox, /attempts < \$\{MAX_ATTEMPTS\}/);
  assert.match(outbox, /const terminal = event\.attempts >= MAX_ATTEMPTS/);
  assert.match(outbox, /status = \$\{terminal \? "dead_letter" : "failed"\}/);
  assert.match(outbox, /now\(\) \+ \(\$\{backoffSeconds\} \* interval '1 second'\)/);
  assert.match(outbox, /then payload - 'confirmation_token'/);

  assert.match(worker, /markResendOutboxEventSucceeded\(event\.id, workerId\)/);
  assert.match(worker, /markResendOutboxEventFailed\([\s\S]*?safeFailureLabel\(event, error\)/);
  assert.match(worker, /const errorName = error instanceof Error && error\.name \? error\.name : "Error"/);
  assert.doesNotMatch(worker, /error\.message/);
});

test("Resend uses general updates for new signups and preserves legacy topic mappings", async () => {
  const resend = await source("src/lib/communications/resend.ts");

  assert.match(resend, /const TOPIC_ENVIRONMENT_VARIABLES: Record<ResendTopic, string> = \{/);
  assert.match(resend, /about: "RESEND_TOPIC_UPDATES_ID"/);
  assert.match(resend, /store: "RESEND_TOPIC_STORE_ID"/);
  assert.match(resend, /artifacts: "RESEND_TOPIC_ARTIFACTS_ID"/);
  assert.match(resend, /getResendTopicId\(topic: ResendTopic\)[\s\S]*?TOPIC_ENVIRONMENT_VARIABLES\[topic\]/);
  assert.match(resend, /internalTopicById\(\)[\s\S]*?new Map\(entries\)/);
});

test("Resend webhook verification receives the exact raw body and signed headers", async () => {
  const [route, resend] = await Promise.all([
    source("app/api/webhooks/resend/route.ts"),
    source("src/lib/communications/resend.ts"),
  ]);

  assert.match(route, /const rawBody = await request\.text\(\)/);
  assert.match(route, /event = verifyResendWebhook\(rawBody, request\.headers\)/);
  assert.doesNotMatch(route, /JSON\.parse\(rawBody\)/);
  assert.match(resend, /readWebhookHeader\(headers, "svix-id"\)/);
  assert.match(resend, /readWebhookHeader\(headers, "svix-timestamp"\)/);
  assert.match(resend, /readWebhookHeader\(headers, "svix-signature"\)/);
  assert.match(resend, /webhooks\.verify\(\{[\s\S]*?payload: rawBody,[\s\S]*?headers: \{ id, timestamp, signature \},[\s\S]*?webhookSecret/);
});

test("signed Resend webhooks dedupe receipts before applying supported events", async () => {
  const [route, repository] = await Promise.all([
    source("app/api/webhooks/resend/route.ts"),
    source("src/lib/communications/repository.ts"),
  ]);

  assert.match(route, /const svixId = request\.headers\.get\("svix-id"\)/);
  assert.ok(route.indexOf("verifyResendWebhook(rawBody, request.headers)") < route.indexOf("applyResendContactPreferencesWebhook({"));
  assert.ok(route.indexOf("verifyResendWebhook(rawBody, request.headers)") < route.indexOf("applyResendDeliveryWebhook({"));
  assert.match(route, /applyResendContactPreferencesWebhook\(\{/);
  assert.match(route, /applyResendDeliveryWebhook\(\{/);

  assert.match(repository, /insert into communication_webhook_events/);
  assert.match(repository, /on conflict \(svix_id\) do nothing/);
  assert.match(repository, /if \(!inserted\) return "duplicate"/);
  assert.match(repository, /applyResendContactPreferencesWebhook[\s\S]*?insertWebhookReceipt/);
  assert.match(repository, /applyResendDeliveryWebhook[\s\S]*?insertWebhookReceipt/);
});

test("confirmation requires a deliberate POST and signup explains the next step", async () => {
  const [page, route, form] = await Promise.all([
    source("app/communications/confirm/page.tsx"),
    source("app/api/communications/confirm/route.ts"),
    source("src/components/EmailSignupForm.tsx"),
  ]);

  assert.match(page, /Opening this page did not change your email preferences/);
  assert.match(page, /action="\/api\/communications\/confirm"/);
  assert.match(page, /method="post"/);
  assert.match(page, /type="hidden" name="token" value=\{token\}/);
  assert.match(page, /Only this deliberate action confirms your subscription\./);
  assert.match(route, /export async function POST\(request: Request\)/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.match(form, /Check your email to confirm\./);
});

test("confirmation email carries the Ruined identity with durable fallbacks", async () => {
  const [resend, template] = await Promise.all([
    source("src/lib/communications/resend.ts"),
    source("src/lib/communications/general-updates-confirmation-email.ts"),
  ]);
  const wordmark = await fs.readFile(path.join(root, "public", "ruined-wordmark-email.png"));

  assert.equal(wordmark.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(wordmark.readUInt32BE(16), 600);
  assert.equal(wordmark.readUInt32BE(20), 180);
  await fs.access(path.join(root, "public", "fonts", "IvyOraText-Regular.ttf"));
  await fs.access(path.join(root, "public", "fonts", "Inter-Variable-Latin.woff2"));

  assert.match(resend, /const siteUrl = requireProductionSiteUrl\(\)/);
  assert.match(resend, /createGeneralUpdatesConfirmationEmail\(\{/);
  assert.match(resend, /\.\.\.confirmationEmail/);
  assert.match(
    template,
    /const wordmarkUrl = new URL\("\/ruined-wordmark-email\.png", input\.siteUrl\)\.toString\(\)/,
  );
  assert.match(template, /const escapedWordmarkUrl = escapeHtml\(wordmarkUrl\)/);
  assert.match(template, /src="\$\{escapedWordmarkUrl\}"/);
  assert.match(template, /alt="RUINED"/);
  assert.doesNotMatch(template, /<img[^>]+src="\/ruined-wordmark-email\.png"/);

  assert.match(
    template,
    /font-family:&quot;IvyOra Text&quot;,&quot;Iowan Old Style&quot;,Baskerville,Georgia,Cambria,&quot;Times New Roman&quot;,Times,serif/,
  );
  assert.match(
    template,
    /font-family:&quot;Inter Ruined&quot;,Inter,&quot;Helvetica Neue&quot;,Helvetica,Arial,sans-serif/,
  );
  assert.match(template, /IvyOraText-Regular\.ttf/);
  assert.match(template, /Inter-Variable-Latin\.woff2/);

  assert.match(
    template,
    /<a href="\$\{escapedConfirmationUrl\}"[^>]*>Confirm email<\/a>/,
  );
  assert.doesNotMatch(template, /href="\$\{confirmationUrl\}"/);
  assert.match(
    template,
    /text:\s*\[[\s\S]*?"Confirm this email address to receive the Ruined updates you requested\."[\s\S]*?confirmationUrl[\s\S]*?"If you did not request this, you can ignore this email\."[\s\S]*?\]\.join\("\\n"\)/,
  );
});

test("Resend sync snapshots and recovery preserve consent ordering", async () => {
  const [migration, repository, outbox, worker, resend] = await Promise.all([
    source("db/migrations/20260819_communications.sql"),
    source("src/lib/communications/repository.ts"),
    source("src/lib/communications/outbox.ts"),
    source("src/lib/communications/worker.ts"),
    source("src/lib/communications/resend.ts"),
  ]);

  assert.match(migration, /resend_preferences_synced_at timestamptz/);
  assert.match(migration, /resend_preferences_snapshot jsonb/);
  assert.match(migration, /resend_sync_started_at timestamptz/);
  assert.match(migration, /resend_sync_locked_by text/);
  assert.match(migration, /resend_sync_snapshot jsonb/);
  assert.match(migration, /state_changed_at timestamptz not null default now\(\)/);
  assert.match(
    migration,
    /resend_sync_started_at is null[\s\S]*?resend_sync_locked_by is null[\s\S]*?resend_sync_snapshot is null/,
  );
  assert.match(
    migration,
    /resend_sync_started_at is not null[\s\S]*?resend_sync_locked_by is not null[\s\S]*?jsonb_typeof\(resend_sync_snapshot\) = 'object'/,
  );

  assert.match(repository, /status = 'pending_confirmation'[\s\S]*?state_changed_at = now\(\)/);
  assert.match(repository, /status = 'subscribed'[\s\S]*?state_changed_at = now\(\)/);

  const beginStart = outbox.indexOf("export async function beginResendContactSync");
  const completeStart = outbox.indexOf("export async function completeResendContactSync");
  const releaseStart = outbox.indexOf("export async function releaseResendContactSync");
  const beginLease = outbox.slice(beginStart, completeStart);
  const completeLease = outbox.slice(completeStart, releaseStart);
  const releaseLease = outbox.slice(releaseStart);

  assert.match(beginLease, /return sql\.begin\(async \(tx\) => \{/);
  assert.match(beginLease, /resend_sync_started_at = \$\{startedAt\}/);
  assert.match(beginLease, /resend_sync_locked_by = \$\{leaseId\}/);
  assert.match(beginLease, /resend_sync_snapshot = \([\s\S]*?select jsonb_build_object/);
  assert.match(beginLease, /'store',[\s\S]*?bool_or\(topic = 'store' and status = 'subscribed'\)/);
  assert.match(beginLease, /'artifacts',[\s\S]*?bool_or\(topic = 'artifacts' and status = 'subscribed'\)/);
  assert.match(beginLease, /'about',[\s\S]*?bool_or\(topic = 'about' and status = 'subscribed'\)/);
  assert.match(beginLease, /returning[\s\S]*?resend_sync_snapshot as topics/);
  assert.match(beginLease, /return \{ status: rows\[0\]\?\.exists \? "busy" : "missing" \}/);
  assert.match(beginLease, /return \{ status: "acquired", context: contact \}/);

  // JSONB round trips and lease completion run against the installed driver
  // and isolated PostgreSQL in integration-json-persistence.test.mjs.
  assert.match(completeLease, /resend_preferences_synced_at = case[\s\S]*?resend_preferences_synced_at < \$\{completedAt\}[\s\S]*?then \$\{completedAt\}/);
  assert.match(completeLease, /resend_sync_started_at = null/);
  assert.match(completeLease, /resend_sync_locked_by = null/);
  assert.match(completeLease, /resend_sync_snapshot = null/);
  assert.match(completeLease, /and resend_sync_locked_by = \$\{leaseId\}/);
  assert.match(completeLease, /throw new Error\("Resend contact sync lease was lost\."\)/);
  assert.match(releaseLease, /resend_sync_started_at = null/);
  assert.match(releaseLease, /resend_sync_locked_by = null/);
  assert.match(releaseLease, /resend_sync_snapshot = null/);
  assert.match(releaseLease, /and resend_sync_locked_by = \$\{leaseId\}/);

  const leaseBegin = worker.indexOf("const lease = await beginResendContactSync(");
  const remoteSync = worker.indexOf("const synced = await upsertResendContact({", leaseBegin);
  const leaseComplete = worker.indexOf("await completeResendContactSync(", remoteSync);
  const leaseRelease = worker.indexOf("await releaseResendContactSync(", leaseComplete);
  assert.ok(leaseBegin >= 0 && leaseBegin < remoteSync && remoteSync < leaseComplete && leaseComplete < leaseRelease);
  assert.match(worker, /completeResendContactSync\([\s\S]*?synced\.contactId,[\s\S]*?context\.topics,[\s\S]*?new Date\(\)/);
  assert.match(worker, /catch \(error\) \{[\s\S]*?releaseResendContactSync\(context\.contactId, leaseId\)[\s\S]*?throw error/);

  const existingStart = resend.indexOf("if (existingContact) {");
  const existingEnd = resend.indexOf("\n  return {", existingStart);
  const existingContactSync = resend.slice(existingStart, existingEnd);
  assert.equal(
    (existingContactSync.match(/resend\.contacts\.topics\.update/g) ?? []).length,
    1,
  );
  assert.match(existingContactSync, /resend\.contacts\.topics\.update\(\{[\s\S]*?id: contactId,[\s\S]*?topics: topicUpdates/);
  assert.doesNotMatch(existingContactSync, /resend\.contacts\.update|unsubscribed\s*:/);

  const claimStart = outbox.indexOf("export async function claimNextResendOutboxEvent");
  const claimEnd = outbox.indexOf("export async function markResendOutboxEventSucceeded", claimStart);
  const claim = outbox.slice(claimStart, claimEnd);
  assert.match(outbox, /const STALE_LOCK_MINUTES = 10/);
  assert.match(claim, /status = 'processing'[\s\S]*?attempts >= \$\{MAX_ATTEMPTS\}[\s\S]*?locked_at < now\(\) - \(\$\{STALE_LOCK_MINUTES\}/);
  assert.match(claim, /status = 'dead_letter'/);
  assert.match(claim, /update communication_contacts contact[\s\S]*?resend_sync_started_at = null[\s\S]*?resend_sync_locked_by = null[\s\S]*?resend_sync_snapshot = null/);
  assert.match(claim, /dead_lettered\.worker_id \|\| ':' \|\| dead_lettered\.id::text/);

  const preferenceStart = repository.indexOf("export async function applyResendContactPreferencesWebhook");
  const deliveryStart = repository.indexOf("export async function applyResendDeliveryWebhook");
  const preferenceWebhook = repository.slice(preferenceStart, deliveryStart);
  const deliveryWebhook = repository.slice(deliveryStart);

  assert.match(preferenceWebhook, /resend_preferences_snapshot as "resendPreferencesSnapshot"/);
  assert.match(preferenceWebhook, /resend_preferences_synced_at as "resendPreferencesSyncedAt"/);
  assert.match(preferenceWebhook, /resend_sync_started_at as "resendSyncStartedAt"/);
  assert.match(preferenceWebhook, /resend_sync_snapshot as "resendSyncSnapshot"/);
  assert.match(repository, /const RESEND_SYNC_LEASE_MINUTES = 10/);
  assert.match(preferenceWebhook, /resend_sync_started_at >= now\(\)[\s\S]*?\$\{RESEND_SYNC_LEASE_MINUTES\}/);
  assert.match(preferenceWebhook, /if \(contact\.resendSyncStartedAt && !contact\.resendSyncActive\) \{[\s\S]*?resend_sync_started_at = null[\s\S]*?resend_sync_locked_by = null[\s\S]*?resend_sync_snapshot = null[\s\S]*?and resend_sync_started_at = \$\{contact\.resendSyncStartedAt\}/);
  assert.match(preferenceWebhook, /const matchesLastAppSync = !input\.globallyUnsubscribed/);
  assert.match(preferenceWebhook, /COMMUNICATION_SOURCES\.every\([\s\S]*?input\.topics\[topic\] === contact\.resendPreferencesSnapshot\?\.\[topic\]/);
  assert.match(
    preferenceWebhook,
    /if \(\s*matchesLastAppSync\s*&& contact\.resendPreferencesSyncedAt\s*&& input\.eventCreatedAt\.getTime\(\) <= contact\.resendPreferencesSyncedAt\.getTime\(\)\s*\) return "processed"/,
  );
  assert.doesNotMatch(preferenceWebhook, /if \(matchesLastAppSync\) return "processed"/);
  assert.equal(
    (preferenceWebhook.match(/contact\.resendPreferencesSyncedAt/g) ?? []).length,
    2,
  );
  assert.match(
    preferenceWebhook,
    /const matchesActiveAppSync = contact\.resendSyncActive[\s\S]*?!input\.globallyUnsubscribed[\s\S]*?Boolean\(contact\.resendSyncSnapshot\)[\s\S]*?input\.topics\[topic\] === contact\.resendSyncSnapshot\?\.\[topic\]/,
  );
  assert.match(preferenceWebhook, /if \(matchesActiveAppSync\) return "processed"/);
  assert.doesNotMatch(preferenceWebhook, /if \(contact\.resendSyncActive\) return "processed"|still syncing/);
  assert.doesNotMatch(preferenceWebhook, /pendingSyncRows|select exists \([\s\S]*?from integration_outbox/);
  assert.match(preferenceWebhook, /state_changed_at as "stateChangedAt"/);
  assert.match(preferenceWebhook, /input\.eventCreatedAt\.getTime\(\) < subscription\.stateChangedAt\.getTime\(\)/);
  assert.match(preferenceWebhook, /state_changed_at = \$\{input\.eventCreatedAt\}/);
  assert.match(preferenceWebhook, /let consentChanged = false/);
  assert.match(
    preferenceWebhook,
    /const canonicalPreferences = new Map\([\s\S]*?subscriptions\.map\(\(subscription\) => \[[\s\S]*?subscription\.topic,[\s\S]*?subscription\.status === "subscribed" \? "opt_in" : "opt_out"/,
  );
  assert.match(
    preferenceWebhook,
    /const syncCorrectionRequired = COMMUNICATION_SOURCES\.some\(\(topic\) => \{[\s\S]*?const resendPreference = input\.topics\[topic\]/,
  );
  assert.match(
    preferenceWebhook,
    /resendPreference !== \(canonicalPreferences\.get\(topic\) \?\? "opt_out"\)/,
  );
  assert.match(preferenceWebhook, /consentChanged = true/);
  assert.ok(
    preferenceWebhook.indexOf("const syncCorrectionRequired =")
      < preferenceWebhook.indexOf("consentChanged = true;"),
  );
  assert.match(preferenceWebhook, /if \(consentChanged \|\| syncCorrectionRequired\) \{[\s\S]*?insert into integration_outbox[\s\S]*?'communication\.contact\.sync_requested'[\s\S]*?preference-webhook:\$\{input\.svixId\}/);

  assert.match(deliveryWebhook, /const deliveryEventIsCurrent = [\s\S]*?delivery_state_updated_at/);
  assert.match(
    deliveryWebhook,
    /if \(deliveryEventIsCurrent\) \{[\s\S]*?update communication_contacts[\s\S]*?\n    \}\n    if \(!input\.withdrawConsent\) return "processed";[\s\S]*?update communication_subscriptions/,
  );
  assert.doesNotMatch(deliveryWebhook, /if \(!deliveryEventIsCurrent\)[\s\S]{0,120}return/);
  assert.match(deliveryWebhook, /and state_changed_at <= \$\{input\.eventCreatedAt\}/);
  assert.match(deliveryWebhook, /state_changed_at = \$\{input\.eventCreatedAt\}/);
  assert.match(deliveryWebhook, /if \(subscriptions\.length > 0\) \{[\s\S]*?insert into integration_outbox[\s\S]*?'communication\.contact\.sync_requested'[\s\S]*?delivery-webhook:\$\{input\.svixId\}/);
});
