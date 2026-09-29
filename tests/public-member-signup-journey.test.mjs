import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import Stripe from "stripe";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const requirePackage = createRequire(new URL("../package.json", import.meta.url));
const { NextRequest } = requirePackage("next/server");
const read = path => readFileSync(resolve(root, path), "utf8");
const origin = "https://signup.example.test";
// Deliberately synthetic, isolated from process.env and any local environment file.
const environment = Object.freeze({
  NODE_ENV: "test", PLATFORM_MODE: "connected", NEXT_PUBLIC_SITE_URL: origin,
  DATABASE_URL: "local-test-no-network", NEXT_PUBLIC_SUPABASE_URL: "https://supabase.invalid",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-test-no-network",
  STRIPE_SECRET_KEY: "sk_test_local_journey_fixture", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_local_journey_fixture",
  STRIPE_WEBHOOK_SECRET: "whsec_local_journey_fixture", STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID: "price_monthly",
  STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID: "price_annual", STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION: "ruined_membership-v2", STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_reviewed_test",
  STRIPE_MEMBERSHIP_FOUNDING_INDIVIDUAL_ANNUAL_PRICE_ID: "price_founding_annual",
  STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID: "bpc_commitment_test",
  STRIPE_TAX_ENABLED: "false", STRIPE_MEMBERSHIP_COMMERCIAL_READY: "true",
});
const denyNetwork = async () => { throw new Error("Network calls are forbidden in the signup journey test."); };
class OfflineStripe extends Stripe {
  constructor(key, options) {
    super(key, { ...options, maxNetworkRetries: 0, httpClient: Stripe.createFetchHttpClient(denyNetwork) });
  }
}

function sqlFor(engine) {
  const sql = async (strings, ...values) => {
    const text = strings.reduce((result, part, index) => result + (index ? `$${index}` : "") + part, "");
    return (await engine.query(text, values.map(value => value instanceof Date ? value.toISOString() : value))).rows;
  };
  sql.json = value => JSON.stringify(value);
  sql.begin = callback => engine.transaction(transaction => callback(sqlFor(transaction)));
  return sql;
}

