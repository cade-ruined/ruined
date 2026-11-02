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
  const heldWork = new Map();
  const heldReads = [];
  const dependencies = {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/google/calendar": {}, "@/lib/google/communications": {}, "@/lib/support/delivery": {},
    "@/lib/platform/ops-delivery-health": { readOpsDeliveryAttention: async () => [] },
    "@/lib/communications/held-email-work": {
      readHeldEmailWork: async () => { heldReads.push("read"); return heldWork; },
      syncHeldEmailWork: async () => { heldReads.push("sync"); },
    },
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
  async function task({ owner = null, status = "open", member = null, createdAt = null, dueAt = null, priority = "normal", key = null, id = crypto.randomUUID() } = {}) {
    await db.query(`insert into operator_tasks(id,task_type,title,status,assigned_to_auth_user_id,created_by_type,member_id,
      completed_at,blocked_reason,created_at,due_at,priority,idempotency_key) values($1,'member_follow_up','Review new member',$2,$3,'system',$4,
      case when $2='completed' then statement_timestamp() else null end,
      case when $2='blocked' then 'Billing opening pending' else null end,
      coalesce($5::timestamptz,statement_timestamp()),$6,$7,$8)`, [id,status,owner,member,createdAt,dueAt,priority,key]);
    return id;
  }
  const state = async id => (await rows("select * from operator_tasks where id=$1", [id]))[0];
  const change = (id, action, expectedVersion, actor = first.auth) => mod.exports.transitionOpsTask({ taskId:id, action, expectedVersion, actorAuthUserId:actor });
  return { db, rows, repository:mod.exports, statements, operator, first, second, task, state, change, heldWork, heldReads };
}

const code = expected => error => error.code === expected;

