import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { taggedDatabase } from "../scripts/check-support-repository.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const registry = await source("scripts/migrate-platform.mjs");
const migrations = await Promise.all([...registry.matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)].map(match => source(match[1])));

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const migration of migrations) await db.exec(migration);
  const statements = [];
  function observe(engine) {
    return { query: (query, params) => { statements.push(query); return engine.query(query, params); } };
  }
  const sql = taggedDatabase({ ...observe(db), transaction: callback => db.transaction(tx => callback(observe(tx))) });
  const dependencies = {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/google/calendar": {}, "@/lib/google/communications": {}, "@/lib/support/delivery": {},
    "@/lib/platform/ops-delivery-health": { readOpsDeliveryAttention: async () => [] },
  };
  const mod = { exports: {} };
  const compiled = ts.transpileModule(await source("src/lib/platform/ops-operating-repository.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, mod, mod.exports);
  const rows = async (query, params = []) => (await db.query(query, params)).rows;
  async function operator(displayName, preferredName, role = "ops_admin") {
    const auth = crypto.randomUUID(), person = crypto.randomUUID();
    await db.query("insert into people(id) values($1)", [person]);
    await db.query("insert into platform_users(auth_user_id,person_id,email_normalized,status,user_type) values($1,$2,$3,'active','staff')", [auth, person, `${auth}@private.example.test`]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,$2)", [auth, role]);
    await db.query("insert into person_profiles(person_id,display_name,preferred_name) values($1,$2,$3)", [person, displayName, preferredName]);
    await db.query("insert into person_private_profiles(person_id,legal_name) values($1,'PRIVATE LEGAL NAME')", [person]);
    return { auth, person };
  }
  const first = await operator("Alexandra Operator", "Alex"), second = await operator("Benjamin Operator", "Ben");
  async function task({ owner = null, status = "open", member = null } = {}) {
    const id = crypto.randomUUID();
    await db.query(`insert into operator_tasks(id,task_type,title,status,assigned_to_auth_user_id,created_by_type,member_id,
      completed_at,blocked_reason) values($1,'member_follow_up','Review new member',$2,$3,'system',$4,
      case when $2='completed' then statement_timestamp() else null end,
      case when $2='blocked' then 'Billing opening pending' else null end)`, [id,status,owner,member]);
    return id;
  }
  const state = async id => (await rows("select * from operator_tasks where id=$1", [id]))[0];
  const change = (id, action, expectedVersion, actor = first.auth) => mod.exports.transitionOpsTask({ taskId:id, action, expectedVersion, actorAuthUserId:actor });
  return { db, rows, repository:mod.exports, statements, operator, first, second, task, state, change };
}

const code = expected => error => error.code === expected;

test("task ownership is enforced transactionally against the complete shipped schema", async t => {
  const f = await fixture(t);

  await t.test("unclaimed completion is denied and claim requires an unassigned open task", async () => {
    const id = await f.task();
    await assert.rejects(f.change(id,"complete",1),code("conflict"));
    await assert.rejects(f.change(id,"unclaim",1),code("conflict"));
    assert.equal((await f.state(id)).version,1);
    const claimed = await f.change(id,"claim",1);
    assert.equal(claimed.state,"in_progress"); assert.equal(claimed.version,2);
    assert.equal((await f.state(id)).assigned_to_auth_user_id,f.first.auth);
    await assert.rejects(f.change(id,"claim",2),code("conflict"));
    await assert.rejects(f.change(id,"claim",2,f.second.auth),code("conflict"));
    await assert.rejects(f.change(id,"complete",2,f.second.auth),code("forbidden"));
    await assert.rejects(f.change(id,"unclaim",2,f.second.auth),code("forbidden"));
    assert.equal((await f.rows("select * from operator_task_events where operator_task_id=$1",[id])).length,1);
    assert.equal((await f.rows("select * from operator_audit_events where subject_id=$1",[id])).length,1);
    const completed = await f.change(id,"complete",2);
    assert.equal(completed.state,"completed"); assert.ok(completed.completedAt);
    assert.equal((await f.state(id)).assigned_to_auth_user_id,f.first.auth);
    assert.ok(f.statements.some(statement => /for update of platform_user, role_grant/.test(statement)));
    assert.ok(f.statements.some(statement => /from operator_tasks[\s\S]*for update/.test(statement)));
  });

  await t.test("unclaim hands off ownership; stale tabs cannot complete, unclaim, or reclaim", async () => {
    const id = await f.task();
    await f.change(id,"claim",1);
    await f.change(id,"unclaim",2);
    let current = await f.state(id);
    assert.equal(current.status,"open"); assert.equal(current.assigned_to_auth_user_id,null);
    await f.change(id,"claim",3,f.second.auth);
    for (const action of ["claim","complete","unclaim"]) await assert.rejects(f.change(id,action,2),code("conflict"));
    await assert.rejects(f.change(id,"complete",4),code("forbidden"));
    current = await f.state(id);
    assert.equal(current.assigned_to_auth_user_id,f.second.auth); assert.equal(current.version,4);
    await f.change(id,"complete",4,f.second.auth);
    const audits = await f.rows("select * from operator_audit_events where subject_id=$1 and action='task.unclaim'",[id]);
    assert.deepEqual(audits[0].before_snapshot,{ assignedToAuthUserId:f.first.auth,state:"in_progress",version:2 });
    assert.deepEqual(audits[0].after_snapshot,{ assignedToAuthUserId:null,state:"open",version:3 });
    const events = await f.rows("select * from operator_task_events where operator_task_id=$1 and evidence->>'action'='unclaim'",[id]);
    assert.equal(events[0].event_type,"state_changed");
    assert.deepEqual(events[0].evidence,{ action:"unclaim",previousAssignedToAuthUserId:f.first.auth,assignedToAuthUserId:null });
    await assert.rejects(f.db.query("delete from operator_task_events where operator_task_id=$1",[id]),/append|immutable/i);
  });

  await t.test("two operators racing with one version produce exactly one claimant", async () => {
    const id = await f.task();
    const outcomes = await Promise.allSettled([f.change(id,"claim",1),f.change(id,"claim",1,f.second.auth)]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length,1);
    const failure = outcomes.find(result => result.status === "rejected");
    assert.equal(failure.reason.code,"conflict");
    assert.equal((await f.state(id)).version,2);
    assert.equal((await f.rows("select * from operator_task_events where operator_task_id=$1",[id])).length,1);
  });

  await t.test("reopen clears legacy ownership and requires a fresh claim before completion", async () => {
    for (const owner of [f.first.auth,null]) {
      const id = await f.task({ owner,status:"completed" });
      const reopened = await f.change(id,"reopen",1,f.second.auth);
      assert.equal(reopened.state,"open"); assert.equal(reopened.completedAt,null);
      assert.equal((await f.state(id)).assigned_to_auth_user_id,null);
      await assert.rejects(f.change(id,"complete",2,f.first.auth),code("conflict"));
      await f.change(id,"claim",2,f.second.auth);
      await f.change(id,"complete",3,f.second.auth);
    }
  });

  await t.test("system blocking preserves ownership and billing gates; blocked unclaim preserves its reason", async () => {
    const id = await f.task();
    await f.change(id,"claim",1);
    await f.db.query("update operator_tasks set status='blocked',blocked_reason='Billing opening pending',version=version+1 where id=$1",[id]);
    await assert.rejects(f.change(id,"complete",3),code("conflict"));
    await assert.rejects(f.change(id,"claim",3,f.second.auth),code("conflict"));
    await assert.rejects(f.change(id,"unclaim",3,f.second.auth),code("forbidden"));
    await f.change(id,"unclaim",3);
    const unclaimed = await f.state(id);
    assert.equal(unclaimed.status,"blocked"); assert.equal(unclaimed.blocked_reason,"Billing opening pending");
    assert.equal(unclaimed.assigned_to_auth_user_id,null);
    await assert.rejects(f.change(id,"claim",4,f.second.auth),code("conflict"));

    const retained = await f.task({ owner:f.first.auth,status:"blocked" });
    // Registration reconciliation can restore an assigned task to open.
    await f.db.query("update operator_tasks set status='open',blocked_reason=null,version=version+1 where id=$1",[retained]);
    await assert.rejects(f.change(retained,"claim",2,f.second.auth),code("conflict"));
    await assert.rejects(f.change(retained,"complete",2,f.second.auth),code("forbidden"));
    await f.change(retained,"complete",2);
    // Canonical system resolution remains possible even without a manual claimant.
    await f.db.query("update operator_tasks set status='completed',completed_at=statement_timestamp(),version=version+1 where id=$1",[id]);
    assert.equal((await f.state(id)).status,"completed");
  });

  await t.test("current active admin access and a valid version are required for every mutation", async () => {
    const revoked = await f.operator("Revoked Operator", "Revoked"), guide = await f.operator("Circle Guide", "Guide", "guide");
    const id = await f.task({owner:revoked.auth,status:"in_progress"});
    for (const expectedVersion of [undefined,null,"1",0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
      await assert.rejects(f.change(id,"complete",expectedVersion,revoked.auth),code("invalid_request"));
    }
    await assert.rejects(f.change(id,"complete",1,guide.auth),code("forbidden"));
    await f.db.query("update platform_role_grants set revoked_at=statement_timestamp() where auth_user_id=$1",[revoked.auth]);
    for (const action of ["claim","complete","unclaim","reopen"]) await assert.rejects(f.change(id,action,1,revoked.auth),code("forbidden"));
    const suspended = await f.operator("Suspended Operator",null);
    await f.db.query("update platform_users set status='suspended' where auth_user_id=$1",[suspended.auth]);
    await assert.rejects(f.change(id,"complete",1,suspended.auth),code("forbidden"));
    assert.equal((await f.state(id)).version,1);
  });

  await t.test("a failed audit rolls back the task mutation and ownership event", async () => {
    const id = await f.task();
    await f.db.exec(`create function reject_fixture_task_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end $$;
      create trigger reject_fixture_task_audit before insert on operator_audit_events for each row execute function reject_fixture_task_audit();`);
    try { await assert.rejects(f.change(id,"claim",1),/audit unavailable/); }
    finally { await f.db.exec("drop trigger reject_fixture_task_audit on operator_audit_events; drop function reject_fixture_task_audit();"); }
    assert.equal((await f.state(id)).assigned_to_auth_user_id,null);
    assert.equal((await f.state(id)).version,1);
    assert.deepEqual(await f.rows("select * from operator_task_events where operator_task_id=$1",[id]),[]);
  });

  await t.test("queue, dashboard, and member records share public full names and viewer-relative ownership", async () => {
    const member = crypto.randomUUID();
    await f.db.query("insert into ruined_members(id,email,email_normalized) values($1,'task-member@example.test','task-member@example.test')",[member]);
    await f.db.query("insert into member_lifecycle(member_id) values($1)",[member]);
    const id = await f.task({ owner:f.first.auth,member });
    await f.db.query("update operator_tasks set priority='urgent',due_at=statement_timestamp()-interval '1 year' where id=$1",[id]);
    for (const actor of [f.first.auth,f.second.auth]) {
      const queue = await f.repository.getOpsWorkQueue(actor);
      const queued = queue.items.find(item => item.workId === id);
      assert.equal(queued.claimedByName,"Alexandra Operator");
      assert.equal(queued.claimedByCurrentOperator,actor === f.first.auth);
      assert.equal(queued.version,1);
      assert.doesNotMatch(JSON.stringify(queued),/PRIVATE LEGAL|private\.example|assigned_to_auth|assignedToAuth/);
      const overview = await f.repository.getOpsOverviewData(actor);
      const priority = overview.priorityWork.find(item => item.workId === id);
      assert.equal(priority.claimedByName,queued.claimedByName);
      assert.equal(priority.claimedByCurrentOperator,queued.claimedByCurrentOperator);
      assert.equal(priority.version,queued.version);
      const record = await f.repository.getOpsMemberOperatingRecord(actor,member);
      assert.equal(record.operational.tasks.find(item => item.taskId === id).assignedTo,queued.claimedByName);
    }
    const nameless = await f.operator(null,null), legacy = await f.operator(null,"Short"), preferred = await f.operator(null,"Preferred");
    await f.db.query("insert into user_profiles(auth_user_id,display_name) values($1,'Legacy Full Name')",[legacy.auth]);
    const namelessId = await f.task({owner:nameless.auth}), legacyId = await f.task({owner:legacy.auth}), preferredId = await f.task({owner:preferred.auth}), unassigned = await f.task();
    const queue = await f.repository.getOpsWorkQueue(f.first.auth);
    const owners = new Map(queue.items.filter(item => item.kind === "task").map(item => [item.workId,item.claimedByName]));
    assert.equal(owners.get(namelessId),"Operator"); assert.equal(owners.get(legacyId),"Legacy Full Name");
    assert.equal(owners.get(preferredId),"Preferred"); assert.equal(owners.get(unassigned),null);
    await f.db.query("update user_profiles set display_name='   ' where auth_user_id=$1",[legacy.auth]);
    assert.equal((await f.repository.getOpsWorkQueue(f.first.auth)).items.find(item => item.workId===legacyId).claimedByName,"Short");
  });
});
