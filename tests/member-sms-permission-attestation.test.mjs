import assert from "node:assert/strict";
import test from "node:test";
import { operationsFixture } from "./helpers/member-sms-operations-fixture.mjs";
import { seedMemberSmsPaidReservation } from "./helpers/member-sms-funding-fixture.mjs";
import { taggedSqlBridge } from "./helpers/postgres-fragments.mjs";
import { id, loader, read, sid } from "./helpers/member-sms-fixture.mjs";

function bridge(db, queries) {
  const sql = taggedSqlBridge(async (text, values) => { queries.push(text); return (await db.query(text, values)).rows; });
  sql.json = JSON.stringify;
  sql.begin = (options, callback) => db.transaction(async tx => {
    if (typeof options === "string") { assert.ok(["isolation level repeatable read read only", "read only"].includes(options)); await tx.exec("set transaction read only"); }
    return (callback ?? options)(bridge(tx, queries));
  });
  return sql;
}
async function fixture(t) {
  const f = await operationsFixture(); t.after(() => f.db.close());
  await f.db.exec(`create table operator_audit_events(id uuid primary key default gen_random_uuid(),actor_auth_user_id uuid,
    action text,subject_type text,subject_id text,member_id uuid,metadata jsonb,dedupe_key text unique)`);
  await f.db.query("insert into people values($1,'active')", [id(9000)]);
  await f.db.query("update platform_users set person_id=$1 where auth_user_id=$2", [id(9000), f.admin]);
  await f.db.exec(read("db/migrations/20261008210000_member_sms_phone_consent.sql"));
  const queries = [], sql = bridge(f.db, queries), load = loader(f.env, { "@/lib/database/server": { getApplicationDatabase: () => sql } });
  const service = load("src/lib/communications/member-sms-permission-attestation.ts");
  const repository = load("src/lib/communications/member-sms-repository.ts");
  const eligible = member => load("src/lib/communications/member-sms-eligibility.ts").memberSmsFundedEligible(sql, member.memberId);
  const preview = members => service.previewMemberSmsPermissionAttestation(f.admin, members.map(m => m.memberId));
  let batchSequence = 9100;
  const batch = async members => ({ batchId: id(batchSequence++), approvalReference: "Explicit operator approval in isolated test",
    permissionStatement: "I have explicit SMS permission from those members", targets: (await preview(members)).map(m => ({ memberId: m.memberId, phone: m.phone, expectedConsentId: m.expectedConsentId })) });
  const attest = input => service.attestMemberSmsPermissions(f.admin, input);
  const allowed = async m => (await preview([m]))[0].needsAttestation === false;
  return { ...f, queries, sql, load, service, repository, eligible, preview, batch, attest, allowed };
}
const rejected = (promise, status) => assert.rejects(promise, error => error.status === status);

