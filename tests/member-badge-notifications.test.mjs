import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migrationName = "20260930112000_member_badge_acknowledgements.sql";
const migration = await read(`db/migrations/${migrationName}`);
const original = await read("db/migrations/20260929000000_member_badges.sql");
const compiled = new Map();
async function load(path, dependencies = {}) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(await read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled.get(path))(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const earnedAt = "2026-09-28T22:54:30.849Z";
async function badgeModel() {
  return load("src/lib/membership/badge-model.ts", { "./member-number": await load("src/lib/membership/member-number.ts") });
}
function wrap(engine) {
  const sql = async (strings, ...values) => (await engine.query(
    strings.reduce((query, part, index) => query + (index ? `$${index}` : "") + part, ""), values,
  )).rows;
  sql.begin = work => engine.transaction(tx => work(wrap(tx)));
  return sql;
}
async function fixture(t, { migrate = true } = {}) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key, status text default 'active');
    create table ruined_members(id uuid primary key, person_id uuid, member_number integer, deleted_at timestamptz);
    create table platform_users(auth_user_id uuid primary key, member_id uuid, person_id uuid, status text default 'active');
    create table platform_role_grants(auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key, account_state text default 'active', billing_state text default 'pending');
    create table private.member_number_assignments(member_id uuid primary key, member_number integer);
    ${original.match(/create table if not exists public\.member_badge_awards \([\s\S]*?\n\);/)[0]}
    alter table member_badge_awards enable row level security;
    revoke all on member_badge_awards from public, anon, authenticated;
  `);
  for (const n of [1, 2]) {
    await db.query("insert into people(id) values($1)", [id(n + 200)]);
    await db.query("insert into ruined_members values($1,$2,$3,null)", [id(n + 100), id(n + 200), n]);
    await db.query("insert into platform_users(auth_user_id,member_id,person_id) values($1,$2,$3)", [id(n), id(n + 100), id(n + 200)]);
    await db.query("insert into platform_role_grants values($1,'member',null)", [id(n)]);
    await db.query("insert into member_lifecycle(member_id) values($1)", [id(n + 100)]);
    await db.query("insert into private.member_number_assignments values($1,$2)", [id(n + 100), n]);
  }
  if (migrate) await db.exec(migration);
  const model = await badgeModel();
  const repository = () => load("src/lib/membership/badge-notification-repository.ts", {
    "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => wrap(db) }, "./badge-model": model,
  });
  const award = (n, key = "early-supporter", date = earnedAt, event = "membership-activation:1", version = 2) => db.query(
    "insert into member_badge_awards(member_id,badge_key,earned_at,source_event_id,rule_version) values($1,$2,$3,$4,$5)",
    [id(n + 100), key, date, event, version],
  );
  return { db, model, repository, award, ...await repository() };
}

test("additive acknowledgement migration preserves existing awards and timestamps with no client privileges", async t => {
  const f = await fixture(t, { migrate: false }); await f.award(1);
  const before = (await f.db.query("select * from member_badge_awards")).rows;
  await f.db.exec(migration);
  const after = (await f.db.query("select * from member_badge_awards")).rows;
  assert.equal(after[0].acknowledged_at, null);
  assert.deepEqual(after.map(award => { const originalAward = { ...award }; delete originalAward.acknowledged_at; return originalAward; }), before);
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await f.db.query("select has_table_privilege($1,'member_badge_awards','SELECT,INSERT,UPDATE,DELETE') as allowed", [role])).rows[0].allowed, false);
  }
  assert.match(await read("scripts/migrate-platform.mjs"), new RegExp(migrationName.replaceAll(".", "\\.")));
});

test("owned earned badges persist across devices and acknowledge once without paid funding or changing history", async t => {
  const f = await fixture(t); await f.award(1); await f.award(2);
  const expected = [f.model.memberBadge("early-supporter", earnedAt)];
  assert.deepEqual(await f.getUnacknowledgedMemberBadges(id(1)), expected);
  const before = (await f.db.query("select * from member_badge_awards where member_id=$1", [id(101)])).rows[0];
  await Promise.all([f.acknowledgeMemberBadge(id(1), "early-supporter"), f.acknowledgeMemberBadge(id(1), "early-supporter")]);
  const first = (await f.db.query("select * from member_badge_awards where member_id=$1", [id(101)])).rows[0];
  assert.ok(first.acknowledged_at);
  const anotherDevice = await f.repository();
  assert.deepEqual(await anotherDevice.getUnacknowledgedMemberBadges(id(1)), []);
  await anotherDevice.acknowledgeMemberBadge(id(1), "early-supporter");
  assert.deepEqual((await f.db.query("select * from member_badge_awards where member_id=$1", [id(101)])).rows[0], first);
  assert.deepEqual({ ...first, acknowledged_at: null }, before);
  assert.deepEqual(await anotherDevice.getUnacknowledgedMemberBadges(id(2)), expected);
  await f.db.query("update member_lifecycle set billing_state='ended' where member_id=$1", [id(102)]);
  assert.deepEqual(await f.getUnacknowledgedMemberBadges(id(2)), expected);
  await f.acknowledgeMemberBadge(id(2), "early-supporter");
});

test("new awards remain unseen and chronological while unknown catalog entries and cohort-hidden awards are excluded", async t => {
  const f = await fixture(t); await f.award(1); await f.acknowledgeMemberBadge(id(1), "early-supporter");
  // Extend only this isolated test catalog to exercise future multi-award ordering.
  for (const key of ["later-badge", "earlier-badge", "same-time-badge"]) f.model.MEMBERSHIP_BADGES[key] = { label: key, description: "A future earned badge." };
  await f.award(1, "later-badge", "2026-09-29T12:00:00Z");
  await f.award(1, "same-time-badge", "2026-09-28T12:00:00Z");
  await f.award(1, "earlier-badge", "2026-09-28T12:00:00Z");
  await f.award(1, "unknown-badge", "2026-09-27T12:00:00Z");
  assert.deepEqual((await f.getUnacknowledgedMemberBadges(id(1))).map(badge => badge.key), ["earlier-badge", "same-time-badge", "later-badge"]);
  await f.acknowledgeMemberBadge(id(1), "same-time-badge");
  assert.deepEqual((await f.getUnacknowledgedMemberBadges(id(1))).map(badge => badge.key), ["earlier-badge", "later-badge"]);
  await f.award(2);
  await f.db.query("update private.member_number_assignments set member_number=51 where member_id=$1", [id(102)]);
  await f.db.query("update ruined_members set member_number=51 where id=$1", [id(102)]);
  assert.deepEqual(await f.getUnacknowledgedMemberBadges(id(2)), []);
  await assert.rejects(() => f.acknowledgeMemberBadge(id(2), "early-supporter"), error => error.status === 404);
  assert.equal((await f.db.query("select acknowledged_at from member_badge_awards where member_id=$1", [id(102)])).rows[0].acknowledged_at, null);
});

test("foreign or nonexistent awards cannot be acknowledged or manufactured", async t => {
  const f = await fixture(t); await f.award(2);
  await assert.rejects(() => f.acknowledgeMemberBadge(id(1), "early-supporter"), error => error.status === 404);
  await assert.rejects(() => f.acknowledgeMemberBadge(id(1), "invented-badge"), error => error.status === 400);
  assert.deepEqual(await f.getUnacknowledgedMemberBadges(id(1)), []);
  assert.equal((await f.db.query("select count(*) as count from member_badge_awards")).rows[0].count, 1);
  assert.equal((await f.db.query("select acknowledged_at from member_badge_awards")).rows[0].acknowledged_at, null);
});

test("person-linked operator members can read and acknowledge without a legacy account.member_id", async t => {
  const f = await fixture(t); await f.award(1);
  await f.db.query("update platform_users set member_id=null where auth_user_id=$1", [id(1)]);
  await f.db.query("insert into platform_role_grants values($1,'ops_admin',null)", [id(1)]);
  assert.deepEqual(await f.getUnacknowledgedMemberBadges(id(1)), [f.model.memberBadge("early-supporter", earnedAt)]);
  await f.acknowledgeMemberBadge(id(1), "early-supporter");
  assert.deepEqual(await f.getUnacknowledgedMemberBadges(id(1)), []);
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='member'", [id(1)]);
  await assert.rejects(() => f.getUnacknowledgedMemberBadges(id(1)), error => error.status === 403);
});

test("deleted, suspended, mismatched and revoked owners are rejected before acknowledging any award", async t => {
  const f = await fixture(t); await f.award(1);
  const mutations = [
    ["update ruined_members set deleted_at=now() where id=$1", [id(101)]],
    ["update platform_users set status='suspended' where auth_user_id=$1", [id(1)]],
    ["update people set status='inactive' where id=$1", [id(201)]],
    ["update member_lifecycle set account_state='suspended' where member_id=$1", [id(101)]],
    ["update member_lifecycle set account_state='closed' where member_id=$1", [id(101)]],
    ["update platform_role_grants set revoked_at=now() where auth_user_id=$1", [id(1)]],
    ["update platform_users set member_id=$1 where auth_user_id=$2", [id(102), id(1)]],
    ["update platform_users set person_id=$1 where auth_user_id=$2", [id(202), id(1)]],
  ];
  for (const [query, values] of mutations) {
    await f.db.query(query, values);
    await assert.rejects(() => f.getUnacknowledgedMemberBadges(id(1)), error => error.status === 403);
    await assert.rejects(() => f.acknowledgeMemberBadge(id(1), "early-supporter"), error => error.status === 403);
    assert.equal((await f.db.query("select acknowledged_at from member_badge_awards")).rows[0].acknowledged_at, null);
    await f.db.query("update ruined_members set deleted_at=null where id=$1", [id(101)]);
    await f.db.query("update platform_users set status='active',member_id=$1,person_id=$2 where auth_user_id=$3", [id(101), id(201), id(1)]);
    await f.db.query("update people set status='active' where id=$1", [id(201)]);
    await f.db.query("update member_lifecycle set account_state='active' where member_id=$1", [id(101)]);
    await f.db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1", [id(1)]);
  }
  await f.db.query("delete from platform_users where auth_user_id=$1", [id(1)]);
  await assert.rejects(() => f.getUnacknowledgedMemberBadges(id(1)), error => error.status === 403);
  await assert.rejects(() => f.acknowledgeMemberBadge(id(1), "early-supporter"), error => error.status === 403);
});

test("only the exact acknowledgement-column rollout gap is soft for reads; all writes and other failures stay closed", async t => {
  const f = await fixture(t, { migrate: false }); await f.award(1);
  assert.deepEqual(await f.getUnacknowledgedMemberBadges(id(1)), []);
  await assert.rejects(() => f.acknowledgeMemberBadge(id(1), "early-supporter"), error => error.code === "42703");
  await f.db.exec(migration);
  await f.db.exec("alter table member_badge_awards rename column earned_at to missing_earned_at");
  await assert.rejects(() => f.getUnacknowledgedMemberBadges(id(1)), error => error.code === "42703");
  await f.db.exec("alter table member_badge_awards rename column missing_earned_at to earned_at; drop table member_badge_awards");
  await assert.rejects(() => f.getUnacknowledgedMemberBadges(id(1)), error => error.code === "42P01");
});

test("historical profile grants explain their actual reason without exposing source or changing normal catalog descriptions", async t => {
  const f = await fixture(t); await f.award(1, "early-supporter", earnedAt, "existing-profile-grant:2026-09-28", 3);
  await f.award(2, "early-supporter", earnedAt, "existing-profile-grant:2026-09-28", 2);
  const [badge] = await f.getUnacknowledgedMemberBadges(id(1));
  assert.deepEqual(Object.keys(badge).sort(), ["description", "earnedAt", "key", "label"]);
  assert.equal(badge.description, "Had a Ruined profile before launch.");
  assert.equal(badge.earnedAt, earnedAt);
  assert.equal((await f.getUnacknowledgedMemberBadges(id(2)))[0].description, f.model.MEMBERSHIP_BADGES["early-supporter"].description);
});

const apiRequest = (body, options = {}) => new Request("https://members.example.test/api/my/badges", {
  method: options.method ?? "POST", headers: { origin: "https://members.example.test", "content-type": "application/json", ...options.headers },
  ...(options.method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
});
async function apiFixture({ trusted = true, auth = "active", mode = "connected", owner = id(1) } = {}) {
  const calls = [], model = await badgeModel();
  const repository = await load("src/lib/membership/badge-notification-repository.ts", { "server-only": {}, "@/lib/database/server": {}, "./badge-model": model });
  const sessions = await load("src/lib/auth/session.ts", {
    "server-only": {}, "@/lib/supabase/server": {},
    "@/lib/auth/session-errors": await load("src/lib/auth/session-errors.ts"),
  });
  let failure = null;
  const api = await load("app/api/my/badges/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => trusted },
    "@/lib/auth/session": sessions,
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ auth: {
      getClaims: async () => ({ data: auth === "signed_out" ? null : { claims: { sub: owner, email: "member@example.test" } } }),
      getUser: async () => { calls.push("verify-current-user"); return auth === "deleted" || auth === "banned"
        ? { data: { user: null }, error: { code: auth === "banned" ? "user_banned" : "user_not_found" } } : auth === "unavailable" ? { error: { status: 503, message: "Unavailable" } }
          : { data: { user: { id: owner, email: "member@example.test" } } }; },
    } }) },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
    "@/lib/membership/badge-notification-repository": {
      BadgeNotificationError: repository.BadgeNotificationError,
      getUnacknowledgedMemberBadges: async authUserId => { calls.push(["get", authUserId]); if (failure) throw failure; return [model.memberBadge("early-supporter", earnedAt)]; },
      acknowledgeMemberBadge: async (...args) => { calls.push(["acknowledge", ...args]); if (failure) throw failure; },
    },
  });
  return { api, calls, repository, setFailure: error => { failure = error; } };
}

test("badge API binds GET to the current owner and rejects stale account-switch acknowledgement", async () => {
  const f = await apiFixture({ owner: id(2) });
  const response = await f.api.GET(apiRequest(undefined, { method: "GET" }));
  assert.equal(response.status, 200); assert.equal((await response.json()).ownerId, id(2));
  assert.match(response.headers.get("cache-control"), /private, no-store/); assert.equal(response.headers.get("vary"), "Cookie");
  assert.deepEqual(f.calls, ["verify-current-user", ["get", id(2)]]);
  f.calls.length = 0;
  const stale = await f.api.POST(apiRequest({ badgeKey: "early-supporter", ownerId: id(1) }));
  assert.equal(stale.status, 409); assert.equal((await stale.json()).code, "account_changed");
  assert.deepEqual(f.calls, ["verify-current-user"]);
  f.calls.length = 0;
  const acknowledged = await f.api.POST(apiRequest({ badgeKey: "early-supporter", ownerId: id(2) }));
  assert.deepEqual(await acknowledged.json(), { ok: true });
  assert.deepEqual(f.calls, ["verify-current-user", ["acknowledge", id(2), "early-supporter"]]);
});

test("badge API rejects missing/deleted/banned authentication, preview mode and CSRF without repository calls", async () => {
  for (const auth of ["signed_out", "deleted", "banned", "unavailable"]) {
    const f = await apiFixture({ auth });
    for (const method of ["GET", "POST"]) assert.equal((await f.api[method](apiRequest({ badgeKey: "early-supporter", ownerId: id(1) }, { method }))).status, auth === "unavailable" ? 503 : 401);
    assert.equal(f.calls.some(Array.isArray), false);
  }
  const preview = await apiFixture({ mode: "preview" });
  assert.equal((await preview.api.GET(apiRequest(undefined, { method: "GET" }))).status, 503); assert.deepEqual(preview.calls, []);
  const csrf = await apiFixture({ trusted: false });
  assert.equal((await csrf.api.POST(apiRequest({ badgeKey: "early-supporter", ownerId: id(1) }))).status, 403); assert.deepEqual(csrf.calls, []);
});

test("badge acknowledgement accepts one bounded choice, rejects forged member IDs and preserves backend failures", async () => {
  const f = await apiFixture();
  const valid = { badgeKey: "early-supporter", ownerId: id(1) };
  for (const body of [null, [], {}, { badgeKey: "early-supporter" }, { ...valid, memberId: id(102) }, { ...valid, all: true },
    { ...valid, badgeKey: ["early-supporter"] }, { ...valid, badgeKey: "a".repeat(65) }, { ...valid, ownerId: "member" }, "invalid json"]) {
    assert.equal((await f.api.POST(apiRequest(body))).status, 400);
  }
  assert.equal((await f.api.POST(apiRequest(valid, { headers: { "content-type": "text/plain" } }))).status, 415);
  assert.equal((await f.api.POST(apiRequest(valid, { headers: { "content-length": "513" } }))).status, 413);
  assert.equal((await f.api.POST(apiRequest(" ".repeat(513)))).status, 413);
  assert.equal(f.calls.some(Array.isArray), false);
  f.setFailure(new f.repository.BadgeNotificationError(403, "Unavailable"));
  assert.equal((await f.api.GET(apiRequest(undefined, { method: "GET" }))).status, 403);
  assert.equal((await f.api.POST(apiRequest(valid))).status, 403);
});
