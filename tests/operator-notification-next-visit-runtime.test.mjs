import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, dependencies = {}) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", source)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith("node:")) return require(name);
    if (name === "server-only") return {};
    throw Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const model = load("src/lib/platform/ops-notification-model.ts");
const hrefs = load("src/lib/membership/notification-inbox-model.ts");
class OpsOperatingRepositoryError extends Error { constructor(code, message) { super(message); this.code = code; } }
const ids = { actor: "1e28c575-7a87-43ef-9c53-6f9a545f42eb", member: "8929ed2f-5d7b-4e7b-8ed0-1eae1b71e20c", person: "a1200c51-dd71-4e35-b815-0a6656d73c6a" };
const base = { actionLabel: "Watch Foundations 01", actionUrl: "/my/library/foundations-01", actorAuthUserId: ids.actor, body: "The first recording is ready.", notificationType: "announcement", requestKey: "library-announcement-request", targetId: ids.member, targetType: "member", title: "The Library is live." };
function fixture() {
  const dispatches = new Map(), notifications = [], queries = [];
  let databaseAccesses = 0;
  function inserted(sql, values) {
    const columns = sql.match(/insert into \w+\s*\(([^)]+)\)/)[1].split(",").map(value => value.trim());
    const expressions = sql.slice(sql.indexOf(" values (") + 9).split(",");
    return Object.fromEntries(columns.map((column, i) => [column, values[Number(expressions[i].match(/\$(\d+)/)?.[1]) - 1]]));
  }
  const tx = async (strings, ...values) => {
    const sql = strings.reduce((text, string, i) => text + (i ? `$${i}` : "") + string, "").replace(/\s+/g, " ").trim();
    queries.push({ sql, values });
    if (sql.includes("select platform_user.auth_user_id")) return [{ auth_user_id: ids.actor }];
    if (sql.startsWith("insert into operator_notification_dispatches")) {
      const row = inserted(sql, values);
      if (dispatches.has(row.request_key)) return [];
      const dispatch = { ...row, recipient_count: 0, status: "processing" };
      dispatches.set(row.request_key, dispatch);
      return [dispatch];
    }
    if (sql.startsWith("select id, recipient_count")) return [dispatches.get(values[0])].filter(Boolean);
    if (sql.startsWith("select distinct member.id")) return [{ member_id: ids.member, person_id: ids.person }];
    if (sql.startsWith("insert into member_notifications")) { notifications.push(inserted(sql, values)); return []; }
    if (sql.startsWith("update operator_notification_dispatches")) {
      const row = [...dispatches.values()].find(row => row.id === values[1]);
      row.status = "completed"; row.recipient_count = values[0]; return [{ id: row.id }];
    }
    if (sql.startsWith("insert into member_notification_events") || sql.startsWith("insert into operator_audit_events")) return [];
    throw Error(`Unexpected SQL ${sql}`);
  };
  tx.json = value => value;
  const repository = load("src/lib/platform/ops-notification-repository.ts", {
    "@/lib/database/server": { getApplicationDatabase() { databaseAccesses++; return { begin: callback => callback(tx) }; } },
    "@/lib/platform/ops-notification-model": model,
    "@/lib/membership/notification-inbox-model": hrefs,
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError },
  });
  return { ...repository, dispatches, notifications, queries, databaseAccesses: () => databaseAccesses };
}

test("next-visit mode is optional and accepts booleans only", async () => {
  assert.equal(model.normalizeOpsNotificationShowOnNextVisit(undefined), false);
  assert.equal(model.normalizeOpsNotificationShowOnNextVisit(false), false);
  assert.equal(model.normalizeOpsNotificationShowOnNextVisit(true), true);
  const f = fixture();
  for (const value of [null, "true", "false", 0, 1, [], {}]) {
    assert.equal(model.normalizeOpsNotificationShowOnNextVisit(value), null);
    await assert.rejects(f.sendOpsNotification({ ...base, showOnNextVisit: value }), error => error.code === "invalid_request");
  }
  assert.equal(f.databaseAccesses(), 0);
});

test("ordinary notification requests retain their legacy fingerprint and can safely replay", async () => {
  const f = fixture();
  const result = await f.sendOpsNotification(base);
  const expected = createHash("sha256").update(JSON.stringify({ actionLabel: base.actionLabel, actionUrl: base.actionUrl, actorAuthUserId: base.actorAuthUserId, body: base.body, notificationType: base.notificationType, targetId: base.targetId, targetType: base.targetType, title: base.title }), "utf8").digest("hex");
  assert.equal(f.dispatches.get(base.requestKey).request_fingerprint, expected);
  assert.equal(f.dispatches.get(base.requestKey).show_on_next_visit, false);
  assert.equal(f.notifications[0].show_on_next_visit, false);
  const replay = await f.sendOpsNotification({ ...base, showOnNextVisit: false });
  assert.deepEqual(replay, { ...result, replayed: true });
  assert.equal(f.notifications.length, 1);
});

test("popup mode is persisted for each recipient and conflicts with a different mode under the same key", async () => {
  const f = fixture();
  const sent = await f.sendOpsNotification({ ...base, showOnNextVisit: true });
  assert.equal(f.dispatches.get(base.requestKey).show_on_next_visit, true);
  assert.equal(f.notifications[0].show_on_next_visit, true);
  assert.equal(f.notifications[0].action_label_snapshot, "Watch Foundations 01");
  assert.equal(sent.recipientCount, 1);
  await assert.rejects(f.sendOpsNotification({ ...base, showOnNextVisit: false }), error => error.code === "conflict");
  assert.equal(f.notifications.length, 1);
  const replay = await f.sendOpsNotification({ ...base, showOnNextVisit: true });
  assert.equal(replay.replayed, true);
  assert.equal(f.notifications.length, 1);
});

test("operator links reject unsafe paths before persisting the notification", async () => {
  const f = fixture();
  for (const actionUrl of ["javascript:alert(1)", "//evil.example/my", "/my/../../ops", "/my-other", "/my\\evil", "https://user:password@example.com/"]) {
    await assert.rejects(f.sendOpsNotification({ ...base, actionUrl }), error => error.code === "invalid_request");
  }
  assert.equal(f.databaseAccesses(), 0);
});

test("the API forwards exact popup mode so invalid values are rejected rather than coerced", async () => {
  const f = fixture();
  const route = load("app/api/ops/notifications/route.ts", {
    "@/lib/platform/ops-api": {
      requireOpsMutationRequest: async () => ({ viewer: { authUserId: ids.actor } }),
      opsJson: (body, status = 200) => Response.json(body, { status }),
      opsRepositoryErrorResponse: error => Response.json({ error: error.message }, { status: 400 }),
    },
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError },
    "@/lib/platform/ops-notification-repository": f,
  });
  const request = body => new Request("https://members.example/api/ops/notifications", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": base.requestKey }, body: JSON.stringify(body) });
  assert.equal((await route.POST(request({ ...base, showOnNextVisit: "false" }))).status, 400);
  assert.equal(f.databaseAccesses(), 0);
  assert.equal((await route.POST(request({ ...base, showOnNextVisit: true }))).status, 201);
  assert.equal(f.notifications[0].show_on_next_visit, true);
});
