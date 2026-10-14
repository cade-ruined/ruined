import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { NextResponse } from "next/server.js";
import ts from "typescript";
import { json, serializeJsonBindings } from "./helpers/postgres-json-bindings.mjs";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
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
  await pg.exec(`create schema private; create role anon; create role authenticated;
    create table people(id uuid primary key,status text);
    create table ruined_members(id uuid primary key,person_id uuid,email_normalized text,deleted_at timestamptz);
    create table platform_users(auth_user_id uuid primary key,person_id uuid,member_id uuid,email_normalized text,status text);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid,account_state text,billing_state text,program_state text);
    create table member_registration_access(member_id uuid,profile_activated_at timestamptz);
    create table person_private_profiles(person_id uuid primary key,mobile_e164 text,legal_name text,updated_at timestamptz default now());
    create table person_email_addresses(person_id uuid,email_normalized text,verification_state text,retired_at timestamptz);`);
  const foundation = read("db/migrations/20260819_platform_foundation.sql");
  const start = foundation.indexOf("create table if not exists member_consents (");
  await pg.exec(foundation.slice(start, foundation.indexOf("create index if not exists member_consents_member_idx", start)));
  await pg.exec(foundation.match(/create or replace function ruined_reject_append_only_mutation\(\)[\s\S]*?\$\$;/)[0]);
  await pg.exec(`create trigger member_consents_append_only before update or delete on member_consents
    for each row execute function ruined_reject_append_only_mutation()`);
  await pg.exec(read("db/migrations/20261008210000_member_sms_phone_consent.sql"));
  const member = { memberId: crypto.randomUUID(), personId: crypto.randomUUID(), authUserId: crypto.randomUUID(), email: "member@example.com", phone: "+12025550123" };
  await pg.query("insert into people values($1,'active')", [member.personId]);
  await pg.query("insert into ruined_members values($1,$2,$3,null)", [member.memberId, member.personId, member.email]);
  await pg.query("insert into platform_users values($1,$2,$3,$4,'active')", [member.authUserId, member.personId, member.memberId, member.email]);
  await pg.query("insert into platform_role_grants values($1,'member',null)", [member.authUserId]);
  await pg.query("insert into member_lifecycle values($1,'provisional','none','not_started')", [member.memberId]);
  await pg.query("insert into member_registration_access values($1,null)", [member.memberId]);
  await pg.query("insert into person_private_profiles(person_id,mobile_e164,legal_name) values($1,$2,'Keep this name')", [member.personId, member.phone]);
  await pg.query("insert into person_email_addresses values($1,$2,'verified',null)", [member.personId, member.email]);
  const sql = bridge(pg);
  const service = load("src/lib/membership/member-sms-preferences.ts", {
    "server-only": {}, "libphonenumber-js/min": require("libphonenumber-js/min"), "@/lib/database/server": { getApplicationDatabase: () => sql },
    "./member-communication-preferences": preferences, "./member-communication-preferences-model": model,
  });
  const state = { signedIn: true, currentUser: true, authError: null, currentUserChecks: 0, mode: "connected", logs: [], fail: false };
  const supabase = { auth: {
    getClaims: async () => ({ data: { claims: state.signedIn ? { sub: member.authUserId, email: member.email } : null }, error: null }),
    getUser: async () => { state.currentUserChecks++; return { data: { user: state.currentUser ? { id: member.authUserId, email: member.email } : null }, error: state.authError }; },
  } };
  const createSupabaseServerClient = async () => supabase;
  const session = load("src/lib/auth/session.ts", { "server-only": {}, "@/lib/supabase/server": { createSupabaseServerClient }, "@/lib/auth/session-errors": load("src/lib/auth/session-errors.ts") });
  const origin = load("src/lib/auth/request.ts", {}, { process: { env: { NODE_ENV: "production" } } });
  const route = load("app/api/my/sms-preferences/route.ts", {
    "next/server": { NextResponse }, "@/lib/auth/request": origin, "@/lib/auth/session": session,
    "@/lib/supabase/server": { createSupabaseServerClient },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: state.mode }) },
    "@/lib/membership/member-communication-preferences": preferences,
    "@/lib/membership/member-sms-preferences": {
      getMemberSmsPreference: actor => { if (state.fail) throw Error("private-credential"); return service.getMemberSmsPreference(actor); },
      saveMemberSmsPreference: service.saveMemberSmsPreference,
    },
  }, { console: { error: (...args) => state.logs.push(args) } });
  const url = "https://members.example.com/api/my/sms-preferences";
  const get = () => service.getMemberSmsPreference(member.authUserId);
  const input = async (sms, phone = member.phone) => ({ phone, sms, expectedRevision: (await get()).revision, noticeVersion: model.MEMBER_COMMUNICATION_NOTICE_VERSION, ...(sms ? { smsOptIn: { phone } } : {}) });
  const save = value => service.saveMemberSmsPreference(member.authUserId, value);
  const rows = async () => (await pg.query("select * from member_consents order by id")).rows;
  const post = (body, headers = {}) => route.POST(new Request(url, { method: "POST", headers: { Origin: "https://members.example.com", "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
  async function reset() {
    await pg.exec("truncate member_consents; update people set status='active'; update platform_users set status='active'; update platform_role_grants set revoked_at=null; update ruined_members set deleted_at=null; update person_email_addresses set verification_state='verified',retired_at=null; update member_lifecycle set account_state='provisional';");
    await pg.query("update platform_users set email_normalized=$1", [member.email]);
    await pg.query("update person_private_profiles set mobile_e164=$1", [member.phone]);
    Object.assign(state, { signedIn: true, currentUser: true, authError: null, currentUserChecks: 0, mode: "connected", logs: [], fail: false });
  }
  return { pg, sql, member, state, service, route, url, get, input, save, rows, post, reset };
}

test("standalone text preferences persist real consent and only the member phone", async t => {
  const f = await fixture(t);
  await t.test("held registration can opt in without activating membership or changing private details", async () => {
    const before = await f.get(); assert.deepEqual(Object.keys(before).sort(), ["noticeVersion", "phone", "revision", "sms"]); assert.equal(before.sms, null);
    const input = await f.input(true); const saved = await f.save(input); await f.save(input);
    assert.equal(saved.sms, true); assert.equal(saved.phone, f.member.phone); assert.notEqual(saved.revision, before.revision);
    const rows = await f.rows(); assert.equal(rows.length, 1, "Exact retry is idempotent");
    assert.equal(rows[0].source, "member"); assert.equal(rows[0].actor_auth_user_id, f.member.authUserId); assert.ok(rows[0].accepted_at);
    assert.equal(rows[0].evidence.channel, "sms"); assert.equal(rows[0].evidence.destination, f.member.phone);
    assert.equal(rows[0].evidence.action, "sms_checkbox_checked"); assert.equal(rows[0].evidence.requested, true);
    assert.equal(rows[0].evidence.marketingConsent, false); assert.equal(rows[0].evidence.destinationVerified, false);
    assert.equal(rows[0].evidence.termsVersion, model.MEMBER_SMS_TERMS_VERSION);
    assert.equal(rows[0].evidence.notice, `${model.MEMBER_SMS_UPDATES_NOTICE} ${model.MEMBER_SMS_UPDATES_DETAIL}`);
    assert.equal((await f.pg.query("select profile_activated_at from member_registration_access")).rows[0].profile_activated_at, null);
    assert.deepEqual((await f.pg.query("select account_state,billing_state,program_state from member_lifecycle")).rows[0], { account_state: "provisional", billing_state: "none", program_state: "not_started" });
    assert.equal((await f.pg.query("select legal_name from person_private_profiles")).rows[0].legal_name, "Keep this name");
  });
  await t.test("all email preference evidence stays byte-for-byte unchanged", async () => {
    await f.reset();
    await preferences.saveMemberCommunicationPreferences(f.sql, f.member,
      { email: true, sms: false, expectedRevision: (await f.get()).revision, noticeVersion: model.MEMBER_COMMUNICATION_NOTICE_VERSION }, { emailOnly: true });
    const originalEmail = (await f.rows())[0];
    await f.save(await f.input(true)); await f.save(await f.input(false)); await f.save(await f.input(true, "+12025550456"));
    assert.deepEqual((await f.rows()).filter(row => row.evidence.channel === "email"), [originalEmail]);
  });
  await t.test("SMS acceptance always requires active confirmation for the exact number", async () => {
    await f.reset(); const input = await f.input(true);
    for (const smsOptIn of [undefined, { phone: "+12025550999" }, { phone: input.phone, checked: true }, "true"]) {
      assert.throws(() => f.save({ ...input, smsOptIn }), error => error.code === "sms_opt_in_required");
    }
    assert.equal((await f.rows()).length, 0); await f.save(input);
    assert.throws(() => f.save({ ...input, expectedRevision: "a".repeat(64), smsOptIn: undefined }), error => error.code === "sms_opt_in_required");
  });
  await t.test("changed phone consent is atomic, direct phone changes invalidate it and returning never revives it", async () => {
    await f.reset(); const first = await f.input(true); await f.save(first);
    const other = "+12025550456"; const changed = await f.input(true, other); await f.save(changed); await f.save(changed);
    assert.equal((await f.get()).sms, true); assert.equal((await f.get()).phone, other); assert.equal((await f.rows()).length, 2);
    await f.pg.query("update person_private_profiles set mobile_e164=$1", [f.member.phone]);
    assert.equal((await f.get()).sms, false); assert.equal((await f.rows()).at(-1).evidence.action, "profile_phone_changed");
    await assert.rejects(f.save(first), error => error.code === "communication_preferences_changed");
    await f.save(await f.input(true)); assert.equal((await f.get()).sms, true);
    await f.save(await f.input(false, other)); assert.equal((await f.get()).sms, false); assert.equal((await f.get()).phone, other);
    assert.equal((await f.rows()).at(-1).evidence.action, "preference_off_at_submission");
  });
  await t.test("no private profile yet is supported and failed phone write rolls back its consent", async () => {
    await f.reset(); await f.pg.exec("delete from person_private_profiles");
    assert.equal((await f.get()).phone, null);
    await f.pg.exec(`alter table person_private_profiles add constraint simulated_write_failure check(mobile_e164 <> '+12025550999')`);
    await assert.rejects(f.save(await f.input(true, "+12025550999")), /simulated_write_failure/);
    assert.equal((await f.rows()).length, 0); assert.equal((await f.get()).phone, null);
    await f.save(await f.input(true)); assert.equal((await f.get()).sms, true);
  });
  await t.test("stale forms, changed disclosures and malformed payloads cannot alter the current choice", async () => {
    await f.reset(); const first = await f.input(true); await f.save(first); const stale = await f.input(true);
    await f.save(await f.input(false)); await assert.rejects(f.save(stale), error => error.code === "communication_preferences_changed");
    await assert.rejects(f.save(first), error => error.code === "communication_preferences_changed");
    await assert.rejects(f.save({ ...await f.input(true), noticeVersion: "old" }), error => error.code === "communication_notice_changed");
    const input = await f.input(true);
    for (const extra of [{ email: true }, { memberId: crypto.randomUUID() }, { authUserId: crypto.randomUUID() }, { sms: "true" }, { phone: "2025550123" }, { phone: "+12025550123 ext 12" }, { phone: "+123" }, { phone: "" }]) {
      assert.throws(() => f.save({ ...input, ...extra }), error => error.status === 400);
    }
    assert.equal((await f.get()).sms, false);
  });
  await t.test("identity, current verification, role, suspension and deletion are checked after acquiring locks", async () => {
    for (const mutation of ["update platform_role_grants set revoked_at=now()", "update platform_users set status='suspended'", "update people set status='inactive'", "update ruined_members set deleted_at=now()", "update person_email_addresses set verification_state='pending'", "update person_email_addresses set retired_at=now()", "update platform_users set email_normalized='other@example.com'", "update member_lifecycle set account_state='suspended'", "update member_lifecycle set account_state='closed'"]) {
      await f.reset(); const input = await f.input(false); await f.pg.exec(mutation);
      await assert.rejects(f.save(input), error => error.status === 403); assert.equal((await f.rows()).length, 0);
    }
    await f.reset(); await assert.rejects(f.service.getMemberSmsPreference(crypto.randomUUID()), error => error.status === 403);
  });
  await t.test("route checks current Auth user, origin, connected mode and bounded JSON body", async () => {
    await f.reset(); const input = await f.input(true);
    f.state.signedIn = false; assert.equal((await f.route.GET(new Request(f.url))).status, 401); assert.equal((await f.post(input)).status, 401);
    f.state.signedIn = true; f.state.currentUser = false; assert.equal((await f.post(input)).status, 401, "Valid JWT from deleted user is insufficient");
    f.state.currentUser = true; f.state.authError = { code: "user_banned" }; assert.equal((await f.post(input)).status, 401);
    f.state.authError = { status: 503 }; assert.equal((await f.post(input)).status, 503);
    f.state.authError = null; f.state.mode = "preview"; assert.equal((await f.post(input)).status, 503);
    f.state.mode = "connected"; assert.equal((await f.post(input, { Origin: "https://attacker.example" })).status, 403);
    assert.equal((await f.post(input, { "Content-Type": "text/plain" })).status, 415);
    assert.equal((await f.post("{bad")).status, 400);
    assert.equal((await f.post(JSON.stringify({ junk: "x".repeat(5000) }), { "Content-Length": "1" })).status, 413);
    assert.equal((await f.rows()).length, 0);
    const saved = await f.post(input); assert.equal(saved.status, 200); assert.equal(saved.headers.get("Cache-Control"), "no-store"); assert.equal((await saved.json()).sms, true);
    const current = await f.route.GET(new Request(f.url)); assert.equal(current.status, 200); assert.equal((await current.json()).phone, f.member.phone);
    assert.ok(f.state.currentUserChecks > 0);
    f.state.fail = true; const failed = await f.route.GET(new Request(f.url)); assert.equal(failed.status, 503);
    assert.doesNotMatch(JSON.stringify(await failed.json()) + JSON.stringify(f.state.logs), /private-credential/);
  });
});
