import assert from "node:assert/strict";
import test from "node:test";
import { badgeCollectionFixture, badgeId as id, readBadgeSource } from "./helpers/badge-collection-fixture.mjs";

const migration = "db/migrations/20261026210000_foundations_first_call_badge.sql";
const badge = collection => collection.badges.find(item => item.key === "in-the-room");
const credit = (track, stage = null, month = null) => ({ track, stage, month });

async function fixture(t, applyMigration = true) {
  const f = await badgeCollectionFixture(t);
  await f.db.exec(`
    create or replace function private.ruined_member_profile_released(uuid) returns boolean language sql stable as 'select released from public.ruined_members where id=$1';
    create table member_registration_access(member_id uuid primary key,registered_at timestamptz);
    alter table experiences add column visibility text default 'all_members',
      add column registration_mode text default 'internal', add column title text;
    create table private.member_email_cadence_event_bindings(
      experience_id uuid primary key references experiences(id),kind text,track text,
      cohort_month text,approved_by uuid references platform_users(auth_user_id));
  `);
  await f.db.exec(await readBadgeSource("db/migrations/20261021194000_member_registration_anniversary_badge.sql"));
  if (applyMigration) await f.db.exec(await readBadgeSource(migration));
  f.foundation = async (n, options = {}) => {
    const { binding = {}, bound = true, visibility = "invite_only", registrationMode = "internal", ...eventOptions } = options;
    await f.event(n, credit("none"), { kind: "member_event", ...eventOptions });
    await f.db.query("update experiences set visibility=$2,registration_mode=$3,title='Foundations 01' where id=$1", [id(n + 1000), visibility, registrationMode]);
    // The production classifier validates the cohort schedule on write. These
    // isolated attendance fixtures use fixed past dates to run before launch.
    if (bound) await f.db.query(`insert into private.member_email_cadence_event_bindings
      values($1,$2,$3,$4,$5)`, [id(n + 1000), binding.kind ?? "foundations_01",
      binding.track ?? "members", Object.hasOwn(binding, "cohortMonth") ? binding.cohortMonth : "2026-11",
      Object.hasOwn(binding, "approvedBy") ? binding.approvedBy : id(1)]);
  };
  return f;
}

test("confirmed real Foundations calls earn In the Room once without requiring active email delivery", async t => {
  for (const [index, kind] of ["foundations_01", "foundations_02", "foundations_03", "foundations_04"].entries()) {
    await t.test(kind, async t => {
      const f = await fixture(t);
      await f.foundation(index + 1, { binding: { kind }, kind: index % 2 ? "weekly_call" : "member_event" });
      const collection = await f.getMemberBadgeCollection(id(1));
      assert.ok(badge(collection).earnedAt);
      assert.equal(badge(collection).publicVisible, true);
      assert.match(badge(collection).description, /Foundations or Membership/);
      assert.equal(collection.badges.find(item => item.key === "the-whole-month").progress, 0);
      assert.equal(collection.badges.find(item => item.key === "full-circle").progress, 0);
      assert.equal(badge(await f.getMemberBadgeCollection(id(2))).earnedAt, null);
      const awards = (await f.db.query("select * from member_badge_awards")).rows;
      assert.equal(awards.length, 1);
      assert.match(awards[0].source_event_id, /^attendance:[0-9]+$/);
      await f.getMemberBadgeCollection(id(1));
      assert.deepEqual((await f.db.query("select * from member_badge_awards")).rows, awards);
      assert.deepEqual((await f.getUnacknowledgedMemberBadges(id(1))).map(item => item.key), ["in-the-room"]);
      await f.setMemberBadgeVisibility(id(1), "in-the-room", false);
      assert.deepEqual(await f.repository.getPublicMemberBadges(id(101)), []);
      await f.acknowledgeMemberBadge(id(1), "in-the-room");
      assert.deepEqual(await f.getUnacknowledgedMemberBadges(id(1)), []);
    });
  }
});

