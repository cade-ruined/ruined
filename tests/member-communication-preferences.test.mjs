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

async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create schema private; create role anon; create role authenticated;
    create table ruined_members(id uuid primary key,person_id uuid);
    create table platform_users(auth_user_id uuid primary key,person_id uuid,member_id uuid,email_normalized text,status text);
    create table person_private_profiles(person_id uuid primary key,mobile_e164 text,legal_name text);
    create table person_email_addresses(person_id uuid,email_normalized text,verification_state text,retired_at timestamptz);`);
  const foundation = read("db/migrations/20260819_platform_foundation.sql");
  const start = foundation.indexOf("create table if not exists member_consents (");
  await db.exec(foundation.slice(start, foundation.indexOf("create index if not exists member_consents_member_idx", start)));
  await db.exec(foundation.match(/create or replace function ruined_reject_append_only_mutation\(\)[\s\S]*?\$\$;/)[0]);
  await db.exec(`create trigger member_consents_append_only before update or delete on member_consents
    for each row execute function ruined_reject_append_only_mutation()`);
  const member = { memberId: randomUUID(), personId: randomUUID(), authUserId: randomUUID(), email: "member@example.test", phone: "+12025550123" };
  await db.query("insert into ruined_members values($1,$2)", [member.memberId, member.personId]);
  await db.query("insert into platform_users values($1,$2,$3,$4,'active')", [member.authUserId, member.personId, member.memberId, member.email]);
  await db.query("insert into person_private_profiles(person_id,mobile_e164) values($1,$2)", [member.personId, member.phone]);
  await db.query("insert into person_email_addresses values($1,$2,'verified',null)", [member.personId, member.email]);
  await db.exec(read("db/migrations/20261008210000_member_sms_phone_consent.sql"));
  const sql = sqlFor(db);
  const rows = async () => (await db.query("select * from member_consents order by id")).rows;
  const get = async () => repository.getMemberCommunicationPreferences(sql, member.memberId, {
    email: member.email, phone: (await db.query("select mobile_e164 from person_private_profiles where person_id=$1", [member.personId])).rows[0]?.mobile_e164 ?? null,
  });
  const choice = async overrides => ({ email: false, sms: false, expectedRevision: (await get()).revision, noticeVersion: model.MEMBER_COMMUNICATION_NOTICE_VERSION, ...overrides });
  const save = (input, phone = member.phone, options = {}) => db.transaction(async tx => {
    await repository.saveMemberCommunicationPreferences(sqlFor(tx), { ...member, phone, ...options }, input);
    await tx.query(`insert into person_private_profiles(person_id,mobile_e164) values($2,$1)
      on conflict(person_id) do update set mobile_e164=excluded.mobile_e164`, [phone, member.personId]);
  });
  return { db, member, sql, rows, get, choice, save };
}

test("optional member reminders retain channel decisions and exact destinations without provider work", async t => {
  const { db, member, rows, get, choice, save } = await fixture(t);

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
    assert.equal(event.policy_version, "membership-reminders-v2");
    assert.equal(event.evidence.termsVersion, model.MEMBER_SMS_TERMS_VERSION);
    assert.equal(event.evidence.termsHref, model.MEMBER_SMS_TERMS_HREF);
    assert.equal(event.evidence.privacyHref, model.MEMBER_SMS_PRIVACY_HREF);
    assert.equal(event.evidence.notice, `${model.MEMBER_SMS_UPDATES_NOTICE} ${model.MEMBER_SMS_UPDATES_DETAIL}`);
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

test("v2 requires a new affirmative SMS choice and preserves earlier email choices and evidence", async t => {
  const { db, member, sql, rows, get, choice, save } = await fixture(t);
  for (const channel of ["email", "sms"]) {
    await db.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence,dedupe_key)
      values($1,'communications','membership-reminders-v1','accepted',now(),'member',$2,$3,$4)`, [
      member.memberId, member.authUserId, {
        context: "member_communication_preferences_v1", purpose: "membership_updates", channel,
        destination: channel === "email" ? member.email : member.phone, requested: true,
        action: channel === "sms" ? "sms_checkbox_checked" : "email_preference_on_at_submission",
        notice: "The exact old wording.", marketingConsent: false,
      }, `legacy-${channel}`,
    ]);
  }
  const before = await rows();
  assert.equal((await get()).email, true);
  assert.equal((await get()).sms, false, "Old wording never becomes acceptance of the new wording");
  assert.equal((await get()).smsPhone, member.phone);
  const olderRepository = moduleAt("src/lib/membership/member-communication-preferences.ts", {
    "./member-communication-preferences-model": { ...model, MEMBER_COMMUNICATION_NOTICE_VERSION: "membership-reminders-v1" },
  });
  const oldSnapshot = await olderRepository.getMemberCommunicationPreferences(sql, member.memberId, { email: member.email, phone: member.phone });
  assert.notEqual(oldSnapshot.revision, (await get()).revision, "A notice rollout invalidates an already-open form revision");
  await assert.rejects(() => save({ email: true, sms: true, expectedRevision: oldSnapshot.revision,
    noticeVersion: model.MEMBER_COMMUNICATION_NOTICE_VERSION, smsOptIn: { phone: member.phone } }), { code: "communication_preferences_changed" });
  await assert.rejects(() => save({ email: true, sms: true, expectedRevision: oldSnapshot.revision,
    noticeVersion: "membership-reminders-v1", smsOptIn: { phone: member.phone } }), { code: "communication_notice_changed" });
  const input = await choice({ email: true, sms: true });
  await assert.rejects(() => save(input), { code: "sms_opt_in_required" });
  assert.deepEqual(await rows(), before);
  await save({ ...input, smsOptIn: { phone: member.phone } });
  const after = await rows();
  assert.equal(after.length, before.length + 1, "Unchanged prior email consent is retained without rewriting it");
  assert.deepEqual(after.slice(0, before.length), before);
  assert.equal(after.at(-1).policy_version, model.MEMBER_COMMUNICATION_NOTICE_VERSION);
  assert.equal((await get()).sms, true);
  await assert.rejects(() => db.query("update member_consents set policy_version='membership-reminders-v2' where policy_version='membership-reminders-v1'"), /append-only/);
});

