import assert from "node:assert/strict";
import test from "node:test";
import { loader, read, sqlFor } from "./helpers/member-sms-fixture.mjs";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const model = loader()("src/lib/membership/notification-inbox-model.ts");
const migrationName = "20261107010000_member_notification_announcements.sql";
const migration = read(`db/migrations/${migrationName}`);
const original = read("db/migrations/20260826_membership_operating_spine_05_content_operations.sql");
const dispatchSchema = read("db/migrations/20260828_operator_notification_hardening.sql");
const table = (source, name) => source.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0];

async function fixture(t, { migrate = true } = {}) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    set time zone 'UTC';
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key,status text default 'active');
    create table ruined_members(id uuid primary key,person_id uuid not null,deleted_at timestamptz,unique(id,person_id));
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,status text default 'active');
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text default 'active',billing_state text default 'active',
      administrative_onboarding_state text default 'completed',program_state text default 'onboarding',standing_state text default 'active',
      cancellation_effective_at timestamptz,released boolean default true,circle_revealed boolean default true,
      operator_funded boolean default false,complimentary_funded boolean default false,shared_billing_state text);
    create function private.ruined_member_profile_released(uuid) returns boolean language sql stable as 'select released from member_lifecycle where member_id=$1';
    create function private.ruined_member_circle_is_revealed(uuid) returns boolean language sql stable as 'select circle_revealed from member_lifecycle where member_id=$1';
    create function private.ruined_member_has_operator_funding(uuid) returns boolean language sql stable as 'select operator_funded from member_lifecycle where member_id=$1';
    create function private.ruined_member_has_complimentary_funding(uuid) returns boolean language sql stable as 'select complimentary_funded or operator_funded from member_lifecycle where member_id=$1';
    create function private.ruined_member_shared_billing_state(uuid) returns text language sql stable as 'select shared_billing_state from member_lifecycle where member_id=$1';
    create table member_announcements(id uuid primary key);
    create table member_announcement_targets(announcement_id uuid,target_type text);
    ${table(original, "member_notifications")}
    ${table(original, "member_notification_events")}
    ${table(dispatchSchema, "operator_notification_dispatches")}
    alter table member_notifications add column operator_dispatch_id uuid references operator_notification_dispatches(id);
    grant select on member_notifications to authenticated;
  `);
  for (const n of [1, 2]) {
    await db.query("insert into people(id) values($1)", [id(n + 200)]);
    await db.query("insert into ruined_members(id,person_id) values($1,$2)", [id(n + 100), id(n + 200)]);
    await db.query("insert into platform_users(auth_user_id,member_id,person_id) values($1,$2,$3)", [id(n), id(n + 100), id(n + 200)]);
    await db.query("insert into platform_role_grants values($1,'member',null)", [id(n)]);
    await db.query("insert into member_lifecycle(member_id) values($1)", [id(n + 100)]);
  }
  let next = 1000;
  const insert = async ({ owner = 1, featured = false, status = "delivered", channel = "in_app", readAt = null,
    dismissedAt = null, scheduledFor = "2026-01-01", createdAt = "2026-01-02", href = "/my/library", type = "announcement" } = {}) => {
    const key = id(next++);
    await db.query(`insert into member_notifications(id,person_id,member_id,notification_type,channel,title_snapshot,body_snapshot,
      action_label_snapshot,action_url_snapshot,status,read_at,dismissed_at,scheduled_for,created_at,dedupe_key)
      values($1::uuid,$2,$3,$4,$5,'The Library is live','Watch Foundations 01',$6,$7,$8,$9,$10,$11,$12,$1::uuid::text)`,
    [key, id(owner + 200), id(owner + 100), type, channel, href ? "Open Library" : null, href, status, readAt, dismissedAt, scheduledFor, createdAt]);
    if (featured) await db.query("update member_notifications set show_on_next_visit=true where id=$1", [key]);
    return key;
  };
  if (migrate) await db.exec(migration);
  const loadRepo = () => loader({}, { "@/lib/database/server": { getApplicationDatabase: () => sqlFor(db) } })("src/lib/membership/notification-inbox-repository.ts");
  return { db, insert, loadRepo, ...loadRepo() };
}

test("announcement migration leaves old notices ordinary and adds no member write privileges", async t => {
  const f = await fixture(t, { migrate: false }); const key = await f.insert();
  const before = (await f.db.query("select * from member_notifications where id=$1", [key])).rows[0];
  await f.db.exec(migration);
  const after = (await f.db.query("select * from member_notifications where id=$1", [key])).rows[0];
  assert.deepEqual(after, { ...before, show_on_next_visit: false, announcement_dismissed_at: null });
  assert.equal((await f.getMemberNotificationState(id(1))).announcement, null);
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await f.db.query("select has_column_privilege($1,'member_notifications','show_on_next_visit','UPDATE') as allowed", [role])).rows[0].allowed, false);
  }
  const defaults = (await f.db.query("select column_default,is_nullable from information_schema.columns where table_name='operator_notification_dispatches' and column_name='show_on_next_visit'")).rows[0];
  assert.equal(defaults.column_default, "false"); assert.equal(defaults.is_nullable, "NO");
  assert.ok(read("scripts/migrate-platform.mjs").includes(migrationName));
});

test("state counts only current delivered visible unread notices and picks the newest pending announcement", async t => {
  const f = await fixture(t);
  await f.insert(); const first = await f.insert({ featured: true });
  const newest = await f.insert({ featured: true, createdAt: "2026-02-01" });
  await f.insert({ featured: true, owner: 2, createdAt: "2026-03-01" });
  await f.insert({ featured: true, readAt: "2026-01-03" });
  await f.insert({ featured: true, status: "failed" }); await f.insert({ featured: true, status: "queued" });
  await f.insert({ featured: true, status: "cancelled" }); await f.insert({ featured: true, channel: "email" });
  await f.insert({ featured: true, scheduledFor: "2099-01-01" });
  await f.insert({ featured: true, dismissedAt: "2026-01-03" });
  const snapshot = await f.getMemberNotificationState(id(1));
  assert.equal(snapshot.ownerId, id(1)); assert.equal(snapshot.unreadCount, 3);
  assert.deepEqual(snapshot.announcement, { id: newest, title: "The Library is live", body: "Watch Foundations 01",
    actionLabel: "Open Library", href: "/my/library", publishedAt: "2026-02-01T00:00:00.000Z" });
  assert.notEqual(first, newest);
  assert.equal((await f.db.query("select count(*)::int as count from member_notification_events")).rows[0].count, 0, "GET must not acknowledge notices");
});

test("Not now persists across devices without marking read; Open records one read and repeated actions are idempotent", async t => {
  const f = await fixture(t); const key = await f.insert({ featured: true });
  await f.acknowledgeMemberAnnouncement(id(1), key, "dismiss");
  const dismissed = (await f.db.query("select * from member_notifications where id=$1", [key])).rows[0];
  assert.ok(dismissed.announcement_dismissed_at); assert.equal(dismissed.read_at, null); assert.equal(dismissed.dismissed_at, null);
  assert.deepEqual(await f.loadRepo().getMemberNotificationState(id(1)), { ownerId: id(1), unreadCount: 1, announcement: null });
  await f.acknowledgeMemberAnnouncement(id(1), key, "dismiss");
  assert.deepEqual((await f.db.query("select * from member_notifications where id=$1", [key])).rows[0], dismissed);
  await f.acknowledgeMemberAnnouncement(id(1), key, "open");
  const opened = (await f.db.query("select * from member_notifications where id=$1", [key])).rows[0];
  assert.ok(opened.read_at); assert.equal(opened.announcement_dismissed_at.getTime(), dismissed.announcement_dismissed_at.getTime());
  await Promise.all([f.acknowledgeMemberAnnouncement(id(1), key, "open"), f.acknowledgeMemberAnnouncement(id(1), key, "dismiss")]);
  assert.deepEqual((await f.db.query("select * from member_notifications where id=$1", [key])).rows[0], opened);
  assert.equal((await f.getMemberNotificationState(id(1))).unreadCount, 0);
  assert.deepEqual((await f.db.query("select event_type,dedupe_key from member_notification_events order by id")).rows,
    [{ event_type: "dismissed", dedupe_key: `notification-announcement-dismissed:${key}` }, { event_type: "read", dedupe_key: `notification-read:${key}` }]);
});

test("foreign, ordinary, unavailable and Circle-hidden notices cannot be acknowledged", async t => {
  const f = await fixture(t), foreign = await f.insert({ owner: 2, featured: true }), ordinary = await f.insert(), future = await f.insert({ featured: true, scheduledFor: "2099-01-01" });
  const circle = await f.insert({ featured: true, type: "circle" });
  await f.db.query("update member_lifecycle set circle_revealed=false where member_id=$1", [id(101)]);
  for (const key of [foreign, ordinary, future, circle, id(999)]) await assert.rejects(() => f.acknowledgeMemberAnnouncement(id(1), key, "open"), error => error.status === 404);
  assert.equal((await f.getMemberNotificationState(id(1))).unreadCount, 1);
  assert.equal((await f.db.query("select count(*)::int as count from member_notification_events")).rows[0].count, 0);
  await f.db.query("update member_lifecycle set circle_revealed=true where member_id=$1", [id(101)]);
  assert.equal((await f.getMemberNotificationState(id(1))).announcement.id, circle);
});

test("Circle and block audiences stay hidden even when the notice itself is a general announcement", async t => {
  const f = await fixture(t), hidden = [];
  for (const [index, target] of ["circle", "block"].entries()) {
    const dispatchId = id(3000 + index), direct = await f.insert({ featured: true });
    await f.db.query(`insert into operator_notification_dispatches(id,request_key,request_fingerprint,actor_auth_user_id,
      notification_type,target_type,target_id,title_snapshot,body_snapshot)
      values($1,$2,$3,$4,'announcement',$5,$6,'Private Circle','Details')`,
    [dispatchId, `fixture-dispatch-${index}`, "a".repeat(64), id(1), target, id(4000 + index)]);
    await f.db.query("update member_notifications set operator_dispatch_id=$1 where id=$2", [dispatchId, direct]);
    const announcementId = id(5000 + index), published = await f.insert({ featured: true });
    await f.db.query("insert into member_announcements values($1)", [announcementId]);
    await f.db.query("insert into member_announcement_targets values($1,$2)", [announcementId, target]);
    await f.db.query("update member_notifications set announcement_id=$1 where id=$2", [announcementId, published]);
    hidden.push(direct, published);
  }
  await f.db.query("update member_lifecycle set circle_revealed=false where member_id=$1", [id(101)]);
  assert.deepEqual(await f.getMemberNotificationState(id(1)), { ownerId: id(1), unreadCount: 0, announcement: null });
  for (const key of hidden) await assert.rejects(() => f.acknowledgeMemberAnnouncement(id(1), key, "open"), error => error.status === 404);
  await f.db.query("update member_lifecycle set circle_revealed=true where member_id=$1", [id(101)]);
  assert.equal((await f.getMemberNotificationState(id(1))).unreadCount, 4);
  await f.acknowledgeMemberAnnouncement(id(1), hidden[0], "open");
  assert.equal((await f.getMemberNotificationState(id(1))).unreadCount, 3);
});

test("current owner identity, profile release, funding and lifecycle are rechecked before reads or changes", async t => {
  const f = await fixture(t), key = await f.insert({ featured: true });
  for (const [change, restore] of [
    ["update platform_users set status='suspended'", "update platform_users set status='active'"],
    ["update people set status='inactive'", "update people set status='active'"],
    ["update ruined_members set deleted_at=now()", "update ruined_members set deleted_at=null"],
    ["update platform_role_grants set revoked_at=now()", "update platform_role_grants set revoked_at=null"],
    ["update member_lifecycle set released=false", "update member_lifecycle set released=true"],
    ["update member_lifecycle set account_state='closed'", "update member_lifecycle set account_state='active'"],
    ["update member_lifecycle set billing_state='pending'", "update member_lifecycle set billing_state='active'"],
    ["update member_lifecycle set administrative_onboarding_state='in_progress'", "update member_lifecycle set administrative_onboarding_state='completed'"],
    ["update member_lifecycle set standing_state='paused'", "update member_lifecycle set standing_state='active'"],
    ["update member_lifecycle set standing_state='cancellation_requested',cancellation_effective_at=now()-interval '1 day'", "update member_lifecycle set standing_state='active',cancellation_effective_at=null"],
  ]) {
    await f.db.exec(change);
    await assert.rejects(() => f.getMemberNotificationState(id(1)), error => error.status === 403);
    await assert.rejects(() => f.acknowledgeMemberAnnouncement(id(1), key, "dismiss"), error => error.status === 403);
    await f.db.exec(restore);
  }
  await f.db.query("update platform_users set member_id=$1 where auth_user_id=$2", [id(102), id(1)]);
  await assert.rejects(() => f.getMemberNotificationState(id(1)), error => error.status === 403);
  await f.db.query("update platform_users set member_id=null where auth_user_id=$1", [id(1)]);
  await f.db.exec("update member_lifecycle set billing_state='pending',operator_funded=true");
  assert.equal((await f.getMemberNotificationState(id(1))).unreadCount, 1, "operator funding remains eligible");
  await f.db.exec("update member_lifecycle set operator_funded=false,complimentary_funded=true");
  assert.equal((await f.getMemberNotificationState(id(1))).unreadCount, 1, "complimentary funding remains eligible");
  await f.db.exec("update member_lifecycle set complimentary_funded=false,shared_billing_state='active'");
  assert.equal((await f.getMemberNotificationState(id(1))).unreadCount, 1, "shared paid funding remains eligible");
  assert.equal((await f.db.query("select count(*)::int as count from member_notification_events")).rows[0].count, 0);
});

test("notification navigation normalizes safe destinations and drops unsafe legacy snapshots", async t => {
  for (const href of ["/my/library", "/my/library/foundations-01?from=notice#watch", "https://meet.google.com/abc-defg-hij"]) assert.ok(model.safeMemberNotificationHref(href));
  for (const href of [null, undefined, "", "javascript:alert(1)", "data:text/html,x", "//evil.test", "/my-other", "/my/../ops", "/my/%2e%2e/ops", "/my\\evil", "https://user:pass@example.com", " https://example.com", "/my/%0aevil"]) assert.equal(model.safeMemberNotificationHref(href), null);
  const f = await fixture(t); await f.insert({ featured: true, href: "javascript:alert(1)" });
  assert.equal((await f.getMemberNotificationState(id(1))).announcement.href, null);
});

function apiFixture() {
  const calls = { reads: [], writes: [], sessions: 0 };
  let state = "authenticated", mode = "connected";
  const load = loader({}, {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: request => request.headers.get("origin") === "https://members.theruinedproject.com" },
    "@/lib/auth/session": { resolvePlatformSession: async (_client, options) => { calls.sessions++; assert.equal(options.verifyCurrentUser, true); return state === "authenticated" ? { status: state, viewer: { authUserId: id(1) } } : { status: state }; } },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({}) },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
    "./notification-inbox-repository": {
      getMemberNotificationState: async ownerId => { calls.reads.push(ownerId); return { ownerId, unreadCount: 1, announcement: null }; },
      acknowledgeMemberAnnouncement: async (...args) => { calls.writes.push(args); },
    },
  });
  const get = load("app/api/my/updates/notification-state/route.ts").GET;
  const post = load("app/api/my/updates/announcement/route.ts").POST;
  const request = (body, headers = {}) => new Request("https://members.theruinedproject.com/api/my/updates/announcement", { method: "POST", headers: { origin: "https://members.theruinedproject.com", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { calls, get, post, request, setState: value => { state = value; }, setMode: value => { mode = value; } };
}

test("notification state API requires the current owner header and verifies live Auth with private responses", async () => {
  const f = apiFixture();
  const req = owner => new Request("https://members.theruinedproject.com/api/my/updates/notification-state", { headers: owner ? { "x-ruined-session-owner": owner } : {} });
  for (const owner of [undefined, id(2)]) assert.equal((await f.get(req(owner))).status, 409);
  for (const [state, status] of [["signed_out", 401], ["unavailable", 503]]) { f.setState(state); assert.equal((await f.get(req(id(1)))).status, status); }
  f.setState("authenticated"); assert.deepEqual(f.calls.reads, []);
  const response = await f.get(req(id(1))); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal((await response.json()).ownerId, id(1)); assert.deepEqual(f.calls.reads, [id(1)]); assert.deepEqual(f.calls.writes, []);
});

test("announcement API rejects untrusted origins, account changes and malformed bodies before mutations", async () => {
  const f = apiFixture(), body = { ownerId: id(1), notificationId: id(1000), action: "dismiss" };
  assert.equal((await f.post(f.request(body, { origin: "https://untrusted.test" }))).status, 403); assert.equal(f.calls.sessions, 0);
  assert.equal((await f.post(f.request({ ...body, ownerId: id(2) }))).status, 409);
  assert.equal((await f.post(f.request(body, { "x-ruined-session-owner": id(2) }))).status, 409);
  assert.equal((await f.post(f.request(body, { "content-type": "text/plain" }))).status, 415);
  for (const input of ["{bad", null, [], { ...body, extra: true }, { ...body, action: "delete" }, { ...body, notificationId: "no" }]) assert.equal((await f.post(f.request(input))).status, 400);
  assert.equal((await f.post(f.request(" ".repeat(600)))).status, 413);
  assert.deepEqual(f.calls.writes, []);
  const response = await f.post(f.request(body)); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, ownerId: id(1) });
  assert.deepEqual(f.calls.writes, [[id(1), id(1000), "dismiss"]]);
});
