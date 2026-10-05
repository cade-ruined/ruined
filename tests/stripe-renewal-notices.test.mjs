import { prepaidFixtureDependencies } from "./helpers/prepaid-policy-fixture.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { timingSafeEqual } from "node:crypto";

async function load(path, dependencies = {}, env = {}, globals = {}) {
  dependencies = { ...prepaidFixtureDependencies, ...dependencies };
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", ...Object.keys(globals), code)(name => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }, loaded, loaded.exports, { env }, ...Object.values(globals));
  return loaded.exports;
}

const pricing = await load("src/lib/membership/pricing.ts");
const pricePolicy = await load("src/lib/stripe/price-policy.ts", { "@/lib/membership/pricing": pricing });
const policy = await load("src/lib/stripe/renewal-policy.ts", { "@/lib/stripe/price-policy": pricePolicy });
const email = await load("src/lib/stripe/renewal-email.ts");
const portalPolicy = await load("src/lib/stripe/portal-policy.ts");
const annualAmount = pricing.MEMBERSHIP_PLANS.annual.amount;
const configuration = { annual: "price_annual", monthly: "price_monthly", legacy: null, livemode: true };
const initialNow = Date.parse("2026-09-28T13:00:00Z");
const renewalSeconds = initialNow / 1000 + 19 * 86400;
function subscription() {
  return { id: "sub_member", customer: "cus_member", livemode: true, status: "active", cancel_at_period_end: false,
    cancel_at: null, schedule: null, pause_collection: null, automatic_tax: { enabled: true },
    metadata: { ruined_member_id: "member_1", ruined_context: "membership", ruined_billing_plan: "annual" },
    items: { has_more: false, data: [{ id: "si_member", quantity: 1, current_period_end: renewalSeconds,
      price: { id: "price_annual", livemode: true, type: "recurring", billing_scheme: "per_unit", currency: "usd", unit_amount: annualAmount,
        recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } } }] } };
}
function notice() {
  return { id: "notice_1", subscriptionId: "sub_member", customerId: "cus_member", memberId: "member_1", livemode: true,
    renewsAt: new Date(renewalSeconds * 1000).toISOString(), leadDays: 20, attempts: 0, email: "member@example.test",
    firstSendAttemptAt: null, payload: null, preview: null, savedMemberEmail: null };
}
function invoice() {
  return { customer: "cus_member", livemode: true, currency: "usd", amount_due: annualAmount + 35280, total: annualAmount + 40280,
    total_taxes: [{ amount: 40280 }], automatic_tax: { status: "complete" },
    lines: { has_more: false, data: [{ livemode: true, currency: "usd", quantity: 1, subtotal: annualAmount,
      period: { start: renewalSeconds, end: renewalSeconds + 365 * 86400 },
      pricing: { price_details: { price: "price_annual" } }, parent: { type: "subscription_item_details", subscription_item_details: {
        subscription: "sub_member", subscription_item: "si_member", proration: false } } }] } };
}

test("annual reminders validate exact identities, mode, recurring offer, future period and notice window", () => {
  assert.doesNotThrow(() => policy.validateRenewalSubscription(subscription(), notice(), configuration, new Date(initialNow)));
  for (const [code, change] of [
    ["subscription_identity_mismatch", s => s.livemode = false],
    ["subscription_identity_mismatch", s => s.customer = "cus_other"],
    ["subscription_identity_mismatch", s => s.metadata.ruined_member_id = "other"],
    ["annual_membership_price_mismatch", s => s.items.data[0].price.id = "price_unapproved"],
    ["annual_membership_price_mismatch", s => s.items.data[0].price.unit_amount = 1],
    ["annual_membership_price_mismatch", s => s.items.data[0].quantity = 2],
    ["renewal_cancelled", s => s.cancel_at_period_end = true],
    ["renewal_cancelled", s => s.cancel_at = renewalSeconds],
    ["renewal_requires_operator_review", s => s.status = "past_due"],
    ["renewal_requires_operator_review", s => s.schedule = "sub_sched"],
    ["renewal_period_changed", s => s.items.data[0].current_period_end += 86400],
  ]) {
    const sub = subscription(); change(sub);
    assert.throws(() => policy.validateRenewalSubscription(sub, notice(), configuration, new Date(initialNow)), error => error.code === code, code);
  }
  const laterCancellation = subscription(); laterCancellation.cancel_at = renewalSeconds + 86400;
  assert.doesNotThrow(() => policy.validateRenewalSubscription(laterCancellation, notice(), configuration, new Date(initialNow)), "cancellation after the next billing date does not suppress that renewal notice");
  assert.throws(() => policy.validateRenewalSubscription(subscription(), notice(), configuration, new Date(initialNow + 7 * 86400000)), error => error.code === "notice_window_missed");
});

