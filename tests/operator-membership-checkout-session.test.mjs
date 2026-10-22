import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { prepaidFixtureDependencies } from "./helpers/prepaid-policy-fixture.mjs";

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
const pricing = await load("src/lib/membership/pricing.ts");
const state = await load("src/lib/stripe/membership-state.ts");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function fixture({ delegated = true, savedCustomer = "cus_beneficiary" } = {}) {
  const calls = { customers: [], creates: [] };
  const reservation = {
    memberId: id(1), attemptId: id(2), plan: "monthly", billingSchedule: null, stripePriceId: "price_founding",
    operatorAuthorizationId: delegated ? id(2) : null, operatorActorAuthUserId: delegated ? id(3) : null,
    agreementAcceptanceId: id(4), agreementContentSha256: "a".repeat(64), agreementKey: "ruined_membership", agreementVersion: "ruined_membership-v3",
    agreementAcceptedAt: new Date("2026-10-20T12:00:00Z"), ageAttestedAt: new Date("2026-10-20T12:00:00Z"),
    consentSource: "stripe_checkout", checkoutPreparedAt: new Date("2026-10-20T12:00:01Z"), firstChargeAt: null,
    offerId: "founding_individual_monthly", commercialReservationId: id(2), expiresAt: new Date("2026-10-20T13:00:00Z"),
  };
  const factory = await load("src/lib/stripe/checkout-session.ts", {
    ...prepaidFixtureDependencies, "server-only": {}, "@/lib/membership/pricing": pricing, "@/lib/stripe/membership-state": state,
    "@/lib/stripe/server": { isStripeTaxEnabled: () => true },
    "@/lib/stripe/payment-method-service": { getSavedPaymentMethodForCheckout: async (...args) => { calls.customers.push(args); return savedCustomer ? { customerId: savedCustomer } : null; } },
  });
  const stripe = { checkout: { sessions: { create: async (...args) => { calls.creates.push(args); return { id: "cs_fixture", client_secret: "fixture_secret" }; } } } };
  const create = (changes = {}) => factory.createEmbeddedMembershipSession({ stripe, reservation, email: "aaron@example.test",
    applicationOrigin: "https://members.example.test", minimumAge: 18, termsMessage: "I am authorized to pay for this member.",
    ...(delegated ? { operatorAuthUserId: id(3) } : {}), ...changes });
  return { create, calls, reservation };
}

test("delegated shared factory pins member customer and keeps actual operator metadata on first and renewal billing", async () => {
  const f = await fixture(); await f.create();
  assert.deepEqual(f.calls.customers, [[id(1), id(2), id(3)]]);
  const [params, options] = f.calls.creates[0];
  assert.equal(params.customer, "cus_beneficiary"); assert.equal(Object.hasOwn(params, "customer_email"), false);
  assert.equal(params.client_reference_id, id(1)); assert.equal(params.mode, "subscription"); assert.equal(params.ui_mode, "embedded_page");
  assert.deepEqual(params.shipping_address_collection, { allowed_countries: ["US"] });
  assert.equal(params.billing_address_collection, "required");
  assert.deepEqual(params.line_items, [{ price: "price_founding", quantity: 1 }]);
  for (const metadata of [params.metadata, params.subscription_data.metadata]) {
    assert.equal(metadata.ruined_member_id, id(1)); assert.equal(metadata.ruined_checkout_actor_id, id(3));
    assert.equal(metadata.ruined_checkout_source, "operator"); assert.equal(metadata.ruined_operator_authorization_id, id(2));
    assert.equal(metadata.agreement_acceptance_id, id(4)); assert.equal(metadata.ruined_offer_id, "founding_individual_monthly");
  }
  assert.equal(params.return_url, `https://members.example.test/ops/members/${id(1)}?membershipCheckout=returned#membership`);
  assert.equal(params.consent_collection.terms_of_service, "required");
  assert.equal(params.custom_text.terms_of_service_acceptance.message, "I am authorized to pay for this member.");
  assert.match(params.custom_text.submit.message, /\$4,188/);
  assert.equal(options.idempotencyKey, `ruined-membership:${id(2)}:${id(4)}:monthly:price_founding`);
  await f.create(); assert.deepEqual(f.calls.creates[1], f.calls.creates[0]);
});

test("shared factory cannot pass delegated acceptance through self-service or swap its actual actor", async () => {
  for (const operatorAuthUserId of [undefined, id(99)]) {
    const f = await fixture(); await assert.rejects(f.create({ operatorAuthUserId }), /operator.*authorization|authorization.*operator/i);
    assert.equal(f.calls.creates.length, 0); assert.equal(f.calls.customers.length, 0);
  }
  const normal = await fixture({ delegated: false });
  await assert.rejects(normal.create({ operatorAuthUserId: id(3) }), /authorization/i); assert.equal(normal.calls.creates.length, 0);
});

test("self-service checkout retains its member email fallback and original return route without operator provenance", async () => {
  const f = await fixture({ delegated: false, savedCustomer: null }); await f.create();
  const [params] = f.calls.creates[0];
  assert.equal(params.customer_email, "aaron@example.test"); assert.equal(params.customer, undefined);
  assert.equal(params.return_url, "https://members.example.test/my/join/complete?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(params.metadata.ruined_checkout_actor_id, undefined); assert.equal(params.metadata.ruined_operator_authorization_id, undefined);
  assert.equal(params.subscription_data.metadata.ruined_checkout_source, undefined);
});
