import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migrationPath = "db/migrations/20261001130000_administrator_leadership_access.sql";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const capabilities = ["circle_placement", "circle_exception", "supporter_readiness", "reimbursements"];

test("Administrator inheritance denies every non-admin boundary and preserves historical records", async t => {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema private; create role anon; create role authenticated;
    create table platform_users(auth_user_id uuid primary key,status text);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table leadership_responsibility_grants(auth_user_id uuid,capability text,revoked_at timestamptz);
    create table operator_audit_events(action text,reason text);
  `);
  for (let n = 1; n <= 5; n++) {
    await db.query("insert into platform_users values($1,$2)",[id(n),n === 3 ? "disabled" : "active"]);
  }
  await db.query("insert into platform_role_grants values($1,'ops_admin',null),($2,'ops_admin',now()),($3,'ops_admin',null),($4,'circle_leader',null),($5,'member',null)",
    [id(1),id(2),id(3),id(4),id(5)]);
  // A revoked legacy grant cannot restrict active admin inheritance; an active
  // legacy grant cannot re-authorize a non-admin or disabled/revoked admin.
  for (let n = 1; n <= 5; n++) for (const capability of capabilities) {
    await db.query("insert into leadership_responsibility_grants values($1,$2,$3)",[id(n),capability,n === 1 ? "2026-09-30T00:00:00Z" : null]);
  }
  await db.exec("insert into operator_audit_events values('leadership.responsibility_granted','Historical decision')");
  const snapshot = async () => ({
    grants: (await db.query("select * from leadership_responsibility_grants order by auth_user_id,capability")).rows,
    audit: (await db.query("select * from operator_audit_events")).rows,
    roles: (await db.query("select * from platform_role_grants order by auth_user_id")).rows,
  });
  const before = await snapshot();
  await db.exec(await source(migrationPath));
  assert.deepEqual(await snapshot(),before,"Changing effective authority must not rewrite role, responsibility or audit records");
  const allowed = async (actor,capability) => (await db.query("select private.ruined_has_leadership_responsibility($1,$2) allowed",[actor,capability])).rows[0].allowed;
  for (const capability of capabilities) {
    assert.equal(await allowed(id(1),capability),true,capability);
    for (const actor of [id(2),id(3),id(4),id(5),id(6),null]) {
      assert.equal(await allowed(actor,capability),false,`${actor}: ${capability}`);
    }
  }
  for (const capability of ["all","ops_admin","CIRCLE_PLACEMENT","unknown_future_capability","",null]) {
    assert.equal(await allowed(id(1),capability),false,"Unknown/null capabilities never inherit access");
  }
  await db.exec("delete from leadership_responsibility_grants");
  for (const capability of capabilities) assert.equal(await allowed(id(1),capability),true,"No responsibility record is required");
  await db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1",[id(1)]);
  for (const capability of capabilities) assert.equal(await allowed(id(1),capability),false,"Role revocation is effective immediately");
  await db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1",[id(1)]);
  await db.query("update platform_users set status='disabled' where auth_user_id=$1",[id(1)]);
  for (const capability of capabilities) assert.equal(await allowed(id(1),capability),false,"Inactive accounts do not inherit access");
  for (const role of ["anon","authenticated"]) {
    assert.equal((await db.query("select has_function_privilege($1,'private.ruined_has_leadership_responsibility(uuid,text)','execute') allowed",[role])).rows[0].allowed,false);
  }
  const registry = await source("scripts/migrate-platform.mjs");
  assert.ok(registry.includes(`"../${migrationPath}"`));
  assert.ok(registry.indexOf(migrationPath) > registry.indexOf("20261001120000_public_timeline_posts.sql"));
});
