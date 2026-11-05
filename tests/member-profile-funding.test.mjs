import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { publicJournalFixture, timelineIds } from "./helpers/public-journal-fixture.mjs";
import { seedMemberSmsPaidReservation } from "./helpers/member-sms-funding-fixture.mjs";

const target = { memberId: timelineIds.member, personId: timelineIds.person, tag: "shared_tag" };
const partner = { memberId: timelineIds.otherMember, personId: timelineIds.otherMember, tag: "other_tag" };

async function fixture(t) {
  // This shared fixture installs the current shipped paid, complimentary and
  // operator funding SQL. No funding predicate is replaced with a Boolean stub.
  const f = await publicJournalFixture(t);
  await f.db.exec("create table member_directory_preferences(member_id uuid primary key,avatar_visible boolean default true)");
  return f;
}

async function awaitingProgram(f, member = target) {
  await f.db.query(`update member_lifecycle set billing_state='pending',program_state='prospect',
    standing_state='pre_active',administrative_onboarding_state='in_progress' where member_id=$1`, [member.memberId]);
}

async function paid(f) {
  const payment = await seedMemberSmsPaidReservation(f.db, {
    ...target, reservation: randomUUID(), contract: randomUUID(), release: false,
  });
  await awaitingProgram(f);
  return payment;
}

async function proof(f, member = target) {
  return (await f.db.query("select private.ruined_member_paid_reservation($1) as id", [member.memberId])).rows[0].id;
}

async function visible(f, expected, member = target) {
  assert.equal(Boolean(await f.cardRepository.getPublicMemberProfile(member.tag)), expected, `${member.tag}: direct profile`);
  assert.equal(Boolean(await f.cardRepository.getOwnMemberProfilePublicScope(member.memberId)), expected, `${member.tag}: owner scope`);
  assert.equal((await f.cardRepository.getPublicMemberProfileLinks([member.memberId])).has(member.memberId), expected, `${member.tag}: shared profile link`);
  const result = await f.cardRepository.getPublicMemberProfileSearch(member.tag, 1, 24);
  assert.equal(result.results.some(row => row.href === `/profile/${member.tag}`), expected, `${member.tag}: directory`);
  assert.equal(Boolean(await f.visitor.getPublicJournal(member.tag)), expected, `${member.tag}: public Timeline`);
}

async function isolated(f, run) {
  await f.db.exec("begin");
  try { await run(); }
  finally { await f.db.exec("rollback"); }
}

async function accessState(f) {
  const rows = await f.db.query(`select jsonb_build_object(
    'members',(select jsonb_agg(to_jsonb(m) order by m.id) from ruined_members m),
    'lifecycle',(select jsonb_agg(to_jsonb(l) order by l.member_id) from member_lifecycle l),
    'registration',(select jsonb_agg(to_jsonb(r) order by r.member_id) from member_registration_access r),
    'cards',(select jsonb_agg(to_jsonb(c) order by c.member_id) from member_public_cards c),
    'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from member_registration_messages m)
  ) as state`);
  return rows.rows[0].state;
}

test("settled prepaid membership publishes before intake and release without changing membership or sending mail", async t => {
  const f = await fixture(t), payment = await paid(f);
  await f.db.exec("create table member_registration_messages(id uuid primary key,member_id uuid,kind text,status text)");
  await f.db.query("insert into member_registration_messages values($1,$2,'welcome','sent')", [randomUUID(), target.memberId]);
  assert.equal(await proof(f), payment.reservation);
  const registration = (await f.db.query("select registered_at,profile_activated_at from member_registration_access where member_id=$1", [target.memberId])).rows[0];
  assert.deepEqual(registration, { registered_at: null, profile_activated_at: null });
  const before = await accessState(f), queryStart = f.executedQueries.length;
  await visible(f, true);
  assert.deepEqual(await accessState(f), before, "discovery cannot promote billing/program/onboarding, stamp release, enable cards or enqueue mail");
  assert.ok(f.executedQueries.slice(queryStart).every(query => /^\s*(?:select|with)\b/i.test(query)), "all repository operations remain reads");
  const profile = await f.cardRepository.getPublicMemberProfile(target.tag);
  assert.deepEqual(Object.keys(profile).sort(), ["bio", "memberNumber", "memberTag", "name"]);
});