test("notice uses the actual next invoice amount and tax and rejects incomplete or unrelated previews", () => {
  const preview = policy.renewalInvoicePreview(invoice(), subscription(), configuration);
  assert.equal(preview.taxAmount, 40280); assert.equal(preview.amountDue, annualAmount + 35280); assert.equal(preview.invoiceTotal, annualAmount + 40280);
  const message = email.createMembershipRenewalEmail(preview, new URL("https://members.example.test"));
  assert.match(message.text, /\$402.80/); assert.ok(message.text.includes(new Intl.NumberFormat("en-US", { style: "currency", currency: "usd" }).format((annualAmount + 35280) / 100)));
  assert.match(message.text, /https:\/\/members.example.test\/my\/account/); assert.match(message.text, /Review billing and cancellation options/); assert.doesNotMatch(message.text, /no cancellation fee/);
  assert.match(message.text, /UTC/); assert.match(message.text, /current invoice preview/);
  for (const change of [i => i.currency = "eur", i => i.customer = "cus_other", i => i.automatic_tax.status = "requires_location_inputs",
    i => i.lines.data[0].period.start -= 86400, i => i.lines.data[0].parent.subscription_item_details.proration = true,
    i => i.lines.has_more = true, i => i.lines.data[0].subtotal = 1]) {
    const bad = invoice(); change(bad);
    assert.throws(() => policy.renewalInvoicePreview(bad, subscription(), configuration));
  }
});

async function workerFixture({ enabled = true, mode = "live", testRecipient = "approved-test@example.test", response, cancelBeforeSend = false, preflightFails = false, offerId } = {}) {
  let now = initialNow, status = "pending", claimed = false, lookups = 0;
  const stored = notice(), calls = [], finishes = [];
  const sub = subscription(), bill = invoice(), config = { ...configuration, livemode: mode === "live" };
  if (offerId) {
    const offer = pricing.MEMBERSHIP_OFFERS[offerId];
    config.offers = { [offerId]: `price_${offerId}` };
    Object.assign(sub.metadata, { billing_terms_version: "membership-billing-v2", ruined_offer_id: offerId,
      ruined_billing_plan: offer.plan, ruined_commercial_reservation_id: "reservation_1" });
    Object.assign(sub.items.data[0].price, { id: `price_${offerId}`, tax_behavior: "exclusive", unit_amount: offer.amount,
      recurring: { interval: offer.interval, interval_count: 1, usage_type: "licensed" } });
    Object.assign(stored, { noticeKind: offer.plan === "annual" ? "annual_renewal" : "initial_term_end", offerId,
      commitmentId: "contract_1", commercialReservationId: "reservation_1", commitmentStatus: "active",
      boundPriceId: `price_${offerId}`, commitmentInitialTermEndsAt: stored.renewsAt });
    bill.lines.data[0].subtotal = offer.amount; bill.lines.data[0].pricing.price_details.price = `price_${offerId}`;
    bill.total = offer.amount + 40280; bill.amount_due = offer.amount + 35280;
  }
  if (mode === "test") { sub.livemode = false; sub.items.data[0].price.livemode = false; bill.livemode = false; bill.lines.data[0].livemode = false; stored.livemode = false; }
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const env = { STRIPE_MEMBERSHIP_RENEWAL_EMAILS_ENABLED: enabled ? "true" : "false", STRIPE_SECRET_KEY: `sk_${mode}_offline`,
    STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID: "price_annual", STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_reviewed",
    STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID: "bpc_commitment",
    RESEND_API_KEY: "offline", RESEND_FROM_EMAIL: "Ruined <billing@example.test>", NEXT_PUBLIC_SITE_URL: "https://members.example.test",
    STRIPE_MEMBERSHIP_RENEWAL_TEST_RECIPIENT: testRecipient };
  const worker = await load("src/lib/stripe/renewal-worker.ts", {
    "node:crypto": { randomUUID: () => "lease" }, resend: { Resend: class { emails = { send: async (payload, options) => {
      calls.push({ payload: structuredClone(payload), options });
      return response ? response(calls.length) : { data: { id: "email_1" }, error: null };
    } }; } },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/support/model": { SUPPORT_EMAIL: "connect@theruinedproject.com" },
    "@/lib/stripe/portal-policy": portalPolicy,
    "@/lib/stripe/server": { getMembershipPriceConfiguration: () => config, getStripe: () => ({
      billingPortal: { configurations: { retrieve: async portalId => ({ id: portalId, active: true, livemode: config.livemode, features: {
        invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_update: { enabled: false },
        subscription_cancel: { enabled: portalId !== "bpc_commitment", mode: "at_period_end", proration_behavior: "none" } } }) } },
      subscriptions: { retrieve: async () => { lookups++; if (preflightFails) throw Error("offline"); if (cancelBeforeSend && lookups === 2) sub.cancel_at_period_end = true; return sub; } },
      invoices: { createPreview: async input => { assert.deepEqual(input, { customer: "cus_member", subscription: "sub_member", preview_mode: "next" }); return bill; } },
    }) },
    "./renewal-email": email, "./renewal-policy": policy,
    "./renewal-repository": {
      enqueueMembershipRenewalNotices: async () => 1,
      claimRenewalNotice: async () => { if (claimed || !["pending", "failed"].includes(status)) return null; claimed = true; stored.attempts++; status = "processing"; return structuredClone(stored); },
      persistRenewalNoticePayload: async (_id, _lease, payload, preview, memberEmail) => {
        stored.payload = structuredClone(payload); stored.preview = Object.fromEntries(Object.entries(preview).reverse()); stored.savedMemberEmail = memberEmail; return true;
      },
      fenceRenewalNoticeSend: async () => { stored.firstSendAttemptAt ??= new Date(now).toISOString(); return true; },
      finishRenewalNotice: async (_id, _lease, nextStatus, code, _providerId, _delay, clearFence) => {
        status = nextStatus; finishes.push({ status, code }); if (clearFence) stored.firstSendAttemptAt = null; return true;
      },
      getRenewalNoticeHealth: async () => ({ manualReview: status === "manual_review" ? 1 : 0, remainingDue: 0 }),
    },
  }, env, { Date: Clock });
  return { stored, calls, finishes, env, sub, run: () => { claimed = false; return worker.processMembershipRenewalNotices(); }, advance: ms => now += ms, getStatus: () => status };
}

