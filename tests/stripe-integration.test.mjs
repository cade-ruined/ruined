import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const checkoutRoute = await readFile(new URL("../app/api/stripe/checkout/route.ts", import.meta.url), "utf8");
const checkoutClient = await readFile(new URL("../src/components/membership/JoinForm.tsx", import.meta.url), "utf8");
const checkoutCompletionPage = await readFile(new URL("../app/my/join/complete/page.tsx", import.meta.url), "utf8");
const webhookRoute = await readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8");
const webhookProcessor = await readFile(new URL("../src/lib/stripe/webhook.ts", import.meta.url), "utf8");
const billingRepository = await readFile(new URL("../src/lib/stripe/billing-repository.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../db/migrations/20260819_stripe_billing.sql", import.meta.url), "utf8");

test("embedded membership Checkout fixes the offer on the server", () => {
  const requestType = checkoutRoute.match(/type CheckoutRequest = \{([\s\S]*?)\n\};/)?.[1] ?? "";

  assert.match(checkoutRoute, /const viewer = await getCurrentPlatformViewer\(\)/);
  assert.match(checkoutRoute, /requireActivePlatformMemberLink\(viewer\)/);
  assert.match(checkoutRoute, /getStripeMembershipPriceId\(\)/);
  assert.match(checkoutRoute, /line_items:\s*\[\{ price: priceId, quantity: 1 \}\]/);
  assert.doesNotMatch(requestType, /email|price|priceId|amount|quantity/i);
  assert.doesNotMatch(checkoutRoute, /body\.(email|price|priceId|amount|quantity)/);
  assert.match(checkoutRoute, /automatic_tax:\s*\{ enabled: isStripeTaxEnabled\(\) \}/);
  assert.match(checkoutRoute, /customer_email:\s*email/);
  assert.match(checkoutRoute, /integration_identifier:\s*"ruined_my_[a-z]{8}"/);
  assert.match(checkoutRoute, /ui_mode:\s*"embedded_page"/);
  assert.match(checkoutRoute, /redirect_on_completion:\s*"always"/);
  assert.match(
    checkoutRoute,
    /return_url:\s*`\$\{applicationOrigin\}\/my\/join\/complete`/,
  );
  assert.doesNotMatch(checkoutRoute, /\b(?:success_url|cancel_url|payment_method_types)\s*:/);
  assert.doesNotMatch(checkoutRoute, /customer_update|reservation\.stripeCustomerId/);
});

test("embedded Checkout returns only a non-cacheable client secret and mounts with Stripe.js", () => {
  assert.match(
    checkoutRoute,
    /function clientSecretResponse\(clientSecret: string\)[\s\S]*?\{ clientSecret \}[\s\S]*?"Cache-Control": "no-store"/,
  );
  assert.match(checkoutRoute, /return clientSecretResponse\(existingSession\.client_secret\)/);
  assert.match(checkoutRoute, /return clientSecretResponse\(session\.client_secret\)/);
  assert.doesNotMatch(checkoutRoute, /\{\s*checkoutUrl:/);

  assert.match(checkoutClient, /cache:\s*"no-store"/);
  assert.match(checkoutClient, /!payload\.clientSecret/);
  assert.match(checkoutClient, /setClientSecret\(payload\.clientSecret\)/);
  assert.match(
    checkoutClient,
    /stripe\.createEmbeddedCheckoutPage\(\{ clientSecret \}\)/,
  );
  assert.match(checkoutClient, /instance\.mount\(mountRef\.current\)/);
  assert.match(checkoutClient, /checkout\?\.destroy\(\)/);
  assert.doesNotMatch(checkoutClient, /window\.location\.assign\(payload\./);
});

test("an open hosted Checkout Session is expired remotely and locally before replacement", () => {
  const reusableEmbeddedIndex = checkoutRoute.indexOf(
    'existingSession.ui_mode === "embedded_page"',
  );
  const remoteExpiryIndex = checkoutRoute.indexOf(
    "stripe.checkout.sessions.expire(existingSession.id)",
  );
  const localExpiryIndex = checkoutRoute.indexOf(
    "expireMembershipCheckoutAttempt(reservation.attemptId)",
  );
  const replacementIndex = checkoutRoute.indexOf("const replacementAttemptId");
  const secondReservationIndex = checkoutRoute.indexOf(
    "reservation = await reserveMembershipCheckout",
    replacementIndex,
  );

  assert.ok(reusableEmbeddedIndex >= 0, "open embedded Sessions must be reused");
  assert.ok(remoteExpiryIndex > reusableEmbeddedIndex, "legacy Session must expire in Stripe");
  assert.ok(localExpiryIndex > remoteExpiryIndex, "legacy attempt must then expire locally");
  assert.ok(replacementIndex > localExpiryIndex, "replacement ID must follow both expirations");
  assert.ok(
    secondReservationIndex > replacementIndex,
    "replacement Checkout must reserve a fresh local attempt",
  );
  assert.match(
    checkoutRoute,
    /existingSession\.status === "open"[\s\S]*?stripe\.checkout\.sessions\.expire\(existingSession\.id\)/,
  );
  assert.match(checkoutRoute, /\? crypto\.randomUUID\(\) : checkoutAttemptId/);
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

test("embedded return page never activates membership and a paid invoice remains authoritative", () => {
  assert.doesNotMatch(checkoutRoute, /membership_state\s*=|membershipState\s*=(?!=)/);
  assert.doesNotMatch(
    checkoutCompletionPage,
    /updateMemberBillingState|processStripeWebhookEvent|membership_state\s*=|checkout\.sessions\.retrieve/,
  );
  assert.match(checkoutCompletionPage, /context\.member\?\.billingState === "active"/);
  assert.match(checkoutCompletionPage, /The return screen never activates access by itself\./);

  const checkoutHandler = webhookProcessor.slice(
    webhookProcessor.indexOf("async function handleCheckoutSession"),
    webhookProcessor.indexOf("function subscriptionSnapshot"),
  );
  assert.doesNotMatch(checkoutHandler, /updateMemberBillingState/);
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
