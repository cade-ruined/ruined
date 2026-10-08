import assert from "node:assert/strict";
import test from "node:test";
import twilio from "twilio";
import { PGlite } from "@electric-sql/pglite";
import { configuration, id, loader, read, sid, sqlFor } from "./helpers/member-sms-fixture.mjs";

const env = { ...configuration(), MEMBER_SMS_ENABLED: "false" };
const endpoint = `${env.TWILIO_WEBHOOK_BASE_URL}/api/twilio/status?attempt=${id(1)}`;
const values = (overrides = {}) => ({ AccountSid: env.TWILIO_ACCOUNT_SID, MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
  From: env.TWILIO_PHONE_NUMBER, To: "+12025550123", MessageSid: sid(1), MessageStatus: "delivered", ...overrides });
function request(params = values(), options = {}) {
  const headers = { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": twilio.getExpectedTwilioSignature(
    options.token ?? env.TWILIO_AUTH_TOKEN, options.signingUrl ?? endpoint, params), ...options.headers };
  return new Request(options.url ?? endpoint, { method: "POST", headers, body: options.body ?? new URLSearchParams(params).toString() });
}
function routeFixture(options = {}) {
  const received = [];
  const actual = loader(env)("src/lib/communications/member-sms-delivery-status.ts");
  const load = loader(options.env ?? env, {
    "@/lib/database/server": { getApplicationDatabase: () => ({}) },
    "@/lib/communications/member-sms-delivery-status": { ...actual, applyMemberSmsDeliveryStatus: async (_sql, event) => {
      if (options.failed) throw new Error(`Sensitive fixture ${env.TWILIO_AUTH_TOKEN}`);
      received.push(event); return { matched: !options.unknown, changed: true };
    } },
  });
  return { received, POST: load("app/api/twilio/status/route.ts").POST };
}

test("signed delivery callbacks work with sending off and require canonical attempt, sender and account", async () => {
  const app = routeFixture();
  assert.equal((await app.POST(request())).status, 204);
  assert.deepEqual(app.received[0], { attemptId: id(1), messageSid: sid(1), destination: "+12025550123", status: "delivered", errorCode: null });
  const rejected = [
    request(values(), { headers: { "x-twilio-signature": "" } }),
    request(values(), { token: "wrong" }),
    request(values({ AccountSid: `AC${"8".repeat(32)}` })),
    request(values({ MessagingServiceSid: `MG${"8".repeat(32)}` })),
    request(values({ From: "+12025550999" })), request(values({ To: "whatsapp:+12025550123" })),
    request(values({ MessageSid: "wrong" })), request(values({ MessageStatus: "read" })),
    request(values({ ErrorCode: "secret-error-text" })),
    request(values(), { signingUrl: endpoint.replace(id(1), id(2)) }),
    request(values(), { body: `${new URLSearchParams(values())}&MessageStatus=failed` }),
  ];
  for (const req of rejected) assert.equal((await app.POST(req)).status, 403);
  assert.equal(app.received.length, 1);
  assert.equal((await app.POST(request(values(), { url: `${endpoint}&unexpected=yes` }))).status, 400);
  assert.equal((await app.POST(request(values(), { url: endpoint.split("?")[0] }))).status, 400);
  assert.equal((await app.POST(request(values(), { headers: { "content-type": "application/json" } }))).status, 415);
  assert.equal((await app.POST(request(values(), { headers: { "content-length": "70000" } }))).status, 413);
  assert.equal((await routeFixture({ unknown: true }).POST(request())).status, 404);
  assert.equal((await routeFixture({ failed: true }).POST(request())).status, 503);
  assert.equal((await routeFixture({ env: {} }).POST(request())).status, 503);
});

