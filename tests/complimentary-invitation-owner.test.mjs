import assert from "node:assert/strict";
import test from "node:test";
import { fixture, first, second, newcomer, uuid } from "./helpers/personal-invitation-fixture.mjs";

const input = (overrides = {}) => ({ recipientName: "Founding Recipient", recipientEmail: newcomer.email,
  requestId: uuid(910), sendEmail: false, membershipType: "complimentary", complimentaryReason: "Founding member", complimentaryEndsAt: null, ...overrides });
async function setup(t) {
  const f = await fixture(t);
  await f.db.exec(`create table stripe_subscriptions(member_id uuid, stripe_status text);
    create table stripe_checkout_attempts(member_id uuid, status text);
    create table stripe_checkout_sessions(member_id uuid, session_status text);
    create table operator_audit_events(actor_auth_user_id uuid, action text, subject_type text, subject_id text,
      reason text, after_snapshot jsonb, metadata jsonb, dedupe_key text unique);`);
  const admin = who => f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [who.auth]);
  async function accept(invite) {
    await f.addMember(newcomer, false, true);
    await f.db.transaction(async tx => {
      await tx.query(`update member_personal_invitations set accepted_at=clock_timestamp(),accepted_member_id=$2,
        accepted_by_auth_user_id=$3,version=version+1 where id=$1`, [invite.id, newcomer.member, newcomer.auth]);
      await tx.query("select private.ruined_redeem_complimentary_invitation($1,$2,$3)", [invite.id,newcomer.member,newcomer.auth]);
    });
    return (await f.personalRepository.getOwnPersonalInvitations(first.auth)).invitations[0];
  }
  return { ...f, admin, accept, create: value => f.personalRepository.createOwnPersonalInvitation(first.auth, value ?? input()) };
}

test("only current administrators can issue complimentary invitations; browser fields cannot choose an authority", async t => {
  const f = await setup(t);
  assert.equal((await f.personalRepository.getOwnPersonalInvitations(first.auth)).canGrantComplimentary, false);
  await assert.rejects(f.create(), { status: 403 });
  await assert.rejects(f.create(input({ complimentaryAuthorizedByAuthUserId: first.auth })), { status: 400 });
  assert.equal((await f.db.query("select count(*)::int n from member_personal_invitations")).rows[0].n, 0);
  await f.admin(first);
  assert.equal((await f.personalRepository.getOwnPersonalInvitations(first.auth)).canGrantComplimentary, true);
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='ops_admin'", [first.auth]);
  await assert.rejects(f.create(), { status: 403 });
});

test("complimentary terms are fixed, private reasons never reach the recipient, and retries preserve the original benefit", async t => {
  const f = await setup(t); await f.admin(first);
  const value = input({ complimentaryReason: "Private founding arrangement", complimentaryEndsAt: "2099-01-01T00:00:00.000Z" });
  const firstResult = await f.create(value), invite = firstResult.invitations[0];
  assert.equal(invite.membershipType, "complimentary"); assert.equal(invite.complimentaryGrant, null);
  assert.equal(invite.complimentaryEndsAt, value.complimentaryEndsAt);
  assert.equal(Date.parse(invite.expiresAt) - Date.parse(invite.issuedAt), 48 * 60 * 60 * 1000);
  const publicView = await f.repository.getPublicMemberInvitation(invite.url.split("/").pop());
  assert.equal(publicView.membershipType, "complimentary"); assert.equal(publicView.complimentaryEndsAt, value.complimentaryEndsAt);
  assert.doesNotMatch(JSON.stringify(publicView), /Private founding|example.test|authorized|grantedBy|complimentaryReason/);
  assert.deepEqual((await f.create(value)).invitations[0], invite);
  for (const change of [{ complimentaryReason: "Different" }, { complimentaryEndsAt: null },
    { membershipType: "standard", complimentaryReason: null, complimentaryEndsAt: null }]) {
    await assert.rejects(f.create({ ...value, ...change }), { status: 409 });
  }
  assert.equal((await f.db.query("select count(*)::int n from operator_audit_events")).rows[0].n, 1);
  assert.equal((await f.db.query("select count(*)::int n from member_complimentary_grants")).rows[0].n, 0, "Creating the invitation grants no access");
});

test("invalid terms and existing billing stop complimentary creation before invitations or email are queued", async t => {
  const f = await setup(t); await f.admin(first);
  for (const change of [{ complimentaryReason: "" }, { complimentaryReason: "x".repeat(501) },
    { complimentaryEndsAt: "2026-02-30T00:00:00Z" }, { complimentaryEndsAt: "2000-01-01T00:00:00Z" },
    { membershipType: "free" }, { membershipType: null }, { membershipType: "standard" }]) {
    await assert.rejects(f.create(input(change)), { status: 400 });
  }
  await f.addMember(newcomer, false, true);
  await f.db.query("insert into stripe_subscriptions values($1,'active')", [newcomer.member]);
  await assert.rejects(f.create(), { status: 409 });
  assert.equal((await f.db.query("select count(*)::int n from member_personal_invitations")).rows[0].n, 0);
});

test("ending redeemed complimentary access is owner-scoped, audited, irreversible and separate from invitation cancellation", async t => {
  const f = await setup(t); await f.admin(first); await f.admin(second);
  const original = (await f.create()).invitations[0], invite = await f.accept(original);
  assert.ok(invite.acceptedAt); assert.ok(invite.complimentaryGrant?.id);
  await assert.rejects(f.personalRepository.revokeOwnPersonalInvitation(first.auth, invite.id, { version: invite.version }), { status: 409 });
  await assert.rejects(f.personalRepository.endOwnInvitationComplimentaryAccess(second.auth, invite.id, { version: invite.version }), { status: 404 });
  await assert.rejects(f.personalRepository.endOwnInvitationComplimentaryAccess(first.auth, invite.id, { version: 1 }), { status: 409 });
  // A subsequent paid membership remains paid when its separate waiver ends.
  await f.db.query("update member_lifecycle set billing_state='active' where member_id=$1", [newcomer.member]);
  const result = await f.personalRepository.endOwnInvitationComplimentaryAccess(first.auth, invite.id, { version: invite.version });
  const ended = result.invitations[0];
  assert.ok(ended.complimentaryGrant.revokedAt); assert.equal(ended.revokedAt, null); assert.equal(ended.acceptedAt, invite.acceptedAt);
  assert.equal((await f.db.query("select billing_state from member_lifecycle where member_id=$1", [newcomer.member])).rows[0].billing_state, "active");
  assert.equal(await f.repository.getPublicMemberInvitation(original.url.split("/").pop()), null);
  assert.deepEqual((await f.personalRepository.endOwnInvitationComplimentaryAccess(first.auth, invite.id, { version: ended.version })).invitations[0], ended);
  await f.db.query("select private.ruined_redeem_complimentary_invitation($1,$2,$3)", [invite.id,newcomer.member,newcomer.auth]);
  const grant = (await f.db.query("select * from member_complimentary_grants")).rows;
  assert.equal(grant.length, 1); assert.ok(grant[0].revoked_at);
  assert.equal((await f.db.query("select count(*)::int n from operator_audit_events where action='complimentary_invitation.ended'")).rows[0].n, 1);
});
