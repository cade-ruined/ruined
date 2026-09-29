import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Only use with isolated test engines. Execute the shipped functions unchanged.
export async function installOperatorFundingFunctions(db) {
  const migration = await readFile(new URL("../../db/migrations/20260914181653_operator_complimentary_membership.sql", import.meta.url), "utf8");
  for (const name of ["private.ruined_member_has_operator_funding", "private.ruined_lock_member_operator_funding"]) {
    const start = migration.indexOf(`create or replace function ${name}(`);
    const end = migration.indexOf("$$;", start);
    assert.ok(start >= 0 && end > start, `Missing shipped function: ${name}`);
    await db.exec(migration.slice(start, end + 3));
  }
  await installComplimentaryFundingFunctions(db);
}

export async function installComplimentaryFundingFunctions(db) {
  // Surrounding schemas are deliberately small; funding predicates are the
  // exact shipped definitions, not a boolean stub of authorization behavior.
  await db.exec(`
    alter table public.ruined_members add column if not exists deleted_at timestamptz;
    create table if not exists public.member_complimentary_grants (
      id uuid primary key default gen_random_uuid(), member_id uuid,
      starts_at timestamptz default statement_timestamp(), ends_at timestamptz, revoked_at timestamptz
    );
  `);
  const migration = await readFile(new URL("../../db/migrations/20260925000000_complimentary_member_invitations.sql", import.meta.url), "utf8");
  for (const name of ["private.ruined_member_has_complimentary_funding", "private.ruined_lock_member_complimentary_funding"]) {
    const start = migration.indexOf(`create or replace function ${name}(`);
    const end = migration.indexOf("$$;", start);
    assert.ok(start >= 0 && end > start, `Missing shipped function: ${name}`);
    await db.exec(migration.slice(start, end + 3));
  }
  await installSharedMembershipFundingFunctions(db);
}

export async function installSharedMembershipFundingFunctions(db) {
  // The shared access predicate is also shipped SQL. Unrelated fixtures keep
  // empty commercial tables; commercial-database.test exercises actual pairs.
  await db.exec(`
    create table if not exists public.membership_commercial_reservations (
      id uuid primary key, payer_member_id uuid, kind text, status text, stripe_subscription_id text, created_at timestamptz
    );
    create table if not exists public.membership_commercial_participants (reservation_id uuid, member_id uuid);
    create table if not exists public.membership_enrollment_episodes (reservation_id uuid, member_id uuid, ended_at timestamptz);
    create table if not exists public.stripe_subscriptions (id text primary key, member_id uuid, stripe_status text, cancel_at timestamptz);
    alter table public.stripe_subscriptions add column if not exists cancel_at timestamptz;
  `);
  const commercial = await readFile(new URL("../../db/migrations/20260929006000_membership_commercial_eligibility.sql", import.meta.url), "utf8");
  for (const name of ["private.ruined_member_shared_billing_state", "private.ruined_member_has_couple_funding"]) {
    const start = commercial.indexOf(`create function ${name}(`);
    const end = commercial.indexOf("$$;", start);
    assert.ok(start >= 0 && end > start, `Missing shipped function: ${name}`);
    await db.exec(commercial.slice(start, end + 3).replace("create function", "create or replace function"));
  }
}
