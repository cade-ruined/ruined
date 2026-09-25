import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import test from "node:test";
import { fixture, first, newcomer, person, uuid, load, model } from "./helpers/personal-invitation-fixture.mjs";

const pricing = await load("src/lib/membership/pricing.ts");
const input = (id = 1, overrides = {}) => ({ requestId: uuid(5000 + id), recipientName: "Alex Direct", recipientEmail: newcomer.email, billingPlan: "monthly", ...overrides });
async function directFixture(t) {
  const f = await fixture(t);
  const repository = await load("src/lib/membership/direct-invitation-repository.ts", {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => f.sql },
    "./invitation-model": model, "./personal-invitation-model": f.personalModel, "./pricing": pricing,
  });
  const history = await load("src/lib/platform/ops-direct-invitations-repository.ts", {
    "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => f.sql },
    "@/lib/platform/ops-repository": f.ops,
  });
  const issue = (value = input()) => repository.issueRuinedDirectInvitation(value);
  const row = async id => (await f.db.query("select * from member_personal_invitations where id=$1", [id])).rows[0];
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [first.auth]);
  return { ...f, ...repository, ...history, issue, row };
}

async function accept(f, id, who = newcomer) {
  await f.db.query(`update member_personal_invitations set accepted_at=clock_timestamp(),accepted_by_auth_user_id=$2,
    accepted_member_id=$3,delivery_status='cancelled',next_attempt_at=null where id=$1`, [id, who.auth, who.member]);
}

test("direct signup creates one recipient-bound standard invitation with no member or referral and an exact 48-hour deadline", async t => {
  const f = await directFixture(t), result = await f.issue(input(1, { recipientName: "  Alex   Direct  ", recipientEmail: ` ${newcomer.email.toUpperCase()} ` }));
  assert.deepEqual(Object.keys(result).sort(), ["created", "invitationId"]);
  assert.equal(result.created, true);
  const row = await f.row(result.invitationId);
  assert.equal(row.origin, "ruined_direct"); assert.equal(row.member_id, null); assert.equal(row.membership_type, "standard");
  assert.equal(row.inviter_name, "Ruined"); assert.equal(row.inviter_tag, null); assert.equal(row.billing_plan, "monthly");
  assert.equal(row.recipient_name, "Alex Direct"); assert.equal(row.recipient_email_normalized, newcomer.email);
  assert.equal(new Date(row.expires_at) - new Date(row.issued_at), 48 * 60 * 60 * 1000);
  assert.equal(row.delivery_status, "queued"); assert.equal(row.accepted_at, null);
  assert.equal((await f.db.query("select * from member_referrals")).rows.length, 0);
  assert.equal((await f.db.query("select * from ruined_members where id=$1", [newcomer.member])).rows.length, 0);
  assert.equal((await f.personalRepository.getOwnPersonalInvitations(first.auth)).counts.created, 0);
  const publicInvite = await f.repository.getPublicMemberInvitation(row.public_token);
  assert.equal(publicInvite.card.name, "The Ruined Project"); assert.equal(publicInvite.invitationSource, "ruined_direct");
  assert.doesNotMatch(JSON.stringify(publicInvite), /recipientEmail|example\.test|requestId|billing_plan/);
});

test("direct creation rejects privilege injection and malformed recipient, plan or request identities", async t => {
  const f = await directFixture(t);
  for (const change of [{ requestId: "wrong" }, { recipientName: "" }, { recipientName: "X\nBcc: bad" },
    { recipientEmail: "X <x@example.test>" }, { recipientEmail: "x@example.test\r\n" }, { billingPlan: "free" },
    { memberId: first.member }, { origin: "member" }, { membershipType: "complimentary" }, { sendEmail: false }]) {
    await assert.rejects(f.issue(input(1, change)), { status: 400 });
  }
  assert.equal((await f.db.query("select * from member_personal_invitations")).rows.length, 0);
});

test("retries preserve the original name, plan, token and fixed deadline without duplicating email work", async t => {
  const f = await directFixture(t), original = await f.issue(), before = await f.row(original.invitationId);
  assert.deepEqual(await f.issue(), { invitationId: original.invitationId, created: false });
  assert.deepEqual(await f.issue(input(2, { recipientName: "New Name", billingPlan: "annual" })), { invitationId: original.invitationId, created: false });
  assert.deepEqual(await f.row(original.invitationId), before);
  for (const change of [{ recipientName: "New Name" }, { recipientEmail: "other@example.test" }, { billingPlan: "annual" }]) {
    await assert.rejects(f.issue(input(1, change)), { status: 409 });
  }
  await f.db.query("update member_personal_invitations set revoked_at=clock_timestamp(),delivery_status='cancelled' where id=$1", [original.invitationId]);
  assert.equal((await f.issue()).created, false, "old request never revives a revoked invitation");
  const renewed = await f.issue(input(3));
  assert.equal(renewed.created, true); assert.notEqual(renewed.invitationId, original.invitationId);
  assert.notEqual((await f.row(renewed.invitationId)).public_token, before.public_token);
});

