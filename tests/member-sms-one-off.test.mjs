import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { oneOffFixture } from "./helpers/member-sms-one-off-fixture.mjs";
import { id, loader, sid } from "./helpers/member-sms-fixture.mjs";

const fails = (promise, status) => assert.rejects(promise, error => error.status === status);
const model = loader()("src/lib/communications/member-sms-one-off-model.ts");
test("one-off formatter fixes reviewed brand/footer and rejects invalid messages", () => {
  assert.equal(model.renderMemberSmsOneOffBody("  Hello\r\nMember  "), "Ruined: Hello\nMember\n\nReply STOP to unsubscribe or HELP for help.");
  for (const message of ["", " \n ", "a".repeat(901), "hello\u0000world"]) assert.throws(() => model.renderMemberSmsOneOffBody(message));
  assert.equal(model.isMemberSmsOneOffBody(model.renderMemberSmsOneOffBody("a".repeat(900))), true);
  assert.equal(model.isMemberSmsOneOffBody("Ruined: no footer"), false);
});

test("private recipient search is bounded, masks phone, excludes current withdrawals and requires ops_admin", async t => {
  const f = await oneOffFixture(); t.after(() => f.db.close());
  const allowed = await f.member(); await f.consent(allowed);
  const declined = await f.member(); await f.consent(declined); await f.consent(declined, { decision: "withdrawn" });
  const changed = await f.member(); await f.consent(changed);
  await f.db.query("update person_private_profiles set mobile_e164='+12025559999' where person_id=$1", [changed.personId]);
  const result = await f.service.searchMemberSmsOneOffRecipients(f.admin, "Test");
  assert.deepEqual(result.recipients.map(row => row.memberId), [allowed.memberId]);
  assert.equal(result.recipients[0].maskedPhone, `••• ${allowed.phone.slice(-4)}`);
  assert.equal(JSON.stringify(result).includes(allowed.phone), false);
  assert.doesNotMatch(f.queries.join("\n"), /\b(insert|update|delete)\b/i);
  await fails(f.service.searchMemberSmsOneOffRecipients(f.ordinary, "Test"), 403);
  await fails(f.service.searchMemberSmsOneOffRecipients(f.admin, ""), 400);
  for (let i = 0; i < 21; i++) { const m = await f.member(); await f.consent(m); }
  const bounded = await f.service.searchMemberSmsOneOffRecipients(f.admin, "Test");
  assert.equal(bounded.recipients.length, 20); assert.equal(bounded.hasMore, true);
});

test("review freezes one eligible recipient and exact body, audits actor, and replays its request identity once", async t => {
  const f = await oneOffFixture(); t.after(() => f.db.close());
  const m = await f.member(), consentId = await f.consent(m), requestId = id(9001);
  const a = await f.review(m, "  Welcome back.  ", requestId), b = await f.review(m, "  Welcome back.  ", requestId);
  assert.equal(a.review.id, b.review.id); assert.equal(f.calls.length, 0);
  const frozen = await f.row(a);
  assert.equal(frozen.actor_auth_user_id, f.admin); assert.equal(frozen.destination_e164, m.phone);
  assert.equal(String(frozen.consent_id), consentId); assert.equal(frozen.body_text, a.review.body);
  assert.equal(frozen.body_sha256, createHash("sha256").update(a.review.body).digest("hex"));
  assert.equal(+new Date(a.review.expiresAt) - +new Date(a.review.createdAt), 900000);
  await fails(f.review(m, "Changed", requestId), 409);
  await fails(f.service.reviewMemberSmsOneOff(f.ordinary, { memberId: m.memberId, message: "Hi", requestId: id(9002) }), 403);
  assert.deepEqual((await f.db.query("select reviews,sends from private.member_sms_one_off_limits")).rows, [{ reviews: 1, sends: 0 }]);
  assert.equal((await f.db.query("select count(*)::int as n from operator_audit_events")).rows[0].n, 1);
});

