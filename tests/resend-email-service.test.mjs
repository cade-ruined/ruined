import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as parse5 from "parse5";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

async function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}

const model = await load("src/lib/communications/admin-email-model.ts");
const templates = await load("src/lib/communications/resend-email-templates.ts", {
  parse5, "./admin-email-model": model,
});
const fixed = { segment: crypto.randomUUID(), topic: crypto.randomUUID(), template: crypto.randomUUID(), version: crypto.randomUUID() };
const unsubscribe = '<a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Manage preferences</a>';
const makeContact = (email, extra = {}) => ({ id: crypto.randomUUID(), email, first_name: "A", last_name: "Person", unsubscribed: false, ...extra });
const banner = { url: "https://assets.example.com/campaign-banner.jpg", alt: "A quiet moment & room", linkUrl: "https://example.com/stories/quiet-moment" };
function elements(html, tagName) {
  const found = [];
  function visit(node) {
    if (node.tagName === tagName) found.push(Object.fromEntries(node.attrs.map(({ name, value }) => [name, value])));
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse5.parse(html));
  return found;
}
function assertBanner(html) {
  const images = elements(html, "img");
  assert.equal(images.filter(image => image.src === "https://assets.example.test/exact.svg").length, 1, "the original logo remains intact");
  const banners = images.filter(image => image.src === banner.url);
  assert.equal(banners.length, 1);
  assert.equal(banners[0].alt, banner.alt);
  assert.ok(elements(html, "a").some(link => link.href === banner.linkUrl));
  assert.ok(html.indexOf("exact.svg") < html.indexOf("campaign-banner.jpg"));
  assert.ok(html.indexOf("campaign-banner.jpg") < html.indexOf("<h1"));
}

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks(), pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    create role anon; create role authenticated; create schema private;
    create table platform_users(auth_user_id uuid primary key,status text not null);
    create table platform_role_grants(auth_user_id uuid references platform_users,role_slug text,revoked_at timestamptz);
    create table operator_audit_events(id bigint generated always as identity,actor_auth_user_id uuid,action text,subject_type text,subject_id text,metadata jsonb);
  `);
  await pg.exec(await readFile(new URL("../db/migrations/20261008200000_resend_email_frontend.sql", import.meta.url), "utf8"));
  const admin = crypto.randomUUID(), guide = crypto.randomUUID(), other = crypto.randomUUID();
  await pg.query("insert into platform_users values($1,'active'),($2,'active'),($3,'active')", [admin, guide, other]);
  await pg.query("insert into platform_role_grants values($1,'ops_admin',null),($2,'guide',null),($3,'ops_admin',null)", [admin, guide, other]);
  const committedClaims = new Set(), faults = [];
  function wrap(client, claims = []) {
    const sql = async (strings, ...params) => {
      const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      const fault = faults.findIndex(pattern => query.includes(pattern));
      if (fault >= 0) { faults.splice(fault, 1); throw Error("injected database acknowledgement failure"); }
      const result = await client.query(query, params);
      if (query.includes("set status='sending'")) for (const row of result.rows) claims.push(row.id);
      return result.rows;
    };
    sql.begin = async callback => {
      const claims = [];
      const result = await client.transaction(tx => callback(wrap(tx, claims)));
      claims.forEach(id => committedClaims.add(id));
      return result;
    };
    return sql;
  }
  const db = wrap(pg);
  const repository = await load("src/lib/communications/admin-email-repository.ts", {
    "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => db }, "./admin-email-model": model,
  });
  const contact = makeContact("first@example.test");
  const state = {
    contacts: [contact], contactTopics: new Map([[contact.id, [{ id: fixed.topic, subscription: "opt_in" }]]]),
    suppressions: [], topicDefault: "opt_out", broadcasts: new Map(), requests: [], sends: [],
    sendFailure: null, getOverride: null,
    template: { id: fixed.template, name: "Existing Resend design", status: "published", current_version_id: fixed.version,
      subject: "A considered update", from: "Ruined <hello@example.test>", reply_to: ["support@example.test"],
      html: `<html><body><img src="https://assets.example.test/exact.svg"><p>Hello {{{NAME}}}</p>${unsubscribe}</body></html>`,
      text: null, variables: [{ key: "NAME", type: "string", fallback_value: "there" }], has_unpublished_versions: false },
  };
  async function mockFetch(url, options) {
    const parsed = new URL(url), path = parsed.pathname, method = options.method;
    assert.equal(parsed.origin, "https://api.resend.com", "the facade only talks to the provider API");
    assert.equal(options.headers.Authorization, "Bearer fake-test-resend-key");
    const body = options.body ? JSON.parse(options.body) : undefined;
    state.requests.push({ path, method, body, headers: options.headers, search: parsed.search });
    if (method === "GET" && state.getOverride) {
      const response = await state.getOverride(parsed);
      if (response) return response;
    }
    const page = data => Response.json({ object: "list", data, has_more: false });
    if (method === "GET") {
      if (path === `/templates/${fixed.template}`) return Response.json(state.template);
      if (path === "/templates") return page([state.template]);
      if (path === "/segments") return page([{ id: fixed.segment, name: "Members" }]);
      if (path === "/topics") return Response.json({ data: [{ id: fixed.topic, name: "Member updates", default_subscription: state.topicDefault }] });
      if (path === `/segments/${fixed.segment}`) return Response.json({ id: fixed.segment, name: "Members" });
      if (path === `/topics/${fixed.topic}`) return Response.json({ id: fixed.topic, name: "Member updates", default_subscription: state.topicDefault });
      if (path === `/segments/${fixed.segment}/contacts`) return page(state.contacts);
      if (path === "/suppressions") return page(state.suppressions);
      if (path === "/broadcasts") return page([...state.broadcasts.values()]);
      if (path === "/emails") return page([]);
      const topics = path.match(/^\/contacts\/([^/]+)\/topics$/);
      if (topics) return page(state.contactTopics.get(topics[1]) ?? []);
      const recipient = path.match(/^\/contacts\/([^/]+)$/);
      if (recipient) {
        const found = state.contacts.find(item => item.email === decodeURIComponent(recipient[1]));
        return found ? Response.json(found) : Response.json({ error: "not found" }, { status: 404 });
      }
      const broadcast = state.broadcasts.get(path.replace(/^\/broadcasts\//, ""));
      if (broadcast) return Response.json(broadcast);
    }
    if (method === "POST" && path === "/broadcasts") {
      const id = crypto.randomUUID();
      state.broadcasts.set(id, { id, ...body, status: "draft", reply_to: body.reply_to ?? [], created_at: new Date().toISOString(), scheduled_at: null, sent_at: null, preview_text: "" });
      return Response.json({ id });
    }
    if (method === "POST" && (path === "/emails" || /^\/broadcasts\/[^/]+\/send$/.test(path))) {
      const rows = await pg.query("select id,snapshot from admin_resend_reviews where status='sending'");
      const match = rows.rows.find(row => path === "/emails"
        ? options.headers["Idempotency-Key"] === `ruined-resend-review/${row.id}`
        : path === `/broadcasts/${row.snapshot.broadcastId}/send`);
      assert.ok(match, "a durable claim exists before sending");
      assert.ok(committedClaims.has(match.id), "the one-way claim committed before sending");
      state.sends.push({ path, body, key: options.headers["Idempotency-Key"], reviewId: match.id });
      if (state.sendFailure) return state.sendFailure();
      const id = path === "/emails" ? crypto.randomUUID() : path.split("/")[2];
      if (path !== "/emails") state.broadcasts.get(id).status = "queued";
      return Response.json({ id });
    }
    throw Error(`Unexpected mocked provider operation ${method} ${path}`);
  }
  const env = { RESEND_API_KEY: "fake-test-resend-key", ADMIN_EMAIL_SENDING_ENABLED: "true" };
  const service = await load("src/lib/communications/resend-email-service.ts", {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => db },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "./admin-email-model": model, "./admin-email-repository": repository, "./resend-email-templates": templates,
  }, { fetch: mockFetch, process: { env }, setTimeout: callback => setTimeout(callback, 0) });
  const input = { mode: "campaign", templateId: fixed.template, templateVersion: fixed.version,
    segmentId: fixed.segment, topicId: fixed.topic, name: "Native campaign", edits: { subject: "A considered update", values: {}, copy: {} } };
  async function campaign() {
    const saved = await service.saveResendBroadcast(admin, input);
    return service.reviewResendEmail(admin, { broadcastId: saved.id });
  }
  function individual() {
    state.template.html = '<html><body><p>Hello {{{NAME}}}</p><img src="https://assets.example.test/exact.svg"></body></html>';
    return { ...input, mode: "individual", recipients: [contact.email] };
  }
  return { pg, admin, guide, other, service, state, input, campaign, individual, env, faults };
}

test("manual email configuration does not depend on an OpenAI key or model", async t => {
  const f = await fixture(t);
  const withoutOpenAI = f.service.getResendEmailConfiguration();
  assert.deepEqual(withoutOpenAI, { connected: true, sendingReady: true, issues: [] });
  f.env.OPENAI_API_KEY = "unused-fixture-key";
  f.env.OPENAI_EMAIL_MODEL = "unused-fixture-model";
  assert.deepEqual(f.service.getResendEmailConfiguration(), withoutOpenAI);
  f.env.ADMIN_EMAIL_SENDING_ENABLED = "false";
  const disabled = f.service.getResendEmailConfiguration();
  assert.equal(disabled.connected, true);
  assert.equal(disabled.sendingReady, false);
  delete f.env.OPENAI_API_KEY;
  delete f.env.OPENAI_EMAIL_MODEL;
  assert.deepEqual(f.service.getResendEmailConfiguration(), disabled);
  assert.equal(f.state.requests.length, 0);
});

test("native workspace authorizes before provider access and rejects revoked administrators", async t => {
  const f = await fixture(t);
  for (const action of [() => f.service.getResendEmailOverview(f.guide), () => f.service.getResendEmailTemplate(f.guide, fixed.template),
    () => f.service.saveResendBroadcast(f.guide, f.input), () => f.service.reviewResendEmail(f.guide, f.input)]) {
    await assert.rejects(action(), error => error.status === 403);
  }
  assert.equal(f.state.requests.length, 0);
  const review = await f.campaign();
  await f.pg.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [f.admin]);
  await assert.rejects(f.service.sendResendEmail(f.admin, review.id), error => error.status === 403);
  assert.equal(f.state.sends.length, 0);
});

test("saving creates a real native draft with send false and leaves contacts/preferences untouched", async t => {
  const f = await fixture(t);
  const saved = await f.service.saveResendBroadcast(f.admin, f.input);
  const writes = f.state.requests.filter(item => item.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/broadcasts");
  assert.equal(writes[0].body.send, false);
  assert.equal(writes[0].body.segment_id, fixed.segment);
  assert.equal(writes[0].body.topic_id, fixed.topic);
  assert.match(writes[0].body.html, /https:\/\/assets.example.test\/exact.svg/);
  assert.match(writes[0].body.html, /Hello there/);
  assert.match(writes[0].body.html, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
  assert.equal(f.state.broadcasts.get(saved.id).status, "draft");
  assert.equal(f.state.sends.length, 0);
  assert.equal((await f.pg.query("select action from operator_audit_events")).rows[0].action, "resend_email.draft_created");
});

test("optional image banner reaches the native campaign draft and recipient review without replacing the logo", async t => {
  const f = await fixture(t);
  f.state.template.html = `<html><body><table><tr><td><img src="https://assets.example.test/exact.svg"><h1>A considered update</h1><p>Hello {{{NAME}}}</p>${unsubscribe}</td></tr></table></body></html>`;
  const saved = await f.service.saveResendBroadcast(f.admin, { ...f.input, edits: { ...f.input.edits, banner: { ...banner } } });
  const payload = f.state.requests.find(item => item.path === "/broadcasts" && item.method === "POST").body;
  assert.equal(payload.send, false);
  assertBanner(payload.html);
  assert.ok(payload.text.includes(banner.alt));
  assert.ok(payload.text.includes(banner.linkUrl));
  const review = await f.service.reviewResendEmail(f.admin, { broadcastId: saved.id });
  assert.equal(review.html, payload.html);
  assertBanner(review.html);
  assert.equal(f.state.sends.length, 0);
});

test("individual send keeps the reviewed image banner when later edits or provider template content change", async t => {
  const f = await fixture(t);
  const input = f.individual();
  f.state.template.html = '<html><body><table><tr><td><img src="https://assets.example.test/exact.svg"><h1>A considered update</h1><p>Hello {{{NAME}}}</p></td></tr></table></body></html>';
  input.edits = { ...input.edits, banner: { ...banner } };
  const review = await f.service.reviewResendEmail(f.admin, input);
  assertBanner(review.html);
  input.edits.banner.url = "https://assets.example.test/later-unreviewed-banner.jpg";
  f.state.template.html = "<p>New unreviewed provider content</p>";
  assert.equal((await f.service.sendResendEmail(f.admin, review.id)).status, "sent");
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.state.sends[0].body.html, review.html);
  assert.equal(f.state.sends[0].body.text, review.text);
  assert.ok(f.state.sends[0].body.text.includes(banner.alt));
  assert.ok(f.state.sends[0].body.text.includes(banner.linkUrl));
  assertBanner(f.state.sends[0].body.html);
  assert.doesNotMatch(f.state.sends[0].body.html, /later-unreviewed-banner|New unreviewed/);
});

test("provider template version changes invalidate preparation before native draft mutation", async t => {
  const f = await fixture(t);
  f.state.template.current_version_id = crypto.randomUUID();
  await assert.rejects(f.service.saveResendBroadcast(f.admin, f.input), error => error.status === 409);
  assert.equal(f.state.requests.filter(item => item.method !== "GET").length, 0);
});

test("campaign review combines explicit topic preference, topic default, global opt-out and suppression", async t => {
  const f = await fixture(t);
  const implicit = makeContact("implicit@example.test"), optedIn = makeContact("in@example.test"), optedOut = makeContact("out@example.test"),
    global = makeContact("global@example.test", { unsubscribed: true }), suppressed = makeContact("suppressed@example.test");
  f.state.contacts = [implicit, optedIn, optedOut, global, suppressed];
  f.state.contactTopics = new Map([[optedIn.id, [{ id: fixed.topic, subscription: "opt_in" }]], [optedOut.id, [{ id: fixed.topic, subscription: "opt_out" }]],
    [global.id, [{ id: fixed.topic, subscription: "opt_in" }]], [suppressed.id, [{ id: fixed.topic, subscription: "opt_in" }]]]);
  f.state.suppressions = [{ id: crypto.randomUUID(), email: suppressed.email }];
  f.state.topicDefault = "opt_in";
  const review = await f.campaign();
  assert.deepEqual(review.recipients.map(item => item.email), [implicit.email, optedIn.email]);
  assert.equal(review.excludedCount, 3);
  f.state.topicDefault = "opt_out";
  const optOutDefault = await f.service.reviewResendEmail(f.admin, { broadcastId: review.broadcastId });
  assert.deepEqual(optOutDefault.recipients.map(item => item.email), [optedIn.email]);
  assert.equal(f.state.sends.length, 0);
});

test("complete pagination includes later contacts and later topic preferences", async t => {
  const f = await fixture(t);
  const second = makeContact("second@example.test"), first = f.state.contacts[0], unrelated = crypto.randomUUID();
  f.state.contacts.push(second);
  f.state.getOverride = parsed => {
    if (parsed.pathname === `/segments/${fixed.segment}/contacts`) return Response.json({ data: [parsed.searchParams.has("after") ? second : first], has_more: !parsed.searchParams.has("after") });
    if (parsed.pathname === `/contacts/${second.id}/topics`) return Response.json({ data: [parsed.searchParams.has("after") ? { id: fixed.topic, subscription: "opt_in" } : { id: unrelated, subscription: "opt_out" }], has_more: !parsed.searchParams.has("after") });
  };
  const review = await f.campaign();
  assert.deepEqual(review.recipients.map(item => item.email), [first.email, second.email]);
});

test("partial, repeated, and failed provider pages never become a completed recipient review", async t => {
  const f = await fixture(t);
  const saved = await f.service.saveResendBroadcast(f.admin, f.input);
  for (const mode of ["malformed", "repeated", "failed"]) {
    f.state.getOverride = parsed => {
      if (parsed.pathname !== `/segments/${fixed.segment}/contacts`) return;
      if (mode === "malformed") return Response.json({ data: f.state.contacts });
      if (mode === "failed" && parsed.searchParams.has("after")) return Response.json({}, { status: 503 });
      return Response.json({ data: f.state.contacts, has_more: true });
    };
    await assert.rejects(f.service.reviewResendEmail(f.admin, { broadcastId: saved.id }), error => [502, 503].includes(error.status));
  }
  assert.equal((await f.pg.query("select count(*)::int as count from admin_resend_reviews")).rows[0].count, 0);
  assert.equal(f.state.sends.length, 0);
});

test("broadcast content and recipient changes after review block sending", async t => {
  const f = await fixture(t);
  const changed = await f.campaign();
  f.state.broadcasts.get(changed.broadcastId).subject = "Changed in Resend";
  await assert.rejects(f.service.sendResendEmail(f.admin, changed.id), error => error.status === 409);
  const recipientsChanged = await f.campaign();
  f.state.contactTopics.set(f.state.contacts[0].id, [{ id: fixed.topic, subscription: "opt_out" }]);
  await assert.rejects(f.service.sendResendEmail(f.admin, recipientsChanged.id), error => error.status === 409);
  assert.equal(f.state.sends.length, 0);
});

test("broadcast changes during the recipient recheck are detected before sending", async t => {
  const f = await fixture(t);
  const review = await f.campaign();
  f.state.getOverride = parsed => {
    if (parsed.pathname === `/contacts/${f.state.contacts[0].id}/topics`) {
      f.state.broadcasts.get(review.broadcastId).subject = "Changed while the audience was loading";
    }
  };
  await assert.rejects(f.service.sendResendEmail(f.admin, review.id), error => error.status === 409);
  assert.equal(f.state.sends.length, 0);
});

test("native campaign claim commits before sending and repeat submission never posts again", async t => {
  const f = await fixture(t);
  const review = await f.campaign();
  await assert.rejects(f.service.sendResendEmail(f.other, review.id), error => error.status === 404);
  const results = await Promise.all([f.service.sendResendEmail(f.admin, review.id), f.service.sendResendEmail(f.admin, review.id)]);
  assert.ok(results.some(result => result.status === "queued"));
  assert.equal(f.state.sends.length, 1);
  assert.equal((await f.service.sendResendEmail(f.admin, review.id)).status, "queued");
  assert.equal(f.state.sends.length, 1);
  await assert.rejects(f.pg.query("update admin_resend_reviews set status='reviewed' where id=$1", [review.id]), /immutable/);
  await assert.rejects(f.pg.query("update admin_resend_reviews set snapshot='{}' where id=$1", [review.id]), /immutable/);
});

test("two reviews of the same native broadcast cannot create two sends, even after uncertainty", async t => {
  const f = await fixture(t);
  const first = await f.campaign();
  const second = await f.service.reviewResendEmail(f.other, { broadcastId: first.broadcastId });
  f.state.sendFailure = () => { throw Error("connection lost after native broadcast acceptance"); };
  const results = await Promise.all([f.service.sendResendEmail(f.admin, first.id), f.service.sendResendEmail(f.other, second.id)]);
  assert.deepEqual(results.map(result => result.status), ["unknown", "unknown"]);
  assert.equal(f.state.sends.length, 1);
  const third = await f.service.reviewResendEmail(f.admin, { broadcastId: first.broadcastId });
  assert.equal((await f.service.sendResendEmail(f.admin, third.id)).status, "unknown");
  assert.equal(f.state.sends.length, 1);
  await assert.rejects(f.pg.query("update admin_resend_reviews set status='sending' where id=$1", [third.id]), /unique constraint/);
});

test("admin access revoked during provider checks blocks the committed send claim", async t => {
  const f = await fixture(t);
  const review = await f.campaign();
  f.state.getOverride = async parsed => {
    if (parsed.pathname === `/contacts/${f.state.contacts[0].id}/topics`) {
      await f.pg.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [f.admin]);
    }
  };
  await assert.rejects(f.service.sendResendEmail(f.admin, review.id), error => error.status === 403);
  assert.equal(f.state.sends.length, 0);
  assert.equal((await f.pg.query("select status from admin_resend_reviews where id=$1", [review.id])).rows[0].status, "reviewed");
});

test("individual send uses reviewed template bytes and a recipient-specific native idempotency key", async t => {
  const f = await fixture(t);
  const review = await f.service.reviewResendEmail(f.admin, f.individual());
  f.state.template.html = "<p>Template changed after review</p>";
  assert.equal((await f.service.sendResendEmail(f.admin, review.id)).status, "sent");
  assert.equal(f.state.sends[0].body.html, review.html);
  assert.deepEqual(f.state.sends[0].body.to, ["first@example.test"]);
  assert.equal(f.state.sends[0].key, `ruined-resend-review/${review.id}`);
  await f.service.sendResendEmail(f.admin, review.id);
  assert.equal(f.state.sends.length, 1);
});

test("uncertain provider response is one-way and does not permit automatic repeat sends", async t => {
  const f = await fixture(t);
  const review = await f.service.reviewResendEmail(f.admin, f.individual());
  f.state.sendFailure = () => { throw Error("connection lost after acceptance"); };
  assert.equal((await f.service.sendResendEmail(f.admin, review.id)).status, "unknown");
  assert.equal((await f.service.sendResendEmail(f.admin, review.id)).status, "unknown");
  assert.equal(f.state.sends.length, 1);
  assert.equal((await f.pg.query("select status from admin_resend_reviews where id=$1", [review.id])).rows[0].status, "unknown");
});

test("an explicit provider rejection requires a new review and releases only that broadcast claim", async t => {
  const f = await fixture(t);
  const review = await f.campaign();
  f.state.sendFailure = () => Response.json({ name: "validation_error", message: "Sender needs correction" }, { status: 422 });
  await assert.rejects(f.service.sendResendEmail(f.admin, review.id), error => error.status === 422);
  assert.equal((await f.pg.query("select status from admin_resend_reviews where id=$1", [review.id])).rows[0].status, "rejected");
  await assert.rejects(f.service.sendResendEmail(f.admin, review.id), error => error.status === 409);
  assert.equal(f.state.sends.length, 1);
  f.state.broadcasts.get(review.broadcastId).from = "Corrected <verified@example.test>";
  const corrected = await f.service.reviewResendEmail(f.admin, { broadcastId: review.broadcastId });
  f.state.sendFailure = null;
  assert.equal((await f.service.sendResendEmail(f.admin, corrected.id)).status, "queued");
  assert.equal(f.state.sends.length, 2);
});

test("database acknowledgement loss after accepted native send preserves the no-retry claim", async t => {
  const f = await fixture(t);
  const review = await f.service.reviewResendEmail(f.admin, f.individual());
  f.faults.push("set status='sent',provider_id");
  await assert.rejects(f.service.sendResendEmail(f.admin, review.id), /acknowledgement failure/);
  assert.equal((await f.service.sendResendEmail(f.admin, review.id)).status, "unknown");
  assert.equal(f.state.sends.length, 1);
});

test("disabled sending and provider opt-outs stop individual sends", async t => {
  const f = await fixture(t);
  const input = f.individual();
  const review = await f.service.reviewResendEmail(f.admin, input);
  f.env.ADMIN_EMAIL_SENDING_ENABLED = "false";
  await assert.rejects(f.service.sendResendEmail(f.admin, review.id), error => error.status === 503);
  f.env.ADMIN_EMAIL_SENDING_ENABLED = "true";
  f.state.contacts[0].unsubscribed = true;
  await assert.rejects(f.service.sendResendEmail(f.admin, review.id), error => error.status === 400);
  assert.equal(f.state.sends.length, 0);
});
