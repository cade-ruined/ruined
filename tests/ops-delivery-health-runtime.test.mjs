import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { taggedDatabase } from "../scripts/check-support-repository.mjs";

async function load(path, dependencies = {}) {
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const policy = await load("src/lib/support/delivery-policy.ts");
const health = await load("src/lib/platform/ops-delivery-health.ts", { "server-only": {}, "@/lib/support/delivery-policy": policy });
const date = (value) => new Date(value).getTime();

async function fixture() {
  const PGlite = await loadPGliteForSchemaChecks();
  const pg = new PGlite();
  await pg.exec(`
    create table platform_users(auth_user_id uuid primary key, status text default 'active', last_signed_in_at timestamptz);
    create table platform_role_grants(auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table stripe_webhook_events(status text, livemode boolean, processed_at timestamptz, updated_at timestamptz);
    create table member_notifications(channel text, status text, delivered_at timestamptz, sent_at timestamptz, scheduled_for timestamptz);
    create table support_tickets(status text, updated_at timestamptz);
    create table support_email_deliveries(status text, attempts int default 0, last_error text, first_attempt_at timestamptz, available_at timestamptz, locked_at timestamptz, sent_at timestamptz);
    create table experiences(id uuid primary key, circle_id uuid);
    create table experience_calendar_links(experience_id uuid, livemode boolean, status text, updated_at timestamptz, last_synced_at timestamptz);
    create table circle_staff_assignments(auth_user_id uuid, circle_id uuid, role_slug text, assigned_at timestamptz default now(), ended_at timestamptz);
    create table workflow_actions(id uuid, action_type text, attempts int, status text, updated_at timestamptz);
    create table workflow_action_attempts(workflow_action_id uuid, error_code text, occurred_at timestamptz);
  `);
  const sql = taggedDatabase(pg);
  const ids = Object.fromEntries(["admin", "staff", "circle", "otherCircle", "event", "otherEvent", "unboundEvent"].map(key => [key, crypto.randomUUID()]));
  await pg.query("insert into platform_users(auth_user_id,last_signed_in_at) values($1,now()-interval '1 hour'),($2,now()-interval '2 hours')", [ids.admin, ids.staff]);
  await pg.query("insert into platform_role_grants values($1,'ops_admin',null),($2,'circle_leader',null)", [ids.admin, ids.staff]);
  await pg.query("insert into experiences values($1,$2),($3,$4),($5,$2)", [ids.event, ids.circle, ids.otherEvent, ids.otherCircle, ids.unboundEvent]);
  await pg.query("insert into circle_staff_assignments(auth_user_id,circle_id,role_slug) values($1,$2,'circle_leader')", [ids.staff, ids.circle]);
  const repository = await load("src/lib/platform/ops-operating-repository.ts", {
    "server-only": {}, "node:crypto": crypto,
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/google/calendar": { getGoogleCalendarConfigurationStatus: () => ({ ready: true }) },
    "@/lib/support/delivery": { getSupportEmailConfiguration: () => ({ ready: true }) },
    "@/lib/google/communications": {},
    "@/lib/platform/ops-delivery-health": health,
  });
  return { pg, sql, ids, repository };
}

test("delivery health scopes Stripe and Calendar evidence to the selected mode and does not invent unknown-mode success", async () => {
  const f = await fixture();
  try {
    await f.pg.exec(`
      insert into stripe_webhook_events values
        ('processed',true,now()-interval '1 hour',now()),('processed',false,now()-interval '2 hours',now()),
        ('failed',true,null,now()),('failed',true,null,now()),('failed',false,null,now()),
        ('processing',false,null,now()-interval '30 minutes');
    `);
    await f.pg.query("insert into experience_calendar_links values($1,true,'failed',now()-interval '30 minutes',now()-interval '1 hour'),($2,false,'pending_update',now()-interval '1 minute',now()-interval '2 hours')", [f.ids.event, f.ids.otherEvent]);
    const live = await health.readOpsDeliveryHealth(f.sql, { stripe: true, calendar: true });
    const sandbox = await health.readOpsDeliveryHealth(f.sql, { stripe: false, calendar: false });
    const unknown = await health.readOpsDeliveryHealth(f.sql, { stripe: null, calendar: null });
    assert.equal(live.stripe_failed, 2); assert.equal(live.stripe_pending, 0); assert.equal(live.calendar_failed, 1); assert.equal(live.calendar_pending, 0);
    assert.equal(sandbox.stripe_failed, 1); assert.equal(sandbox.stripe_pending, 1); assert.equal(sandbox.calendar_failed, 0); assert.equal(sandbox.calendar_pending, 1);
    assert.ok(date(live.last_stripe_at) > date(sandbox.last_stripe_at));
    assert.ok(date(live.last_calendar_at) > date(sandbox.last_calendar_at));
    assert.equal(unknown.last_stripe_at, null); assert.equal(unknown.last_calendar_at, null);
    assert.equal(unknown.stripe_failed, 0); assert.equal(unknown.calendar_failed, 0);
  } finally { await f.pg.close(); }
});

test("future notification and support queues are pending but not overdue; email-channel activity is not in-app success", async () => {
  const f = await fixture();
  try {
    await f.pg.exec(`
      insert into member_notifications values ('in_app','queued',null,null,now()+interval '1 day'),('email','delivered',now(),now(),now());
      insert into support_email_deliveries(status,available_at) values('pending',now()+interval '1 day');
    `);
    let snapshot = await health.readOpsDeliveryHealth(f.sql, { stripe: false, calendar: false });
    assert.equal(snapshot.notification_pending, 1); assert.equal(snapshot.notification_oldest, null); assert.equal(snapshot.last_notification_at, null);
    assert.equal(snapshot.support_pending, 1); assert.equal(snapshot.support_oldest, null); assert.equal(snapshot.last_support_at, null);
    const config = { supabase: true, stripe: true, stripeMode: false, calendar: true, calendarMode: false, support: true };
    assert.equal(health.buildOpsHealthServices(snapshot, config).find(service => service.label === "Support email").state, "configured");
    await f.pg.exec("update support_email_deliveries set available_at=now()-interval '30 minutes'; update member_notifications set scheduled_for=now()-interval '30 minutes' where channel='in_app'");
    snapshot = await health.readOpsDeliveryHealth(f.sql, { stripe: false, calendar: false });
    const services = health.buildOpsHealthServices(snapshot, config);
    assert.equal(services.find(service => service.label === "Support email").state, "delayed");
    assert.equal(services.find(service => service.label === "In-app notifications").state, "delayed");
    assert.equal(services.find(service => service.label === "Postgres").state, "verified");
    assert.equal(services.find(service => service.label === "Member sign-in").state, "configured");
  } finally { await f.pg.close(); }
});

test("support health counts uncertain expired sends before the worker runs, without counting them as safe retries", async () => {
  const f = await fixture();
  try {
    await f.pg.exec(`
      insert into support_email_deliveries(status,attempts,last_error,first_attempt_at,available_at,sent_at) values
        ('sent',1,null,now()-interval '2 hours',now()-interval '2 hours',now()-interval '2 hours'),
        ('failed',2,'uncertain:provider_timeout',now()-interval '25 hours',now()-interval '24 hours',null),
        ('failed',1,'not_sent:provider_http_429',now()-interval '25 hours',now()-interval '20 minutes',null),
        ('dead_letter',5,'not_sent:provider_http_422',now()-interval '25 hours',now(),null),
        ('processing',2,'uncertain:send_in_flight',now()-interval '25 hours',now()-interval '24 hours',null);
    `);
    const snapshot = await health.readOpsDeliveryHealth(f.sql, { stripe: false, calendar: false });
    assert.equal(snapshot.support_failed, 3);
    assert.equal(snapshot.support_pending, 1);
    assert.ok(date(snapshot.support_oldest) > date(snapshot.checked_at) - 21 * 60_000);
    assert.ok(date(snapshot.last_support_at) > date(snapshot.checked_at) - 121 * 60_000);
    const service = health.buildOpsHealthServices(snapshot, { supabase: true, stripe: true, stripeMode: false, calendar: true, calendarMode: false, support: true }).find(item => item.label === "Support email");
    assert.equal(service.state, "failed"); assert.equal(service.evidenceLabel, "Last provider acceptance");
    assert.match(service.detail, /inbox delivery is not confirmed/);
  } finally { await f.pg.close(); }
});

test("overview attention includes unbound Calendar links; scoped staff never receive support or another Circle's counts", async () => {
  const f = await fixture();
  try {
    await f.pg.exec("insert into support_tickets values('open',now()),('in_progress',now()),('resolved',now()),('waiting_on_member',now())");
    await f.pg.query("insert into experience_calendar_links values($1,false,'pending_update',now(),null),($2,false,'failed',now(),null),($3,null,'active',now(),now())", [f.ids.event, f.ids.otherEvent, f.ids.unboundEvent]);
    let items = await health.readOpsDeliveryAttention(f.sql, { authUserId: f.ids.admin, isAdmin: true });
    assert.equal(items.find(item => item.href === "/ops/support").count, 2);
    assert.equal(items.find(item => item.href === "/ops/experiences").count, 3);
    items = await health.readOpsDeliveryAttention(f.sql, { authUserId: f.ids.staff, isAdmin: false });
    assert.equal(items.find(item => item.href === "/ops/support"), undefined);
    assert.equal(items.find(item => item.href === "/ops/experiences").count, 2);
    const snapshot = await health.readOpsDeliveryHealth(f.sql, { stripe: false, calendar: false });
    assert.equal(snapshot.calendar_unbound, 1);
    await f.pg.query("update circle_staff_assignments set assigned_at=now()+interval '1 day' where auth_user_id=$1", [f.ids.staff]);
    assert.deepEqual(await health.readOpsDeliveryAttention(f.sql, { authUserId: f.ids.staff, isAdmin: false }), []);
    await f.pg.query("update circle_staff_assignments set assigned_at=now()-interval '1 day' where auth_user_id=$1", [f.ids.staff]);
    await f.pg.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [f.ids.staff]);
    assert.deepEqual(await health.readOpsDeliveryAttention(f.sql, { authUserId: f.ids.staff, isAdmin: false }), []);
  } finally { await f.pg.close(); }
});

test("real System and Overview repository entry points deny revoked roles before reading health or private counts", async () => {
  const f = await fixture();
  try {
    const configuration = { supabase: "connected", stripe: "connected" };
    await assert.rejects(() => f.repository.getOpsSystemHealth(f.ids.staff, configuration), error => error.code === "forbidden");
    // System read succeeds for the current administrator using the real health SQL.
    const result = await f.repository.getOpsSystemHealth(f.ids.admin, configuration);
    assert.ok(result.health.services.find(service => service.label === "Support email"));
    await f.pg.exec("update platform_role_grants set revoked_at=now()");
    for (const auth of [f.ids.admin, f.ids.staff]) {
      await assert.rejects(() => f.repository.getOpsSystemHealth(auth, configuration), error => error.code === "forbidden");
      await assert.rejects(() => f.repository.getOpsOverviewData(auth), error => error.code === "forbidden");
    }
  } finally { await f.pg.close(); }
});
