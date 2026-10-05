import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";
import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const compiled = new Map();
async function load(path, dependencies) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(await source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled.get(path))(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected import ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
class OpsOperatingRepositoryError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const errors = { OpsOperatingRepositoryError };
const ids = {
  admin: "11111111-1111-4111-8111-111111111111",
  guide: "22222222-2222-4222-8222-222222222222",
  leader: "33333333-3333-4333-8333-333333333333",
  member: "44444444-4444-4444-8444-444444444444",
};
const input = overrides => ({ title: "Prepare a member call", summary: "Steps for the weekly call.",
  category: "Membership", bodyText: "1. Open the call.\n2. Welcome members.", externalUrl: null, status: "draft", ...overrides });

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  // Reuse postgres-js wire serializers without opening a network connection.
  const driver = postgres({ host: "127.0.0.1", port: 1, max: 1 });
  t.after(async () => { await db.close(); await driver.end(); });
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table platform_users(auth_user_id uuid primary key, status text, email_normalized text);
    create table platform_role_grants(auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table user_profiles(auth_user_id uuid primary key, display_name text);
    create table operator_audit_events(actor_auth_user_id uuid, action text, subject_type text, subject_id text,
      before_snapshot jsonb check(before_snapshot is null or jsonb_typeof(before_snapshot)='object'),
      after_snapshot jsonb check(jsonb_typeof(after_snapshot)='object'), metadata jsonb, dedupe_key text unique);
  `);
  const migration = await source("db/migrations/20261005170000_operator_sops.sql");
  await db.exec(migration);
  for (const [role, id] of Object.entries(ids)) {
    await db.query("insert into platform_users values($1,'active',$2)", [id, `${role}@example.com`]);
    if (role !== "member") await db.query("insert into platform_role_grants values($1,$2,null)", [id, { admin: "ops_admin", guide: "guide", leader: "circle_leader" }[role]]);
  }
  await db.query("insert into user_profiles values($1,'Cade')", [ids.admin]);
  const queries = [];
  const failure = { audit: false };
  function wrap(engine) {
    const sql = async (strings, ...values) => {
      let query = strings[0];
      const params = values.map((value, index) => {
        query += `$${index + 1}${strings[index + 1]}`;
        if (value instanceof Parameter) return driver.options.serializers[3802](value.value);
        return value instanceof Date ? types.date.serialize(value) : value;
      });
      queries.push(query.replace(/\s+/g, " ").trim());
      if (failure.audit && /insert into operator_audit_events/.test(query)) throw new Error("Injected audit failure");
      return (await engine.query(query, params)).rows;
    };
    sql.json = driver.json;
    sql.begin = callback => engine.transaction(tx => callback(wrap(tx)));
    return sql;
  }
  const repository = await load("src/lib/platform/ops-sop-repository.ts", {
    "server-only": {}, "node:crypto": crypto,
    "@/lib/database/server": { getApplicationDatabase: () => wrap(db) },
    "@/lib/platform/ops-operating-repository": errors,
  });
  const save = values => repository.saveOpsSop(ids.admin, input(values));
  return { db, repository, save, failure, queries, migration };
}

test("SOP lifecycle persists content, authorship, atomic revisions and audit through archive and restore", async t => {
  const f = await fixture(t);
  const draft = await f.save({ bodyText: "", category: "" });
  assert.equal(draft.revision, 1);
  assert.equal(draft.category, "General");
  assert.equal(draft.updatedBy, "Cade");
  assert.equal(draft.publishedAt, null);
  const published = await f.save({ id: draft.id, expectedRevision: 1, status: "published" });
  assert.equal(published.revision, 2);
  assert.ok(published.publishedAt);
  const archived = await f.save({ id: draft.id, expectedRevision: 2, status: "archived" });
  const restored = await f.save({ id: draft.id, expectedRevision: 3, status: "published", bodyText: "Updated instructions" });
  assert.equal(archived.status, "archived");
  assert.equal(restored.publishedAt, published.publishedAt);
  assert.equal(restored.createdAt, draft.createdAt);
  assert.equal(restored.revision, 4);
  const editor = await f.repository.getOpsSop(ids.admin, draft.id);
  assert.deepEqual(editor.history.map(row => [row.revision, row.status]), [[4,"published"],[3,"archived"],[2,"published"],[1,"draft"]]);
  assert.equal(editor.history[3].bodyText, "");
  assert.equal((await f.db.query("select count(*)::int as total from operator_audit_events")).rows[0].total, 4);
  assert.ok(f.queries.some(query => query.includes("for update of platform_user, role_grant")));
  f.failure.audit = true;
  await assert.rejects(f.save({ id: draft.id, expectedRevision: 4, title: "Should roll back" }), /Injected audit failure/);
  const after = await f.repository.getOpsSop(ids.admin, draft.id);
  assert.equal(after.procedure.revision, 4);
  assert.equal(after.history.length, 4);
});

test("operators only see published procedures and admins retain private drafts/history", async t => {
  const f = await fixture(t);
  const draft = await f.save({ title: "Private draft", bodyText: "INTERNAL DRAFT SECRET" });
  const archived = await f.save({ status: "archived", title: "Archived", bodyText: "ARCHIVED SECRET" });
  const published = await f.save({ status: "published" });
  for (const role of ["guide", "leader"]) {
    const library = await f.repository.getOpsSops(ids[role]);
    assert.equal(library.canManage, false);
    assert.deepEqual(library.procedures.map(row => row.id), [published.id]);
    assert.doesNotMatch(JSON.stringify(library), /SECRET/);
    const detail = await f.repository.getOpsSop(ids[role], published.id);
    assert.deepEqual(detail.history, []);
    for (const hidden of [draft.id, archived.id]) await assert.rejects(f.repository.getOpsSop(ids[role], hidden), error => error.code === "not_found");
    await assert.rejects(f.repository.saveOpsSop(ids[role], input()), error => error.code === "forbidden");
  }
  assert.equal((await f.repository.getOpsSops(ids.admin)).procedures.length, 3);
  await assert.rejects(f.repository.getOpsSops(ids.member), error => error.code === "forbidden");
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [ids.admin]);
  await assert.rejects(f.save({ id: published.id, expectedRevision: 1 }), error => error.code === "forbidden");
  await assert.rejects(f.repository.getOpsSops(ids.admin), error => error.code === "forbidden");
  await f.db.query("update platform_users set status='suspended' where auth_user_id=$1", [ids.guide]);
  await assert.rejects(f.repository.getOpsSops(ids.guide), error => error.code === "forbidden");
});

test("concurrent saves reject stale revision without losing the winning change", async t => {
  const f = await fixture(t);
  const original = await f.save({});
  const outcomes = await Promise.allSettled([
    f.save({ id: original.id, expectedRevision: 1, title: "First update" }),
    f.save({ id: original.id, expectedRevision: 1, title: "Competing update" }),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(outcome => outcome.status === "rejected").reason.code, "conflict");
  const latest = await f.repository.getOpsSop(ids.admin, original.id);
  assert.equal(latest.procedure.revision, 2);
  assert.equal(latest.history.length, 2);
  assert.equal(latest.procedure.title, outcomes.find(outcome => outcome.status === "fulfilled").value.title);
});

test("validation rejects empty publication, malformed links, oversized fields and missing revisions", async t => {
  const f = await fixture(t);
  for (const override of [
    { title: " " }, { title: "x".repeat(201) }, { category: "x".repeat(81) }, { summary: "x".repeat(2001) },
    { bodyText: "x".repeat(100001) }, { title: "a\0b" }, { title: 22 },
    { status: "published", bodyText: "" }, { status: "deleted" }, { externalUrl: "javascript:alert(1)" },
    { externalUrl: "http://example.com" }, { externalUrl: "https://user:secret@example.com" },
    { externalUrl: "https://example.com/" + "x".repeat(2048) },
  ]) await assert.rejects(f.save(override), error => error.code === "invalid_request");
  const published = await f.save({ status: "published", bodyText: "", externalUrl: "https://docs.google.com/document/d/example/edit" });
  assert.ok(published.externalUrl.startsWith("https:"));
  await assert.rejects(f.save({ id: published.id }), error => error.code === "invalid_request");
});

test("migration denies direct browser access and enforces immutable revisions and record identity", async t => {
  const f = await fixture(t);
  await f.db.exec(f.migration);
  const procedure = await f.save({});
  for (const query of [
    "update operator_sop_revisions set body_text='tampered'", "delete from operator_sop_revisions", "truncate operator_sop_revisions",
    "delete from operator_sops", "truncate operator_sops cascade", "update operator_sops set title='Bypass revision'",
    "update operator_sops set created_at=now()+interval '1 day',revision=revision+1",
  ]) await assert.rejects(f.db.exec(query), /append-only|never deleted|exactly one|immutable/);
  assert.equal((await f.repository.getOpsSop(ids.admin, procedure.id)).history.length, 1);
  const policies = (await f.db.query("select relname,relrowsecurity from pg_class where relname in ('operator_sops','operator_sop_revisions')")).rows;
  assert.equal(policies.length, 2);
  assert.ok(policies.every(row => row.relrowsecurity));
  for (const role of ["anon", "authenticated"]) {
    await f.db.exec(`set role ${role}`);
    try {
      await assert.rejects(f.db.query("select * from operator_sops"), /permission denied/);
      await assert.rejects(f.db.query("select * from operator_sop_revisions"), /permission denied/);
    } finally { await f.db.exec("reset role"); }
  }
});

test("API guards session/origin/JSON, bounds streamed bodies and maps read/write/conflict responses", async t => {
  const f = await fixture(t);
  const state = { viewer: { authUserId: ids.admin } };
  const session = { getCurrentPlatformViewer: async () => state.viewer };
  const authRequest = await load("src/lib/auth/request.ts", {});
  const api = await load("src/lib/platform/ops-api.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/auth/request": authRequest, "@/lib/auth/session": session,
    "@/lib/platform/ops-operating-repository": errors,
  });
  const request = await load("app/api/ops/sops/_request.ts", {
    "@/lib/platform/ops-api": api, "@/lib/platform/ops-operating-repository": errors,
  });
  const deps = { "@/lib/auth/session": session, "@/lib/platform/ops-api": api,
    "@/lib/platform/ops-sop-repository": f.repository };
  const index = await load("app/api/ops/sops/route.ts", { ...deps, "./_request": request });
  const detail = await load("app/api/ops/sops/[sopId]/route.ts", { ...deps, "../_request": request });
  const req = (body, headers = {}, method = "POST") => new Request("https://members.example.com/api/ops/sops", {
    method, headers: { origin: "https://members.example.com", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  state.viewer = null;
  assert.equal((await index.GET()).status, 401);
  assert.equal((await index.POST(req(input()))).status, 401);
  state.viewer = { authUserId: ids.admin };
  assert.equal((await index.POST(req(input(), { origin: "https://foreign.example.com" }))).status, 403);
  assert.equal((await index.POST(req(input(), { "content-type": "text/plain" }))).status, 415);
  for (const invalid of [null, [], "not-json", { ...input(), title: 44 }, { ...input(), injected: true }, { ...input(), id: crypto.randomUUID() }, { title: "Incomplete" }]) {
    assert.equal((await index.POST(req(invalid))).status, 400);
  }
  assert.equal((await index.POST(req("x".repeat(512001)))).status, 413);
  const createdResponse = await index.POST(req(input({ status: "published" })));
  assert.equal(createdResponse.status, 201);
  assert.equal(createdResponse.headers.get("cache-control"), "no-store");
  const created = (await createdResponse.json()).procedure;
  const context = { params: Promise.resolve({ sopId: created.id }) };
  const updated = await detail.PATCH(req(input({ expectedRevision: 1, status: "published", title: "Updated through API" }), {}, "PATCH"), context);
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).procedure.revision, 2);
  assert.equal((await detail.PATCH(req(input({ expectedRevision: 1 }), {}, "PATCH"), context)).status, 409);
  assert.equal((await detail.PATCH(req(input(), {}, "PATCH"), context)).status, 400);
  assert.equal((await index.GET()).status, 200);
  assert.equal((await (await detail.GET(new Request("https://members.example.com"), context)).json()).editor.history.length, 2);
  state.viewer = { authUserId: ids.guide };
  assert.equal((await index.POST(req(input()))).status, 403);
  assert.deepEqual((await (await detail.GET(new Request("https://members.example.com"), context)).json()).editor.history, []);
});
