import assert from "node:assert/strict";
import test from "node:test";
import { badgeCollectionFixture, badgeId as id, readBadgeSource } from "./helpers/badge-collection-fixture.mjs";
import { badgeUIFixture, nodes, text } from "./helpers/member-badge-ui-fixture.mjs";

const migration = "db/migrations/20261021194000_member_registration_anniversary_badge.sql";
const birthday = "2024-02-29T20:00:00.000Z";
const anniversary = "2025-02-28T07:00:00.000Z";
const oneYear = collection => collection.badges.find(badge => badge.key === "one-year");
const sqlFunction = (source, name) => {
  const start = source.indexOf(`create or replace function private.${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("$$;", start) + 3);
};

async function fixture(t) {
  const f = await badgeCollectionFixture(t);
  await f.db.exec(`
    create or replace function private.ruined_member_profile_released(uuid) returns boolean language sql stable as 'select released from public.ruined_members where id=$1';
    create table member_registration_access(member_id uuid primary key,registered_at timestamptz);
    alter table member_lifecycle add column administrative_onboarding_state text default 'completed',
      add column billing_state text default 'active', add column program_state text default 'active',
      add column standing_state text default 'active', add column cancellation_effective_at timestamptz;
    create table member_complimentary_grants(member_id uuid,starts_at timestamptz,ends_at timestamptz,revoked_at timestamptz);
    create table member_consents(member_id uuid,decision text);
  `);
  const complimentary = await readBadgeSource("db/migrations/20260925000000_complimentary_member_invitations.sql");
  await f.db.exec(sqlFunction(await readBadgeSource("db/migrations/20260914181653_operator_complimentary_membership.sql"), "ruined_member_has_operator_funding"));
  await f.db.exec(sqlFunction(complimentary, "ruined_member_has_complimentary_funding"));
  await f.db.exec(sqlFunction(complimentary, "ruined_member_can_share_invitation"));
  await f.db.exec(await readBadgeSource(migration));
  f.register = (n = 1, at = birthday) => f.db.query("insert into member_registration_access values($1,$2) on conflict(member_id) do update set registered_at=excluded.registered_at", [id(n + 100), at]);
  return f;
}

test("registration anniversary uses the Denver calendar, leap-day clamp and actual registration only", async t => {
  const f = await fixture(t);
  for (const [registeredAt, expected] of [
    [birthday, anniversary],
    ["2024-03-01T05:30:00Z", anniversary], // Still February 29 in Denver.
    ["2024-03-01T07:30:00Z", "2025-03-01T07:00:00.000Z"],
    ["2025-07-30T23:30:00Z", "2026-07-30T06:00:00.000Z"],
    ["infinity", null],
    [null, null],
  ]) {
    const value = (await f.db.query("select private.ruined_registration_anniversary_at($1) as at", [registeredAt])).rows[0].at;
    assert.equal(value ? new Date(value).toISOString() : null, expected);
  }
  assert.equal(oneYear(await f.getMemberBadgeCollection(id(1))).earnedAt, null);
  await f.register(1, "2099-02-28T20:00:00Z");
  assert.equal(oneYear(await f.getMemberBadgeCollection(id(1))).earnedAt, null);
  await f.db.query(`update member_registration_access set registered_at =
    (((statement_timestamp() at time zone 'America/Denver')::date - interval '12 months' + interval '1 day') at time zone 'America/Denver')
    where member_id=$1`, [id(101)]);
  assert.equal(oneYear(await f.getMemberBadgeCollection(id(1))).earnedAt, null, "the day before the calendar anniversary is too early");
  await f.db.query(`insert into member_registration_access values($1,
    (((statement_timestamp() at time zone 'America/Denver')::date - interval '12 months') at time zone 'America/Denver'))`, [id(102)]);
  const dueToday = oneYear(await f.getMemberBadgeCollection(id(2)));
  assert.ok(dueToday.earnedAt, "the anniversary is earned from the start of its Denver calendar date");
  await f.db.query("delete from member_registration_access where member_id=$1", [id(102)]);
  await f.register();
  const badge = oneYear(await f.getMemberBadgeCollection(id(1)));
  assert.equal(badge.earnedAt, anniversary);
  assert.equal(badge.progress, 1);
  assert.equal(badge.progressLabel, "Earned");
  assert.equal(badge.actionHref, null);
  assert.equal(oneYear(await f.getMemberBadgeCollection(id(2))).earnedAt, null);
});

test("anniversary awards reconcile once despite absent or withdrawn email preferences and use normal notification privacy", async t => {
  const f = await fixture(t);
  await f.register();
  await f.db.query("insert into member_consents values($1,'withdrawn')", [id(101)]);
  const beforeConsent = (await f.db.query("select * from member_consents")).rows;
  const notification = await f.getUnacknowledgedMemberBadges(id(1));
  assert.deepEqual(notification, [f.model.memberBadge("one-year", anniversary)]);
  const award = (await f.db.query("select * from member_badge_awards where badge_key='one-year'")).rows[0];
  assert.match(award.source_event_id, new RegExp(`^registration-anniversary:${id(101)}:[0-9]+`));
  assert.equal(award.public_visible, true);
  await f.getMemberBadgeCollection(id(1));
  await f.getUnacknowledgedMemberBadges(id(1));
  assert.deepEqual((await f.db.query("select * from member_badge_awards where badge_key='one-year'")).rows, [award]);
  await f.acknowledgeMemberBadge(id(1), "one-year");
  await f.acknowledgeMemberBadge(id(1), "one-year");
  assert.deepEqual(await f.getUnacknowledgedMemberBadges(id(1)), []);
  assert.equal((await f.repository.getPublicMemberBadges(id(101))).some(badge => badge.key === "one-year"), true);
  await f.setMemberBadgeVisibility(id(1), "one-year", false);
  await f.getMemberBadgeCollection(id(1));
  assert.equal((await f.repository.getPublicMemberBadges(id(101))).some(badge => badge.key === "one-year"), false);
  await assert.rejects(() => f.setMemberBadgeVisibility(id(2), "one-year", true), { status: 404 });
  assert.deepEqual((await f.db.query("select * from member_consents")).rows, beforeConsent);
  assert.equal((await f.db.query("select count(*) from member_badge_awards where badge_key='one-year'")).rows[0].count, 1);
});

test("current entitlement, release, canonical account and member-role changes hide an anniversary without deleting history", async t => {
  const f = await fixture(t);
  await f.register();
  await f.getMemberBadgeCollection(id(1));
  const award = (await f.db.query("select * from member_badge_awards where badge_key='one-year'")).rows[0];
  const mutations = [
    ["update ruined_members set deleted_at=now() where id=$1", "update ruined_members set deleted_at=null where id=$1", id(101)],
    ["update ruined_members set released=false where id=$1", "update ruined_members set released=true where id=$1", id(101)],
    ["update people set status='inactive' where id=$1", "update people set status='active' where id=$1", id(201)],
    ["update platform_users set status='inactive' where auth_user_id=$1", "update platform_users set status='active' where auth_user_id=$1", id(1)],
    ["update platform_users set member_id=null where auth_user_id=$1", "update platform_users set member_id=$2 where auth_user_id=$1", id(1), id(101), true],
    ["update platform_users set member_id=$2 where auth_user_id=$1", "update platform_users set member_id=$2 where auth_user_id=$1", id(1), id(102), id(101)],
    ["update platform_role_grants set revoked_at=now() where auth_user_id=$1", "update platform_role_grants set revoked_at=null where auth_user_id=$1", id(1)],
    ["update member_lifecycle set standing_state='paused' where member_id=$1", "update member_lifecycle set standing_state='active' where member_id=$1", id(101)],
    ["update member_lifecycle set billing_state='ended' where member_id=$1", "update member_lifecycle set billing_state='active' where member_id=$1", id(101)],
    ["update member_lifecycle set account_state='suspended' where member_id=$1", "update member_lifecycle set account_state='active' where member_id=$1", id(101)],
  ];
  for (const [change, restore, ...parameters] of mutations) {
    const expectedVisible = parameters.at(-1) === true;
    const values = parameters.filter(value => typeof value !== "boolean");
    const execute = query => f.db.query(query, values.slice(0, Math.max(...[...query.matchAll(/\$(\d+)/g)].map(match => Number(match[1])))));
    await execute(change);
    assert.equal((await f.repository.getPublicMemberBadges(id(101))).some(badge => badge.key === "one-year"), expectedVisible, change);
    if (values.length === 3) await f.db.query(restore, [values[0], values[2]]);
    else await execute(restore);
  }
  assert.deepEqual((await f.db.query("select * from member_badge_awards where badge_key='one-year'")).rows, [award]);
  await f.db.query("update member_lifecycle set billing_state='ended' where member_id=$1", [id(101)]);
  await f.db.query("insert into member_complimentary_grants values($1,now()-interval '1 day',now()+interval '1 day',null)", [id(101)]);
  assert.equal(oneYear(await f.getMemberBadgeCollection(id(1))).earnedAt, anniversary, "current complimentary members retain the same canonical entitlement");
  await f.db.query("update member_complimentary_grants set revoked_at=now() where member_id=$1", [id(101)]);
  assert.equal(oneYear(await f.getMemberBadgeCollection(id(1))).earnedAt, null);
});

test("new milestone remains private to server execution and migration preserves prior awards", async t => {
  const f = await fixture(t);
  for (const role of ["anon", "authenticated"]) {
    for (const fn of ["private.ruined_registration_anniversary_at(timestamptz)", "private.ruined_member_badge_progress(uuid)"]) {
      assert.equal((await f.db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, fn])).rows[0].allowed, false);
    }
  }
  assert.equal((await f.db.query("select count(*) from member_badge_awards")).rows[0].count, 0, "migration alone grants no awards");
  await f.db.query("insert into person_profiles(person_id,bio,member_tag,avatar_storage_path) values($1,'A bio','Member','avatar.png')", [id(201)]);
  const before = await f.getMemberBadgeCollection(id(1));
  assert.equal(before.badges.find(badge => badge.key === "make-it-yours").progress, 3);
  assert.ok(before.badges.find(badge => badge.key === "make-it-yours").earnedAt);
  assert.equal(oneYear(before).earnedAt, null);
});

test("One Year uses the existing number stamp with a legible label, earning reason and no invented artwork download", () => {
  const badge = { key: "one-year", label: "One Year", description: "Reach the first anniversary of your Ruined registration.", earnedAt: anniversary };
  const ui = badgeUIFixture({ badges: [badge] });
  assert.equal(text(ui.button("One Year badge. View details")), "1");
  const tree = ui.click("One Year badge. View details");
  assert.ok(nodes(tree).some(node => node.type === "h2" && text(node) === "One Year"));
  assert.match(text(tree), /first anniversary of your Ruined registration/);
  assert.equal(nodes(tree).some(node => node.props.download), false);
  assert.equal(nodes(tree).some(node => node.type === "img"), false);
  ui.unmount();
});