test("public visibility requires actual live settlement and withdraws with refund, cancellation or invalid proof", async t => {
  const f = await fixture(t), payment = await paid(f);
  await visible(f, true);
  const changes = [
    ["refund pending", "update stripe_membership_prepaid_proofs set refund_state='pending'"],
    ["partial refund", "update stripe_membership_prepaid_proofs set refund_state='partial',amount_refunded=100"],
    ["full refund", "update stripe_membership_prepaid_proofs set refund_state='refunded',amount_refunded=amount_paid"],
    ["refund amount despite stale state", "update stripe_membership_prepaid_proofs set amount_refunded=1"],
    ["provider cancellation", "update stripe_membership_prepaid_proofs set provider_canceled_at=now()"],
    ["payment review", "update stripe_membership_prepaid_proofs set review_reason='payment_adjustment'"],
    ["insufficient settled amount", "update stripe_membership_prepaid_proofs set amount_paid=1"],
    ["invoice unpaid", "update stripe_invoices set stripe_status='open'"],
    ["checkout unpaid", "update stripe_checkout_sessions set payment_status='unpaid'"],
    ["checkout incomplete", "update stripe_checkout_attempts set status='pending'"],
    ["subscription ended", "update stripe_subscriptions set stripe_status='canceled'"],
    ["subscription past due", "update stripe_subscriptions set stripe_status='past_due'"],
    ["proof missing", "delete from stripe_membership_prepaid_proofs"],
    ["accepted account mismatch", "update stripe_checkout_attempts set payment_setup_account_id='acct_other'"],
  ];
  for (const [name, change] of changes) await t.test(name, () => isolated(f, async () => {
    await f.db.exec(change);
    assert.equal(await proof(f), null, "the real shipped payment helper rejects the evidence");
    await visible(f, false);
  }));
  await t.test("test-mode settlement is not public membership", () => isolated(f, async () => {
    await f.db.exec(`update member_registration_access set payment_setup_livemode=false;
      update stripe_membership_prepaid_proofs set livemode=false;
      update stripe_checkout_attempts set payment_setup_livemode=false;
      update stripe_checkout_sessions set livemode=false;
      update stripe_membership_commitments set livemode=false`);
    assert.equal(await proof(f), payment.reservation, "payment helper alone accepts matching test-mode evidence");
    await visible(f, false);
  }));
  await t.test("elapsed cancellation is blocked even before provider status catches up", () => isolated(f, async () => {
    await f.db.exec("update stripe_subscriptions set cancel_at=now()-interval '1 second'");
    assert.equal(await proof(f), payment.reservation, "this check surrounds the payment helper");
    await visible(f, false);
  }));
  await t.test("a later cancellation remains public through its effective date", () => isolated(f, async () => {
    await f.db.exec("update stripe_subscriptions set cancel_at=now()+interval '1 day'");
    await f.db.query("update member_lifecycle set standing_state='cancellation_requested',cancellation_effective_at=now()+interval '1 day' where member_id=$1", [target.memberId]);
    await visible(f, true);
    await f.db.query("update member_lifecycle set cancellation_effective_at=now()-interval '1 second' where member_id=$1", [target.memberId]);
    await visible(f, false);
  }));
  await t.test("a release stamp and old active billing cannot override withdrawn proof", () => isolated(f, async () => {
    await f.db.query("update member_lifecycle set billing_state='active',program_state='active',standing_state='active',administrative_onboarding_state='completed' where member_id=$1", [target.memberId]);
    await f.db.exec("update member_registration_access set registered_at=now(),profile_activated_at=now(); update stripe_membership_prepaid_proofs set refund_state='refunded'");
    await visible(f, false);
  }));
});

test("shared prepaid visibility follows the current payer and each enrollment episode", async t => {
  const f = await fixture(t), payment = await paid(f);
  await f.db.query("update membership_commercial_reservations set kind='couple' where id=$1", [payment.reservation]);
  await f.db.query("insert into membership_commercial_participants(reservation_id,member_id,person_id) values($1,$2,$3)", [payment.reservation, partner.memberId, partner.personId]);
  await f.db.query("insert into member_registration_access(member_id,profile_activated_at,payment_setup_account_id,payment_setup_livemode) values($1,null,'acct_fixture',true)", [partner.memberId]);
  await awaitingProgram(f, partner);
  assert.equal(await proof(f, partner), payment.reservation);
  await visible(f, true, partner);
  const changes = [
    ["payer suspended", "update member_lifecycle set account_state='suspended' where member_id=$1", target.memberId],
    ["payer closed", "update member_lifecycle set account_state='closed' where member_id=$1", target.memberId],
    ["payer deleted", "update ruined_members set deleted_at=now() where id=$1", target.memberId],
    ["payer person deactivated", "update people set status='inactive' where id=$1", target.personId],
    ["payer login deactivated", "update platform_users set status='inactive' where auth_user_id=$1", timelineIds.auth],
    ["payer member role revoked", "update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='member'", timelineIds.auth],
    ["payer email no longer verified", "update person_email_addresses set verification_state='pending' where person_id=$1", target.personId],
    ["payer billing needs attention", "update member_lifecycle set billing_state='attention_required' where member_id=$1", target.memberId],
    ["payer paused", "update member_lifecycle set standing_state='paused' where member_id=$1", target.memberId],
    ["payer left", "update member_lifecycle set standing_state='inactive' where member_id=$1", target.memberId],
    ["payer offboarded", "update member_lifecycle set program_state='offboarded' where member_id=$1", target.memberId],
    ["payer cancellation effective", "update member_lifecycle set standing_state='cancellation_requested',cancellation_effective_at=now()-interval '1 second' where member_id=$1", target.memberId],
  ];
  for (const [name, query, id] of changes) await t.test(name, () => isolated(f, async () => {
    await f.db.query(query, [id]);
    assert.equal(await proof(f, partner), payment.reservation, "recipient proof remains, so shared-access controls must reject it");
    await visible(f, false, partner);
  }));
  for (const member of [target, partner]) await t.test(`${member.tag} enrollment ended`, () => isolated(f, async () => {
    await f.db.query("insert into membership_enrollment_episodes(reservation_id,member_id,ended_at) values($1,$2,now())", [payment.reservation, member.memberId]);
    assert.equal(await proof(f, partner), payment.reservation);
    await visible(f, false, partner);
  }));
  await t.test("removed participant cannot reuse the payer's proof", () => isolated(f, async () => {
    await f.db.query("delete from membership_commercial_participants where member_id=$1", [partner.memberId]);
    assert.equal(await proof(f, partner), null);
    await visible(f, false, partner);
  }));
});

