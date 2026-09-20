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
}
