import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { NextResponse } from "next/server.js";
import React from "react";
import ts from "typescript";
import { json, serializeJsonBindings } from "./helpers/postgres-json-bindings.mjs";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const model = load("src/lib/membership/member-communication-preferences-model.ts");
const preferences = load("src/lib/membership/member-communication-preferences.ts", { "server-only": {}, "node:crypto": crypto, "./member-communication-preferences-model": model });
function bridge(client) {
  const sql = async (strings, ...values) => (await client.query(strings.reduce((query, part, index) => query + (index ? `$${index}` : "") + part, ""), serializeJsonBindings(strings, values))).rows;
  sql.json = json; sql.begin = callback => client.transaction(tx => callback(bridge(tx))); return sql;
}
async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`create table people(id uuid primary key,status text);
    create table ruined_members(id uuid primary key,person_id uuid,email_normalized text,deleted_at timestamptz);
    create table platform_users(auth_user_id uuid primary key,person_id uuid,member_id uuid,email_normalized text,status text);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table person_private_profiles(person_id uuid primary key,mobile_e164 text);
    create table person_email_addresses(person_id uuid,email_normalized text,verification_state text,retired_at timestamptz);
    create table member_consents(id bigint generated always as identity primary key,member_id uuid,consent_type text,
      policy_version text,decision text,accepted_at timestamptz,source text,actor_auth_user_id uuid,evidence jsonb check(jsonb_typeof(evidence)='object'),dedupe_key text unique);`);
  const member = { memberId: crypto.randomUUID(), personId: crypto.randomUUID(), authUserId: crypto.randomUUID(), email: "member@example.com", phone: "+12025550123" };
  await pg.query("insert into people values($1,'active')", [member.personId]);
  await pg.query("insert into ruined_members values($1,$2,$3,null)", [member.memberId, member.personId, member.email]);
  await pg.query("insert into platform_users values($1,$2,$3,$4,'active')", [member.authUserId, member.personId, member.memberId, member.email]);
  await pg.query("insert into platform_role_grants values($1,'member',null)", [member.authUserId]);
  await pg.query("insert into person_private_profiles values($1,$2)", [member.personId, member.phone]);
  await pg.query("insert into person_email_addresses values($1,$2,'verified',null)", [member.personId, member.email]);
  const sql = bridge(pg);
  const service = load("src/lib/membership/member-email-preferences-service.ts", {
    "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => sql },
    "./member-communication-preferences": preferences, "./member-communication-preferences-model": model,
  });
  const state = { viewer: { authUserId: member.authUserId }, mode: "connected", logs: [], fail: false };
  const origin = load("src/lib/auth/request.ts", {}, { process: { env: { NODE_ENV: "production" } } });
  const route = load("app/api/my/communication-preferences/route.ts", {
    "next/server": { NextResponse }, "@/lib/auth/request": origin,
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => state.viewer },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: state.mode }) },
    "@/lib/membership/member-communication-preferences": preferences,
    "@/lib/membership/member-email-preferences-service": {
      getMemberEmailPreference: actor => { if (state.fail) throw Error("private-credential"); return service.getMemberEmailPreference(actor); },
      saveMemberEmailPreference: service.saveMemberEmailPreference,
    },
  }, { console: { error: (...args) => state.logs.push(args) } });
  const url = "https://members.example.com/api/my/communication-preferences";
  const get = () => service.getMemberEmailPreference(member.authUserId);
  const input = async email => ({ email, expectedRevision: (await get()).revision, noticeVersion: model.MEMBER_COMMUNICATION_NOTICE_VERSION });
  const save = value => service.saveMemberEmailPreference(member.authUserId, value);
  const rows = async () => (await pg.query("select * from member_consents order by id")).rows;
  const patch = (body, headers = {}) => route.PATCH(new Request(url, { method: "PATCH", headers: { Origin: "https://members.example.com", "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
  async function reset() {
    await pg.exec("truncate member_consents; update people set status='active'; update platform_users set status='active'; update platform_role_grants set revoked_at=null; update ruined_members set deleted_at=null; update person_email_addresses set verification_state='verified',retired_at=null;");
    await pg.query("update platform_users set email_normalized=$1", [member.email]);
    await pg.query("update person_private_profiles set mobile_e164=$1", [member.phone]);
    Object.assign(state, { viewer: { authUserId: member.authUserId }, mode: "connected", logs: [], fail: false });
  }
  return { pg, sql, member, state, service, route, url, get, input, save, rows, patch, reset };
}

test("member email preference saves only explicit email decisions, preserving all SMS evidence", async t => {
  const f = await fixture(t);
  await t.test("unknown stays null until an explicit save and exact retries append only one email row", async () => {
    const initial = await f.get(); assert.equal(initial.email, null); assert.deepEqual(Object.keys(initial).sort(), ["email", "noticeVersion", "revision"]);
    assert.equal((await f.rows()).length, 0);
    const input = await f.input(true); await f.save(input); await f.save(input);
    assert.equal((await f.get()).email, true);
    const rows = await f.rows(); assert.equal(rows.length, 1);
    assert.equal(rows[0].evidence.channel, "email"); assert.equal(rows[0].source, "member"); assert.equal(rows[0].actor_auth_user_id, f.member.authUserId);
    assert.equal(rows[0].evidence.destination, f.member.email); assert.equal(rows[0].evidence.requested, true);
    assert.equal(rows[0].evidence.emailDefaultMayBePreselected, false); assert.equal(rows[0].evidence.marketingConsent, false);
    assert.equal(rows[0].evidence.action, "email_preference_on_at_submission");
  });
  await t.test("existing accepted, withdrawn, stale and never-selected SMS choices remain byte-for-byte unchanged", async () => {
    for (const decision of [null, "accepted", "withdrawn", "legacy"]) {
      await f.reset();
      if (decision) await f.pg.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence,dedupe_key)
        values($1,'communications',$2,$3,clock_timestamp(),'member',$4,$5,'existing-sms')`, [f.member.memberId,
        decision === "legacy" ? "old-policy" : model.MEMBER_COMMUNICATION_NOTICE_VERSION, decision === "withdrawn" ? "withdrawn" : "accepted", f.member.authUserId,
        JSON.stringify({ context: "member_communication_preferences_v1", purpose: "membership_updates", channel: "sms", destination: f.member.phone,
          action: "sms_checkbox_checked", requested: true, marketingConsent: false, termsVersion: model.MEMBER_SMS_TERMS_VERSION })]);
      const sms = (await f.rows()).filter(row => row.evidence.channel === "sms");
      await f.save(await f.input(true)); await f.save(await f.input(false));
      assert.deepEqual((await f.rows()).filter(row => row.evidence.channel === "sms"), sms);
      assert.equal((await f.pg.query("select mobile_e164 from person_private_profiles")).rows[0].mobile_e164, f.member.phone);
    }
  });
  await t.test("a phone is not required and email writes cannot introduce a text choice", async () => {
    await f.reset(); await f.pg.exec("update person_private_profiles set mobile_e164=null");
    await f.save(await f.input(false)); assert.equal((await f.get()).email, false);
    assert.deepEqual((await f.rows()).map(row => row.evidence.channel), ["email"]);
  });
  await t.test("legacy or operator-entered email acceptance displays off and can be repaired by a genuine member choice", async () => {
    for (const change of [{ source: "operator" }, { actor: null }, { requested: undefined }, { marketingConsent: true }]) {
      await f.reset();
      const evidence = { context: "member_communication_preferences_v1", purpose: "membership_updates", channel: "email", destination: f.member.email,
        requested: Object.hasOwn(change, "requested") ? change.requested : true, marketingConsent: change.marketingConsent ?? false };
      await f.pg.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence,dedupe_key)
        values($1,'communications',$2,'accepted',clock_timestamp(),$3,$4,$5,'legacy-email')`,
      [f.member.memberId, model.MEMBER_COMMUNICATION_NOTICE_VERSION, change.source ?? "member", Object.hasOwn(change, "actor") ? change.actor : f.member.authUserId, JSON.stringify(evidence)]);
      assert.equal((await f.get()).email, false);
      const original = (await f.rows())[0];
      await f.save(await f.input(true));
      assert.equal((await f.get()).email, true);
      const rows = await f.rows(); assert.equal(rows.length, 2); assert.deepEqual(rows[0], original);
      assert.equal(rows[1].source, "member"); assert.equal(rows[1].actor_auth_user_id, f.member.authUserId);
      assert.equal(rows[1].evidence.requested, true); assert.equal(rows[1].evidence.marketingConsent, false);
      assert.ok(rows.every(row => row.evidence.channel === "email"));
    }
  });
  await t.test("stale forms cannot restore a withdrawal and changed disclosure cannot be accepted silently", async () => {
    await f.reset(); const first = await f.input(true); await f.save(first); const stale = await f.input(true);
    await f.save(await f.input(false)); await assert.rejects(f.save(stale), error => error.code === "communication_preferences_changed");
    await assert.rejects(f.save(first), error => error.code === "communication_preferences_changed");
    await assert.rejects(f.save({ ...await f.input(true), noticeVersion: "old" }), error => error.code === "communication_notice_changed");
    assert.equal((await f.get()).email, false);
  });
  await t.test("verified current email, active identity and member role are rechecked; client identity and SMS fields are rejected", async () => {
    for (const mutation of ["update platform_role_grants set revoked_at=clock_timestamp()", "update platform_users set status='disabled'", "update people set status='inactive'", "update ruined_members set deleted_at=clock_timestamp()", "update person_email_addresses set verification_state='pending'", "update platform_users set email_normalized='other@example.com'"]) {
      await f.reset(); const input = await f.input(false); await f.pg.exec(mutation);
      await assert.rejects(f.save(input), error => error.status === 403);
      assert.equal((await f.rows()).length, 0);
    }
    await f.reset(); const input = await f.input(true);
    for (const extra of [{ sms: true }, { memberId: crypto.randomUUID() }, { phone: "+12025559999" }, { email: "true" }]) assert.throws(() => f.save({ ...input, ...extra }), error => error.status === 400);
    await assert.rejects(f.service.getMemberEmailPreference(crypto.randomUUID()), error => error.status === 403);
  });
  await t.test("route requires session, connected mode and same origin before reading a bounded PATCH body", async () => {
    await f.reset(); const input = await f.input(true);
    f.state.viewer = null; assert.equal((await f.route.GET(new Request(f.url))).status, 401); assert.equal((await f.patch(input)).status, 401);
    f.state.viewer = { authUserId: f.member.authUserId }; f.state.mode = "preview"; assert.equal((await f.patch(input)).status, 503);
    f.state.mode = "connected"; assert.equal((await f.patch(input, { Origin: "https://attacker.example" })).status, 403);
    assert.equal((await f.patch(input, { "Content-Type": "text/plain" })).status, 415);
    assert.equal((await f.patch("{bad")).status, 400);
    assert.equal((await f.patch(JSON.stringify({ junk: "x".repeat(5000) }), { "Content-Length": "1" })).status, 413);
    assert.equal((await f.rows()).length, 0);
    const saved = await f.patch(input); assert.equal(saved.status, 200); assert.equal(saved.headers.get("Cache-Control"), "no-store"); assert.equal((await saved.json()).email, true);
    const current = await f.route.GET(new Request(f.url)); assert.equal(current.status, 200); assert.equal((await current.json()).email, true);
    f.state.fail = true; const failed = await f.route.GET(new Request(f.url)); assert.equal(failed.status, 503);
    assert.doesNotMatch(JSON.stringify(await failed.json()) + JSON.stringify(f.state.logs), /private-credential/);
  });
});

const nodes = node => node == null || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);