test("bounded permission batch preserves history, records honest actor evidence and is idempotent without sending", async t => {
  const f = await fixture(t), existing = await f.member(), legacy = await f.member(), empty = await f.member(), declined = await f.member();
  const yes = await f.consent(existing), old = await f.consent(legacy, { version: "membership-reminders-v1" });
  const no = await f.consent(declined, { decision: "withdrawn", evidence: { requested: false } });
  const original = (await f.db.query("select * from member_consents order by id")).rows;
  f.queries.length = 0;
  const input = await f.batch([existing, legacy, empty, declined]);
  assert.doesNotMatch(f.queries.join("\n"), /\b(insert|update|delete)\b|for\s+(share|update)|ruined_lock_/i);
  const result = await f.attest(input);
  assert.deepEqual(result.unchanged, [{ memberId: existing.memberId, consentId: yes }]);
  assert.equal(result.recorded.length, 3);
  assert.deepEqual((await f.db.query("select * from member_consents where id<= $1 order by id", [no])).rows, original);
  const newRows = (await f.db.query("select * from member_consents where source='ops' order by id")).rows;
  for (const row of newRows) {
    assert.equal(row.policy_version, "membership-sms-operator-attestation-v1"); assert.equal(row.actor_auth_user_id, f.admin);
    assert.equal(row.evidence.action, "operator_sms_permission_attested"); assert.equal(row.evidence.memberAffirmed, false);
    assert.equal(row.evidence.permissionConfirmed, true); assert.equal(row.evidence.marketingConsent, false);
    assert.equal(row.evidence.permissionStatement, input.permissionStatement); assert.equal(Object.hasOwn(row.evidence, "termsVersion"), false);
    assert.equal(Object.hasOwn(row.evidence, "skipInitialConfirmation"), false);
    assert.ok(Date.now() - +new Date(row.accepted_at) < 10000);
  }
  assert.deepEqual(newRows.map(row => row.evidence.originalConsentId), [old, null, no]);
  assert.deepEqual(await f.attest(input), result);
  await rejected(f.attest({ ...input, permissionStatement: "Different approval" }), 409);
  assert.equal((await f.db.query("select count(*)::int as n from member_consents")).rows[0].n, 6);
  assert.equal((await f.db.query("select count(*)::int as n from private.member_sms_delivery_attempts")).rows[0].n, 0);
  assert.equal((await f.db.query("select count(*)::int as n from private.member_sms_automation_jobs")).rows[0].n, 0);
  for (const m of [existing, legacy, empty, declined]) assert.equal(await f.allowed(m), true);
  await f.consent(legacy, { decision: "withdrawn", evidence: { requested: false } });
  await f.attest(input); assert.equal(await f.allowed(legacy), false, "old batch replay cannot restore a later withdrawal");
});

test("permission mutation requires active admin, exact latest consent and phone; any stale row rolls back whole batch", async t => {
  const f = await fixture(t), a = await f.member(), b = await f.member(), input = await f.batch([a, b]);
  await rejected(f.service.attestMemberSmsPermissions(f.ordinary, input), 403);
  await f.db.query("update people set status='inactive' where id=$1", [id(9000)]);
  await rejected(f.attest(input), 403);
  await f.db.query("update people set status='active' where id=$1", [id(9000)]);
  await f.consent(b, { decision: "withdrawn" });
  await rejected(f.attest(input), 409);
  assert.equal((await f.db.query("select count(*)::int as n from member_consents where source='ops'")).rows[0].n, 0);
  const fresh = await f.batch([a]);
  await f.db.query("update person_private_profiles set mobile_e164='+12025558888' where person_id=$1", [a.personId]);
  await rejected(f.attest(fresh), 409);
  for (const invalid of [{ ...fresh, ignored: true }, { ...fresh, targets: Array(51).fill(fresh.targets[0]) },
    { ...fresh, targets: [fresh.targets[0], fresh.targets[0]] }, { ...fresh, permissionStatement: " " },
    { ...fresh, targets: [{ ...fresh.targets[0], permissionConfirmed: true }] }]) await rejected(f.attest(invalid), 400);
  assert.equal((await f.db.query("select count(*)::int as n from operator_audit_events")).rows[0].n, 0);
});

test("attestation refuses STOP, held profile, unfunded access and changed identity without touching consent", async t => {
  const f = await fixture(t);
  for (const condition of ["stop", "held", "unfunded", "paused", "identity", "account", "member_role"]) {
    const m = await f.member(), input = await f.batch([m]);
    if (condition === "stop") await f.db.query("insert into private.member_sms_phone_suppressions(phone_e164,latest_message_sid) values($1,$2)", [m.phone, sid(1)]);
    if (condition === "held") await f.db.query("insert into member_registration_access(member_id) values($1)", [m.memberId]);
    if (condition === "unfunded") await f.db.query("update member_lifecycle set billing_state='pending' where member_id=$1", [m.memberId]);
    if (condition === "paused") await f.db.query("update member_lifecycle set standing_state='paused' where member_id=$1", [m.memberId]);
    if (condition === "identity") await f.db.query("update person_email_addresses set verification_state='unverified' where person_id=$1", [m.personId]);
    if (condition === "account") await f.db.query("update platform_users set status='suspended' where auth_user_id=$1", [m.authId]);
    if (condition === "member_role") await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [m.authId]);
    assert.equal((await f.preview([m]))[0].eligible, false, condition);
    await rejected(f.attest(input), 409);
  }
  assert.equal((await f.db.query("select count(*)::int as n from member_consents")).rows[0].n, 0);
});

