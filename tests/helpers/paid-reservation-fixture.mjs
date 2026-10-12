import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The schema is intentionally small; authorization executes the exact shipped
// provider-evidence predicate, including its cross-entity and refund checks.
export async function installPaidReservationFunction(db) {
  await db.exec(`
    alter table membership_commercial_reservations add column if not exists billing_schedule jsonb;
    alter table membership_commercial_participants add column if not exists person_id uuid;
    alter table stripe_subscriptions add column if not exists stripe_customer_id text;
    create table member_registration_access(member_id uuid primary key,payment_setup_account_id text,payment_setup_livemode boolean);
    create table stripe_membership_prepaid_proofs(reservation_id uuid,contract_id uuid,member_id uuid,livemode boolean,
      refund_state text,amount_refunded integer,provider_canceled_at timestamptz,review_reason text,amount_paid integer,
      dues_amount integer,verified_at timestamptz,stripe_invoice_id text,stripe_subscription_id text,currency text,created_at timestamptz);
    create table stripe_checkout_attempts(id uuid primary key,status text,member_id uuid,recurring_payment_accepted_at timestamptz,
      payment_setup_account_id text,payment_setup_livemode boolean,stripe_subscription_id text,commercial_reservation_id uuid,
      billing_schedule jsonb,stripe_session_id text);
    create table stripe_checkout_sessions(id text primary key,session_status text,payment_status text,livemode boolean,
      member_id uuid,stripe_subscription_id text);
    create table stripe_membership_commitments(id uuid primary key,checkout_attempt_id uuid,member_id uuid,livemode boolean,
      terms_snapshot jsonb,stripe_customer_id text);
    create table stripe_invoices(id text primary key,member_id uuid,stripe_subscription_id text,stripe_customer_id text,
      stripe_status text,purpose text,amount_paid integer,amount_due integer,currency text,paid_at timestamptz);
  `);
  const migration = await readFile(new URL("../../db/migrations/20261007110000_member_payment_evidence.sql", import.meta.url), "utf8");
  const start = migration.indexOf("create function private.ruined_member_paid_reservation(");
  const end = migration.indexOf("$$;", start);
  assert.ok(start >= 0 && end > start);
  await db.exec(migration.slice(start, end + 3));
}

export async function clearPaidReservationFixture(db) {
  await db.exec(`truncate member_registration_access,stripe_membership_prepaid_proofs,stripe_checkout_attempts,
    stripe_checkout_sessions,stripe_membership_commitments,stripe_invoices,
    membership_commercial_reservations,membership_commercial_participants,stripe_subscriptions`);
}

export async function seedPaidReservationFixture(db, { member, person, reservation, contract }) {
  const schedule = JSON.stringify({ version: "fixture-v1", firstMonthlyDueAt: "2026-12-31T22:00:00.000Z" });
  await db.query("insert into member_registration_access values ($1,'acct_fixture',true)", [member]);
  await db.query(`insert into membership_commercial_reservations(id,payer_member_id,kind,status,stripe_subscription_id,billing_schedule)
    values($1,$2,'individual','reserved','sub_fixture',$3)`, [reservation, member, schedule]);
  await db.query("insert into membership_commercial_participants values ($1,$2,$3)", [reservation, member, person]);
  await db.query(`insert into stripe_subscriptions(id,member_id,stripe_status,stripe_customer_id)
    values('sub_fixture',$1,'trialing','cus_fixture')`, [member]);
  await db.query(`insert into stripe_checkout_attempts values($1,'completed',$2,now(),'acct_fixture',true,'sub_fixture',$1,$3,'cs_fixture')`,
    [reservation, member, schedule]);
  await db.query("insert into stripe_checkout_sessions values('cs_fixture','complete','paid',true,$1,'sub_fixture')", [member]);
  await db.query("insert into stripe_membership_commitments values($1,$2,$3,true,$4,'cus_fixture')",
    [contract, reservation, member, JSON.stringify({ billingSchedule: JSON.parse(schedule) })]);
  await db.query(`insert into stripe_invoices values('in_fixture',$1,'sub_fixture','cus_fixture','paid','membership',34900,34900,'usd',now())`, [member]);
  await db.query(`insert into stripe_membership_prepaid_proofs values($1,$2,$3,true,'none',0,null,null,34900,34900,now(),
    'in_fixture','sub_fixture','usd',now())`, [reservation, contract, member]);
}