test("direct recipient eligibility blocks disabled, withdrawn, revoked and retired identities before queuing", async t => {
  const f = await directFixture(t); await f.addMember(newcomer, false, true);
  for (const [block, restore] of [
    ["update platform_users set status='disabled'", "update platform_users set status='active'"],
    ["update member_lifecycle set account_state='closed'", "update member_lifecycle set account_state='active'"],
    ["update member_lifecycle set admission_state='withdrawn'", "update member_lifecycle set admission_state='accepted'"],
    ["update platform_role_grants set revoked_at=now()", "update platform_role_grants set revoked_at=null"],
    ["update people set status='inactive'", "update people set status='active'"],
  ]) {
    await f.db.exec(block); assert.equal(await f.issue(), null); await f.db.exec(restore);
  }
  assert.equal((await f.db.query("select * from member_personal_invitations")).rows.length, 0);
});

test("schema pins direct origin, plan, brand and paid-only terms while preserving member invitation behavior", async t => {
  const f = await directFixture(t), direct = await f.issue();
  for (const patch of ["origin='member',member_id='" + first.member + "'", "billing_plan='annual'", "inviter_name='Someone'", "expires_at=expires_at+interval '1 day'", "member_id='" + first.member + "'", "membership_type='complimentary'", "direct_joined_at=now()"] ) {
    await assert.rejects(f.db.query(`update member_personal_invitations set ${patch} where id=$1`, [direct.invitationId]));
  }
  const token = (await f.row(direct.invitationId)).public_token;
  await assert.rejects(f.submit(newcomer, token), { code: "P4100" });
  const personal = await f.personalRepository.createOwnPersonalInvitation(first.auth, { requestId: uuid(6500), recipientName: "Alex", recipientEmail: newcomer.email, sendEmail: false });
  await f.submit(newcomer, personal.invitations[0].url.split("/").pop());
  assert.equal((await f.db.query("select * from member_referrals")).rows[0].inviter_member_id, first.member);
});

test("verified acceptance is separate from paid joining, direct conversions persist after cancellation and never steal referrals", async t => {
  const f = await directFixture(t), invitation = await f.issue();
  await f.addMember(newcomer, false, false);
  await assert.rejects(accept(f, invitation.invitationId), { code: "P4100" });
  await f.db.query("update person_email_addresses set verification_state='verified' where person_id=$1", [newcomer.person]);
  await accept(f, invitation.invitationId);
  let row = await f.row(invitation.invitationId);
  assert.ok(row.accepted_at); assert.equal(row.direct_joined_at, null);
  assert.deepEqual(await f.issue(input(2)), { invitationId: invitation.invitationId, created: false });
  await f.activate(newcomer);
  row = await f.row(invitation.invitationId); assert.ok(row.direct_joined_at);
  const joined = row.direct_joined_at;
  await f.db.query("update member_lifecycle set billing_state='cancelled',standing_state='paused' where member_id=$1", [newcomer.member]);
  assert.deepEqual((await f.row(invitation.invitationId)).direct_joined_at, joined);
  await assert.rejects(f.db.query("update member_personal_invitations set direct_joined_at=null where id=$1", [invitation.invitationId]));
  assert.equal((await f.db.query("select * from member_referrals")).rows.length, 0);
  const history = await f.getOpsDirectInvitations(first.auth);
  assert.equal(history.counts.joined, 1); assert.equal(history.entries[0].status, "joined");
});

test("ops direct history is administrator-only, searchable, paginated and excludes ordinary member referrals", async t => {
  const f = await directFixture(t);
  const a = await f.issue(), b = await f.issue(input(2, { recipientEmail: "other@example.test", billingPlan: "annual", recipientName: "Second Person" }));
  await f.db.query("update member_personal_invitations set sent_at=clock_timestamp(),delivery_status='sent' where id=$1", [a.invitationId]);
  await f.db.query("update member_personal_invitations set delivery_status='failed' where id=$1", [b.invitationId]);
  await assert.rejects(f.getOpsDirectInvitations(person(2).auth), /administrator access/);
  const result = await f.getOpsDirectInvitations(first.auth, { query: "SECOND", page: 200 });
  assert.equal(result.query, "second"); assert.equal(result.totalResults, 1); assert.equal(result.page, 1);
  assert.equal(result.entries[0].status, "failed"); assert.equal(result.entries[0].sourceLabel, "Ruined Direct");
  assert.equal(result.entries[0].billingPlan, "annual"); assert.equal(result.counts.created, 2); assert.equal(result.counts.sent, 1);
  assert.doesNotMatch(JSON.stringify(result), /public_token|delivery_payload|request_id/);
});

