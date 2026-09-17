import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const migrationPath = "db/migrations/20260915174319_circle_shaper_admin_eligibility.sql";
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const ids = { admin: uuid(1), guide: uuid(2), member: uuid(3), shaper: uuid(4), inactive: uuid(5), revoked: uuid(6), otherAdmin: uuid(7), circle: uuid(10), otherCircle: uuid(11) };

function tableFrom(sql, table) {
  const match = sql.match(new RegExp(`create table if not exists (?:public\\.)?${table} \\([\\s\\S]*?\\n\\);`));
  assert.ok(match, `The shipped ${table} table is present`);
  return match[0];
}

function functionFrom(sql, name) {
  const match = sql.match(new RegExp(`create or replace function private\\.${name}\\(\\)[\\s\\S]*?\\n\\$\\$;`));
  assert.ok(match, `The shipped ${name} function is present`);
  return match[0];
}

async function fixture(context, { migrate = true } = {}) {
  // In-memory PostgreSQL only. This fixture never reads DATABASE_URL or connects
  // to Supabase, and it uses the shipped tables, constraints, indexes and guards.
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  context.after(() => db.close());
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const shapers = await source("db/migrations/20260828_circle_shaper_resources.sql");
  const indexes = foundation.match(/create unique index if not exists circle_staff_assignments_one_active_role_idx[\s\S]*?where role_slug = 'circle_leader' and ended_at is null;/);
  const triggers = shapers.match(/drop trigger if exists circle_staff_assignments_validate[\s\S]*?revoke all on function private\.ruined_guard_circle_staff_assignment_mutation\(\)\s+from public, anon, authenticated;/);
  assert.ok(indexes);
  assert.ok(triggers);
  await db.exec(`
    create role anon; create role authenticated; create role untrusted_probe;
    create schema private;
    revoke all on schema private from public, anon, authenticated;
    create table ruined_members (id uuid primary key);
    ${["platform_users", "platform_roles", "platform_role_grants", "circles", "circle_staff_assignments"].map((table) => tableFrom(foundation, table)).join("\n")}
    alter table circle_staff_assignments add column ended_by_auth_user_id uuid references platform_users(auth_user_id) on delete set null;
    ${indexes[0]}
    ${functionFrom(shapers, "ruined_validate_circle_staff_assignment")}
    ${functionFrom(shapers, "ruined_guard_circle_staff_assignment_mutation")}
    ${triggers[0]}
    alter table circle_staff_assignments enable row level security;
    revoke all on platform_users, platform_role_grants, circles, circle_staff_assignments from public, anon, authenticated;
    insert into platform_roles(role_slug, display_name) values
      ('ops_admin','Administrator'),('guide','Guide'),('member','Member'),('circle_leader','Shaper');
    insert into circles(id,name,slug) values ('${ids.circle}','Circle 01','circle-01'),('${ids.otherCircle}','Circle 02','circle-02');
  `);
  for (const [name, role] of [["admin", "ops_admin"], ["guide", "guide"], ["member", "member"], ["shaper", "circle_leader"], ["inactive", "ops_admin"], ["revoked", "ops_admin"], ["otherAdmin", "ops_admin"]]) {
    await db.query("insert into platform_users(auth_user_id,email_normalized,status) values ($1,$2,$3)", [ids[name], `${name.toLowerCase()}@example.test`, name === "inactive" ? "suspended" : "active"]);
    // Use one database timestamp so revocation cannot precede the grant.
    await db.query("insert into platform_role_grants(auth_user_id,role_slug,granted_at,revoked_at) values ($1,$2,statement_timestamp(),case when $3 then statement_timestamp() end)", [ids[name], role, name === "revoked"]);
  }
  if (migrate) await db.exec(await source(migrationPath));
  const assign = async (authUserId, role = "circle_leader", circleId = ids.circle) => (await db.query(`
    insert into circle_staff_assignments(circle_id,auth_user_id,role_slug,assigned_by_auth_user_id)
    values ($1,$2,$3,$4) returning *
  `, [circleId, authUserId, role, ids.admin])).rows[0];
  const grants = async () => (await db.query("select * from platform_role_grants order by id")).rows;
  return { db, assign, grants };
}

test("additive Shaper migration changes only the matching-role predicate and remains in the checksum runner", async () => {
  const before = functionFrom(await source("db/migrations/20260828_circle_shaper_resources.sql"), "ruined_validate_circle_staff_assignment");
  const migration = await source(migrationPath);
  const expected = before.replace("and role_grant.role_slug = new.role_slug", `and (
       role_grant.role_slug = new.role_slug
       or (new.role_slug = 'circle_leader' and role_grant.role_slug = 'ops_admin')
     )`);
  assert.equal(functionFrom(migration, "ruined_validate_circle_staff_assignment"), expected);
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('ruined-platform-migration-runner'\)\)/);
  assert.doesNotMatch(migration, /\b(?:insert into|update public\.|delete from|alter table|create policy|grant execute|grant all)\b/i);
  const runner = await source("scripts/migrate-platform.mjs");
  assert.equal(runner.split(migrationPath).length - 1, 1);
});