test("every private-profile phone edit retires SMS permission even when a prior number returns", async t => {
  const { db, member, rows, get, choice, save } = await fixture(t);
  const originalPhone = member.phone;
  const nextPhone = "+12025550987";
  const optIn = async (phone = originalPhone) => save(await choice({ email: true, sms: true, smsOptIn: { phone } }), phone);
  await optIn();
  const accepted = (await rows()).at(-1);
  const unchangedCount = (await rows()).length;
  await db.query("update person_private_profiles set legal_name='Corrected Name',mobile_e164=mobile_e164 where person_id=$1", [member.personId]);
  assert.equal((await rows()).length, unchangedCount, "An unrelated correction does not revoke consent");
  assert.equal((await get()).sms, true);

  // Direct writes and the operator's upsert use the same database guard.
  await db.query("update person_private_profiles set mobile_e164=$1 where person_id=$2", [nextPhone, member.personId]);
  assert.equal((await get()).sms, false);
  const revoked = (await rows()).at(-1);
  assert.equal(revoked.decision, "withdrawn");
  assert.equal(revoked.evidence.action, "profile_phone_changed");
  assert.equal(revoked.evidence.invalidatedConsentId, String(accepted.id));
  await db.query(`insert into person_private_profiles(person_id,mobile_e164) values($1,$2)
    on conflict(person_id) do update set mobile_e164=excluded.mobile_e164`, [member.personId, originalPhone]);
  assert.equal((await get()).sms, false, "Returning to an old destination without preferences cannot revive acceptance");
  assert.deepEqual((await rows()).find(row => row.id === accepted.id), accepted, "Original consent evidence is untouched");
  assert.equal((await get()).email, true);

  await optIn();
  await db.query("update person_private_profiles set mobile_e164=null where person_id=$1", [member.personId]);
  await save(undefined, originalPhone);
  assert.equal((await get()).sms, false, "Clearing and restoring a number still requires fresh consent");
  await optIn();
  await db.query("delete from person_private_profiles where person_id=$1", [member.personId]);
  await save(undefined, originalPhone);
  assert.equal((await get()).sms, false, "Deleting and recreating a profile cannot revive consent");

  await db.query("delete from person_private_profiles where person_id=$1", [member.personId]);
  await optIn();
  assert.equal((await get()).sms, true, "A fresh checkbox choice also survives the initial profile INSERT");
  await optIn(nextPhone);
  assert.equal((await get()).sms, true, "A newly chosen phone and consent can be committed together");
  assert.equal((await get()).smsPhone, nextPhone);
  const beforeFailure = await rows();
  await assert.rejects(() => db.transaction(async tx => {
    await tx.query("update person_private_profiles set mobile_e164=$1 where person_id=$2", [originalPhone, member.personId]);
    throw new Error("profile transaction failed");
  }), /profile transaction failed/);
  assert.deepEqual(await rows(), beforeFailure, "A rolled-back edit does not leave an unrelated withdrawal");
  assert.equal((await get()).sms, true);

  const freshChoice = await choice({ email: true, sms: true, smsOptIn: { phone: originalPhone } });
  await db.transaction(async tx => {
    await repository.saveMemberCommunicationPreferences(sqlFor(tx), { ...member, phone: originalPhone }, freshChoice);
    await tx.query("update person_private_profiles set mobile_e164=$1 where person_id=$2", [originalPhone, member.personId]);
    await tx.query("update person_private_profiles set mobile_e164=$1 where person_id=$2", [nextPhone, member.personId]);
    await tx.query("update person_private_profiles set mobile_e164=$1 where person_id=$2", [originalPhone, member.personId]);
  });
  assert.equal((await get()).sms, false, "A later phone change in the same transaction invalidates even that transaction's fresh choice");
});

