import assert from "node:assert/strict";
import test from "node:test";
import { coupleCircleFixture } from "./helpers/couple-circle-fixture.mjs";

test("an accepted reserved couple has symmetric linkage and cannot be placed in two Circles", async t => {
  const f = await coupleCircleFixture(t), pair = await f.pair();
  assert.equal(await f.partnerOf(pair.payer), pair.partner);
  assert.equal(await f.partnerOf(pair.partner), pair.payer);
  await f.place(pair.payer);
  await assert.rejects(f.place(pair.partner,f.circleB), error => error.code === "P4206");
  assert.deepEqual(await f.placements(), [{ member_id: pair.payer, circle_id: f.circleA }]);
  await f.place(pair.partner);
  assert.equal((await f.placements()).length,2);
});

test("a pair transfers atomically while historical placements and explicit single departures remain valid", async t => {
  const f = await coupleCircleFixture(t), pair = await f.pair({ activated: true });
  await f.place(pair.payer); await f.place(pair.partner);
  await f.db.transaction(async tx => {
    for (const member of [pair.payer,pair.partner]) {
      await tx.query("update circle_member_assignments set ended_at=now() where member_id=$1 and ended_at is null", [member]);
      await f.place(member,f.circleB,tx);
    }
  });
  assert.ok((await f.placements()).every(row => row.circle_id === f.circleB));
  assert.equal((await f.db.query("select count(*)::int as count from circle_member_assignments where ended_at is not null")).rows[0].count,2);
  await f.db.query("update circle_member_assignments set ended_at=now() where member_id=$1 and ended_at is null", [pair.partner]);
  assert.equal((await f.placements()).length,1);
  await assert.rejects(f.place(pair.partner,f.circleA), /same Circle/);
});

test("insufficient space for both rolls back the entire move without losing either source assignment", async t => {
  const f = await coupleCircleFixture(t), pair = await f.pair({ activated: true });
  await f.place(pair.payer); await f.place(pair.partner);
  for(let i=0;i<11;i++) await f.place(await f.member(),f.circleB);
  const before = await f.placements();
  await assert.rejects(f.db.transaction(async tx => {
    for(const member of [pair.payer,pair.partner]) {
      await tx.query("update circle_member_assignments set ended_at=now() where member_id=$1 and ended_at is null", [member]);
      await f.place(member,f.circleB,tx);
    }
  }), /above 12 requires/);
  assert.deepEqual(await f.placements(),before);
});

test("existing incompatible placements reject the couple quote before checkout can start", async t => {
  const f = await coupleCircleFixture(t), payer = await f.member(), partner = await f.member();
  await f.place(payer); await f.place(partner,f.circleB);
  let reachedCheckout = false;
  await assert.rejects(f.pair({ payer,partner,afterQuote: () => { reachedCheckout = true; } }), error => error.code === "P4206");
  assert.equal(reachedCheckout,false,"the participant insert must fail immediately, not only when the transaction commits");
  assert.equal((await f.db.query("select count(*)::int as count from membership_commercial_reservations")).rows[0].count,0);
  assert.equal(await f.partnerOf(payer),null);
});

test("missing acceptance cannot establish a pair, and later acceptance cannot silently bind split members", async t => {
  const f = await coupleCircleFixture(t), pair = await f.pair({ accepted: false });
  assert.equal(await f.partnerOf(pair.payer),null);
  await f.place(pair.payer); await f.place(pair.partner,f.circleB);
  await assert.rejects(f.db.query("update membership_couple_authorizations set accepted_at=now(),accepted_by_auth_user_id=$2 where id=$1", [pair.approval,f.actor]), /same Circle/);
  assert.equal(await f.partnerOf(pair.payer),null);
});

test("reserved Checkout keeps protection past local expiry until confirmed release", async t => {
  const f = await coupleCircleFixture(t), pair = await f.pair();
  await f.db.query("update membership_commercial_reservations set expires_at=now()-interval '1 hour' where id=$1", [pair.reservation]);
  await f.db.query("update membership_couple_authorizations set expires_at=now()-interval '1 hour',revoked_at=now() where id=$1", [pair.approval]);
  assert.equal(await f.partnerOf(pair.payer),pair.partner,"a remotely payable or ambiguous quote must not lose its pair");
  await f.db.query("update membership_commercial_reservations set status='released' where id=$1", [pair.reservation]);
  assert.equal(await f.partnerOf(pair.payer),null);
  await f.place(pair.payer); await f.place(pair.partner,f.circleB);
});

test("activated pairing survives authorization expiry and billing attention but excludes ended historical relationships", async t => {
  const f = await coupleCircleFixture(t), pair = await f.pair({ activated: true });
  await f.db.query("update membership_couple_authorizations set expires_at=now()-interval '1 day',revoked_at=now() where id=$1", [pair.approval]);
  for(const status of ["past_due","paused","unpaid","active"]) {
    await f.db.query("update stripe_subscriptions set stripe_status=$2 where id=$1", [pair.subscription,status]);
    assert.equal(await f.partnerOf(pair.payer),pair.partner);
  }
  await f.db.query("update membership_enrollment_episodes set ended_at=now() where member_id=$1", [pair.partner]);
  assert.equal(await f.partnerOf(pair.payer),null);
  assert.equal(await f.partnerOf(pair.partner),null);
  await f.place(pair.payer); await f.place(pair.partner,f.circleB);
});

test("closed or deleted members and canceled subscriptions no longer constrain surviving placements", async t => {
  for(const reason of ["closed","deleted","canceled","cancel_effective"]) await t.test(reason,async t => {
    const f = await coupleCircleFixture(t), pair = await f.pair({ activated: true });
    if(reason === "closed") await f.db.query("update member_lifecycle set account_state='closed' where member_id=$1",[pair.partner]);
    if(reason === "deleted") await f.db.query("update ruined_members set deleted_at=now() where id=$1",[pair.partner]);
    if(reason === "canceled") await f.db.query("update stripe_subscriptions set stripe_status='canceled' where id=$1",[pair.subscription]);
    if(reason === "cancel_effective") await f.db.query("update stripe_subscriptions set cancel_at=now()-interval '1 second' where id=$1",[pair.subscription]);
    assert.equal(await f.partnerOf(pair.payer),null);
  });
});

test("restoring an excluded relationship cannot commit split current placements", async t => {
  const f = await coupleCircleFixture(t), pair = await f.pair({ activated: true });
  await f.db.query("update member_lifecycle set account_state='closed' where member_id=$1",[pair.partner]);
  await f.place(pair.payer); await f.place(pair.partner,f.circleB);
  await assert.rejects(f.db.query("update member_lifecycle set account_state='active' where member_id=$1",[pair.partner]), /same Circle/);
});

test("pairing internals remain inaccessible to browser database roles", async t => {
  const f = await coupleCircleFixture(t);
  const grants = (await f.db.query(`select has_function_privilege('authenticated','private.ruined_circle_couple_partner(uuid)','execute') as partner,
    has_function_privilege('anon','private.ruined_lock_circle_couple_members(uuid[])','execute') as locks`)).rows[0];
  assert.deepEqual(grants,{ partner:false,locks:false });
});
