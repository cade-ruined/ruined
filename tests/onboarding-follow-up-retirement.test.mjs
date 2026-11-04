import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = "db/migrations/20261104202223_retire_onboarding_follow_up.sql";

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table ruined_members (id uuid primary key, person_id uuid not null);
    create table member_onboardings (
      member_id uuid primary key references ruined_members(id), state text not null,
      version bigint not null default 1, completed_at timestamptz
    );
    create table domain_events (
      id uuid primary key default gen_random_uuid(), aggregate_type text, aggregate_id text,
      event_type text, person_id uuid, member_id uuid, payload jsonb,
      occurred_at timestamptz, dedupe_key text unique
    );
    create table member_milestones (
      id uuid primary key default gen_random_uuid(), member_id uuid, person_id uuid,
      milestone_type text, title text, occurred_at timestamptz,
      source_entity_type text, source_entity_id text, evidence jsonb, dedupe_key text unique
    );
    create table workflow_actions (
      id uuid primary key default gen_random_uuid(), domain_event_id uuid references domain_events(id),
      action_type text not null, target_type text, target_id text, payload jsonb not null,
      idempotency_key text unique, status text not null default 'pending'
        check (status in ('pending','processing','succeeded','failed','dead_letter','cancelled')),
      locked_at timestamptz, locked_by text, last_error text, completed_at timestamptz,
      updated_at timestamptz not null default statement_timestamp(),
      check (completed_at is null or status in ('succeeded','dead_letter','cancelled'))
    );
    create table operator_tasks (
      id uuid primary key default gen_random_uuid(), task_type text not null,
      status text not null default 'open'
        check (status in ('open','in_progress','blocked','completed','cancelled')),
      due_at timestamptz, completed_at timestamptz, blocked_reason text,
      assigned_to_auth_user_id uuid, dismissed_at timestamptz, dismissed_by_auth_user_id uuid,
      version bigint not null default 1, updated_at timestamptz not null default statement_timestamp(),
      check (status <> 'completed' or completed_at is not null),
      check ((dismissed_at is null) = (dismissed_by_auth_user_id is null))
    );
    create table operator_task_events (
      id bigint generated always as identity primary key,
      operator_task_id uuid not null references operator_tasks(id),
      event_type text not null, previous_status text, next_status text,
      actor_type text not null, actor_auth_user_id uuid,
      evidence jsonb not null check (jsonb_typeof(evidence) = 'object'), dedupe_key text unique,
      check ((actor_type = 'operator' and actor_auth_user_id is not null)
          or (actor_type = 'system' and actor_auth_user_id is null))
    );
  `);
  // Install the existing trigger, then apply the real replacement migration.
  const original = read("db/migrations/20260826_membership_operating_spine_04_foundations_automation.sql");
  const start = original.indexOf("create or replace function private.ruined_queue_onboarding_completion_work()");
  const end = original.indexOf("create or replace function private.ruined_queue_foundation_completion_work()", start);
  await db.exec(original.slice(start, end));
  const migrate = () => db.exec(read(migration));
  const snapshot = async () => ({
    tasks: (await db.query("select * from operator_tasks order by id")).rows,
    actions: (await db.query("select * from workflow_actions order by id")).rows,
    events: (await db.query("select * from operator_task_events order by id")).rows,
  });
  return { db, migrate, snapshot };
}

test("onboarding completion retains its event, milestone and welcome without creating an operator task", async (t) => {
  const { db, migrate } = await fixture(t);
  await migrate();
  const completedAt = "2026-11-04T16:00:00.000Z";
  for (const viaUpdate of [false, true]) {
    const memberId = randomUUID(), personId = randomUUID();
    await db.query("insert into ruined_members values($1,$2)", [memberId, personId]);
    await db.query("insert into member_onboardings values($1,$2,4,$3)",
      [memberId, viaUpdate ? "in_progress" : "completed", viaUpdate ? null : completedAt]);
    if (viaUpdate) {
      assert.equal((await db.query("select count(*)::int n from domain_events where member_id=$1", [memberId])).rows[0].n, 0);
      await db.query("update member_onboardings set state='completed',completed_at=$2 where member_id=$1", [memberId, completedAt]);
    }
    // An unchanged completion update must not enqueue duplicate work.
    await db.query("update member_onboardings set state='completed' where member_id=$1", [memberId]);
    const event = (await db.query("select * from domain_events where member_id=$1", [memberId])).rows;
    assert.equal(event.length, 1);
    assert.equal(event[0].event_type, "membership.administrative_onboarding_completed");
    assert.equal(event[0].person_id, personId);
    assert.deepEqual(event[0].payload, { onboarding_version: 4 });
    assert.equal(event[0].occurred_at.toISOString(), completedAt);
    const milestones = (await db.query("select * from member_milestones where member_id=$1", [memberId])).rows;
    assert.equal(milestones.length, 1);
    assert.equal(milestones[0].title, "Membership onboarding complete");
    assert.equal(milestones[0].person_id, personId);
    assert.deepEqual(milestones[0].evidence, { onboarding_version: 4 });
    const actions = (await db.query("select * from workflow_actions where target_id=$1", [memberId])).rows;
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action_type, "send_notification");
    assert.equal(actions[0].domain_event_id, event[0].id);
    assert.deepEqual(actions[0].payload, {
      member_id: memberId, template_key: "administrative_onboarding_completed",
      notification_type: "membership", title: "Welcome to My Ruined",
      body: "Your membership is ready. Begin Ruined Foundations when you are ready.",
      action_label: "Begin Foundations", action_url: "/my/foundations",
    });
  }
  assert.equal((await db.query("select count(*)::int n from operator_tasks")).rows[0].n, 0);
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await db.query("select has_function_privilege($1,'private.ruined_queue_onboarding_completion_work()','EXECUTE') allowed", [role])).rows[0].allowed, false);
  }
});

test("retirement cancels only outstanding follow-up obligations and queued work, preserving history on rerun", async (t) => {
  const { db, migrate, snapshot } = await fixture(t);
  const activeTaskIds = new Map();
  const activeActionIds = [];
  const historicalTime = "2026-10-01T12:00:00Z";
  const assignee = randomUUID();
  for (const taskType of ["onboarding.follow_up", "member.support", "onboarding.follow_up_other"]) {
    for (const status of ["open", "in_progress", "blocked", "completed", "cancelled"]) {
      const id = randomUUID();
      await db.query(`insert into operator_tasks (
        id,task_type,status,due_at,completed_at,blocked_reason,
        assigned_to_auth_user_id,dismissed_at,dismissed_by_auth_user_id,version,updated_at
      ) values($1,$2,$3,$4,case when $3='completed' then $4::timestamptz end,
        case when $3='blocked' then 'Waiting on operator' end,$5,$4,$5,5,$4)`,
      [id, taskType, status, historicalTime, assignee]);
      if (taskType === "onboarding.follow_up" && ["open", "in_progress", "blocked"].includes(status)) activeTaskIds.set(id, status);
      await db.query(`insert into operator_task_events
        (operator_task_id,event_type,next_status,actor_type,evidence,dedupe_key)
        values($1,'created','open','system','{}',$2)`, [id, `existing:${id}`]);
    }
  }
  for (const [actionType, taskType] of [
    ["create_operator_task", "onboarding.follow_up"],
    ["create_operator_task", "member.support"],
    ["create_operator_task", "onboarding.follow_up_other"],
    ["send_notification", "onboarding.follow_up"],
  ]) {
    for (const status of ["pending", "failed", "processing", "dead_letter", "succeeded", "cancelled"]) {
      const id = randomUUID();
      await db.query(`insert into workflow_actions
        (id,action_type,payload,status,locked_at,locked_by,last_error,completed_at,updated_at)
        values($1,$2,$3,$4,$5,'old-worker','Existing history',
          case when $4 in ('dead_letter','succeeded','cancelled') then $5::timestamptz end,$5)`,
      [id, actionType, JSON.stringify({ task_type: taskType }), status, historicalTime]);
      if (actionType === "create_operator_task" && taskType === "onboarding.follow_up" && ["pending", "failed", "processing", "dead_letter"].includes(status)) activeActionIds.push(id);
    }
  }
  const before = await snapshot();
  await migrate();
  const after = await snapshot();
  for (const task of after.tasks) {
    if (!activeTaskIds.has(task.id)) {
      assert.deepEqual(task, before.tasks.find((row) => row.id === task.id));
      continue;
    }
    assert.equal(task.status, "cancelled");
    assert.equal(task.version, 6);
    assert.equal(task.completed_at, null, "Retirement must not fabricate task completion");
    assert.equal(task.due_at, null);
    assert.equal(task.blocked_reason, null);
    assert.equal(task.assigned_to_auth_user_id, assignee);
    assert.equal(task.dismissed_by_auth_user_id, assignee);
    assert.ok(task.updated_at > new Date(historicalTime));
  }
  const cancellationEvents = after.events.filter((event) => event.event_type === "cancelled");
  assert.equal(cancellationEvents.length, activeTaskIds.size);
  for (const event of cancellationEvents) {
    assert.equal(event.previous_status, activeTaskIds.get(event.operator_task_id));
    assert.equal(event.next_status, "cancelled");
    assert.equal(event.actor_type, "system");
    assert.equal(event.actor_auth_user_id, null);
    assert.deepEqual(event.evidence, { reason: "onboarding_follow_up_retired", task_type: "onboarding.follow_up" });
  }
  assert.deepEqual(after.events.filter((event) => event.event_type !== "cancelled"), before.events);
  for (const action of after.actions) {
    if (!activeActionIds.includes(action.id)) {
      assert.deepEqual(action, before.actions.find((row) => row.id === action.id));
      continue;
    }
    assert.equal(action.status, "cancelled");
    assert.equal(action.last_error, "onboarding_follow_up_retired");
    assert.equal(action.locked_at, null);
    assert.equal(action.locked_by, null);
    assert.ok(action.completed_at > new Date(historicalTime));
  }
  await migrate();
  assert.deepEqual(await snapshot(), after);
});