test("Account recognizes only explicitly audited admin email preferences and preserves member control", async t => {
  const f = await fixture(t), operatorId = crypto.randomUUID();
  async function adminPreference(options = {}) {
    const evidence = { context: "member_communication_preferences_v1", purpose: "membership_updates", channel: "email", destination: f.member.email,
      requested: true, marketingConsent: false, action: "operator_email_preference_enabled", operatorApproved: true,
      memberAffirmed: false, approvalReference: "Approved founder preferences 2026-10-13", ...options.evidence };
    await f.pg.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence)
      values($1,'communications',$2,'accepted',clock_timestamp(),$3,$4,$5)`, [f.member.memberId, model.MEMBER_COMMUNICATION_NOTICE_VERSION,
      options.source ?? "ops", Object.hasOwn(options, "actor") ? options.actor : operatorId, JSON.stringify(evidence)]);
  }
  await t.test("incomplete approval, legacy sources, missing actor and stale destinations remain off", async () => {
    for (const options of [
      { evidence: { action: undefined } }, { evidence: { action: "email_preference_on_at_submission" } },
      { evidence: { operatorApproved: undefined } }, { evidence: { operatorApproved: false } },
      { evidence: { memberAffirmed: undefined } }, { evidence: { memberAffirmed: true } },
      ...[undefined, "", " \t\r\n ", null, 123, { approved: true }].map(approvalReference => ({ evidence: { approvalReference } })),
      { evidence: { requested: false } }, { evidence: { requested: undefined } },
      { evidence: { marketingConsent: true } }, { evidence: { marketingConsent: undefined } },
      ...["operator", "migration", "checkout"].map(source => ({ source })),
      { actor: null }, { evidence: { destination: "prior@example.com" } },
    ]) {
      await f.reset(); await adminPreference(options);
      assert.equal((await f.get()).email, false, JSON.stringify(options));
    }
  });
  await t.test("approved admin preferences display on without fabricating member affirmation; later withdrawal wins and SMS stays unchanged", async () => {
    await f.reset();
    await f.pg.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence)
      values($1,'communications',$2,'accepted',clock_timestamp(),'member',$3,$4)`, [f.member.memberId, model.MEMBER_COMMUNICATION_NOTICE_VERSION, f.member.authUserId,
      JSON.stringify({ context: "member_communication_preferences_v1", purpose: "membership_updates", channel: "sms", destination: f.member.phone,
        action: "sms_checkbox_checked", requested: true, marketingConsent: false, termsVersion: model.MEMBER_SMS_TERMS_VERSION })]);
    const sms = (await f.rows()).filter(row => row.evidence.channel === "sms");
    await adminPreference();
    const accepted = (await f.rows()).find(row => row.evidence.channel === "email");
    assert.equal((await f.get()).email, true);
    assert.equal((await (await f.route.GET(new Request(f.url))).json()).email, true);
    await f.save(await f.input(true));
    assert.equal((await f.rows()).length, 2, "an unchanged choice does not relabel admin approval as member affirmation");
    const stale = await f.input(true);
    await f.save(await f.input(false));
    assert.equal((await f.get()).email, false);
    await assert.rejects(f.save(stale), error => error.code === "communication_preferences_changed");
    const rows = await f.rows();
    assert.deepEqual(rows.find(row => row.id === accepted.id), accepted);
    assert.equal(rows.at(-1).source, "member"); assert.equal(rows.at(-1).decision, "withdrawn");
    assert.deepEqual(rows.filter(row => row.evidence.channel === "sms"), sms);
    assert.equal((await preferences.getMemberCommunicationPreferences(f.sql, f.member.memberId, { email: f.member.email, phone: f.member.phone })).sms, true);
    assert.equal((await f.pg.query("select mobile_e164 from person_private_profiles")).rows[0].mobile_e164, f.member.phone);
  });
});