test("work filters and creation-date ordering span tasks, Artifacts and failed actions", async t => {
  const f = await fixture(t);
  const oldest = await f.task({ createdAt:"2026-01-01T00:00:00Z",dueAt:"2026-12-31T00:00:00Z" });
  const newest = await f.task({ createdAt:"2026-04-01T00:00:00Z",dueAt:"2026-01-01T00:00:00Z",priority:"urgent" });
  const heldKey = "fixture:held-birthday";
  const held = await f.task({ createdAt:"2026-03-01T00:00:00Z",key:heldKey });
  const details = { id:"lifecycle:birthday",title:"Member birthday",reason:"Choose a redeemable gift.",reviewHref:"/ops/messages?mode=automations&lifecycle=birthday#lifecycle-emails",reviewLabel:"Review template & rules" };
  f.heldWork.set(heldKey,details);

  const member = crypto.randomUUID(), template = crypto.randomUUID(), version = crypto.randomUUID(), artifact = crypto.randomUUID();
  await f.db.query("insert into ruined_members(id,email,email_normalized) values($1,'queue-order@example.test','queue-order@example.test')",[member]);
  await f.db.query("insert into artifact_templates(id,template_slug,name) values($1,'queue-order','Queue ordering')",[template]);
  await f.db.query("insert into artifact_template_versions(id,artifact_template_id,version,name,status,published_at) values($1,$2,1,'Queue ordering','published','2026-01-01T00:00:00Z')",[version,template]);
  await f.db.query(`insert into artifact_jobs(id,member_id,artifact_template_version_id,requested_at,created_at,due_at,priority)
    values($1,$2,$3,'2026-02-01T00:00:00Z','2026-12-01T00:00:00Z','2026-01-01T00:00:00Z',99)`,[artifact,member,version]);
  const event = crypto.randomUUID(), workflow = crypto.randomUUID();
  await f.db.query("insert into domain_events(id,aggregate_type,aggregate_id,event_type,dedupe_key) values($1,'fixture','queue','fixture.queue',$2)",[event,event]);
  await f.db.query(`insert into workflow_actions(id,domain_event_id,action_type,status,idempotency_key,created_at,updated_at)
    values($1,$2,'send_notification','failed',$3,'2026-02-15T00:00:00Z','2026-12-31T00:00:00Z')`,[workflow,event,workflow]);

  const asc = await f.repository.getOpsWorkQueue(f.first.auth,{sort:"oldest"});
  assert.deepEqual(asc.items.map(item=>item.workId),[oldest,artifact,workflow,held,newest]);
  assert.equal(asc.sort,"oldest");
  assert.equal(asc.items.find(item=>item.workId===artifact).createdAt,"2026-02-01T00:00:00.000Z");
  assert.equal(asc.items.find(item=>item.workId===workflow).createdAt,"2026-02-15T00:00:00.000Z");
  const desc = await f.repository.getOpsWorkQueue(f.first.auth,{sort:"newest"});
  assert.deepEqual(desc.items.map(item=>item.workId),[newest,held,workflow,artifact,oldest]);
  assert.deepEqual((await f.repository.getOpsWorkQueue(f.first.auth,{filter:"task",sort:"oldest"})).items.map(item=>item.workId),[oldest,held,newest]);
  assert.deepEqual((await f.repository.getOpsWorkQueue(f.first.auth,{filter:"artifact"})).items.map(item=>item.workId),[artifact]);
  assert.deepEqual((await f.repository.getOpsWorkQueue(f.first.auth,{filter:"workflow_failure"})).items.map(item=>item.workId),[workflow]);
  const heldOnly = await f.repository.getOpsWorkQueue(f.first.auth,{filter:"held_email"});
  assert.deepEqual(heldOnly.items.map(item=>item.workId),[held]);
  assert.equal(heldOnly.filter,"held_email");
  assert.deepEqual(heldOnly.items[0].heldEmail,details);
  assert.equal(heldOnly.totals.tasks,1);
  assert.equal(heldOnly.totals.artifacts,0);
  assert.equal(heldOnly.totals.failures,0);
  const fallback = await f.repository.getOpsWorkQueue(f.first.auth,{filter:"unknown",sort:"unknown"});
  assert.equal(fallback.filter,"all");
  assert.equal(fallback.sort,"priority");
  assert.equal(fallback.items.length,5);

  const added = heldOnly.items[0].createdAt;
  await f.change(held,"dismiss",1);
  assert.equal((await f.repository.getOpsWorkQueue(f.first.auth,{filter:"held_email"})).items.length,0);
  const dismissed = await f.repository.getOpsWorkQueue(f.first.auth,{view:"dismissed",filter:"held_email",sort:"newest"});
  assert.deepEqual(dismissed.items.map(item=>item.workId),[held]);
  assert.equal(dismissed.items[0].createdAt,added);
  await f.change(held,"restore",2);
  assert.equal((await f.repository.getOpsWorkQueue(f.first.auth,{filter:"held_email"})).items[0].createdAt,added);
  const guide = await f.operator("Guide","Guide","guide");
  const priorReads = f.heldReads.length;
  const guideQueue = await f.repository.getOpsWorkQueue(guide.auth,{filter:"held_email",sort:"newest"});
  assert.deepEqual(guideQueue.items,[]);
  assert.equal(f.heldReads.length,priorReads,"held-email state is not read or synchronized for a guide");
});