test("Foundations invitations, practice, self-reported attendance and invalid calls do not earn a badge", async t => {
  const f = await fixture(t);
  const excluded = [
    { bound: false },
    { attended: false },
    { source: "member" },
    { date: "2099-01-01" },
    { status: "cancelled" },
    { status: "draft" },
    { circle: id(900) },
    { kind: "retreat" },
    { visibility: "public" },
    { visibility: "all_members" },
    { registrationMode: "external" },
    { binding: { track: "founder_test", cohortMonth: null } },
    { binding: { kind: "none" } },
    { binding: { kind: "membership" } },
    { binding: { kind: "foundations_05" } },
    { binding: { cohortMonth: null } },
    { binding: { cohortMonth: "2026-13" } },
    { binding: { cohortMonth: "2026-1" } },
    { binding: { cohortMonth: "2026-10" } },
    { binding: { approvedBy: null } },
    { person: 2 },
  ];
  for (const [index, options] of excluded.entries()) await f.foundation(index + 1, options);
  await f.foundation(40, { status: "archived" });
  await f.db.query("update experiences set cancelled_at=now() where id=$1", [id(1040)]);
  await f.foundation(41);
  await f.db.query("update experiences set ends_at=null where id=$1", [id(1041)]);
  await f.foundation(42);
  await f.db.query("update experiences set ends_at=starts_at where id=$1", [id(1042)]);
  await f.foundation(43);
  await f.db.query("update experiences set ends_at='2099-01-01' where id=$1", [id(1043)]);
  await f.foundation(44);
  await f.db.query("update experience_attendance_events set member_id=$2 where experience_id=$1", [id(1044), id(102)]);
  await f.foundation(45);
  await f.db.query("insert into experience_attendance_events(experience_id,person_id,member_id,event_type) values($1,$2,$3,'credited')", [id(1045), id(201), id(101)]);
  await f.foundation(46);
  await f.db.query("update experience_attendance_events set occurred_at='2099-01-01' where experience_id=$1", [id(1046)]);
  assert.equal(badge(await f.getMemberBadgeCollection(id(1))).earnedAt, null);
  assert.deepEqual(await f.getUnacknowledgedMemberBadges(id(1)), []);
  assert.equal((await f.db.query("select count(*) from member_badge_awards")).rows[0].count, 0);
});

test("latest attendance and classification corrections revalidate public and private awards without deleting history", async t => {
  const f = await fixture(t);
  await f.foundation(1, { status: "completed", source: "external" });
  await f.getMemberBadgeCollection(id(1));
  const original = (await f.db.query("select * from member_badge_awards")).rows;
  await f.db.query("insert into experience_attendance_events(experience_id,person_id,member_id,event_type) values($1,$2,$3,'revoked')", [id(1001), id(201), id(101)]);
  assert.deepEqual(await f.repository.getPublicMemberBadges(id(101)), []);
  assert.equal(badge(await f.getMemberBadgeCollection(id(1))).earnedAt, null);
  assert.deepEqual(await f.getUnacknowledgedMemberBadges(id(1)), []);
  await assert.rejects(() => f.acknowledgeMemberBadge(id(1), "in-the-room"), { status: 404 });
  assert.deepEqual((await f.db.query("select * from member_badge_awards")).rows, original);
  await f.foundation(2, { status: "archived", source: "import" });
  assert.ok(badge(await f.getMemberBadgeCollection(id(1))).earnedAt);
  await f.db.query("update private.member_email_cadence_event_bindings set kind='none' where experience_id=$1", [id(1002)]);
  assert.deepEqual(await f.repository.getPublicMemberBadges(id(101)), []);
  await f.event(3, credit("membership", "see", "2026-01"));
  assert.equal(badge(await f.getMemberBadgeCollection(id(1))).earnedAt, new Date(original[0].earned_at).toISOString());
  assert.deepEqual((await f.db.query("select * from member_badge_awards")).rows, original);
});

