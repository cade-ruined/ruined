import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";

import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { installOperatorFundingFunctions } from "./helpers/operator-funding-fixture.mjs";

const ids = {
  member: "11111111-1111-4111-8111-111111111111",
  person: "22222222-2222-4222-8222-222222222222",
  auth: "33333333-3333-4333-8333-333333333333",
  enrollment: "44444444-4444-4444-8444-444444444444",
  otherMember: "55555555-5555-4555-8555-555555555555",
  otherAuth: "66666666-6666-4666-8666-666666666666",
  otherEnrollment: "77777777-7777-4777-8777-777777777777",
};
const event = (title = "A beginning", year = 2001) => ({ id: null, title, year, details: "A private detail." });
const entriesForSave = (snapshot) => snapshot.entries.map(({ details, id, month, title, year }) => ({ details, id, month, title, year }));
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function loadTypescript(path, dependencies = {}) {
  const compiled = ts.transpileModule(await source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(name in dependencies, `Unexpected repository dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

async function fixture(t, { monthMigration = true } = {}) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  // Only the driver's actual Parameter/JSON serializers are used. No driver
  // query executes and this fixture never reads DATABASE_URL or credentials.
  const driver = postgres({ host: "127.0.0.1", port: 1, max: 1 });
  t.after(async () => { await db.close(); await driver.end(); });
  const automation = await source("db/migrations/20260826_membership_operating_spine_04_foundations_automation.sql");
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const appendOnly = foundation.match(/create or replace function ruined_reject_append_only_mutation\(\)[\s\S]*?\$\$;/)?.[0];
  const start = automation.indexOf("create table if not exists public.member_timeline_entries");
  const end = automation.indexOf("-- New Ruined Foundations versions", start);
  assert.ok(appendOnly && start >= 0 && end > start);
  // Execute the shipped Timeline/history/requirement definitions and triggers
  // unchanged. Only unrelated identity/enrollment dependencies are minimal.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema private;
    create table people (id uuid primary key, status text default 'active');
    create table ruined_members (id uuid primary key, person_id uuid, email text default 'member@example.test');
    create table platform_users (auth_user_id uuid primary key, member_id uuid, person_id uuid, status text default 'active');
    create table platform_role_grants (id bigint generated always as identity primary key, auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table member_lifecycle (member_id uuid primary key, account_state text default 'active', administrative_onboarding_state text default 'completed', billing_state text default 'active', program_state text default 'active', foundations_state text default 'in_progress', standing_state text default 'active', cancellation_effective_at timestamptz);
    create table foundation_enrollments (id uuid primary key, member_id uuid not null references ruined_members(id), status text, enrolled_at timestamptz default now());
    ${appendOnly}
    ${automation.slice(start, end)}
  `);
  await installOperatorFundingFunctions(db);
  if (monthMigration) await db.exec(await source("db/migrations/20260927000000_timeline_entry_month.sql"));
  await db.query("insert into people (id) values ($1),($2)", [ids.person, ids.otherMember]);
  await db.query("insert into ruined_members (id,person_id) values ($1,$2),($3,$3)", [ids.member, ids.person, ids.otherMember]);
  await db.query("insert into platform_users (auth_user_id,member_id,person_id) values ($1,$2,$3),($4,$5,$5)", [ids.auth, ids.member, ids.person, ids.otherAuth, ids.otherMember]);
  await db.query("insert into platform_role_grants (auth_user_id,role_slug) values ($1,'member'),($2,'member')", [ids.auth, ids.otherAuth]);
  await db.query("insert into member_lifecycle (member_id) values ($1),($2)", [ids.member, ids.otherMember]);
  await db.query("insert into foundation_enrollments (id,member_id,status) values ($1,$2,'in_progress'),($3,$4,'in_progress')", [ids.enrollment, ids.member, ids.otherEnrollment, ids.otherMember]);
  const identities = new Map([
    [ids.auth, { member_id: ids.member, auth_user_id: ids.auth }],
    [ids.otherAuth, { member_id: ids.otherMember, auth_user_id: ids.otherAuth }],
  ].map(([auth, identity]) => [auth, {
    ...identity, person_id: ids.person, email: "member@example.test", account_state: "active",
    administrative_onboarding_state: "completed", billing_state: "active", program_state: "active",
    foundations_state: "in_progress", standing_state: "active", cancellation_effective_at: null,
  }]));
  const executedQueries = [];
  let beforeTransaction = null;
  const wrap = (engine) => {
    const sql = async (strings, ...values) => {
      const text = strings.join("?");
      // Identity output is the sole query mock. All Timeline reads/writes,
      // revisions, history triggers and requirement completion use real SQL.
      if (text.includes("from platform_users platform_user")) {
        const identity = identities.get(values[0]);
        return identity ? [{ ...identity }] : [];
      }
      let query = strings[0];
      const parameters = values.map((value, index) => {
        query += `$${index + 1}${strings[index + 1]}`;
        if (value instanceof Parameter) {
          assert.equal(value.type, 3802);
          return driver.options.serializers[3802](value.value);
        }
        if (value !== null && /^\s*::jsonb\b/.test(strings[index + 1])) {
          return driver.options.serializers[3802](value);
        }
        return value instanceof Date ? types.date.serialize(value) : value;
      });
      executedQueries.push(query);
      return (await engine.query(query, parameters)).rows;
    };
    sql.json = driver.json;
    sql.begin = async (callback) => {
      if (beforeTransaction) { const change = beforeTransaction; beforeTransaction = null; await change(); }
      return engine.transaction((transaction) => callback(wrap(transaction)));
    };
    return sql;
  };
  const access = await loadTypescript("src/lib/membership/access-policy.ts");
  const repository = await loadTypescript("src/lib/membership/repository.ts", {
    "server-only": {}, "libphonenumber-js/min": {},
    "@/lib/database/server": { getApplicationDatabase: () => wrap(db) },
    "@/lib/membership/access-policy": access,
    "@/lib/membership/member-tag": await loadTypescript("src/lib/membership/member-tag.ts", {}),
    "@/lib/membership/phone": {}, "@/lib/membership/avatar-url": {},
    "@/lib/membership/artifact-products": {}, "@/lib/events/member-experiences": {},
    "@/lib/events/community-event-repository": {},
    "@/lib/google/communications": {}, "@/lib/platform/ops-calendar-repository": {},
    "@/lib/platform/calendar-audience-invalidation": {},
    "@/lib/platform/experience-member-access": {},
  });
  const versionCount = async () => (await db.query("select count(*)::int as count from member_timeline_entry_versions")).rows[0].count;
  return { db, driver, executedQueries, identities, repository, versionCount, beforeNextTransaction: (change) => { beforeTransaction = change; } };
}

test("Timeline writers recheck actual entitlement after the initial identity read", async (t) => {
  const f = await fixture(t);
  await f.db.query("update member_lifecycle set billing_state='pending' where member_id=$1", [ids.member]);
  await f.db.query("insert into platform_role_grants (auth_user_id,role_slug) values ($1,'guide')", [ids.auth]);
  Object.assign(f.identities.get(ids.auth), { operator_funded: true, billing_state: 'pending' });
  const saved = await f.repository.saveMemberTimeline(ids.auth, [event()], "0");
  const versions = await f.versionCount();
  for (const [restrict, restore] of [
    ["update platform_role_grants set revoked_at=now() where role_slug='guide'", "update platform_role_grants set revoked_at=null where role_slug='guide'"],
    ["update member_lifecycle set account_state='suspended'", "update member_lifecycle set account_state='active'"],
    ["update member_lifecycle set administrative_onboarding_state='in_progress'", "update member_lifecycle set administrative_onboarding_state='completed'"],
  ]) {
    for (const write of [
      () => f.repository.saveMemberTimeline(ids.auth, [], saved.revision),
      () => f.repository.upsertMemberTimelineEntry(ids.auth, event(), saved.revision),
      () => f.repository.deleteMemberTimelineEntry(ids.auth, saved.entries[0].id, saved.revision),
      () => f.repository.completeMemberFoundationRequirement(ids.auth, "timeline"),
      () => f.repository.completeMemberFoundationRequirement(ids.auth, "future_letter"),
    ]) {
      // The initial identity intentionally remains entitled. Simulate the
      // committed access change while the request waits to begin its writer.
      f.beforeNextTransaction(() => f.db.exec(restrict));
      await assert.rejects(write, f.repository.MembershipAccessDeniedError);
      assert.equal(await f.versionCount(), versions);
      assert.equal((await f.db.query("select count(*)::int as total from member_foundation_requirement_completions")).rows[0].total, 0);
      await f.db.exec(restore);
    }
  }
  assert.equal((await f.db.query("select billing_state from member_lifecycle where member_id=$1", [ids.member])).rows[0].billing_state, "pending");
});

test("Timeline saves and reloads chronologically; stale edits and deletions preserve newer work", async (t) => {
  const { db, repository, versionCount } = await fixture(t);
  const initial = await repository.getMemberTimeline(ids.auth);
  assert.equal(initial.revision, "0");
  assert.deepEqual(initial.entries, []);
  const first = await repository.saveMemberTimeline(ids.auth, [event("Later", 2020), event("Earlier", 2001)], initial.revision);
  assert.deepEqual(first.entries.map((entry) => entry.title), ["Earlier", "Later"]);
  assert.equal(await versionCount(), 2);
  const newerInput = entriesForSave(first).map((entry) => ({ ...entry, title: `${entry.title} revised` }));
  const newer = await repository.saveMemberTimeline(ids.auth, newerInput, first.revision);
  assert.ok(BigInt(newer.revision) > BigInt(first.revision));
  const savedVersionCount = await versionCount();
  await assert.rejects(() => repository.saveMemberTimeline(ids.auth, entriesForSave(first), first.revision), repository.MembershipConflictError);
  await assert.rejects(() => repository.saveMemberTimeline(ids.auth, [], first.revision), repository.MembershipConflictError);
  assert.deepEqual(await repository.getMemberTimeline(ids.auth), newer);
  assert.equal(await versionCount(), savedVersionCount);
  const unchanged = await repository.saveMemberTimeline(ids.auth, entriesForSave(newer), newer.revision);
  assert.equal(unchanged.revision, newer.revision, "No-op saves do not invent a new history version");
  assert.deepEqual((await db.query("select distinct action from member_timeline_entry_versions order by action")).rows.map((row) => row.action), ["created", "updated"]);
});

test("Timeline empty-to-populated-to-empty revisions prevent stale resurrection and preserve deletion history", async (t) => {
  const { db, repository } = await fixture(t);
  const first = await repository.saveMemberTimeline(ids.auth, [event()], "0");
  const empty = await repository.saveMemberTimeline(ids.auth, [], first.revision);
  assert.deepEqual(empty.entries, []);
  assert.ok(BigInt(empty.revision) > BigInt(first.revision));
  assert.notEqual(empty.revision, "0");
  await assert.rejects(() => repository.saveMemberTimeline(ids.auth, [event("A stale draft")], "0"), repository.MembershipConflictError);
  await assert.rejects(() => repository.saveMemberTimeline(ids.auth, entriesForSave(first), empty.revision), repository.MembershipConflictError);
  assert.deepEqual(await repository.getMemberTimeline(ids.auth), empty);
  const restored = await repository.saveMemberTimeline(ids.auth, [event()], empty.revision);
  assert.notEqual(restored.entries[0].id, first.entries[0].id);
  assert.ok(BigInt(restored.revision) > BigInt(empty.revision));
  assert.equal((await db.query("select status from member_timeline_entries where id=$1", [first.entries[0].id])).rows[0].status, "deleted");
  await assert.rejects(() => db.query("update member_timeline_entry_versions set title='Overwrite history'"), /append.only/i);
  await assert.rejects(() => db.query("delete from member_timeline_entry_versions"), /append.only/i);
});

test("competing Timeline saves from the same revision admit one winner without lost updates", async (t) => {
  const { repository } = await fixture(t);
  const first = await repository.saveMemberTimeline(ids.auth, [event()], "0");
  const outcomes = await Promise.allSettled(["Edit A", "Edit B"].map((title) => repository.saveMemberTimeline(ids.auth, [{ ...entriesForSave(first)[0], title }], first.revision)));
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const loser = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(loser.reason instanceof repository.MembershipConflictError);
  const winner = outcomes.find((outcome) => outcome.status === "fulfilled").value;
  assert.deepEqual(await repository.getMemberTimeline(ids.auth), winner);
});

test("Timeline rejects missing or malformed revisions before writing and rolls back cross-member entry attempts", async (t) => {
  const { repository, versionCount } = await fixture(t);
  for (const revision of [undefined, null, 0, "", " ", "-1", "1.0", "abc", "1".repeat(21)]) {
    await assert.rejects(() => repository.saveMemberTimeline(ids.auth, [event()], revision), repository.MembershipConflictError);
  }
  assert.equal(await versionCount(), 0);
  const other = await repository.saveMemberTimeline(ids.otherAuth, [event("Not yours")], "0");
  const versionsBefore = await versionCount();
  await assert.rejects(() => repository.saveMemberTimeline(ids.auth, [event("Must roll back"), ...entriesForSave(other)], "0"), repository.MembershipConflictError);
  const own = await repository.getMemberTimeline(ids.auth);
  assert.deepEqual(own.entries, []);
  assert.equal(own.revision, "0");
  assert.deepEqual(await repository.getMemberTimeline(ids.otherAuth), other);
  assert.equal(await versionCount(), versionsBefore, "The preceding inserted entry and its trigger history both roll back");
});

test("alumni can revisit their Timeline but cannot write; suspended and unknown identities cannot read it", async (t) => {
  const { executedQueries, identities, repository } = await fixture(t);
  const saved = await repository.saveMemberTimeline(ids.auth, [event()], "0");
  identities.get(ids.auth).standing_state = "alumni";
  identities.get(ids.auth).foundations_state = "completed";
  const alumni = await repository.getMemberTimeline(ids.auth);
  assert.deepEqual(alumni.entries, saved.entries);
  assert.equal(alumni.revision, saved.revision);
  assert.equal(alumni.access.mode, "alumni");
  const beforeWrites = executedQueries.length;
  await assert.rejects(() => repository.saveMemberTimeline(ids.auth, [], saved.revision), repository.MembershipAccessDeniedError);
  await assert.rejects(() => repository.completeMemberFoundationRequirement(ids.auth, "timeline"), repository.MembershipAccessDeniedError);
  assert.equal(executedQueries.length, beforeWrites);
  identities.get(ids.auth).account_state = "suspended";
  await assert.rejects(() => repository.getMemberTimeline(ids.auth), repository.MembershipAccessDeniedError);
  await assert.rejects(() => repository.saveMemberTimeline(ids.auth, [], saved.revision), repository.MembershipAccessDeniedError);
  identities.delete(ids.auth);
  await assert.rejects(() => repository.getMemberTimeline(ids.auth), repository.MembershipAccessDeniedError);
  assert.equal(executedQueries.length, beforeWrites, "Denied identities never query private Timeline data");
});

test("Timeline and Future Letter completions persist typed object evidence with shipped guards and idempotency", async (t) => {
  const { db, driver, repository } = await fixture(t);
  await assert.rejects(() => repository.completeMemberFoundationRequirement(ids.auth, "timeline"), /At least one active Timeline entry/);
  assert.equal((await db.query("select count(*)::int as count from member_foundation_requirement_completions")).rows[0].count, 0);
  await repository.saveMemberTimeline(ids.auth, [event()], "0");
  const oldWire = driver.options.serializers[3802](JSON.stringify({ interaction: "member_confirmed_timeline" }));
  await assert.rejects(() => db.query("insert into member_foundation_requirement_completions (member_id,foundation_enrollment_id,requirement_slug,source,evidence,dedupe_key) values ($1,$2,'timeline','member',$3::jsonb,'broken-fixture')", [ids.member, ids.enrollment, oldWire]), { code: "23514" });
  const timeline = await repository.completeMemberFoundationRequirement(ids.auth, "timeline");
  assert.equal(timeline.timeline.completed, true);
  assert.equal(timeline.timeline.entryCount, 1);
  const completed = await repository.completeMemberFoundationRequirement(ids.auth, "future_letter");
  assert.equal(completed.futureLetter.completed, true);
  assert.equal(completed.timeline.completed, true);
  await repository.completeMemberFoundationRequirement(ids.auth, "timeline");
  await repository.completeMemberFoundationRequirement(ids.auth, "future_letter");
  const rows = (await db.query("select requirement_slug, evidence, jsonb_typeof(evidence) as type from member_foundation_requirement_completions order by requirement_slug")).rows;
  assert.deepEqual(rows, [
    { requirement_slug: "future_letter", evidence: { interaction: "member_confirmed_completion" }, type: "object" },
    { requirement_slug: "timeline", evidence: { interaction: "member_confirmed_timeline" }, type: "object" },
  ]);
  await assert.rejects(() => db.query("update member_foundation_requirement_completions set evidence='{}'::jsonb"), /append.only/i);
});

test("optional months sort within each year, with unknown months last and original position resolving ties", async t => {
  const { repository } = await fixture(t);
  const saved = await repository.saveMemberTimeline(ids.auth, [
    { ...event("Unknown first", 2020), month: null },
    { ...event("Following year", 2021), month: 1 },
    { ...event("December", 2020), month: 12 },
    event("Previous year", 2019),
    { ...event("January first", 2020), month: 1 },
    { ...event("January second", 2020), month: 1 },
    event("Unknown second", 2020),
  ], "0");
  assert.deepEqual(saved.entries.map(({ title, month, position }) => [title, month, position]), [
    ["Previous year", null, 4], ["January first", 1, 5], ["January second", 1, 6], ["December", 12, 3],
    ["Unknown first", null, 1], ["Unknown second", null, 7], ["Following year", 1, 2],
  ]);
  assert.deepEqual(await repository.getMemberTimeline(ids.auth), saved);
});

test("month-only edits version history; older clients preserve months, explicit null clears, and stale edits lose atomically", async t => {
  const { db, repository, versionCount } = await fixture(t);
  const first = await repository.saveMemberTimeline(ids.auth, [event()], "0");
  assert.equal(first.entries[0].month, null);
  const january = await repository.saveMemberTimeline(ids.auth, [{ ...entriesForSave(first)[0], month: 1 }], first.revision);
  assert.equal(january.entries[0].month, 1);
  assert.equal(await versionCount(), 2);
  assert.ok(BigInt(january.revision) > BigInt(first.revision));
  const { month: ignored, ...oldClientEntry } = entriesForSave(january)[0];
  assert.equal(ignored, 1);
  const unchanged = await repository.saveMemberTimeline(ids.auth, [oldClientEntry], january.revision);
  assert.equal(unchanged.revision, january.revision);
  assert.equal(unchanged.entries[0].month, 1);
  const edited = await repository.saveMemberTimeline(ids.auth, [{ ...oldClientEntry, title: "Edited by an old client" }], unchanged.revision);
  assert.equal(edited.entries[0].month, 1);
  const cleared = await repository.saveMemberTimeline(ids.auth, [{ ...entriesForSave(edited)[0], month: null }], edited.revision);
  assert.equal(cleared.entries[0].month, null);
  assert.ok(BigInt(cleared.revision) > BigInt(edited.revision));
  const beforeStale = await versionCount();
  await assert.rejects(repository.saveMemberTimeline(ids.auth, [{ ...entriesForSave(january)[0], month: 12 }], january.revision), repository.MembershipConflictError);
  assert.deepEqual(await repository.getMemberTimeline(ids.auth), cleared);
  assert.equal(await versionCount(), beforeStale);
  const deleted = await repository.saveMemberTimeline(ids.auth, [], cleared.revision);
  assert.deepEqual(deleted.entries, []);
  assert.deepEqual((await db.query("select version,action,entry_month from member_timeline_entry_versions order by id")).rows, [
    { version: 1, action: "created", entry_month: null }, { version: 2, action: "updated", entry_month: 1 },
    { version: 3, action: "updated", entry_month: 1 }, { version: 4, action: "updated", entry_month: null },
    { version: 5, action: "deleted", entry_month: null },
  ]);
  await assert.rejects(db.exec("update member_timeline_entry_versions set entry_month=2"), /append.only/i);
  await assert.rejects(db.exec("update member_timeline_entries set entry_month=2"), /deleted Timeline entry is immutable/);
});

test("repository and database reject invalid months without creating entry or history mutations", async t => {
  const { db, repository, versionCount } = await fixture(t);
  for (const month of [0, -1, 13, 1.5, Infinity, NaN, "2", true, {}, []]) {
    await assert.rejects(repository.saveMemberTimeline(ids.auth, [{ ...event(), month }], "0"), repository.MembershipInputError);
  }
  assert.equal(await versionCount(), 0);
  const saved = await repository.saveMemberTimeline(ids.auth, [{ ...event(), month: 12 }], "0");
  for (const month of [0, -1, 13]) {
    await assert.rejects(db.query("update member_timeline_entries set entry_month=$1 where id=$2", [month, saved.entries[0].id]), { code: "23514" });
    await assert.rejects(db.query(`insert into member_timeline_entry_versions(timeline_entry_id,member_id,version,action,entry_year,entry_month,title,position)
      values($1,$2,999,'updated',2020,$3,'Invalid month',1)`, [saved.entries[0].id, ids.member, month]), { code: "23514" });
  }
  assert.equal(await versionCount(), 1);
  assert.deepEqual(await repository.getMemberTimeline(ids.auth), saved);
});

test("additive month migration preserves every existing entry/history field, identity guards and append-only protections", async t => {
  const { db, repository } = await fixture(t, { monthMigration: false });
  await db.query("insert into member_timeline_entries(member_id,entry_year,title,details,updated_by_auth_user_id) values($1,2000,'Before months','Private detail',$2)", [ids.member, ids.auth]);
  const beforeEntries = (await db.query("select to_jsonb(e) as entry from member_timeline_entries e")).rows;
  const beforeHistory = (await db.query("select to_jsonb(v) as version from member_timeline_entry_versions v")).rows;
  const guards = () => db.query("select tgname,tgenabled from pg_trigger where not tgisinternal and tgrelid in ('member_timeline_entries'::regclass,'member_timeline_entry_versions'::regclass) order by tgname");
  const beforeGuards = (await guards()).rows;
  await db.exec(await source("db/migrations/20260927000000_timeline_entry_month.sql"));
  assert.deepEqual((await db.query("select to_jsonb(e)-'entry_month' as entry from member_timeline_entries e")).rows, beforeEntries);
  assert.deepEqual((await db.query("select to_jsonb(v)-'entry_month' as version from member_timeline_entry_versions v")).rows, beforeHistory);
  assert.deepEqual((await guards()).rows, beforeGuards);
  const loaded = await repository.getMemberTimeline(ids.auth);
  assert.equal(loaded.entries[0].month, null);
  assert.equal(loaded.revision, "1");
  await assert.rejects(db.query("update member_timeline_entries set member_id=$1", [ids.otherMember]), /identity fields are immutable/);
  await assert.rejects(db.exec("update member_timeline_entry_versions set entry_month=1"), /append.only/i);
  await assert.rejects(db.exec("delete from member_timeline_entry_versions"), /append.only/i);
});

test("Timelines beyond100 entries support one-row editing and deletion without rewriting unrelated history or positions", async t => {
  const { db, repository, versionCount, executedQueries } = await fixture(t);
  const initial = await repository.saveMemberTimeline(ids.auth, Array.from({ length: 120 }, (_, index) => ({
    ...event(`Moment ${index + 1}`, 2000 + index % 5), month: index % 12 + 1,
  })), "0");
  assert.equal(initial.entries.length, 120);
  assert.equal(await versionCount(), 120);
  const added = await repository.upsertMemberTimelineEntry(ids.auth, { ...event("One more", 1999), month: 1 }, initial.revision);
  assert.equal(added.entries.length, 121);
  const target = added.entries.find(entry => entry.title === "One more");
  assert.equal(target.position, 121);
  assert.equal(added.entries[0].id, target.id);
  const untouched = () => db.query("select to_jsonb(e) as entry from member_timeline_entries e where id<>$1 order by id", [target.id]);
  const untouchedHistory = () => db.query("select to_jsonb(v) as version from member_timeline_entry_versions v where timeline_entry_id<>$1 order by id", [target.id]);
  const before = (await untouched()).rows;
  const beforeHistory = (await untouchedHistory()).rows;
  const previousQueries = executedQueries.length;
  const edited = await repository.upsertMemberTimelineEntry(ids.auth, { ...target, month: 12 }, added.revision);
  assert.equal(edited.entries.find(e => e.id === target.id).position, 121);
  assert.equal(edited.entries.find(e => e.id === target.id).month, 12);
  assert.equal(await versionCount(), 122);
  assert.equal(executedQueries.slice(previousQueries).filter(query => /update member_timeline_entries/.test(query)).length, 1);
  assert.deepEqual((await untouched()).rows, before);
  assert.deepEqual((await untouchedHistory()).rows, beforeHistory);
  const { month, ...legacyEntry } = edited.entries.find(e => e.id === target.id);
  assert.equal(month, 12);
  const noop = await repository.upsertMemberTimelineEntry(ids.auth, legacyEntry, edited.revision);
  assert.deepEqual(noop, edited);
  assert.equal(await versionCount(), 122);
  const legacyEdit = await repository.upsertMemberTimelineEntry(ids.auth, { ...legacyEntry, title: "Old client title edit" }, noop.revision);
  assert.equal(legacyEdit.entries.find(e => e.id === target.id).month, 12);
  const cleared = await repository.upsertMemberTimelineEntry(ids.auth, { ...legacyEntry, month: null }, legacyEdit.revision);
  assert.equal(cleared.entries.find(e => e.id === target.id).month, null);
  const removed = await repository.deleteMemberTimelineEntry(ids.auth, target.id, cleared.revision);
  assert.equal(removed.entries.length, 120);
  assert.deepEqual((await untouched()).rows, before);
  assert.deepEqual((await untouchedHistory()).rows, beforeHistory);
  const next = await repository.upsertMemberTimelineEntry(ids.auth, event("After deletion", 2000), removed.revision);
  assert.equal(next.entries.find(e => e.title === "After deletion").position, 122, "Soft-deleted positions are not recycled");
  assert.equal(await versionCount(), 126);
});

test("single-entry mutations retain owner isolation, stale revision protection and one concurrent winner", async t => {
  const { repository, versionCount } = await fixture(t);
  const own = await repository.upsertMemberTimelineEntry(ids.auth, { ...event(), month: 3 }, "0");
  const other = await repository.upsertMemberTimelineEntry(ids.otherAuth, event("Private other moment"), "0");
  const versions = await versionCount();
  for (const write of [
    () => repository.upsertMemberTimelineEntry(ids.auth, other.entries[0], own.revision),
    () => repository.deleteMemberTimelineEntry(ids.auth, other.entries[0].id, own.revision),
    () => repository.deleteMemberTimelineEntry(ids.auth, own.entries[0].id, "0"),
    () => repository.upsertMemberTimelineEntry(ids.auth, { ...own.entries[0], month: 10 }, "0"),
  ]) await assert.rejects(write, repository.MembershipConflictError);
  assert.equal(await versionCount(), versions);
  assert.deepEqual(await repository.getMemberTimeline(ids.otherAuth), other);
  assert.deepEqual(await repository.getMemberTimeline(ids.auth), own);
  const results = await Promise.allSettled([1, 12].map(month => repository.upsertMemberTimelineEntry(ids.auth, { ...own.entries[0], month }, own.revision)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(results.find(result => result.status === "rejected").reason instanceof repository.MembershipConflictError);
  const winner = results.find(result => result.status === "fulfilled").value;
  const removed = await repository.deleteMemberTimelineEntry(ids.auth, winner.entries[0].id, winner.revision);
  await assert.rejects(repository.deleteMemberTimelineEntry(ids.auth, winner.entries[0].id, removed.revision), repository.MembershipConflictError);
  await assert.rejects(repository.upsertMemberTimelineEntry(ids.auth, winner.entries[0], removed.revision), repository.MembershipConflictError);
  assert.deepEqual(await repository.getMemberTimeline(ids.auth), removed);
});

test("single-entry actions reject invalid IDs, months and missing revisions without creating history", async t => {
  const { repository, versionCount } = await fixture(t);
  for (const revision of [undefined, null, "", "-1", "1.0", "invalid"]) {
    await assert.rejects(repository.upsertMemberTimelineEntry(ids.auth, event(), revision), repository.MembershipConflictError);
    await assert.rejects(repository.deleteMemberTimelineEntry(ids.auth, ids.member, revision), repository.MembershipConflictError);
  }
  for (const id of ["", "other", null, undefined]) {
    await assert.rejects(repository.deleteMemberTimelineEntry(ids.auth, id, "0"), repository.MembershipInputError);
  }
  for (const month of [0, 13, 1.5, "2"]) {
    await assert.rejects(repository.upsertMemberTimelineEntry(ids.auth, { ...event(), month }, "0"), repository.MembershipInputError);
  }
  assert.equal(await versionCount(), 0);
});
