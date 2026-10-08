import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { configuration, id, sid, loader, read, sqlFor } from "./helpers/member-sms-fixture.mjs";

const modelPath = "src/lib/communications/member-sms-model.ts";
const repoPath = "src/lib/communications/member-sms-repository.ts";
const servicePath = "src/lib/communications/member-sms-service.ts";

test("SMS is disabled by default and incomplete configuration cannot reach a database or provider", async () => {
  for (const env of [{}, configuration(), { MEMBER_SMS_ENABLED: "true" }]) {
    const load = loader(env, {
      "@/lib/database/server": { getApplicationDatabase: () => assert.fail("Unexpected database access") },
      twilio: () => assert.fail("Unexpected SMS provider access"),
    });
    const result = await load(servicePath).sendMemberSmsReminder({ memberId: id(1), reminderKey: "call:1", kind: "call_reminder" });
    assert.equal(result.status, env.MEMBER_SMS_ENABLED ? "unconfigured" : "disabled");
  }
  const load = loader();
  const config = load("src/lib/communications/member-sms-config.ts");
  for (const origin of ["http://members.theruinedproject.com", "https://attacker.test", "https://members.theruinedproject.com/path", "https://members.theruinedproject.com?x=1"]) {
    assert.equal(config.readMemberSmsConfiguration({ ...configuration(), TWILIO_WEBHOOK_BASE_URL: origin }).webhookReady, false);
  }
  const model = load(modelPath);
  const confirmation = model.memberSmsReminderBody({ memberId: id(1), reminderKey: "consent:1", kind: "opt_in_confirmation" }, "https://members.theruinedproject.com");
  for (const expected of ["Ruined:", "membership updates and call reminders", "frequency varies", "data rates", "HELP", "STOP", "connect@theruinedproject.com"]) assert.ok(confirmation.includes(expected));
  assert.throws(() => model.memberSmsReminderBody({ memberId: id(1), reminderKey: "call:1", kind: "marketing" }, "https://members.theruinedproject.com"));
});

