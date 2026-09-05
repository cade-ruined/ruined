import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";

import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

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
const entriesForSave = (snapshot) => snapshot.entries.map(({ details, id, title, year }) => ({ details, id, title, year }));
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

async function fixture(t) {
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
    create table ruined_members (id uuid primary key);
    create table platform_users (auth_user_id uuid primary key);
    create table foundation_enrollments (id uuid primary key, member_id uuid not null references ruined_members(id), status text, enrolled_at timestamptz default now());
    ${appendOnly}
    ${automation.slice(start, end)}
  `);
  await db.query("insert into ruined_members values ($1),($2)", [ids.member, ids.otherMember]);
  await db.query("insert into platform_users values ($1),($2)", [ids.auth, ids.otherAuth]);
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
    sql.begin = (callback) => engine.transaction((transaction) => callback(wrap(transaction)));
    return sql;
  };
  const access = await loadTypescript("src/lib/membership/access-policy.ts");
  const repository = await loadTypescript("src/lib/membership/repository.ts", {
    "server-only": {}, "libphonenumber-js/min": {},
    "@/lib/database/server": { getApplicationDatabase: () => wrap(db) },
    "@/lib/membership/access-policy": access,
    "@/lib/membership/phone": {}, "@/lib/membership/avatar-url": {},
    "@/lib/membership/artifact-products": {}, "@/lib/events/member-experiences": {},
    "@/lib/google/communications": {}, "@/lib/platform/ops-calendar-repository": {},
    "@/lib/platform/calendar-audience-invalidation": {},
    "@/lib/platform/experience-member-access": {},
  });
  const versionCount = async () => (await db.query("select count(*)::int as count from member_timeline_entry_versions")).rows[0].count;
  return { db, driver, executedQueries, identities, repository, versionCount };
}

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