test("operator evidence uses strict booleans and destination; phone changes and STOP remain authoritative", async t => {
  const f = await fixture(t), m = await f.member();
  const result = await f.attest(await f.batch([m])), consentId = result.recorded[0].consentId;
  const row = (await f.db.query("select * from member_consents where id=$1", [consentId])).rows[0];
  for (const patch of [{ permissionConfirmed: "true" }, { memberAffirmed: true }, { operatorApproved: "true" },
    { approvalReference: " " }, { originalConsentId: true }, { requested: "true" }, { destination: "+12025558888" }]) {
    const other = await f.member();
    await f.db.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence)
      values($1,'communications',$2,'accepted',now(),'ops',$3,$4)`, [other.memberId, row.policy_version, f.admin,
      JSON.stringify({ ...row.evidence, destination: other.phone, ...patch })]);
    assert.equal(await f.allowed(other), false);
  }
  await f.db.query("update person_private_profiles set mobile_e164='+12025557777' where person_id=$1", [m.personId]);
  await f.db.query("update person_private_profiles set mobile_e164=$2 where person_id=$1", [m.personId, m.phone]);
  assert.equal(await f.allowed(m), false, "restoring number cannot revive earlier permission");
  assert.equal((await f.db.query("select decision from member_consents where id=$1", [consentId])).rows[0].decision, "accepted");
  await f.attest(await f.batch([m]));
  await f.repository.applyMemberSmsInbound(f.sql, { messageSid: sid(2), phone: m.phone, kind: "STOP" });
  assert.equal((await f.preview([m]))[0].eligible, false);
  await rejected(f.attest(await f.batch([m])), 409);
});

test("released pre-active prepaid and complimentary funding qualify without membership-state writes", async t => {
  const f = await fixture(t), paid = await f.member(), comp = await f.member();
  await seedMemberSmsPaidReservation(f.db, { memberId: paid.memberId, personId: paid.personId, reservation: id(9201), contract: id(9202) });
  await f.db.query("update ruined_members set membership_state='pending' where id=$1", [comp.memberId]);
  await f.db.query("update member_lifecycle set billing_state='pending',standing_state='pre_active' where member_id=$1", [comp.memberId]);
  await f.db.query("insert into member_complimentary_grants(member_id) values($1)", [comp.memberId]);
  assert.equal(await f.eligible(paid), true); assert.equal(await f.eligible(comp), true);
  const result = await f.attest(await f.batch([paid, comp])); assert.equal(result.recorded.length, 2);
  assert.deepEqual((await f.db.query("select membership_state from ruined_members order by id")).rows, [{ membership_state: "pending" }, { membership_state: "pending" }]);
  const input = { memberId: paid.memberId, kind: "call_reminder", reminderKey: "funded-test", expectedConsentId: result.recorded.find(r => r.memberId === paid.memberId).consentId };
  const reservation = await f.repository.reserveMemberSmsAttempt(f.sql, input, "Fixture body"); assert.ok(reservation.attemptId);
  await f.db.query("update stripe_membership_prepaid_proofs set amount_refunded=100 where reservation_id=$1", [id(9201)]);
  assert.equal((await f.repository.dispatchReservedMemberSms(f.sql, input, reservation, () => assert.fail("Refunded proof must block"))).reason, "member_inactive");
  await f.db.query("update member_complimentary_grants set ends_at=now()-interval '1 minute' where member_id=$1", [comp.memberId]);
  assert.equal(await f.eligible(comp), false);
});

test("funding revocation, canceled stale active projection and shared prepaid recipient are checked from authoritative evidence", async t => {
  const f = await fixture(t);
  for (const change of ["refund", "review", "canceled", "checkout", "participant", "due_cancel", "ended"]) {
    const m = await f.member(), n = 9300 + ["refund", "review", "canceled", "checkout", "participant", "due_cancel", "ended"].indexOf(change) * 2;
    const proof = await seedMemberSmsPaidReservation(f.db, { memberId: m.memberId, personId: m.personId, reservation: id(n), contract: id(n + 1) });
    assert.equal(await f.eligible(m), true);
    if (change === "refund") await f.db.query("update stripe_membership_prepaid_proofs set refund_state='refunded' where reservation_id=$1", [proof.reservation]);
    if (change === "review") await f.db.query("update stripe_membership_prepaid_proofs set review_reason='needs review' where reservation_id=$1", [proof.reservation]);
    if (change === "canceled") await f.db.query("update stripe_subscriptions set stripe_status='canceled' where id=$1", [proof.subscription]);
    if (change === "checkout") await f.db.query("update stripe_checkout_attempts set status='failed' where id=$1", [proof.reservation]);
    if (change === "due_cancel") await f.db.query("update stripe_subscriptions set cancel_at=now()-interval '1 minute' where id=$1", [proof.subscription]);
    if (change === "ended") await f.db.query("insert into membership_enrollment_episodes values($1,$2,now())", [proof.reservation,m.memberId]);
    if (change === "participant") await f.db.query("delete from membership_commercial_participants where member_id=$1", [m.memberId]);
    assert.equal(await f.eligible(m), false, change);
  }
  const payer = await f.member(), partner = await f.member();
  const proof = await seedMemberSmsPaidReservation(f.db, { memberId: payer.memberId, personId: payer.personId, reservation: id(9400), contract: id(9401) });
  await f.db.query("update membership_commercial_reservations set kind='couple' where id=$1", [proof.reservation]);
  await f.db.query("update member_lifecycle set billing_state='pending',standing_state='pre_active' where member_id=$1", [partner.memberId]);
  await f.db.query("insert into member_registration_access(member_id,profile_activated_at,payment_setup_account_id,payment_setup_livemode) values($1,now(),'acct_fixture',true)", [partner.memberId]);
  await f.db.query("insert into membership_commercial_participants values($1,$2,$3)", [proof.reservation, partner.memberId, partner.personId]);
  assert.equal(await f.eligible(partner), true, "paid proof belongs to payer, but current registered partner qualifies");
  await f.attest(await f.batch([partner]));
  for (const account of ['closed','suspended']) {
    await f.db.query("update member_lifecycle set account_state=$2 where member_id=$1", [payer.memberId,account]);
    assert.equal(await f.eligible(partner),false,"unavailable payer cannot fund a shared prepaid reminder");
  }
  await f.db.query("update member_lifecycle set account_state='active',standing_state='cancellation_requested',cancellation_effective_at=now()-interval '1 minute' where member_id=$1", [payer.memberId]);
  assert.equal(await f.eligible(partner),false,"effective payer cancellation blocks shared prepaid proof");
  await f.db.query("update member_lifecycle set standing_state='pre_active',cancellation_effective_at=null where member_id=$1", [payer.memberId]);
  assert.equal(await f.eligible(partner),true);
  await f.db.query("update membership_commercial_reservations set status='activated',created_at=now() where id=$1", [proof.reservation]);
  await f.db.query("update member_lifecycle set billing_state='active' where member_id=$1", [payer.memberId]);
  await f.db.query("update stripe_subscriptions set stripe_status='canceled' where id=$1", [proof.subscription]);
  assert.equal(await f.eligible(payer), false, "stale active projection cannot override current cancellation");
  assert.equal(await f.eligible(partner), false);
});

test("operator consent enters normal confirmation and permitted-call automation exactly once, and one-off selection recognizes it", async t => {
  const f = await fixture(t), m = await f.member();
  await seedMemberSmsPaidReservation(f.db, { memberId: m.memberId, personId: m.personId, reservation: id(9500), contract: id(9501) });
  const consentId = (await f.attest(await f.batch([m]))).recorded[0].consentId;
  const event = await f.event({ startsAt: f.ago(-148), title: "Foundations First Call" });
  await f.db.query("update experiences set visibility='invite_only',registration_mode='internal' where id=$1", [event.eventId]);
  await f.db.query("insert into private.member_email_cadence_event_bindings values($1,'foundations_01')", [event.eventId]);
  await f.db.query("insert into experience_registrations(experience_id,person_id,member_id,status,source) values($1,$2,$3,'registered','ops')", [event.eventId, m.personId, m.memberId]);
  const sends = [], load = loader(f.env, {
    "@/lib/database/server": { getApplicationDatabase: () => f.sql },
    twilio: () => ({ messages: { create: async message => { sends.push(message); return { sid: sid(sends.length + 50) }; } } }),
  });
  const oneOff = load("src/lib/communications/member-sms-one-off.ts");
  assert.deepEqual((await oneOff.searchMemberSmsOneOffRecipients(f.admin, "Test")).recipients.map(r => r.memberId), [m.memberId]);
  const automation = load("src/lib/communications/member-sms-automation.ts");
  await automation.runMemberSmsAutomation();
  assert.equal(sends.length, 2, "normal consent confirmation and one permitted upcoming call");
  const attempts = (await f.db.query("select reminder_kind,consent_id::text,status from private.member_sms_delivery_attempts order by created_at")).rows;
  assert.deepEqual(attempts.map(a => a.reminder_kind), ["opt_in_confirmation", "call_reminder"]);
  for (const attempt of attempts) { assert.equal(attempt.consent_id, consentId); assert.equal(attempt.status, "accepted"); }
  await automation.runMemberSmsAutomation(); assert.equal(sends.length, 2, "no duplicate confirmation or call");
  assert.deepEqual((await f.db.query("select membership_state from ruined_members where id=$1", [m.memberId])).rows, [{ membership_state: "pending" }]);
});


test("transport chooses numeric latest consent across digit boundaries, never the id text output alias", async t => {
  const f = await fixture(t), accepted = await f.member();
  await f.db.exec("alter table member_consents alter column id restart with 9");
  assert.equal(await f.consent(accepted, { version: "membership-reminders-v1" }), "9");
  await f.db.exec("alter table member_consents alter column id restart with 100");
  const result = await f.attest(await f.batch([accepted]));
  assert.equal(result.recorded[0].consentId, "100");
  // PGlite executes PostgreSQL's output-alias ORDER BY semantics, not a SQL mock.
  assert.equal((await f.db.query("select id::text from member_consents where member_id=$1 order by id desc limit 1", [accepted.memberId])).rows[0].id, "9");
  const confirmation = { memberId: accepted.memberId, kind: "opt_in_confirmation", expectedConsentId: "100", reminderKey: "consent:100" };
  const reservation = await f.repository.reserveMemberSmsAttempt(f.sql, confirmation, "Fixture confirmation");
  assert.equal(reservation.consentId, "100", "numeric 100 must outrank text-sorted 9");
  assert.equal((await f.repository.dispatchReservedMemberSms(f.sql, confirmation, reservation, async () => sid(500))).status, "accepted");

  const withdrawn = await f.member();
  await f.db.exec("alter table member_consents alter column id restart with 99");
  assert.equal(await f.consent(withdrawn), "99");
  await f.db.exec("alter table member_consents alter column id restart with 101");
  assert.equal(await f.consent(withdrawn, { decision: "withdrawn", evidence: { requested: false } }), "101");
  assert.equal((await f.repository.reserveMemberSmsAttempt(f.sql,
    { memberId: withdrawn.memberId, kind: "call_reminder", reminderKey: "numeric-order-withdrawal" }, "Fixture call")).reason, "no_current_consent",
    "numeric 101 withdrawal must outrank old text-sorted 99 acceptance");
});