function ui({ preview = false, initialEmail = null, response } = {}) {
  const slots = [], effects = [], calls = []; let cursor = 0, changed = false;
  const hooks = { ...React,
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { const value = typeof next === "function" ? next(slots[i]) : next; changed ||= value !== slots[i]; slots[i] = value; }]; },
    useEffect(effect, dependencies) { const i = cursor++; if (!slots[i] || dependencies.some((value, index) => value !== slots[i].dependencies[index])) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { dependencies, cleanup: effect() }; }); },
  };
  const Component = load("src/components/membership/MemberEmailPreferences.tsx", { react: hooks,
    "@/components/support/supportStyles": { SUPPORT_ACTION_CLASS: "member-action" }, "@/lib/membership/member-communication-preferences-model": model,
  }, { fetch: async (url, options) => { calls.push({ url, ...options }); return response ? response(calls.at(-1)) : Response.json({ email: options.method === "PATCH" ? JSON.parse(options.body).email : initialEmail, revision: "a".repeat(64), noticeVersion: model.MEMBER_COMMUNICATION_NOTICE_VERSION }); } }).default;
  function draw() { for (let i = 0; i < 10; i++) { cursor = 0; changed = false; const tree = Component({ preview }); effects.splice(0).forEach(effect => effect()); if (!changed) return tree; } throw Error("Unstable render"); }
  const find = predicate => nodes(draw()).find(predicate);
  return { draw, find, calls, settle: async () => { await new Promise(resolve => setImmediate(resolve)); return draw(); },
    change(value) { find(node => node.type === "input").props.onChange({ currentTarget: { checked: value } }); },
    submit: () => find(node => node.type === "form").props.onSubmit({ preventDefault() {} }),
  };
}
test("member checkbox starts unchecked, saves only on explicit submit and preview never reads or writes", async () => {
  const f = ui(); f.draw(); await f.settle();
  assert.equal(f.find(node => node.type === "input").props.checked, false); assert.equal(f.calls.length, 1);
  f.change(true); assert.equal(f.calls.length, 1); await f.submit();
  assert.deepEqual(JSON.parse(f.calls[1].body), { email: true, expectedRevision: "a".repeat(64), noticeVersion: model.MEMBER_COMMUNICATION_NOTICE_VERSION });
  assert.match(text(f.draw()), /Email reminders are on/);
  const sample = ui({ preview: true }); sample.draw(); sample.change(true); await sample.submit(); assert.equal(sample.calls.length, 0);
});
test("conflicting member choices require reload and cannot replay a stale opt-in", async () => {
  const f = ui({ response: call => call.method === "PATCH" ? Response.json({ error: "Preferences changed. Reload." }, { status: 409 }) : Response.json({ email: false, revision: "a".repeat(64), noticeVersion: model.MEMBER_COMMUNICATION_NOTICE_VERSION }) });
  f.draw(); await f.settle(); f.change(true); await f.submit();
  assert.match(text(f.draw()), /Preferences changed/); assert.ok(f.find(node => node.type === "button" && text(node) === "Reload preference"));
  await f.submit(); assert.equal(f.calls.filter(call => call.method === "PATCH").length, 1);
  f.find(node => node.type === "button" && text(node) === "Reload preference").props.onClick(); await f.settle();
  assert.equal(f.find(node => node.type === "input").props.checked, false);
});