test("real old trigger rejects an Administrator; the new trigger permits Shaper staffing with grants unchanged", async (context) => {
  const { db, assign, grants } = await fixture(context, { migrate: false });
  const before = await grants();
  await assert.rejects(assign(ids.admin), /active matching platform role/);
  await db.exec(await source(migrationPath));
  const assignment = await assign(ids.admin);
  assert.equal(assignment.auth_user_id, ids.admin);
  assert.equal(assignment.circle_id, ids.circle);
  assert.equal(assignment.role_slug, "circle_leader");
  assert.deepEqual(await grants(), before, "staffing must not revoke, replace or duplicate platform grants");
  assert.deepEqual((await grants()).filter((grant) => grant.auth_user_id === ids.admin).map((grant) => grant.role_slug), ["ops_admin"]);
});

test("ordinary members and Guides cannot become Shapers, and Administrator scope does not extend to Guide staffing", async (context) => {
  const { assign, db } = await fixture(context);
  for (const [id, role] of [[ids.member, "circle_leader"], [ids.guide, "circle_leader"], [ids.admin, "guide"], [ids.admin, "ops_admin"], [ids.member, "guide"]]) {
    await assert.rejects(assign(id, role), /active matching platform role/);
  }
  assert.equal((await db.query("select count(*)::int as count from circle_staff_assignments")).rows[0].count, 0);
  assert.equal((await assign(ids.shaper)).role_slug, "circle_leader", "existing exact Shaper authority still works");
  assert.equal((await assign(ids.guide, "guide")).role_slug, "guide", "existing exact Guide authority still works");
});

test("suspended, disabled, invited, revoked and nonexistent accounts remain ineligible despite admin role names", async (context) => {
  const { assign, db } = await fixture(context);
  for (const status of ["suspended", "disabled", "invited"]) {
    await db.query("update platform_users set status=$1 where auth_user_id=$2", [status, ids.inactive]);
    await assert.rejects(assign(ids.inactive), /active matching platform role/);
  }
  await assert.rejects(assign(ids.revoked), /active matching platform role/);
  await assert.rejects(assign(uuid(99)), /active matching platform role/);
  // Authority is specific to the assigned user: another user's active grant
  // and this user's revoked matching grant cannot be combined to pass.
  await db.query("insert into platform_role_grants(auth_user_id,role_slug,revoked_at) values ($1,'circle_leader',statement_timestamp())", [ids.member]);
  await assert.rejects(assign(ids.member), /active matching platform role/);
  assert.equal((await db.query("select count(*)::int as count from circle_staff_assignments")).rows[0].count, 0);
});

test("Circle foreign keys, one-Shaper uniqueness and immutable staffing history remain enforced", async (context) => {
  const { db, assign } = await fixture(context);
  await assert.rejects(assign(ids.admin, "circle_leader", uuid(98)), (error) => error.code === "23503");
  const current = await assign(ids.admin);
  await assert.rejects(assign(ids.otherAdmin), (error) => error.code === "23505");
  await assert.rejects(db.query("update circle_staff_assignments set circle_id=$1 where id=$2", [ids.otherCircle, current.id]), /Only Circle staff assignment closure fields/);
  await assert.rejects(db.query("update circle_staff_assignments set auth_user_id=$1 where id=$2", [ids.otherAdmin, current.id]), /Only Circle staff assignment closure fields/);
  await assert.rejects(db.query("delete from circle_staff_assignments where id=$1", [current.id]), /history cannot be deleted/);
  await db.query("update platform_role_grants set revoked_at=statement_timestamp() where auth_user_id=$1", [ids.admin]);
  await db.query("update circle_staff_assignments set ended_at=statement_timestamp(),end_reason='Shaper changed' where id=$1", [current.id]);
  await assert.rejects(db.query("update circle_staff_assignments set ended_at=null where id=$1", [current.id]), /closed Circle staff assignment is immutable/);
  assert.equal((await assign(ids.otherAdmin)).auth_user_id, ids.otherAdmin);
  assert.equal((await db.query("select count(*)::int as count from circle_staff_assignments")).rows[0].count, 2);
});

test("reapplying the migration preserves rows, RLS, private search path and revoked client execution privileges", async (context) => {
  const { db, assign, grants } = await fixture(context);
  await assign(ids.admin);
  const rowsBefore = (await db.query("select * from circle_staff_assignments order by id")).rows;
  const grantsBefore = await grants();
  await db.exec(await source(migrationPath));
  assert.deepEqual((await db.query("select * from circle_staff_assignments order by id")).rows, rowsBefore);
  assert.deepEqual(await grants(), grantsBefore);
  const functionMetadata = (await db.query("select prosecdef,proconfig from pg_proc where oid='private.ruined_validate_circle_staff_assignment()'::regprocedure")).rows[0];
  assert.equal(functionMetadata.prosecdef, true, "existing internal trigger privilege mode is preserved, not newly introduced");
  assert.deepEqual(functionMetadata.proconfig, ['search_path=""']);
  for (const role of ["anon", "authenticated", "untrusted_probe"]) {
    const permissions = (await db.query(`select
      has_function_privilege($1,'private.ruined_validate_circle_staff_assignment()','EXECUTE') as execute,
      has_table_privilege($1,'public.circle_staff_assignments','INSERT') as insert,
      has_table_privilege($1,'public.circle_staff_assignments','UPDATE') as update,
      has_table_privilege($1,'public.circle_staff_assignments','DELETE') as delete
    `, [role])).rows[0];
    assert.deepEqual(permissions, { execute: false, insert: false, update: false, delete: false });
  }
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.circle_staff_assignments'::regclass")).rows[0].relrowsecurity, true);
  assert.equal((await db.query("select count(*)::int as count from pg_policies where tablename='circle_staff_assignments'")).rows[0].count, 0);
});
