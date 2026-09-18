import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const require = createRequire(import.meta.url);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), guide = id(2), inactive = id(3), revoked = id(4);
function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    throw new Error(`Unexpected historical record dependency: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema private;
    create table platform_users(auth_user_id uuid primary key,status text,person_id uuid);
    create table person_profiles(person_id uuid primary key,display_name text,preferred_name text);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table ruined_members(id uuid primary key,deleted_at timestamptz,email text);
    create table private.member_deletion_records(member_id uuid primary key,display_name text not null,member_tag text,
      member_number integer,joined_at timestamptz,deleted_at timestamptz not null,reason text not null,actor_auth_user_id uuid not null);
    create table private.member_deletion_jobs(id uuid primary key,member_id uuid,status text,created_at timestamptz,auth_user_ids uuid[],last_error text);
    create table member_lifecycle(member_id uuid primary key,account_state text,billing_state text,standing_state text);
    create table member_state_history(id bigint generated always as identity primary key,member_id uuid,dimension text,
      previous_state text,next_state text,source text,occurred_at timestamptz,actor_auth_user_id uuid,metadata jsonb);
    create table operator_audit_events(id bigint generated always as identity primary key,member_id uuid,subject_type text,subject_id text,
      action text,occurred_at timestamptz,actor_auth_user_id uuid,reason text,before_snapshot jsonb,after_snapshot jsonb,metadata jsonb);
  `);
  for (const [actor, status, role, ended] of [[admin,"active","ops_admin",null],[guide,"active","guide",null],[inactive,"suspended","ops_admin",null],[revoked,"active","ops_admin","2026-01-01"]]) {
    await db.query("insert into platform_users(auth_user_id,status) values($1,$2)", [actor,status]);
    await db.query("insert into platform_role_grants values($1,$2,$3)", [actor,role,ended]);
  }
  const queries = [];
  const sql = { begin: callback => db.transaction(async tx => callback(async (strings, ...values) => {
    const query = strings.reduce((result, string, index) => result + (index ? `$${index}` : "") + string, "");
    queries.push({ query, values });
    return (await tx.query(query, values)).rows;
  })) };
  const repository = load("src/lib/platform/member-history-repository.ts", { "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => sql } });
  async function add(n, { name = `Historical ${n}`, tag = `former_${n}`, number = n, deleted = true, snapshot = true, joined = "2025-01-01" } = {}) {
    await db.query("insert into ruined_members values($1,$2,$3)", [id(n), deleted ? "2026-09-18" : null, `PRIVATE_EMAIL_${n}@example.test`]);
    if (snapshot) await db.query("insert into private.member_deletion_records values($1,$2,$3,$4,$5,'2026-09-18','member_request',$6)", [id(n),name,tag,number,joined,admin]);
    if (deleted) await db.query("insert into private.member_deletion_jobs values($1,$1,'pending','2026-09-18',$2,'SECRET_PROVIDER')", [id(n),[id(n + 1000)]]);
    await db.query("insert into member_lifecycle values($1,'closed','ended','inactive')", [id(n)]);
    return id(n);
  }
  return { db, repository, add, queries };
}

test("historical reads require an active, unrevoked administrator before selecting any member data", async t => {
  const { repository, add, queries } = await fixture(t);
  const member = await add(100);
  for (const actor of [guide,inactive,revoked,id(999)]) {
    for (const read of [() => repository.getHistoricalMemberDirectory(actor), () => repository.getHistoricalMemberRecord(actor,member)]) {
      queries.length = 0;
      await assert.rejects(read(), error => error.status === 403);
      assert.equal(queries.some(({ query }) => query.includes("private.member_deletion_records")), false);
    }
  }
  queries.length = 0;
  await assert.rejects(repository.getHistoricalMemberDirectory("not-an-id"), error => error.status === 403);
  assert.equal(queries.length, 0);
  assert.equal(await repository.getHistoricalMemberRecord(admin,"invalid-member"), null);
  assert.equal(queries.length, 0);
});

test("historical counts and search include only saved deleted records and retain permanent numbers", async t => {
  const { repository, add } = await fixture(t);
  await add(101, { name: "Former Example", tag: "former_example", number: 1 });
  await add(102, { name: "Another Person", tag: null, number: 10001, joined: null });
  await add(103, { deleted: false });
  await add(104, { snapshot: false });
  const all = await repository.getHistoricalMemberDirectory(admin);
  assert.equal(all.totalResults, 2);
  assert.equal(all.members[0].memberNumber, 1);
  assert.equal(all.members[1].memberNumber, 10001);
  assert.equal(all.members[1].joinedAt, null);
  assert.doesNotMatch(JSON.stringify(all), /PRIVATE_EMAIL|person_id/);
  for (const query of ["Former Example", "@FORMER_EXAMPLE", "0001", "No. 0001"]) {
    const result = await repository.getHistoricalMemberDirectory(admin, { query });
    assert.equal(result.totalResults, 1, query);
    assert.equal(result.members[0].memberId, id(101));
  }
  assert.equal((await repository.getHistoricalMemberDirectory(admin, { query: "10001" })).members[0].memberId, id(102));
  assert.equal((await repository.getHistoricalMemberDirectory(admin, { query: "%' OR true --" })).totalResults, 0);
  assert.equal(await repository.getHistoricalMemberRecord(admin,id(103)), null);
  assert.equal(await repository.getHistoricalMemberRecord(admin,id(104)), null);
});

test("historical directory paginates a stable separate count and clamps invalid or excessive pages", async t => {
  const { repository, add } = await fixture(t);
  for (let n = 101; n <= 127; n++) await add(n);
  const first = await repository.getHistoricalMemberDirectory(admin, { page: -3 });
  const last = await repository.getHistoricalMemberDirectory(admin, { page: 999 });
  assert.equal(first.members.length, 25);
  assert.equal(first.page, 1);
  assert.equal(last.page, 2);
  assert.equal(last.members.length, 2);
  assert.equal(last.totalResults, 27);
  assert.equal(new Set([...first.members, ...last.members].map(member => member.memberId)).size, 27);
  assert.equal((await repository.getHistoricalMemberDirectory(admin, { query: "  Former   name  " })).query, "Former name");
  assert.equal((await repository.getHistoricalMemberDirectory(admin, { query: "x".repeat(200) })).query.length, 120);
});

test("historical detail exposes only bounded membership transitions and audit metadata, never snapshots or notes", async t => {
  const { db, repository, add, queries } = await fixture(t);
  const member = await add(101), other = await add(102);
  for (let n = 0; n < 55; n++) {
    await db.query("insert into member_state_history(member_id,dimension,previous_state,next_state,source,occurred_at,actor_auth_user_id,metadata) values($1,'account','active','closed','ops','2026-09-18',$2,'{\"private_note\":\"SECRET_STATE\"}')", [member,admin]);
    await db.query("insert into operator_audit_events(member_id,subject_type,subject_id,action,occurred_at,actor_auth_user_id,reason,before_snapshot,after_snapshot,metadata) values($1,'member',$2,'member.account_closed','2026-09-18',$3,'SECRET_REASON','{\"bio\":\"SECRET_BEFORE\"}','{\"phone\":\"SECRET_AFTER\"}','{\"note\":\"SECRET_METADATA\"}')", [n % 2 ? member : null,member,admin]);
  }
  await db.query("insert into operator_audit_events(member_id,subject_type,subject_id,action,occurred_at) values($1,'member',$2,'unrelated.other_member','2026-09-19')", [other,other]);
  const record = await repository.getHistoricalMemberRecord(admin,member);
  assert.equal(record.accountState, "closed");
  assert.equal(record.billingState, "ended");
  assert.equal(record.deletedByAuthUserId, admin);
  assert.equal(record.deletedByName, "Administrator");
  assert.equal(record.cleanupStatus, "pending");
  assert.equal(record.membershipHistory.length, 50);
  assert.equal(record.auditHistory.length, 50);
  assert.equal(record.membershipHistory[0].id, "55");
  assert.equal(record.auditHistory[0].id, "55");
  assert.equal(record.auditHistory[0].actorAuthUserId, admin);
  assert.equal(record.auditHistory[0].actorName, "Administrator");
  assert.doesNotMatch(JSON.stringify(record), /SECRET_|PRIVATE_EMAIL|unrelated.other_member/);
  assert.ok(queries.some(({ query }) => query.includes("repeatable read read only")));
  assert.equal(queries.some(({ query }) => /\b(insert|update|delete)\s+(into|from|set)/i.test(query)), false);
  await db.query("update platform_users set person_id=$1 where auth_user_id=$2", [id(500),admin]);
  await db.query("insert into person_profiles values($1,'Archive Keeper','Earlier name')", [id(500)]);
  for (const status of ["processing", "completed"]) {
    await db.query("update private.member_deletion_jobs set status=$1 where member_id=$2", [status,member]);
    const updated = await repository.getHistoricalMemberRecord(admin,member);
    assert.equal(updated.cleanupStatus, status);
    assert.equal(updated.deletedByName, "Archive Keeper");
    assert.equal(updated.membershipHistory[0].actorName, "Archive Keeper");
    assert.equal(updated.auditHistory[0].actorName, "Archive Keeper");
    assert.doesNotMatch(JSON.stringify(updated), /SECRET_|PRIVATE_EMAIL/);
  }
});

const tier = load("src/lib/membership/member-number.ts");
const directoryUi = load("src/components/platform/OperatorHistoricalMemberDirectory.tsx", {
  "@/components/platform/operatorStyles": {}, "@/lib/membership/member-number": tier,
});
const entry = { memberId: id(100), displayName: "Former Example", memberTag: "former_example", memberNumber: 1, joinedAt: "2025-01-01T00:00:00.000Z", deletedAt: "2026-09-18T00:00:00.000Z", reason: "member_request" };
const directory = { members: [entry], query: "", page: 1, pageSize: 25, pageCount: 1, totalResults: 1 };
const historicalRecord = { ...entry, deletedByAuthUserId: admin, deletedByName: "Administrator", cleanupStatus: "pending", accountState: "closed", billingState: "ended", standingState: "inactive", membershipHistory: [{ id: "1", dimension: "account", previousState: "active", nextState: "closed", source: "ops", occurredAt: entry.deletedAt, actorAuthUserId: admin, actorName: "Administrator" }], auditHistory: [{ id: "2", action: "member.account_closed", occurredAt: entry.deletedAt, actorAuthUserId: admin, actorName: "Administrator" }] };
function pageFixture() {
  const state = { context: { state: "authenticated", role: "ops_admin", viewer: { authUserId: admin } }, calls: [], record: historicalRecord, error: null };
  class MemberHistoryRepositoryError extends Error { constructor(status) { super("Denied"); this.status = status; } }
  const dependencies = {
    "next/navigation": { redirect: href => { throw new Error(`REDIRECT:${href}`); }, notFound: () => { throw new Error("NOT_FOUND"); } },
    "@/components/platform/OperatorHistoricalMemberDirectory": directoryUi,
    "@/components/platform/OperatorPageFrame": { __esModule: true, default: ({ children }) => React.createElement("main", null, children) },
    "@/components/platform/PlatformUnavailable": { __esModule: true, default: () => React.createElement("p", null, "Unavailable") },
    "@/lib/membership/member-number": tier,
    "@/lib/platform/page-data": { getOperatorAccessContext: async () => state.context },
    "@/lib/platform/member-history-repository": {
      MemberHistoryRepositoryError,
      getHistoricalMemberDirectory: async (...args) => { state.calls.push(args); if (state.error) throw state.error; return directory; },
      getHistoricalMemberRecord: async (...args) => { state.calls.push(args); if (state.error) throw state.error; return state.record; },
    },
  };
  return { state, MemberHistoryRepositoryError,
    DirectoryPage: load("app/ops/members/history/page.tsx", dependencies).default,
    RecordPage: load("app/ops/members/history/[memberId]/page.tsx", dependencies).default,
  };
}
const searchParams = () => Promise.resolve({});
const params = () => Promise.resolve({ memberId: entry.memberId });

test("both historical routes deny non-administrators before any repository read", async () => {
  const { state, DirectoryPage, RecordPage } = pageFixture();
  for (const role of ["guide", "circle_leader", null]) {
    state.context.role = role;
    for (const Page of [DirectoryPage, RecordPage]) {
      const html = renderToStaticMarkup(await Page({ searchParams: searchParams(), params: params() }));
      assert.match(html, /Administrator access required/);
      assert.doesNotMatch(html, /Former Example|former_example|0001/);
    }
  }
  assert.equal(state.calls.length, 0);
  state.context.state = "signed_out";
  await assert.rejects(DirectoryPage({ searchParams: searchParams() }), /REDIRECT:\/ops\/access/);
  await assert.rejects(RecordPage({ params: params() }), /REDIRECT:\/ops\/access/);
  assert.equal(state.calls.length, 0);
});

test("historical preview is empty and nonmutating; missing or newly forbidden records fail closed", async () => {
  const { state, DirectoryPage, RecordPage, MemberHistoryRepositoryError } = pageFixture();
  state.context = { state: "preview", role: "ops_admin", viewer: null };
  const preview = renderToStaticMarkup(await DirectoryPage({ searchParams: searchParams() }));
  assert.match(preview, /Preview only/);
  assert.doesNotMatch(preview, /Former Example/);
  await assert.rejects(RecordPage({ params: params() }), /NOT_FOUND/);
  assert.equal(state.calls.length, 0);
  state.context = { state: "authenticated", role: "ops_admin", viewer: { authUserId: admin } };
  state.record = null;
  await assert.rejects(RecordPage({ params: params() }), /NOT_FOUND/);
  state.error = new MemberHistoryRepositoryError(403);
  for (const Page of [DirectoryPage, RecordPage]) {
    const html = renderToStaticMarkup(await Page({ searchParams: searchParams(), params: params() }));
    assert.match(html, /Administrator access required/);
    assert.doesNotMatch(html, /Former Example/);
  }
});

test("historical directory uses its own count and history routes; detail is entirely read-only", async () => {
  const { state, DirectoryPage, RecordPage } = pageFixture();
  const list = renderToStaticMarkup(await DirectoryPage({ searchParams: searchParams() }));
  assert.match(list, /1–1 of 1 historical members/);
  assert.match(list, /Founders · No\. 0001/);
  assert.match(list, /@former_example/);
  assert.match(list, new RegExp(`/ops/members/history/${entry.memberId}`));
  assert.doesNotMatch(list, new RegExp(`href="/ops/members/${entry.memberId}"`));
  const detail = renderToStaticMarkup(await RecordPage({ params: params() }));
  assert.match(detail, /Account deleted/);
  assert.match(detail, /excluded from current member counts/);
  assert.match(detail, /Member request/);
  assert.match(detail, /Membership history/);
  assert.match(detail, /Audit history/);
  assert.match(detail, /member · account closed/);
  assert.match(detail, /cleanup is pending/);
  assert.match(detail, /Administrator/);
  assert.doesNotMatch(detail, new RegExp(admin));
  assert.doesNotMatch(detail, /<form|<button|<input|Edit profile|Delete member|Record a state correction/);
  assert.deepEqual(state.calls.at(-1), [admin, entry.memberId]);
  for (const [cleanupStatus, copy] of [["processing", /cleanup is in progress/], ["completed", /cleanup is complete/], [null, /cleanup status is currently unavailable/]]) {
    state.record = { ...historicalRecord, cleanupStatus };
    assert.match(renderToStaticMarkup(await RecordPage({ params: params() })), copy);
  }
});
