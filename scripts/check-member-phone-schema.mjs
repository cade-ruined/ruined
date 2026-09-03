import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPGliteForSchemaChecks } from "./check-support-schema.mjs";

export const memberPhoneMigrationUrl = new URL("../db/migrations/20260903225243_member_phone_e164_constraint.sql", import.meta.url);
const originalMigrationUrl = new URL("../db/migrations/20260826_membership_operating_spine_01_person_identity.sql", import.meta.url);
const constraintName = "person_private_profiles_mobile_e164_check";

// Isolated PostgreSQL only: fixtures never read DATABASE_URL or connect to a
// member database. Reuse the exact original table definition to catch SQL
// string/regex escaping bugs that JavaScript-only checks cannot reproduce.
export async function checkMemberPhoneSchema(PGlite) {
  const original = await readFile(originalMigrationUrl, "utf8");
  const tableDefinition = original.match(/create table if not exists public\.person_private_profiles \([\s\S]*?\n\);/)?.[0];
  assert.ok(tableDefinition, "The original private-profile table must be available.");
  const migration = await readFile(memberPhoneMigrationUrl, "utf8");
  const checks = [];
  const db = new PGlite();

  async function prepare(engine) {
    await engine.exec(`
      set standard_conforming_strings = on;
      create role anon nologin;
      create role authenticated nologin;
      create table public.people (id uuid primary key);
      ${tableDefinition}
      alter table public.person_private_profiles enable row level security;
      revoke all on public.person_private_profiles from public, anon, authenticated;
    `);
  }

  async function insertProfile(engine, phone) {
    const personId = randomUUID();
    await engine.query("insert into public.people (id) values ($1)", [personId]);
    await engine.query("insert into public.person_private_profiles (person_id, mobile_e164) values ($1, $2)", [personId, phone]);
    return personId;
  }

  function isPhoneCheckViolation(error) {
    return error.code === "23514" && error.constraint === constraintName;
  }

  async function otherConstraints(engine) {
    return (await engine.query(`
      select conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where conrelid = 'public.person_private_profiles'::regclass and conname <> $1 order by conname
    `, [constraintName])).rows;
  }

  try {
    await prepare(db);
    const existingPersonId = await insertProfile(db, null);
    const before = await otherConstraints(db);
    await assert.rejects(() => insertProfile(db, "+12025550123"), isPhoneCheckViolation);
    checks.push("The exact original PostgreSQL constraint reproduces the valid-phone failure.");

    await db.exec(migration);
    assert.deepEqual(await otherConstraints(db), before);
    assert.equal((await db.query("select mobile_e164 from public.person_private_profiles where person_id = $1", [existingPersonId])).rows[0].mobile_e164, null);
    const constraint = (await db.query("select convalidated from pg_constraint where conrelid = 'public.person_private_profiles'::regclass and conname = $1", [constraintName])).rows[0];
    assert.equal(constraint.convalidated, true);
    assert.equal((await db.query("select relrowsecurity from pg_class where oid = 'public.person_private_profiles'::regclass")).rows[0].relrowsecurity, true);
    for (const role of ["anon", "authenticated"]) {
      const privileges = (await db.query("select has_table_privilege($1, 'public.person_private_profiles', 'SELECT') as read, has_table_privilege($1, 'public.person_private_profiles', 'UPDATE') as write", [role])).rows[0];
      assert.deepEqual(privileges, { read: false, write: false });
    }
    checks.push("The new migration validates without changing existing values, other constraints, RLS, or client privileges.");

    for (const phone of [null, "+12025550123", "+442079460018", "+6907290", "+12", "+123456789012345"]) {
      await insertProfile(db, phone);
    }
    for (const phone of ["", "12025550123", "++12025550123", "+0123456789", "+1", "+1234567890123456", " +12025550123", "+12025550123 ", "+1 2025550123", "+1-202-555-0123", "+12025550123x9", "+12025550123\n", "\\12025550123"]) {
      await assert.rejects(() => insertProfile(db, phone), isPhoneCheckViolation);
    }
    await db.query("update public.person_private_profiles set mobile_e164 = $1 where person_id = $2", ["+6907290", existingPersonId]);
    await assert.rejects(() => db.query("update public.person_private_profiles set mobile_e164 = $1 where person_id = $2", ["missing-plus", existingPersonId]), isPhoneCheckViolation);
    assert.equal((await db.query("select mobile_e164 from public.person_private_profiles where person_id = $1", [existingPersonId])).rows[0].mobile_e164, "+6907290");
    checks.push("Inserts and updates accept null and E.164-shaped numbers including Tokelau, and reject malformed or out-of-range values.");

    const legacyDb = new PGlite();
    try {
      await prepare(legacyDb);
      const legacyId = await insertProfile(legacyDb, "\\12025550123");
      const priorConstraint = (await legacyDb.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'public.person_private_profiles'::regclass and conname = $1", [constraintName])).rows;
      await assert.rejects(() => legacyDb.exec(migration), isPhoneCheckViolation);
      await legacyDb.exec("rollback;");
      assert.equal((await legacyDb.query("select mobile_e164 from public.person_private_profiles where person_id = $1", [legacyId])).rows[0].mobile_e164, "\\12025550123");
      assert.deepEqual((await legacyDb.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'public.person_private_profiles'::regclass and conname = $1", [constraintName])).rows, priorConstraint);
      checks.push("Unexpected invalid legacy data makes migration validation fail and roll back without rewriting contact details.");
    } finally {
      await legacyDb.close();
    }
    return { checks, engine: (await db.query("select version() as version")).rows[0].version };
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { checks, engine } = await checkMemberPhoneSchema(await loadPGliteForSchemaChecks());
  for (const check of checks) console.log(`PASS ${check}`);
  console.log(`Verified ${checks.length} phone constraint groups on ${engine}`);
}