test("delivery state records known messages monotonically and never dispatches or reenrolls", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated;
    create table experiences(id uuid primary key);
    create table ruined_members(id uuid primary key,person_id uuid,membership_state text,deleted_at timestamptz);
    create table person_private_profiles(person_id uuid primary key,mobile_e164 text);
    create table member_consents(id bigint generated always as identity primary key,member_id uuid,consent_type text,
      policy_version text,decision text,accepted_at timestamptz,source text,actor_auth_user_id uuid,evidence jsonb,dedupe_key text unique);`);
  await db.exec(read("db/migrations/20261008220000_member_sms_transport.sql"));
  await db.exec(read("db/migrations/20261008230000_member_sms_automation.sql"));
  const apply = loader(env)("src/lib/communications/member-sms-delivery-status.ts").applyMemberSmsDeliveryStatus;
  const sql = sqlFor(db), phone = "+12025550123";
  for (const n of [1, 2]) {
    await db.query("insert into ruined_members values($1,$2,'active',null)", [id(n), id(n + 100)]);
    await db.query("insert into person_private_profiles values($1,$2)", [id(n + 100), phone]);
  }
  let nextAttempt = 1;
  async function attempt(status = "accepted") {
    const n = nextAttempt++;
    await db.query(`insert into private.member_sms_delivery_attempts(id,member_id,reminder_key,reminder_kind,destination_e164,body_sha256,status,twilio_message_sid,blocked_reason)
      values($1,$2,$3,'call_reminder',$4,$5,$6,$7,$8)`, [id(n + 1000), id(1), `call:${n}`, phone, "a".repeat(64), status,
      status === "accepted" ? sid(n) : null, status === "blocked" ? "source_ineligible" : null]);
    return { attemptId: id(n + 1000), messageSid: sid(n), destination: phone, status: "queued", errorCode: null };
  }
  const event = await attempt();
  assert.deepEqual(await apply(sql, { ...event, attemptId: id(999) }), { matched: false, changed: false });
  assert.deepEqual(await apply(sql, { ...event, messageSid: sid(999) }), { matched: false, changed: false });
  assert.deepEqual(await apply(sql, { ...event, destination: "+12025550999" }), { matched: false, changed: false });
  for (const status of ["queued", "sending", "sent", "delivered"]) assert.deepEqual(await apply(sql, { ...event, status }), { matched: true, changed: true });
  for (const status of ["delivered", "sent", "failed", "undelivered", "queued"]) assert.deepEqual(await apply(sql, { ...event, status }), { matched: true, changed: false });
  const row = (await db.query("select * from private.member_sms_delivery_attempts where id=$1", [event.attemptId])).rows[0];
  assert.equal(row.status, "accepted"); assert.equal(row.delivery_status, "delivered"); assert.equal(row.twilio_message_sid, event.messageSid);
  for (const status of ["unknown", "dispatching"]) {
    const uncertain = await attempt(status);
    assert.deepEqual(await apply(sql, { ...uncertain, status: "delivered" }), { matched: true, changed: true });
    const recovered = (await db.query("select * from private.member_sms_delivery_attempts where id=$1", [uncertain.attemptId])).rows[0];
    assert.equal(recovered.status, "accepted"); assert.equal(recovered.delivery_status, "delivered");
  }
  const blocked = await attempt("blocked");
  assert.deepEqual(await apply(sql, { ...blocked, status: "delivered" }), { matched: false, changed: false });
  const failed = await attempt();
  assert.deepEqual(await apply(sql, { ...failed, status: "undelivered", errorCode: 30003 }), { matched: true, changed: true });
  assert.equal((await db.query("select delivery_status,delivery_error_code from private.member_sms_delivery_attempts where id=$1", [failed.attemptId])).rows[0].delivery_error_code, 30003);
  assert.equal((await db.query("select * from private.member_sms_phone_suppressions")).rows.length, 0);
  const optedOut = await attempt();
  await db.query("update person_private_profiles set mobile_e164='+12025550999' where person_id=$1", [id(101)]);
  assert.deepEqual(await apply(sql, { ...optedOut, status: "queued", errorCode: 21610 }), { matched: true, changed: true });
  assert.equal((await db.query("select * from private.member_sms_phone_suppressions")).rows.length, 0);
  assert.deepEqual(await apply(sql, { ...optedOut, status: "failed" }), { matched: true, changed: true });
  const stopped = { ...optedOut, status: "failed", errorCode: 21610 };
  assert.deepEqual(await apply(sql, stopped), { matched: true, changed: true });
  assert.deepEqual(await apply(sql, stopped), { matched: true, changed: false });
  const suppressed = (await db.query("select * from private.member_sms_phone_suppressions")).rows;
  assert.equal(suppressed.length, 1); assert.equal(suppressed[0].phone_e164, phone);
  const withdrawn = (await db.query("select member_id,decision from member_consents")).rows;
  assert.deepEqual(withdrawn, [{ member_id: id(2), decision: "withdrawn" }]);
  assert.ok(!JSON.stringify({ row, suppressed, withdrawn }).includes(env.TWILIO_AUTH_TOKEN));
});