test("separate final send delivers exactly the frozen body once when automation is off, then records exact Activity", async t => {
  const f = await oneOffFixture(); t.after(() => f.db.close()); f.env.MEMBER_SMS_AUTOMATION_ENABLED = "false";
  const m = await f.member(); await f.consent(m); const reviewed = await f.review(m);
  const before = (await f.db.query("select count(*)::int as n from member_consents")).rows[0].n;
  await fails(f.service.sendMemberSmsOneOff(f.admin, { reviewId: reviewed.review.id, confirm: true, phone: m.phone }), 400);
  await fails(f.service.sendMemberSmsOneOff(f.admin, { reviewId: reviewed.review.id, confirm: false }), 400);
  const result = await f.send(reviewed); assert.equal(result.status, "accepted");
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].to, m.phone); assert.equal(f.calls[0].body, reviewed.review.body);
  assert.match(f.calls[0].statusCallback, new RegExp(`attempt=${result.attemptId}$`));
  assert.equal(result.deliveryStatus, null); assert.equal(Object.hasOwn(result, "messageSid"), false);
  assert.equal((await f.send(reviewed)).status, "duplicate"); assert.equal(f.calls.length, 1);
  const activity = await f.view();
  assert.equal(activity.history.items[0].kind, "one_off"); assert.equal(activity.history.items[0].body, reviewed.review.body);
  assert.equal(activity.history.items[0].actorName, "Administrator"); assert.equal(activity.oneOffRequests.items.length, 0);
  assert.equal((await f.db.query("select count(*)::int as n from member_consents")).rows[0].n, before);
  assert.deepEqual((await f.db.query("select reviews,sends from private.member_sms_one_off_limits")).rows, [{ reviews: 1, sends: 1 }]);
});

test("expired, disabled, wrong-owner and altered reviews fail before claiming", async t => {
  const f = await oneOffFixture(); t.after(() => f.db.close());
  const m = await f.member(); await f.consent(m); const reviewed = await f.review(m);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [f.ordinary]);
  await fails(f.service.sendMemberSmsOneOff(f.ordinary, { reviewId: reviewed.review.id, confirm: true }), 404);
  f.env.MEMBER_SMS_ENABLED = "false"; await fails(f.send(reviewed), 503); f.env.MEMBER_SMS_ENABLED = "true";
  await f.db.query("update private.member_sms_one_off_reviews set created_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes' where id=$1", [reviewed.review.id]);
  await fails(f.send(reviewed), 409);
  const altered = await f.review(m);
  await f.db.query("update private.member_sms_one_off_reviews set body_text='A tampered review' where id=$1", [altered.review.id]);
  await fails(f.send(altered), 409);
  assert.equal(f.calls.length, 0); assert.equal((await f.row(reviewed)).status, "reviewed"); assert.equal((await f.row(altered)).status, "reviewed");
});

for (const change of ["withdrawal", "fresh_consent", "phone", "suppression", "member_role", "email", "profile", "account"]) {
  test(`send rechecks ${change} and keeps blocked request visible without provider call`, async t => {
    const f = await oneOffFixture(); t.after(() => f.db.close());
    const m = await f.member(); await f.consent(m); const reviewed = await f.review(m);
    if (change === "withdrawal") await f.consent(m, { decision: "withdrawn" });
    if (change === "fresh_consent") await f.consent(m);
    if (change === "phone") await f.db.query("update person_private_profiles set mobile_e164='+12025559999' where person_id=$1", [m.personId]);
    if (change === "suppression") await f.db.query("insert into private.member_sms_phone_suppressions(phone_e164,latest_message_sid) values($1,$2)", [m.phone, sid(9)]);
    if (change === "member_role") await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [m.authId]);
    if (change === "email") await f.db.query("update person_email_addresses set verification_state='unverified' where person_id=$1", [m.personId]);
    if (change === "profile") await f.db.query("insert into member_registration_access(member_id,profile_activated_at) values($1,null)", [m.memberId]);
    if (change === "account") await f.db.query("update platform_users set status='suspended' where auth_user_id=$1", [m.authId]);
    const result = await f.send(reviewed);
    assert.equal(result.status, "blocked"); assert.equal(f.calls.length, 0); assert.equal(result.attemptId, null);
    const activity = await f.view(); assert.equal(activity.oneOffRequests.items[0].id, reviewed.review.id);
    assert.equal(activity.oneOffRequests.items[0].outcome, "blocked");
    assert.equal((await f.send(reviewed)).status, "duplicate"); assert.equal(f.calls.length, 0);
  });
}