test("disabled delivery is inert and test mode requires an explicit isolated recipient", async () => {
  const off = await workerFixture({ enabled: false }); assert.equal((await off.run()).claimed, 0); assert.equal(off.calls.length, 0);
  const noTestInbox = await workerFixture({ mode: "test", testRecipient: "" }); assert.equal((await noTestInbox.run()).ready, false); assert.equal(noTestInbox.calls.length, 0);
  const sandbox = await workerFixture({ mode: "test" }); assert.equal((await sandbox.run()).sent, 1);
  assert.equal(sandbox.calls[0].payload.to, "approved-test@example.test"); assert.match(sandbox.calls[0].payload.subject, /^\[TEST\]/);
});

test("a cancellation after claim and preview suppresses the email", async () => {
  const f = await workerFixture({ cancelBeforeSend: true });
  assert.equal((await f.run()).cancelled, 1); assert.equal(f.calls.length, 0); assert.equal(f.stored.firstSendAttemptAt, null);
});

test("every commercial tier uses its exact accepted price and the correct annual or initial-term notice", () => {
  for (const [offerId, offer] of Object.entries(pricing.MEMBERSHIP_OFFERS)) {
    const sub = subscription(), delivery = notice(), bill = invoice();
    const monthly = offer.plan === "monthly";
    const nextBilling = monthly ? initialNow / 1000 + 9 * 86400 : renewalSeconds;
    const termEnd = monthly ? initialNow / 1000 + 39 * 86400 : renewalSeconds;
    const config = { ...configuration, offers: { [offerId]: `price_${offerId}` } };
    Object.assign(sub.metadata, { billing_terms_version: "membership-billing-v2", ruined_offer_id: offerId,
      ruined_billing_plan: offer.plan, ruined_commercial_reservation_id: "reservation_1" });
    Object.assign(sub.items.data[0], { current_period_end: nextBilling });
    Object.assign(sub.items.data[0].price, { id: `price_${offerId}`, tax_behavior: "exclusive", unit_amount: offer.amount,
      recurring: { interval: offer.interval, interval_count: 1, usage_type: "licensed" } });
    Object.assign(delivery, { noticeKind: monthly ? "initial_term_end" : "annual_renewal", offerId,
      commitmentId: "contract_1", commercialReservationId: "reservation_1", commitmentStatus: "active",
      boundPriceId: `price_${offerId}`, renewsAt: new Date(termEnd * 1000).toISOString(), leadDays: monthly ? 40 : 20,
      commitmentInitialTermEndsAt: new Date(termEnd * 1000).toISOString() });
    bill.lines.data[0].subtotal = offer.amount; bill.lines.data[0].pricing.price_details.price = `price_${offerId}`;
    bill.lines.data[0].period = { start: nextBilling, end: nextBilling + (monthly ? 30 : 365) * 86400 };
    assert.doesNotThrow(() => policy.validateRenewalSubscription(sub, delivery, config, new Date(initialNow)), offerId);
    const preview = policy.renewalInvoicePreview(bill, sub, config, delivery);
    assert.equal(preview.renewalDate, delivery.renewsAt);
    const message = email.createMembershipRenewalEmail(preview, new URL("https://members.example.test"));
    if (monthly) {
      assert.notEqual(preview.previewBillingDate, preview.renewalDate, "a monthly invoice date is not the twelve-month anniversary");
      assert.match(message.text, /continues month to month/);
      assert.match(message.text, /No new 12-month minimum/);
      assert.match(message.text, /estimate of ongoing monthly billing/);
      assert.doesNotMatch(message.subject, /annual.*renewal/);
      assert.throws(() => policy.validateRenewalSubscription(sub, { ...delivery, commitmentInitialTermEndsAt: new Date(nextBilling * 1000).toISOString() }, config, new Date(initialNow)), /renewal_period_changed/);
    } else assert.match(message.text, /annual Ruined membership renews/);
    assert.throws(() => policy.validateRenewalSubscription(sub, { ...delivery, commitmentId: null }, config, new Date(initialNow)), /commitment_mismatch/);
    sub.cancel_at = termEnd;
    assert.throws(() => policy.validateRenewalSubscription(sub, delivery, config, new Date(initialNow)), /renewal_cancelled/);
  }
});

