import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { installOperatorFundingFunctions } from "./helpers/operator-funding-fixture.mjs";

const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const self = { auth: uuid(1), person: uuid(2), member: uuid(3) };
const other = { auth: uuid(4), person: uuid(5), member: uuid(6) };
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function load(path, dependencies) {
  const output = ts.transpileModule(await source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    assert.ok(name in dependencies, `Unexpected live dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

async function fixture() {
  const PGlite = await loadPGliteForSchemaChecks();
  const pg = new PGlite();
  await pg.exec(`
    create schema private;
    create table people(id uuid primary key, status text default 'active');
    create table platform_users(auth_user_id uuid primary key, person_id uuid, member_id uuid, status text default 'active');
    create table platform_role_grants(id bigint generated always as identity primary key, auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table ruined_members(id uuid primary key, person_id uuid, email text, unique(id, person_id));
    create table member_lifecycle(member_id uuid primary key, account_state text default 'active', billing_state text default 'active', program_state text default 'active', foundations_state text default 'completed', administrative_onboarding_state text default 'completed', standing_state text default 'active', cancellation_effective_at timestamptz);
    create table person_email_addresses(person_id uuid, email text, retired_at timestamptz, is_primary boolean, created_at timestamptz);
    create table artifact_template_versions(id uuid primary key);
    create table experiences(id uuid primary key, title text, kind text, starts_at timestamptz, timezone text, location_label text);
    create table experience_registrations(id uuid primary key, experience_id uuid, person_id uuid, status text);
  `);
  await installOperatorFundingFunctions(pg);
  const foundations = await source("db/migrations/20260826_membership_operating_spine_04_foundations_automation.sql");
  const community = await source("db/migrations/20260826_membership_operating_spine_03_community_experiences.sql");
  for (const [migration, table] of [[foundations, "member_milestones"], [foundations, "artifact_awards"], [community, "experience_attendance_events"]]) {
    const definition = migration.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`));
    assert.ok(definition, `Missing shipped table ${table}`);
    await pg.exec(definition[0]);
  }
  for (const person of [self, other]) {
    await pg.query("insert into people(id) values($1)", [person.person]);
    await pg.query("insert into platform_users(auth_user_id,person_id,member_id) values($1,$2,$3)", [person.auth, person.person, person.member]);
    await pg.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [person.auth]);
    await pg.query("insert into ruined_members values($1,$2,$3)", [person.member, person.person, `${person.member}@example.test`]);
    await pg.query("insert into member_lifecycle(member_id) values($1)", [person.member]);
  }
  const queries = [];
  const sql = (strings, ...parameters) => {
    const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
    queries.push(query);
    return pg.query(query, parameters).then((result) => result.rows);
  };
  const policy = await load("src/lib/membership/access-policy.ts", {});
  const repository = await load("src/lib/membership/repository.ts", {
    "server-only": {},
    "libphonenumber-js/min": {},
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/events/member-experiences": {},
    "@/lib/events/community-event-repository": {},
    "@/lib/google/communications": {},
    "@/lib/membership/access-policy": policy,
    "@/lib/membership/artifact-products": {},
    "@/lib/membership/avatar-url": {},
    "@/lib/membership/phone": {},
    "@/lib/platform/ops-calendar-repository": {},
    "@/lib/platform/calendar-audience-invalidation": {},
    "@/lib/platform/experience-member-access": {},
  });
  async function experience(id, title = `Gathering ${id}`, date = "2001-01-01T12:00:00Z") {
    await pg.query("insert into experiences values($1,$2,'circle_meeting',$3,'America/Denver','Ruined Studio')", [uuid(id), title, date]);
  }
  async function attendance(id, state, { person = self, memberId = person.member, date = "2001-01-02T12:00:00Z" } = {}) {
    await pg.query(`insert into experience_attendance_events(experience_id,person_id,member_id,event_type,source,occurred_at,evidence,dedupe_key)
      values($1,$2,$3,$4,'ops',$5,'{"reason":"PRIVATE ATTENDANCE EVIDENCE"}',gen_random_uuid()::text)`, [uuid(id), person.person, memberId, state, date]);
  }
  async function milestone(id, { person = self, visibility = "member", type = "foundations.completed", title = "Foundations complete", date = "2001-01-01T12:00:00Z", awardId = null } = {}) {
    await pg.query(`insert into member_milestones(id,member_id,person_id,milestone_type,title,occurred_at,visibility,source_entity_type,source_entity_id,evidence,dedupe_key)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,'{"privateReflection":"PRIVATE MILESTONE EVIDENCE"}',gen_random_uuid()::text)`,
    [uuid(id), person.member, person.person, type, title, date, visibility, awardId ? "artifact_award" : null, awardId ? uuid(awardId) : null]);
  }
  async function award(id, { person = self, status = "awarded" } = {}) {
    await pg.query(`insert into artifact_awards(id,member_id,person_id,award_name,acquisition_type,status,awarded_at,revoked_at,evidence,dedupe_key)
      values($1,$2,$3,'The First Coin','earned',$4,'2001-01-01',case when $4 = 'revoked' then '2001-01-02'::timestamptz else null end,'{"private":"PRIVATE ARTIFACT EVIDENCE"}',gen_random_uuid()::text)`,
    [uuid(id), person.member, person.person, status]);
  }
  return { pg, queries, repository, experience, attendance, milestone, award };
}