for (const change of ["withdrawal", "admin_role", "recipient_role", "review_body"]) {
  test(`dispatch rechecks ${change} after the durable reservation`, async t => {
    const f = await oneOffFixture(); t.after(() => f.db.close());
    const m = await f.member(); await f.consent(m); const reviewed = await f.review(m);
    f.hooks.afterTransaction = async () => {
      const attempts = (await f.db.query("select count(*)::int as n from private.member_sms_delivery_attempts")).rows[0].n;
      if (!attempts) return;
      f.hooks.afterTransaction = null;
      if (change === "withdrawal") await f.consent(m, { decision: "withdrawn" });
      if (change === "admin_role") await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [f.admin]);
      if (change === "recipient_role") await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [m.authId]);
      if (change === "review_body") await f.db.query("update private.member_sms_one_off_reviews set body_text=body_text||' altered' where id=$1", [reviewed.review.id]);
    };
    const result = await f.send(reviewed); assert.equal(result.status, "blocked"); assert.equal(f.calls.length, 0);
    const attempt = (await f.db.query("select status,blocked_reason from private.member_sms_delivery_attempts")).rows[0];
    assert.equal(attempt.status, "blocked"); assert.equal(attempt.blocked_reason, change === "withdrawal" ? "no_current_consent" : change === "recipient_role" ? "member_inactive" : "source_ineligible");
  });
}

test("provider timeout remains unknown, and replay never sends another copy", async t => {
  const f = await oneOffFixture(); t.after(() => f.db.close());
  const m = await f.member(); await f.consent(m); const reviewed = await f.review(m);
  f.provider.error = new Error("private provider body and credentials must not be returned");
  const result = await f.send(reviewed); assert.equal(result.status, "unknown"); assert.ok(result.attemptId);
  assert.doesNotMatch(JSON.stringify(result), /private provider/);
  assert.equal((await f.send(reviewed)).status, "duplicate"); assert.equal(f.calls.length, 1);
  assert.equal((await f.view()).history.items[0].status, "unknown");
});

test("a claim interrupted before attempt reservation remains visible and cannot be retried", async t => {
  const f = await oneOffFixture(); t.after(() => f.db.close());
  const m = await f.member(); await f.consent(m); const reviewed = await f.review(m);
  const service = loader(f.env, { ...f.overrides, "./member-sms-service": { sendMemberSmsReminder: async () => { throw new Error("interrupted"); } } })("src/lib/communications/member-sms-one-off.ts");
  const result = await service.sendMemberSmsOneOff(f.admin, { reviewId: reviewed.review.id, confirm: true });
  assert.equal(result.status, "unknown"); assert.equal(result.attemptId, null);
  assert.equal((await f.send(reviewed)).status, "duplicate"); assert.equal(f.calls.length, 0);
  const activity = await f.view(); assert.equal(activity.oneOffRequests.items[0].id, reviewed.review.id); assert.equal(activity.oneOffRequests.items[0].outcome, "unknown");
});

