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
}
