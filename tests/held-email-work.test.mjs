import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { taggedDatabase } from "../scripts/check-support-repository.mjs";

const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");
async function load(file, dependencies) {
  const mod = { exports: {} };
  const output = ts.transpileModule(await read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", output)(key => {
    assert.ok(Object.hasOwn(dependencies, key), `Unexpected dependency ${key}`);
    return dependencies[key];
  }, mod, mod.exports);
  return mod.exports;
}

const staticHeld = [
  { id: "held:email:profile-drip", title: "Make yourself recognizable", detail: "Confirm the profile link.", trigger: "Profile access" },
  { id: "held:email:later-anniversaries", title: "Later anniversaries", detail: "Approve later-year wording.", trigger: "Anniversary" },
];
const held = (key, title, reason = "Approve the holiday schedule.") => ({ key, title, revision: 1, ready: false, missing: [reason] });

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key);
    create table ruined_members(id uuid primary key,person_id uuid,unique(id,person_id));
    create table platform_users(auth_user_id uuid primary key);
    create table circles(id uuid primary key); create table membership_blocks(id uuid primary key);`);
  const base = await read("db/migrations/20260826_membership_operating_spine_05_content_operations.sql");
  await db.exec(base.slice(base.indexOf("create table if not exists public.operator_tasks ("), base.indexOf("-- Overrides are immutable")));
  await db.exec(await read("db/migrations/20261102160000_operator_task_dismissal.sql"));
  const actor = crypto.randomUUID();
  await db.query("insert into platform_users values($1)", [actor]);
  let readiness = [held("thanksgiving", "Thanksgiving heads-up"), held("christmas", "Christmas / end-of-year"), held("birthday", "Member birthday")];
  const statements = [];
  const observe = engine => ({ query: (query, values) => { statements.push(query); return engine.query(query, values); } });
  const sql = taggedDatabase({ ...observe(db), transaction: callback => db.transaction(tx => callback(observe(tx))) });
  const work = await load("src/lib/communications/held-email-work.ts", {
    "server-only": {}, "node:crypto": crypto,
    "./communications-catalog": { HELD_EMAILS: staticHeld },
    "./member-lifecycle-email-service": { readLifecycleEmailWorkReadiness: async () => structuredClone(readiness) },
  });
  const rows = async (query, values = []) => (await db.query(query, values)).rows;
  const tasks = () => rows("select * from operator_tasks order by idempotency_key");
  const state = async key => (await rows("select * from operator_tasks where idempotency_key=$1", [key]))[0];
  return { db, actor, rows, tasks, state, statements,
    setReadiness: next => { readiness = next; },
    sync: () => sql.begin(tx => work.syncHeldEmailWork(tx)),
    read: () => sql.begin(tx => work.readHeldEmailWork(tx)),
  };
}

test("held email work creates missing reviews once and preserves the original CADE brief", async t => {
  const f = await fixture(t), originalId = crypto.randomUUID();
  await f.db.query(`insert into operator_tasks(id,task_type,title,description,status,assigned_to_auth_user_id,created_by_type,idempotency_key,dismissed_at,dismissed_by_auth_user_id)
    values($1,'communications.cade_review','Original birthday decision','COMPLETE ORIGINAL CADE BRIEF','in_progress',$2,'system','cade-communications-20261021:birthday-gift',now(),$2)`, [originalId,f.actor]);
  await f.sync(); await f.sync(); await Promise.all([f.sync(),f.sync()]);
  const tasks = await f.tasks();
  assert.equal(tasks.length,3);
  const existing = tasks.find(task => task.id === originalId);
  assert.equal(existing.description,"COMPLETE ORIGINAL CADE BRIEF");
  assert.equal(existing.assigned_to_auth_user_id,f.actor);
  assert.equal(existing.status,"in_progress");
  assert.ok(existing.dismissed_at);
  assert.equal(existing.version,1);
  for (const task of tasks.filter(task => task.id !== originalId)) {
    assert.equal(task.task_type,"communications.held_email_review");
    assert.equal(task.assigned_to_auth_user_id,null);
    assert.equal(task.status,"open");
    assert.match(task.description,/does not enable or send/);
  }
  assert.equal((await f.rows("select * from operator_task_events")).length,2);
  const markers = await f.read();
  assert.equal(markers.get("cade-communications-20261021:birthday-gift").id,"lifecycle:birthday");
  assert.equal(markers.get("cade-communications-20261021:profile-drip").reviewHref,null);
  assert.ok(markers.has("cade-communications-20261021:anniversary-later-years"));
  assert.ok(markers.has("cade-communications-20261021:clothing-benefits"));
  assert.equal(markers.get("held-email:lifecycle:thanksgiving").reviewHref,"/ops/messages?mode=automations&lifecycle=thanksgiving#lifecycle-emails");
  f.setReadiness([{...held("birthday","Member birthday"),ready:true,missing:[]}]);
  await f.sync();
  assert.equal((await f.read()).has("cade-communications-20261021:birthday-gift"),false);
  const readyOriginal = await f.state("cade-communications-20261021:birthday-gift");
  assert.equal(readyOriginal.status,"in_progress");
  assert.equal(readyOriginal.description,"COMPLETE ORIGINAL CADE BRIEF");
  assert.equal(readyOriginal.version,1);
  assert.ok(f.statements.every(statement => !/member_lifecycle_email_deliveries|update private\.member_lifecycle_email_rules|communication_contacts|ruined_members.*join/i.test(statement)),"work synchronization never scans recipients or changes sending");
});

test("routine hold changes preserve dismissal; resolved and genuinely renewed holds follow system evidence", async t => {
  const f = await fixture(t), key = "held-email:lifecycle:thanksgiving";
  f.setReadiness([held("thanksgiving","Thanksgiving heads-up")]);
  await f.sync(); const original = await f.state(key);
  await f.db.query("update operator_tasks set assigned_to_auth_user_id=$2,status='in_progress',dismissed_at=now(),dismissed_by_auth_user_id=$2,version=version+1 where id=$1",[original.id,f.actor]);
  f.setReadiness([held("thanksgiving","Thanksgiving heads-up","Confirm the return date.")]);
  await f.sync(); const refreshed = await f.state(key);
  assert.ok(refreshed.dismissed_at);
  assert.equal(refreshed.status,"in_progress");
  assert.equal(refreshed.assigned_to_auth_user_id,f.actor);
  assert.match(refreshed.description,/Confirm the return date/);
  f.setReadiness([{...held("thanksgiving","Thanksgiving heads-up"),ready:true,missing:[]}]);
  await f.sync(); const resolved = await f.state(key);
  assert.equal(resolved.status,"completed");
  assert.ok(resolved.completed_at);
  assert.ok(resolved.dismissed_at);
  assert.equal((await f.read()).has(key),false);
  f.setReadiness([held("thanksgiving","Thanksgiving heads-up","Approve the 2027 holiday schedule.")]);
  await f.sync(); const renewed = await f.state(key);
  assert.equal(renewed.id,original.id);
  assert.equal(renewed.status,"in_progress");
  assert.equal(renewed.completed_at,null);
  assert.equal(renewed.dismissed_at,null);
  assert.equal(renewed.assigned_to_auth_user_id,f.actor);
  assert.equal((await f.tasks()).length,1);
});

test("manual completion or cancellation remains durable even after a prior system resolution", async t => {
  const f = await fixture(t), key = "held-email:lifecycle:thanksgiving";
  for (const status of ["completed","cancelled"]) {
    f.setReadiness([held("thanksgiving","Thanksgiving heads-up")]);
    await f.sync();
    const current = await f.state(key);
    // A manual reopen starts fresh work; the following terminal event belongs to the operator.
    await f.db.query("update operator_tasks set status='open',completed_at=null,version=version+1 where id=$1",[current.id]);
    f.setReadiness([{...held("thanksgiving","Thanksgiving heads-up"),ready:true,missing:[]}]);
    await f.sync();
    await f.db.query("update operator_tasks set status=$2,completed_at=case when $2='completed' then now() else null end,version=version+1 where id=$1",[current.id,status]);
    await f.db.query(`insert into operator_task_events(operator_task_id,event_type,next_status,actor_auth_user_id,evidence,dedupe_key)
      values($1,$2,$2,$3,'{"action":"manual"}',$4)`,[current.id,status,f.actor,crypto.randomUUID()]);
    f.setReadiness([held("thanksgiving","Thanksgiving heads-up","A changed held decision.")]);
    await f.sync();
    assert.equal((await f.state(key)).status,status);
  }
});

test("an event failure rolls back new review tasks and already updated held work", async t => {
  const f = await fixture(t);
  await f.db.exec(`create function reject_held_work_event() returns trigger language plpgsql as $$ begin raise exception 'history unavailable'; end $$;
    create trigger reject_held_work_event before insert on operator_task_events for each row execute function reject_held_work_event();`);
  await assert.rejects(f.sync(),/history unavailable/);
  assert.equal((await f.tasks()).length,0);
  assert.equal((await f.rows("select * from operator_task_events")).length,0);
  await f.db.exec("drop trigger reject_held_work_event on operator_task_events");
  await f.sync();
  const before = await f.state("held-email:lifecycle:thanksgiving");
  f.setReadiness([held("thanksgiving","Thanksgiving heads-up","Changed pending decision.")]);
  await f.db.exec("create trigger reject_held_work_event before insert on operator_task_events for each row execute function reject_held_work_event()");
  await assert.rejects(f.sync(),/history unavailable/);
  const after = await f.state("held-email:lifecycle:thanksgiving");
  assert.equal(after.description,before.description);
  assert.equal(after.version,before.version);
});

test("work readiness shares catalog blockers without reading recipients or writing delivery state", async () => {
  const queries = [], calls = [];
  const rule = {key:"thanksgiving",enabled:false,authorized:true,revision:7,settings:{},design:{siteUrl:"https://members.theruinedproject.com"}};
  const tx = async parts => { const query = parts.join("?"); queries.push(query); return /to_regclass/.test(query) ? [{installed:true}] : []; };
  const service = await load("src/lib/communications/member-lifecycle-email-service.ts", {
    "server-only": {}, "@/lib/database/server": {}, "./admin-email-model": {}, "./admin-email-repository": {},
    "./member-email-cadence-delivery": {}, "./member-email-cadence-renderer": {}, "./member-lifecycle-email-copy": {},
    "./member-lifecycle-email-model": {denverDate:()=>"2027-02-01",LIFECYCLE_TITLES:{thanksgiving:"Thanksgiving heads-up"},lifecycleMissing:(key,settings,year)=>{calls.push({key,settings,year});return [`Approve the ${year} holiday schedule.`];}},
    "./member-lifecycle-email-repository": {readLifecycleRules:async(_tx,lock)=>{calls.push({lock});return [rule];},readLifecycleMembers:()=>{throw new Error("Recipient scan is forbidden for Work queue readiness");}},
  });
  assert.deepEqual(await service.readLifecycleEmailWorkReadiness(tx,new Date("2027-02-01T12:00:00Z"),true),[
    {key:"thanksgiving",title:"Thanksgiving heads-up",ready:false,missing:["Approve the 2027 holiday schedule."],revision:7},
  ]);
  assert.ok(calls.some(call=>call.lock===true));
  assert.ok(calls.some(call=>call.year===2027));
  assert.ok(queries.every(query=>/^\s*select/i.test(query)));
});
