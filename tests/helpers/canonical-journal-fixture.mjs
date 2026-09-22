import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import ts from "typescript";

import { Parameter, types } from "../../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../../scripts/check-support-schema.mjs";
import { installOperatorFundingFunctions } from "./operator-funding-fixture.mjs";

export const timelineIds = {
  member: "11111111-1111-4111-8111-111111111111",
  person: "22222222-2222-4222-8222-222222222222",
  auth: "33333333-3333-4333-8333-333333333333",
  enrollment: "44444444-4444-4444-8444-444444444444",
  otherMember: "55555555-5555-4555-8555-555555555555",
  otherAuth: "66666666-6666-4666-8666-666666666666",
  otherEnrollment: "77777777-7777-4777-8777-777777777777",
};
const source = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

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

export async function timelineFixture(t, { monthMigration = true } = {}) {
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
  if (monthMigration) {
    await db.exec(await source("db/migrations/20260927000000_timeline_entry_month.sql"));
    await db.exec(await source("db/migrations/20260916230000_member_journal.sql"));
    const deletion = await source("db/migrations/20260921210000_member_deletion.sql");
    for (const name of ["member_deletion_records", "member_deletion_jobs"]) {
      const definition = deletion.match(new RegExp(`create table private\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
      assert.ok(definition, `Missing shipped table ${name}`);
      await db.exec(definition);
    }
    for (const name of ["ruined_member_deletion_authorized", "ruined_guard_erased_account_write"]) {
      const definition = deletion.match(new RegExp(`create function private\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];
      assert.ok(definition, `Missing shipped guard ${name}`);
      await db.exec(definition);
    }
    await db.exec(await source("db/migrations/20260928000000_unified_member_journal.sql"));
  }
  await db.query("insert into people (id) values ($1),($2)", [timelineIds.person, timelineIds.otherMember]);
  await db.query("insert into ruined_members (id,person_id) values ($1,$2),($3,$3)", [timelineIds.member, timelineIds.person, timelineIds.otherMember]);
  await db.query("insert into platform_users (auth_user_id,member_id,person_id) values ($1,$2,$3),($4,$5,$5)", [timelineIds.auth, timelineIds.member, timelineIds.person, timelineIds.otherAuth, timelineIds.otherMember]);
  await db.query("insert into platform_role_grants (auth_user_id,role_slug) values ($1,'member'),($2,'member')", [timelineIds.auth, timelineIds.otherAuth]);
  await db.query("insert into member_lifecycle (member_id) values ($1),($2)", [timelineIds.member, timelineIds.otherMember]);
  await db.query("insert into foundation_enrollments (id,member_id,status) values ($1,$2,'in_progress'),($3,$4,'in_progress')", [timelineIds.enrollment, timelineIds.member, timelineIds.otherEnrollment, timelineIds.otherMember]);
  const identities = new Map([
    [timelineIds.auth, { member_id: timelineIds.member, auth_user_id: timelineIds.auth }],
    [timelineIds.otherAuth, { member_id: timelineIds.otherMember, auth_user_id: timelineIds.otherAuth }],
  ].map(([auth, identity]) => [auth, {
    ...identity, person_id: timelineIds.person, email: "member@example.test", account_state: "active",
    administrative_onboarding_state: "completed", billing_state: "active", program_state: "active",
    foundations_state: "in_progress", standing_state: "active", cancellation_effective_at: null,
  }]));
  const executedQueries = [];
  let beforeTransaction = null;
  const wrap = (engine) => {
    const sql = (strings, ...values) => {
      if (!strings.raw) return { list: strings };
      return execute(strings, ...values);
    };
    const execute = async (strings, ...values) => {
      const text = strings.join("?");
      // Identity output is the sole query mock. All Timeline reads/writes,
      // revisions, history triggers and requirement completion use real SQL.
      if (text.includes("from platform_users platform_user")) {
        const identity = identities.get(values[0]);
        return identity ? [{ ...identity }] : [];
      }
      let query = strings[0];
      const parameters = [];
      values.forEach((value, index) => {
        if (value && value.list) {
          query += '(' + value.list.map(item => { parameters.push(item); return `$${parameters.length}`; }).join(',') + ')' + strings[index + 1];
          return;
        }
        query += `$${parameters.length + 1}${strings[index + 1]}`;
        const normalize = () => {
        if (value instanceof Parameter) {
          assert.equal(value.type, 3802);
          return driver.options.serializers[3802](value.value);
        }
        if (value !== null && /^\s*::jsonb\b/.test(strings[index + 1])) {
          return driver.options.serializers[3802](value);
        }
        return value instanceof Date ? types.date.serialize(value) : value;
        };
        parameters.push(normalize());
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
  const versionCount = async () => (await db.query("select count(*)::int as count from member_journal_entry_versions")).rows[0].count;
  return { db, driver, executedQueries, identities, repository, sql: wrap(db), loadTypescript, versionCount, beforeNextTransaction: (change) => { beforeTransaction = change; } };
}
