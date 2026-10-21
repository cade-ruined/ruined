import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = await read("db/migrations/20261021191000_cade_communications_work.sql");
async function fixture(t, { status = "active", verified = true, role = true } = {}) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema private; create table people(id uuid primary key,status text);
    create table ruined_members(id uuid primary key,person_id uuid,unique(id,person_id));
    create table platform_users(auth_user_id uuid primary key,person_id uuid,email_normalized text,status text);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table person_email_addresses(person_id uuid,email_normalized text,verification_state text,retired_at timestamptz);
    create table circles(id uuid primary key); create table membership_blocks(id uuid primary key);`);
  const schema = await read("db/migrations/20260826_membership_operating_spine_05_content_operations.sql");
  await db.exec(schema.slice(schema.indexOf("create table if not exists public.operator_tasks ("), schema.indexOf("-- Overrides are immutable")));
  const id = randomUUID();
  await db.query("insert into people values($1,'active');", [id]);
  await db.query("insert into platform_users values($1,$1,'libby@theruinedproject.com',$2)", [id,status]);
  await db.query("insert into person_email_addresses values($1,'libby@theruinedproject.com',$2,null)", [id,verified ? "verified" : "unverified"]);
  if (role) await db.query("insert into platform_role_grants values($1,'ops_admin',null)", [id]);
  return { db,id,apply: () => db.exec(migration) };
}
test("CADE review migration assigns one complete task per held decision to the verified administrator", async t => {
  const f=await fixture(t); await f.apply();
  const tasks=(await f.db.query("select * from operator_tasks order by idempotency_key")).rows;
  assert.equal(tasks.length,12); assert.ok(tasks.every(x=>x.assigned_to_auth_user_id===f.id && x.created_by_type==='system' && x.created_by_auth_user_id===null && x.status==='open'));
  const missed=tasks.filter(x=>x.idempotency_key.endsWith(':missed-incomplete')); assert.equal(missed.length,1);
  for(const phrase of ['DO NOT BUILD, TEMPLATE, OR AUTOMATE','MISSED FOUNDATIONS CALL','MISSED MEMBERSHIP CALL','MISSED CIRCLE CALL','FAILED / INCOMPLETE FOUNDATIONS']) assert.ok(missed[0].description.includes(phrase),phrase);
  assert.ok(missed[0].description.length>8000);
  const incomplete=tasks.filter(x=>x.idempotency_key.endsWith(':incomplete-foundations'));assert.equal(incomplete.length,1);assert.match(incomplete[0].description,/INCOMPLETE FOUNDATIONS \/ BLOCKED FROM MOVING FORWARD/);
  assert.equal(tasks.filter(x=>x.idempotency_key.endsWith(':future-events')).length,1);
  assert.ok(tasks.every(x=>x.description.includes('COMPLETE CADE SOURCE COPY AND QUESTIONS')));
  const laterAnniversary=tasks.find(x=>x.idempotency_key.endsWith(':anniversary-later-years'));
  assert.match(laterAnniversary.description,/BADGES FOR EACH APPLICABLE TRIGGER\/EMAIL\. IE 30 DAYS: A BADGE IF THEY LEFT US A REVIEW\. IS THERE A WAY TO MONITOR THAT\? 3 MOS: IF THEY COMPLETE OUR SURVEY\. 1 YEAR: AUTO BADGE\. NEED TO BUILD 2\+ YEAR COMMS\. PLACE THIS TASK IN LIBBY’S WORKING QUE/);
  assert.match(laterAnniversary.description,/year-one anniversary email and automatic badge are implemented/);
  assert.match(laterAnniversary.description,/MEMBER REGISTRATION ANNIVERSARY/);
  const events=(await f.db.query('select * from operator_task_events')).rows;
  assert.equal(events.length,12); assert.ok(events.every(x=>x.event_type==='created' && x.actor_type==='system' && x.evidence.deliveryEnabled===false));
  const original=tasks[0]; await f.db.query("update operator_tasks set status='in_progress',description='Human decision preserved',version=2 where id=$1",[original.id]);
  await f.apply();
  assert.equal((await f.db.query('select count(*) n from operator_tasks')).rows[0].n,12);
  assert.equal((await f.db.query('select count(*) n from operator_task_events')).rows[0].n,12);
  assert.deepEqual((await f.db.query('select status,description,version from operator_tasks where id=$1',[original.id])).rows[0],{status:'in_progress',description:'Human decision preserved',version:2});
});
test("complete protocol allowance preserves the normal task length limit", async t=>{
  const f=await fixture(t);await f.apply();
  const insert="insert into operator_tasks(task_type,title,description,created_by_type) values($1,'Test',$2,'system')";
  await assert.rejects(f.db.query(insert,['general.review','x'.repeat(5001)]),/operator_tasks_description_cade_limit/);
  await f.db.query(insert,['general.review','x'.repeat(5000)]);
  await f.db.query(insert,['communications.cade_review','x'.repeat(30000)]);
  await assert.rejects(f.db.query(insert,['communications.cade_review','x'.repeat(30001)]),/operator_tasks_description_cade_limit/);
});
for(const [name,options] of [['inactive',{status:'disabled'}],['unverified',{verified:false}],['not admin',{role:false}]]) test(`missing authority defers assignment without blocking schema: ${name}`,async t=>{
  const f=await fixture(t,options);await f.apply();
  assert.equal((await f.db.query('select count(*) n from operator_tasks')).rows[0].n,0);
});
test('ambiguous canonical administrators defer every assignment',async t=>{
  const f=await fixture(t);const second=randomUUID();
  await f.db.query("insert into platform_users values($1,$2,'libby@theruinedproject.com','active')",[second,f.id]);
  await f.db.query("insert into platform_role_grants values($1,'ops_admin',null)",[second]);
  await f.apply();
  assert.equal((await f.db.query('select count(*) n from operator_tasks')).rows[0].n,0);
});

test('deferred work appears once after verified Libby becomes available and the private seeder is not public',async t=>{
  const f=await fixture(t,{verified:false});await f.apply();
  assert.equal((await f.db.query('select private.ruined_seed_cade_communications_work() n')).rows[0].n,0);
  await f.db.query("update person_email_addresses set verification_state='verified' where person_id=$1",[f.id]);
  assert.equal((await f.db.query('select private.ruined_seed_cade_communications_work() n')).rows[0].n,12);
  assert.equal((await f.db.query('select private.ruined_seed_cade_communications_work() n')).rows[0].n,0);
  assert.equal((await f.db.query('select count(*) n from operator_tasks')).rows[0].n,12);
  for(const role of ['anon','authenticated'])assert.equal((await f.db.query("select has_function_privilege($1,'private.ruined_seed_cade_communications_work()','EXECUTE') allowed",[role])).rows[0].allowed,false);
});
