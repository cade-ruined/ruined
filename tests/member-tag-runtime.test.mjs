import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = await readFile(new URL("../src/lib/membership/member-tag.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function("module", "exports", output)(loaded, loaded.exports);
const { normalizeMemberTag, MemberTagValidationError, isMemberTagConflict, MEMBER_TAG_UNIQUE_INDEX } = loaded.exports;
const migration = await readFile(new URL("../db/migrations/20260920200000_member_tags.sql", import.meta.url), "utf8");

test("member tags canonicalize one optional @ and case, with bounded ASCII syntax", () => {
  for (const [input, expected] of [[" @Cade_09 ", "cade_09"], ["abc", "abc"], ["A".repeat(24), "a".repeat(24)], ["", null], ["  ", null]]) {
    assert.equal(normalizeMemberTag(input), expected);
  }
  for (const invalid of [undefined, null, 42, {}, "@", "@@cade", "ab", "a".repeat(25), "hello world", "hello.world", "hello-world", "ruíned", "İtest", "a\nbc", "a\u200bbc", "<script>"]) {
    assert.throws(() => normalizeMemberTag(invalid), MemberTagValidationError);
  }
});

test("only the named tag unique-index violation becomes an unavailable-tag conflict", () => {
  assert.equal(isMemberTagConflict({ code: "23505", constraint: MEMBER_TAG_UNIQUE_INDEX }), true);
  assert.equal(isMemberTagConflict({ code: "23505", constraint_name: MEMBER_TAG_UNIQUE_INDEX }), true);
  for (const failure of [null, {}, { code: "23514", constraint: MEMBER_TAG_UNIQUE_INDEX }, { code: "23505", constraint: "some_other_unique_index" }]) {
    assert.equal(isMemberTagConflict(failure), false);
  }
});

test("additive tag migration preserves legacy names, access and profile permissions; database arbitrates competing claims", async () => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table person_profiles(person_id integer primary key, display_name text, preferred_name text);
      alter table person_profiles enable row level security;
      revoke all on person_profiles from public, anon, authenticated;
      grant select on person_profiles to authenticated;
      create table member_lifecycle(member_id integer primary key, account_state text, administrative_onboarding_state text);
      insert into person_profiles values(1,'Public One','Same legacy name'),(2,'Public Two','Same legacy name');
      insert into member_lifecycle values(1,'active','completed'),(2,'active','completed');`);
    const before = (await db.query("select relrowsecurity,relacl::text from pg_class where oid='person_profiles'::regclass")).rows[0];
    await db.exec(migration);
    assert.deepEqual((await db.query("select relrowsecurity,relacl::text from pg_class where oid='person_profiles'::regclass")).rows[0], before);
    assert.deepEqual((await db.query("select member_tag,preferred_name from person_profiles order by person_id")).rows,
      [{ member_tag: null, preferred_name: "Same legacy name" }, { member_tag: null, preferred_name: "Same legacy name" }]);
    assert.equal((await db.query("select count(*)::int as count from member_lifecycle where account_state='active' and administrative_onboarding_state='completed'")).rows[0].count, 2);
    const claims = await Promise.allSettled([1, 2].map(id => db.query("update person_profiles set member_tag=$1 where person_id=$2", [normalizeMemberTag("@Same_Tag"), id])));
    assert.equal(claims.filter(result => result.status === "fulfilled").length, 1);
    const rejected = claims.find(result => result.status === "rejected");
    assert.ok(isMemberTagConflict(rejected.reason), "PostgreSQL unique index decides the losing claim");
    assert.equal((await db.query("select count(*)::int as count from person_profiles where member_tag='same_tag'")).rows[0].count, 1);
    for (const invalid of ["Uppercase", "@prefix", "ab", "a".repeat(25), "with space", "ünicode"]) {
      await assert.rejects(db.query("update person_profiles set member_tag=$1 where person_id=1", [invalid]), { code: "23514" });
    }
  } finally { await db.close(); }
});