test("member record resolves verified identity and returns only that person's safe saved record", async () => {
  const f = await fixture();
  try {
    await f.milestone(20);
    await f.milestone(21, { visibility: "circle", title: "Circle milestone" });
    await f.milestone(22, { visibility: "private", title: "PRIVATE TITLE" });
    await f.milestone(23, { visibility: "ops", title: "OPS TITLE" });
    await f.milestone(24, { person: other, title: "OTHER MEMBER TITLE" });
    await f.award(30);
    await f.award(31, { person: other });
    await f.experience(40, "My gathering");
    await f.attendance(40, "attended");
    await f.attendance(40, "revoked", { person: other, date: "2001-01-03T12:00:00Z" });
    await f.experience(41, "OTHER MEMBER GATHERING");
    await f.attendance(41, "attended", { person: other });
    const record = await f.repository.getMemberRecord(self.auth);
    assert.deepEqual(record.totals, { milestones: 2, attendedExperiences: 1, creditedExperiences: 0, artifacts: 1 });
    assert.equal(record.attendedExperiences[0].id, uuid(40));
    assert.equal(record.attendedExperiences[0].startsAt, "2001-01-01T12:00:00.000Z");
    assert.deepEqual(Object.keys(record.milestones[0]).sort(), ["id", "occurredAt", "title", "type"]);
    assert.deepEqual(Object.keys(record.attendedExperiences[0]).sort(), ["attendanceState", "id", "kind", "locationLabel", "recordedAt", "startsAt", "timezone", "title"]);
    assert.doesNotMatch(JSON.stringify(record), /PRIVATE|OPS TITLE|OTHER MEMBER|evidence|personId|memberId|authUserId/);
    const otherRecord = await f.repository.getMemberRecord(other.auth);
    assert.equal(otherRecord.milestones[0].title, "OTHER MEMBER TITLE");
    assert.equal(otherRecord.attendedExperiences[0].title, "OTHER MEMBER GATHERING");
    await assert.rejects(f.repository.getMemberRecord(uuid(999)), { name: "MembershipAccessDeniedError" });
  } finally { await f.pg.close(); }
});

test("latest attendance corrections remove revoked and no-show visits; check-in and RSVP never count", async () => {
  const f = await fixture();
  try {
    for (let id = 40; id < 48; id++) await f.experience(id);
    await f.attendance(40, "attended");
    await f.attendance(40, "revoked"); // Equal occurrence time: larger event ID wins.
    await f.attendance(41, "attended");
    await f.attendance(41, "no_show", { date: "2001-01-03T12:00:00Z" });
    await f.attendance(42, "checked_in");
    await f.attendance(43, "credited");
    await f.attendance(44, "revoked");
    await f.attendance(44, "attended", { date: "2001-01-04T12:00:00Z" });
    await f.attendance(45, "attended");
    await f.attendance(45, "revoked", { memberId: null, date: "2001-01-03T12:00:00Z" });
    await f.attendance(46, "attended", { memberId: null }); // Person-linked participation before membership.
    await f.pg.query("insert into experience_registrations values($1,$2,$3,'registered')", [uuid(80), uuid(47), self.person]);
    const record = await f.repository.getMemberRecord(self.auth);
    assert.deepEqual(record.totals, { milestones: 0, attendedExperiences: 2, creditedExperiences: 1, artifacts: 0 });
    assert.deepEqual(record.attendedExperiences.map((item) => [item.id, item.attendanceState]), [[uuid(46), "attended"], [uuid(44), "attended"], [uuid(43), "credited"]]);
    assert.equal(record.attendedExperiences.find((item) => item.id === uuid(44)).recordedAt, "2001-01-04T12:00:00.000Z");
  } finally { await f.pg.close(); }
});