test("private SMS ledger gates exact consent, idempotent delivery, STOP, and ambiguous failures", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated;
    create table ruined_members(id uuid primary key,person_id uuid,membership_state text,deleted_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text);
    create table person_private_profiles(person_id uuid primary key,mobile_e164 text);
    create table member_consents(id bigint generated always as identity primary key,member_id uuid,consent_type text,
      policy_version text,decision text,accepted_at timestamptz,source text,actor_auth_user_id uuid,evidence jsonb,dedupe_key text unique);`);
  await db.exec(read("db/migrations/20261008220000_member_sms_transport.sql"));
  const sql = sqlFor(db), env = { ...configuration(), MEMBER_SMS_ENABLED: "true" }, calls = [];
  let failProvider = false, providerErrorCode;
  const load = loader(env, { "@/lib/database/server": { getApplicationDatabase: () => sql }, twilio: (account, token, options) => {
    assert.equal(account, env.TWILIO_ACCOUNT_SID); assert.equal(token, env.TWILIO_AUTH_TOKEN);
    assert.equal(options.autoRetry, false); assert.equal(options.maxRetries, 0); assert.equal(options.logLevel, "silent");
    return { messages: { create: async payload => {
      calls.push(payload);
      if (failProvider) throw Object.assign(new Error(`Secret fixture ${token} ${payload.to}`), { code: providerErrorCode });
      return { sid: sid(calls.length + 1000) };
    } } };
  } });
  const repository = load(repoPath), service = load(servicePath), model = load("src/lib/membership/member-communication-preferences-model.ts");
  let next = 1;
  async function member(phone) {
    const n = next++, memberId = id(n), person = id(n + 100), destination = phone ?? `+1202555${String(n).padStart(4, "0")}`;
    await db.query("insert into ruined_members(id,person_id,membership_state) values($1,$2,'active')", [memberId, person]);
    await db.query("insert into person_private_profiles values($1,$2)", [person, destination]);
    await db.query("insert into member_lifecycle values($1,'active')", [memberId]);
    return { memberId, person, phone: destination, reminderKey: `call:${n}`, kind: "call_reminder" };
  }
  async function consent(m, overrides = {}) {
    const evidence = { context: "member_communication_preferences_v1", purpose: "membership_updates", channel: "sms",
      destination: m.phone, requested: true, action: "sms_checkbox_checked", marketingConsent: false,
      termsVersion: model.MEMBER_SMS_TERMS_VERSION, ...overrides.evidence };
    await db.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence)
      values($1,'communications',$2,$3,now(),$4,$5,$6)`, [m.memberId, overrides.version ?? model.MEMBER_COMMUNICATION_NOTICE_VERSION,
      overrides.decision ?? "accepted", overrides.source ?? "member", overrides.actor === null ? null : id(999), JSON.stringify(evidence)]);
  }
  const reserve = m => repository.reserveMemberSmsAttempt(sql, m, "Ruined reminder fixture");
  await t.test("no consent, legacy v1, other topics, missing evidence, and stale numbers cannot send", async () => {
    const cases = [{}, { version: "membership-reminders-v1" }, { evidence: { purpose: "marketing" } },
      { evidence: { context: "other" } }, { evidence: { channel: "email" } }, { evidence: { destination: "+12025559999" } },
      { evidence: { requested: false } }, { evidence: { termsVersion: "old" } }, { actor: null }, { source: "ops" }];
    for (const [i, overrides] of cases.entries()) {
      const m = await member(); if (i > 0) await consent(m, overrides);
      assert.deepEqual(await service.sendMemberSmsReminder(m), { status: "blocked", reason: "no_current_consent" });
    }
    assert.equal(calls.length, 0);
  });
  await t.test("inactive membership and missing phone fail before any provider work", async () => {
    const inactive = await member(); await consent(inactive);
    await db.query("update ruined_members set membership_state='ended' where id=$1", [inactive.memberId]);
    assert.equal((await service.sendMemberSmsReminder(inactive)).reason, "member_inactive");
    const missing = await member(); await consent(missing);
    await db.query("update person_private_profiles set mobile_e164=null where person_id=$1", [missing.person]);
    assert.equal((await service.sendMemberSmsReminder(missing)).reason, "phone_missing");
    assert.equal(calls.length, 0);
  });
  await t.test("soft-deleted members cannot reserve or dispatch even with active billing and retained phone/consent", async () => {
    const deleted = await member(); await consent(deleted);
    await db.query("update ruined_members set deleted_at=now() where id=$1", [deleted.memberId]);
    assert.equal((await service.sendMemberSmsReminder(deleted)).reason, "member_inactive");
    const pending = await member(); await consent(pending);
    const reservation = await reserve(pending);
    await db.query("update ruined_members set deleted_at=now() where id=$1", [pending.memberId]);
    assert.equal((await repository.dispatchReservedMemberSms(sql, pending, reservation, () => assert.fail("Deleted member must not send"))).reason, "member_inactive");
    assert.equal(calls.length, 0);
  });
  await t.test("active billing cannot override suspended, closed, or missing lifecycle account state", async () => {
    for (const accountState of ["suspended", "closed", null]) {
      const m = await member(); await consent(m);
      if (accountState) await db.query("update member_lifecycle set account_state=$2 where member_id=$1", [m.memberId, accountState]);
      else await db.query("delete from member_lifecycle where member_id=$1", [m.memberId]);
      assert.equal((await service.sendMemberSmsReminder(m)).reason, "member_inactive");
    }
    const pending = await member(); await consent(pending);
    const reservation = await reserve(pending);
    await db.query("update member_lifecycle set account_state='suspended' where member_id=$1", [pending.memberId]);
    assert.equal((await repository.dispatchReservedMemberSms(sql, pending, reservation, () => assert.fail("Suspended account must not send"))).reason, "member_inactive");
    assert.equal(calls.length, 0);
  });
  await t.test("a valid active v2 reminder sends once; accepted and pending retries are blocked", async () => {
    const m = await member(); await consent(m);
    const sent = await service.sendMemberSmsReminder(m);
    assert.equal(sent.status, "accepted"); assert.equal(calls.length, 1);
    assert.equal(calls[0].from, env.TWILIO_PHONE_NUMBER); assert.equal(calls[0].messagingServiceSid, env.TWILIO_MESSAGING_SERVICE_SID);
    assert.match(calls[0].body, /^Ruined:/); assert.match(calls[0].body, /STOP.*HELP/);
    assert.equal((await service.sendMemberSmsReminder(m)).status, "duplicate");
    const racing = { ...m, reminderKey: "call:parallel" };
    const before = calls.length;
    const results = await Promise.all([service.sendMemberSmsReminder(racing), service.sendMemberSmsReminder(racing)]);
    assert.deepEqual(results.map(result => result.status).sort(), ["accepted", "duplicate"]);
    assert.equal(calls.length, before + 1);
    const pending = { ...m, reminderKey: "call:interrupted" }; await reserve(pending);
    assert.equal((await service.sendMemberSmsReminder(pending)).status, "duplicate"); assert.equal(calls.length, 2);
  });
  await t.test("latest withdrawal wins; revoked, changed-phone, and replaced consent fail the final dispatch gate", async () => {
    for (const change of ["withdraw", "phone", "replace"]) {
      const m = await member(); await consent(m); const reservation = await reserve(m);
      if (change === "phone") await db.query("update person_private_profiles set mobile_e164='+12025559000' where person_id=$1", [m.person]);
      else await consent(m, change === "withdraw" ? { decision: "withdrawn" } : {});
      assert.equal((await repository.dispatchReservedMemberSms(sql, m, reservation, () => assert.fail("Consent changed"))).status, "blocked");
    }
    assert.equal(calls.length, 2);
  });
  await t.test("STOP applies to every member on a number and duplicate/START/HELP cannot restore it", async () => {
    const m = await member(), shared = await member(m.phone); await consent(m); await consent(shared);
    const reservation = await reserve(m), stop = { messageSid: sid(1), phone: m.phone, kind: "STOP" };
    assert.deepEqual(await repository.applyMemberSmsInbound(sql, stop), { duplicate: false });
    assert.deepEqual(await repository.applyMemberSmsInbound(sql, stop), { duplicate: true });
    const withdrawals = (await db.query("select * from member_consents where evidence->>'action'='twilio_stop'")).rows;
    assert.equal(withdrawals.length, 2);
    assert.equal((await repository.dispatchReservedMemberSms(sql, m, reservation, () => assert.fail("STOP must block"))).reason, "phone_suppressed");
    await repository.applyMemberSmsInbound(sql, { ...stop, messageSid: sid(2), kind: "START" });
    await repository.applyMemberSmsInbound(sql, { ...stop, messageSid: sid(3), kind: "HELP" });
    await consent(m); // Even another web consent cannot silently bypass the number-level STOP.
    assert.equal((await service.sendMemberSmsReminder({ ...m, reminderKey: "new" })).reason, "phone_suppressed");
    assert.equal((await service.sendMemberSmsReminder(shared)).reason, "phone_suppressed");
    const unknownPhone = "+12025558888";
    await repository.applyMemberSmsInbound(sql, { messageSid: sid(4), phone: unknownPhone, kind: "STOP" });
    const later = await member(unknownPhone); await consent(later);
    assert.equal((await service.sendMemberSmsReminder(later)).reason, "phone_suppressed");
  });
  await t.test("provider timeout is permanently unknown and does not retry or retain secret error text", async () => {
    const m = await member(); await consent(m); failProvider = true;
    assert.equal((await service.sendMemberSmsReminder(m)).status, "unknown");
    const count = calls.length;
    assert.equal((await service.sendMemberSmsReminder(m)).status, "duplicate");
    assert.equal(calls.length, count); failProvider = false;
    const rows = (await db.query("select * from private.member_sms_delivery_attempts where member_id=$1", [m.memberId])).rows;
    assert.equal(rows[0].status, "unknown"); assert.ok(!JSON.stringify(rows).includes(env.TWILIO_AUTH_TOKEN));
  });
  await t.test("Twilio 21610 persists a global opt-out that blocks new reminders and other members on the number", async () => {
    const m = await member(), shared = await member(m.phone); await consent(m); await consent(shared);
    failProvider = true; providerErrorCode = 21610;
    assert.deepEqual(await service.sendMemberSmsReminder(m), { status: "blocked", reason: "phone_suppressed" });
    failProvider = false; providerErrorCode = undefined;
    const count = calls.length;
    assert.equal((await service.sendMemberSmsReminder({ ...m, reminderKey: "distinct:reminder" })).reason, "phone_suppressed");
    assert.equal((await service.sendMemberSmsReminder(shared)).reason, "phone_suppressed");
    assert.equal(calls.length, count);
    const suppression = (await db.query("select * from private.member_sms_phone_suppressions where phone_e164=$1", [m.phone])).rows[0];
    assert.equal(suppression.source, "provider_opt_out"); assert.equal(suppression.latest_message_sid, null);
    assert.ok(suppression.provider_attempt_id);
    const attempt = (await db.query("select * from private.member_sms_delivery_attempts where id=$1", [suppression.provider_attempt_id])).rows[0];
    assert.equal(attempt.status, "blocked"); assert.equal(attempt.blocked_reason, "phone_suppressed");
    const withdrawal = (await db.query("select * from member_consents where member_id=$1 order by id desc limit 1", [m.memberId])).rows[0];
    assert.equal(withdrawal.decision, "withdrawn"); assert.equal(withdrawal.evidence.providerErrorCode, 21610);
    assert.ok(!JSON.stringify({ suppression, attempt, withdrawal }).includes(env.TWILIO_AUTH_TOKEN));
    await repository.applyMemberSmsInbound(sql, { messageSid: sid(90), phone: m.phone, kind: "STOP" });
    const updated = (await db.query("select * from private.member_sms_phone_suppressions where phone_e164=$1", [m.phone])).rows[0];
    assert.equal(updated.source, "inbound_stop"); assert.equal(updated.latest_message_sid, sid(90)); assert.equal(updated.provider_attempt_id, null);
  });
  await t.test("provider success followed by transaction failure leaves a durable reservation that cannot resend", async () => {
    const m = await member(); await consent(m);
    const reservation = await reserve(m);
    const failingSql = { begin: callback => db.transaction(async tx => { await callback(sqlFor(tx)); throw new Error("Lost database commit"); }) };
    let accepted = 0;
    await assert.rejects(() => repository.dispatchReservedMemberSms(failingSql, m, reservation, async () => { accepted++; return sid(999); }), /Lost database commit/);
    assert.equal((await service.sendMemberSmsReminder(m)).status, "duplicate");
    assert.equal(accepted, 1);
    assert.equal((await db.query("select status from private.member_sms_delivery_attempts where id=$1", [reservation.attemptId])).rows[0].status, "dispatching");
  });
  await t.test("private transport tables enable RLS and reject browser roles", async () => {
    const rows = (await db.query("select relname,relrowsecurity from pg_class where relnamespace='private'::regnamespace and relkind='r'")).rows;
    assert.equal(rows.length, 3); assert.ok(rows.every(row => row.relrowsecurity));
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => db.query("select * from private.member_sms_phone_suppressions"));
      await db.exec("reset role");
    }
  });
});
