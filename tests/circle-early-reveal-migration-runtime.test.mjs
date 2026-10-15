import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = new URL("../db/migrations/20261015120000_circle_early_reveal.sql", import.meta.url);

async function fixture() {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    grant usage on schema private to anon, authenticated;
    create table platform_users(auth_user_id uuid primary key, status text);
    create table platform_role_grants(auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table ruined_members(id uuid primary key);
    create table circles(id uuid primary key, status text default 'active', activated_at timestamptz default now() - interval '1 day', ends_at timestamptz);
    create table member_lifecycle(member_id uuid, foundations_state text default 'in_progress', current_progression_level_slug text default 'member',
      account_state text default 'active', billing_state text default 'active', standing_state text default 'active', profile_released boolean default true);
    create table circle_member_assignments(id bigint primary key, member_id uuid, circle_id uuid, assigned_at timestamptz default now() - interval '1 day', ended_at timestamptz);
    create table block_circle_assignments(circle_id uuid, block_id uuid, assigned_at timestamptz, ended_at timestamptz);
    create table accountability_partner_assignments(member_one_id uuid, member_two_id uuid);
    create table learning_resources(id uuid, status text);
    create table learning_resource_targets(learning_resource_id uuid, audience_type text, circle_id uuid, block_id uuid, progression_level_slug text);
    create table circle_resources(learning_resource_id uuid, circle_id uuid, ended_at timestamptz);
    create table member_announcements(id uuid, status text, published_at timestamptz);
    create table member_announcement_targets(announcement_id uuid, target_type text, member_id uuid, circle_id uuid, block_id uuid, progression_level_slug text);
    create table operator_notification_dispatches(id uuid, target_type text);
    create table member_notifications(id uuid, member_id uuid, notification_type text, announcement_id uuid, operator_dispatch_id uuid);
    create table foundation_enrollments(id uuid, member_id uuid, status text);
    create table foundation_unit_progress(id uuid, status text);
    create table member_milestones(id uuid); create table artifact_awards(id uuid); create table workflow_actions(id uuid);
    create function private.ruined_current_membership_id() returns uuid language sql stable as $$select current_setting('test.member_id')::uuid$$;
    create function private.ruined_current_active_access_member_id() returns uuid language sql stable security definer set search_path='' as $$
      select member_id from public.member_lifecycle where member_id=private.ruined_current_membership_id()
        and account_state='active' and billing_state='active' and standing_state='active' and profile_released$$;
    create function private.ruined_current_updates_member_id() returns uuid language sql stable as $$select private.ruined_current_active_access_member_id()$$;
    alter table circle_member_assignments enable row level security;
    alter table accountability_partner_assignments enable row level security;
    alter table member_notifications enable row level security;
    create policy member_notifications_select_self on member_notifications for select to authenticated using(member_id=private.ruined_current_updates_member_id());
    grant select on circle_member_assignments, accountability_partner_assignments, member_notifications to authenticated;
    insert into platform_users values('${id(10)}','active'),('${id(11)}','active');
    insert into platform_role_grants values('${id(10)}','ops_admin',null);
    insert into ruined_members values('${id(1)}'),('${id(2)}');
    insert into member_lifecycle(member_id) values('${id(1)}'),('${id(2)}');
    insert into circles(id) values('${id(3)}'),('${id(4)}');
    insert into circle_member_assignments(id,member_id,circle_id) values(1,'${id(1)}','${id(3)}'),(2,'${id(2)}','${id(3)}');
    insert into block_circle_assignments values('${id(3)}','${id(5)}',now(),null);
    insert into learning_resources values('${id(6)}','published');
    insert into circle_resources values('${id(6)}','${id(3)}',null);
    insert into member_announcements values('${id(7)}','published',now());
    insert into member_announcement_targets(announcement_id,target_type,circle_id) values('${id(7)}','circle','${id(3)}');
    insert into accountability_partner_assignments values('${id(1)}','${id(2)}');
    insert into member_notifications values('${id(8)}','${id(1)}','circle',null,null);
    select set_config('test.member_id','${id(1)}',false);
  `);
  await db.exec(await readFile(new URL("../db/migrations/20260930102000_circle_reveal.sql", import.meta.url), "utf8"));
  await db.exec("grant execute on all functions in schema private to authenticated");
  await db.exec(await readFile(migration, "utf8"));
  return db;
}

const grant = (db, assignment = 1) => db.query(`insert into member_circle_reveal_grants(circle_member_assignment_id,granted_by_auth_user_id,reason)
  values($1,$2,'Approved early access to review the Founders Circle experience') returning *`, [assignment, id(10)]);
const reveal = async (db, member = id(1)) => (await db.query("select private.ruined_member_circle_is_revealed($1) as revealed", [member])).rows[0].revealed;
async function asMember(db, callback, member = id(1)) {
  await db.query("select set_config('test.member_id',$1,false)", [member]);
  await db.exec("set role authenticated");
  try { return await callback(); } finally { await db.exec("reset role"); }
}
const access = (db) => db.query(`select private.ruined_current_circle_is_revealed() as revealed,
  (select count(*)::int from circle_member_assignments) as assignments,
  (select count(*)::int from accountability_partner_assignments) as partners,
  private.ruined_current_active_access_block_id() as block_id,
  private.ruined_can_access_learning_resource('${id(6)}') as resource,
  private.ruined_can_read_announcement('${id(7)}') as announcement,
  (select count(*)::int from member_notifications) as notifications`).then(result => result.rows[0]);

test("an audited assignment grant reveals existing Circle content without fabricating Foundations completion", async () => {
  const db = await fixture();
  try {
    assert.equal((await db.query("select count(*)::int as n from member_circle_reveal_grants")).rows[0].n, 0, "migration grants nobody access");
    assert.deepEqual(await asMember(db, () => access(db)), { revealed: false, assignments: 0, partners: 0, block_id: null, resource: false, announcement: false, notifications: 0 });
    const granted = (await grant(db)).rows[0];
    assert.equal(granted.member_id, id(1));
    assert.equal(granted.circle_id, id(3));
    assert.equal(granted.granted_by_auth_user_id, id(10));
    assert.deepEqual(await asMember(db, () => access(db)), { revealed: true, assignments: 1, partners: 1, block_id: id(5), resource: true, announcement: true, notifications: 1 });
    assert.equal(await reveal(db, id(2)), false, "other members in the same Circle do not inherit the grant");
    assert.equal(await reveal(db, null), false);
    assert.deepEqual((await db.query("select foundations_state from member_lifecycle order by member_id")).rows.map(row => row.foundations_state), ["in_progress", "in_progress"]);
    for (const table of ["foundation_enrollments", "foundation_unit_progress", "member_milestones", "artifact_awards", "workflow_actions"]) {
      assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n, 0, `${table} remains untouched`);
    }
  } finally { await db.close(); }
});

test("early reveal cannot follow an ended, edited, future, transferred or revoked assignment", async () => {
  const db = await fixture();
  try {
    await grant(db);
    for (const [sql, restore] of [
      ["update circle_member_assignments set ended_at=now() where id=1", "update circle_member_assignments set ended_at=null where id=1"],
      [`update circle_member_assignments set circle_id='${id(4)}' where id=1`, `update circle_member_assignments set circle_id='${id(3)}' where id=1`],
      [`update circle_member_assignments set member_id='${id(2)}' where id=1`, `update circle_member_assignments set member_id='${id(1)}' where id=1`],
      ["update circle_member_assignments set assigned_at=now()+interval '1 day' where id=1", "update circle_member_assignments set assigned_at=now()-interval '1 day' where id=1"],
      [`update circles set status='forming' where id='${id(3)}'`, `update circles set status='active' where id='${id(3)}'`],
      [`update circles set activated_at=now()+interval '1 day' where id='${id(3)}'`, `update circles set activated_at=now()-interval '1 day' where id='${id(3)}'`],
      [`update circles set ends_at=now()-interval '1 second' where id='${id(3)}'`, `update circles set ends_at=null where id='${id(3)}'`],
    ]) {
      await db.exec(sql);
      assert.equal(await reveal(db), false, sql);
      assert.equal(await reveal(db, id(2)), false, "grant cannot transfer to another member");
      await db.exec(restore);
      assert.equal(await reveal(db), true);
    }
    await db.exec(`update circle_member_assignments set ended_at=now() where id=1;
      insert into circle_member_assignments(id,member_id,circle_id) values(3,'${id(1)}','${id(4)}')`);
    assert.equal(await reveal(db), false, "new placement requires a separate approval");
    await grant(db, 3);
    assert.equal(await reveal(db), true);
    await db.exec(`update member_circle_reveal_grants set revoked_at=now(),revoked_by_auth_user_id='${id(10)}',revoke_reason='The preview is now finished' where circle_member_assignment_id=3`);
    assert.equal(await reveal(db), false);
    await db.exec(`update member_lifecycle set foundations_state='completed' where member_id='${id(1)}'`);
    assert.equal(await reveal(db), true, "ordinary completed Foundations reveal remains intact");
  } finally { await db.close(); }
});

test("early reveal retains account, billing, profile release and standing access gates", async () => {
  const db = await fixture();
  try {
    await grant(db);
    for (const [column, denied, restored] of [["account_state", "'suspended'", "'active'"], ["billing_state", "'pending'", "'active'"], ["standing_state", "'paused'", "'active'"], ["profile_released", "false", "true"]]) {
      await db.exec(`update member_lifecycle set ${column}=${denied} where member_id='${id(1)}'`);
      const row = await asMember(db, () => access(db));
      assert.equal(row.revealed, true, "approval does not replace baseline entitlement");
      assert.deepEqual({ ...row, revealed: false }, { revealed: false, assignments: 0, partners: 0, block_id: null, resource: false, announcement: false, notifications: 0 }, column);
      await db.exec(`update member_lifecycle set ${column}=${restored} where member_id='${id(1)}'`);
    }
    assert.equal((await asMember(db, () => access(db), id(2))).revealed, false);
  } finally { await db.close(); }
});

test("clients cannot read or forge grants; approval evidence is immutable and revocation requires an Administrator", async () => {
  const db = await fixture();
  try {
    await asMember(db, async () => {
      await assert.rejects(db.query("select * from member_circle_reveal_grants"), /permission denied/);
      await assert.rejects(grant(db), /permission denied/);
      await assert.rejects(db.query(`select private.ruined_member_circle_is_revealed('${id(2)}')`), /permission denied/);
    });
    await db.exec("set role anon");
    await assert.rejects(db.query("select private.ruined_current_circle_is_revealed()"), /permission denied/);
    await db.exec("reset role");
    await assert.rejects(db.query(`insert into member_circle_reveal_grants(circle_member_assignment_id,granted_by_auth_user_id,reason) values(1,'${id(11)}','Unapproved operator attempts to grant access')`), /Administrator/);
    await assert.rejects(db.query(`insert into member_circle_reveal_grants(circle_member_assignment_id,member_id,granted_by_auth_user_id,reason) values(1,'${id(2)}','${id(10)}','Approved member does not match the assignment')`), /must match/);
    await grant(db);
    await assert.rejects(grant(db), /duplicate key/);
    await assert.rejects(db.query("update member_circle_reveal_grants set reason='Rewrite the original approval'"), /immutable/);
    await assert.rejects(db.query("delete from member_circle_reveal_grants"), /cannot be deleted/);
    await assert.rejects(db.query(`update member_circle_reveal_grants set revoked_at=now(),revoked_by_auth_user_id='${id(11)}',revoke_reason='Unapproved operator tries to revoke access'`), /Administrator/);
    await db.exec(`update member_circle_reveal_grants set revoked_at=now(),revoked_by_auth_user_id='${id(10)}',revoke_reason='This specific early-access approval is withdrawn'`);
    await assert.rejects(db.query("update member_circle_reveal_grants set revoked_at=null,revoked_by_auth_user_id=null,revoke_reason=null"), /immutable/);
    assert.equal(await reveal(db), false);
  } finally { await db.close(); }
});
