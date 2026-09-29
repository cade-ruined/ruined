import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("Circle reveal migration executes and RLS plus definer helpers conceal an approved placement", async () => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema private;
      grant usage on schema private to authenticated;
      create table member_lifecycle(member_id uuid, foundations_state text, current_progression_level_slug text);
      create table circle_member_assignments(id bigint, member_id uuid, circle_id uuid, assigned_at timestamptz, ended_at timestamptz);
      create table block_circle_assignments(circle_id uuid, block_id uuid, assigned_at timestamptz, ended_at timestamptz);
      create table accountability_partner_assignments(member_one_id uuid, member_two_id uuid);
      create table learning_resources(id uuid, status text);
      create table learning_resource_targets(learning_resource_id uuid, audience_type text, circle_id uuid, block_id uuid, progression_level_slug text);
      create table circle_resources(learning_resource_id uuid, circle_id uuid, ended_at timestamptz);
      create table member_announcements(id uuid, status text, published_at timestamptz);
      create table member_announcement_targets(announcement_id uuid, target_type text, member_id uuid, circle_id uuid, block_id uuid, progression_level_slug text);
      create table operator_notification_dispatches(id uuid, target_type text);
      create table member_notifications(id uuid, member_id uuid, notification_type text, announcement_id uuid, operator_dispatch_id uuid);
      create function private.ruined_current_membership_id() returns uuid language sql stable as $$select '${id(1)}'::uuid$$;
      create function private.ruined_current_active_access_member_id() returns uuid language sql stable as $$select '${id(1)}'::uuid$$;
      create function private.ruined_current_updates_member_id() returns uuid language sql stable as $$select '${id(1)}'::uuid$$;
      alter table circle_member_assignments enable row level security;
      alter table accountability_partner_assignments enable row level security;
      alter table member_notifications enable row level security;
      create policy member_notifications_select_self on member_notifications for select to authenticated using(member_id=private.ruined_current_membership_id());
      grant select on circle_member_assignments, accountability_partner_assignments, member_notifications to authenticated;
      insert into member_lifecycle values('${id(1)}','in_progress','member');
      insert into circle_member_assignments values(1,'${id(1)}','${id(2)}',now(),null);
      insert into block_circle_assignments values('${id(2)}','${id(3)}',now(),null);
      insert into learning_resources values('${id(4)}','published'),('${id(5)}','published');
      insert into circle_resources values('${id(4)}','${id(2)}',null);
      insert into learning_resource_targets(learning_resource_id,audience_type) values('${id(5)}','all_members');
      insert into member_announcements values('${id(6)}','published',now()),('${id(7)}','published',now());
      insert into member_announcement_targets(announcement_id,target_type,circle_id) values('${id(6)}','circle','${id(2)}');
      insert into member_announcement_targets(announcement_id,target_type) values('${id(7)}','all_active_members');
      insert into operator_notification_dispatches values('${id(8)}','circle');
      insert into member_notifications values('${id(9)}','${id(1)}','circle',null,null),('${id(10)}','${id(1)}','system',null,'${id(8)}'),('${id(11)}','${id(1)}','announcement','${id(6)}',null),('${id(12)}','${id(1)}','announcement','${id(7)}',null);
    `);
    await db.exec(await readFile(new URL("../db/migrations/20260930102000_circle_reveal.sql", import.meta.url), "utf8"));
    // Preserve original helper execution grants in this deliberately small base schema.
    await db.exec("grant execute on all functions in schema private to authenticated; set role authenticated");
    const probe = async () => (await db.query(`select
      private.ruined_current_circle_is_revealed() as revealed,
      (select count(*)::int from circle_member_assignments) as assignments,
      private.ruined_current_active_access_block_id() as block_id,
      private.ruined_can_access_learning_resource('${id(4)}') as circle_resource,
      private.ruined_can_access_learning_resource('${id(5)}') as general_resource,
      private.ruined_can_read_announcement('${id(6)}') as circle_announcement,
      private.ruined_can_read_announcement('${id(7)}') as general_announcement,
      (select count(*)::int from member_notifications) as notifications
    `)).rows[0];
    assert.deepEqual(await probe(), { revealed: false, assignments: 0, block_id: null, circle_resource: false, general_resource: true, circle_announcement: false, general_announcement: true, notifications: 1 });
    await db.exec("reset role; update member_lifecycle set foundations_state='completed'; set role authenticated");
    assert.deepEqual(await probe(), { revealed: true, assignments: 1, block_id: id(3), circle_resource: true, general_resource: true, circle_announcement: true, general_announcement: true, notifications: 4 });
    await db.exec("reset role; update circle_member_assignments set ended_at=now(); set role authenticated");
    const ended = await probe();
    assert.equal(ended.revealed, true, "completion stays durable after a transfer or departure");
    assert.equal(ended.circle_resource, false, "reveal never substitutes for a current Circle assignment");
    assert.equal(ended.block_id, null);
  } finally { await db.close(); }
});