test("revoked awards disappear from both artifact totals and their durable milestones", async () => {
  const f = await fixture();
  try {
    await f.award(30);
    await f.award(31, { status: "revoked" });
    await f.award(32, { status: "fulfilled" });
    await f.milestone(20, { type: "artifact.awarded", title: "Current award", awardId: 30 });
    await f.milestone(21, { type: "artifact.awarded", title: "Revoked award", awardId: 31 });
    await f.milestone(22, { type: "artifact.awarded", title: "Missing award", awardId: 33 });
    assert.deepEqual((await f.repository.getMemberRecord(self.auth)).totals, { milestones: 1, attendedExperiences: 0, creditedExperiences: 0, artifacts: 2 });
    await f.pg.query("update artifact_awards set status='revoked',revoked_at=now() where id=$1", [uuid(30)]);
    const record = await f.repository.getMemberRecord(self.auth);
    assert.equal(record.totals.artifacts, 1);
    assert.equal(record.totals.milestones, 0);
    assert.deepEqual(record.milestones, []);
  } finally { await f.pg.close(); }
});

test("years of history retain full totals while recent lists stay bounded and consistently ordered", async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 32; index++) {
      const date = `${2000 + Math.floor(index / 2)}-${index % 2 ? "07" : "01"}-01T12:00:00Z`;
      await f.milestone(100 + index, { title: `Milestone ${index}`, date });
      await f.experience(200 + index, `Experience ${index}`, date);
      await f.attendance(200 + index, "attended", { date });
    }
    await f.milestone(300, { title: "Future milestone", date: "2200-01-01T00:00:00Z" });
    await f.experience(301, "Future event", "2200-01-01T00:00:00Z");
    await f.attendance(301, "attended");
    const record = await f.repository.getMemberRecord(self.auth);
    assert.equal(record.totals.milestones, 32);
    assert.equal(record.totals.attendedExperiences, 32);
    assert.equal(record.milestones.length, 24);
    assert.equal(record.attendedExperiences.length, 24);
    assert.equal(record.milestones[0].title, "Milestone 31");
    assert.equal(record.milestones.at(-1).title, "Milestone 8");
    assert.equal(record.attendedExperiences[0].title, "Experience 31");
    assert.equal(record.attendedExperiences.at(-1).title, "Experience 8");
    assert.doesNotMatch(JSON.stringify(record), /Future/);
  } finally { await f.pg.close(); }
});

test("restricted membership stops before record queries and current grants are rechecked", async () => {
  const f = await fixture();
  try {
    for (const [column, value] of [["billing_state", "pending"], ["standing_state", "paused"]]) {
      await f.pg.query(`update member_lifecycle set ${column}=$1 where member_id=$2`, [value, self.member]);
      f.queries.length = 0;
      assert.equal(await f.repository.getMemberRecord(self.auth), undefined);
      assert.equal(f.queries.length, 1, "Restricted readers may only resolve current identity");
      await f.pg.query("update member_lifecycle set billing_state='active',standing_state='active' where member_id=$1", [self.member]);
    }
    await f.pg.query("update member_lifecycle set account_state='suspended' where member_id=$1", [self.member]);
    f.queries.length = 0;
    await assert.rejects(f.repository.getMemberRecord(self.auth), { name: "MembershipAccessDeniedError" });
    assert.equal(f.queries.length, 1);
    await f.pg.query("update member_lifecycle set account_state='active' where member_id=$1", [self.member]);
    await f.pg.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [self.auth]);
    f.queries.length = 0;
    await assert.rejects(f.repository.getMemberRecord(self.auth), { name: "MembershipAccessDeniedError" });
    assert.equal(f.queries.length, 1);
  } finally { await f.pg.close(); }
});

test("member home attaches the record under its existing private highlight boundary", async () => {
  const repository = await source("src/lib/membership/repository.ts");
  const home = repository.slice(repository.indexOf("export async function getMemberHome("), repository.indexOf("async function readTimelineRecord("));
  assert.match(home, /getMemberRecord\(authUserId\)/);
  assert.match(home, /record: suppressPrivateHighlights \? undefined : record/);
});