test("rate limits roll back reviews beyond the limit and replay does not spend another slot", async t => {
  const f = await oneOffFixture(); t.after(() => f.db.close());
  const m = await f.member(); await f.consent(m); const reviewed = await f.review(m, "Hi", id(9950));
  await f.db.exec("update private.member_sms_one_off_limits set reviews=30,sends=30");
  assert.equal((await f.review(m, "Hi", id(9950))).review.id, reviewed.review.id);
  await fails(f.review(m, "Another"), 429); await fails(f.send(reviewed), 429);
  assert.equal((await f.row(reviewed)).status, "reviewed"); assert.equal(f.calls.length, 0);
  assert.equal((await f.db.query("select count(*)::int as n from private.member_sms_one_off_reviews")).rows[0].n, 1);
});

test("private review and rate tables deny anonymous/authenticated reads and row level security stays enabled", async t => {
  const f = await oneOffFixture(); t.after(() => f.db.close());
  const rows = (await f.db.query(`select c.relname,c.relrowsecurity,
    has_table_privilege('anon',c.oid,'SELECT') as anon,has_table_privilege('authenticated',c.oid,'SELECT') as authenticated
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('member_sms_one_off_reviews','member_sms_one_off_limits')`)).rows;
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.relrowsecurity && !row.anon && !row.authenticated));
});

test("concurrent final submissions share one durable attempt and one provider request", async t => {
  const f = await oneOffFixture(); t.after(() => f.db.close());
  const m = await f.member(); await f.consent(m); const reviewed = await f.review(m);
  const results = await Promise.all([f.send(reviewed), f.send(reviewed)]);
  assert.equal(results.filter(result => result.status === "accepted").length, 1);
  assert.equal(results.filter(result => result.status === "duplicate").length, 1);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.db.query("select count(*)::int as n from private.member_sms_delivery_attempts")).rows[0].n, 1);
});

test("one-off attempts use existing delivery callbacks and unknown claims without attempts remain visible", async t => {
  const f = await oneOffFixture(); t.after(() => f.db.close());
  const m = await f.member(); await f.consent(m); const reviewed = await f.review(m), result = await f.send(reviewed);
  const apply = f.load("src/lib/communications/member-sms-delivery-status.ts").applyMemberSmsDeliveryStatus;
  assert.deepEqual(await apply(f.sql, { attemptId: result.attemptId, messageSid: sid(1), destination: m.phone, status: "delivered", errorCode: null }), { matched: true, changed: true });
  assert.equal((await f.view()).history.items[0].deliveryStatus, "delivered");
  const claimed = await f.review(m, "A separate reviewed request");
  await f.db.query("update private.member_sms_one_off_reviews set status='claimed',claimed_at=now() where id=$1", [claimed.review.id]);
  assert.equal((await f.send(claimed)).status, "duplicate"); assert.equal(f.calls.length, 1);
  const activity = await f.view(); assert.equal(activity.oneOffRequests.items[0].status, "claimed"); assert.equal(activity.oneOffRequests.items[0].outcome, null);
});

test("raw one-off transport refuses calls without the reviewed-source guard", async t => {
  const f = await oneOffFixture(); t.after(() => f.db.close());
  const m = await f.member(), consentId = await f.consent(m), reviewed = await f.review(m);
  const input = { memberId: m.memberId, kind: "one_off", expectedConsentId: consentId, reminderKey: `one-off:${reviewed.review.id}`,
    oneOff: { reviewId: reviewed.review.id, actorAuthUserId: f.admin, body: reviewed.review.body } };
  const direct = f.load("src/lib/communications/member-sms-service.ts");
  const repository = f.load("src/lib/communications/member-sms-repository.ts");
  assert.deepEqual(await direct.sendMemberSmsReminder(input), { status: "blocked", reason: "source_ineligible" });
  assert.deepEqual(await repository.reserveMemberSmsAttempt(f.sql, input, reviewed.review.body), { status: "blocked", reason: "source_ineligible" });
  assert.equal(f.calls.length, 0); assert.equal((await f.db.query("select count(*)::int as n from private.member_sms_delivery_attempts")).rows[0].n, 0);
});
