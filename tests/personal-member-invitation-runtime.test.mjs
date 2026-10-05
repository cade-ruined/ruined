import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fixture, first, second, newcomer, person, uuid } from "./helpers/personal-invitation-fixture.mjs";

const input = (id = 1, overrides = {}) => ({ recipientName: "Alex Recipient", recipientEmail: newcomer.email, requestId: uuid(1000 + id), sendEmail: true, ...overrides });
const create = (f, value = input(), who = first) => f.personalRepository.createOwnPersonalInvitation(who.auth, value);
const token = invitation => invitation.url.split("/").pop();
async function insertExpired(f, overrides = {}) {
  const values = { id: uuid(800), request: uuid(801), token: "E".repeat(43), member: first.member, email: newcomer.email, ...overrides };
  await f.db.query(`insert into member_personal_invitations(id,member_id,request_id,public_token,recipient_name,recipient_email_normalized,inviter_name,email_requested,issued_at,expires_at)
    values($1,$2,$3,$4,'Expired Recipient',$5,'Member 1',false,statement_timestamp()-interval '49 hours',statement_timestamp()-interval '1 hour')`,
  [values.id, values.member, values.request, values.token, values.email]);
  return values;
}

test("recipient input rejects invalid addresses, control characters, identity injection and malformed idempotency keys", async t => {
  const f = await fixture(t);
  for (const change of [{ recipientName: " " }, { recipientName: "x".repeat(101) }, { recipientName: "Alex\nBcc: Other" },
    { recipientEmail: "Name <alex@example.test>" }, { recipientEmail: "alex@example.test\r\n" }, { recipientEmail: "not-an-email" },
    { requestId: "not-a-uuid" }, { sendEmail: "true" }, { memberId: second.member }]) {
    assert.throws(() => f.personalModel.validateCreatePersonalMemberInvitationInput(input(1, change)), { status: 400 });
  }
  assert.throws(() => f.personalModel.validatePersonalMemberInvitationVersionInput({ version: 1, recipientEmail: "else@example.test" }), { status: 400 });
});

