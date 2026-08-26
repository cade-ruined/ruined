import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const checkoutRoute = await readFile(new URL("../app/api/stripe/checkout/route.ts", import.meta.url), "utf8");
const webhookRoute = await readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8");
const webhookProcessor = await readFile(new URL("../src/lib/stripe/webhook.ts", import.meta.url), "utf8");
const billingRepository = await readFile(new URL("../src/lib/stripe/billing-repository.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../db/migrations/20260819_stripe_billing.sql", import.meta.url), "utf8");

test("membership Checkout fixes price and quantity on the server", () => {
  assert.match(checkoutRoute, /const viewer = await getCurrentPlatformViewer\(\)/);
  assert.match(checkoutRoute, /requireActivePlatformMemberLink\(viewer\)/);
  assert.match(checkoutRoute, /getStripeMembershipPriceId\(\)/);
  assert.match(checkoutRoute, /line_items:\s*\[\{ price: priceId, quantity: 1 \}\]/);
  assert.doesNotMatch(checkoutRoute, /body\.(email|price|priceId|amount|quantity)/);
  assert.match(checkoutRoute, /automatic_tax:\s*\{ enabled: isStripeTaxEnabled\(\) \}/);
  assert.match(checkoutRoute, /customer_email:\s*email/);
  assert.match(checkoutRoute, /integration_identifier:\s*"ruined_my_[a-z]{8}"/);
  assert.doesNotMatch(checkoutRoute, /customer_update|reservation\.stripeCustomerId/);
});

test("billing persistence binds Stripe identity to the verified platform member", () => {
  assert.match(billingRepository, /const newMemberId = randomUUID\(\)/);
  assert.match(billingRepository, /authUserId:\s*string/);
  assert.match(billingRepository, /stripe_customer_id = \$\{input\.customerId\}/);
  assert.match(billingRepository, /is_primary = true/);
});

test("checkout consent evidence gives Postgres explicit JSON value types", () => {
  assert.match(
    billingRepository,
    /jsonb_build_object\('checkout_attempt_id', \$\{input\.checkoutAttemptId\}::text\)/,
  );
  assert.match(
    billingRepository,
    /'checkout_attempt_id', \$\{input\.checkoutAttemptId\}::text,[\s\S]*?'minimum_age', \$\{input\.minimumAge\}::integer/,
  );
});

test("success redirect never activates membership", () => {
  assert.doesNotMatch(checkoutRoute, /membership_state\s*=|membershipState\s*=(?!=)/);
  assert.match(webhookProcessor, /event\.type === "invoice\.paid" && invoice\.amount_paid > 0/);
});

test("webhook verifies the exact raw request body before processing", () => {
  const rawBodyIndex = webhookRoute.indexOf("await request.text()");
  const verificationIndex = webhookRoute.indexOf("webhooks.constructEvent");
  const processingIndex = webhookRoute.indexOf("processStripeWebhookEvent(event)");

  assert.ok(rawBodyIndex >= 0);
  assert.ok(verificationIndex > rawBodyIndex);
  assert.ok(processingIndex > verificationIndex);
  assert.match(webhookRoute, /event\.api_version !== STRIPE_API_VERSION/);
});

test("webhook event IDs and event ordering are durable database constraints", () => {
  assert.match(migration, /event_id text primary key/);
  assert.match(migration, /billing_last_event_created bigint not null default 0/);
  assert.match(migration, /stripe_checkout_attempts_one_open_idx/);
  assert.match(migration, /stripe_checkout_attempts_member_idx/);
  assert.match(migration, /stripe_invoices_member_idx/);
  assert.match(
    migration,
    /revoke all on table[\s\S]*stripe_webhook_events[\s\S]*from anon, authenticated;/,
  );
  assert.match(migration, /stripe_subscription_id text/);
  assert.match(migration, /set stripe_subscription_id = session\.stripe_subscription_id/);
  assert.match(billingRepository, /subscription\.id = attempt\.stripe_subscription_id/);
  assert.match(billingRepository, /when 'ended' then 3[\s\S]*when 'attention_required' then 2/);
  assert.match(webhookProcessor, /membership_price_mismatch/);
  assert.match(webhookProcessor, /event\.type === "invoice\.marked_uncollectible"/);
});
