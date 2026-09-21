import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { installOperatorFundingFunctions } from "./helpers/operator-funding-fixture.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = await read("db/migrations/20260920210000_member_numbers.sql");
const zeroMigration = await read("db/migrations/20260926000000_member_number_zero.sql");
const output = ts.transpileModule(await read("src/lib/membership/member-number.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function("module", "exports", output)(loaded, loaded.exports);
const { memberTier } = loaded.exports;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function fixture(t, migrate = true) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key, status text default 'active');
    create table ruined_members(id uuid primary key,person_id uuid,membership_activated_at timestamptz);
    create table platform_users(auth_user_id uuid primary key,person_id uuid,member_id uuid,status text);
    create table platform_role_grants(id bigint generated always as identity primary key,auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key references ruined_members(id) on delete cascade,
      account_state text default 'active',administrative_onboarding_state text default 'in_progress',billing_state text default 'pending',
      program_state text default 'prospect',standing_state text default 'pre_active',cancellation_effective_at timestamptz,access_started_at timestamptz);
    create table member_onboardings(member_id uuid primary key references ruined_members(id) on delete cascade,
      state text default 'in_progress',completed_at timestamptz,form_version text default 'membership-entry-v1',
      profile_completed_at timestamptz,agreement_completed_at timestamptz,completion_evidence jsonb default '{}');
    create table stripe_invoices(id text primary key,member_id uuid references ruined_members(id) on delete set null,
      purpose text,stripe_status text,amount_paid bigint);
    create table stripe_webhook_events(event_id text primary key,event_type text,object_id text,livemode boolean,status text);
    revoke all on ruined_members from public,anon,authenticated;
  `);
  await installOperatorFundingFunctions(db);
  if (migrate) {
    await db.exec(migration);
    await db.exec(zeroMigration);
  }

  async function add(n, { comped = false, completed = false, access = "2020-01-01", activated = null,
    completedAt = access, historicalComped = false, closed = false, legacy = false } = {}) {
    await db.query("insert into people(id) values($1)", [id(n + 1000)]);
    await db.query("insert into ruined_members(id,person_id,membership_activated_at) values($1,$2,$3)", [id(n), id(n + 1000), activated]);
    await db.query("insert into platform_users values($1,$2,$3,'active')", [id(n + 2000), id(n + 1000), id(n)]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [id(n + 2000)]);
    if (comped) await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [id(n + 2000)]);
    await db.query("insert into member_onboardings(member_id,state,completed_at,completion_evidence,form_version) values($1,$2,$3,$4,$5)",
      [id(n), completed ? "completed" : "in_progress", completed ? completedAt : null, JSON.stringify(historicalComped ? { funding: "operator" } : {}), legacy ? "legacy-v1" : "membership-entry-v1"]);
    await db.query(`insert into member_lifecycle(member_id,account_state,administrative_onboarding_state,program_state,standing_state,access_started_at)
      values($1,$2,$3,$4,$5,$6)`, [id(n), closed ? "closed" : "active", completed ? "completed" : "in_progress",
      completed ? "onboarding" : "prospect", completed ? "active" : "pre_active", completed ? access : null]);
  }
  async function invoice(n, { live = true, status = "processed", amount = 1000, purpose = "membership", suffix = "", paid = true } = {}) {
    const invoiceId = `invoice-${n}${suffix}`, eventId = `event-${n}${suffix}`;
    await db.query("insert into stripe_invoices values($1,$2,$3,$4,$5)", [invoiceId, id(n), purpose, paid ? "paid" : "open", amount]);
    await db.query("insert into stripe_webhook_events values($1,'invoice.paid',$2,$3,$4)", [eventId, invoiceId, live, status]);
    return eventId;
  }
  async function complete(n, engine = db) {
    await engine.query("update member_onboardings set state='completed',completed_at='2020-01-01',profile_completed_at='2020-01-01',agreement_completed_at='2020-01-01' where member_id=$1", [id(n)]);
    await engine.query("update member_lifecycle set administrative_onboarding_state='completed',program_state='onboarding',standing_state='active',access_started_at='2020-01-01' where member_id=$1", [id(n)]);
  }
  const number = async n => (await db.query("select member_number from ruined_members where id=$1", [id(n)])).rows[0]?.member_number ?? null;
  const counter = async () => (await db.query("select last_number from private.member_number_counter")).rows[0].last_number;
  return { db, add, invoice, complete, number, counter };
}

test("tiers use exact approved ranges, pad without truncating, and never invent a missing number", () => {
  for (const [number, label] of [[0,"Founders"],[1,"Founders"],[5,"Founders"],[6,"Originals"],[50,"Originals"],[51,"Pillars"],[100,"Pillars"],[101,"Builders"],[200,"Builders"],[201,"Members"],[10000,"Members"]]) {
    assert.deepEqual(memberTier(number), { label, displayNumber: String(number).padStart(4, "0") });
  }
  for (const invalid of [null,undefined,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,"1"]) assert.equal(memberTier(invalid), null);
});

test("zero-number migration preserves assigned places and guards; assigned zero is permanent", async t => {
  const { db, add, complete, number, counter } = await fixture(t, false);
  await add(1, { comped: true, completed: true });
  await db.exec(migration);
  const before = (await db.query("select * from private.member_number_assignments order by member_number")).rows;
  const guardState = async () => (await db.query(`select tgname,tgenabled from pg_trigger
    where not tgisinternal and tgname in ('ruined_members_member_number_guard','member_number_assignment_guard','member_number_counter_guard')
    order by tgname`)).rows;
  const guards = await guardState();
  await db.exec(zeroMigration);
  assert.deepEqual((await db.query("select * from private.member_number_assignments order by member_number")).rows, before);
  assert.deepEqual(await guardState(), guards);
  assert.equal(await number(1), 1);
  assert.equal(await counter(), 1);

  await add(2, { comped: true });
  await db.query("insert into private.member_number_assignments(member_number,member_id,activated_at) values(0,$1,'2020-01-01')", [id(2)]);
  await db.query("update ruined_members set member_number=0 where id=$1", [id(2)]);
  await complete(2);
  assert.equal(await number(2), 0);
  assert.equal(await counter(), 1, "zero must be recognized as an existing assignment");
  for (const value of [null,2,-1]) {
    await assert.rejects(db.query("update ruined_members set member_number=$1 where id=$2", [value,id(2)]), /permanent/);
  }
  await assert.rejects(db.exec("insert into private.member_number_assignments(member_number,activated_at) values(-1,'2020-01-01')"), { code: "23514" });
  await assert.rejects(db.exec("insert into private.member_number_assignments(member_number,activated_at) values(0,'2020-01-01')"), { code: "23505" });
  await assert.rejects(db.exec("delete from private.member_number_assignments where member_number=0"), /cannot be reused/);
  await db.query("delete from ruined_members where id=$1", [id(2)]);
  assert.equal((await db.query("select member_id from private.member_number_assignments where member_number=0")).rows[0].member_id, null);
  await add(3, { comped: true });
  await complete(3);
  assert.equal(await number(3), 2);
});

test("founder places 0000 through 0004 retain reserved 0005; the next member gets 0006 transactionally", async t => {
  const { db, add, complete, number, counter } = await fixture(t);
  // Seed the authorized correction's final state through the same guarded
  // ledger linkage used by normal allocation. No immutable guard is bypassed.
  for (let founder = 1; founder <= 5; founder++) {
    await add(founder, { comped: true });
    await db.query("insert into private.member_number_assignments(member_number,member_id,activated_at) values($1,$2,'2020-01-01')", [founder - 1,id(founder)]);
    await db.query("update ruined_members set member_number=$1 where id=$2", [founder - 1,id(founder)]);
    await db.exec("update private.member_number_counter set last_number=last_number+1 where singleton");
  }
  await db.exec("insert into private.member_number_assignments(member_number,activated_at) values(5,'2020-01-01')");
  const reservations = (await db.query("select member_number,member_id from private.member_number_assignments order by member_number")).rows;
  assert.deepEqual(reservations.map(row => row.member_number), [0,1,2,3,4,5]);
  assert.equal(reservations[5].member_id, null);
  assert.equal(await counter(), 5);
  await complete(1);
  assert.equal(await number(1), 0);
  assert.equal(await counter(), 5);

  await add(6, { comped: true });
  await assert.rejects(db.transaction(async tx => {
    await complete(6, tx);
    assert.equal((await tx.query("select member_number from ruined_members where id=$1", [id(6)])).rows[0].member_number, 6);
    throw new Error("FOUNDER_ALLOCATION_ROLLBACK");
  }), /FOUNDER_ALLOCATION_ROLLBACK/);
  assert.equal(await number(6), null);
  assert.equal(await counter(), 5);
  assert.deepEqual((await db.query("select member_number,member_id from private.member_number_assignments order by member_number")).rows, reservations);
  await complete(6);
  await complete(6);
  assert.equal(await number(6), 6);
  assert.equal(await counter(), 6);
  assert.deepEqual((await db.query("select member_number,member_id from private.member_number_assignments where member_number<=5 order by member_number")).rows, reservations);
});

test("backfill orders actual completed access deterministically, preserves historical comped members and excludes pending/test/unknown dates", async t => {
  const { db, add, invoice, number, counter } = await fixture(t, false);
  await add(1, { comped: true, completed: true, access: "2020-01-03", activated: "2010-01-01" });
  await add(3, { completed: true, access: "2020-01-01" }); await invoice(3);
  await add(2, { completed: true, access: "2020-01-01" }); await invoice(2);
  await add(4, { completed: true, access: "2020-01-02", historicalComped: true, closed: true, legacy: true });
  await add(5, { completed: true, access: "2010-01-01" }); await invoice(5, { live: false });
  await add(6, { comped: true });
  await add(7, { activated: "2010-01-01" }); await invoice(7);
  await add(8, { comped: true, completed: true, access: "2999-01-01" });
  await add(9, { comped: true, completed: true, access: null, completedAt: null });
  await add(10, { completed: true, access: "2000-01-01", legacy: true });
  await add(11, { comped: true, completed: true, access: "-infinity" });
  await add(12, { comped: true, completed: true, access: null, completedAt: "2019-01-01" });
  await add(13, { completed: true, access: "2020-01-04" }); await invoice(13, { amount: 0 });
  await db.exec(migration);
  for (const [member, expected] of [[12,1],[2,2],[3,3],[4,4],[1,5],[13,6]]) assert.equal(await number(member), expected);
  for (const member of [5,6,7,8,9,10,11]) assert.equal(await number(member), null, String(member));
  assert.equal(await counter(), 6);
  assert.equal((await db.query("select profile_completed_at from member_onboardings where member_id=$1", [id(4)])).rows[0].profile_completed_at, null);
});

test("billing or staff provisioning alone consume nothing; completed live processing and complimentary entry allocate once", async t => {
  const { db, add, invoice, complete, number, counter } = await fixture(t);
  await add(1, { activated: "2010-01-01" }); await invoice(1, { status: "processing", amount: 0 });
  await db.query("update member_lifecycle set billing_state='active' where member_id=$1", [id(1)]);
  assert.equal(await number(1), null);
  await add(2, { comped: true }); assert.equal(await counter(), 0);
  await complete(1); assert.equal(await number(1), 1);
  await db.exec("update stripe_webhook_events set status='processed'");
  assert.equal(await counter(), 1, "processed event retry must not allocate twice");
  await complete(2); assert.equal(await number(2), 2);
  assert.equal((await db.query("select membership_activated_at from ruined_members where id=$1", [id(2)])).rows[0].membership_activated_at, null);
  await complete(2); assert.equal(await counter(), 2);
});

test("test-only completion stays unnumbered until a real live paid event, including a fully discounted invoice", async t => {
  const { db, add, invoice, complete, number, counter } = await fixture(t);
  await add(1); await invoice(1, { live: false });
  await db.query("update member_lifecycle set billing_state='active' where member_id=$1", [id(1)]);
  await complete(1); assert.equal(await number(1), null);
  const liveEvent = await invoice(1, { status: "processing", suffix: "-live", amount: 0 });
  assert.equal(await number(1), null);
  await db.query("update stripe_webhook_events set status='processed' where event_id=$1", [liveEvent]);
  assert.equal(await number(1), 1);
  await db.query("update stripe_webhook_events set status='processed' where event_id=$1", [liveEvent]);
  assert.equal(await counter(), 1);
  await add(2); await invoice(2, { purpose: "consulting" });
  await db.query("update member_lifecycle set billing_state='active' where member_id=$1", [id(2)]);
  await complete(2); assert.equal(await number(2), null);
  await add(3); await invoice(3, { paid: false });
  await db.query("update member_lifecycle set billing_state='active' where member_id=$1", [id(3)]);
  await complete(3); assert.equal(await number(3), null);
});

test("failed activation rolls back counter and assignment; competing completed entries receive contiguous unique places", async t => {
  const { db, add, complete, number, counter } = await fixture(t);
  await add(1, { comped: true }); await add(2, { comped: true }); await add(3, { comped: true });
  await assert.rejects(db.transaction(async tx => { await complete(1, tx); throw new Error("ROLLBACK_FIXTURE"); }), /ROLLBACK_FIXTURE/);
  assert.equal(await number(1), null); assert.equal(await counter(), 0);
  assert.equal((await db.query("select count(*)::integer as count from private.member_number_assignments")).rows[0].count, 0);
  await add(4);
  await assert.rejects(db.transaction(async tx => {
    await tx.query("insert into stripe_invoices values('rollback-invoice',$1,'membership','paid',0)", [id(4)]);
    await tx.exec("insert into stripe_webhook_events values('rollback-event','invoice.paid','rollback-invoice',true,'processing')");
    await tx.query("update member_lifecycle set billing_state='active' where member_id=$1", [id(4)]);
    await complete(4, tx);
    assert.equal((await tx.query("select member_number from ruined_members where id=$1", [id(4)])).rows[0].member_number, 1);
    throw new Error("PAID_ROLLBACK_FIXTURE");
  }), /PAID_ROLLBACK_FIXTURE/);
  assert.equal(await number(4), null); assert.equal(await counter(), 0);
  assert.equal((await db.query("select count(*)::integer as count from stripe_webhook_events where event_id='rollback-event'")).rows[0].count, 0);
  await Promise.all([1,2,3].map(member => db.transaction(tx => complete(member, tx))));
  assert.deepEqual((await db.query("select member_number from ruined_members where member_number is not null order by member_number")).rows.map(row => row.member_number), [1,2,3]);
  assert.equal(await counter(), 3);
});

test("numbers survive cancellation and rejoin; deletion reserves the place and direct forced changes fail", async t => {
  const { db, add, complete, number, counter } = await fixture(t);
  await add(1, { comped: true }); await complete(1);
  await add(2, { comped: true }); await complete(2);
  await db.query("update member_lifecycle set account_state='closed',standing_state='inactive',billing_state='ended' where member_id=$1", [id(1)]);
  assert.equal(await number(1), 1);
  await db.query("update member_lifecycle set account_state='active',standing_state='active' where member_id=$1", [id(1)]);
  assert.equal(await number(1), 1);
  for (const value of [null,9,0,-1]) await assert.rejects(db.query("update ruined_members set member_number=$1 where id=$2", [value,id(1)]), /permanent/);
  await add(3);
  await assert.rejects(db.query("update ruined_members set member_number=99 where id=$1", [id(3)]), /allocation/);
  await assert.rejects(db.query("insert into ruined_members(id,member_number) values($1,99)", [id(99)]), /allocation/);
  await assert.rejects(db.exec("delete from private.member_number_assignments"), /cannot be reused/);
  await assert.rejects(db.exec("update private.member_number_counter set last_number=0"), /one place/);
  await db.query("delete from ruined_members where id=$1", [id(1)]);
  assert.equal((await db.query("select member_id from private.member_number_assignments where member_number=1")).rows[0].member_id, null);
  assert.equal(await number(2), 2); assert.equal(await counter(), 2);
  await add(4, { comped: true }); await complete(4);
  assert.equal(await number(4), 3);
});

test("private allocation storage and functions deny browser roles", async t => {
  const { db } = await fixture(t);
  const rows = (await db.query("select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='private' and relname in ('member_number_assignments','member_number_counter')")).rows;
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.relrowsecurity));
  for (const role of ["anon","authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const query of ["select * from private.member_number_assignments","select * from private.member_number_counter","select private.ruined_allocate_member_number('00000000-0000-4000-8000-000000000001')","update ruined_members set member_number=0","insert into private.member_number_assignments(member_number,activated_at) values(0,now())"]) {
      await assert.rejects(db.exec(query), { code: "42501" });
    }
    await db.exec("reset role");
  }
  const grants = (await db.query(`select count(*)::integer as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where n.nspname='private' and p.proname like '%member_number%'
    and acl.grantee=0 and acl.privilege_type='EXECUTE'`)).rows[0].count;
  assert.equal(grants, 0);
});