function sourceLoader(overrides) {
  const cache = new Map();
  const localGlobals = { fetch: denyNetwork };
  function load(path) {
    const absolute = resolve(root, path);
    assert.ok(absolute.startsWith(root), "Source dependency escaped the repository.");
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const loaded = { exports: {} };
    cache.set(absolute, loaded);
    const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
      fileName: absolute,
    }).outputText;
    const requireSource = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === "server-only") return {};
      if (name === "stripe") return OfflineStripe;
      if (name === "postgres") throw new Error("Network database access is forbidden in this test.");
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(absolute), name);
        const match = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`]
          .find(candidate => extname(candidate) && existsSync(candidate));
        assert.ok(match, `Unresolved source dependency: ${name}`);
        return extname(match) === ".json" ? JSON.parse(readFileSync(match, "utf8")) : load(match);
      }
      return requirePackage(name);
    };
    new Function("require", "module", "exports", "process", "globalThis", "fetch", code)(
      requireSource, loaded, loaded.exports, { env: environment }, localGlobals, denyNetwork,
    );
    return loaded.exports;
  }
  return load;
}

test("Ruined invitation signup reaches paid onboarding through the real issuance, OTP, profile, agreement, checkout and signed webhook handlers", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const migrations = [...read("scripts/migrate-platform.mjs").matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)];
  assert.ok(migrations.length > 40, "Use the complete shipped schema, including all triggers.");
  for (const migration of migrations) await db.exec(read(migration[1]));

  // Only publish synthetic test terms. No member, profile, consent, role, or
  // onboarding checkpoint is seeded; the real signup handlers must create them.
  const agreementId = randomUUID();
  const terms = "TEST ONLY. Synthetic recurring membership terms for an offline application journey. This is not a real legal agreement.";
  await db.query("insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,'ruined_membership',2,'Offline journey terms',$2,$3,'published',now())",
    [agreementId, terms, createHash("sha256").update(terms).digest("hex")]);
  const viewer = { authUserId: randomUUID(), email: "signup-journey@example.test" };
  let signedInViewer = null;
  const delivered = [], verified = [], creations = [], invitationDeliveries = [];
  let workflowPasses = 0;
  const sql = sqlFor(db);
  const noCommunication = new Proxy({}, { get: (_target, property) => property === "__esModule" ? true : denyNetwork });
  const load = sourceLoader({
    "@/lib/membership/personal-invitation-delivery": {
      getPersonalInvitationEmailReady: () => true,
      processPersonalInvitationEmailBatch: async (...args) => {
        const committed = (await db.query("select delivery_status from member_personal_invitations where id=$1", [args[1].invitationId])).rows[0];
        assert.equal(committed?.delivery_status, "queued", "Delivery starts only after the invitation transaction commits.");
        invitationDeliveries.push(args);
      },
    },
    "@/lib/database/server": { getApplicationDatabase: () => sql, withFreshApplicationDatabaseRead: (_stage, callback) => callback() },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => signedInViewer },
    "@/lib/supabase/server": { createSupabaseCurrentResponseClient: ({ request, response }) => ({ auth: {
      signInWithOtp: async input => { delivered.push(input); return { error: null }; },
      verifyOtp: async input => {
        verified.push(input);
        if (input.token !== "123456") return { data: { user: null }, error: { code: "otp_expired" } };
        request.cookies.set("test-session", "verified");
        response.cookies.set("test-session", "verified", { httpOnly: true, sameSite: "lax", path: "/" });
        return { data: { user: { id: viewer.authUserId, email: viewer.email } }, error: null };
      },
      signOut: async options => {
        assert.deepEqual(options, { scope: "local" });
        response.cookies.set("test-session", "", { maxAge: 0 });
        return { error: null };
      },
    } }) },
    "@/lib/workflows/worker": { processWorkflowBatch: async () => { workflowPasses++; } },
    "@/lib/google/calendar": noCommunication,
    "@/lib/support/delivery": noCommunication,
  });
  const routes = Object.fromEntries(["membership/signup/invitation", "auth/otp/request", "auth/otp/verify", "my/onboarding", "my/agreement", "stripe/checkout", "stripe/membership-offer", "stripe/webhook"]
    .map(path => [path, load(`app/api/${path}/route.ts`)]));
  const identity = load("src/lib/membership/repository.ts");
  const signup = load("src/lib/membership/public-signup-admission.ts");
  const policy = load("src/lib/membership/access-policy.ts");
  const server = load("src/lib/stripe/server.ts");
  const stripe = server.getStripe();
  const price = { id: "price_founding_annual", active: true, livemode: false, type: "recurring", billing_scheme: "per_unit", transform_quantity: null,
    currency: "usd", tax_behavior: "exclusive", unit_amount: 349000, recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } };
  let session, subscription, latestInvoice;
  stripe.customers.retrieve = async () => ({ id: "cus_offline_journey", email: viewer.email, address: { country: "US" } });
  stripe.invoices.retrieve = async () => latestInvoice;
  stripe.invoicePayments.list = async () => ({ has_more: false, data: [{ id: "inpay_fixture", invoice: latestInvoice.id, status: "paid", livemode: false, currency: "usd", amount_paid: price.unit_amount, payment: { type: "payment_intent", payment_intent: "pi_fixture" } }] });
  stripe.paymentIntents.retrieve = async () => ({ id: "pi_fixture", status: "succeeded", livemode: false, customer: "cus_offline_journey", latest_charge: "ch_fixture" });
  stripe.charges.retrieve = async () => ({ id: "ch_fixture", paid: true, captured: true, status: "succeeded", refunded: false, amount_refunded: 0, disputed: false, amount: price.unit_amount, currency: "usd", livemode: false, customer: "cus_offline_journey" });
  stripe.refunds.list = async () => ({ has_more: false, data: [] });
  stripe.prices.retrieve = async id => { assert.equal(id, price.id); return price; };
  stripe.billingPortal.configurations.retrieve = async id => {
    assert.equal(id, "bpc_commitment_test");
    return { id, active: true, livemode: false, features: {
      invoice_history: { enabled: true }, payment_method_update: { enabled: true },
      subscription_cancel: { enabled: false, mode: "at_period_end", proration_behavior: "none" },
      subscription_update: { enabled: false },
    } };
  };
  stripe.checkout.sessions.create = async (params, options) => {
    creations.push({ params, options });
    session = { id: "cs_offline_journey", client_secret: "local_fixture_client_secret", status: "open", expires_at: Math.floor(Date.now() / 1000) + 3600,
      mode: "subscription", livemode: false, ui_mode: "embedded_page", currency: "usd", amount_subtotal: price.unit_amount,
      shipping_address_collection: params.shipping_address_collection, metadata: params.metadata, consent_collection: params.consent_collection, custom_text: params.custom_text, customer_email: viewer.email, customer: null, subscription: null };
    return session;
  };
  stripe.checkout.sessions.retrieve = async id => { assert.equal(id, session.id); return session; };
  stripe.subscriptions.retrieve = async id => { assert.equal(id, subscription.id); return subscription; };
  const post = (path, body) => routes[path].POST(new NextRequest(`${origin}/api/${path}`, {
    method: "POST", headers: { origin, "content-type": "application/json", "user-agent": "Offline signup integration test" }, body: JSON.stringify(body),
  }));
  const expectResponse = async (responsePromise, status) => {
    const response = await responsePromise, body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return { response, body };
  };
  const row = async query => (await db.query(query)).rows[0];
  const memberCount = async () => Number((await row("select count(*) from ruined_members")).count);
  const assertEntryOnly = async () => {
    const member = await identity.getMemberIdentity(viewer.authUserId);
    assert.equal(member.billingState, "pending");
    assert.equal(member.administrativeOnboardingState, "in_progress");
    assert.equal(member.programState, "prospect");
    assert.equal(member.standingState, "pre_active");
    assert.equal(policy.deriveMemberAccessPolicy(member).mode, "entry");
    assert.equal(policy.memberCan(policy.deriveMemberAccessPolicy(member), "foundations.write"), false);
  };
  const agreement = { affirmativeAction: "checkbox_and_submit", ageConfirmed: true, agreementVersionId: agreementId, attemptId: randomUUID(), signerName: "Integration Test Member" };
  let acceptanceId;
  const checkoutAttemptId = randomUUID();
  const checkoutBody = () => ({ acceptanceId, attemptId: checkoutAttemptId, commercialReservationId: checkoutAttemptId, plan: "annual", recurringPaymentAccepted: true });

  let invitationToken;
  const invitationRequest = { requestId: randomUUID(), recipientName: "Integration Test Member", recipientEmail: viewer.email, billingPlan: "annual" };

  await t.test("requesting a recipient-bound card queues one 48-hour invitation without creating Auth, membership, or referral credit", async () => {
    assert.equal(load("src/lib/platform/config.ts").getPlatformConfiguration().stripeCheckoutReady, true);
    await expectResponse(post("auth/otp/request", { email: viewer.email }), 200);
    await expectResponse(post("auth/otp/request", { email: viewer.email, signup: { plan: "annual" } }), 400);
    await expectResponse(post("auth/otp/verify", { email: viewer.email, token: "123456", signup: { plan: "annual" } }), 401);
    assert.equal(delivered.length, 0);
    assert.equal(verified.length, 0);
    const issued = await expectResponse(post("membership/signup/invitation", invitationRequest), 200);
    assert.deepEqual(issued.body, { ok: true, requestId: invitationRequest.requestId });
    assert.match(issued.response.headers.get("cache-control"), /no-store/);
    assert.equal(issued.response.cookies.getAll().length, 0);
    const invitation = await row("select * from member_personal_invitations");
    invitationToken = invitation.public_token;
    assert.match(invitationToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(invitation.origin, "ruined_direct");
    assert.equal(invitation.member_id, null);
    assert.equal(invitation.membership_type, "standard");
    assert.equal(invitation.billing_plan, "annual");
    assert.equal(invitation.recipient_email_normalized, viewer.email);
    assert.equal(invitation.inviter_name, "Ruined");
    assert.equal(invitation.inviter_tag, null);
    assert.equal(invitation.complimentary_authorized_by_auth_user_id, null);
    assert.equal(invitation.accepted_at, null);
    assert.equal(invitation.direct_joined_at, null);
    assert.equal(new Date(invitation.expires_at) - new Date(invitation.issued_at), 48 * 3600 * 1000);
    assert.equal(invitation.email_requested, true);
    assert.equal(invitation.delivery_status, "queued");
    assert.equal(delivered.length, 0, "The first email is the invitation card, never a provider OTP.");
    assert.deepEqual(invitationDeliveries, [[1, { invitationId: invitation.id }]]);
    await expectResponse(post("membership/signup/invitation", invitationRequest), 200);
    const persisted = (await db.query("select * from member_personal_invitations")).rows;
    assert.deepEqual(persisted, [invitation], "Retry preserves its token, selected plan, and original deadline.");
    for (const table of ["people", "ruined_members", "platform_users", "platform_role_grants", "member_onboardings", "membership_waitlist", "member_referrals"]) {
      assert.equal(Number((await row(`select count(*) from ${table}`)).count), 0, `${table} stays empty before verification`);
    }
  });

  await t.test("an issued card still requires the exact recipient and provider verification", async () => {
    await expectResponse(post("auth/otp/request", { email: "someone-else@example.test", invitationToken }), 403);
    assert.equal(delivered.length, 0);
    const requested = await expectResponse(post("auth/otp/request", { email: viewer.email, invitationToken }), 200);
    assert.deepEqual(delivered, [{ email: viewer.email, options: { shouldCreateUser: true, emailRedirectTo: `${origin}/my/confirmed` } }]);
    assert.equal(requested.response.cookies.get("ruined-invitation-context")?.value, invitationToken);
    assert.notEqual(requested.response.cookies.get("ruined-signup-context")?.value, "annual");
    assert.equal(requested.response.cookies.get("test-session"), undefined);
    const denied = await expectResponse(post("auth/otp/verify", { email: viewer.email, token: "999999", invitationToken }), 401);
    assert.equal(denied.response.cookies.get("test-session")?.value, "");
    assert.equal(await memberCount(), 0);
    assert.equal((await row("select accepted_at from member_personal_invitations")).accepted_at, null);
    await expectResponse(post("my/agreement", agreement), 401);
  });

  await t.test("verified direct invitation atomically creates pending standard membership with annual intent and no referral owner", async () => {
    const result = await expectResponse(post("auth/otp/verify", { email: viewer.email, token: "123456", invitationToken }), 200);
    assert.deepEqual(result.body, { redirectTo: "/my/join" });
    assert.equal(result.response.cookies.get("test-session")?.value, "verified");
    assert.equal(result.response.cookies.get("ruined-invitation-context")?.value, "");
    assert.match(result.response.headers.get("cache-control"), /no-store/);
    // Simulate the browser receiving the provider-issued session only after
    // the real route has successfully authorized and released its cookies.
    signedInViewer = viewer;
    assert.equal(await memberCount(), 1);
    assert.equal(await signup.getMemberSignupPlan(viewer.authUserId), "annual");
    assert.deepEqual((await db.query("select role_slug from platform_role_grants")).rows, [{ role_slug: "member" }]);
    const accepted = await row("select * from member_personal_invitations");
    assert.ok(accepted.accepted_at);
    assert.equal(accepted.accepted_by_auth_user_id, viewer.authUserId);
    assert.equal(accepted.accepted_member_id, (await row("select id from ruined_members")).id);
    assert.equal(accepted.member_id, null);
    assert.equal(accepted.direct_joined_at, null, "Verified acceptance does not report a paid joining.");
    assert.equal(Number((await row("select count(*) from membership_waitlist")).count), 0);
    assert.equal(Number((await row("select count(*) from member_referrals")).count), 0);
    await assertEntryOnly();
  });

  await t.test("profile and an explicit adult signature are prerequisites to the actual paid agreement", async () => {
    await expectResponse(post("my/agreement", agreement), 409);
    assert.equal(Number((await row("select count(*) from membership_agreement_acceptances")).count), 0);
    await expectResponse(post("stripe/checkout", { ...checkoutBody(), acceptanceId: randomUUID() }), 409);
    assert.equal(creations.length, 0);
    const profile = { action: "save_profile", apparelTopSize: "M", birthDate: "1990-01-01", legalName: agreement.signerName,
      mobile: "+12025550123", memberTag: "integrationtest", shippingAddress: { addressLine1: "123 Test Street", addressLine2: null,
        city: "Denver", countryCode: "US", postalCode: "80202", region: "CO" } };
    await expectResponse(post("my/onboarding", { ...profile, birthDate: "bad-date" }), 400);
    const saved = await expectResponse(post("my/onboarding", profile), 200);
    assert.equal(saved.body.onboarding.requiredFieldsComplete, true);
    assert.ok((await row("select profile_completed_at from member_onboardings")).profile_completed_at);
    await expectResponse(post("my/agreement", { ...agreement, ageConfirmed: false }), 400);
    await expectResponse(post("my/agreement", { ...agreement, signerName: "Different Name" }), 409);
    const accepted = await expectResponse(post("my/agreement", agreement), 200);
    acceptanceId = accepted.body.acceptance.id;
    assert.ok(acceptanceId);
    assert.equal((await expectResponse(post("my/agreement", agreement), 200)).body.acceptance.id, acceptanceId);
    const evidence = await row("select a.accepted_by_auth_user_id,a.agreement_body_snapshot,a.agreement_version_snapshot,a.signer_name_snapshot,c.consent_type,o.agreement_completed_at from membership_agreement_acceptances a join member_consents c on c.id=a.age_attestation_id join member_onboardings o on o.member_id=a.member_id");
    assert.equal(evidence.accepted_by_auth_user_id, viewer.authUserId);
    assert.equal(evidence.agreement_body_snapshot, terms);
    assert.equal(evidence.agreement_version_snapshot, 2);
    assert.equal(evidence.signer_name_snapshot, agreement.signerName);
    assert.equal(evidence.consent_type, "age_attestation");
    assert.ok(evidence.agreement_completed_at);
    await expectResponse(post("my/onboarding", { action: "complete" }), 409);
    await assertEntryOnly();
  });

  await t.test("explicit recurring consent creates one annual checkout with real durable evidence", async () => {
    await expectResponse(post("stripe/checkout", { ...checkoutBody(), recurringPaymentAccepted: false }), 400);
    assert.equal(creations.length, 0);
    const offered = await expectResponse(post("stripe/membership-offer", { requestId: checkoutAttemptId, kind: "individual", plan: "annual" }), 200);
    assert.equal(offered.body.quote.offer.id, "founding_individual_annual");
    assert.equal(offered.body.quote.offer.amount, 349000);
    const opened = await expectResponse(post("stripe/checkout", checkoutBody()), 200);
    assert.deepEqual(opened.body, { clientSecret: session.client_secret, plan: "annual", commercialReservationId: checkoutAttemptId });
    assert.deepEqual((await expectResponse(post("stripe/checkout", checkoutBody()), 200)).body, opened.body);
    assert.equal(creations.length, 1, "Resume an existing payment instead of charging twice.");
    assert.deepEqual(creations[0].params.line_items, [{ price: "price_founding_annual", quantity: 1 }]);
    assert.equal(creations[0].params.metadata.agreement_acceptance_id, acceptanceId);
    assert.equal(creations[0].params.metadata.ruined_checkout_attempt_id, checkoutAttemptId);
    const consent = await row("select billing_plan,billing_consent_auth_user_id,recurring_payment_terms,recurring_payment_accepted_at from stripe_checkout_attempts");
    assert.equal(consent.billing_plan, "annual");
    assert.equal(consent.billing_consent_auth_user_id, viewer.authUserId);
    assert.equal(consent.recurring_payment_terms.amount, 349000);
    assert.equal(consent.recurring_payment_terms.interval, "year");
    assert.equal(consent.recurring_payment_terms.firstPayment, "upfront");
    assert.ok(consent.recurring_payment_accepted_at);
    await assertEntryOnly();
  });

  await t.test("signed invoices unlock access and scheduled cancellation preserves it until the subscription ends", async () => {
    const now = Math.floor(Date.now() / 1000);
    subscription = { id: "sub_offline_journey", start_date: now, latest_invoice: "in_offline_journey", object: "subscription", livemode: false, status: "active", customer: "cus_offline_journey",
      metadata: creations[0].params.subscription_data.metadata, automatic_tax: { enabled: false }, cancel_at_period_end: false,
      items: { has_more: false, data: [{ id: "si_offline_journey", quantity: 1, price, current_period_start: now, current_period_end: now + 365 * 86400 }] } };
    session = { ...session, status: "complete", customer: subscription.customer, subscription: subscription.id, payment_status: "paid" };
    const webhook = async event => {
      const payload = JSON.stringify(event);
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: environment.STRIPE_WEBHOOK_SECRET });
      return routes["stripe/webhook"].POST(new Request(`${origin}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": signature }, body: payload }));
    };
    const event = (id, type, object) => ({ id, object: "event", api_version: server.STRIPE_API_VERSION, livemode: false, created: now, type, data: { object } });
    const completed = await expectResponse(webhook(event("evt_offline_checkout", "checkout.session.completed", session)), 200);
    assert.equal(completed.body.handled, true);
    await assertEntryOnly();
    const invoice = { id: "in_offline_journey", object: "invoice", livemode: false, currency: "usd", status: "paid",
      amount_due: price.unit_amount, amount_paid: price.unit_amount, amount_remaining: 0, total: price.unit_amount, total_excluding_tax: price.unit_amount,
      starting_balance: 0, ending_balance: 0, pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0, customer_address: { country: "US" }, billing_reason: "subscription_create",
      customer: subscription.customer, customer_email: viewer.email, parent: { subscription_details: { subscription: subscription.id, metadata: subscription.metadata } },
      lines: { has_more: false, data: [{ id: "il_offline_journey", livemode: false, currency: "usd", quantity: 1, subtotal: price.unit_amount, period: { start: now, end: now + 365 * 86400 },
        pricing: { price_details: { price: price.id } }, parent: { type: "subscription_item_details", subscription_item_details: {
          subscription: subscription.id, subscription_item: subscription.items.data[0].id, proration: false } } }] } };
    latestInvoice = invoice;
    const paidEvent = event("evt_offline_paid", "invoice.paid", invoice);
    const paid = await expectResponse(webhook(paidEvent), 200);
    assert.equal(paid.body.handled, true);
    const commitment = await row("select * from stripe_membership_commitments");
    assert.equal(commitment.id, checkoutAttemptId);
    assert.equal(commitment.terms_snapshot.offerId, "founding_individual_annual");
    assert.equal(commitment.terms_snapshot.totalInitialDues, 349000);
    assert.equal(commitment.terms_snapshot.startsAt, new Date(now * 1000).toISOString());
    assert.equal((await row("select status from membership_commercial_reservations")).status, "activated");
    const member = await identity.getMemberIdentity(viewer.authUserId);
    assert.equal(member.billingState, "active");
    const contract = await row("select terms_snapshot from stripe_membership_commitments");
    assert.equal(contract.terms_snapshot.offerId, "founding_individual_annual");
    assert.equal(contract.terms_snapshot.totalInitialDues, 349000);
    assert.equal(contract.terms_snapshot.billingTermsVersion, "membership-billing-v2");
    assert.equal(member.administrativeOnboardingState, "completed");
    assert.equal(member.programState, "onboarding");
    assert.equal(policy.deriveMemberAccessPolicy(member).mode, "onboarding");
    assert.equal(policy.memberCan(policy.deriveMemberAccessPolicy(member), "foundations.write"), true);
    assert.ok((await row("select billing_confirmed_at from member_onboardings")).billing_confirmed_at);
    const historyCount = Number((await row("select count(*) from member_state_history")).count);
    assert.equal((await expectResponse(webhook(paidEvent), 200)).body.duplicate, true);
    assert.equal(Number((await row("select count(*) from member_state_history")).count), historyCount);
    assert.equal(await memberCount(), 1);
    assert.ok((await row("select direct_joined_at from member_personal_invitations")).direct_joined_at);
    assert.equal(Number((await row("select count(*) from member_referrals")).count), 0);
    assert.equal(verified.length, 2);
    assert.ok(workflowPasses > 0, "Follow-up work stays queued; the real sender is never invoked.");

    subscription.cancel_at = subscription.items.data[0].current_period_end;
    subscription.cancel_at_period_end = false;
    await expectResponse(webhook({ ...event("evt_offline_cancel_scheduled", "customer.subscription.updated", subscription), created: now + 1 }), 200);
    const scheduledMember = await identity.getMemberIdentity(viewer.authUserId);
    assert.equal(scheduledMember.billingState, "active", "Stopping renewal must not remove the paid term.");
    assert.equal(policy.memberCan(policy.deriveMemberAccessPolicy(scheduledMember), "foundations.write"), true);
    const account = await identity.getMemberAccount(viewer.authUserId);
    assert.deepEqual(account.subscription, {
      cancelAtPeriodEnd: false, cancelAt: new Date(subscription.cancel_at * 1000).toISOString(), status: "active",
      currentPeriodEnd: new Date(subscription.items.data[0].current_period_end * 1000).toISOString(),
    });
    subscription.cancel_at = null;
    await expectResponse(webhook({ ...event("evt_offline_cancel_resumed", "customer.subscription.updated", subscription), created: now + 2 }), 200);
    assert.equal((await identity.getMemberAccount(viewer.authUserId)).subscription.cancelAt, null, "resuming clears the canonical scheduled end");
    subscription.cancel_at_period_end = true;
    await expectResponse(webhook({ ...event("evt_offline_legacy_cancel", "customer.subscription.updated", subscription), created: now + 3 }), 200);
    assert.equal((await identity.getMemberAccount(viewer.authUserId)).subscription.cancelAtPeriodEnd, true);
    subscription.status = "canceled";
    await expectResponse(webhook({ ...event("evt_offline_cancel_effective", "customer.subscription.deleted", subscription), created: now + 4 }), 200);
    const endedMember = await identity.getMemberIdentity(viewer.authUserId);
    assert.equal(endedMember.billingState, "ended");
    assert.equal(policy.memberCan(policy.deriveMemberAccessPolicy(endedMember), "foundations.write"), false);
  });
});
