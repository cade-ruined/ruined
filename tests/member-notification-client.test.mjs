import assert from "node:assert/strict";
import test from "node:test";
import { loader } from "./helpers/member-sms-fixture.mjs";

const { createMemberNotificationSession, canPresentMemberAnnouncement } = loader()("src/lib/membership/notification-inbox-client.ts");
const ownerId = "00000000-0000-4000-8000-000000000001";
const announcement = { id: "00000000-0000-4000-8000-000000000002", title: "The Library is live", body: "Foundations 01 is ready.", actionLabel: "Open Library", href: "/my/library", publishedAt: "2026-11-06T18:00:00.000Z" };
const snapshot = (overrides = {}) => ({ ownerId, unreadCount: 3, announcement, ...overrides });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("only landing pages present announcements, never forms, checkout or the recording", () => {
  for (const path of ["/my", "/my/library", "/my/circle", "/my/experiences"]) assert.equal(canPresentMemberAnnouncement(path), true);
  for (const path of ["/my/checkout", "/my/activate", "/my/registered", "/my/timeline/new", "/my/journal/new", "/my/practice", "/my/library/foundations-01", "/my/updates", "/my/badges", "/my/account"]) assert.equal(canPresentMemberAnnouncement(path), false);
});

test("requests are account-bound and an older refresh cannot overwrite the latest state", async () => {
  const first = deferred(), second = deferred(), calls = [], changes = [];
  const session = createMemberNotificationSession({ ownerId, onChange: value => changes.push(value), request: (url, options) => {
    calls.push({ url, options }); return calls.length === 1 ? first.promise : second.promise;
  } });
  const a = session.refresh(), b = session.refresh();
  second.resolve(json(snapshot({ unreadCount: 1 }))); await b;
  first.resolve(json(snapshot())); await a;
  assert.deepEqual(changes.map(value => value.unreadCount), [1]);
  assert.equal(calls[0].options.headers["x-ruined-session-owner"], ownerId);
  assert.equal(calls[0].options.cache, "no-store"); session.stop();
});

test("Not now clears the popup only after persistence and leaves the unread count", async () => {
  const saved = deferred(), changes = [], calls = [];
  const session = createMemberNotificationSession({ ownerId, onChange: value => changes.push(value), request: async (url, options) => {
    calls.push({ url, options }); return options.method === "POST" ? saved.promise : json(snapshot());
  } });
  await session.refresh();
  const pending = session.acknowledge(announcement.id, "dismiss");
  assert.equal(changes.at(-1).announcement.id, announcement.id);
  assert.equal(await session.acknowledge(announcement.id, "dismiss"), false);
  saved.resolve(json({ ok: true, ownerId })); assert.equal(await pending, true);
  assert.deepEqual(changes.at(-1), snapshot({ announcement: null }));
  assert.deepEqual(JSON.parse(calls[1].options.body), { ownerId, notificationId: announcement.id, action: "dismiss" });
  session.stop();
});

test("opening an announcement marks it read, failed saves keep it available", async () => {
  let fail = true; const changes = [];
  const session = createMemberNotificationSession({ ownerId, onChange: value => changes.push(value), request: async (_url, options) => options.method === "POST"
    ? fail ? json({ error: "Unavailable" }, 503) : json({ ok: true, ownerId }) : json(snapshot()) });
  await session.refresh();
  await assert.rejects(session.acknowledge(announcement.id, "open"), /couldn’t be saved/);
  assert.equal(changes.at(-1).announcement.id, announcement.id);
  fail = false; assert.equal(await session.acknowledge(announcement.id, "open"), true);
  assert.deepEqual(changes.at(-1), snapshot({ unreadCount: 2, announcement: null })); session.stop();
});

test("auth changes clear the old owner, but the same account can recover without reloading", async () => {
  for (const status of [401, 403, 409, 200]) {
    let calls = 0; const changes = [];
    const session = createMemberNotificationSession({ ownerId, onChange: value => changes.push(value), request: async () => {
      calls++; return calls === 2 ? json({ ...snapshot(), ownerId: "different-owner" }, status) : json(snapshot());
    } });
    await session.refresh(); await session.refresh();
    assert.equal(changes.at(-1), null); assert.equal(calls, 2);
    assert.equal(await session.acknowledge(announcement.id, "open"), false);
    await session.refresh(); assert.deepEqual(changes.at(-1), snapshot());
    session.stop(); await session.refresh(); assert.equal(calls, 3);
  }
});

test("stopping a session discards late responses and aborts its requests", async () => {
  const pending = deferred(), changes = []; let signal;
  const session = createMemberNotificationSession({ ownerId, onChange: value => changes.push(value), request: async (_url, options) => { signal = options.signal; return pending.promise; } });
  const read = session.refresh(); session.stop(); pending.resolve(json(snapshot())); await read;
  assert.equal(signal.aborted, true); assert.deepEqual(changes, []);
});

test("untrusted or malformed announcements do not become navigation targets", async () => {
  for (const bad of [snapshot({ unreadCount: -1 }), snapshot({ announcement: { ...announcement, href: "javascript:alert(1)" } }), snapshot({ announcement: { ...announcement, publishedAt: "invalid" } })]) {
    const changes = [];
    const session = createMemberNotificationSession({ ownerId, onChange: value => changes.push(value), request: async () => json(bad) });
    await session.refresh(); assert.deepEqual(changes, []); session.stop();
  }
});
