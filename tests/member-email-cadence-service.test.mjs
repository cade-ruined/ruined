import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { NextResponse } from "next/server.js";
import * as parse5 from "parse5";
import ts from "typescript";
import { json, serializeJsonBindings } from "./helpers/postgres-json-bindings.mjs";

async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const model = await load("src/lib/communications/admin-email-model.ts");
const cadence = await load("src/lib/communications/member-email-cadence-model.ts");
const management = await load("src/lib/communications/member-email-cadence-management.ts");
const campaignFooter = await load("src/lib/communications/resend-email-campaign-footer.ts", { parse5 });
const templates = await load("src/lib/communications/resend-email-templates.ts", { parse5, "./admin-email-model": model, "./resend-email-campaign-footer": campaignFooter });
const copy = await load("src/lib/communications/member-email-cadence-copy.ts", { "./member-email-cadence-model": cadence });
const renderer = await load("src/lib/communications/member-email-cadence-renderer.ts", {
  parse5, "./member-email-cadence-copy": copy, "./resend-email-templates": templates, "./admin-email-model": model,
});
const future = days => new Date(Date.now() + days * 86_400_000).toISOString();
const clone = value => structuredClone(value);

async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`create role anon; create role authenticated; create schema private;
    create table platform_users(auth_user_id uuid primary key,status text not null);
    create table platform_role_grants(auth_user_id uuid references platform_users,role_slug text,revoked_at timestamptz);
    create table operator_audit_events(id bigint generated always as identity,actor_auth_user_id uuid,action text,subject_type text,subject_id text,metadata jsonb check(jsonb_typeof(metadata)='object'));
    create table experiences(id uuid primary key,title text,starts_at timestamptz,ends_at timestamptz,timezone text,
      status text,cancelled_at timestamptz,kind text,visibility text,registration_mode text,
      version integer not null default 1,circle_id uuid,block_id uuid,progression_level_slug text);
    create table ruined_members(id uuid primary key);`);
  await pg.exec(await readFile(new URL("../db/migrations/20261012230000_member_email_cadence.sql", import.meta.url), "utf8"));
  await pg.exec(await readFile(new URL("../db/migrations/20261012233000_member_email_sequences.sql", import.meta.url), "utf8"));
  const admin = crypto.randomUUID(), other = crypto.randomUUID(), guide = crypto.randomUUID();
  await pg.query("insert into platform_users values($1,'active'),($2,'active'),($3,'active')", [admin, other, guide]);
  await pg.query("insert into platform_role_grants values($1,'ops_admin',null),($2,'ops_admin',null),($3,'guide',null)", [admin, other, guide]);
  function bridge(client) {
    const sql = async (strings, ...values) => (await client.query(strings.reduce((query, part, index) => query + (index ? `$${index}` : "") + part, ""), serializeJsonBindings(strings, values))).rows;
    sql.json = json;
    sql.begin = callback => client.transaction(tx => callback(bridge(tx)));
    return sql;
  }
  const sql = bridge(pg);
  const auth = await load("src/lib/communications/admin-email-repository.ts", { "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => sql }, "./admin-email-model": model });
  const template = templates.normalizeResendTemplate({ id: crypto.randomUUID(), name: "Approved personal design", status: "published", current_version_id: crypto.randomUUID(),
    html: '<html><head></head><body><h1>Original heading</h1><p>{{{BODY}}}</p><p>Original footer</p></body></html>',
    subject: "Original subject", from: "Ruined <hello@example.com>", reply_to: ["support@example.com"],
    variables: [{ key: "BODY", type: "string", fallback_value: "Original message" }] });
  const event = { id: crypto.randomUUID(), title: "Foundations 01", startsAt: future(30), endsAt: future(30 + 90 / 1440), timeZone: "America/Denver",
    version: "1", visibility: "invite_only", circle_id: null, block_id: null, progression_level_slug: null, registration_mode: "internal", kind: "weekly_call" };
  await pg.query("insert into experiences(id,title,starts_at,ends_at,timezone,status,cancelled_at,kind,visibility,registration_mode) values($1,$2,$3,$4,$5,'published',null,$6,$7,$8)", [event.id, event.title, event.startsAt, event.endsAt, event.timeZone, event.kind, event.visibility, event.registration_mode]);
  const recipients = [{ memberId: crypto.randomUUID(), name: "Avery", email: "avery@example.com", eligible: true, reason: "Qualified", registeredAt: future(-2), consentId: "21" },
    { memberId: crypto.randomUUID(), name: "Jordan", email: "jordan@example.com", eligible: false, reason: "Membership email reminders are not enabled", registeredAt: future(-2), consentId: null }];
  const draft = { eventId: event.id, kind: "foundations_01", track: "members", templateId: template.id, templateVersion: template.version,
    bodyTarget: "variable:BODY", headingTarget: `copy:${template.fields.find(field => field.value === "Original heading").key}`, bindings: {} };
  const state = { event: clone(event), template: clone(template), recipients: clone(recipients), ready: true, calls: [], providerHook: null, lockedRosterHook: null,
    providerFailure: null, catalogFailure: null, matchingEvents: null, configuration: {enabled: false, ready: false, activatedAt: null}, suppressed: new Set(), viewer: { authUserId: admin }, logs: [] };
  const repository = {
    readCadenceEvent: async (_tx, id) => id === state.event?.id ? clone(state.event) : null,
    sameCadenceEvent: (a, b) => a !== null && Object.keys(b).every(key => a[key] === b[key]),
    cadenceCallReady: async () => state.ready,
    readCadenceRecipients: async (_tx, _event, _track, options = {}) => { if (options.lock && state.lockedRosterHook) await state.lockedRosterHook(); return clone(state.recipients); },
  };
  class CadenceDeliveryError extends Error { constructor(code) { super(code); this.code = code; } }
  const delivery = await load("src/lib/communications/member-email-cadence-delivery.ts", {
    "server-only": {}, resend: { Resend: class { constructor() { throw Error("No sending is allowed in service tests"); } } },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) }, "./admin-email-model": model,
    "./member-email-cadence-model": cadence, "./member-email-cadence-repository": { CadenceDeliveryError },
    "./member-email-cadence-provider": { reserveCadenceProviderSlot: async () => {} },
  }, { process: { env: {} } });
  const service = await load("src/lib/communications/member-email-cadence-service.ts", {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => sql },
    "./admin-email-model": model, "./admin-email-repository": auth,
    "./resend-email-service": { getResendEmailTemplate: async (_actor, templateId) => { assert.equal(templateId, template.id); state.calls.push("template"); return clone(state.template); } },
    "./member-email-cadence-model": cadence, "./member-email-cadence-delivery": {...delivery, getMemberEmailCadenceDeliveryConfiguration: () => clone(state.configuration)},
    "./member-email-cadence-management": management, "./member-email-cadence-copy": copy, "./automated-email-catalog": {getAutomatedEmailCatalog: () => []},
    "./member-email-cadence-repository": repository, "./member-email-cadence-renderer": renderer,
    "./member-email-cadence-inheritance": { matchingCadenceEvents: async () => state.matchingEvents ?? (state.event ? [clone(state.event)] : []) },
    "./member-email-cadence-provider": {
      listCadenceTemplates: async () => { state.calls.push("templates"); if (state.catalogFailure) throw state.catalogFailure; return [clone(state.template)]; },
      reviewCadenceProviderRecipients: async rows => { state.calls.push("recipients"); if (state.providerHook) await state.providerHook(); if (state.providerFailure) throw state.providerFailure;
        return rows.map(row => state.suppressed.has(row.email) ? { ...row, eligible: false, reason: "Provider suppressed" } : row); },
    },
  });
  const session = { getCurrentPlatformViewer: async () => state.viewer };
  class OpsOperatingRepositoryError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const request = await load("src/lib/auth/request.ts", {}, { process: { env: { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://members.example.com" } } });
  const ops = await load("src/lib/platform/ops-api.ts", { "next/server": { NextResponse }, "@/lib/auth/request": request, "@/lib/auth/session": session,
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError } });
  const api = await load("src/lib/communications/admin-email-api.ts", {
    "server-only": {}, "@/lib/communications/admin-email-model": model,
    "@/lib/communications/admin-email-ai": await load("src/lib/communications/admin-email-ai.ts"),
    "@/lib/communications/admin-email-repository": auth, "@/lib/platform/ops-api": ops,
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError },
  }, { console: { error: (...values) => state.logs.push(values) } });
  const route = await load("app/api/ops/emails/automations/route.ts", {
    "@/lib/auth/session": session, "@/lib/communications/admin-email-api": api, "@/lib/communications/admin-email-model": model,
    "@/lib/communications/member-email-cadence-service": service, "@/lib/platform/ops-api": ops,
  });
  const post = (body, headers = {}) => route.POST(new Request("https://members.example.com/api/ops/emails/automations", {
    method: "POST", headers: { Origin: "https://members.example.com", "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  async function reset() {
    await pg.exec("truncate private.member_email_cadence_deliveries,private.member_email_cadence_reviews,private.member_email_cadence_plans,private.member_email_cadence_sequences,private.member_email_cadence_event_bindings,operator_audit_events;");
    await pg.exec("update platform_users set status='active'; update platform_role_grants set revoked_at=null;");
    await pg.query("update experiences set title=$2,starts_at=$3,ends_at=$4,status='published',cancelled_at=null,version=1 where id=$1", [event.id,event.title,event.startsAt,event.endsAt]);
    Object.assign(state, { event: clone(event), template: clone(template), recipients: clone(recipients), ready: true, calls: [], providerHook: null,
      lockedRosterHook: null, providerFailure: null, catalogFailure: null, matchingEvents: null, configuration: {enabled: false, ready: false, activatedAt: null}, suppressed: new Set(), viewer: { authUserId: admin }, logs: [] });
  }
  const get = query => route.GET(new Request(`https://members.example.com/api/ops/emails/automations${query ? `?${new URLSearchParams(query)}` : ""}`));
  const enable = () => { state.configuration = {enabled: true, ready: true, activatedAt: future(-10)}; };
  const rows = async name => (await pg.query(`select * from private.member_email_cadence_${name} order by id`)).rows;
  return { pg, admin, other, guide, draft, event, template, state, service, route, post, get, enable, reset, rows };
}

test("admin cadence reviews and activations persist safely through real PostgreSQL JSONB semantics", async t => {
  const f = await fixture(t);
  await t.test("authorization precedes provider reads and persistence", async () => {
    await f.reset();
    for (const actor of [f.guide, crypto.randomUUID()]) {
      await assert.rejects(f.service.getCadenceOverview(actor), error => error.status === 403);
      await assert.rejects(f.service.previewCadence(actor, f.draft), error => error.status === 403);
      await assert.rejects(f.service.activateCadence(actor, crypto.randomUUID()), error => error.status === 403);
      await assert.rejects(f.service.pauseCadence(actor, crypto.randomUUID(), 1), error => error.status === 403);
    }
    assert.equal(f.state.calls.length, 0); assert.equal((await f.rows("reviews")).length, 0);
  });
  await t.test("review renders every future stage and freezes an object snapshot without activating anything", async () => {
    await f.reset(); const result = await f.service.previewCadence(f.admin, f.draft);
    assert.equal(result.previews.length, 4); assert.equal(result.occurrences.length, 4);
    assert.equal(result.recipients.filter(row => row.eligible).length, 1);
    for (const preview of result.previews) { assert.match(preview.html, /Foundations/); assert.doesNotMatch(preview.html, /RUINED_CADENCE_BODY/); assert.match(preview.text, /Your call details and access link/); }
    const saved = (await f.rows("reviews"))[0];
    assert.equal(typeof saved.snapshot, "object"); assert.deepEqual(saved.snapshot.plan.template, f.template);
    assert.equal(saved.actor_auth_user_id, f.admin); assert.equal(saved.consumed_at, null);
    assert.ok(Date.parse(result.expiresAt) > Date.now()); assert.equal((await f.rows("plans")).length, 0); assert.equal((await f.rows("deliveries")).length, 0);
  });
  await t.test("unchanged review activates once after JSONB key reordering, with one audit and no delivery", async () => {
    await f.reset(); const reviewed = await f.service.previewCadence(f.admin, f.draft);
    const result = await f.service.activateCadence(f.admin, reviewed.reviewToken);
    assert.equal(result.active, true); assert.equal(result.revision, 1);
    assert.equal((await f.rows("plans")).length, 1); assert.ok((await f.rows("reviews"))[0].consumed_at);
    assert.equal((await f.rows("deliveries")).length, 0);
    assert.equal((await f.pg.query("select metadata->>'reviewId' as review from operator_audit_events where action='member_email_cadence.activated'")).rows[0].review, reviewed.reviewToken);
    await assert.rejects(f.service.activateCadence(f.admin, reviewed.reviewToken), error => error.status === 409);
    assert.equal((await f.pg.query("select count(*)::int as count from operator_audit_events")).rows[0].count, 1);
  });
  await t.test("template changes are detected both before review and before activation", async () => {
    await f.reset(); await assert.rejects(f.service.previewCadence(f.admin, { ...f.draft, templateVersion: "stale" }), error => error.status === 409);
    assert.equal((await f.rows("reviews")).length, 0);
    const reviewed = await f.service.previewCadence(f.admin, f.draft); f.state.template.html += "<!-- provider edit with same version -->";
    await assert.rejects(f.service.activateCadence(f.admin, reviewed.reviewToken), error => error.status === 409 && /design changed/.test(error.message));
    assert.equal((await f.rows("plans")).length, 0);
  });
  await t.test("simultaneous requests using one review commit only one plan and audit", async () => {
    await f.reset(); const reviewed = await f.service.previewCadence(f.admin, f.draft);
    const outcomes = await Promise.allSettled([f.service.activateCadence(f.admin, reviewed.reviewToken), f.service.activateCadence(f.admin, reviewed.reviewToken)]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.find(result => result.status === "rejected").reason.status, 409);
    assert.equal((await f.rows("plans")).length, 1);
    assert.equal((await f.pg.query("select count(*)::int as count from operator_audit_events")).rows[0].count, 1);
  });
  await t.test("changed event, local roster, provider preference or final locked roster rejects stale approval", async () => {
    for (const mutate of [() => { f.state.event.title = "Changed call"; }, () => { f.state.recipients[0].email = "changed@example.com"; },
      () => { f.state.suppressed.add(f.state.recipients[0].email); }, () => { f.state.lockedRosterHook = () => { f.state.recipients[0].consentId = "22"; }; }]) {
      await f.reset(); const reviewed = await f.service.previewCadence(f.admin, f.draft); mutate();
      await assert.rejects(f.service.activateCadence(f.admin, reviewed.reviewToken), error => [400, 409].includes(error.status));
      assert.equal((await f.rows("plans")).length, 0); assert.equal((await f.rows("reviews"))[0].consumed_at, null);
    }
  });
  await t.test("expired and another administrator's token cannot activate", async () => {
    await f.reset(); const reviewed = await f.service.previewCadence(f.admin, f.draft);
    await assert.rejects(f.service.activateCadence(f.other, reviewed.reviewToken), error => error.status === 409);
    await f.pg.query("update private.member_email_cadence_reviews set expires_at=clock_timestamp()-interval '1 second' where id=$1", [reviewed.reviewToken]);
    await assert.rejects(f.service.activateCadence(f.admin, reviewed.reviewToken), error => error.status === 409);
    assert.equal((await f.rows("plans")).length, 0);
  });
  await t.test("admin revocation after provider review prevents durable activation", async () => {
    await f.reset(); const reviewed = await f.service.previewCadence(f.admin, f.draft);
    f.state.providerHook = async () => { await f.pg.query("update platform_role_grants set revoked_at=clock_timestamp() where auth_user_id=$1", [f.admin]); };
    await assert.rejects(f.service.activateCadence(f.admin, reviewed.reviewToken), error => error.status === 403);
    assert.equal((await f.rows("plans")).length, 0); assert.equal((await f.rows("reviews"))[0].consumed_at, null);
  });
  await t.test("parallel approvals cannot replace a newer plan; pause requires its current revision", async () => {
    await f.reset(); const first = await f.service.previewCadence(f.admin, f.draft), second = await f.service.previewCadence(f.other, f.draft);
    const active = await f.service.activateCadence(f.admin, first.reviewToken);
    await assert.rejects(f.service.activateCadence(f.other, second.reviewToken), error => error.status === 409 && /Another admin/.test(error.message));
    const paused = await f.service.pauseCadence(f.admin, active.id, active.revision);
    assert.equal(paused.active, false); assert.equal(paused.revision, 2);
    await assert.rejects(f.service.pauseCadence(f.admin, active.id, active.revision), error => error.status === 409);
    const newReview = await f.service.previewCadence(f.admin, f.draft), resumed = await f.service.activateCadence(f.admin, newReview.reviewToken);
    assert.equal(resumed.id, active.id); assert.equal(resumed.revision, 3); assert.equal(resumed.active, true);
  });
  await t.test("review requires published individual designs, explicit private Foundations scope and working call access", async () => {
    for (const mutate of [() => { f.state.template.status = "draft"; }, () => { f.state.template.campaignOnly = true; }, () => { f.state.event.visibility = "all_members"; }, () => { f.state.ready = false; }]) {
      await f.reset(); mutate(); await assert.rejects(f.service.previewCadence(f.admin, f.draft), error => error.status === 400);
      assert.equal((await f.rows("reviews")).length, 0);
    }
  });
  await t.test("overview reports disabled configuration without arming plans", async () => {
    await f.reset(); const overview = await f.service.getCadenceOverview(f.admin);
    assert.equal(overview.configuration.enabled, false); assert.equal(overview.configuration.ready, false);
    assert.equal(overview.events[0].id, f.event.id); assert.equal(overview.plans.length, 0); assert.equal(overview.templates[0].id, f.template.id);
    assert.deepEqual(overview.inactive.map(item => item.title), ["Missed calls and unfinished work", "Foundations completion and Circle reveal", "Birthdays, anniversaries, and milestones", "Holidays, launches, and clothing drops"]);
    assert.equal(overview.setupRequired, false);
  });
  await t.test("a future sequence can be reviewed and approved before any calls or members exist", async () => {
    await f.reset(); f.state.event = null; f.state.recipients = [];
    const result = await f.service.previewCadence(f.admin, { ...f.draft, scope: "sequence", eventId: "" });
    assert.equal(result.scope, "sequence"); assert.equal(result.previews.length, 4);
    assert.deepEqual(result.matchingEvents, []); assert.deepEqual(result.recipients, []);
    assert.match(result.warnings.join(" "), /current and future matching/);
    const active = await f.service.activateCadence(f.admin, result.reviewToken);
    assert.equal(active.scope, "sequence"); assert.equal(active.active, true);
    assert.equal((await f.rows("sequences")).length, 1);
    assert.equal((await f.rows("plans")).length, 0); assert.equal((await f.rows("deliveries")).length, 0);
    assert.equal((await f.service.getCadenceOverview(f.admin)).sequences[0].id, active.id);
    await assert.rejects(f.service.activateCadence(f.admin, result.reviewToken), error => error.status === 409);
  });
  await t.test("sequence approval does not freeze an example roster or permit stale competing rule updates", async () => {
    await f.reset(); const draft = { ...f.draft, scope: "sequence" };
    const first = await f.service.previewCadence(f.admin, draft), competing = await f.service.previewCadence(f.other, draft);
    f.state.recipients = []; f.state.event.title = "Changed example";
    const active = await f.service.activateCadence(f.admin, first.reviewToken);
    await assert.rejects(f.service.activateCadence(f.other, competing.reviewToken), error => error.status === 409 && /sequence/.test(error.message));
    const paused = await f.service.pauseCadenceSequence(f.admin, active.id, active.revision);
    assert.equal(paused.active, false); assert.equal(paused.revision, 2);
    await assert.rejects(f.service.pauseCadenceSequence(f.admin, active.id, active.revision), error => error.status === 409);
    const next = await f.service.previewCadence(f.admin, { ...draft, eventId: "" });
    const resumed = await f.service.activateCadence(f.admin, next.reviewToken);
    assert.equal(resumed.id, active.id); assert.equal(resumed.revision, 3);
    assert.equal((await f.rows("deliveries")).length, 0);
  });
  await t.test("sequence approval requires a matching example, unchanged design, and active admin", async () => {
    await f.reset(); const draft = { ...f.draft, scope: "sequence", eventId: "" };
    await assert.rejects(f.service.previewCadence(f.admin, { ...draft, eventId: crypto.randomUUID() }), error => error.status === 400);
    const first = await f.service.previewCadence(f.admin, draft);
    f.state.template.html += "<!-- changed -->";
    await assert.rejects(f.service.activateCadence(f.admin, first.reviewToken), error => error.status === 409);
    await f.reset(); const second = await f.service.previewCadence(f.admin, draft);
    await f.pg.query("update platform_role_grants set revoked_at=clock_timestamp() where auth_user_id=$1", [f.admin]);
    await assert.rejects(f.service.activateCadence(f.admin, second.reviewToken), error => error.status === 403);
    await assert.rejects(f.service.pauseCadenceSequence(f.guide, crypto.randomUUID(), 1), error => error.status === 403);
    assert.equal((await f.rows("sequences")).length, 0);
  });
  await t.test("overview exposes durable delivery outcomes and a changed call without mutating approval", async () => {
    await f.reset(); f.enable(); const reviewed = await f.service.previewCadence(f.admin, f.draft);
    const active = await f.service.activateCadence(f.admin, reviewed.reviewToken);
    let [plan] = (await f.service.getCadenceOverview(f.admin)).plans;
    assert.equal(plan.attention, "");
    assert.deepEqual(plan.delivery, {sent: 0, pending: 0, failed: 0, manualReview: 0, cancelled: 0});
    for (const status of ["sent", "pending", "sending", "failed", "manual_review", "cancelled"]) {
      const member = crypto.randomUUID();
      await f.pg.query("insert into ruined_members values($1)", [member]);
      await f.pg.query(`insert into private.member_email_cadence_deliveries
        (plan_id,plan_revision,experience_id,member_id,starts_at,stage,expected_email,expected_consent_id,due_at,expires_at,status)
        values($1,1,$2,$3,$4,'day_before','member@example.com',21,$5,$6,$7)`,
        [active.id, f.event.id, member, f.event.startsAt, future(29), future(29.01), status]);
    }
    [plan] = (await f.service.getCadenceOverview(f.admin)).plans;
    assert.deepEqual(plan.delivery, {sent: 1, pending: 2, failed: 1, manualReview: 1, cancelled: 1});
    assert.match(plan.attention, /Delivery needs attention/);
    await f.pg.query("update experiences set title='Rescheduled call',version=version+1 where id=$1", [f.event.id]);
    [plan] = (await f.service.getCadenceOverview(f.admin)).plans;
    assert.match(plan.attention, /^Call changed/);
    assert.equal(plan.active, true); assert.equal(plan.revision, active.revision);
    assert.equal((await f.rows("deliveries")).length, 6);
  });
});

test("automation HTTP route preserves authentication, same-origin, bounded JSON and safe error handling", async t => {
  const f = await fixture(t);
  await t.test("GET and POST reject signed-out or unauthorized accounts before provider access", async () => {
    f.state.viewer = null; assert.equal((await f.get()).status, 401); assert.equal((await f.post({ action: "preview", draft: f.draft })).status, 401);
    f.state.viewer = { authUserId: f.guide }; assert.equal((await f.get()).status, 403); assert.equal((await f.post({ action: "preview", draft: f.draft })).status, 403);
    assert.equal(f.state.calls.length, 0);
  });
  await t.test("cross-origin, malformed, oversized and wrong-media requests fail without provider activity", async () => {
    await f.reset();
    assert.equal((await f.post({ action: "preview" }, { Origin: "https://attacker.example.com" })).status, 403);
    assert.equal((await f.post("{}", { "Content-Type": "text/plain" })).status, 415);
    assert.equal((await f.post("{invalid")).status, 400);
    assert.equal((await f.post(JSON.stringify({ junk: "x".repeat(64_001) }))).status, 413);
    assert.equal((await f.post({ action: "send" })).status, 400);
    assert.equal(f.state.calls.length, 0);
  });
  await t.test("actual POST review, activate and pause use the authenticated actor and return no-store JSON", async () => {
    await f.reset(); const response = await f.post({ action: "preview", draft: f.draft, actor: f.guide });
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
    const reviewed = await response.json(); assert.equal((await f.rows("reviews"))[0].actor_auth_user_id, f.admin);
    const activated = await f.post({ action: "activate", reviewToken: reviewed.reviewToken }); assert.equal(activated.status, 200);
    const active = await activated.json(); const paused = await f.post({ action: "pause", id: active.id, revision: active.revision });
    assert.equal(paused.status, 200); assert.equal((await paused.json()).active, false);
  });
  await t.test("unexpected provider errors are private and never leave an activatable review", async () => {
    await f.reset(); f.state.providerFailure = Error("private-provider-secret-and-address");
    const response = await f.post({ action: "preview", draft: f.draft });
    assert.equal(response.status, 503); assert.doesNotMatch(JSON.stringify(await response.json()), /private-provider-secret/);
    assert.doesNotMatch(JSON.stringify(f.state.logs), /private-provider-secret/); assert.equal((await f.rows("reviews")).length, 0);
  });
});

test("saved automation management reads project approvals without changing delivery authority", async t => {
  const f = await fixture(t);
  const activate = async (scope = "event") => {
    const reviewed = await f.service.previewCadence(f.admin, { ...f.draft, scope, eventId: scope === "sequence" ? "" : f.event.id });
    return f.service.activateCadence(f.admin, reviewed.reviewToken);
  };
  await t.test("detail authenticates before reads, rejects invalid scope and IDs, and returns 404 for absent records", async () => {
    await f.reset();
    const query = {scope: "event", id: crypto.randomUUID()};
    f.state.viewer = null; assert.equal((await f.get(query)).status, 401);
    f.state.viewer = {authUserId: f.guide}; assert.equal((await f.get(query)).status, 403);
    await assert.rejects(f.service.getCadenceManagementDetail(f.guide, "event", query.id), error => error.status === 403);
    assert.deepEqual(f.state.calls, []);
    f.state.viewer = {authUserId: f.admin};
    assert.equal((await f.get({...query, scope: "all"})).status, 400);
    assert.equal((await f.get({...query, id: "bad"})).status, 400);
    assert.equal((await f.get(query)).status, 404);
    assert.equal((await f.rows("reviews")).length, 0);
  });
  await t.test("detail renders saved template and approved copy without live design reads, review rows, or raw private fields", async () => {
    await f.reset(); f.enable(); const active = await activate();
    const before = {plans: await f.rows("plans"), reviews: await f.rows("reviews"), deliveries: await f.rows("deliveries")};
    f.state.calls = []; f.state.template.version = "new-live-version"; f.state.template.html = "<p>Changed provider template</p>";
    const response = await f.get({scope: "event", id: active.id});
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
    const detail = await response.json();
    assert.equal(detail.template.version, f.template.version); assert.equal(detail.draft.templateVersion, f.template.version);
    assert.equal(detail.template.html, f.template.html); assert.equal(detail.previews.length, 4); assert.equal(detail.occurrences.length, 4);
    assert.match(detail.previews[0].text, /Every RU\/NED Membership starts in the same place/);
    assert.equal(detail.status, "upcoming"); assert.equal(detail.nextReminder.stage, "orientation");
    assert.equal(detail.recipientsChecked, true); assert.equal(detail.recipients.length, 2);
    assert.deepEqual(Object.keys(detail.recipients[0]).sort(), ["eligible", "email", "memberId", "name", "reason"]);
    assert.deepEqual(f.state.calls, ["recipients"]);
    assert.deepEqual({plans: await f.rows("plans"), reviews: await f.rows("reviews"), deliveries: await f.rows("deliveries")}, before);
    assert.doesNotMatch(JSON.stringify(detail), /audience_hash|reviewToken|expected_consent_id|lock_token|provider_message_id|actor_auth_user_id/);
  });
  await t.test("global pause, local pause, missing Meet and revoked approver never advertise a next send", async () => {
    await f.reset(); const active = await activate();
    let detail = await f.service.getCadenceManagementDetail(f.admin, "event", active.id);
    assert.equal(detail.status, "blocked"); assert.equal(detail.nextReminder, null);
    f.enable(); f.state.ready = false;
    detail = await f.service.getCadenceManagementDetail(f.admin, "event", active.id);
    assert.equal(detail.status, "blocked"); assert.equal(detail.nextReminder, null); assert.match(detail.warnings.join(" "), /Meet/);
    f.state.ready = true;
    await f.pg.query("update platform_role_grants set revoked_at=clock_timestamp() where auth_user_id=$1", [f.admin]);
    detail = await f.service.getCadenceManagementDetail(f.other, "event", active.id);
    assert.equal(detail.status, "blocked"); assert.equal(detail.nextReminder, null);
    await f.pg.query("update platform_role_grants set revoked_at=null where auth_user_id=$1", [f.admin]);
    await f.service.pauseCadence(f.admin, active.id, active.revision);
    detail = await f.service.getCadenceManagementDetail(f.admin, "event", active.id);
    assert.equal(detail.status, "paused"); assert.equal(detail.nextReminder, null); assert.equal(detail.previews.length, 4);
    assert.equal((await f.rows("plans"))[0].active, false);
  });
  await t.test("changed, cancelled, past and exhausted calls retain approved previews but cannot show upcoming sends", async () => {
    await f.reset(); f.enable(); const active = await activate();
    await f.pg.query("update experiences set title='Replacement title',version=2 where id=$1", [f.event.id]);
    let detail = await f.service.getCadenceManagementDetail(f.admin, "event", active.id);
    assert.equal(detail.status, "changed"); assert.equal(detail.nextReminder, null);
    assert.equal(detail.calls[0].title, "Replacement title"); assert.match(detail.previews.at(-1).subject, /Foundations 01/);
    assert.doesNotMatch(detail.previews.at(-1).subject, /Replacement/);
    await f.pg.query("update experiences set cancelled_at=clock_timestamp() where id=$1", [f.event.id]);
    detail = await f.service.getCadenceManagementDetail(f.admin, "event", active.id);
    assert.equal(detail.status, "cancelled"); assert.equal(detail.nextReminder, null); assert.equal(detail.recipientsChecked, false);
    await f.pg.query("update experiences set cancelled_at=null,starts_at=$2,ends_at=$3 where id=$1", [f.event.id, future(-1), future(-0.9)]);
    detail = await f.service.getCadenceManagementDetail(f.admin, "event", active.id);
    assert.equal(detail.status, "past"); assert.equal(detail.nextReminder, null); assert.equal(detail.recipientsChecked, false);
    await f.reset(); f.enable(); const exhausted = await activate();
    await f.pg.query("update private.member_email_cadence_plans set activated_at=$2 where id=$1", [exhausted.id, future(29.99)]);
    detail = await f.service.getCadenceManagementDetail(f.admin, "event", exhausted.id);
    assert.equal(detail.status, "no_remaining"); assert.equal(detail.nextReminder, null);
  });
  await t.test("sequence detail automatically checks the selected call audience and preserves individual overrides during parent pause", async () => {
    await f.reset(); f.enable(); const sequence = await activate("sequence"); const individual = await activate();
    f.state.calls = [];
    let detail = await f.service.getCadenceManagementDetail(f.admin, "sequence", sequence.id);
    assert.equal(detail.draft.scope, "sequence"); assert.equal(detail.draft.eventId, "");
    assert.equal(detail.selectedEventId, f.event.id); assert.equal(detail.recipientsChecked, true); assert.deepEqual(f.state.calls, ["recipients"]);
    assert.equal(detail.calls[0].status, "manual_override"); assert.equal(detail.calls[0].planId, individual.id); assert.equal(detail.calls[0].nextReminder, null);
    await assert.rejects(f.service.getCadenceManagementDetail(f.admin, "sequence", sequence.id, crypto.randomUUID()), error => error.status === 400);
    detail = await f.service.getCadenceManagementDetail(f.admin, "sequence", sequence.id, f.event.id);
    assert.equal(detail.recipientsChecked, true); assert.equal(detail.recipients.length, 2);
    await f.service.pauseCadenceSequence(f.admin, sequence.id, sequence.revision);
    detail = await f.service.getCadenceManagementDetail(f.admin, "sequence", sequence.id);
    assert.equal(detail.status, "paused"); assert.equal(detail.nextReminder, null); assert.equal(detail.calls[0].status, "manual_override");
    const own = await f.service.getCadenceManagementDetail(f.admin, "event", individual.id);
    assert.equal(own.status, "upcoming"); assert.ok(own.nextReminder);
  });
  await t.test("future inherited calls show pending setup and paused children without approving anything", async () => {
    await f.reset(); f.enable(); const sequence = await activate("sequence");
    let detail = await f.service.getCadenceManagementDetail(f.admin, "sequence", sequence.id);
    assert.equal(detail.status, "inheritance_pending"); assert.equal(detail.calls[0].status, "inheritance_pending"); assert.equal(detail.nextReminder, null);
    const plan = await activate();
    await f.pg.query("update private.member_email_cadence_plans set sequence_id=$2,sequence_revision=$3 where id=$1", [plan.id, sequence.id, sequence.revision]);
    detail = await f.service.getCadenceManagementDetail(f.admin, "sequence", sequence.id);
    assert.equal(detail.status, "upcoming"); assert.ok(detail.nextReminder); assert.equal(detail.calls[0].status, "upcoming");
    await f.service.pauseCadence(f.admin, plan.id, plan.revision);
    detail = await f.service.getCadenceManagementDetail(f.admin, "sequence", sequence.id);
    assert.equal(detail.calls[0].status, "paused"); assert.equal(detail.nextReminder, null);
    assert.equal((await f.rows("plans"))[0].active, false);
    f.state.event = null;
    detail = await f.service.getCadenceManagementDetail(f.admin, "sequence", sequence.id);
    assert.equal(detail.previewIsExample, true); assert.equal(detail.selectedEventId, null); assert.equal(detail.recipientsChecked, false); assert.equal(detail.previews.length, 4);
    assert.equal((await f.rows("plans")).length, 1);
  });
  await t.test("provider outages preserve management and saved previews while withholding unverified eligibility", async () => {
    await f.reset(); f.enable(); const active = await activate();
    f.state.catalogFailure = Error("sensitive-catalog-token");
    const overview = await f.service.getCadenceOverview(f.admin);
    assert.equal(overview.plans[0].id, active.id); assert.deepEqual(overview.templates, []);
    assert.match(overview.warnings.join(" "), /design list is unavailable/); assert.doesNotMatch(JSON.stringify(overview), /sensitive-catalog-token/);
    f.state.providerFailure = Error("sensitive-provider-token");
    const detail = await f.service.getCadenceManagementDetail(f.admin, "event", active.id);
    assert.equal(detail.previews.length, 4); assert.equal(detail.recipientsChecked, false); assert.deepEqual(detail.recipients, []);
    assert.match(detail.warnings.join(" "), /could not be verified/); assert.doesNotMatch(JSON.stringify(detail), /sensitive-provider-token/);
    const paused = await f.post({action: "pause", id: active.id, revision: active.revision}); assert.equal(paused.status, 200);
  });
  await t.test("history projects bounded safe outcomes and provider acceptance without exposing frozen payloads or tokens", async () => {
    await f.reset(); f.enable(); const active = await activate();
    for (const status of ["sent", "pending", "sending", "failed", "manual_review", "cancelled"]) {
      const member = crypto.randomUUID(); await f.pg.query("insert into ruined_members values($1)", [member]);
      await f.pg.query(`insert into private.member_email_cadence_deliveries
        (plan_id,plan_revision,experience_id,member_id,starts_at,stage,expected_email,expected_consent_id,due_at,expires_at,status,payload,last_error,lock_token,provider_message_id)
        values($1,1,$2,$3,$4,'day_before','hidden-person@example.com',21,$5,$6,$7,$8::jsonb,'sensitive-raw-error',$9,'sensitive-provider-id')`,
        [active.id,f.event.id,member,f.event.startsAt,future(29),future(29.01),status,JSON.stringify({secret: "sensitive-payload"}),crypto.randomUUID()]);
    }
    const before = await f.rows("deliveries");
    const detail = await f.service.getCadenceManagementDetail(f.admin, "event", active.id);
    assert.equal(detail.recentDeliveries.length, 6);
    assert.match(detail.recentDeliveries.find(item => item.status === "sent").reason, /not proof of inbox delivery/);
    assert.match(detail.recentDeliveries.find(item => item.status === "manual_review").reason, /Automatic retries are stopped/);
    assert.doesNotMatch(JSON.stringify(detail), /sensitive-|hidden-person|lock_token|provider_message_id|expected_consent_id/);
    assert.deepEqual(await f.rows("deliveries"), before);
    assert.deepEqual(detail.calls[0].delivery, {sent: 1,pending: 2,failed: 1,manualReview: 1,cancelled: 1});
  });
});

test("sequence history retains uncertain outcomes after calls leave the future matching audience", async t => {
  const f = await fixture(t); f.enable();
  const sequenceReview = await f.service.previewCadence(f.admin, {...f.draft,scope: "sequence",eventId: ""});
  const sequence = await f.service.activateCadence(f.admin, sequenceReview.reviewToken);
  const callReview = await f.service.previewCadence(f.admin, f.draft);
  const plan = await f.service.activateCadence(f.admin, callReview.reviewToken);
  await f.pg.query("update private.member_email_cadence_plans set sequence_id=$2,sequence_revision=$3 where id=$1", [plan.id,sequence.id,sequence.revision]);
  const member = crypto.randomUUID(); await f.pg.query("insert into ruined_members values($1)", [member]);
  await f.pg.query(`insert into private.member_email_cadence_deliveries
    (plan_id,plan_revision,experience_id,member_id,starts_at,stage,expected_email,expected_consent_id,due_at,expires_at,status)
    values($1,1,$2,$3,$4,'day_before','member@example.com',21,$5,$6,'manual_review')`,
    [plan.id,f.event.id,member,f.event.startsAt,future(29),future(29.01)]);
  await f.pg.query("update experiences set starts_at=$2,ends_at=$3,cancelled_at=clock_timestamp() where id=$1", [f.event.id,future(-1),future(-0.9)]);
  f.state.matchingEvents = [];
  const overview = await f.service.getCadenceOverview(f.admin);
  assert.equal(overview.sequences[0].matchingCallCount, 0);
  assert.equal(overview.sequences[0].delivery.manualReview, 1);
  assert.equal(overview.sequences[0].nextReminder, null);
  const detail = await f.service.getCadenceManagementDetail(f.admin, "sequence", sequence.id);
  assert.equal(detail.calls.length, 0); assert.equal(detail.recentDeliveries[0].status, "manual_review");
});

test("overview prioritizes current calls and explicitly reports its bounded history window", async t => {
  const f = await fixture(t);
  const reviewed = await f.service.previewCadence(f.admin, f.draft);
  const active = await f.service.activateCadence(f.admin, reviewed.reviewToken);
  const snapshot = (await f.rows("plans"))[0].snapshot;
  await f.pg.query(`insert into experiences(id,title,starts_at,ends_at,timezone,status,kind,visibility,registration_mode)
    select gen_random_uuid(),'Older call',now()-interval '2 days',now()-interval '1 day','America/Denver','published','weekly_call','invite_only','internal'
    from generate_series(1,250)`);
  await f.pg.query(`insert into private.member_email_cadence_plans(experience_id,active,snapshot,approved_by,updated_at)
    select id,false,$2::jsonb,$3,clock_timestamp() from experiences where id<>$1`, [f.event.id,JSON.stringify(snapshot),f.admin]);
  const overview = await f.service.getCadenceOverview(f.admin);
  assert.equal(overview.plans.length, 250); assert.equal(overview.plans[0].id, active.id);
  assert.match(overview.warnings.join(" "), /Older call approvals are omitted/);
  await f.pg.query("update experiences set starts_at=$2,ends_at=$3 where id<>$1", [f.event.id,future(10),future(10.1)]);
  const withPausedFutureCalls = await f.service.getCadenceOverview(f.admin);
  assert.equal(withPausedFutureCalls.plans[0].id, active.id);
});

test("message edits survive review, approval, reopen and revision without changing protected call details", async t => {
  const f = await fixture(t); f.enable();
  for (const scope of ["event", "sequence"]) {
    await f.reset(); f.enable();
    const messages = { day_before: { subject: "Your call is tomorrow", message: "Bring one honest question.\n\nWe’ll start there." }, orientation: { message: "Welcome to the work." } };
    const reviewed = await f.service.previewCadence(f.admin, { ...f.draft, scope, eventId: scope === "sequence" ? "" : f.event.id, messages });
    const preview = reviewed.previews.find(item => item.stage === "day_before");
    assert.equal(preview.subject, messages.day_before.subject);
    assert.match(preview.text, /Member,/);
    assert.match(preview.text, /Bring one honest question/);
    assert.match(preview.text, /Manage your email reminders/);
    assert.match(preview.text, /Your call details and access link/);
    assert.deepEqual((await f.rows("reviews"))[0].snapshot.plan.messages, messages);
    const active = await f.service.activateCadence(f.admin, reviewed.reviewToken);
    const detail = await f.service.getCadenceManagementDetail(f.admin, scope, active.id);
    assert.deepEqual(detail.draft.messages, messages);
    assert.equal(detail.previews.find(item => item.stage === "day_before").subject, messages.day_before.subject);
    assert.equal(detail.messageDefaults.length, 4);
    assert.notEqual(detail.messageDefaults.find(item => item.stage === "day_before").subject, messages.day_before.subject);
    const revised = { ...detail.draft, messages: { ...messages, day_before: { ...messages.day_before, message: "Bring two questions." } } };
    const second = await f.service.previewCadence(f.admin, revised);
    assert.match(second.previews.find(item => item.stage === "day_before").text, /Bring two questions/);
    assert.deepEqual((await f.rows(scope === "event" ? "plans" : "sequences"))[0].snapshot.messages, messages, "preview never silently updates the approved message");
    await f.service.activateCadence(f.admin, second.reviewToken);
    assert.deepEqual((await f.rows(scope === "event" ? "plans" : "sequences"))[0].snapshot.messages, revised.messages);
  }
});

test("overview exposes every future opportunity with honest pause/global states, without enqueueing", async t => {
  const f = await fixture(t); f.enable();
  const reviewed = await f.service.previewCadence(f.admin, f.draft);
  const plan = await f.service.activateCadence(f.admin, reviewed.reviewToken);
  let overview = await f.service.getCadenceOverview(f.admin);
  assert.deepEqual(overview.upcoming.map(item => item.stage), ["orientation", "one_week", "day_before", "day_of"]);
  assert.ok(overview.upcoming.every(item => item.planId === plan.id && item.eventId === f.event.id && item.status === "upcoming" && item.kind === "foundations_01" && item.track === "members"));
  assert.ok(overview.upcoming.every(item => item.timeZone === "America/Denver" && item.sequenceId === null));
  f.state.configuration.enabled = false;
  overview = await f.service.getCadenceOverview(f.admin);
  assert.equal(overview.upcoming.length, 4); assert.ok(overview.upcoming.every(item => item.status === "blocked" && /Global delivery/.test(item.attention)));
  await f.pg.query("update experiences set status='draft' where id=$1", [f.event.id]);
  assert.deepEqual((await f.service.getCadenceOverview(f.admin)).upcoming, [], "unpublished calls have no upcoming opportunities");
  await f.pg.query("update experiences set status='published',cancelled_at=clock_timestamp() where id=$1", [f.event.id]);
  assert.deepEqual((await f.service.getCadenceOverview(f.admin)).upcoming, [], "cancelled calls have no upcoming opportunities");
  await f.pg.query("update experiences set cancelled_at=null,starts_at=$2,ends_at=$3 where id=$1", [f.event.id,future(-1),future(-0.9)]);
  assert.deepEqual((await f.service.getCadenceOverview(f.admin)).upcoming, [], "past calls have no upcoming opportunities");
  await f.pg.query("update experiences set starts_at=$2,ends_at=$3 where id=$1", [f.event.id,f.event.startsAt,f.event.endsAt]);
  f.enable(); await f.service.pauseCadence(f.admin, plan.id, plan.revision);
  overview = await f.service.getCadenceOverview(f.admin);
  assert.equal(overview.upcoming.length, 4); assert.ok(overview.upcoming.every(item => item.status === "paused" && item.active === false));
  await f.pg.query("update private.member_email_cadence_plans set activated_at=$2 where id=$1", [plan.id, future(29.99)]);
  overview = await f.service.getCadenceOverview(f.admin);
  assert.deepEqual(overview.upcoming, []);
  assert.deepEqual(await f.rows("deliveries"), []);
});

test("overview activity groups recipients by call and stage and distinguishes provider acceptance from delivery", async t => {
  const f = await fixture(t); f.enable();
  const reviewed = await f.service.previewCadence(f.admin, f.draft);
  const plan = await f.service.activateCadence(f.admin, reviewed.reviewToken);
  const dueAt = future(29), expiresAt = future(29.01);
  for (const [stage, status] of [["day_before", "sent"], ["day_before", "failed"], ["day_before", "cancelled"], ["day_of", "sent"]]) {
    const member = crypto.randomUUID(); await f.pg.query("insert into ruined_members values($1)", [member]);
    await f.pg.query(`insert into private.member_email_cadence_deliveries
      (plan_id,plan_revision,experience_id,member_id,starts_at,stage,expected_email,expected_consent_id,due_at,expires_at,status,payload,last_error,provider_message_id)
      values($1,1,$2,$3,$4,$5,'private-person@example.com',21,$6,$7,$8,$9::jsonb,'secret-error','secret-provider-id')`,
      [plan.id,f.event.id,member,f.event.startsAt,stage,dueAt,expiresAt,status,JSON.stringify({private:"secret-payload"})]);
  }
  const before = await f.rows("deliveries");
  const overview = await f.service.getCadenceOverview(f.admin);
  assert.equal(overview.recentDeliveries.length, 2);
  const failed = overview.recentDeliveries.find(item => item.stage === "day_before");
  assert.equal(failed.status, "failed"); assert.equal(failed.recipientCount, 3);
  assert.deepEqual(failed.counts, { pending:0, sending:0, failed:1, sent:1, cancelled:1, manual_review:0 });
  assert.equal(failed.planId, plan.id); assert.equal(failed.kind, "foundations_01"); assert.equal(failed.track, "members");
  const accepted = overview.recentDeliveries.find(item => item.stage === "day_of");
  assert.equal(accepted.status, "sent"); assert.match(accepted.reason, /Accepted by the email provider; this is not proof of inbox delivery/);
  assert.doesNotMatch(JSON.stringify(overview), /private-person|secret-|payload|provider_message_id/);
  assert.deepEqual(await f.rows("deliveries"), before);
});
