import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const legacyMigrationPath = "db/migrations/20261005190000_registration_operator_work.sql";
const migrationPath = "db/migrations/20261008100000_registration_checkpoint_work.sql";
async function load(path, dependencies = {}) {
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ts.transpileModule(await source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(name => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected ${name}`); return dependencies[name]; }, loaded, loaded.exports);
  return loaded.exports;
}
const journey = await load("src/lib/membership/operator-registration-progress.ts");
const defaultProgress = {
  state: "collecting", registeredAt: null, profileComplete: true, ready: false,
  requiresInitialPayment: false, requiresPaymentMethod: true, completionBasis: null,
  emailVerified: true, paymentMethodState: "missing", paymentConfirmed: false,
  paidCheckoutAvailable: true, paymentNeedsReview: false, billingArranged: false,
  billingState: "pending", serviceStartsAt: null,
};
async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key, status text default 'active');
    create table ruined_members(id uuid primary key, person_id uuid references people(id),
      membership_state text default 'pending', deleted_at timestamptz, unique(id,person_id));
    create table member_lifecycle(member_id uuid primary key, account_state text default 'active', billing_state text default 'pending', program_state text default 'prospect');
    create table platform_users(auth_user_id uuid primary key);
    create table circles(id uuid primary key); create table membership_blocks(id uuid primary key);
    create table member_registration_access(member_id uuid primary key, progress jsonb);
    create table member_payment_method_setup_attempts(id uuid primary key, member_id uuid);
    create function private.ruined_lock_member_complimentary_funding(id uuid) returns boolean language sql as $$ select true $$;
  `);
  const operations = await source("db/migrations/20260826_membership_operating_spine_05_content_operations.sql");
  await db.exec(operations.slice(operations.indexOf("create table if not exists public.operator_tasks ("), operations.indexOf("-- Overrides are immutable")));
  await db.exec(`create function public.ruined_reject_append_only_mutation() returns trigger language plpgsql as
    $$ begin raise exception 'Append-only records'; end $$;
    create trigger operator_task_events_append_only before update or delete on operator_task_events
      for each row execute function public.ruined_reject_append_only_mutation();`);
  await db.exec(await source(legacyMigrationPath));
  const migration = await source(migrationPath);
  await db.exec(migration);
  const failures = { events: false };
  function sqlFor(engine) {
    const sql = async (parts, ...values) => {
      const query = parts.reduce((out, part, index) => out + (index ? `$${index}` : "") + part, "");
      if (failures.events && /insert into operator_task_events/.test(query)) throw new Error("Injected event failure");
      return (await engine.query(query, values)).rows;
    };
    sql.json = JSON.stringify;
    sql.begin = fn => engine.transaction(tx => fn(sqlFor(tx)));
    return sql;
  }
  const { reconcileRegistrationOperatorWork: reconcile } = await load("src/lib/platform/registration-work-repository.ts", {
    "server-only": {}, "node:crypto": crypto,
    "@/lib/database/server": { getApplicationDatabase: () => sqlFor(db) },
    "@/lib/membership/operator-registration-progress": journey,
    // Evidence projection is tested in the registration repository tests. These
    // queue tests exercise real SQL/tasks/migrations with the shipped journey.
    "@/lib/membership/registration-repository": { readMemberRegistrationProgress: async (tx, ids) => {
      const rows = await tx`select member_id, progress from member_registration_access where member_id = any(${ids}::uuid[])`;
      return new Map(rows.map(row => [row.member_id, row.progress]));
    } },
  });
  async function member(progress = {}, { enrolled = true } = {}) {
    const id = crypto.randomUUID(), auth = crypto.randomUUID();
    await db.query("insert into people(id) values($1)", [id]);
    await db.query("insert into ruined_members(id,person_id) values($1,$1)", [id]);
    await db.query("insert into member_lifecycle(member_id) values($1)", [id]);
    await db.query("insert into platform_users values($1)", [auth]);
    if (enrolled) await db.query("insert into member_registration_access values($1,$2)", [id, JSON.stringify({ ...defaultProgress, ...progress })]);
    return { id, auth };
  }
  async function update(member, progress) {
    await db.query("update member_registration_access set progress=progress || $2::jsonb where member_id=$1", [member.id, JSON.stringify(progress)]);
  }
  async function legacy(member, { status = "open", claimed = false, resolution = null, createdAt = "2026-10-05T12:00:00Z" } = {}) {
    const id = crypto.randomUUID(), attempt = crypto.randomUUID();
    await db.query("insert into member_payment_method_setup_attempts values($1,$2)", [attempt, member.id]);
    await db.query(`insert into operator_tasks(id,member_id,person_id,task_type,title,description,status,assigned_to_auth_user_id,created_by_type,created_at,completed_at)
      values($1,$2,$2,'registration.billing_review','Review membership billing','Old review',$3,$4,'system',$5,case when $3='completed' then now() else null end)`,
    [id, member.id, status, claimed ? member.auth : null, createdAt]);
    await db.query("insert into registration_operator_work(member_id,payment_setup_attempt_id,operator_task_id,resolution_reason,resolved_at) values($1,$2,$3,$4,case when $4::text is not null then now() else null end)", [member.id, attempt, id, resolution]);
    await db.query(`insert into operator_task_events(operator_task_id,event_type,next_status,actor_type,evidence,dedupe_key)
      values($1,'created',$2,'system','{"source":"legacy"}',$3)`, [id, status, `legacy:${id}`]);
    return { id, attempt };
  }
  const tasks = async id => (await db.query("select * from operator_tasks where member_id=$1 order by created_at,id", [id])).rows;
  const registry = async id => (await db.query("select * from registration_checkpoint_work where member_id=$1 order by checkpoint", [id])).rows;
  return { db, failures, reconcile, member, update, legacy, tasks, registry, migration };
}

test("Aaron-style incomplete legacy signup and new prepaid signup get the same durable checkout follow-up", async t => {
  const f = await fixture(t);
  const legacy = await f.member();
  const prepaid = await f.member({ requiresInitialPayment: true, requiresPaymentMethod: false });
  assert.deepEqual(await f.reconcile(), { created: 2, updated: 0, resolved: 0 });
  for (const member of [legacy, prepaid]) {
    const [task] = await f.tasks(member.id);
    assert.equal(task.task_type, "registration.checkpoint.payment");
    assert.equal(task.title, "Complete membership checkout");
    assert.match(task.description, /No separate card-saving step/);
    assert.equal(task.status, "open"); assert.equal(task.due_at, null);
  }
  assert.deepEqual(await f.reconcile(), { created: 0, updated: 0, resolved: 0 });
  await Promise.all([f.reconcile(), f.reconcile()]);
  assert.equal((await f.tasks(legacy.id)).length, 1);
  assert.equal((await f.db.query("select count(*)::int n from member_payment_method_setup_attempts")).rows[0].n, 0, "no saved card is required to track payment work");
});

test("email, information, payment and profile tasks advance one checkpoint at a time without releasing access", async t => {
  const f = await fixture(t), member = await f.member({ emailVerified: false, profileComplete: false });
  await f.reconcile(); assert.equal((await f.registry(member.id))[0].checkpoint, "email");
  await f.update(member, { emailVerified: true });
  assert.deepEqual(await f.reconcile(), { created: 1, updated: 0, resolved: 1 });
  assert.equal((await f.tasks(member.id)).find(row => row.status === "open").title, "Complete registration information");
  await f.update(member, { profileComplete: true });
  assert.deepEqual(await f.reconcile(), { created: 1, updated: 0, resolved: 1 });
  await f.update(member, { paymentMethodState: "saved", registeredAt: "2026-10-08T12:00:00Z", ready: true, completionBasis: "saved_card" });
  await f.reconcile(); assert.equal((await f.tasks(member.id)).length, 3, "saving a card is not a new payment obligation");
  const [before] = (await f.tasks(member.id)).filter(row => row.status === "open");
  await f.db.query("update operator_tasks set assigned_to_auth_user_id=$2,status='in_progress' where id=$1", [before.id, member.auth]);
  await f.update(member, { paymentConfirmed: true });
  assert.deepEqual(await f.reconcile(), { created: 1, updated: 0, resolved: 1 });
  const tasks = await f.tasks(member.id), closedPayment = tasks.find(row => row.id === before.id);
  assert.equal(closedPayment.status, "completed"); assert.equal(closedPayment.assigned_to_auth_user_id, member.auth);
  assert.equal(tasks.find(row => row.status === "open").title, "Grant profile access");
  assert.equal((await f.db.query("select progress->>'state' state from member_registration_access where member_id=$1", [member.id])).rows[0].state, "collecting", "queue did not grant access");
  await f.update(member, { profileGranted: true, state: "activated" });
  assert.deepEqual(await f.reconcile(), { created: 0, updated: 0, resolved: 1 });
  assert.equal((await f.tasks(member.id)).filter(row => ["open", "blocked", "in_progress"].includes(row.status)).length, 0);
});

test("legacy live billing review is adopted in place with claim, task ID and event history intact", async t => {
  const f = await fixture(t), member = await f.member({ paymentMethodState: "saved", completionBasis: "saved_card" });
  const old = await f.legacy(member, { status: "in_progress", claimed: true });
  assert.deepEqual(await f.reconcile(), { created: 0, updated: 1, resolved: 0 });
  const [task] = await f.tasks(member.id);
  assert.equal(task.id, old.id); assert.equal(task.assigned_to_auth_user_id, member.auth); assert.equal(task.status, "in_progress");
  assert.equal(task.title, "Complete membership checkout");
  assert.equal((await f.registry(member.id))[0].operator_task_id, old.id);
  assert.equal((await f.db.query("select count(*)::int n from operator_task_events where operator_task_id=$1", [old.id])).rows[0].n, 2);
  assert.equal((await f.db.query("select payment_setup_attempt_id from registration_operator_work where operator_task_id=$1", [old.id])).rows[0].payment_setup_attempt_id, old.attempt);
  await f.update(member, { paymentMethodState: "removed" }); await f.reconcile();
  await f.update(member, { paymentMethodState: "saved" }); await f.reconcile();
  assert.equal((await f.tasks(member.id)).length, 1);
});

test("manually completed legacy and checkpoint reviews stay complete even when saved-card evidence changes", async t => {
  const f = await fixture(t);
  for (const status of ["completed", "cancelled"]) {
    const member = await f.member({ paymentMethodState: "saved" });
    const old = await f.legacy(member, { status, claimed: true });
    assert.deepEqual(await f.reconcile(), { created: 0, updated: 0, resolved: 0 });
    await f.update(member, { paymentMethodState: "removed" }); await f.reconcile();
    assert.equal((await f.tasks(member.id)).length, 1); assert.equal((await f.tasks(member.id))[0].id, old.id);
    assert.equal((await f.tasks(member.id))[0].status, status);
  }
  const current = await f.member(); await f.reconcile();
  const [task] = await f.tasks(current.id);
  await f.db.query("update operator_tasks set status='completed',completed_at=now(),assigned_to_auth_user_id=$2 where id=$1", [task.id, current.auth]);
  await f.update(current, { paymentMethodState: "saved" });
  assert.deepEqual(await f.reconcile(), { created: 0, updated: 0, resolved: 0 });
  assert.equal((await f.tasks(current.id)).length, 1);
});

test("operator completion stays durable even when the task was previously resolved by the worker", async t => {
  const f = await fixture(t), member = await f.member();
  await f.reconcile(); const [task] = await f.tasks(member.id);
  await f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1", [member.id]);
  await f.reconcile();
  await f.db.query("update operator_tasks set status='completed',completed_at=now(),assigned_to_auth_user_id=$2 where id=$1", [task.id, member.auth]);
  await f.db.query(`insert into operator_task_events(operator_task_id,event_type,previous_status,next_status,actor_type,actor_auth_user_id,evidence)
    values($1,'completed','in_progress','completed','operator',$2,'{}')`, [task.id, member.auth]);
  await f.db.query("update member_lifecycle set account_state='active' where member_id=$1", [member.id]);
  assert.deepEqual(await f.reconcile(), { created: 0, updated: 0, resolved: 0 });
  assert.equal((await f.tasks(member.id))[0].status, "completed");
});

test("legacy adoption prefers live claims over old completed consent history and never duplicates them", async t => {
  const f = await fixture(t), member = await f.member();
  await f.legacy(member, { status: "completed", createdAt: "2026-10-04T12:00:00Z" });
  const active = await f.legacy(member, { status: "blocked", claimed: true });
  await f.reconcile();
  assert.equal((await f.registry(member.id))[0].operator_task_id, active.id);
  assert.equal((await f.tasks(member.id)).length, 2);
  assert.equal((await f.tasks(member.id)).find(row => row.id === active.id).assigned_to_auth_user_id, member.auth);
});

test("refunds, pending confirmation and historical billing are review tasks instead of requests to pay twice", async t => {
  const f = await fixture(t);
  for (const progress of [{ paymentNeedsReview: true }, { billingArranged: true }, { billingState: "attention_required" }, { historicalPaymentRecorded: true }, { completionBasis: "paid_membership" }]) {
    const member = await f.member(progress); await f.reconcile();
    const [task] = await f.tasks(member.id);
    assert.equal(task.task_type, "registration.checkpoint.review");
    assert.match(task.description, /before requesting|before starting|historical payment/);
    assert.doesNotMatch(task.description, /pays through Stripe at/);
  }
  const paid = await f.member({ paymentConfirmed: true, ready: true, registeredAt: "2026-10-08T12:00:00Z" });
  await f.reconcile();
  await f.update(paid, { paymentConfirmed: false, paymentNeedsReview: true });
  const changed = await f.reconcile(); assert.equal(changed.created, 1); assert.equal(changed.resolved, 1);
  assert.equal((await f.tasks(paid.id)).find(row => row.status === "open").task_type, "registration.checkpoint.review");
  await f.update(paid, { paymentConfirmed: true, paymentNeedsReview: false });
  await f.reconcile();
  assert.equal((await f.tasks(paid.id)).length, 2, "returning to profile checkpoint reuses its task");
});

test("complimentary members skip payment tasks and shared billing does not ask the partner to pay separately", async t => {
  const f = await fixture(t), comp = await f.member({ paymentExempt: true, requiresInitialPayment: false, requiresPaymentMethod: false, registeredAt: "2026-10-08T12:00:00Z", ready: true });
  const partner = await f.member({ paymentByPartner: true });
  await f.reconcile();
  assert.equal((await f.tasks(comp.id))[0].task_type, "registration.checkpoint.profile");
  assert.equal((await f.tasks(partner.id)).length, 0, "only the canonical payer receives a payment obligation");
  await f.update(partner, { profileComplete: false }); await f.reconcile();
  assert.equal((await f.tasks(partner.id))[0].task_type, "registration.checkpoint.information");
  await f.update(partner, { profileComplete: true, paymentConfirmed: true, ready: true, registeredAt: "2026-10-08T12:00:00Z" });
  await f.reconcile();
  assert.equal((await f.tasks(partner.id)).find(row => row.status === "open").task_type, "registration.checkpoint.profile");
});

test("checkout release gates block payment work and restore the existing claimant when reopened", async t => {
  const f = await fixture(t), member = await f.member({ paidCheckoutAvailable: false });
  await f.reconcile(); let [task] = await f.tasks(member.id);
  assert.equal(task.status, "blocked"); assert.equal(task.due_at, null);
  await f.db.query("update operator_tasks set assigned_to_auth_user_id=$2 where id=$1", [task.id, member.auth]);
  await f.update(member, { paidCheckoutAvailable: true }); await f.reconcile();
  [task] = await f.tasks(member.id); assert.equal(task.status, "in_progress"); assert.equal(task.assigned_to_auth_user_id, member.auth);
  await f.update(member, { paidCheckoutAvailable: false }); await f.reconcile();
  [task] = await f.tasks(member.id); assert.equal(task.status, "blocked"); assert.equal(task.assigned_to_auth_user_id, member.auth);
});

test("ended, suspended, deleted and inactive members produce no new enrollment tasks; prior live work is retained as resolved history", async t => {
  const f = await fixture(t), oldAdmin = await f.member({}, { enrolled: false });
  assert.deepEqual(await f.reconcile(), { created: 0, updated: 0, resolved: 0 });
  assert.equal((await f.tasks(oldAdmin.id)).length, 0);
  for (const sql of ["update ruined_members set deleted_at=now() where id=$1", "update people set status='inactive' where id=$1", "update member_lifecycle set account_state='suspended' where member_id=$1", "update member_lifecycle set account_state='closed' where member_id=$1", "update member_lifecycle set billing_state='ended' where member_id=$1", "update ruined_members set membership_state='ended' where id=$1", "update member_lifecycle set program_state='withdrawn' where member_id=$1"]) {
    const member = await f.member(); await f.reconcile();
    const [task] = await f.tasks(member.id);
    await f.db.query(sql, [member.id]);
    assert.equal((await f.reconcile()).resolved, 1);
    assert.equal((await f.tasks(member.id)).length, 1); assert.equal((await f.tasks(member.id))[0].id, task.id);
    assert.equal((await f.tasks(member.id))[0].status, "cancelled");
    assert.equal((await f.registry(member.id))[0].resolution_reason, "member_no_longer_eligible");
  }
  assert.deepEqual(await f.reconcile(), { created: 0, updated: 0, resolved: 0 });
});

test("a suppressed member can resume the same system-resolved task with ownership preserved", async t => {
  const f = await fixture(t), member = await f.member(); await f.reconcile();
  const [task] = await f.tasks(member.id);
  await f.db.query("update operator_tasks set assigned_to_auth_user_id=$2,status='in_progress' where id=$1", [task.id, member.auth]);
  await f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1", [member.id]); await f.reconcile();
  await f.db.query("update member_lifecycle set account_state='active' where member_id=$1", [member.id]);
  assert.deepEqual(await f.reconcile(), { created: 0, updated: 1, resolved: 0 });
  const [restored] = await f.tasks(member.id); assert.equal(restored.id, task.id); assert.equal(restored.assigned_to_auth_user_id, member.auth); assert.equal(restored.status, "in_progress");
});

test("event failures roll back task/registry writes and registry identities stay private and immutable", async t => {
  const f = await fixture(t), member = await f.member();
  f.failures.events = true; await assert.rejects(f.reconcile(), /Injected event failure/);
  assert.equal((await f.tasks(member.id)).length, 0); assert.equal((await f.registry(member.id)).length, 0);
  f.failures.events = false; await f.reconcile(); await f.db.exec(f.migration);
  await assert.rejects(f.db.exec("delete from registration_checkpoint_work"), /history must be retained/);
  await assert.rejects(f.db.exec("update registration_checkpoint_work set checkpoint='review'"), /identity is immutable/);
  await assert.rejects(f.db.exec("update operator_task_events set evidence='{}'"), /Append-only/);
  for (const role of ["anon", "authenticated"]) assert.equal((await f.db.query("select has_table_privilege($1,'registration_checkpoint_work','select') allowed", [role])).rows[0].allowed, false);
  assert.equal((await f.db.query("select relrowsecurity enabled from pg_class where oid='registration_checkpoint_work'::regclass")).rows[0].enabled, true);
  const other = await f.member();
  await assert.rejects(f.db.query("insert into registration_checkpoint_work(member_id,checkpoint,operator_task_id) values($1,'email',$2)", [other.id, (await f.tasks(member.id))[0].id]), /must match/);
});

test("checkpoint migration applies after the complete deployed schema without backfilling tasks or changing members", async t => {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite(); t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const paths = [...((await source("scripts/migrate-platform.mjs")).matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g))].map(match => match[1]);
  assert.ok(paths.includes(migrationPath));
  for (const path of paths.slice(0, paths.indexOf(migrationPath))) await db.exec(await source(path));
  await db.exec(await source(migrationPath)); await db.exec(await source(migrationPath));
  assert.equal((await db.query("select count(*)::int n from registration_checkpoint_work")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from operator_tasks where task_type like 'registration.%'")).rows[0].n, 0);
});
