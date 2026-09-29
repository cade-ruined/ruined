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
  const paths = Array.from(runner.matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g), match => match[1]);
  for (const path of ["db/migrations/20260929006000_membership_commercial_eligibility.sql", "db/migrations/20260929007000_membership_checkout_commercial_consent.sql"]) if (!paths.includes(path)) paths.push(path);
  for (const path of paths) await db.exec(await source(path));
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
  await db.query("insert into person_profiles(person_id,display_name) values($1,'Test Member') on conflict(person_id) do update set display_name=excluded.display_name", [personId]);
  await db.query("insert into person_private_profiles(person_id,birth_date,default_fulfillment_address) values($1,'1990-01-01','{\"countryCode\":\"US\"}'::jsonb) on conflict(person_id) do update set birth_date=excluded.birth_date,default_fulfillment_address=excluded.default_fulfillment_address", [personId]);
  await db.query("update person_email_addresses set verification_state='verified',verified_at=now() where person_id=$1", [personId]);
  const commercial = await load("src/lib/membership/commercial-repository.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => wrap(db) },
  });
  const quote = await commercial.reserveCommercialMembership({ requestId: id(5), memberId: id(1), kind: "individual", plan: "annual", expiresAt: new Date(Date.now()+20*60_000) });
  await commercial.bindCommercialMembershipPrice({ reservationId: quote.id, stripePriceId: "price_annual" });
  const repository = await load("src/lib/stripe/billing-repository.ts", {
    "@/lib/membership/commercial-repository": commercial,
    "@/lib/membership/pricing": pricing,
    "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) },
    "@/lib/stripe/membership-state": { normalizeEmail: value => value.trim().toLowerCase() },
  });
  const input = { acceptanceId: id(4), attemptId: id(5), authUserId: id(2), email: "member@example.test", plan: "annual", stripePriceId: "price_annual", paidAgreementVersion: "ruined_membership-v2", commercialReservationId: quote.id };
  await assert.rejects(repository.reserveMembershipCheckout({ ...input, paidAgreementVersion: "ruined_membership-v1" }), repository.MembershipCheckoutConflictError, "a no-charge or unapproved agreement must never authorize this purchase");
  const [first, second] = await Promise.all([repository.reserveMembershipCheckout(input), repository.reserveMembershipCheckout(input)]);
  assert.equal(first.attemptId, second.attemptId);
  assert.ok(first.expiresAt.getTime() > quote.expiresAt.getTime(), "starting within a still-valid offer must allow Stripe at least30 minutes");
  assert.ok(first.expiresAt.getTime() >= Date.now() + 30 * 60_000);
  assert.equal(first.expiresAt.valueOf(), second.expiresAt.valueOf(), "parallel attempts reuse the persisted expiry exactly");
  assert.equal(first.plan, "annual");
  assert.equal(first.recurringPaymentAcceptedAt.valueOf(), second.recurringPaymentAcceptedAt.valueOf());
  const stored = (await db.query("select billing_plan,stripe_price_id,billing_consent_auth_user_id,recurring_payment_terms,recurring_payment_accepted_at from stripe_checkout_attempts")).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].recurring_payment_terms.version, "membership-billing-v2");
  assert.equal(stored[0].recurring_payment_terms.offerId, "founding_individual_annual");
  assert.equal(stored[0].recurring_payment_terms.amount, 349000);
  assert.equal(stored[0].recurring_payment_terms.initialTermAmount, 349000);
  assert.equal(stored[0].recurring_payment_terms.initialTermMonths, 12);
  assert.equal(stored[0].recurring_payment_terms.buyoutCap, 150000);
  assert.equal(stored[0].recurring_payment_terms.commercialReservationId, quote.id);
  assert.deepEqual(stored[0].recurring_payment_terms.participants, [{memberId:id(1),personId}]);
  await assert.rejects(db.query("update stripe_checkout_attempts set recurring_payment_terms='{}'::jsonb"), /immutable/);
  const consentInput = { memberId:id(1),attemptId:id(5),acceptanceId:id(4),plan:"annual",priceId:"price_annual",subscriptionId:"sub_test",billingTermsVersion:"membership-billing-v2",offerId:quote.offerId,commercialReservationId:quote.id };
  assert.equal(await repository.hasMembershipCheckoutConsent(wrap(db),consentInput),true);
  assert.equal(await repository.hasMembershipCheckoutConsent(wrap(db),{...consentInput,offerId:"individual_annual"}),false);
  assert.equal(await repository.hasMembershipCheckoutConsent(wrap(db),{...consentInput,billingTermsVersion:undefined}),false);
  await assert.rejects(repository.reserveMembershipCheckout({...input,commercialReservationId:id(8)}),repository.MembershipCheckoutConflictError);
  assert.equal(stored[0].billing_consent_auth_user_id, id(2));
  assert.ok(stored[0].recurring_payment_accepted_at);
  assert.equal((await db.query("select billing_plan from member_onboardings")).rows[0].billing_plan, "annual");
  await assert.rejects(repository.reserveMembershipCheckout({ ...input, plan: "monthly", stripePriceId: "price_monthly" }), repository.MembershipCheckoutConflictError);
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
