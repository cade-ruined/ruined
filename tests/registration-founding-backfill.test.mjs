import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const pricingMigration = "db/migrations/20261002140000_registration_founding_pricing.sql";

test("historical completed registrations receive immutable pricing in original order without sending another welcome", async t => {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const paths = [...(await source("scripts/migrate-platform.mjs")).matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)].map(match => match[1]);
  assert.ok(paths.includes(pricingMigration));
  // Recreate the schema immediately before the migration under test; later
  // migrations may replace its functions and must not run ahead of it.
  for (const path of paths.slice(0, paths.indexOf(pricingMigration))) await db.exec(await source(path));
  // Deliberately insert latest first: allocation must follow registered_at,
  // not insertion order, the card's current state, or the migration's clock.
  for (let number = 52; number >= 1; number--) {
    const member = id(number), auth = id(number + 1000), attempt = id(number + 2000);
    const email = `backfill-${number}@example.test`;
    await db.query("insert into ruined_members(id,email,email_normalized) values($1,$2,$2)", [member,email]);
    const person = (await db.query("select person_id from ruined_members where id=$1", [member])).rows[0].person_id;
    await db.query("insert into member_lifecycle(member_id,account_state) values($1,'active')", [member]);
    await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,$4,'active')", [auth,member,person,email]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [auth]);
    await db.query("update person_email_addresses set verification_state='verified',verified_at=now() where person_id=$1", [person]);
    await db.query("insert into person_private_profiles(person_id,birth_date,default_fulfillment_address) values($1,'1990-01-01','{\"countryCode\":\"US\"}')", [person]);
    await db.query("update member_onboardings set profile_completed_at=now() where member_id=$1", [member]);
    await db.query(`insert into member_registration_access(member_id,payment_setup_account_id,payment_setup_livemode)
      values($1,'acct_BackfillFixture',false)`, [member]);
    await db.query(`insert into member_consents(member_id,consent_type,policy_version,accepted_at,dedupe_key,source,actor_auth_user_id,evidence)
      values($1,'privacy','test-registration-documents',now(),$2,'member',$3,$4::jsonb)`, [member, `backfill-documents-${number}`, auth,
      JSON.stringify({ context: "registration_documents_v1", affirmativeAction: "checkbox_and_submit",
        membershipTerms: { key: "ruined_registration", sha256: "a".repeat(64) },
        registrationTermsAccepted: true, paidAgreementAccepted: false, chargeAuthorized: false })]);
    await db.query(`insert into member_payment_method_accounts(member_id,stripe_account_id,livemode,stripe_customer_id)
      values($1,'acct_BackfillFixture',false,$2)`, [member, `cus_backfill${number}`]);
    await db.query(`insert into member_payment_method_setup_attempts(id,member_id,stripe_account_id,livemode,consent_auth_user_id,
      consent_version,consent_text,return_origin,expires_at,status,stripe_setup_intent_id)
      values($1,$2,'acct_BackfillFixture',false,$3,'save-payment-method-v1','TEST ONLY consent','https://example.test',now()+interval '1 day','saved',$4)`,
      [attempt,member,auth,`seti_backfill${number}`]);
    await db.query(`update member_payment_method_accounts set consent_attempt_id=$2,stripe_payment_method_id=$3,
      payment_method_display='{"type":"card","last4":"4242"}',saved_at=now() where member_id=$1`, [member,attempt,`pm_backfill${number}`]);
    assert.equal((await db.query("select private.ruined_member_registration_ready($1) as ready", [member])).rows[0].ready, true);
    await db.query(`update member_registration_access set registered_at='2026-09-30T00:00:00Z'::timestamptz+$2*interval '1 minute',
      completion_basis='saved_card',payment_setup_attempt_id=$3 where member_id=$1`, [member,number,attempt]);
  }
  await db.query("update member_payment_method_accounts set consent_revoked_at=now() where member_id=$1", [id(1)]);
  await db.query("update member_payment_method_setup_attempts set status='revoked',consent_revoked_at=now() where member_id=$1", [id(1)]);
  assert.equal((await db.query("select private.ruined_member_registration_ready($1) as ready", [id(1)])).rows[0].ready, false);
  await db.query("insert into member_registration_messages(member_id,kind,status,sent_at,provider_message_id) values($1,'welcome','sent',now(),'email_historical')", [id(1)]);
  await db.query("insert into member_registration_messages(member_id,kind) values($1,'welcome')", [id(2)]);
  const messagesBefore = (await db.query("select * from member_registration_messages order by member_id")).rows;

  await db.exec(await source(pricingMigration));
  const decisions = (await db.query("select * from member_registration_pricing_decisions order by registered_at,member_id")).rows;
  assert.equal(decisions.length, 52);
  assert.deepEqual(decisions.map(row => row.member_id), Array.from({ length: 52 }, (_, i) => id(i + 1)));
  assert.deepEqual(decisions.map(row => row.occupied_count_at_decision), Array.from({ length: 52 }, (_, i) => i));
  assert.equal(decisions.filter(row => row.founding_eligible).length, 50);
  assert.ok(decisions.slice(0,50).every(row => row.monthly_amount_cents === 34900 && row.annual_amount_cents === 349000 && row.currency === "usd"));
  assert.ok(decisions.slice(50).every(row => !row.founding_eligible && row.monthly_amount_cents === null));
  assert.equal((await db.query("select private.ruined_registration_founding_pricing_is_current($1) as current", [id(1)])).rows[0].current, true,
    "Withdrawing card storage after a completed registration does not change its historical place");
  assert.equal((await db.query("select private.ruined_commercial_occupied_count() as n")).rows[0].n, 52);
  assert.deepEqual((await db.query("select * from member_registration_messages order by member_id")).rows, messagesBefore);
  for (const table of ["stripe_checkout_attempts","stripe_subscriptions","stripe_invoices","membership_enrollment_episodes"]) {
    assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n, 0, table);
  }
  await db.query("select private.ruined_confirm_registration_pricing($1)", [id(1)]);
  assert.deepEqual((await db.query("select * from member_registration_pricing_decisions order by registered_at,member_id")).rows, decisions,
    "A retry cannot change a positive or negative historical eligibility snapshot");
});
