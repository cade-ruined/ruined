import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const migration = await readFile(new URL("../db/migrations/20261012185853_member_profile_identity.sql", import.meta.url), "utf8");

test("profile migration backfills identity and location without widening table grants or contact consent", async () => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema private;
      create table person_profiles(person_id int primary key, member_tag text unique, display_name text, location_label text, updated_at timestamptz);
      create table person_private_profiles(person_id int primary key, legal_name text);
      create table member_directory_preferences(member_id int primary key, directory_status text default 'hidden', bio_visible boolean default false, email_scope text default 'none', phone_scope text default 'none', version int default 1, updated_at timestamptz);
      alter table person_profiles enable row level security;
      alter table person_private_profiles enable row level security;
      alter table member_directory_preferences enable row level security;
      revoke all on person_profiles, person_private_profiles, member_directory_preferences from public, anon, authenticated;
      grant select on person_profiles to authenticated;
      insert into person_profiles values(1,'alex_morgan','@alex_morgan','Salt Lake City, Utah',now()),(2,null,'Authored Name','Washington, D.C., District of Columbia',now());
      insert into person_private_profiles values(1,'Alex Morgan'),(2,'Do Not Replace');
      insert into member_directory_preferences(member_id,email_scope,phone_scope) values(1,'circle','none');`);
    const before = (await db.query("select relname,relrowsecurity,relacl::text from pg_class where relname in ('person_profiles','person_private_profiles','member_directory_preferences') order by relname")).rows;
    await db.exec(migration);
    const after = (await db.query("select relname,relrowsecurity,relacl::text from pg_class where relname in ('person_profiles','person_private_profiles','member_directory_preferences') order by relname")).rows;
    assert.deepEqual(after, before);
    assert.deepEqual((await db.query("select display_name,city,state,location_label from person_profiles order by person_id")).rows, [
      { display_name: "Alex Morgan", city: "Salt Lake City", state: "Utah", location_label: "Salt Lake City, Utah" },
      { display_name: "Authored Name", city: "Washington, D.C.", state: "District of Columbia", location_label: "Washington, D.C., District of Columbia" },
    ]);
    assert.deepEqual((await db.query("select directory_status,bio_visible,email_scope,phone_scope,version from member_directory_preferences")).rows[0],
      { directory_status: "circle_visible", bio_visible: true, email_scope: "circle", phone_scope: "none", version: 2 });
    await db.exec("insert into member_directory_preferences(member_id) values(2)");
    assert.deepEqual((await db.query("select directory_status,bio_visible,email_scope,phone_scope from member_directory_preferences where member_id=2")).rows[0],
      { directory_status: "circle_visible", bio_visible: true, email_scope: "none", phone_scope: "none" });
    await db.exec("update person_profiles set member_tag='new_member' where person_id=2");
    await db.exec("update person_profiles set member_tag='new_member',city='New City' where person_id=2");
    for (const changed of [null, "renamed_member"]) {
      await assert.rejects(db.query("update person_profiles set member_tag=$1 where person_id=2", [changed]), { code: "P4210" });
    }
    assert.equal((await db.query("select has_function_privilege('anon','private.ruined_lock_member_tag()','execute') as allowed")).rows[0].allowed, false);
    await db.exec("delete from person_profiles where person_id=2");
    assert.equal((await db.query("select count(*)::int as count from person_profiles")).rows[0].count, 1, "deletion retains its existing cleanup path");
  } finally { await db.close(); }
});