test("held filters and oldest/newest ordering apply before the active queue limit", async t => {
  const f = await fixture(t);
  await f.db.query(`insert into operator_tasks(task_type,title,priority,created_by_type,created_at)
    select 'member_follow_up','Older high priority ' || n,'high','system','2026-01-01T00:00:00Z'::timestamptz+n*interval '1 minute'
    from generate_series(1,205) n`);
  const heldKey = "fixture:held-holiday";
  const held = await f.task({ createdAt:"2026-11-01T00:00:00Z",key:heldKey });
  f.heldWork.set(heldKey,{id:"lifecycle:thanksgiving",title:"Thanksgiving",reason:"Confirm this year's schedule.",reviewHref:"/ops/messages?mode=automations&lifecycle=thanksgiving#lifecycle-emails",reviewLabel:"Review template & rules"});
  assert.equal((await f.repository.getOpsWorkQueue(f.first.auth)).items.some(item=>item.workId===held),false,"fixture is beyond the default 200 high-priority rows");
  const filtered = await f.repository.getOpsWorkQueue(f.first.auth,{filter:"held_email"});
  assert.deepEqual(filtered.items.map(item=>item.workId),[held],"filter can find held work beyond the unfiltered queue cap");
  const newest = await f.repository.getOpsWorkQueue(f.first.auth,{sort:"newest"});
  assert.equal(newest.items.length,200);
  assert.equal(newest.items[0].workId,held,"newest selection happens before truncation");
  const oldest = await f.repository.getOpsWorkQueue(f.first.auth,{sort:"oldest"});
  assert.equal(oldest.items.length,200);
  assert.equal(oldest.items[0].label,"Older high priority 1");
  assert.equal(oldest.items.at(-1).label,"Older high priority 200");

  const tieDate = "2026-12-01T00:00:00Z";
  const tied = [
    await f.task({id:"10000000-0000-4000-8000-000000000002",createdAt:tieDate}),
    await f.task({id:"10000000-0000-4000-8000-000000000001",createdAt:tieDate}),
  ];
  const first = await f.repository.getOpsWorkQueue(f.first.auth,{sort:"newest"});
  const repeat = await f.repository.getOpsWorkQueue(f.first.auth,{sort:"newest"});
  assert.deepEqual(first.items.slice(0,2).map(item=>item.workId),[...tied].sort());
  assert.deepEqual(repeat.items.map(item=>item.workId),first.items.map(item=>item.workId),"same creation dates have deterministic ordering");
});

test("admin work identifies unfinished registrations without mixing contact emails into names", async t => {
  const f = await fixture(t);
  const member = crypto.randomUUID(), person = crypto.randomUUID();
  const memberEmail = "unfinished.registration@example.test";
  await f.db.query("insert into people(id) values($1)", [person]);
  await f.db.query("insert into ruined_members(id,person_id,email,email_normalized) values($1,$2,$3,$3)", [member,person,memberEmail]);
  await f.db.query("insert into member_lifecycle(member_id) values($1)", [member]);
  const id = await f.task({ member,owner:f.first.auth });
  await f.db.query("update operator_tasks set task_type='registration.checkpoint.information' where id=$1", [id]);
  const systemId = await f.task();

  const check = async expectedName => {
    const queue = await f.repository.getOpsWorkQueue(f.first.auth);
    const overview = await f.repository.getOpsOverviewData(f.first.auth);
    for (const item of [queue.items.find(item => item.workId === id),overview.priorityWork.find(item => item.workId === id)]) {
      assert.equal(item.memberId,member);
      assert.equal(item.memberName,expectedName);
      assert.equal(item.memberEmail,memberEmail);
      assert.equal(item.claimedByName,"Alexandra Operator");
      assert.equal(item.version,1);
    }
    const system = queue.items.find(item => item.workId === systemId);
    assert.equal(system.memberId,null);
    assert.equal(system.memberEmail,null);
  };

  await check(null);
  await f.db.query("insert into person_profiles(person_id,preferred_name,display_name) values($1,null,' Alex Member ')", [person]);
  await check("Alex Member");
  await f.db.query("update person_profiles set preferred_name=' Al ',display_name='Alex Member' where person_id=$1", [person]);
  await check("Al");
  await f.db.query("update person_profiles set preferred_name=null,display_name=null where person_id=$1", [person]);
  await check(null);

  const guide = await f.operator("Circle Guide","Guide","guide");
  assert.equal((await f.repository.getOpsWorkQueue(guide.auth)).items.some(item => item.workId === id),false);
  assert.doesNotMatch(JSON.stringify(await f.repository.getOpsOverviewData(guide.auth)),/unfinished\.registration@example\.test/);
  assert.equal((await f.state(id)).version,1);
  assert.equal((await f.state(id)).assigned_to_auth_user_id,f.first.auth);
});

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
    for (const action of ["claim","complete","unclaim","reopen","dismiss","restore"]) await assert.rejects(f.change(id,action,1,revoked.auth),code("forbidden"));
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