test("commercial worker uses the commitment portal and sends monthly conversion wording without duplicate provider calls", async () => {
  const f = await workerFixture({ mode: "test", offerId: "founding_individual_monthly" });
  assert.equal((await f.run()).sent, 1);
  assert.match(f.calls[0].payload.text, /continues month to month at \$349.00/);
  assert.match(f.calls[0].payload.text, /My Ruined → Account:/);
  assert.equal((await f.run()).sent, 0);
  assert.equal(f.calls.length, 1);
});

test("uncertain sends retry with identical saved payload/key inside23h but require review after that fence", async () => {
  const retry = await workerFixture({ response: count => count === 1 ? { error: { statusCode: 500 } } : { data: { id: "email_1" } } });
  assert.equal((await retry.run()).failed, 1); retry.advance(3600000);
  assert.equal((await retry.run()).sent, 1); assert.deepEqual(retry.calls[0], retry.calls[1], "JSONB property reordering must not break a valid retry");
  const expired = await workerFixture({ response: () => { throw Error("ambiguous network failure"); } });
  await expired.run(); expired.advance(24 * 3600000); assert.equal((await expired.run()).manualReview, 1); assert.equal(expired.calls.length, 1);
});

test("daily retries are allowed after preflight failure or proven first rejection, never after earlier uncertainty", async () => {
  const rejected = await workerFixture({ response: count => count === 1 ? { error: { statusCode: 429 } } : { data: { id: "email_1" } } });
  await rejected.run(); assert.equal(rejected.stored.firstSendAttemptAt, null);
  rejected.advance(24 * 3600000); assert.equal((await rejected.run()).sent, 1);
  const unknown = await workerFixture({ response: count => ({ error: { statusCode: count === 1 ? 500 : 429 } }) });
  await unknown.run(); const first = unknown.stored.firstSendAttemptAt;
  unknown.advance(3600000); await unknown.run(); assert.equal(unknown.stored.firstSendAttemptAt, first);
  unknown.advance(24 * 3600000); assert.equal((await unknown.run()).manualReview, 1); assert.equal(unknown.calls.length, 2);
  const preflight = await workerFixture({ preflightFails: true }); await preflight.run(); assert.equal(preflight.stored.firstSendAttemptAt, null); assert.equal(preflight.calls.length, 0);
});

test("renewal cron requires its secret and signals failed, missed or backlogged notices", async () => {
  let result = { enabled: false, ready: false }, calls = 0;
  const route = await load("app/api/internal/stripe/renewals/process/route.ts", {
    "node:crypto": { timingSafeEqual }, "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/stripe/renewal-worker": { processMembershipRenewalNotices: async () => { calls++; return result; } },
  }, { CRON_SECRET: "local-only-secret" });
  for (const authorization of ["", "Bearer wrong", "Basic local-only-secret"]) assert.equal((await route.GET(new Request("https://members.example.test", { headers: { authorization } }))).status, 401);
  assert.equal(calls, 0);
  const invoke = () => route.GET(new Request("https://members.example.test", { headers: { authorization: "Bearer local-only-secret" } }));
  assert.equal((await invoke()).status, 200);
  for (const failure of [{ ready: false }, { manualReview: 1 }, { failed: 1 }, { remainingDue: 1 }]) {
    result = { enabled: true, ready: true, ...failure }; assert.equal((await invoke()).status, 503);
  }
});
