import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function moduleAt(path, dependencies = {}) {
  const loaded = { exports: {} };
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", output)(name => {
    if (name === "server-only") return {};
    if (name in dependencies) return dependencies[name];
    return require(name);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const model = moduleAt("src/lib/membership/member-communication-preferences-model.ts");
const repository = moduleAt("src/lib/membership/member-communication-preferences.ts", { "./member-communication-preferences-model": model });
function sqlFor(db) {
  const sql = async (strings, ...values) => (await db.query(strings.reduce((result, part, index) => result + (index ? `$${index}` : "") + part, ""), values)).rows;
  sql.json = JSON.stringify;
  return sql;
}

test("optional member reminders retain channel decisions and exact destinations without provider work", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create table ruined_members(id uuid primary key);
    create table platform_users(auth_user_id uuid primary key,person_id uuid,member_id uuid,email_normalized text,status text);
    create table person_private_profiles(person_id uuid primary key,mobile_e164 text);
    create table person_email_addresses(person_id uuid,email_normalized text,verification_state text,retired_at timestamptz);`);
  const foundation = read("db/migrations/20260819_platform_foundation.sql");
  const start = foundation.indexOf("create table if not exists member_consents (");
  await db.exec(foundation.slice(start, foundation.indexOf("create index if not exists member_consents_member_idx", start)));
  const member = { memberId: randomUUID(), personId: randomUUID(), authUserId: randomUUID(), email: "member@example.test", phone: "+12025550123" };
  await db.query("insert into ruined_members values($1)", [member.memberId]);
  await db.query("insert into platform_users values($1,$2,$3,$4,'active')", [member.authUserId, member.personId, member.memberId, member.email]);
  await db.query("insert into person_private_profiles values($1,$2)", [member.personId, member.phone]);
  await db.query("insert into person_email_addresses values($1,$2,'verified',null)", [member.personId, member.email]);
  const sql = sqlFor(db);
  const rows = async () => (await db.query("select * from member_consents order by id")).rows;
  const get = async () => repository.getMemberCommunicationPreferences(sql, member.memberId, {
    email: member.email, phone: (await db.query("select mobile_e164 from person_private_profiles where person_id=$1", [member.personId])).rows[0].mobile_e164,
  });
  const choice = async overrides => ({ email: false, sms: false, expectedRevision: (await get()).revision, noticeVersion: model.MEMBER_COMMUNICATION_NOTICE_VERSION, ...overrides });
  const save = (input, phone = member.phone, options = {}) => db.transaction(async tx => {
    await repository.saveMemberCommunicationPreferences(sqlFor(tx), { ...member, phone, ...options }, input);
    await tx.query("update person_private_profiles set mobile_e164=$1 where person_id=$2", [phone, member.personId]);
  });

  await t.test("unknown is nullable; omitted choices do not create consent", async () => {
    const initial = await get();
    assert.equal(initial.email, null); assert.equal(initial.sms, null);
    assert.match(initial.revision, /^[a-f0-9]{64}$/);
    await save(undefined);
    assert.equal((await rows()).length, 0);
  });
  await t.test("email submission is a preference, never affirmative SMS or marketing consent", async () => {
    const input = await choice({ email: true });
    await save(input); await save(input);
    const evidence = await rows();
    assert.equal(evidence.length, 2, "Lost-response retry is idempotent");
    const email = evidence.find(row => row.evidence.channel === "email");
    const sms = evidence.find(row => row.evidence.channel === "sms");
    assert.equal(email.evidence.action, "email_preference_on_at_submission");
    assert.equal(email.evidence.emailDefaultMayBePreselected, true);
    assert.equal(email.evidence.marketingConsent, false);
    assert.equal(email.evidence.destination, member.email);
    assert.equal(email.actor_auth_user_id, member.authUserId);
    assert.ok(email.accepted_at);
    assert.equal(sms.decision, "withdrawn");
    assert.equal((await get()).sms, false);
  });
  await t.test("latest withdrawal wins across numeric IDs 9 and 10 and a stale form cannot restore it", async () => {
    await save(await choice({ email: false }));
    await db.exec("alter sequence member_consents_id_seq restart with 9");
    const before = await choice({ email: true });
    await save(before);
    const stale = await choice({ email: true });
    await save(await choice({ email: false }));
    assert.equal((await get()).email, false);
    assert.equal((await rows()).at(-1).id, 10);
    await assert.rejects(() => save(stale), { code: "communication_preferences_changed" });
    assert.equal((await get()).email, false);
  });
  let originalSmsChoice;
  await t.test("SMS requires an active choice bound to the submitted number", async () => {
    const input = await choice({ sms: true });
    const count = (await rows()).length;
    await assert.rejects(() => save(input), { code: "sms_opt_in_required" });
    await assert.rejects(() => save({ ...input, smsOptIn: { phone: "+12025550999" } }), { code: "sms_opt_in_required" });
    assert.equal((await rows()).length, count);
    originalSmsChoice = { ...input, smsOptIn: { phone: member.phone } };
    await save(originalSmsChoice);
    assert.equal((await get()).sms, true);
    const event = (await rows()).at(-1);
    assert.equal(event.evidence.action, "sms_checkbox_checked");
    assert.equal(event.evidence.destinationVerified, false, "No phone verification is claimed");
  });
  await t.test("a phone change never silently transfers SMS permission", async () => {
    const otherPhone = "+12025550456";
    const current = await choice({ sms: true });
    await assert.rejects(() => save(current, otherPhone), { code: "sms_opt_in_required" });
    assert.equal((await get()).sms, true, "Rejected profile update is atomic");
    await save(undefined, otherPhone);
    assert.equal((await get()).sms, false);
    assert.equal((await get()).smsPhone, member.phone);
    const returning = await choice({ sms: true });
    await assert.rejects(() => save(returning, member.phone), { code: "sms_opt_in_required" });
    await assert.rejects(() => save(originalSmsChoice, member.phone), { code: "communication_preferences_changed" });
    const beforeReturn = await rows();
    await save({ ...returning, smsOptIn: { phone: member.phone } }, member.phone);
    assert.equal((await rows()).length, beforeReturn.length + 1, "Returning to an old number records fresh SMS consent");
    assert.equal((await rows()).at(-1).evidence.action, "sms_checkbox_checked");
    assert.notEqual((await get()).revision, returning.expectedRevision);
    await save(undefined, otherPhone);
    const optIn = await choice({ sms: true, smsOptIn: { phone: otherPhone } });
    await save(optIn, otherPhone); await save(optIn, otherPhone);
    assert.equal((await get()).sms, true);
    assert.equal((await get()).smsPhone, otherPhone);
    await save(await choice({ sms: false }), otherPhone);
    const count = (await rows()).length;
    await save(await choice({ sms: false }), otherPhone);
    assert.equal((await rows()).length, count, "Unchanged fresh submission creates no duplicate");
    assert.equal((await get()).sms, false);
  });
  await t.test("notice drift, spoofed identity, and transaction failure cannot alter preferences", async () => {
    const phone = "+12025550456";
    const input = await choice({ email: true });
    const before = await rows();
    await assert.rejects(() => save({ ...input, noticeVersion: "other" }, phone), { code: "communication_notice_changed" });
    await assert.rejects(() => save(input, phone, { authUserId: randomUUID() }), { status: 403 });
    await assert.rejects(() => save(input, phone, { email: "not-verified@example.test" }), { status: 403 });
    await assert.rejects(() => db.transaction(async tx => {
      await repository.saveMemberCommunicationPreferences(sqlFor(tx), { ...member, phone }, input);
      throw new Error("Later profile write failed");
    }), /Later profile write/);
    assert.deepEqual(await rows(), before);
  });
});
