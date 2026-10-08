import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dates = { email: "2026-10-01T12:00:00.000Z", info: "2026-10-02T12:00:00.000Z",
  legal: "2026-10-02T13:00:00.000Z", saved: "2026-10-03T12:00:00.000Z", paid: "2026-10-04T12:00:00.000Z",
  granted: "2026-10-05T12:00:00.000Z" };

function load(path, dependencies = {}) {
  const loadedModule = { exports: {} };
  const requireSource = name => {
    if (name === "server-only") return {};
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected runtime dependency: ${name}`);
  };
  const code = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("module", "exports", "require", "process", code)(loadedModule, loadedModule.exports, requireSource,
    { env: { STRIPE_SECRET_KEY: "sk_test_offline_checkpoint_fixture" } });
  return loadedModule.exports;
}
const { operatorMemberJourney } = load("src/lib/membership/operator-registration-progress.ts");
const repository = load("src/lib/membership/registration-repository.ts", {
  "@/lib/database/server": { getApplicationDatabase() { throw new Error("A network database is forbidden."); } },
  "@/lib/platform/config": { getPlatformConfiguration: () => ({ stripeActivationReady: true, stripeCheckoutReady: true }) },
  "./registration-routing": load("src/lib/membership/registration-routing.ts"),
});

// Execute the actual reader and the shipped paid-evidence function. Stub only
// independently tested access/funding policies, so contradictory provider rows
// can exercise this read model without bypassing its SQL or manufacturing a map.
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table ruined_members(id uuid primary key,person_id uuid,email_normalized text,deleted_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,billing_state text);
    create table member_registration_access(member_id uuid primary key,requires_initial_payment boolean,
      registered_at timestamptz,completion_basis text,payment_reservation_id uuid,payment_setup_account_id text,payment_setup_livemode boolean,
      profile_activated_at timestamptz,legal_acknowledgment_required boolean,version bigint default 1);
    create table member_onboardings(member_id uuid primary key,profile_completed_at timestamptz);
    create table person_private_profiles(person_id uuid primary key,birth_date date,default_fulfillment_address jsonb);
    create table person_email_addresses(person_id uuid,email_normalized text,verification_state text,verified_at timestamptz,retired_at timestamptz);
    create table member_consents(member_id uuid,consent_type text,decision text,source text,actor_auth_user_id uuid,evidence jsonb,accepted_at timestamptz);
    create table member_payment_method_accounts(member_id uuid,stripe_account_id text,livemode boolean,stripe_payment_method_id text,
      saved_at timestamptz,consent_revoked_at timestamptz,cleanup_pending boolean,consent_attempt_id uuid);
    create table member_payment_method_setup_attempts(id uuid,member_id uuid,stripe_account_id text,livemode boolean,status text,consent_revoked_at timestamptz);
    create table member_payment_method_detachments(stripe_account_id text,livemode boolean,stripe_payment_method_id text);
    create table membership_commercial_participants(member_id uuid,person_id uuid,reservation_id uuid);
    create table membership_commercial_reservations(id uuid primary key,payer_member_id uuid,status text,stripe_subscription_id text,billing_schedule jsonb,kind text);
    create table stripe_membership_prepaid_proofs(reservation_id uuid primary key,member_id uuid,contract_id uuid,
      stripe_subscription_id text,stripe_invoice_id text,livemode boolean,refund_state text,amount_refunded bigint,
      provider_canceled_at timestamptz,review_reason text,amount_paid bigint,dues_amount bigint,currency text,verified_at timestamptz,created_at timestamptz,service_starts_at timestamptz);
    create table stripe_checkout_attempts(id uuid primary key,member_id uuid,stripe_session_id text,status text,
      recurring_payment_accepted_at timestamptz,payment_setup_account_id text,payment_setup_livemode boolean,
      stripe_subscription_id text,commercial_reservation_id uuid,billing_schedule jsonb);
    create table stripe_checkout_sessions(id text primary key,member_id uuid,session_status text,payment_status text,livemode boolean,stripe_subscription_id text);
    create table stripe_membership_commitments(id uuid primary key,member_id uuid,checkout_attempt_id uuid,livemode boolean,stripe_customer_id text,terms_snapshot jsonb,status text,stripe_subscription_id text);
    create table stripe_subscriptions(id text primary key,member_id uuid,stripe_status text,stripe_customer_id text,cancel_at timestamptz);
    create table stripe_invoices(id text primary key,member_id uuid,stripe_subscription_id text,stripe_customer_id text,stripe_status text,
      purpose text,amount_paid bigint,amount_due bigint,currency text,paid_at timestamptz);
    create table stripe_webhook_events(object_id text,event_type text,status text,livemode boolean);
    create table fixture_policies(member_id uuid primary key,complimentary boolean default false,operator_funding boolean default false,
      legal_complete boolean default true,ready boolean default false,partner_id uuid,shared_billing_state text);
    create function private.ruined_member_has_complimentary_funding(uuid) returns boolean language sql as
      'select complimentary from fixture_policies where member_id=$1';
    create function private.ruined_member_has_operator_funding(uuid) returns boolean language sql as
      'select operator_funding from fixture_policies where member_id=$1';
    create function private.ruined_registration_legal_complete(uuid) returns boolean language sql as
      'select legal_complete from fixture_policies where member_id=$1';
    create function private.ruined_member_registration_ready(uuid) returns boolean language sql as
      'select ready from fixture_policies where member_id=$1';
    create function private.ruined_commercial_circle_couple_partner(uuid) returns uuid language sql as
      'select partner_id from fixture_policies where member_id=$1';
    create function private.ruined_member_shared_billing_state(uuid) returns text language sql as
      'select shared_billing_state from fixture_policies where member_id=$1';
    create function private.ruined_member_profile_released(uuid) returns boolean language sql as
      'select not exists(select 1 from member_registration_access where member_id=$1 and profile_activated_at is null)';
    create function private.ruined_registration_intake_eligibility_error(date,text) returns text language sql as
      $$select case when $1 is null or $2 is distinct from 'US' then 'incomplete' end$$;`);
  await db.exec(read("db/migrations/20261007110000_member_payment_evidence.sql"));
  const tx = async (strings, ...values) => {
    const query = strings.reduce((text, piece, index) => text + (index ? `$${index}` : "") + piece, "");
    assert.match(query.trim(), /^select\b/i, "Checkpoint reads must not mutate registration or billing.");
    return (await db.query(query, values)).rows;
  };
  async function member(n, { legacy = false, legalRequired = false } = {}) {
    const memberId = id(n), personId = id(n + 100), email = `member${n}@example.test`;
    await db.query("insert into ruined_members values($1,$2,$3,null)", [memberId, personId, email]);
    await db.query("insert into member_lifecycle values($1,'pending')", [memberId]);
    await db.query("insert into fixture_policies(member_id) values($1)", [memberId]);
    if (!legacy) await db.query(`insert into member_registration_access(member_id,requires_initial_payment,payment_setup_account_id,payment_setup_livemode,legal_acknowledgment_required)
      values($1,true,'acct_Checkpoint',false,$2)`, [memberId, legalRequired]);
    await db.query("insert into member_onboardings values($1,$2)", [memberId, dates.info]);
    await db.query(`insert into person_private_profiles values($1,'1990-01-01','{"countryCode":"US"}')`, [personId]);
    await db.query("insert into person_email_addresses values($1,$2,'verified',$3,null)", [personId, email, dates.email]);
    return memberId;
  }
  async function saved(memberId) {
    await db.query("insert into member_payment_method_accounts values($1,'acct_Checkpoint',false,'pm_checkpoint',$2,null,false,$1)", [memberId, dates.saved]);
    await db.query("insert into member_payment_method_setup_attempts values($1,$1,'acct_Checkpoint',false,'saved',null)", [memberId]);
  }
  async function paid(memberId, partnerId = null) {
    const reservation = id(900), schedule = '{"cohortMonth":"2026-11"}';
    for (const participant of [memberId, partnerId].filter(Boolean)) await db.query(`insert into membership_commercial_participants
      select id,person_id,$2 from ruined_members where id=$1`, [participant, reservation]);
    await db.query("insert into membership_commercial_reservations values($1,$2,'reserved','sub_checkpoint',$3,$4)", [reservation, memberId, schedule, partnerId ? "couple" : "individual"]);
    await db.query(`insert into stripe_membership_prepaid_proofs values($1,$2,$1,'sub_checkpoint','in_checkpoint',false,'none',0,null,null,34900,34900,'usd',$3,$3,'2026-11-05T22:00:00Z')`, [reservation, memberId, dates.paid]);
    await db.query(`insert into stripe_checkout_attempts values($1,$2,'cs_checkpoint','completed',$3,'acct_Checkpoint',false,'sub_checkpoint',$1,$4)`, [reservation, memberId, dates.paid, schedule]);
    await db.query("insert into stripe_checkout_sessions values('cs_checkpoint',$1,'complete','paid',false,'sub_checkpoint')", [memberId]);
    await db.query(`insert into stripe_membership_commitments values($1,$2,$1,false,'cus_checkpoint','{"billingSchedule":{"cohortMonth":"2026-11"}}','active','sub_checkpoint')`, [reservation, memberId]);
    await db.query("insert into stripe_subscriptions values('sub_checkpoint',$1,'trialing','cus_checkpoint',null)", [memberId]);
    await db.query("insert into stripe_invoices values('in_checkpoint',$1,'sub_checkpoint','cus_checkpoint','paid','membership',34900,34900,'usd',$2)", [memberId, dates.paid]);
    if (partnerId) await db.query("update fixture_policies set partner_id=$2 where member_id=$1", [partnerId, memberId]);
  }
  const progress = async memberId => (await repository.readMemberRegistrationProgress(tx, [memberId])).get(memberId);
  const journey = async memberId => operatorMemberJourney(await progress(memberId));
  return { db, tx, member, saved, paid, progress, journey };
}
const checkpoint = (journey, key) => journey.checkpoints.find(row => row.key === key);

