import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, compiled, compiled.exports);
  return compiled.exports;
}
const state = await load("src/lib/stripe/membership-state.ts");
const pricing = await load("src/lib/membership/pricing.ts");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function fixture({ delegated = true, accepted = false } = {}) {
  const calls = { reconciled: [], writes: [], retrieved: [], listed: [] };
  const attempt = {
    id: id(1), member_id: id(2), operator_authorization_id: delegated ? id(1) : null,
    payment_setup_customer_id: delegated ? "cus_member" : null,
    billing_consent_auth_user_id: delegated ? id(3) : id(4), stripe_session_id: "cs_fixture", stripe_subscription_id: null,
    billing_consent_source: "stripe_checkout", recurring_payment_accepted_at: accepted ? new Date() : null,
    checkout_prepared_at: new Date("2026-10-20T12:00:00.000Z"), agreement_acceptance_id: id(5), agreement_version: "ruined_membership-v3",
    commercial_reservation_id: id(1), offer_id: "founding_individual_monthly", billing_plan: "monthly", stripe_price_id: "price_founder",
    first_charge_at: null, billing_schedule: null,
    billing_consent_evidence: accepted ? { sessionId: "cs_fixture", subscriptionId: "sub_fixture" } : null,
  };
  const metadata = {
    ...(delegated ? { ruined_checkout_source: "operator", ruined_checkout_actor_id: id(3), ruined_operator_authorization_id: id(1) } : {}),
    ruined_member_id: id(2), ruined_checkout_attempt_id: id(1), ruined_commercial_reservation_id: id(1), agreement_acceptance_id: id(5),
    agreement_version: "ruined_membership-v3", ruined_billing_plan: "monthly", ruined_price_id: "price_founder", ruined_offer_id: "founding_individual_monthly",
    billing_terms_version: "membership-billing-v2", billing_consent_source: "stripe_checkout", billing_prepared_at: attempt.checkout_prepared_at.toISOString(),
  };
  const subscription = { id: "sub_fixture", customer: "cus_member", livemode: false, metadata: { ...metadata },
    items: { data: [{ price: { id: "price_founder", product: "prod_membership" } }] } };
  const session = { id: "cs_fixture", status: "complete", expires_at: 1792504800, mode: "subscription", ui_mode: "embedded_page", client_reference_id: id(2),
    subscription: "sub_fixture", customer: "cus_member", livemode: false, currency: "usd", amount_subtotal: 34900,
    consent_collection: { terms_of_service: "required" }, consent: { terms_of_service: "accepted" }, metadata: { ...metadata },
    line_items: { has_more: false, data: [{ quantity: 1, currency: "usd", price: { id: "price_founder" } }] } };
  const tx = async (strings, ...values) => {
    const sql = strings.join("?");
    if (sql.includes("select operator_authorization_id")) return [attempt];
    calls.writes.push({ sql, values }); return [];
  };
  tx.json = value => value;
  const stripe = { checkout: { sessions: {
    retrieve: async (...args) => { calls.retrieved.push(args); return session; },
    list: async (...args) => { calls.listed.push(args); return { has_more: false, data: [{ id: session.id }] }; },
  } } };
  const consentModule = await load("src/lib/stripe/checkout-consent.ts", {
    "server-only": {}, "./membership-state": state, "@/lib/membership/pricing": pricing,
    "./billing-repository": { reconcileCheckoutAttempt: async (_tx, data) => { calls.reconciled.push(data); } },
    "./prepaid-policy": { prepaidScheduleFingerprint: () => assert.fail("Fixture is not prepaid") },
  });
  const reconcile = (changes = {}) => consentModule.reconcileNativeCheckoutConsent(tx, stripe, { subscription, sessionId: "cs_fixture", eventId: "evt_fixture", ...changes });
  return { attempt, session, subscription, calls, reconcile };
}

