import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { memberTier } from "../src/lib/membership/member-number.ts";

test("retired leadership titles preserve history and signup cohorts but cannot receive new assignments", async (context) => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite(); context.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table platform_roles(role_slug text primary key, display_name text);
    insert into platform_roles values ('circle_leader','Shaper'),('guide','Guide');
    create table membership_progression_levels(slug text primary key,display_name text,status text default 'active',updated_at timestamptz default now());
    insert into membership_progression_levels(slug,display_name) values ('member','Member'),('shaper','Shaper'),('builder','Builder'),('author','Author'),('partner','Partner');
    create table member_progression_assignments(id int primary key,progression_level_slug text references membership_progression_levels(slug));
    insert into member_progression_assignments values (1,'builder'),(2,'author'),(3,'partner');
  `);
  await db.exec(await readFile(new URL("../db/migrations/20260930103000_leadership_terminology.sql", import.meta.url), "utf8"));
  assert.deepEqual((await db.query("select progression_level_slug from member_progression_assignments order by id")).rows.map(row => row.progression_level_slug), ["builder", "author", "partner"]);
  assert.deepEqual((await db.query("select slug from membership_progression_levels where status='retired' order by slug")).rows.map(row => row.slug), ["author", "builder", "partner"]);
  for (const slug of ["builder", "author", "partner"]) await assert.rejects(db.query("insert into member_progression_assignments values (4,$1)", [slug]), /title is retired/);
  await db.exec("insert into member_progression_assignments values(4,'member')");
  assert.equal((await db.query("select display_name from platform_roles where role_slug='circle_leader'")).rows[0].display_name, "Circle Supporter");
  assert.equal(memberTier(101).label, "Builders");
  assert.equal(memberTier(200).label, "Builders");
  assert.equal(memberTier(201).label, "Members");
});
