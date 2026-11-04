import assert from "node:assert/strict";
import { read } from "./member-sms-fixture.mjs";
import { installOperatorFundingFunctions } from "./operator-funding-fixture.mjs";

export async function installMemberSmsFundingFixture(db) {
  await db.exec(`
    alter table ruined_members add column if not exists email_normalized text default 'fixture@example.test';
    alter table member_lifecycle add column if not exists billing_state text default 'active';
    alter table member_lifecycle add column if not exists standing_state text default 'active';
    alter table member_lifecycle add column if not exists cancellation_effective_at timestamptz;
    alter table people add column if not exists status text default 'active';
    alter table platform_users add column if not exists member_id uuid;
    alter table platform_users add column if not exists person_id uuid;
    alter table platform_users add column if not exists status text default 'active';
    alter table platform_users add column if not exists email_normalized text default 'fixture@example.test';
    create table if not exists platform_role_grants(id uuid primary key default gen_random_uuid(),auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table if not exists person_email_addresses(person_id uuid,email_normalized text,verification_state text,retired_at timestamptz);
    create table if not exists member_registration_access(member_id uuid primary key,profile_activated_at timestamptz);
  `);
  await installOperatorFundingFunctions(db);
  // Use the current shipped definition: only ops_admin funds operator membership.
  const currentOperator = read("db/migrations/20260930100000_supporter_service.sql");
  for (const name of ["private.ruined_member_has_operator_funding", "private.ruined_lock_member_operator_funding"]) {
    const start = currentOperator.indexOf(`create or replace function ${name}(`), end = currentOperator.indexOf("$$;", start);
    assert.ok(start >= 0 && end > start); await db.exec(currentOperator.slice(start, end + 3));
  }
  const release = read("db/migrations/20260930140000_member_registration_access.sql"), start = release.indexOf("create function private.ruined_member_profile_released(");
  await db.exec(release.slice(start, release.indexOf("$$;", start) + 3).replace("create function", "create or replace function"));
  await db.exec(`
    alter table member_registration_access add column if not exists payment_setup_account_id text;
    alter table member_registration_access add column if not exists payment_setup_livemode boolean;
    alter table membership_commercial_reservations add column if not exists billing_schedule jsonb;
    alter table membership_commercial_participants add column if not exists person_id uuid;
    alter table stripe_subscriptions add column if not exists stripe_customer_id text;
    create table if not exists stripe_membership_prepaid_proofs(reservation_id uuid,contract_id uuid,member_id uuid,livemode boolean,
      refund_state text,amount_refunded integer,provider_canceled_at timestamptz,review_reason text,amount_paid integer,
      dues_amount integer,verified_at timestamptz,stripe_invoice_id text,stripe_subscription_id text,currency text,created_at timestamptz);
    create table if not exists stripe_checkout_attempts(id uuid primary key,status text,member_id uuid,recurring_payment_accepted_at timestamptz,
      payment_setup_account_id text,payment_setup_livemode boolean,stripe_subscription_id text,commercial_reservation_id uuid,
      billing_schedule jsonb,stripe_session_id text,billing_consent_source text default 'member',billing_consent_auth_user_id uuid,operator_authorization_id uuid);
    create table if not exists stripe_checkout_sessions(id text primary key,session_status text,payment_status text,livemode boolean,
      member_id uuid,stripe_subscription_id text);
    create table if not exists stripe_membership_commitments(id uuid primary key,checkout_attempt_id uuid,member_id uuid,livemode boolean,
      terms_snapshot jsonb,stripe_customer_id text);
    create table if not exists stripe_invoices(id text primary key,member_id uuid,stripe_subscription_id text,stripe_customer_id text,
      stripe_status text,purpose text,amount_paid integer,amount_due integer,currency text,paid_at timestamptz);
    create table if not exists operator_membership_saved_payments(attempt_id uuid primary key,status text,operator_authorization_id uuid,
      member_id uuid,actor_auth_user_id uuid,stripe_subscription_id text,livemode boolean,stripe_account_id text,stripe_customer_id text,expected_total integer);
    create table if not exists operator_membership_authorizations(id uuid primary key,authority_version text,member_id uuid,actor_auth_user_id uuid,authorized_at timestamptz);
  `);
  const migration = read("db/migrations/20261102120000_operator_saved_membership_payment.sql");
  const paidStart = migration.indexOf("create or replace function private.ruined_member_paid_reservation(");
  assert.ok(paidStart >= 0); await db.exec(migration.slice(paidStart, migration.indexOf("$$;", paidStart) + 3));
}

export async function seedMemberSmsPaidReservation(db, { memberId, personId, reservation, contract, release = true }) {
  const subscription = `sub_${reservation}`, session = `cs_${reservation}`, invoice = `in_${reservation}`, customer = `cus_${reservation}`;
  const schedule = JSON.stringify({ version: "fixture-v1", firstMonthlyDueAt: "2026-12-31T22:00:00.000Z" });
  await db.query("update ruined_members set membership_state='pending' where id=$1", [memberId]);
  await db.query("update member_lifecycle set billing_state='pending',standing_state='pre_active' where member_id=$1", [memberId]);
  await db.query(`insert into member_registration_access(member_id,profile_activated_at,payment_setup_account_id,payment_setup_livemode)
    values($1,case when $2 then now() else null end,'acct_fixture',true)
    on conflict(member_id) do update set profile_activated_at=excluded.profile_activated_at,payment_setup_account_id=excluded.payment_setup_account_id,payment_setup_livemode=true`, [memberId, release]);
  await db.query(`insert into membership_commercial_reservations(id,payer_member_id,kind,status,stripe_subscription_id,billing_schedule)
    values($1,$2,'individual','reserved',$3,$4)`, [reservation, memberId, subscription, schedule]);
  await db.query("insert into membership_commercial_participants(reservation_id,member_id,person_id) values ($1,$2,$3)", [reservation, memberId, personId]);
  await db.query(`insert into stripe_subscriptions(id,member_id,stripe_status,stripe_customer_id) values($1,$2,'trialing',$3)`, [subscription, memberId, customer]);
  await db.query(`insert into stripe_checkout_attempts(id,status,member_id,recurring_payment_accepted_at,payment_setup_account_id,payment_setup_livemode,
    stripe_subscription_id,commercial_reservation_id,billing_schedule,stripe_session_id) values($1,'completed',$2,now(),'acct_fixture',true,$3,$1,$4,$5)`,
    [reservation, memberId, subscription, schedule, session]);
  await db.query("insert into stripe_checkout_sessions values($1,'complete','paid',true,$2,$3)", [session, memberId, subscription]);
  await db.query("insert into stripe_membership_commitments values($1,$2,$3,true,$4,$5)",
    [contract, reservation, memberId, JSON.stringify({ billingSchedule: JSON.parse(schedule) }), customer]);
  await db.query(`insert into stripe_invoices values($1,$2,$3,$4,'paid','membership',34900,34900,'usd',now())`, [invoice, memberId, subscription, customer]);
  await db.query(`insert into stripe_membership_prepaid_proofs values($1,$2,$3,true,'none',0,null,null,34900,34900,now(),$4,$5,'usd',now())`,
    [reservation, contract, memberId, invoice, subscription]);
  return { reservation, contract, subscription, session, invoice, customer };
}
