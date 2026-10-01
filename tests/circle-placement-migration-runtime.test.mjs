import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function fixture(t) {
  const DB = await loadPGliteForSchemaChecks(); const db = new DB(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table platform_users(auth_user_id uuid primary key, person_id uuid, status text not null default 'active');
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table ruined_members(id uuid primary key, person_id uuid);
    create table circles(id uuid primary key, capacity int not null default 10, updated_at timestamptz);
    create table circle_member_assignments(id bigint generated always as identity primary key, member_id uuid references ruined_members, circle_id uuid references circles, assigned_by_auth_user_id uuid references platform_users, ended_at timestamptz);
    create table circle_staff_assignments(circle_id uuid, auth_user_id uuid, role_slug text, ended_at timestamptz);
  `);
  await db.exec(await source("db/migrations/20261001130000_administrator_leadership_access.sql"));
  await db.exec(await source("db/migrations/20260930101000_circle_placement.sql"));
  await db.exec(`create trigger circle_member_assignments_capacity before insert or update of circle_id,ended_at on circle_member_assignments for each row execute function public.ruined_enforce_circle_capacity();`);
  const actor = randomUUID(), circle = randomUUID();
  await db.query("insert into platform_users(auth_user_id) values($1)", [actor]);
  await db.query("insert into circles(id) values($1)", [circle]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [actor]);
  async function newMember() { const id = randomUUID(); await db.query("insert into ruined_members values($1,$1)", [id]); return id; }
  async function place(member = null) { const id = member ?? await newMember(); await db.query("insert into circle_member_assignments(member_id,circle_id,assigned_by_auth_user_id) values($1,$2,$3)", [id,circle,actor]); return id; }
  async function approve(member, projectedCount = 13) { const result = await db.query("insert into circle_placement_reviews(member_id,circle_id,requested_by_auth_user_id,reason,status,reviewed_by_auth_user_id,reviewed_at,projected_count) values($1,$2,$3,'Reviewed connection and meeting compatibility','approved',$3,statement_timestamp(),$4) returning id",[member,circle,actor,projectedCount]); return result.rows[0].id; }
  return { db, actor, circle, place, approve, newMember };
}
test("migration leaves target 10 but accepts 12, denies unreviewed 13th, consumes a matching exception once", async t => {
  const f = await fixture(t);
  for (let i=0;i<12;i++) await f.place();
  const member = await f.newMember();
  await assert.rejects(f.place(member), /requires a current exception review/);
  assert.equal((await f.db.query("select capacity from circles")).rows[0].capacity, 10);
  const reviewId = await f.approve(member); await f.place(member);
  assert.equal((await f.db.query("select status from circle_placement_reviews where id=$1",[reviewId])).rows[0].status, "placed");
  await assert.rejects(f.place(), /requires a current exception review/);
});
test("stale counts, pending reviews, revoked reviewer and mismatched member cannot authorize overrange writes", async t => {
  const f = await fixture(t); for(let i=0;i<12;i++) await f.place();
  const member = await f.newMember(); const reviewId = await f.approve(member,14);
  await assert.rejects(f.place(member), /requires a current exception review/);
  await f.db.query("update circle_placement_reviews set projected_count=13,status='pending',reviewed_at=null,reviewed_by_auth_user_id=null where id=$1",[reviewId]);
  await assert.rejects(f.place(member), /requires a current exception review/);
  await f.db.query("update circle_placement_reviews set status='approved',reviewed_at=statement_timestamp(),reviewed_by_auth_user_id=$2 where id=$1",[reviewId,f.actor]);
  await assert.rejects(f.place(), /requires a current exception review/);
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='ops_admin'",[f.actor]);
  await assert.rejects(f.place(member), /requires a current exception review/);
});
test("Supporter is counted once when also a member, and a legacy staff-only person is still counted", async t => {
  const f = await fixture(t); const member = await f.place(); const staff = randomUUID();
  await f.db.query("insert into platform_users(auth_user_id,person_id) values($1,$2)",[staff,member]);
  await f.db.query("insert into circle_staff_assignments values($1,$2,'circle_leader',null)",[f.circle,staff]);
  assert.equal((await f.db.query("select private.ruined_circle_participant_count($1) as count",[f.circle])).rows[0].count,1);
  const staffOnly = randomUUID(); await f.db.query("insert into platform_users(auth_user_id,person_id) values($1,$1)",[staffOnly]);
  await f.db.query("insert into circle_staff_assignments values($1,$2,'circle_leader',null)",[f.circle,staffOnly]);
  assert.equal((await f.db.query("select private.ruined_circle_participant_count($1) as count",[f.circle])).rows[0].count,2);
});
test("private preference/review tables deny browser database access and story length is bounded", async t => {
  const f = await fixture(t);
  const rows = (await f.db.query("select table_name,privilege_type from information_schema.role_table_grants where grantee in ('anon','authenticated','PUBLIC') and table_name in ('member_circle_preferences','circle_placement_reviews')")).rows;
  assert.equal(rows.length,0);
  await assert.rejects(f.db.query("update circles set story=$1",['a'.repeat(2001)]),/check constraint/);
});