test("dismissal removes attention without completing or claiming the underlying task", async t => {
  const f = await fixture(t);

  await t.test("any active admin can dismiss and restore without changing ownership or blocking", async () => {
    for (const [status, owner] of [["open",null],["in_progress",f.second.auth],["blocked",f.second.auth]]) {
      const id = await f.task({ status,owner });
      const dismissed = await f.change(id,"dismiss",1);
      assert.equal(dismissed.state,status);
      assert.equal(dismissed.version,2);
      const hidden = await f.state(id);
      assert.ok(hidden.dismissed_at);
      assert.equal(hidden.dismissed_by_auth_user_id,f.first.auth);
      assert.equal(hidden.status,status);
      assert.equal(hidden.assigned_to_auth_user_id,owner);
      assert.equal(hidden.completed_at,null);
      assert.equal(hidden.blocked_reason,status === "blocked" ? "Billing opening pending" : null);
      for (const action of ["claim","complete","unclaim","dismiss"]) {
        await assert.rejects(f.change(id,action,2,owner ?? f.first.auth),code("conflict"));
      }
      await assert.rejects(f.change(id,"restore",1),code("conflict"));
      await f.change(id,"restore",2,f.second.auth);
      const restored = await f.state(id);
      assert.equal(restored.dismissed_at,null);
      assert.equal(restored.dismissed_by_auth_user_id,null);
      assert.equal(restored.status,status);
      assert.equal(restored.assigned_to_auth_user_id,owner);
      assert.equal(restored.version,3);
      await assert.rejects(f.change(id,"restore",3),code("conflict"));
      const events = await f.rows("select evidence->>'action' as action,previous_status,next_status from operator_task_events where operator_task_id=$1 order by occurred_at,id",[id]);
      assert.deepEqual(new Set(events.map(event => event.action)),new Set(["dismiss","restore"]));
      assert.ok(events.every(event => event.previous_status === status && event.next_status === status));
      const audits = await f.rows("select action from operator_audit_events where subject_id=$1",[id]);
      assert.deepEqual(new Set(audits.map(event => event.action)),new Set(["task.dismiss","task.restore"]));
    }
  });

  await t.test("active work, dashboard attention, and member counts exclude dismissed tasks", async () => {
    const member = crypto.randomUUID();
    await f.db.query("insert into ruined_members(id,email,email_normalized) values($1,'dismissal@example.test','dismissal@example.test')",[member]);
    await f.db.query("insert into member_lifecycle(member_id) values($1)",[member]);
    const id = await f.task({member});
    await f.db.query("update operator_tasks set priority='urgent',due_at=statement_timestamp()-interval '1 year' where id=$1",[id]);
    const before = await f.repository.getOpsMemberOperatingRecord(f.first.auth,member);
    await f.change(id,"dismiss",1);
    const active = await f.repository.getOpsWorkQueue(f.first.auth);
    assert.equal(active.items.some(item => item.workId === id),false);
    assert.equal(active.totals.dismissedTasks,1);
    const dismissed = await f.repository.getOpsWorkQueue(f.first.auth,{view:"dismissed"});
    assert.equal(dismissed.view,"dismissed");
    assert.equal(dismissed.items.length,1);
    assert.equal(dismissed.items[0].workId,id);
    assert.ok(dismissed.items[0].dismissedAt);
    assert.equal(dismissed.items[0].dismissedByName,"Alexandra Operator");
    assert.equal(dismissed.items[0].claimedByName,null);
    assert.equal(dismissed.items[0].version,2);
    assert.equal(dismissed.totals.artifacts,0);
    assert.equal(dismissed.totals.failures,0);
    const overview = await f.repository.getOpsOverviewData(f.first.auth);
    assert.equal(overview.priorityWork.some(item => item.workId === id),false);
    const after = await f.repository.getOpsMemberOperatingRecord(f.first.auth,member);
    assert.equal(after.header.openWorkCount,before.header.openWorkCount-1);
    assert.ok(after.operational.tasks.find(item => item.taskId === id).dismissedAt);
    const guide = await f.operator("Guide","Guide","guide");
    assert.equal((await f.repository.getOpsWorkQueue(guide.auth,{view:"dismissed"})).items.length,0);
    await assert.rejects(f.change(id,"restore",2,guide.auth),code("forbidden"));
    await f.change(id,"restore",2);
    assert.ok((await f.repository.getOpsWorkQueue(f.first.auth)).items.some(item => item.workId === id));
  });

  await t.test("resolved tasks cannot be dismissed or restored into false work", async () => {
    for (const status of ["completed","cancelled"]) {
      const id = await f.task();
      await f.change(id,"dismiss",1);
      await f.db.query("update operator_tasks set status=$2,completed_at=case when $2='completed' then statement_timestamp() else null end,version=version+1 where id=$1",[id,status]);
      await assert.rejects(f.change(id,"restore",3),code("conflict"));
      await assert.rejects(f.change(id,"dismiss",3),code("conflict"));
      assert.equal((await f.repository.getOpsWorkQueue(f.first.auth,{view:"dismissed"})).items.some(item => item.workId === id),false);
      assert.equal((await f.state(id)).status,status);
      if (status === "completed") {
        await f.change(id,"reopen",3);
        const renewed = await f.state(id);
        assert.equal(renewed.status,"open");
        assert.equal(renewed.dismissed_at,null);
        assert.equal(renewed.dismissed_by_auth_user_id,null);
        assert.equal(renewed.completed_at,null);
        assert.equal(renewed.assigned_to_auth_user_id,null);
      }
    }
  });

  await t.test("a failed event or audit rolls back dismissal atomically", async () => {
    for (const table of ["operator_task_events","operator_audit_events"]) {
      const id = await f.task();
      await f.db.exec(`create function reject_fixture_dismissal() returns trigger language plpgsql as $$ begin raise exception 'history unavailable'; end $$;
        create trigger reject_fixture_dismissal before insert on ${table} for each row execute function reject_fixture_dismissal();`);
      try { await assert.rejects(f.change(id,"dismiss",1),/history unavailable/); }
      finally { await f.db.exec(`drop trigger reject_fixture_dismissal on ${table}; drop function reject_fixture_dismissal();`); }
      const current = await f.state(id);
      assert.equal(current.dismissed_at,null);
      assert.equal(current.dismissed_by_auth_user_id,null);
      assert.equal(current.assigned_to_auth_user_id,null);
      assert.equal(current.status,"open");
      assert.equal(current.version,1);
      assert.deepEqual(await f.rows("select * from operator_task_events where operator_task_id=$1",[id]),[]);
    }
  });

  await t.test("all dismissed tasks remain reachable for restore beyond the active queue limit", async () => {
    await f.db.query(`insert into operator_tasks(task_type,title,created_by_type,dismissed_at,dismissed_by_auth_user_id)
      select 'member_follow_up','Dismissed fixture ' || n,'system',statement_timestamp()-n*interval '1 minute',$1
      from generate_series(1,205) n`,[f.first.auth]);
    const queue = await f.repository.getOpsWorkQueue(f.first.auth,{view:"dismissed"});
    assert.equal(queue.items.length,205);
    assert.equal(queue.totals.dismissedTasks,205);
    assert.equal(queue.items[0].label,"Dismissed fixture 1");
    const oldest = queue.items.find(item => item.label === "Dismissed fixture 205");
    assert.ok(oldest);
    await f.change(oldest.workId,"restore",oldest.version);
    assert.equal((await f.state(oldest.workId)).dismissed_at,null);
  });
});
