import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const admin = "11111111-1111-4111-8111-111111111111";
const guide = "22222222-2222-4222-8222-222222222222";
const circle = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = (index) => `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
async function load(path, dependencies) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

test("member search uses saved names, visible statuses and paginated results without widening operator permissions", async (t) => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create table platform_users (auth_user_id uuid primary key, member_id uuid, status text);
    create table platform_role_grants (auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table ruined_members (id uuid primary key, person_id uuid, email text, membership_state text, created_at timestamptz default now());
    create table member_lifecycle (member_id uuid primary key, account_state text, billing_state text, standing_state text, program_state text, foundations_state text, artifact_state text);
    create table user_profiles (auth_user_id uuid primary key, display_name text);
    create table person_profiles (person_id uuid primary key, preferred_name text, display_name text);
    create table person_private_profiles (person_id uuid primary key, legal_name text);
    create table circles (id uuid primary key, name text, status text);
    create table circle_member_assignments (circle_id uuid, member_id uuid, assigned_at timestamptz default now(), ended_at timestamptz);
    create table circle_staff_assignments (circle_id uuid, auth_user_id uuid, ended_at timestamptz);
    create table membership_blocks (id uuid primary key, name text, status text);
    create table block_circle_assignments (block_id uuid, circle_id uuid, ended_at timestamptz);
    create table foundation_programs (id uuid primary key, slug text);
    create table foundation_versions (id uuid primary key, foundation_program_id uuid);
    create table foundation_enrollments (member_id uuid, foundation_version_id uuid, progress_percent numeric, created_at timestamptz);
  `);
  await db.query("insert into platform_users (auth_user_id,status) values ($1,'active'),($2,'active')", [admin, guide]);
  await db.query("insert into platform_role_grants values ($1,'ops_admin',null),($2,'guide',null)", [admin, guide]);
  await db.query("insert into circles values ($1,'Circle 01','active')", [circle]);
  for (let n = 1; n <= 30; n++) {
    await db.query("insert into ruined_members(id,person_id,email,membership_state) values ($1,$1,$2,'active')", [id(n), `member${n}@example.test`]);
    await db.query("insert into member_lifecycle values ($1,'active','active','active','onboarding','in_progress','not_started')", [id(n)]);
    await db.query("insert into person_profiles values ($1,$2,$3)", [id(n), n === 1 ? "Taelor" : `Person ${n}`, n === 1 ? "Tae Public" : `Member ${n}`]);
    await db.query("insert into person_private_profiles values ($1,$2)", [id(n), n === 1 ? "Taelor Mangelson" : `Private ${n}`]);
  }
  const queries = [];
  function wrap(engine) {
    const sql = async (parts, ...values) => {
      const query = parts.reduce((result, part, n) => result + (n ? `$${n}` : "") + part, "");
      assert.match(query.trim(), /^select\s/i, "the search reader must never mutate records");
      queries.push(query);
      return (await engine.query(query, values)).rows;
    };
    sql.begin = (mode, callback) => {
      assert.equal(mode, "isolation level repeatable read read only");
      return engine.transaction((tx) => callback(wrap(tx)));
    };
    return sql;
  }
  const model = await load("src/lib/platform/model.ts", {});
  const repository = await load("src/lib/platform/repository.ts", {
    "server-only": {}, "@/lib/platform/model": model,
    "@/lib/identity/repository": {}, "@/lib/platform/calendar-audience-invalidation": {},
    "@/lib/stripe/membership-state": {}, "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) },
  });
  const search = (query, options = {}, actor = admin) => repository.getOperatorMemberDirectoryPage(actor, { query, ...options });
  await t.test("preferred, public, full and email searches match even before a user profile exists", async () => {
    for (const query of ["  TAE  ", "Tae Public", "MANGELSON", "member1@example.test"]) {
      const result = await search(query);
      assert.equal(result.totalResults, 1);
      assert.equal(result.members[0].name, "Taelor");
      assert.equal(result.members[0].memberId, id(1));
      assert.equal(result.members[0].membershipState, "active");
      assert.equal(JSON.stringify(result.members).includes("Mangelson"), false, "private full name is searchable by Admin, not copied into the result payload");
    }
    assert.equal((await search("%' OR true --")).totalResults, 0);
  });
  await t.test("unavailable and assigned people remain findable with their real state", async () => {
    await db.query("update member_lifecycle set account_state='invited', billing_state='pending' where member_id=$1", [id(1)]);
    assert.equal((await search("tae")).members[0].accountState, "invited");
    assert.equal((await search("tae", { filter: "unassigned" })).totalResults, 0);
    await db.query("update member_lifecycle set account_state='active', billing_state='active' where member_id=$1", [id(1)]);
    await db.query("insert into circle_member_assignments(circle_id,member_id) values($1,$2)", [circle, id(1)]);
    assert.equal((await search("tae")).members[0].circleName, "Circle 01");
    assert.equal((await search("tae", { filter: "unassigned" })).totalResults, 0);
    await db.query("update circles set status='forming' where id=$1", [circle]);
    assert.equal((await search("tae", { filter: "unassigned" })).totalResults, 0, "a member already placed in a forming Circle is not unassigned");
  });
  await t.test("count and pages use the same filter and names", async () => {
    const first = await search("example.test");
    const second = await search("example.test", { page: 2 });
    assert.equal(first.totalResults, 30);
    assert.equal(first.pageCount, 2);
    assert.equal(first.members.length, 25);
    assert.equal(second.members.length, 5);
    assert.equal(new Set([...first.members, ...second.members].map((member) => member.memberId)).size, 30);
  });
  await t.test("scoped operators cannot infer private names, emails or people outside their Circle", async () => {
    assert.equal((await search("tae", {}, guide)).totalResults, 0);
    await db.query("insert into circle_staff_assignments values($1,$2,null)", [circle, guide]);
    assert.equal((await search("tae", {}, guide)).members[0].email, "");
    assert.equal((await search("Mangelson", {}, guide)).totalResults, 0);
    assert.equal((await search("member1@example.test", {}, guide)).totalResults, 0);
    assert.equal((await search("Person 2", {}, guide)).totalResults, 0);
    await db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [guide]);
    assert.equal(await search("tae", {}, guide), null);
    assert.ok(queries.every((query) => !/^\s*(insert|update|delete)/i.test(query)));
  });
});