test("delegated native consent is recorded only from completed provider terms bound to real actor and beneficiary", async () => {
  const f = await fixture(); assert.equal(await f.reconcile(), true);
  assert.deepEqual(f.calls.retrieved, [["cs_fixture", { expand: ["line_items.data.price"] }]]);
  assert.equal(f.calls.reconciled.length, 1); assert.equal(f.calls.writes.length, 1);
  const evidence = f.calls.writes[0].values.find(value => value?.source === "stripe_checkout");
  assert.equal(evidence.memberId, id(2)); assert.equal(evidence.subscriptionId, "sub_fixture"); assert.equal(evidence.termsOfService, "accepted");
});

test("delegated native consent rejects session or subscription actor, authorization and beneficiary substitution", async () => {
  for (const target of ["session", "subscription"]) {
    for (const [key, value] of Object.entries({ ruined_checkout_source: "member", ruined_checkout_actor_id: id(90),
      ruined_operator_authorization_id: id(91), ruined_member_id: id(92), ruined_commercial_reservation_id: id(93),
      agreement_acceptance_id: id(94), ruined_price_id: "price_other", ruined_offer_id: "individual_monthly" })) {
      const f = await fixture(); f[target].metadata[key] = value;
      await assert.rejects(f.reconcile(), /does not match/, `${target}.${key}`);
      assert.equal(f.calls.reconciled.length, 0); assert.equal(f.calls.writes.length, 0);
    }
  }
  const missingActor = await fixture(); missingActor.attempt.billing_consent_auth_user_id = null;
  await assert.rejects(missingActor.reconcile(), /does not match/); assert.equal(missingActor.calls.writes.length, 0);
});

test("self-service consent cannot acquire delegated provenance through either provider object", async () => {
  for (const target of ["session", "subscription"]) {
    for (const [key, value] of Object.entries({ ruined_checkout_source: "operator", ruined_checkout_actor_id: id(3), ruined_operator_authorization_id: id(1) })) {
      const f = await fixture({ delegated: false }); f[target].metadata[key] = value;
      await assert.rejects(f.reconcile(), /does not match/); assert.equal(f.calls.writes.length, 0);
    }
  }
  const normal = await fixture({ delegated: false }); assert.equal(await normal.reconcile(), true); assert.equal(normal.calls.writes.length, 1);
});

test("delegated payment cannot use a different Customer even when both provider objects agree", async () => {
  for (const storedCustomer of [null, "cus_another_member"]) {
    const f = await fixture(); f.attempt.payment_setup_customer_id = storedCustomer;
    await assert.rejects(f.reconcile(), /does not match/); assert.equal(f.calls.writes.length, 0);
  }
  const f = await fixture(); f.session.customer = "cus_sponsor"; f.subscription.customer = "cus_sponsor";
  await assert.rejects(f.reconcile(), /does not match/); assert.equal(f.calls.writes.length, 0);
});

test("opening payment or omitting Stripe acceptance cannot manufacture payment consent", async () => {
  const pending = await fixture(); pending.session.status = "open";
  assert.equal(await pending.reconcile(), false); assert.equal(pending.calls.writes.length, 0);
  for (const mutate of [f => f.session.consent.terms_of_service = null, f => f.session.consent_collection.terms_of_service = null,
    f => f.session.customer = "cus_wrong", f => f.session.client_reference_id = id(99), f => f.session.amount_subtotal = 50000]) {
    const f = await fixture(); mutate(f); await assert.rejects(f.reconcile(), /does not match/); assert.equal(f.calls.writes.length, 0);
  }
});

test("invoice-first consent locates the single session and already verified consent is replay-safe", async () => {
  const first = await fixture(); first.attempt.stripe_session_id = null;
  assert.equal(await first.reconcile({ sessionId: undefined }), true); assert.equal(first.calls.listed.length, 1);
  const replay = await fixture({ accepted: true });
  assert.equal(await replay.reconcile(), true); assert.equal(replay.calls.retrieved.length, 0); assert.equal(replay.calls.writes.length, 0);
  await assert.rejects(replay.reconcile({ sessionId: "cs_unrelated" }), /does not match/);
  replay.subscription.id = "sub_unrelated"; await assert.rejects(replay.reconcile(), /does not match/);
});
