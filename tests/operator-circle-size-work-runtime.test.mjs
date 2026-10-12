import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migrationFiles = (await readdir(new URL("../db/migrations/", import.meta.url)))
  .filter(name => name.endsWith("_circle_size_work.sql"));
assert.equal(migrationFiles.length, 1, "exactly one Circle size migration is installed");
const migration = await source(`db/migrations/${migrationFiles[0]}`);

async function fixture(t, { migrate = true, libbyStatus = "active", libbyRole = true } = {}) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  // Exercise the complete migration in PostgreSQL, without network clients,
  // service credentials, or any changes to the live database.
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key);
    create table ruined_members(id uuid primary key, person_id uuid references people(id), unique(id,person_id));
    create table platform_users(auth_user_id uuid primary key, person_id uuid references people(id),
      email_normalized text not null unique, status text not null default 'active', created_at timestamptz default now());
    create table platform_role_grants(id bigint generated always as identity primary key,
      auth_user_id uuid references platform_users(auth_user_id), role_slug text not null,
      granted_at timestamptz default now(), revoked_at timestamptz);
    create unique index active_roles on platform_role_grants(auth_user_id,role_slug) where revoked_at is null;
    create table circles(id uuid primary key, name text not null, capacity integer not null default 10 check(capacity>0),
      status text not null default 'forming' check(status in ('forming','active','completed','archived')),
      created_at timestamptz default now(), updated_at timestamptz default now());
    create table circle_member_assignments(id bigint generated always as identity primary key,
      circle_id uuid not null references circles(id), member_id uuid not null references ruined_members(id),
      assigned_by_auth_user_id uuid references platform_users(auth_user_id), assigned_at timestamptz default now(),
      ended_at timestamptz, end_reason text);
    create unique index current_member_assignment on circle_member_assignments(member_id) where ended_at is null;
    create table circle_staff_assignments(id bigint generated always as identity primary key,
      circle_id uuid not null references circles(id), auth_user_id uuid not null references platform_users(auth_user_id),
      role_slug text not null check(role_slug in ('circle_leader','guide')), ended_at timestamptz);
    create unique index current_staff_assignment on circle_staff_assignments(circle_id,auth_user_id,role_slug) where ended_at is null;
    create unique index current_circle_leader on circle_staff_assignments(circle_id) where role_slug='circle_leader' and ended_at is null;
    create table membership_blocks(id uuid primary key);
  `);
  await db.exec(await source("db/migrations/20261001130000_administrator_leadership_access.sql"));
  await db.exec(await source("db/migrations/20260930101000_circle_placement.sql"));
  const operations = await source("db/migrations/20260826_membership_operating_spine_05_content_operations.sql");
  await db.exec(operations.slice(operations.indexOf("create table if not exists public.operator_tasks ("), operations.indexOf("-- Overrides are immutable")));
  await db.exec(`create function public.ruined_reject_append_only_mutation() returns trigger language plpgsql as
    $$ begin raise exception 'Append-only records'; end $$;
    create trigger operator_task_events_append_only before update or delete on operator_task_events
      for each row execute function public.ruined_reject_append_only_mutation();`);
  const libby = randomUUID(), admin = randomUUID();
  await db.query("insert into platform_users(auth_user_id,email_normalized,status) values($1,'libby@theruinedproject.com',$2),($3,'another-admin@example.test','active')", [libby,libbyStatus,admin]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [admin]);
  if (libbyRole) await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [libby]);
  async function apply() {
    await db.exec(migration);
    await db.exec(`create trigger circle_member_assignments_capacity before insert or update of circle_id,ended_at
      on circle_member_assignments for each row execute function public.ruined_enforce_circle_capacity();`);
  }
  if (migrate) await apply();
  async function member() {
    const id = randomUUID();
    await db.query("insert into people values($1)", [id]);
    await db.query("insert into ruined_members values($1,$1)", [id]);
    return id;
  }
  async function place(circle, memberId = null) {
    const id = memberId ?? await member();
    await db.query("insert into circle_member_assignments(circle_id,member_id,assigned_by_auth_user_id) values($1,$2,$3)", [circle,id,admin]);
    return id;
  }
  async function circle(count = 7, { status = "active", capacity = null, name = "Test Circle" } = {}) {
    const id = randomUUID();
    if (capacity === null) await db.query("insert into circles(id,name) values($1,$2)", [id,name]);
    else await db.query("insert into circles(id,name,capacity) values($1,$2,$3)", [id,name,capacity]);
    const members = [];
    for (let i = 0; i < count; i++) members.push(await place(id));
    await db.query("update circles set status=$2 where id=$1", [id,status]);
    return { id, members };
  }
  async function staff(circle, { person = null, role = "circle_leader" } = {}) {
    const id = randomUUID();
    if (!person) { person = randomUUID(); await db.query("insert into people values($1)", [person]); }
    await db.query("insert into platform_users(auth_user_id,email_normalized,person_id) values($1,$2,$3)", [id,`${id}@example.test`,person]);
    await db.query("insert into circle_staff_assignments(circle_id,auth_user_id,role_slug) values($1,$2,$3)", [circle,id,role]);
    return id;
  }
  const tasks = async circle => (await db.query("select * from operator_tasks where circle_id=$1 order by created_at,id", [circle])).rows;
  const events = async task => (await db.query("select * from operator_task_events where operator_task_id=$1 order by id", [task])).rows;
  const count = async circle => (await db.query("select private.ruined_circle_participant_count($1) n", [circle])).rows[0].n;
  const end = (member, engine = db) => engine.query("update circle_member_assignments set ended_at=statement_timestamp() where member_id=$1 and ended_at is null", [member]);
  return { db, libby, admin, apply, member, place, circle, staff, tasks, events, count, end };
}

test("6 and 14 participants create Libby's work; 7 and 13 do not", async t => {
  const f = await fixture(t);
  for (const size of [6,7,13,14]) {
    const circle = await f.circle(size);
    const tasks = await f.tasks(circle.id);
    if (size === 7 || size === 13) { assert.equal(tasks.length, 0); continue; }
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].task_type, size === 6 ? "circle.size_low" : "circle.size_high");
    assert.equal(tasks[0].assigned_to_auth_user_id, f.libby);
    assert.equal(tasks[0].status, "open");
    assert.equal(tasks[0].created_by_type, "system");
    assert.match(tasks[0].description, new RegExp(String(size)));
    assert.ok((await f.events(tasks[0].id)).some(event => event.event_type === "created" && event.actor_type === "system"));
  }
});

test("default capacity permits 20; 21 needs a fresh administrator review matching the projected count", async t => {
  const f = await fixture(t), circle = await f.circle(20);
  assert.equal((await f.db.query("select capacity from circles where id=$1", [circle.id])).rows[0].capacity, 20);
  const member = await f.member();
  await assert.rejects(f.place(circle.id, member), /requires a current exception review/);
  const review = (await f.db.query(`insert into circle_placement_reviews(member_id,circle_id,requested_by_auth_user_id,
    reason,status,reviewed_by_auth_user_id,reviewed_at,projected_count)
    values($1,$2,$3,'Reviewed exceptional placement','approved',$3,statement_timestamp(),22) returning id`, [member,circle.id,f.admin])).rows[0].id;
  await assert.rejects(f.place(circle.id, member), /requires a current exception review/);
  await f.db.query("update circle_placement_reviews set projected_count=21 where id=$1", [review]);
  await f.place(circle.id, member);
  assert.equal((await f.db.query("select status from circle_placement_reviews where id=$1", [review])).rows[0].status, "placed");
  assert.equal(await f.count(circle.id), 21);
  assert.equal((await f.tasks(circle.id)).length, 1, "continued growth keeps one high-size task");
  const custom = await f.circle(9, { capacity: 9 });
  await assert.rejects(f.place(custom.id), /requires a current exception review/);
});

test("migration upgrades former default capacities, preserves custom limits, and backfills only active exceptions", async t => {
  const f = await fixture(t, { migrate: false });
  const low = await f.circle(6), high = await f.circle(14), normal = await f.circle(7);
  const forming = await f.circle(2, { status: "forming" });
  const archived = await f.circle(2, { status: "archived" });
  const custom = await f.circle(7, { capacity: 9 });
  await f.apply();
  for (const circle of [low,high,normal,forming]) {
    assert.equal((await f.db.query("select capacity from circles where id=$1", [circle.id])).rows[0].capacity, 20);
  }
  assert.equal((await f.db.query("select capacity from circles where id=$1", [custom.id])).rows[0].capacity, 9);
  assert.equal((await f.db.query("select capacity from circles where id=$1", [archived.id])).rows[0].capacity, 10);
  assert.equal((await f.tasks(low.id)).length, 1);
  assert.equal((await f.tasks(high.id)).length, 1);
  for (const circle of [normal,forming,archived,custom]) assert.equal((await f.tasks(circle.id)).length, 0);
});

test("continuous low episode updates its count once, auto-completes on recovery, and creates fresh work after recrossing", async t => {
  const f = await fixture(t), circle = await f.circle(7);
  await f.end(circle.members[0]);
  const [first] = await f.tasks(circle.id);
  await f.end(circle.members[1]);
  await f.db.query("update circles set name='Renamed Circle' where id=$1", [circle.id]);
  const [updated] = await f.tasks(circle.id);
  assert.equal(updated.id, first.id);
  assert.match(updated.description, /5/);
  assert.match(`${updated.title} ${updated.description}`, /Renamed Circle/);
  await f.place(circle.id); await f.place(circle.id);
  const [resolved] = await f.tasks(circle.id);
  assert.equal(resolved.status, "completed"); assert.ok(resolved.completed_at);
  assert.ok((await f.events(first.id)).some(event => event.event_type === "completed"));
  await f.end(circle.members[2]);
  const tasks = await f.tasks(circle.id);
  assert.equal(tasks.length, 2);
  assert.equal(tasks.filter(task => task.status === "open").length, 1);
  assert.equal(new Set(tasks.map(task => task.idempotency_key)).size, 2);
});

test("manual completion is respected throughout an episode; high recovery and direct low-to-high transition stay distinct", async t => {
  const f = await fixture(t), low = await f.circle(6), high = await f.circle(14);
  const [first] = await f.tasks(low.id);
  await f.db.query("update operator_tasks set status='completed',completed_at=statement_timestamp() where id=$1", [first.id]);
  await f.end(low.members[0]);
  assert.equal((await f.tasks(low.id)).length, 1);
  assert.equal((await f.tasks(low.id))[0].status, "completed");
  await f.end(high.members[0]);
  assert.equal((await f.tasks(high.id))[0].status, "completed");
  await f.place(high.id);
  assert.equal((await f.tasks(high.id)).length, 2);
  const added = [];
  for (let i = 0; i < 9; i++) added.push(await f.member());
  await f.db.transaction(async tx => {
    for (const member of added) await tx.query("insert into circle_member_assignments(circle_id,member_id,assigned_by_auth_user_id) values($1,$2,$3)", [low.id,member,f.admin]);
  });
  const tasks = await f.tasks(low.id);
  assert.equal(tasks.length, 2);
  assert.equal(tasks.find(task => task.status === "open").task_type, "circle.size_high");
});

test("deferred triggers use final transaction size and roll back roster changes if auditing fails", async t => {
  const f = await fixture(t), circle = await f.circle(7), replacement = await f.member();
  await f.db.transaction(async tx => {
    await f.end(circle.members[0], tx);
    await tx.query("insert into circle_member_assignments(circle_id,member_id,assigned_by_auth_user_id) values($1,$2,$3)", [circle.id,replacement,f.admin]);
  });
  assert.equal((await f.tasks(circle.id)).length, 0, "temporary 6-person count is never notified");
  await assert.rejects(f.db.transaction(async tx => { await f.end(circle.members[1], tx); throw new Error("rollback rehearsal"); }), /rollback rehearsal/);
  assert.equal(await f.count(circle.id), 7);
  assert.equal((await f.tasks(circle.id)).length, 0);
  await f.db.exec(`create function reject_size_event() returns trigger language plpgsql as $$ begin raise exception 'injected audit failure'; end $$;
    create trigger reject_size_event before insert on operator_task_events for each row execute function reject_size_event();`);
  await assert.rejects(f.end(circle.members[1]), /injected audit failure/);
  assert.equal(await f.count(circle.id), 7);
  assert.equal((await f.tasks(circle.id)).length, 0, "a task and its audit event are atomic");
});

test("member moves reconcile both Circles and direct deletion crosses the lower boundary", async t => {
  const f = await fixture(t), origin = await f.circle(7), destination = await f.circle(13);
  await f.db.query("update circle_member_assignments set circle_id=$2 where member_id=$1 and ended_at is null", [origin.members[0],destination.id]);
  assert.equal((await f.tasks(origin.id))[0].task_type, "circle.size_low");
  assert.equal((await f.tasks(destination.id))[0].task_type, "circle.size_high");
  await f.db.query("update circle_member_assignments set circle_id=$2 where member_id=$1 and ended_at is null", [origin.members[0],origin.id]);
  assert.equal((await f.tasks(origin.id))[0].status, "completed");
  assert.equal((await f.tasks(destination.id))[0].status, "completed");
  await f.db.query("delete from circle_member_assignments where member_id=$1", [origin.members[1]]);
  assert.equal((await f.tasks(origin.id)).filter(task => task.status === "open").length, 1);
});

test("Circle Supporter counts once by person, Guide does not, and staff moves/deletions reconcile size", async t => {
  const f = await fixture(t), circle = await f.circle(6);
  const leader = await f.staff(circle.id, { person: circle.members[0] });
  assert.equal(await f.count(circle.id), 6);
  assert.equal((await f.tasks(circle.id))[0].status, "open");
  await f.staff(circle.id, { role: "guide" });
  assert.equal(await f.count(circle.id), 6);
  await f.db.query("delete from circle_staff_assignments where auth_user_id=$1", [leader]);
  const standalone = await f.staff(circle.id);
  assert.equal(await f.count(circle.id), 7);
  assert.equal((await f.tasks(circle.id))[0].status, "completed");
  const destination = await f.circle(13);
  await f.db.query("update circle_staff_assignments set circle_id=$2 where auth_user_id=$1", [standalone,destination.id]);
  assert.equal((await f.tasks(circle.id)).filter(task => task.status === "open").length, 1);
  assert.equal((await f.tasks(destination.id))[0].task_type, "circle.size_high");
  await f.db.query("delete from circle_staff_assignments where auth_user_id=$1", [standalone]);
  assert.equal((await f.tasks(destination.id))[0].status, "completed");
});

test("forming Circles wait for activation and deactivation cancels outstanding work", async t => {
  const f = await fixture(t), circle = await f.circle(6, { status: "forming" });
  assert.equal((await f.tasks(circle.id)).length, 0);
  await f.db.query("update circles set status='active' where id=$1", [circle.id]);
  const [first] = await f.tasks(circle.id);
  assert.equal(first.status, "open");
  await f.db.query("update circles set status='archived' where id=$1", [circle.id]);
  assert.equal((await f.tasks(circle.id))[0].status, "cancelled");
  assert.ok((await f.events(first.id)).some(event => event.event_type === "cancelled"));
  await f.db.query("update circles set status='active' where id=$1", [circle.id]);
  assert.equal((await f.tasks(circle.id)).length, 2);
});

test("missing or inactive Libby leaves durable unassigned work and later access changes route it to her", async t => {
  const f = await fixture(t, { libbyStatus: "suspended", libbyRole: false });
  const circle = await f.circle(6);
  const [first] = await f.tasks(circle.id);
  assert.equal(first.assigned_to_auth_user_id, null);
  await f.db.query("update platform_users set status='active' where auth_user_id=$1", [f.libby]);
  assert.equal((await f.tasks(circle.id))[0].assigned_to_auth_user_id, null, "active account alone is not administrator authority");
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [f.libby]);
  const [assigned] = await f.tasks(circle.id);
  assert.equal(assigned.id, first.id); assert.equal(assigned.assigned_to_auth_user_id, f.libby);
  assert.ok((await f.events(first.id)).some(event => event.event_type === "assigned"));
  await f.db.query("update platform_users set email_normalized='former-libby@example.test' where auth_user_id=$1", [f.libby]);
  const other = await f.circle(6);
  assert.equal((await f.tasks(other.id))[0].assigned_to_auth_user_id, null);
  await f.db.query("update platform_users set email_normalized='libby@theruinedproject.com' where auth_user_id=$1", [f.libby]);
  assert.equal((await f.tasks(other.id))[0].assigned_to_auth_user_id, f.libby);
});

test("an existing system assignment follows Libby's email and role eligibility while preserving another operator's claim", async t => {
  const f = await fixture(t), circle = await f.circle(6);
  const [task] = await f.tasks(circle.id);
  await f.db.query("update platform_users set email_normalized='former-libby@example.test' where auth_user_id=$1", [f.libby]);
  assert.equal((await f.tasks(circle.id))[0].assigned_to_auth_user_id, null);
  await f.db.query("update platform_users set email_normalized='libby@theruinedproject.com' where auth_user_id=$1", [f.libby]);
  assert.equal((await f.tasks(circle.id))[0].assigned_to_auth_user_id, f.libby);
  await f.db.query("update platform_role_grants set revoked_at=statement_timestamp() where auth_user_id=$1 and role_slug='ops_admin'", [f.libby]);
  assert.equal((await f.tasks(circle.id))[0].assigned_to_auth_user_id, null);
  await f.db.query("update operator_tasks set assigned_to_auth_user_id=$2,status='in_progress' where id=$1", [task.id,f.admin]);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [f.libby]);
  assert.equal((await f.tasks(circle.id))[0].assigned_to_auth_user_id, f.admin);
  assert.equal((await f.tasks(circle.id)).length, 1);
});

test("revoking Libby's access returns in-progress system-routed work to the claimable queue", async t => {
  const f = await fixture(t), circle = await f.circle(6);
  const [task] = await f.tasks(circle.id);
  await f.db.query("update operator_tasks set status='in_progress' where id=$1", [task.id]);
  await f.db.query("update platform_role_grants set revoked_at=statement_timestamp() where auth_user_id=$1 and role_slug='ops_admin'", [f.libby]);
  const [unassigned] = await f.tasks(circle.id);
  assert.equal(unassigned.assigned_to_auth_user_id, null);
  assert.equal(unassigned.status, "open", "an unassigned in-progress task cannot be claimed by the existing operator UI");
  assert.ok((await f.events(task.id)).some(event => event.event_type === "state_changed"
    && event.previous_status === "in_progress" && event.next_status === "open" && event.actor_type === "system"));
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [f.libby]);
  const [restored] = await f.tasks(circle.id);
  assert.equal(restored.id, task.id);
  assert.equal(restored.assigned_to_auth_user_id, f.libby);
  assert.equal(restored.status, "open");
  assert.equal((await f.tasks(circle.id)).length, 1);
});

test("staff identity linkage changing the deduped participant count reconciles both breach and recovery", async t => {
  const f = await fixture(t), circle = await f.circle(6);
  const supporter = await f.staff(circle.id);
  assert.equal(await f.count(circle.id), 7);
  const standalonePerson = (await f.db.query("select person_id from platform_users where auth_user_id=$1", [supporter])).rows[0].person_id;
  await f.db.query("update platform_users set person_id=$2 where auth_user_id=$1", [supporter,circle.members[0]]);
  assert.equal(await f.count(circle.id), 6);
  assert.equal((await f.tasks(circle.id)).filter(task => task.status === "open").length, 1);
  await f.db.query("update platform_users set person_id=$2 where auth_user_id=$1", [supporter,standalonePerson]);
  assert.equal(await f.count(circle.id), 7);
  assert.equal((await f.tasks(circle.id)).filter(task => task.status === "open").length, 0);
});

test("member identity linkage changing the deduped participant count also opens and resolves work", async t => {
  const f = await fixture(t), circle = await f.circle(6), supporter = await f.staff(circle.id);
  const standalonePerson = (await f.db.query("select person_id from platform_users where auth_user_id=$1", [supporter])).rows[0].person_id;
  assert.equal(await f.count(circle.id), 7);
  await f.db.query("update ruined_members set person_id=$2 where id=$1", [circle.members[0],standalonePerson]);
  assert.equal(await f.count(circle.id), 6);
  assert.equal((await f.tasks(circle.id)).filter(task => task.status === "open").length, 1);
  await f.db.query("update ruined_members set person_id=$1 where id=$1", [circle.members[0]]);
  assert.equal(await f.count(circle.id), 7);
  assert.equal((await f.tasks(circle.id)).filter(task => task.status === "open").length, 0);
});

test("browser roles cannot read or mutate Circle size bookkeeping or execute its private functions", async t => {
  const f = await fixture(t);
  const table = (await f.db.query("select relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=relnamespace where nspname='public' and relname='circle_size_work'")).rows[0];
  assert.equal(table.relrowsecurity, true);
  for (const role of ["anon", "authenticated"]) {
    const privileges = (await f.db.query(`select has_table_privilege($1,'public.circle_size_work','SELECT') as read,
      has_table_privilege($1,'public.circle_size_work','INSERT,UPDATE,DELETE') as write,
      has_function_privilege($1,'private.ruined_reconcile_circle_size_work(uuid)','EXECUTE') as execute`, [role])).rows[0];
    assert.deepEqual(privileges, { read: false, write: false, execute: false });
  }
  const functions = (await f.db.query(`select proname,prosecdef,proconfig from pg_proc join pg_namespace on pg_namespace.oid=pronamespace
    where nspname='private' and proname like '%circle_size%'`)).rows;
  assert.ok(functions.length > 0);
  for (const fn of functions) { assert.equal(fn.prosecdef, false); assert.ok(fn.proconfig.some(value => value.startsWith("search_path="))); }
});
