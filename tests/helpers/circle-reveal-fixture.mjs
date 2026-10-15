import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Unrelated fixtures retain ordinary Foundations semantics with no grants.
// Execute the exact shipped predicate so runtime queries also exercise grants.
export async function installCircleRevealFunction(db) {
  await db.exec(`
    create table if not exists public.circles(id uuid primary key, status text, activated_at timestamptz, ends_at timestamptz);
    create table if not exists public.circle_member_assignments(id bigint primary key, member_id uuid, circle_id uuid, assigned_at timestamptz, ended_at timestamptz);
    create table if not exists public.member_circle_reveal_grants(
      id uuid primary key default gen_random_uuid(), circle_member_assignment_id bigint,
      member_id uuid, circle_id uuid, granted_at timestamptz default now(), revoked_at timestamptz
    );
  `);
  const migration = await readFile(new URL("../../db/migrations/20261015120000_circle_early_reveal.sql", import.meta.url), "utf8");
  const start = migration.indexOf("create or replace function private.ruined_member_circle_is_revealed(");
  const end = migration.indexOf("$$;", start);
  assert.ok(start >= 0 && end > start, "Missing shipped Circle reveal predicate");
  await db.exec(migration.slice(start, end + 3));
}