test("canonical checkpoint evidence executes the reader SQL against provider and registration records", async t => {
  const f = await fixture(t);
  const isolated = (name, run) => t.test(name, async () => {
    await f.db.exec("begin");
    try { await run(); } finally { await f.db.exec("rollback"); }
  });
  await isolated("dates come from verified email, completed information, legal consent, and explicit profile grant", async () => {
    const member = await f.member(1, { legalRequired: true });
    const evidence = { context: "registration_documents_v1", affirmativeAction: "checkbox_and_submit",
      membershipTerms: { key: "ruined_registration", sha256: "a".repeat(64) }, registrationTermsAccepted: true,
      paidAgreementAccepted: false, chargeAuthorized: false };
    await f.db.query("insert into member_consents values($1,'privacy','accepted','member',$2,$3,$4)", [member, id(800), evidence, dates.legal]);
    await f.db.query("update member_registration_access set profile_activated_at=$2 where member_id=$1", [member, dates.granted]);
    const row = await f.progress(member);
    assert.equal(row.emailVerifiedAt, dates.email); assert.equal(row.informationCollectedAt, dates.legal);
    assert.equal(row.profileGrantedAt, dates.granted); assert.equal(row.profileGranted, true);
    assert.equal(row.paymentConfirmed, false); assert.equal(row.paymentReceivedAt, null);
  });
  await isolated("only the member's current nonretired email qualifies", async () => {
    const member = await f.member(1);
    await f.db.query("update person_email_addresses set retired_at=now()");
    await f.db.query("insert into person_email_addresses values($1,'different@example.test','verified',$2,null)", [id(101), dates.paid]);
    let row = await f.progress(member);
    assert.equal(row.emailVerified, false); assert.equal(row.emailVerifiedAt, null);
    await f.db.query("update person_email_addresses set retired_at=null,verification_state='unverified' where email_normalized='member1@example.test'");
    row = await f.progress(member); assert.equal(row.emailVerified, false);
    assert.equal((await f.journey(member)).next.key, "email");
  });
  await isolated("legacy no-registration members retain profile access without invented dates or newer intake requirements", async () => {
    const member = await f.member(1, { legacy: true });
    await f.db.query("update person_private_profiles set birth_date=null,default_fulfillment_address=null");
    const row = await f.progress(member);
    assert.equal(row.profileComplete, true); assert.equal(row.informationCollectedAt, dates.info);
    assert.equal(row.profileGranted, true); assert.equal(row.profileGrantedAt, null);
    assert.equal(row.state, "activated"); assert.equal(row.paymentConfirmed, false);
    assert.match(checkpoint(await f.journey(member), "profile").detail, /original grant date not recorded/);
  });
  await isolated("standalone saved card records information but never payment; detached and expired setup do not count", async () => {
    const member = await f.member(1); await f.saved(member);
    let row = await f.progress(member);
    assert.equal(row.paymentMethodState, "saved"); assert.equal(row.paymentInformationCollectedAt, dates.saved);
    assert.equal(row.paymentConfirmed, false); assert.equal((await f.journey(member)).next.key, "payment");
    await f.db.exec("insert into member_payment_method_detachments values('acct_Checkpoint',false,'pm_checkpoint')");
    row = await f.progress(member); assert.equal(row.paymentMethodState, "removed"); assert.equal(row.paymentInformationCollectedAt, null);
    await f.db.exec("delete from member_payment_method_detachments; update member_payment_method_setup_attempts set status='expired'");
    row = await f.progress(member); assert.equal(row.paymentMethodState, "missing"); assert.equal(row.paymentInformationCollectedAt, null);
  });
  await isolated("ordinary paid checkout proves information collected without any standalone card setup row", async () => {
    const member = await f.member(1); await f.paid(member);
    await f.db.query("update member_registration_access set registered_at=$2,completion_basis='paid_membership' where member_id=$1", [member, dates.paid]);
    await f.db.query("update fixture_policies set ready=true where member_id=$1", [member]);
    const row = await f.progress(member), journey = await f.journey(member);
    assert.equal(row.paymentMethodState, "missing"); assert.equal(row.paymentConfirmed, true);
    assert.equal(row.paymentReceivedAt, dates.paid); assert.equal(row.paymentInformationCollectedAt, dates.paid);
    assert.equal(checkpoint(journey, "payment_method").state, "complete");
    assert.match(checkpoint(journey, "payment_method").detail, /Collected through Stripe checkout/);
    assert.equal(journey.next.key, "profile"); assert.equal(checkpoint(journey, "profile").state, "needed");
  });
  await isolated("complimentary checkpoints use current funding, not a historical complimentary completion", async () => {
    const member = await f.member(1);
    await f.db.query("update member_registration_access set registered_at=$2,completion_basis='complimentary' where member_id=$1", [member, dates.info]);
    await f.db.query("update fixture_policies set complimentary=true,ready=true where member_id=$1", [member]);
    let journey = await f.journey(member);
    assert.equal(checkpoint(journey, "payment").state, "not_required"); assert.equal(journey.next.key, "profile");
    await f.db.query("update fixture_policies set complimentary=false,ready=false where member_id=$1", [member]);
    journey = await f.journey(member);
    assert.equal(checkpoint(journey, "payment").state, "needed"); assert.equal(journey.next.key, "payment");
    await f.db.query("update fixture_policies set operator_funding=true where member_id=$1", [member]);
    assert.equal(checkpoint(await f.journey(member), "payment").state, "not_required");
  });
  await isolated("canonical couples share the payer evidence; mismatched participant identity cannot inherit it", async () => {
    const payer = await f.member(1), partner = await f.member(2); await f.paid(payer, partner);
    let row = await f.progress(partner), journey = await f.journey(partner);
    assert.equal(row.paymentByPartner, true); assert.equal(row.paymentConfirmed, true); assert.equal(row.paymentReceivedAt, dates.paid);
    assert.equal(checkpoint(journey, "payment_method").state, "not_required");
    assert.match(checkpoint(journey, "payment").detail, /Shared membership payment confirmed/);
    await f.db.query("update membership_commercial_participants set person_id=$2 where member_id=$1", [partner, id(999)]);
    row = await f.progress(partner);
    assert.equal(row.paymentByPartner, false); assert.equal(row.paymentConfirmed, false); assert.equal(row.paymentReceivedAt, null);
    assert.equal((await f.progress(payer)).paymentConfirmed, true);
  });
  await isolated("refund, cancellation and review evidence prevent Paid and route to review without a second charge", async () => {
    const member = await f.member(1); await f.paid(member);
    for (const change of ["refund_state='refunded',amount_refunded=34900", "review_reason='dispute'", "provider_canceled_at=now()"] ) {
      await f.db.exec(`update stripe_membership_prepaid_proofs set refund_state='none',amount_refunded=0,review_reason=null,provider_canceled_at=null`);
      await f.db.exec(`update stripe_membership_prepaid_proofs set ${change}`);
      const row = await f.progress(member), journey = await f.journey(member);
      assert.equal(row.paymentConfirmed, false, change); assert.equal(row.paymentReceivedAt, null, change);
      assert.equal(row.paymentNeedsReview, true, change); assert.equal(journey.next.key, "review", change);
      assert.equal(checkpoint(journey, "payment").state, "review", change);
    }
  });
  await isolated("a historical paid invoice prompts verification but is never new paid proof", async () => {
    const member = await f.member(1, { legacy: true });
    await f.db.query("insert into stripe_subscriptions values('sub_old',$1,'active','cus_old',null)", [member]);
    await f.db.query("insert into stripe_invoices values('in_old',$1,'sub_old','cus_old','paid','membership',34900,34900,'usd',$2)", [member, dates.paid]);
    await f.db.exec("insert into stripe_webhook_events values('in_old','invoice.paid','processed',false)");
    let row = await f.progress(member);
    assert.equal(row.historicalPaymentRecorded, true); assert.equal(row.paymentConfirmed, false); assert.equal(row.paymentReceivedAt, null);
    assert.equal((await f.journey(member)).next.key, "review");
    await f.db.exec("update stripe_webhook_events set livemode=true");
    row = await f.progress(member); assert.equal(row.historicalPaymentRecorded, false);
    await f.db.exec("update stripe_webhook_events set livemode=false; update stripe_invoices set amount_paid=0");
    assert.equal((await f.progress(member)).historicalPaymentRecorded, false);
    await f.db.exec("update stripe_invoices set amount_paid=34900,stripe_customer_id='cus_other'");
    assert.equal((await f.progress(member)).historicalPaymentRecorded, false);
  });
  await isolated("deleted members are excluded, unsupported identifiers reject, and an empty roster stays empty", async () => {
    const member = await f.member(1);
    await f.db.query("update ruined_members set deleted_at=now() where id=$1", [member]);
    assert.equal(await f.progress(member), undefined);
    assert.equal((await repository.readMemberRegistrationProgress(f.tx, [])).size, 0);
    await assert.rejects(repository.readMemberRegistrationProgress(f.tx, ["not-a-member-id"]), /valid member/);
  });
});