test("only accepted current complimentary funding publishes before intake, not an issued invitation", async t => {
  const f = await fixture(t);
  await awaitingProgram(f);
  await f.db.query("insert into member_registration_access(member_id,profile_activated_at) values($1,null)", [target.memberId]);
  // An issued invitation has no redeemed funding row. The production redemption
  // transaction creates that row only after acceptance and verified identity.
  await f.db.exec("create table member_personal_invitations(id uuid primary key,accepted_member_id uuid,accepted_at timestamptz)");
  const invitation = randomUUID(), grant = randomUUID();
  await f.db.query("insert into member_personal_invitations(id) values($1)", [invitation]);
  await visible(f, false);
  await f.db.query("update member_personal_invitations set accepted_member_id=$2,accepted_at=now() where id=$1", [invitation, target.memberId]);
  await f.db.query("insert into member_complimentary_grants(id,member_id) values($1,$2)", [grant, target.memberId]);
  await visible(f, true);
  assert.deepEqual((await f.db.query("select registered_at,profile_activated_at from member_registration_access where member_id=$1", [target.memberId])).rows[0], { registered_at: null, profile_activated_at: null });
  const changes = [
    ["revoked grant", "update member_complimentary_grants set revoked_at=now()"],
    ["expired grant", "update member_complimentary_grants set ends_at=now()-interval '1 second'"],
    ["future grant", "update member_complimentary_grants set starts_at=now()+interval '1 day'"],
    ["revoked member role", `update platform_role_grants set revoked_at=now() where auth_user_id='${timelineIds.auth}'`],
    ["unverified current email", `update person_email_addresses set verification_state='pending' where person_id='${target.personId}'`],
    ["identity deactivated", `update platform_users set status='inactive' where auth_user_id='${timelineIds.auth}'`],
  ];
  for (const [name, query] of changes) await t.test(name, () => isolated(f, async () => {
    await f.db.exec(query);
    await visible(f, false);
  }));
});

test("early profile publication never relaxes collectible-card activation or lifecycle rules", async t => {
  const f = await fixture(t);
  await paid(f);
  await f.enable();
  await visible(f, true);
  assert.equal(await f.cardRepository.getPublicMemberCard(f.token), null, "past activation date alone cannot bypass the original participating-member gate");
  await f.db.query("update member_lifecycle set billing_state='active',program_state='active',standing_state='active',administrative_onboarding_state='completed' where member_id=$1", [target.memberId]);
  assert.equal(await f.cardRepository.getPublicMemberCard(f.token), null, "collectible card retains its original release requirement");
  await f.db.query("update member_registration_access set profile_activated_at=now() where member_id=$1", [target.memberId]);
  await f.db.query("update ruined_members set membership_activated_at='2200-01-01' where id=$1", [target.memberId]);
  await visible(f, true);
  assert.equal(await f.cardRepository.getPublicMemberCard(f.token), null, "future card activation remains private");
  await f.db.query("update ruined_members set membership_activated_at='2020-01-01' where id=$1", [target.memberId]);
  const card = await f.cardRepository.getPublicMemberCard(f.token);
  assert.equal(card.name, "Shared name");
  assert.equal(card.bio, null);
  assert.equal(card.avatarUrl, null);
  assert.equal(card.memberTag, null);
});
