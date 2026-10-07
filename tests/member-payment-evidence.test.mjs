import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../db/migrations/20261007110000_member_payment_evidence.sql", import.meta.url);
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// This focused read-model fixture executes the shipped evidence migration. It
// permits contradictory provider snapshots to verify that the reader fails
// closed even before the independent write-side constraints can reject them.
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table member_registration_access(member_id uuid primary key,requires_initial_payment boolean,
      registered_at timestamptz,completion_basis text,payment_reservation_id uuid,payment_setup_account_id text,payment_setup_livemode boolean);
    create table ruined_members(id uuid primary key,person_id uuid);
    create table member_lifecycle(member_id uuid primary key,billing_state text);
    create table membership_commercial_participants(member_id uuid,person_id uuid,reservation_id uuid);
    create table membership_commercial_reservations(id uuid primary key,payer_member_id uuid,status text,stripe_subscription_id text,billing_schedule jsonb);
    create table stripe_membership_prepaid_proofs(reservation_id uuid primary key,member_id uuid,contract_id uuid,
      stripe_subscription_id text,stripe_invoice_id text,livemode boolean,refund_state text,amount_refunded bigint,
      provider_canceled_at timestamptz,review_reason text,amount_paid bigint,dues_amount bigint,currency text,verified_at timestamptz,created_at timestamptz);
    create table stripe_checkout_attempts(id uuid primary key,member_id uuid,stripe_session_id text,status text,
      recurring_payment_accepted_at timestamptz,payment_setup_account_id text,payment_setup_livemode boolean,
      stripe_subscription_id text,commercial_reservation_id uuid,billing_schedule jsonb);
    create table stripe_checkout_sessions(id text primary key,member_id uuid,session_status text,payment_status text,livemode boolean,stripe_subscription_id text);
    create table stripe_membership_commitments(id uuid primary key,member_id uuid,checkout_attempt_id uuid,livemode boolean,stripe_customer_id text,terms_snapshot jsonb);
    create table stripe_subscriptions(id text primary key,member_id uuid,stripe_status text,stripe_customer_id text);
    create table stripe_invoices(id text primary key,member_id uuid,stripe_subscription_id text,stripe_customer_id text,stripe_status text,
      purpose text,amount_paid bigint,amount_due bigint,currency text,paid_at timestamptz);`);
  await db.exec(await readFile(migration, "utf8"));
  const member = id(1), person = id(2), partner = id(3), partnerPerson = id(4), unrelated = id(5), reservation = id(10);
  await db.query(`insert into ruined_members values($1,$2),($3,$4),($5,$6)`, [member,person,partner,partnerPerson,unrelated,id(6)]);
  await db.query(`insert into member_lifecycle values($1,'pending'),($2,'pending'),($3,'pending')`, [member,partner,unrelated]);
  await db.query(`insert into member_registration_access values
    ($1,false,'2026-10-01T12:00:00Z','saved_card',null,'acct_Ruined',false),
    ($2,true,null,null,null,'acct_Ruined',false),($3,false,null,null,null,'acct_Ruined',false)`, [member,partner,unrelated]);
  await db.query(`insert into membership_commercial_participants values($1,$2,$3),($4,$5,$3)`, [member,person,reservation,partner,partnerPerson]);
  await db.query(`insert into membership_commercial_reservations values($1,$2,'reserved','sub_ruined','{"cohortMonth":"2026-11"}')`, [reservation,member]);
  await db.query(`insert into stripe_membership_prepaid_proofs values($1,$2,$1,'sub_ruined','in_ruined',false,'none',0,null,null,34900,34900,'usd',now(),now())`, [reservation,member]);
  await db.query(`insert into stripe_checkout_attempts values($1,$2,'cs_ruined','completed',now(),'acct_Ruined',false,'sub_ruined',$1,'{"cohortMonth":"2026-11"}')`, [reservation,member]);
  await db.query(`insert into stripe_checkout_sessions values('cs_ruined',$1,'complete','paid',false,'sub_ruined')`, [member]);
  await db.query(`insert into stripe_membership_commitments values($1,$2,$1,false,'cus_ruined','{"billingSchedule":{"cohortMonth":"2026-11"}}')`, [reservation,member]);
  await db.query(`insert into stripe_subscriptions values('sub_ruined',$1,'trialing','cus_ruined')`, [member]);
  await db.query(`insert into stripe_invoices values('in_ruined',$1,'sub_ruined','cus_ruined','paid','membership',34900,34900,'usd',now())`, [member]);
  const proof = async (target=member) => (await db.query(`select private.ruined_member_paid_reservation($1) as current,
    private.ruined_registration_paid_reservation($1) as registration`, [target])).rows[0];
  return { db,member,partner,unrelated,reservation,proof };
}

test("a completed save-card registration receives current payment proof without rewriting its original completion", async t => {
  const f=await fixture(t);
  const original=(await f.db.query("select * from member_registration_access where member_id=$1",[f.member])).rows[0];
  assert.equal(original.requires_initial_payment,false);assert.equal(original.completion_basis,"saved_card");
  assert.ok(original.registered_at);assert.equal(original.payment_reservation_id,null);
  assert.deepEqual(await f.proof(),{current:f.reservation,registration:f.reservation});
  assert.deepEqual((await f.db.query("select * from member_registration_access where member_id=$1",[f.member])).rows[0],original);
  await f.db.query("update stripe_membership_prepaid_proofs set refund_state='refunded',amount_refunded=34900");
  assert.deepEqual(await f.proof(),{current:null,registration:null});
  assert.deepEqual((await f.db.query("select * from member_registration_access where member_id=$1",[f.member])).rows[0],original);
});

test("confirmed couples participants share payer evidence but unrelated and mismatched people cannot inherit it", async t => {
  const f=await fixture(t);
  assert.deepEqual(await f.proof(f.partner),{current:f.reservation,registration:f.reservation});
  assert.deepEqual(await f.proof(f.unrelated),{current:null,registration:null});
  await f.db.query("update membership_commercial_participants set person_id=$1 where member_id=$2",[id(99),f.partner]);
  assert.deepEqual(await f.proof(f.partner),{current:null,registration:null});
  assert.deepEqual(await f.proof(),{current:f.reservation,registration:f.reservation});
});

test("paid evidence rejects missing settlement, refund or dispute review, foreign account or mode, and unconfirmed consent", async t => {
  const f=await fixture(t);
  const cases=[
    ["subscription alone", "delete from stripe_membership_prepaid_proofs"],
    ["pending refund", "update stripe_membership_prepaid_proofs set refund_state='pending'"],
    ["partial refund", "update stripe_membership_prepaid_proofs set refund_state='partial',amount_refunded=100"],
    ["review required", "update stripe_membership_prepaid_proofs set refund_state='review_required'"],
    ["dispute", "update stripe_membership_prepaid_proofs set review_reason='dispute'"],
    ["cancellation", "update stripe_membership_prepaid_proofs set provider_canceled_at=now()"],
    ["foreign account", "update member_registration_access set payment_setup_account_id='acct_Foreign'"],
    ["wrong mode", "update member_registration_access set payment_setup_livemode=true"],
    ["Stripe terms not accepted", "update stripe_checkout_attempts set recurring_payment_accepted_at=null"],
    ["checkout incomplete", "update stripe_checkout_attempts set status='open'"],
    ["checkout unpaid", "update stripe_checkout_sessions set payment_status='unpaid'"],
    ["invoice unpaid", "update stripe_invoices set stripe_status='open'"],
    ["invoice amount mismatch", "update stripe_invoices set amount_paid=100"],
    ["invoice unrelated", "update stripe_invoices set purpose='store'"],
    ["invoice foreign customer", "update stripe_invoices set stripe_customer_id='cus_foreign'"],
    ["invoice foreign member", `update stripe_invoices set member_id='${id(90)}'`],
    ["invoice foreign subscription", "update stripe_invoices set stripe_subscription_id='sub_foreign'"],
    ["subscription past due", "update stripe_subscriptions set stripe_status='past_due'"],
    ["foreign contract customer", "update stripe_membership_commitments set stripe_customer_id='cus_foreign'"],
    ["released reservation", "update membership_commercial_reservations set status='released'"],
  ];
  for(const [label,change] of cases){
    await f.db.exec("begin");
    try { await f.db.exec(change);assert.deepEqual(await f.proof(),{current:null,registration:null},label); }
    finally { await f.db.exec("rollback"); }
  }
  assert.deepEqual(await f.proof(),{current:f.reservation,registration:f.reservation});
  assert.equal((await f.db.query("select has_function_privilege('authenticated','private.ruined_member_paid_reservation(uuid)','execute') as allowed")).rows[0].allowed,false);
});
