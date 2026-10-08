import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

async function load(path, dependencies = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const model = await load("src/lib/communications/admin-email-model.ts");
const canonical = await load("src/lib/communications/member-segment-sync.ts");
const content = { subject: "A note", preheader: "From Ruined", body: "Hello <script>alert(1)</script>\n\nSee you soon.",
  purpose: "marketing", audience: "updates", recipients: [] };

async function fixture(t) {
  const env = {
    ADMIN_EMAIL_SENDING_ENABLED: "true", RESEND_API_KEY: "test-fake-key", RESEND_FROM_EMAIL: "Ruined <hello@example.test>",
    NEXT_PUBLIC_SITE_URL: "https://members.example.test", RESEND_MARKETING_ENABLED: "true",
    RESEND_TOPIC_UPDATES_ID: crypto.randomUUID(), ADMIN_EMAIL_POSTAL_ADDRESS: "123 Example St, Test City", CRON_SECRET: "fake-cron",
  };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const PGlite = await loadPGliteForSchemaChecks(), pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    create role anon; create role authenticated; create schema private;
    create table platform_users(auth_user_id uuid primary key,status text not null);
    create table platform_role_grants(auth_user_id uuid references platform_users,role_slug text,revoked_at timestamptz);
    create table communication_contacts(id uuid primary key,email_normalized text unique,delivery_state text default 'active');
    create table communication_subscriptions(id uuid primary key,contact_id uuid references communication_contacts,
      channel text default 'email',topic text default 'about',status text default 'subscribed',consent_version text default 'test-v1',
      last_state_source text default 'about',version bigint default 1,unsubscribed_at timestamptz,state_changed_at timestamptz,updated_at timestamptz);
    create table communication_consent_events(id bigint generated always as identity,subscription_id uuid,decision text,consent_version text,source text,evidence jsonb);
    create table operator_audit_events(id bigint generated always as identity,actor_auth_user_id uuid,action text,subject_type text,subject_id text,metadata jsonb);
    create table integration_outbox(id bigint generated always as identity,destination text,event_type text,aggregate_type text,aggregate_id text,dedupe_key text unique,payload jsonb);
    create function public.ruined_reject_append_only_mutation() returns trigger language plpgsql as $$ begin raise exception 'append only'; end $$;
  `);
  await pg.exec(await readFile(new URL("../db/migrations/20261008180000_admin_email.sql", import.meta.url), "utf8"));
  const admin = crypto.randomUUID(), guide = crypto.randomUUID(), contact = crypto.randomUUID();
  await pg.query("insert into platform_users values($1,'active'),($2,'active')", [admin, guide]);
  await pg.query("insert into platform_role_grants values($1,'ops_admin',null),($2,'guide',null)", [admin, guide]);
  await pg.query("insert into communication_contacts(id,email_normalized) values($1,'member@example.test')", [contact]);
  await pg.query("insert into communication_subscriptions(id,contact_id) values($1,$2)", [crypto.randomUUID(), contact]);
  const memberSources = [{ email: "member@example.test", name: "Member", account_eligible: true, verified_identity: true,
    profile_complete: true, registration_hold: true, registered: true, registration_ready: true, real_registration: true,
    profile_open: false, real_existing_access: false, delivery_eligible: true }];
  const sends = [], responses = [], commitHooks = [], faults = [];
  const committedFences = new Set();
  let currentDelivery;
  function wrap(client, transactionFences = []) {
    const tag = async (strings, ...params) => {
      const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      const fault = faults.findIndex(pattern => query.includes(pattern));
      if (fault >= 0) { faults.splice(fault, 1); throw Error("injected database error"); }
      const result = await client.query(query, params);
      if (query.includes("select delivery.*,draft")) currentDelivery = result.rows[0];
      if (query.includes("set first_send_attempt_at=coalesce")) transactionFences.push(params.at(-1));
      return result.rows;
    };
    tag.begin = async callback => {
      const fences = [];
      const result = await client.transaction(tx => callback(wrap(tx, fences)));
      for (const id of fences) committedFences.add(id);
      const hook = commitHooks.shift(); if (hook) await hook();
      return result;
    };
    return tag;
  }
  const config = await load("src/lib/communications/admin-email-config.ts", {
    "server-only": {}, "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "./admin-email-model": model,
  });
  const repository = await load("src/lib/communications/admin-email-repository.ts", {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => wrap(pg) },
    "./member-segment-sync": { readMemberSegmentSource: async () => memberSources, classifyMemberSegment: canonical.classifyMemberSegment },
    "./admin-email-model": model, "./admin-email-config": config,
  });
  const provider = { globallyUnsubscribed: false, subscribed: true, missing: false, preferenceError: false, onContact: null };
  const worker = await load("src/lib/communications/admin-email-delivery.ts", {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => wrap(pg) },
    "@/lib/support/model": { SUPPORT_EMAIL: "connect@example.test" }, "./admin-email-model": model,
    "./admin-email-config": config, "./admin-email-repository": repository,
    resend: { Resend: class {
      contacts = {
        get: async () => { provider.onContact?.(); return provider.missing ? { error: { statusCode: 404 } }
          : provider.preferenceError ? { error: { statusCode: 503 } }
            : { data: { unsubscribed: provider.globallyUnsubscribed } }; },
        topics: { list: async () => ({ data: { data: [{ id: env.RESEND_TOPIC_UPDATES_ID, subscription: provider.subscribed ? "opt_in" : "opt_out" }] } }) },
      };
      emails = { send: async (payload, options) => {
        assert.ok(currentDelivery.first_send_attempt_at, "uncertainty fence exists");
        assert.ok(committedFences.has(currentDelivery.id), "fence committed before network send");
        assert.deepEqual(payload, currentDelivery.delivery_payload, "exact payload frozen before sending");
        sends.push({ payload, options });
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response ?? { data: { id: `provider-${sends.length}` } };
      } };
    } },
  });
  async function queued(overrides = {}) {
    const draft = await repository.saveAdminEmailDraft({ actorAuthUserId: admin, ...content, ...overrides });
    const review = await repository.previewAdminEmailDraft({ actorAuthUserId: admin, draftId: draft.id, expectedVersion: draft.version });
    const input = { actorAuthUserId: admin, draftId: draft.id, expectedVersion: draft.version, recipientHash: review.recipientHash, recipientCount: review.recipientCount };
    return { draft: await repository.queueAdminEmailDraft(input), review, input };
  }
  return { pg, admin, guide, contact, memberSources, repository, worker, config, provider, sends, responses, faults, queued };
}

test("draft validation rejects injection and renderer escapes authored text with marketing footer", () => {
  assert.throws(() => model.normalizeAdminEmailContent({ ...content, subject: "A\r\nBcc: others@example.test" }), /subject/);
  assert.throws(() => model.normalizeAdminEmailContent({ ...content, purpose: "service" }), /marketing consent/);
  assert.throws(() => model.normalizeAdminEmailContent({ ...content, body: "a".repeat(12_001) }), /12,000/);
  const message = model.renderAdminEmail(content, "https://example.test/unsubscribe?token=abc", "123 Example St");
  assert.doesNotMatch(message.html, /<script>/);
  assert.match(message.html, /&lt;script&gt;/);
  assert.match(message.html, /123 Example St/);
  assert.match(message.text, /Unsubscribe from Ruined updates/);
});

test("admin grants authorize every repository operation and generation limit persists", async t => {
  const f = await fixture(t);
  await assert.rejects(f.repository.getAdminEmailCenter(f.guide), error => error.status === 403);
  await assert.rejects(f.repository.saveAdminEmailDraft({ actorAuthUserId: f.guide, ...content }), error => error.status === 403);
  for (let i = 0; i < 30; i++) assert.equal(await f.repository.consumeAdminEmailGeneration(f.admin), true);
  assert.equal(await f.repository.consumeAdminEmailGeneration(f.admin), false);
  await f.pg.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [f.admin]);
  await assert.rejects(f.repository.assertAdminEmailAccess(f.admin), error => error.status === 403);
});

test("review binds exact version and recipients; queued replay returns one immutable delivery", async t => {
  const f = await fixture(t);
  const draft = await f.repository.saveAdminEmailDraft({ actorAuthUserId: f.admin, ...content });
  const review = await f.repository.previewAdminEmailDraft({ actorAuthUserId: f.admin, draftId: draft.id, expectedVersion: 1 });
  const updated = await f.repository.saveAdminEmailDraft({ actorAuthUserId: f.admin, draftId: draft.id, expectedVersion: 1, ...content, body: "Edited" });
  await assert.rejects(f.repository.queueAdminEmailDraft({ actorAuthUserId: f.admin, draftId: draft.id, expectedVersion: 1, recipientHash: review.recipientHash, recipientCount: 1 }), error => error.status === 409);
  assert.equal(updated.version, 2);
  const q = await f.queued();
  assert.equal((await f.repository.queueAdminEmailDraft(q.input)).id, q.draft.id);
  assert.equal((await f.pg.query("select count(*)::int as count from admin_email_deliveries")).rows[0].count, 1);
  await assert.rejects(f.pg.query("update admin_email_drafts set body='Changed' where id=$1", [q.draft.id]), /immutable/);
});

test("consent changing after preview blocks queue; service individuals require canonical membership", async t => {
  const f = await fixture(t);
  const draft = await f.repository.saveAdminEmailDraft({ actorAuthUserId: f.admin, ...content });
  const review = await f.repository.previewAdminEmailDraft({ actorAuthUserId: f.admin, draftId: draft.id, expectedVersion: 1 });
  await f.pg.exec("update communication_subscriptions set status='unsubscribed'");
  await assert.rejects(f.repository.queueAdminEmailDraft({ actorAuthUserId: f.admin, draftId: draft.id, expectedVersion: 1, recipientHash: review.recipientHash, recipientCount: 1 }), error => error.status === 409);
  const direct = await f.repository.saveAdminEmailDraft({ actorAuthUserId: f.admin, ...content, purpose: "service", audience: "individual", recipients: ["member@example.test", "stranger@example.test"] });
  const directReview = await f.repository.previewAdminEmailDraft({ actorAuthUserId: f.admin, draftId: direct.id, expectedVersion: 1 });
  assert.deepEqual(directReview.recipients.map(recipient => recipient.email), ["member@example.test"]);
  assert.equal(directReview.excludedCount, 1);
  f.memberSources[0].registered = false;
  const excluded = await f.repository.previewAdminEmailDraft({ actorAuthUserId: f.admin, draftId: direct.id, expectedVersion: 1 });
  assert.equal(excluded.recipientCount, 0);
});

test("configuration gates queue and worker; marketing postal address and cron required", async t => {
  const f = await fixture(t);
  delete process.env.CRON_SECRET;
  assert.equal(f.config.getAdminEmailDeliveryConfiguration().ready, false);
  await assert.rejects(f.queued(), error => error.status === 503);
  assert.equal((await f.worker.processAdminEmailBatch()).claimed, 0);
  process.env.CRON_SECRET = "fake";
  delete process.env.ADMIN_EMAIL_POSTAL_ADDRESS;
  assert.equal(f.config.getAdminEmailDeliveryConfiguration().ready, true);
  assert.equal(f.config.getAdminEmailDeliveryConfiguration().marketingReady, false);
  await assert.rejects(f.queued(), error => error.status === 503);
});

test("worker freezes bytes, sends once, records history, and adds secure unsubscribe headers", async t => {
  const f = await fixture(t);
  const q = await f.queued();
  const result = await f.worker.processAdminEmailBatch();
  assert.equal(result.sent, 1);
  assert.equal(f.sends.length, 1);
  assert.equal((await f.worker.processAdminEmailBatch()).claimed, 0);
  assert.match(f.sends[0].payload.headers["List-Unsubscribe"], /https:\/\/members.example.test\/api\/communications\/unsubscribe\?token=/);
  assert.equal(f.sends[0].payload.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const history = await f.pg.query("select status from admin_email_delivery_events order by id");
  assert.deepEqual(history.rows.map(row => row.status), ["pending", "sending", "sent"]);
  assert.equal((await f.repository.getAdminEmailCenter(f.admin)).drafts.find(item => item.id === q.draft.id).deliveryCounts.sent, 1);
});

test("worker skips revoked local/provider consent without sending or inventing consent", async t => {
  const f = await fixture(t);
  await f.queued();
  f.provider.globallyUnsubscribed = true;
  assert.equal((await f.worker.processAdminEmailBatch()).skipped, 1);
  assert.equal(f.sends.length, 0);
  f.provider.globallyUnsubscribed = false;
  await f.queued();
  await f.pg.exec("update communication_subscriptions set status='unsubscribed'");
  assert.equal((await f.worker.processAdminEmailBatch()).skipped, 1);
  assert.equal(f.sends.length, 0);
});

test("uncertain transport retries identical key and payload; expired fence never resends", async t => {
  const f = await fixture(t);
  await f.queued();
  f.responses.push(new Error("transport lost after provider acceptance"));
  assert.equal((await f.worker.processAdminEmailBatch()).failed, 1);
  process.env.RESEND_FROM_EMAIL = "Other <other@example.test>";
  await f.pg.exec("update admin_email_deliveries set available_at=now()");
  assert.equal((await f.worker.processAdminEmailBatch()).sent, 1);
  assert.deepEqual(f.sends[0], f.sends[1]);
  await f.queued();
  await f.pg.exec("update admin_email_deliveries set first_send_attempt_at=now()-interval '24 hours',attempts=1 where status='pending'");
  assert.equal((await f.worker.processAdminEmailBatch()).manualReview, 1);
  assert.equal(f.sends.length, 2);
});

test("uncertain accepted send followed by unsubscribe remains manual review, not not-sent", async t => {
  const f = await fixture(t);
  await f.queued();
  f.responses.push(new Error("acceptance acknowledgement lost"));
  await f.worker.processAdminEmailBatch();
  await f.pg.exec("update admin_email_deliveries set available_at=now(); update communication_subscriptions set status='unsubscribed'");
  assert.equal((await f.worker.processAdminEmailBatch()).manualReview, 1);
  assert.equal(f.sends.length, 1);
});

test("successful send followed by DB acknowledgement loss safely reuses committed fence", async t => {
  const f = await fixture(t);
  await f.queued();
  f.faults.push("set status='sent',provider_email_id");
  assert.equal((await f.worker.processAdminEmailBatch()).failed, 1);
  await f.pg.exec("update admin_email_deliveries set available_at=now()");
  assert.equal((await f.worker.processAdminEmailBatch()).sent, 1);
  assert.deepEqual(f.sends[0], f.sends[1]);
});

test("unsubscribe revokes locally, queues provider sync, and survives re-consent using same permanent link", async t => {
  const f = await fixture(t);
  await f.queued();
  const token = (await f.pg.query("select unsubscribe_token from admin_email_deliveries")).rows[0].unsubscribe_token;
  assert.equal(await f.repository.unsubscribeAdminEmail("invalid"), false);
  assert.equal(await f.repository.unsubscribeAdminEmail(token), true);
  assert.equal(await f.repository.unsubscribeAdminEmail(token), true);
  assert.equal((await f.pg.query("select count(*)::int as count from integration_outbox")).rows[0].count, 1);
  await f.pg.exec("update communication_subscriptions set status='subscribed',version=version+1");
  assert.equal(await f.repository.unsubscribeAdminEmail(token), true);
  assert.equal((await f.pg.query("select count(*)::int as count from integration_outbox")).rows[0].count, 2);
  assert.equal((await f.pg.query("select status from communication_subscriptions")).rows[0].status, "unsubscribed");
});

test("service delivery does not enroll marketing or require a provider contact", async t => {
  const f = await fixture(t);
  await f.pg.exec("update communication_subscriptions set status='unsubscribed'");
  await f.queued({ purpose: "service", audience: "individual", recipients: ["member@example.test"] });
  f.provider.missing = true;
  assert.equal((await f.worker.processAdminEmailBatch()).sent, 1);
  assert.equal(f.sends[0].payload.headers, undefined);
  assert.equal((await f.pg.query("select status from communication_subscriptions")).rows[0].status, "unsubscribed");
});

test("revoked admin and provider topic opt-out prevent pristine deliveries", async t => {
  const f = await fixture(t);
  await f.queued();
  f.provider.subscribed = false;
  assert.equal((await f.worker.processAdminEmailBatch()).skipped, 1);
  f.provider.subscribed = true;
  await f.queued();
  await f.pg.query("update platform_users set status='suspended' where auth_user_id=$1", [f.admin]);
  assert.equal((await f.worker.processAdminEmailBatch()).skipped, 1);
  assert.equal(f.sends.length, 0);
});

test("live worker leases are not stolen and expired uncertainty becomes manual review", async t => {
  const f = await fixture(t);
  await f.queued();
  await f.pg.query("update admin_email_deliveries set status='sending',locked_at=now(),lock_token=$1,attempts=1,first_send_attempt_at=now()-interval '24 hours'", [crypto.randomUUID()]);
  assert.equal((await f.worker.processAdminEmailBatch()).claimed, 0);
  await f.pg.exec("update admin_email_deliveries set locked_at=now()-interval '6 minutes'");
  assert.equal((await f.worker.processAdminEmailBatch()).manualReview, 1);
  assert.equal(f.sends.length, 0);
});

test("absolute batch deadline stops further provider calls before send", async t => {
  const f = await fixture(t);
  await f.queued();
  const actualNow = Date.now.bind(Date);
  let offset = 0;
  t.mock.method(Date, "now", () => actualNow() + offset);
  f.provider.onContact = () => { offset = 16_000; };
  const result = await f.worker.processAdminEmailBatch();
  assert.equal(result.failed, 1);
  assert.equal(f.sends.length, 0);
  assert.equal((await f.pg.query("select last_error from admin_email_deliveries")).rows[0].last_error, "delivery_budget");
});