test("the additive migration preserves every existing progress rule and existing award privacy", async t => {
  const f = await fixture(t, false);
  await f.db.query("insert into person_profiles(person_id,bio,member_tag,avatar_storage_path) values($1,'A bio','member','avatar.webp')", [id(201)]);
  await f.db.query("insert into member_journal_entries(member_id,visibility) values($1,'private')", [id(101)]);
  for (const [index, stage] of ["see", "face", "cut", "grow"].entries()) await f.event(index + 1, credit("membership", stage, "2026-01"));
  await f.db.query("insert into circle_member_assignments values($1,$2,'2025-01-01',null)", [id(900), id(101)]);
  await f.event(10, credit("circle", "why", "2026-01"), { kind: "circle_meeting", circle: id(900) });
  await f.event(11, credit("circle", "implementation", "2026-01"), { kind: "circle_meeting", circle: id(900) });
  await f.event(20, credit("in_person"), { kind: "member_event", location: "Ruined studio" });
  const before = await f.getMemberBadgeCollection(id(1));
  await f.setMemberBadgeVisibility(id(1), "in-the-room", false);
  const awardsBefore = (await f.db.query("select * from member_badge_awards order by badge_key")).rows;
  const progressBefore = (await f.db.query("select * from private.ruined_member_badge_progress($1) order by badge_key", [id(101)])).rows;
  await f.db.exec(await readBadgeSource(migration));
  assert.deepEqual((await f.db.query("select * from private.ruined_member_badge_progress($1) order by badge_key", [id(101)])).rows, progressBefore);
  assert.deepEqual((await f.db.query("select * from member_badge_awards order by badge_key")).rows, awardsBefore);
  const after = await f.getMemberBadgeCollection(id(1));
  assert.deepEqual(after.badges.filter(item => item.earnedAt).map(item => item.key), before.badges.filter(item => item.earnedAt).map(item => item.key));
  assert.equal(badge(after).publicVisible, false);
  assert.equal(after.badges.find(item => item.key === "first-words").publicVisible, false);
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await f.db.query("select has_function_privilege($1,'private.ruined_member_badge_progress(uuid)','EXECUTE') allowed", [role])).rows[0].allowed, false);
  }
  await f.db.query("update ruined_members set released=false where id=$1", [id(101)]);
  await assert.rejects(() => f.getMemberBadgeCollection(id(1)), { status: 403 });
  assert.deepEqual(await f.repository.getPublicMemberBadges(id(101)), []);
});

test("First Words matches the actual private Journal collection without changing legacy sharing or award privacy", async t => {
  const f = await fixture(t);
  await f.db.query(`insert into member_journal_entries(id,member_id,visibility,include_on_timeline,created_at)
    values($1,$2,'public',false,'2026-01-01T12:00:00Z'),($3,$4,'public',true,'2026-01-02T12:00:00Z')`,
  [id(701), id(101), id(702), id(102)]);
  const originalEntries = (await f.db.query("select * from member_journal_entries order by id")).rows;
  const own = await f.getMemberBadgeCollection(id(1));
  const firstWords = own.badges.find(item => item.key === "first-words");
  assert.equal(firstWords.earnedAt, "2026-01-01T12:00:00.000Z");
  assert.equal(firstWords.publicVisible, false);
  assert.equal(own.badges.find(item => item.key === "on-the-record").earnedAt, null);
  const other = await f.getMemberBadgeCollection(id(2));
  assert.equal(other.badges.find(item => item.key === "first-words").earnedAt, null);
  assert.equal(other.badges.find(item => item.key === "on-the-record").earnedAt, "2026-01-02T12:00:00.000Z");
  assert.deepEqual(await f.repository.getPublicMemberBadges(id(101)), []);
  assert.deepEqual((await f.db.query("select * from member_journal_entries order by id")).rows, originalEntries);
  const originalAward = (await f.db.query("select * from member_badge_awards where member_id=$1 and badge_key='first-words'", [id(101)])).rows;
  await f.db.query("update member_journal_entries set include_on_timeline=true where id=$1", [id(701)]);
  assert.equal((await f.getMemberBadgeCollection(id(1))).badges.find(item => item.key === "first-words").earnedAt, null);
  assert.equal((await f.getUnacknowledgedMemberBadges(id(1))).some(item => item.key === "first-words"), false);
  assert.deepEqual((await f.db.query("select * from member_badge_awards where member_id=$1 and badge_key='first-words'", [id(101)])).rows, originalAward);
  await f.db.query("update member_journal_entries set include_on_timeline=false where id=$1", [id(701)]);
  const restored = (await f.getMemberBadgeCollection(id(1))).badges.find(item => item.key === "first-words");
  assert.equal(restored.earnedAt, firstWords.earnedAt);
  assert.equal(restored.publicVisible, false);
  await f.db.query("update member_journal_entries set deleted_at=now() where id=$1", [id(701)]);
  assert.equal((await f.getMemberBadgeCollection(id(1))).badges.find(item => item.key === "first-words").earnedAt, null);
  assert.doesNotMatch(await readBadgeSource(migration), /\bentry\.(?:body|title|text)\b/);
});