test("operator phone corrections run through the consent guard without changing support authorization or audit", async t => {
  const { db, member, get, choice, save } = await fixture(t);
  await db.exec(`alter table ruined_members add column deleted_at timestamptz;
    alter table person_private_profiles add column updated_at timestamptz default statement_timestamp(),
      add column default_fulfillment_address jsonb,add column apparel_sizing jsonb,add column accessibility_notes text;
    create table person_profiles(person_id uuid primary key,display_name text,preferred_name text,timezone text,
      location_label text,bio text,building_now text,updated_at timestamptz);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table operator_audit_events(actor_auth_user_id uuid,action text,subject_type text,subject_id text,
      member_id uuid,reason text,before_snapshot jsonb,after_snapshot jsonb,metadata jsonb,dedupe_key text);`);
  const operator = randomUUID();
  await db.query("insert into platform_users(auth_user_id,status) values($1,'active')", [operator]);
  await db.query("insert into platform_role_grants values($1,'ops_admin',null)", [operator]);
  const database = sqlFor(db);
  database.begin = callback => db.transaction(tx => callback(sqlFor(tx)));
  class OpsOperatingRepositoryError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const operations = moduleAt("src/lib/platform/ops-profile-repository.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => database },
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError },
  });
  await save(await choice({ email: true, sms: true, smsOptIn: { phone: member.phone } }));
  const initialVersion = `none|${new Date((await db.query("select updated_at from person_private_profiles where person_id=$1", [member.personId])).rows[0].updated_at).toISOString()}`;
  const input = { actorAuthUserId: operator, memberId: member.memberId, expectedVersion: initialVersion,
    mobile: "+12025550678", reason: "Member asked to correct their number." };
  await assert.rejects(() => operations.updateOpsMemberProfileSupport({ ...input, actorAuthUserId: member.authUserId }), { code: "forbidden" });
  assert.equal((await get()).sms, true);
  const first = await operations.updateOpsMemberProfileSupport(input);
  assert.equal((await get()).sms, false);
  await assert.rejects(() => operations.updateOpsMemberProfileSupport({ ...input, mobile: member.phone }), { code: "conflict" });
  await operations.updateOpsMemberProfileSupport({ ...input, expectedVersion: first.version, mobile: member.phone });
  assert.equal((await get()).sms, false, "A supported correction back to the old number still needs a new member opt-in");
  assert.equal((await get()).email, true);
  const events = (await db.query("select * from operator_audit_events")).rows;
  assert.equal(events.length, 2);
  assert.ok(events.every(event => event.actor_auth_user_id === operator && event.action === "member.profile_supported"));
  assert.ok(events.every(event => event.metadata.sensitiveValuesStoredInAudit === false));
});