test("personal invitations create independently, normalize recipient details, and expose only the intended name publicly", async t => {
  const f = await fixture(t);
  const initial = await f.personalRepository.getOwnPersonalInvitations(first.auth);
  assert.equal(initial.invitations.length, 0); assert.equal(initial.remainingToday, 20); assert.equal(initial.legacyInvitation, null);
  const one = await create(f, input(1, { recipientName: "  Alex   Recipient  ", recipientEmail: ` ${newcomer.email.toUpperCase()} ` }));
  const invite = one.invitations[0];
  assert.equal(invite.recipientName, "Alex Recipient"); assert.equal(invite.recipientEmail, newcomer.email);
  assert.equal(invite.deliveryStatus, "queued"); assert.equal(invite.version, 1); assert.equal(invite.submittedAt, null);
  assert.equal(invite.expiresAt, null);
  const two = await create(f, input(2, { recipientName: "Taylor", recipientEmail: "taylor@example.test", sendEmail: false }));
  assert.equal(two.invitations.length, 2); assert.equal(two.counts.created, 2); assert.equal(two.counts.active, 2);
  assert.equal(two.remainingToday, 18); assert.equal(two.invitations[0].deliveryStatus, "not_requested");
  assert.notEqual(two.invitations[0].url, invite.url);
  const pub = await f.repository.getPublicMemberInvitation(token(invite));
  assert.deepEqual(Object.keys(pub).sort(), ["card", "complimentaryEndsAt", "expiresAt", "membershipType", "recipientEmailRequired", "recipientName"]);
  assert.equal(pub.recipientEmailRequired, true);
  assert.equal(pub.recipientName, "Alex Recipient"); assert.equal(pub.expiresAt, invite.expiresAt);
  assert.doesNotMatch(JSON.stringify(pub), /member-3|example.test|recipientEmail"|PRIVATE|requestId|member_id/);
  assert.equal((await f.personalRepository.getOwnPersonalInvitations(second.auth)).invitations.length, 0);
  await f.db.query("update person_profiles set display_name='Updated Member',member_tag='updated' where person_id=$1", [first.person]);
  assert.equal((await f.repository.getPublicMemberInvitation(token(invite))).card.name, "Updated Member");
  assert.equal((await f.repository.getPublicMemberInvitation(token(invite))).expiresAt, invite.expiresAt);
});

test("phone-only invitations normalize contacts, keep a single token, and never expose recipient contact publicly", async t => {
  const f = await fixture(t);
  const value = input(1, { recipientEmail: "", recipientPhone: "(801) 555-0123", sendEmail: false });
  const invitation = (await create(f, value)).invitations[0];
  assert.equal(invitation.recipientEmail, "");
  assert.equal(invitation.recipientPhone, "+18015550123");
  assert.equal(invitation.requestId, value.requestId);
  assert.equal(invitation.deliveryStatus, "not_requested");
  assert.deepEqual((await create(f, { ...value, recipientPhone: "+1 801 555 0123" })).invitations[0], invitation);
  assert.equal(invitation.expiresAt, null);
  const pub = await f.repository.getPublicMemberInvitation(token(invitation));
  assert.equal(pub.recipientEmailRequired, false);
  assert.equal(pub.recipientName, value.recipientName);
  assert.doesNotMatch(JSON.stringify(pub), /801|555|recipientPhone|recipientEmail"|bound_at|requestId/);
  await assert.rejects(create(f, input(2, { recipientPhone: "+18015550123" })), { status: 409 });
  await assert.rejects(create(f, { ...value, recipientPhone: "+18015550999" }), { status: 409 });
  assert.equal((await f.db.query("select count(*)::int as count from member_personal_invitations")).rows[0].count, 1);
});

test("phone input requires a possible unambiguous number and complimentary or email delivery still needs an email", async t => {
  const f = await fixture(t);
  const valid = input(1, { recipientEmail: "", recipientPhone: "+44 20 7946 0018", sendEmail: false });
  assert.equal(f.personalModel.validateCreatePersonalMemberInvitationInput(valid).recipientPhone, "+442079460018");
  for (const recipientPhone of ["", "123", "+0 8015550123", "Call 801-555-0123", "8015550123 ext 42", "8015550123\n", "1".repeat(65), {}]) {
    assert.throws(() => f.personalModel.validateCreatePersonalMemberInvitationInput({ ...valid, recipientPhone }), { status: 400 });
  }
  assert.throws(() => f.personalModel.validateCreatePersonalMemberInvitationInput({ ...valid, sendEmail: true }), { status: 400 });
  assert.throws(() => f.personalModel.validateCreatePersonalMemberInvitationInput({ ...valid, membershipType: "complimentary", complimentaryReason: "Founding member" }), { status: 400 });
  const emailAndPhone = f.personalModel.validateCreatePersonalMemberInvitationInput(input(2, { recipientPhone: "+18015550123", membershipType: "complimentary", complimentaryReason: "Founding member" }));
  assert.equal(emailAndPhone.recipientEmail, newcomer.email);
  assert.equal(emailAndPhone.recipientPhone, "+18015550123");
});

test("unbound text links cannot bind an email through a waitlist submission or direct recipient edit", async t => {
  const f = await fixture(t);
  const invitation = (await create(f, input(1, { recipientEmail: "", recipientPhone: "+18015550123", sendEmail: false }))).invitations[0];
  await assert.rejects(f.submit(newcomer, token(invitation)), { code: "P4100" });
  for (const assignment of ["recipient_email_normalized='other@example.test'", "recipient_phone='+18015550999'", "recipient_email_bound_at=clock_timestamp()", "email_requested=true"]) {
    await assert.rejects(f.db.query(`update member_personal_invitations set ${assignment} where id=$1`, [invitation.id]));
  }
  assert.equal((await f.db.query("select * from membership_waitlist")).rows.length, 0);
  assert.equal((await f.db.query("select * from member_referrals")).rows.length, 0);
  assert.equal((await f.db.query("select * from integration_outbox")).rows.length, 0);
  assert.equal((await f.db.query("select recipient_email_normalized from member_personal_invitations where id=$1", [invitation.id])).rows[0].recipient_email_normalized, null);
  const { rows: [waitlist] } = await f.db.query("insert into membership_waitlist(name,email_normalized) values('Existing interest',$1) returning id", [newcomer.email]);
  await assert.rejects(f.db.query("select private.ruined_capture_member_referral($1,$2)", [waitlist.id, token(invitation)]), { code: "P4100" });
  await assert.rejects(f.db.query("select private.ruined_mark_personal_invitation_submission($1,$2)", [token(invitation), newcomer.email]), { code: "P4100" });
  assert.equal((await f.db.query("select * from member_referrals")).rows.length, 0);
  assert.equal((await f.db.query("select submitted_at from member_personal_invitations where id=$1", [invitation.id])).rows[0].submitted_at, null);
  await f.db.query("update ruined_members set deleted_at=clock_timestamp() where id=$1", [first.member]);
  assert.equal((await f.db.query("select * from member_personal_invitations")).rows.length, 0, "Member erasure also removes private phone destinations");
});

test("retrying phone invitation creation remains idempotent after verified email binding", async t => {
  const f = await fixture(t), value = input(1, { recipientEmail: "", recipientPhone: "+18015550123", sendEmail: false });
  const invitation = (await create(f, value)).invitations[0];
  await f.addMember(newcomer, false, true);
  await f.db.query("update member_personal_invitations set recipient_email_normalized=$2,recipient_email_bound_at=clock_timestamp(),accepted_at=clock_timestamp(),accepted_by_auth_user_id=$3,accepted_member_id=$4 where id=$1", [invitation.id, newcomer.email, newcomer.auth, newcomer.member]);
  const accepted = await f.personalRepository.getOwnPersonalInvitations(first.auth);
  const retry = await create(f, value);
  assert.deepEqual(retry, accepted);
  assert.equal(retry.invitations[0].recipientEmail, newcomer.email);
  assert.equal(retry.invitations[0].requestId, value.requestId);
  await assert.rejects(create(f, { ...value, recipientEmail: newcomer.email }), { status: 409 });
  const originallyEmail = input(2, { recipientEmail: "original@example.test", recipientPhone: "+18015550999", sendEmail: false });
  await create(f, originallyEmail);
  await assert.rejects(create(f, { ...originallyEmail, recipientEmail: "" }), { status: 409 });
});

test("idempotent creation preserves one queue item and its non-expiring state while rejecting request collisions and active duplicate recipients", async t => {
  const f = await fixture(t), value = input();
  const original = (await create(f, value)).invitations[0];
  const retry = await create(f, value);
  assert.equal(retry.invitations.length, 1); assert.deepEqual(retry.invitations[0], original);
  for (const change of [{ recipientName: "Someone Else" }, { recipientEmail: "other@example.test" }, { sendEmail: false }]) {
    await assert.rejects(create(f, { ...value, ...change }), { status: 409 });
  }
  await assert.rejects(create(f, input(2)), { status: 409 });
  await assert.rejects(create(f, input(3, { recipientEmail: first.email })), { status: 400 });
  assert.equal((await f.db.query("select count(*)::int as n from member_personal_invitations")).rows[0].n, 1);
  await f.personalRepository.revokeOwnPersonalInvitation(first.auth, original.id, { version: 1 });
  const replacement = await create(f, input(2));
  assert.equal(replacement.invitations.length, 2); assert.notEqual(replacement.invitations[0].url, original.url);
  assert.equal(replacement.invitations[1].url, null); assert.ok(replacement.invitations[1].revokedAt);
  assert.equal((await create(f, value)).invitations.length, 2, "retrying an old request never revives a revoked invitation");
});

test("daily creation limit includes link-only and revoked history but idempotent retries remain safe", async t => {
  const f = await fixture(t);
  let snapshot;
  for (let i = 1; i <= 20; i++) snapshot = await create(f, input(i, { recipientEmail: `recipient${i}@example.test`, sendEmail: false }));
  assert.equal(snapshot.remainingToday, 0); assert.equal(snapshot.counts.created, 20);
  const firstInvite = snapshot.invitations[0];
  await f.personalRepository.revokeOwnPersonalInvitation(first.auth, firstInvite.id, { version: 1 });
  await assert.rejects(create(f, input(21, { recipientEmail: "next@example.test" })), { status: 429 });
  await assert.rejects(create(f, input(22, { recipientEmail: "", recipientPhone: "+18015550123", sendEmail: false })), { status: 429 });
  assert.equal((await create(f, input(1, { recipientEmail: "recipient1@example.test", sendEmail: false }))).invitations.length, 20);
  assert.equal((await create(f, input(21, { recipientEmail: "another@example.test" }), second)).invitations.length, 1);
});

test("owner scope and optimistic versions protect revocation and email retry, including stale or suspended owners", async t => {
  const f = await fixture(t), invite = (await create(f)).invitations[0];
  await assert.rejects(f.personalRepository.revokeOwnPersonalInvitation(second.auth, invite.id, { version: 1 }), { status: 404 });
  await assert.rejects(f.personalRepository.retryOwnPersonalInvitationEmail(second.auth, invite.id, { version: 1 }), { status: 404 });
  await assert.rejects(f.personalRepository.revokeOwnPersonalInvitation(first.auth, invite.id, { version: 2 }), { status: 409 });
  await f.db.query("update member_lifecycle set standing_state='paused' where member_id=$1", [first.member]);
  await assert.rejects(create(f, input(2, { recipientEmail: "next@example.test" })), { status: 403 });
  await assert.rejects(f.personalRepository.retryOwnPersonalInvitationEmail(first.auth, invite.id, { version: 1 }), { status: 403 });
  const closed = await f.personalRepository.revokeOwnPersonalInvitation(first.auth, invite.id, { version: 1 });
  assert.ok(closed.invitations[0].revokedAt); assert.equal(closed.invitations[0].deliveryStatus, "cancelled");
  await f.db.query("update platform_role_grants set revoked_at=statement_timestamp() where auth_user_id=$1", [first.auth]);
  await assert.rejects(f.personalRepository.getOwnPersonalInvitations(first.auth), { status: 403 });
});

test("matching recipient submissions are tracked, unrelated email fails before writes, and first referral wins", async t => {
  const f = await fixture(t), invite = (await create(f)).invitations[0];
  await assert.rejects(f.submit(person(4), token(invite)), { code: "P4100" });
  assert.equal((await f.db.query("select * from membership_waitlist")).rows.length, 0);
  assert.equal((await f.db.query("select * from integration_outbox")).rows.length, 0);
  await f.submit(newcomer, token(invite));
  const original = (await f.db.query("select * from member_referrals")).rows[0];
  assert.equal(original.personal_invitation_id, invite.id); assert.equal(original.inviter_member_id, first.member);
  const submitted = (await f.personalRepository.getOwnPersonalInvitations(first.auth)).invitations[0];
  assert.ok(submitted.submittedAt); assert.equal(submitted.joinedAt, null);
  const other = (await create(f, input(2), second)).invitations[0];
  await f.submit(newcomer, token(other), "Name must not overwrite existing details");
  assert.deepEqual((await f.db.query("select * from member_referrals")).rows[0], original);
  assert.ok((await f.personalRepository.getOwnPersonalInvitations(second.auth)).invitations[0].submittedAt);
  assert.equal((await f.db.query("select * from integration_outbox")).rows.length, 1);
  assert.equal((await f.db.query("select name from membership_waitlist")).rows[0].name, "Interested Person");
  await f.addMember(newcomer, false, true); await f.activate(newcomer);
  const joined = await f.personalRepository.getOwnPersonalInvitations(first.auth);
  assert.equal(joined.counts.joined, 1); assert.ok(joined.invitations[0].joinedAt);
  assert.equal((await f.personalRepository.getOwnPersonalInvitations(second.auth)).counts.joined, 0);
});

test("historical finite and revoked personal links fail closed before their no-expiry migration", async t => {
  const f = await fixture(t, { persistentPersonalInvitations: false }), old = await insertExpired(f);
  assert.equal(await f.repository.getPublicMemberInvitation(old.token), null);
  await assert.rejects(f.submit(newcomer, old.token), { code: "P4100" });
  const summary = await f.personalRepository.getOwnPersonalInvitations(first.auth);
  assert.equal(summary.counts.expired, 1); assert.equal(summary.invitations[0].url, null);
  const invite = (await create(f)).invitations[0];
  await f.submit(newcomer, token(invite));
  await f.personalRepository.revokeOwnPersonalInvitation(first.auth, invite.id, { version: 1 });
  assert.equal(await f.repository.getPublicMemberInvitation(token(invite)), null);
  await assert.rejects(f.submit(newcomer, token(invite)), { code: "P4100" });
  await f.addMember(newcomer, false, true); await f.activate(newcomer);
  const result = await f.personalRepository.getOwnPersonalInvitations(first.auth);
  assert.equal(result.counts.joined, 1); assert.ok(result.invitations.find(row => row.id === invite.id).joinedAt);
});

test("no-expiry migration revives old personal invitations without reviving cancellations or changing direct and legacy deadlines", async t => {
  const f = await fixture(t, { persistentPersonalInvitations: false });
  const expired = await insertExpired(f);
  const cancelled = await insertExpired(f, { id: uuid(802), request: uuid(803), token: "C".repeat(43), email: "cancelled@example.test" });
  await f.db.query("update member_personal_invitations set revoked_at=clock_timestamp() where id=$1", [cancelled.id]);
  const legacy = await f.enable();
  const directToken = "D".repeat(43);
  const direct = (await f.db.query(`insert into member_personal_invitations(origin,member_id,request_id,public_token,
    recipient_name,recipient_email_normalized,inviter_name,email_requested,membership_type,billing_plan,issued_at,expires_at)
    values('ruined_direct',null,$1,$2,'Direct Recipient','direct@example.test','Ruined',true,'standard','monthly',
      statement_timestamp()-interval '49 hours',statement_timestamp()-interval '1 hour') returning expires_at`, [uuid(804),directToken])).rows[0];
  const cancelledBefore = (await f.db.query("select revoked_at from member_personal_invitations where id=$1", [cancelled.id])).rows[0];
  assert.equal(await f.repository.getPublicMemberInvitation(expired.token), null);
  await f.db.exec(await readFile(new URL("../db/migrations/20261005213000_personal_invitation_no_expiry.sql", import.meta.url), "utf8"));
  const history = await f.personalRepository.getOwnPersonalInvitations(first.auth);
  const active = history.invitations.find(invitation => invitation.id === expired.id);
  assert.equal(active.expiresAt, null);
  assert.equal(active.url, `/invitation/${expired.token}`);
  assert.equal(active.version, 2);
  assert.equal(history.counts.expired, 0);
  assert.equal(history.invitations.find(invitation => invitation.id === cancelled.id).url, null);
  assert.deepEqual((await f.db.query("select revoked_at from member_personal_invitations where id=$1", [cancelled.id])).rows[0], cancelledBefore);
  assert.equal((await f.repository.getPublicMemberInvitation(expired.token)).expiresAt, null);
  assert.equal(await f.repository.getPublicMemberInvitation(cancelled.token), null);
  assert.equal(await f.repository.getPublicMemberInvitation(directToken), null);
  assert.equal((await f.db.query("select expires_at from member_personal_invitations where public_token=$1", [directToken])).rows[0].expires_at.toISOString(), direct.expires_at.toISOString());
  assert.equal((await f.repository.getPublicMemberInvitation(token(legacy))).expiresAt, legacy.expiresAt);
  await f.submit(newcomer, expired.token);
  assert.equal((await f.db.query("select personal_invitation_id from member_referrals")).rows[0].personal_invitation_id, expired.id);
  await assert.rejects(f.submit({ email: "cancelled@example.test" }, cancelled.token), { code: "P4100" });
  await assert.rejects(f.db.query("update member_personal_invitations set expires_at=clock_timestamp()+interval '48 hours' where id=$1", [expired.id]));
  await assert.rejects(f.db.query("update member_personal_invitations set expires_at=null where public_token=$1", [directToken]));
});

test("legacy invitation links, first-attribution credit and deadlines survive migration alongside personalized invitations", async t => {
  const f = await fixture(t), legacy = await f.enable();
  const initial = await f.personalRepository.getOwnPersonalInvitations(first.auth);
  assert.equal(initial.legacyInvitation.url, legacy.url); assert.equal(initial.legacyInvitation.expiresAt, legacy.expiresAt);
  await f.submit(newcomer, token(legacy));
  const invite = (await create(f)).invitations[0];
  await f.submit(newcomer, token(invite));
  assert.equal((await f.db.query("select personal_invitation_id from member_referrals")).rows[0].personal_invitation_id, null);
  assert.ok((await f.personalRepository.getOwnPersonalInvitations(first.auth)).invitations[0].submittedAt);
  await f.addMember(newcomer, false, true); await f.activate(newcomer);
  assert.equal((await f.personalRepository.getOwnPersonalInvitations(first.auth)).counts.joined, 1);
  assert.equal((await f.repository.getPublicMemberInvitation(token(legacy))).expiresAt, legacy.expiresAt);
});

test("email retries preserve lifetime and payload and stop before the provider idempotency window ends", async t => {
  const f = await fixture(t), invite = (await create(f)).invitations[0];
  await f.db.query("update member_personal_invitations set delivery_status='failed',delivery_attempts=1,first_attempt_at=statement_timestamp(),delivery_payload=$2::jsonb where id=$1", [invite.id, JSON.stringify({ to: newcomer.email, html: "Frozen" })]);
  const retry = (await f.personalRepository.retryOwnPersonalInvitationEmail(first.auth, invite.id, { version: 1 })).invitations[0];
  assert.equal(retry.deliveryStatus, "queued"); assert.equal(retry.expiresAt, invite.expiresAt); assert.equal(retry.version, 2);
  assert.deepEqual((await f.db.query("select delivery_payload from member_personal_invitations where id=$1", [invite.id])).rows[0].delivery_payload, { to: newcomer.email, html: "Frozen" });
  await assert.rejects(f.personalRepository.retryOwnPersonalInvitationEmail(first.auth, invite.id, { version: 1 }), { status: 409 });
  await f.db.query("update member_personal_invitations set delivery_status='sent',sent_at=statement_timestamp() where id=$1", [invite.id]);
  await assert.rejects(f.personalRepository.retryOwnPersonalInvitationEmail(first.auth, invite.id, { version: 2 }), { status: 409 });
  const another = (await create(f, input(2, { recipientEmail: "other@example.test" }))).invitations[0];
  await f.db.query("update member_personal_invitations set delivery_status='failed',first_attempt_at=statement_timestamp()-interval '23 hours' where id=$1", [another.id]);
  await assert.rejects(f.personalRepository.retryOwnPersonalInvitationEmail(first.auth, another.id, { version: 1 }), { status: 409 });
});

test("deletion erases recipient history and email payloads while preserving the historical inviter and referral", async t => {
  const f = await fixture(t), invite = (await create(f)).invitations[0];
  await f.submit(newcomer, token(invite));
  await f.db.query("update member_personal_invitations set delivery_payload=$2::jsonb where id=$1", [invite.id, JSON.stringify({ to: newcomer.email })]);
  await f.db.query("update ruined_members set deleted_at=statement_timestamp() where id=$1", [first.member]);
  assert.equal((await f.db.query("select * from member_personal_invitations where member_id=$1", [first.member])).rows.length, 0);
  const referral = (await f.db.query("select inviter_member_id,personal_invitation_id from member_referrals")).rows[0];
  assert.equal(referral.inviter_member_id, first.member); assert.equal(referral.personal_invitation_id, null);
  assert.equal(await f.repository.getPublicMemberInvitation(token(invite)), null);
  await assert.rejects(create(f, input(2, { recipientEmail: "fresh@example.test" })), { status: 403 });
});

test("personal recipient, non-expiring lifetime, payload and attribution are immutable and not directly accessible to clients", async t => {
  const f = await fixture(t), invite = (await create(f)).invitations[0];
  for (const field of ["recipient_name='Changed'", "recipient_email_normalized='other@example.test'", "expires_at=expires_at+interval '1 hour',issued_at=issued_at+interval '1 hour'", "public_token=repeat('Z',43)"]) {
    await assert.rejects(f.db.query(`update member_personal_invitations set ${field} where id=$1`, [invite.id]));
  }
  await f.submit(newcomer, token(invite));
  await assert.rejects(f.db.query("update member_referrals set personal_invitation_id=null where personal_invitation_id=$1", [invite.id]));
  const acl = (await f.db.query(`select has_table_privilege('anon','member_personal_invitations','select') as anon,
    has_table_privilege('authenticated','member_personal_invitations','insert') as authenticated,
    has_function_privilege('authenticated','private.ruined_require_member_invitation(text,text)','execute') as execute`)).rows[0];
  assert.deepEqual(acl, { anon: false, authenticated: false, execute: false });
});

test("historical finite invitations still reject a submission crossing their deadline", async t => {
  const f = await fixture(t, { persistentPersonalInvitations: false }), invite = (await create(f)).invitations[0];
  await f.db.exec(`create table personal_invitation_test_clock(ticks integer not null);
    insert into personal_invitation_test_clock values(0);
    create function private.personal_invitation_test_now() returns timestamptz language plpgsql as $$
    declare tick integer; deadline timestamptz;
    begin
      update public.personal_invitation_test_clock set ticks=ticks+1 returning ticks into tick;
      select expires_at into deadline from public.member_personal_invitations limit 1;
      return case when tick=1 then deadline-interval '1 second' else deadline end;
    end $$;`);
  const migration = await readFile(new URL("../db/migrations/20260923000000_personal_member_invitations.sql", import.meta.url), "utf8");
  const validator = migration.match(/create function private\.ruined_require_member_invitation[\s\S]*?\n\$\$;/)[0];
  await f.db.exec(validator.replace("create function", "create or replace function").replace("clock_timestamp()", "private.personal_invitation_test_now()"));
  await assert.rejects(f.submit(newcomer, token(invite)), { code: "P4100" });
  assert.equal((await f.db.query("select * from membership_waitlist")).rows.length, 0);
  assert.equal((await f.db.query("select * from member_referrals")).rows.length, 0);
  assert.equal((await f.db.query("select * from integration_outbox")).rows.length, 0);
  assert.equal((await f.personalRepository.getOwnPersonalInvitations(first.auth)).invitations[0].submittedAt, null);
});

test("accepted invitations are counted separately and cannot be cancelled or emailed again", async t => {
  const f = await fixture(t), invite = (await create(f)).invitations[0];
  await f.addMember(newcomer, false, false);
  const accept = () => f.db.query(`update member_personal_invitations set accepted_at=clock_timestamp(),
    accepted_by_auth_user_id=$2,accepted_member_id=$3,version=version+1 where id=$1`, [invite.id,newcomer.auth,newcomer.member]);
  await assert.rejects(accept(), { code: 'P4100' }, 'Unverified email cannot produce acceptance evidence');
  await f.db.query("update person_email_addresses set verification_state='verified' where person_id=$1", [newcomer.person]);
  await accept();
  const snapshot = await f.personalRepository.getOwnPersonalInvitations(first.auth);
  assert.ok(snapshot.invitations[0].acceptedAt);
  assert.equal(snapshot.invitations[0].url, null);
  assert.equal(snapshot.counts.accepted, 1); assert.equal(snapshot.counts.active, 0); assert.equal(snapshot.counts.expired, 0);
  await assert.rejects(f.personalRepository.revokeOwnPersonalInvitation(first.auth,invite.id,{version:2}), {status:409});
  await assert.rejects(f.personalRepository.retryOwnPersonalInvitationEmail(first.auth,invite.id,{version:2}), {status:409});
  assert.equal((await f.db.query('select revoked_at from member_personal_invitations where id=$1', [invite.id])).rows[0].revoked_at, null);
});
