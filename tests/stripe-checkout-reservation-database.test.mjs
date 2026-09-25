import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
async function load(path, dependencies) {
  const output = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const pricing = await load("src/lib/membership/pricing.ts", {});
function wrap(engine) {
  const query = async (strings, ...values) => {
    const sql = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
    const parameters = values.map(value => value instanceof Date ? value.toISOString() : value);
    return (await engine.query(sql, parameters)).rows;
  };
  query.json = value => JSON.stringify(value);
  query.begin = fn => engine.transaction(tx => fn(wrap(tx)));
  return query;
}

test("checkout reservations durably bind plan, verified consent and one in-flight payment across tabs", async t => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const runner = await source("scripts/migrate-platform.mjs");
  for (const match of runner.matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)) await db.exec(await source(match[1]));
  // Full shipped schema and constraints, no network or production database.
  await db.query("insert into ruined_members(id,email,email_normalized) values($1,'member@example.test','member@example.test')", [id(1)]);
  const personId = (await db.query("select person_id from ruined_members where id=$1", [id(1)])).rows[0].person_id;
  await db.query("insert into member_lifecycle(member_id,account_state) values($1,'active')", [id(1)]);
  await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,'member@example.test','active')", [id(2), id(1), personId]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [id(2)]);
  await db.query("update member_onboardings set billing_plan='monthly' where member_id=$1", [id(1)]);
  await db.query("insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,'ruined_membership',2,'Test paid terms','Test-only agreement',$2,'published',now())", [id(3), "a".repeat(64)]);
  const consentId = (await db.query("insert into member_consents(member_id,consent_type,policy_version,accepted_at,dedupe_key) values($1,'age_attestation','age18',now(),'test-age') returning id", [id(1)])).rows[0].id;
  await db.query(`insert into membership_agreement_acceptances(id,agreement_version_id,person_id,member_id,accepted_by_auth_user_id,age_attestation_id,signer_name_snapshot,signer_email_snapshot,affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
    values($1,$2,$3,$4,$5,$6,'Test Member','member@example.test','checkbox_and_submit',now(),'ruined_membership',2,'Test paid terms',$7,'Test-only agreement','test-paid-acceptance')`, [id(4), id(3), personId, id(1), id(2), consentId, "a".repeat(64)]);
  const repository = await load("src/lib/stripe/billing-repository.ts", {
    "@/lib/membership/pricing": pricing,
    "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) },
    "@/lib/stripe/membership-state": { normalizeEmail: value => value.trim().toLowerCase() },
  });
  const input = { acceptanceId: id(4), attemptId: id(5), authUserId: id(2), email: "member@example.test", plan: "annual", stripePriceId: "price_annual", paidAgreementVersion: "ruined_membership-v2" };
  await assert.rejects(repository.reserveMembershipCheckout({ ...input, paidAgreementVersion: "ruined_membership-v1" }), repository.MembershipCheckoutConflictError, "a no-charge or unapproved agreement must never authorize this purchase");
  const [first, second] = await Promise.all([repository.reserveMembershipCheckout(input), repository.reserveMembershipCheckout({ ...input, attemptId: id(6) })]);
  assert.equal(first.attemptId, second.attemptId);
  assert.equal(first.plan, "annual");
  assert.equal(first.recurringPaymentAcceptedAt.valueOf(), second.recurringPaymentAcceptedAt.valueOf());
  const stored = (await db.query("select billing_plan,stripe_price_id,billing_consent_auth_user_id,recurring_payment_terms,recurring_payment_accepted_at from stripe_checkout_attempts")).rows;
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].recurring_payment_terms, { version: "membership-billing-v1", plan: "annual", amount: 504000, currency: "usd", interval: "year", label: "Annual", firstPayment: "upfront", recurring: true });
  assert.equal(stored[0].billing_consent_auth_user_id, id(2));
  assert.ok(stored[0].recurring_payment_accepted_at);
  assert.equal((await db.query("select billing_plan from member_onboardings")).rows[0].billing_plan, "annual");
  await assert.rejects(repository.reserveMembershipCheckout({ ...input, plan: "monthly", stripePriceId: "price_monthly" }), error => error instanceof repository.MembershipCheckoutPlanConflictError && error.plan === "annual");
  await assert.rejects(repository.reserveMembershipCheckout({ ...input, stripePriceId: "price_reconfigured" }), repository.MembershipCheckoutConflictError);
  await db.query("update stripe_checkout_attempts set expires_at=now()-interval '1 second'");
  await assert.rejects(repository.reserveMembershipCheckout(input), repository.MembershipCheckoutConflictError, "a timed-out create may already exist at Stripe; never expire it only locally");
  assert.equal((await db.query("select status from stripe_checkout_attempts")).rows[0].status, "creating");
  await repository.openMembershipCheckoutAttempt({ attemptId: first.attemptId, stripeSessionId: "cs_remote", expiresAt: new Date(Date.now() + 3600000) });
  assert.equal((await repository.reserveMembershipCheckout(input)).existingStripeSessionId, "cs_remote");
  await db.query("update stripe_checkout_attempts set status='completed'");
  await assert.rejects(repository.reserveMembershipCheckout(input), repository.MembershipCheckoutConflictError, "completed Checkout awaiting subscription webhook cannot spawn another purchase");
  await db.query("update stripe_checkout_attempts set status='expired'");
  await db.query("update ruined_members set membership_state='active'");
  await assert.rejects(repository.reserveMembershipCheckout(input), repository.MembershipCheckoutConflictError);
  await db.query("update ruined_members set membership_state='pending'");
  await db.query("update member_lifecycle set account_state='closed'");
  await assert.rejects(repository.reserveMembershipCheckout(input), repository.MembershipCheckoutConflictError);
});