test("expired direct invitations get a fresh request and lifetime while accepted and revoked history stay distinct", async t => {
  const f = await directFixture(t);
  const expiredId = uuid(8700);
  await f.db.query(`insert into member_personal_invitations(id,origin,member_id,request_id,public_token,recipient_name,
    recipient_email_normalized,inviter_name,email_requested,membership_type,billing_plan,issued_at,expires_at)
    values($1,'ruined_direct',null,$2,$3,'Expired Recipient',$4,'Ruined',true,'standard','monthly',
      statement_timestamp()-interval '49 hours',statement_timestamp()-interval '1 hour')`,
  [expiredId, uuid(8701), "E".repeat(43), newcomer.email]);
  assert.equal(await f.repository.getPublicMemberInvitation("E".repeat(43)), null);
  const replacement = await f.issue(input(2, { billingPlan: "annual" }));
  assert.equal(replacement.created, true);
  assert.equal((await f.row(replacement.invitationId)).billing_plan, "annual");
  await f.db.query("update member_personal_invitations set revoked_at=clock_timestamp() where id=$1", [replacement.invitationId]);
  const history = await f.getOpsDirectInvitations(first.auth);
  assert.equal(history.counts.expired, 1); assert.equal(history.counts.revoked, 1);
  assert.deepEqual(history.entries.map(row => row.status).sort(), ["expired", "revoked"]);
});

test("direct joining preserves pre-existing first member referral attribution and cannot duplicate one member's conversion", async t => {
  const f = await directFixture(t);
  const personal = await f.personalRepository.createOwnPersonalInvitation(first.auth, { requestId: uuid(8800), recipientName: "Alex", recipientEmail: newcomer.email, sendEmail: false });
  await f.submit(newcomer, personal.invitations[0].url.split("/").pop());
  const before = (await f.db.query("select * from member_referrals")).rows[0];
  const direct = await f.issue();
  await f.addMember(newcomer, false, true); await accept(f, direct.invitationId); await f.activate(newcomer);
  const after = (await f.db.query("select * from member_referrals")).rows[0];
  assert.equal(after.inviter_member_id, before.inviter_member_id); assert.equal(after.personal_invitation_id, before.personal_invitation_id);
  assert.ok(after.joined_at);
  const secondId = uuid(8801);
  await f.db.query(`insert into member_personal_invitations(id,origin,member_id,request_id,public_token,recipient_name,
    recipient_email_normalized,inviter_name,email_requested,membership_type,billing_plan)
    values($1,'ruined_direct',null,$2,$3,'Same Recipient',$4,'Ruined',true,'standard','monthly')`,
  [secondId, uuid(8802), "D".repeat(43), newcomer.email]);
  await assert.rejects(accept(f, secondId), { code: "23505" });
  assert.equal((await f.getOpsDirectInvitations(first.auth)).counts.joined, 1);
});

test("previously joined members cannot receive fresh direct acquisition invitations or be counted by later lifecycle updates", async t => {
  const f = await directFixture(t);
  assert.equal(await f.issue(input(20, { recipientEmail: first.email })), null);
  await f.db.query("update member_lifecycle set access_started_at=null where member_id=$1", [first.member]);
  assert.equal(await f.issue(input(21, { recipientEmail: first.email })), null, "completed paid legacy members are excluded even without their first-access date");
  assert.equal((await f.db.query("select * from member_personal_invitations")).rows.length, 0);
});

test("accepting an old pending direct card after joining through another route never creates a second acquisition", async t => {
  const f = await directFixture(t), invitation = await f.issue();
  await f.addMember(newcomer, true, true);
  await accept(f, invitation.invitationId);
  await f.db.query("update member_lifecycle set program_state='active' where member_id=$1", [newcomer.member]);
  assert.equal((await f.row(invitation.invitationId)).direct_joined_at, null);
  assert.equal((await f.getOpsDirectInvitations(first.auth)).counts.joined, 0);
  await assert.rejects(f.db.query("update member_personal_invitations set direct_joined_at=clock_timestamp() where id=$1", [invitation.invitationId]), /completed paid membership/);
});

test("a deleted recipient's accepted direct card stays unavailable after identity email addresses are erased", async t => {
  const f = await directFixture(t), invitation = await f.issue();
  const original = await f.row(invitation.invitationId);
  await f.addMember(newcomer, false, true); await accept(f, invitation.invitationId); await f.activate(newcomer);
  // Mirror the production deletion's identity anonymization. Merely setting
  // deleted_at while retaining the original email would miss this regression.
  await f.db.query("update ruined_members set deleted_at=clock_timestamp(),email_normalized=$2 where id=$1", [newcomer.member, `deleted+${newcomer.member}@members.invalid`]);
  await f.db.query("update platform_users set status='disabled',email_normalized=$2 where auth_user_id=$1", [newcomer.auth, `deleted+${newcomer.auth}@members.invalid`]);
  await f.db.query("delete from person_email_addresses where person_id=$1", [newcomer.person]);
  await f.db.query("update people set status='erased' where id=$1", [newcomer.person]);
  await f.db.query("update member_lifecycle set account_state='closed',standing_state='inactive' where member_id=$1", [newcomer.member]);
  assert.equal(await f.repository.getPublicMemberInvitation(original.public_token), null);
  const history = await f.getOpsDirectInvitations(first.auth);
  assert.equal(history.counts.joined, 1, "historical conversion remains operator-private");
  assert.equal(history.entries[0].acceptedMemberId, newcomer.member);
});
