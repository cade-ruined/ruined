import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
function wrap(engine) {
  const sql = async (strings, ...values) => (await engine.query(
    strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""),
    values.map(value => value instanceof Date ? value.toISOString() : value),
  )).rows;
  sql.json = value => JSON.stringify(value);
  sql.begin = work => engine.transaction(tx => work(wrap(tx)));
  return sql;
}

test("commercial enrollment uses the real schema, current registered people, safe reservations and durable continuity", async t => {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const paths = Array.from((await source("scripts/migrate-platform.mjs")).matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g), match => match[1]);
  const ownMigration = "db/migrations/20260929006000_membership_commercial_eligibility.sql";
  if (!paths.includes(ownMigration)) paths.push(ownMigration);
  for (const path of paths) await db.exec(await source(path));
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(await source("src/lib/membership/commercial-repository.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "server-only") return {};
    assert.equal(name, "@/lib/database/server");
    return { getApplicationDatabase: () => wrap(db) };
  }, loaded, loaded.exports);
  const repository = loaded.exports;
  const billingModule = { exports: {} };
  new Function("require", "module", "exports", ts.transpileModule(await source("src/lib/stripe/billing-repository.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(name => name === "@/lib/stripe/database" ? { getBillingDatabase: () => wrap(db) }
    : name === "@/lib/membership/commercial-repository" ? repository : {}, billingModule, billingModule.exports);
  const accessModule = { exports: {} };
  new Function("require", "module", "exports", ts.transpileModule(await source("src/lib/membership/access-policy.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(() => ({}), accessModule, accessModule.exports);
  const memberModule = { exports: {} };
  new Function("require", "module", "exports", ts.transpileModule(await source("src/lib/membership/repository.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(name => name === "@/lib/database/server" ? { getApplicationDatabase: () => wrap(db) }
    : name === "@/lib/membership/access-policy" ? accessModule.exports : {}, memberModule, memberModule.exports);
  await db.query(`insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at)
    values($1,'ruined_membership',2,'Paid terms','Test-only agreement',$2,'published',now())`, [id(9000), "a".repeat(64)]);

  async function member(number, { active = false, complimentary = false, verified = true, age = true } = {}) {
    const who = { member: id(number), auth: id(number + 1000), email: `commercial-${number}@example.test` };
    await db.query("insert into ruined_members(id,email,email_normalized) values($1,$2,$2)", [who.member, who.email]);
    who.person = (await db.query("select person_id from ruined_members where id=$1", [who.member])).rows[0].person_id;
    await db.query("insert into member_lifecycle(member_id,account_state) values($1,'active')", [who.member]);
    await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,$4,'active')", [who.auth, who.member, who.person, who.email]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [who.auth]);
    if (complimentary) await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'guide')", [who.auth]);
    await db.query("insert into person_profiles(person_id,display_name) values($1,$2) on conflict(person_id) do update set display_name=excluded.display_name", [who.person, `Member ${number}`]);
    await db.query(`insert into person_private_profiles(person_id,birth_date,default_fulfillment_address)
      values($1,'1990-01-01','{"countryCode":"US"}') on conflict(person_id) do update set birth_date=excluded.birth_date,default_fulfillment_address=excluded.default_fulfillment_address`, [who.person]);
    if (verified) await db.query("update person_email_addresses set verification_state='verified',verified_at=now() where person_id=$1", [who.person]);
    if (age) {
      const consent = (await db.query("insert into member_consents(member_id,consent_type,policy_version,accepted_at,dedupe_key) values($1,'age_attestation','18',now(),$2) returning id", [who.member, `age-${number}`])).rows[0].id;
      await db.query(`insert into membership_agreement_acceptances(id,agreement_version_id,person_id,member_id,accepted_by_auth_user_id,age_attestation_id,
        signer_name_snapshot,signer_email_snapshot,affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,
        agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
        values($1,$2,$3,$4,$5,$6,$7,$8,'checkbox_and_submit',now(),'ruined_membership',2,'Paid terms',$9,'Test-only agreement',$10)`,
      [id(number + 2000), id(9000), who.person, who.member, who.auth, consent, `Member ${number}`, who.email, "a".repeat(64), `terms-${number}`]);
      await db.query("update member_onboardings set profile_completed_at=now(),agreement_completed_at=now() where member_id=$1", [who.member]);
    }
    if (active) await activate(who, complimentary);
    return who;
  }
  async function activate(who, complimentary = false) {
    await db.query("update member_lifecycle set billing_state=$2 where member_id=$1", [who.member, complimentary ? "pending" : "active"]);
    await db.query("update member_onboardings set state='completed',billing_confirmed_at=case when $2 then null else now() end where member_id=$1", [who.member, complimentary]);
    await db.query(`update member_lifecycle set account_state='active',administrative_onboarding_state='completed',standing_state='active',
      program_state='onboarding',access_started_at=coalesce(access_started_at,now()),cancellation_effective_at=null where member_id=$1`, [who.member]);
  }
  const occupied = async () => (await db.query("select private.ruined_commercial_occupied_count() as count")).rows[0].count;
  const reserve = (who, request, extra = {}) => repository.reserveCommercialMembership({
    requestId: id(request), memberId: who.member, kind: "individual", plan: "monthly",
    expiresAt: new Date(Date.now() + 3600000), ...extra,
  });
  const members = [];

  await t.test("completed paid and complimentary people count; invitations and activated signups do not", async () => {
    for (let number = 1; number <= 49; number++) members.push(await member(number, { active: true, complimentary: number % 2 === 0 }));
    await member(70); await member(71, { verified: false }); await member(72, { age: false });
    assert.equal(await occupied(), 49);
    assert.equal((await repository.getCommercialEnrollment(members[1].member)).source, "complimentary");
    await db.query("insert into private.member_number_assignments(member_number,member_id,activated_at) values(0,$1,now())", [members[0].member]);
    await db.query("update ruined_members set member_number=0 where id=$1", [members[0].member]);
    assert.equal((await repository.getCommercialEnrollment(members[0].member)).foundingEligible, true, "number zero is unrelated to eligibility");
    assert.equal(await occupied(), 49);
  });

  let fiftieth, fiftyFirst, founderQuote;
  await t.test("49 active people and a held final place return a retriable delay, never standard pricing", async () => {
    fiftieth = await member(50); fiftyFirst = await member(51);
    const outcomes = await Promise.allSettled([reserve(fiftieth, 3000), reserve(fiftyFirst, 3001)]);
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
    const winner = outcomes.find(outcome => outcome.status === "fulfilled");
    const pending = outcomes.find(outcome => outcome.status === "rejected");
    founderQuote = winner.value;
    if (founderQuote.memberId !== fiftieth.member) [fiftieth, fiftyFirst] = [fiftyFirst, fiftieth];
    assert.equal(founderQuote.tier, "founding_individual");
    assert.equal(founderQuote.occupiedCountAtDecision, 49);
    assert.ok(pending.reason instanceof repository.CommercialMembershipError);
    assert.equal(pending.reason.code, "founding_place_pending");
    assert.equal(pending.reason.status, 409);
    assert.equal((await db.query("select count(*)::integer as count from membership_commercial_reservations")).rows[0].count, 1,
      "a held place cannot create a standard-price reservation or consent");
    assert.equal(await occupied(), 50);
    const duplicate = await reserve(fiftieth, 3002);
    assert.equal(duplicate.id, founderQuote.id, "concurrent tabs reuse the same immutable quote");
    await assert.rejects(reserve(fiftieth, 3003, { plan: "annual" }), /previous Checkout quote/);
    await assert.rejects(reserve(fiftieth, Number(founderQuote.id.slice(-12)), { plan: "annual" }), /conflicts/);
    const bound = await repository.bindCommercialMembershipPrice({ reservationId: founderQuote.id, stripePriceId: "price_founder_month" });
    assert.equal(bound.stripePriceId, "price_founder_month");
    await assert.rejects(repository.bindCommercialMembershipPrice({ reservationId: founderQuote.id, stripePriceId: "price_other" }), /no longer available/);
  });

  await t.test("only confirmed remote termination releases an in-flight founding quote", async () => {
    await db.query(`insert into stripe_checkout_attempts(id,member_id,email_normalized,status,agreement_version,agreement_accepted_at,age_attested_at,expires_at)
      values($1,$2,$3,'creating','ruined_membership-v2',now(),now(),now()+interval '1 hour')`, [founderQuote.id, fiftieth.member, fiftieth.email]);
    await assert.rejects(repository.releaseCommercialMembershipReservation({ reservationId: founderQuote.id, reason: "before_checkout_abandoned" }), /Confirm Checkout termination/);
    await db.query("update membership_commercial_reservations set expires_at=created_at+interval '1 microsecond' where id=$1", [founderQuote.id]);
    assert.equal(await occupied(), 50, "wall-clock expiry cannot free a remotely payable founding offer");
    await db.query("update stripe_checkout_attempts set status='expired' where id=$1", [founderQuote.id]);
    await repository.releaseCommercialMembershipReservation({ reservationId: founderQuote.id, reason: "checkout_expired" });
    assert.equal(await occupied(), 49);
    const retried = await reserve(fiftyFirst, 3004);
    assert.equal(retried.tier, "founding_individual", "the waiting person receives founding pricing when the pending place is released");
    assert.equal(await occupied(), 50);
    await repository.releaseCommercialMembershipReservation({ reservationId: retried.id, reason: "before_checkout_abandoned" });
    const abandoned = await reserve(fiftieth, 3009);
    await db.query("update membership_commercial_reservations set expires_at=created_at+interval '1 microsecond' where id=$1", [abandoned.id]);
    await repository.reconcileCommercialMemberships();
    assert.equal((await repository.getCommercialMembershipReservation(abandoned.id)).status, "released");
    assert.equal(await occupied(), 49, "expired quotes without a persisted Stripe attempt cannot hold a founding place indefinitely");
  });

  await t.test("complimentary final activation waits for a held founding place without changing its accepted price", async () => {
    const held = await reserve(fiftieth, 3005);
    await repository.bindCommercialMembershipPrice({ reservationId: held.id, stripePriceId: "price_founder_month" });
    const complimentary = await member(74, { complimentary: true });
    await assert.rejects(activate(complimentary, true), error => error.code === "P4205");
    assert.equal((await db.query("select private.ruined_member_is_active_registered($1) as active", [complimentary.member])).rows[0].active, false,
      "a complimentary join cannot take an active place and silently lose its founding eligibility");
    assert.equal(await repository.getCommercialEnrollment(complimentary.member), null);
    const unchanged = await repository.getCommercialMembershipReservation(held.id);
    assert.equal(unchanged.tier, "founding_individual");
    assert.equal(unchanged.stripePriceId, "price_founder_month");
    assert.equal(await occupied(), 50);
    await repository.releaseCommercialMembershipReservation({ reservationId: held.id, reason: "before_checkout_abandoned" });
    await activate(complimentary, true);
    assert.equal((await repository.getCommercialEnrollment(complimentary.member)).foundingEligible, true);
    assert.equal(await occupied(), 50);
    await db.query("update member_lifecycle set standing_state='inactive' where member_id=$1", [complimentary.member]);
    assert.equal(await occupied(), 49);
  });

  await t.test("paid completion takes the held 50th place before the waiting complimentary activation", async () => {
    const held = await reserve(fiftieth, 3006);
    await repository.bindCommercialMembershipPrice({ reservationId: held.id, stripePriceId: "price_founder_month" });
    const complimentary = await member(75, { complimentary: true });
    await assert.rejects(activate(complimentary, true), error => error.code === "P4205");
    await db.query(`insert into stripe_subscriptions(id,member_id,stripe_customer_id,stripe_status,latest_invoice_id,last_event_created,price_id)
      values('sub_founder',$1,'cus_founder','active','in_founder',1,'price_founder_month')`, [fiftieth.member]);
    await db.query(`insert into stripe_invoices(id,member_id,stripe_subscription_id,purpose,stripe_status,amount_paid,currency,last_event_created)
      values('in_founder',$1,'sub_founder','membership','paid',34900,'usd',1)`, [fiftieth.member]);
    await repository.activateCommercialMembership({ reservationId: held.id, stripeSubscriptionId: "sub_founder" });
    await assert.rejects(activate(complimentary, true), error => error.code === "P4205",
      "confirmed payment keeps its place until registered activation replaces the hold");
    await activate(fiftieth);
    const founderEnrollment = await repository.getCommercialEnrollment(fiftieth.member);
    assert.equal(founderEnrollment.foundingEligible, true);
    await activate(complimentary, true);
    assert.equal((await repository.getCommercialEnrollment(complimentary.member)).foundingEligible, false,
      "the later complimentary activation is now actually the 51st active person");
    assert.equal(await occupied(), 51);
    assert.equal((await repository.getCommercialEnrollment(fiftieth.member)).id, founderEnrollment.id);
    assert.equal((await repository.getCommercialEnrollment(members[0].member)).foundingEligible, true);
    const unchanged = await repository.getCommercialMembershipReservation(held.id);
    assert.equal(unchanged.tier, "founding_individual");
    assert.equal(unchanged.stripePriceId, "price_founder_month");
    await db.query("update member_lifecycle set billing_state='ended',standing_state='inactive' where member_id=$1", [fiftieth.member]);
    await db.query("update stripe_subscriptions set stripe_status='canceled' where id='sub_founder'");
    await db.query("update member_lifecycle set standing_state='inactive' where member_id=$1", [complimentary.member]);
    assert.equal(await occupied(), 49);
  });

  await t.test("scheduled cancellation and billing attention preserve founding continuity, effective end does not", async () => {
    const original = await repository.getCommercialEnrollment(members[0].member);
    await db.query("update member_lifecycle set standing_state='cancellation_requested',cancellation_effective_at=now()+interval '1 month' where member_id=$1", [members[0].member]);
    assert.equal((await repository.getCommercialEnrollment(members[0].member)).id, original.id);
    assert.equal(await occupied(), 49);
    await db.query("update member_lifecycle set billing_state='attention_required' where member_id=$1", [members[0].member]);
    assert.ok((await repository.getCommercialEnrollment(members[0].member)).billingAttentionAt);
    assert.equal((await repository.getCommercialEnrollment(members[0].member)).endedAt, null);
    await db.query("update member_lifecycle set billing_state='active',standing_state='active',cancellation_effective_at=null where member_id=$1", [members[0].member]);
    assert.equal((await repository.getCommercialEnrollment(members[0].member)).id, original.id);
    await db.query("update member_lifecycle set standing_state='cancellation_requested',cancellation_effective_at=now()-interval '1 second' where member_id=$1", [members[0].member]);
    assert.ok((await repository.getCommercialEnrollment(members[0].member)).endedAt);
    assert.equal(await occupied(), 48);
    const rejoin = await reserve(members[0], 3010);
    assert.equal(rejoin.tier, "founding_individual", "a reopened place is evaluated at rejoin time");
    await repository.releaseCommercialMembershipReservation({ reservationId: rejoin.id, reason: "before_checkout_abandoned" });
    for (const number of [52, 53]) await member(number, { active: true });
    assert.equal(await occupied(), 50);
    const laterRejoin = await reserve(members[0], 3011);
    assert.equal(laterRejoin.tier, "individual", "historic founding status and permanent number do not override a full active count");
    await repository.releaseCommercialMembershipReservation({ reservationId: laterRejoin.id, reason: "before_checkout_abandoned" });
    const events = (await db.query("select event_type from membership_commercial_events where member_id=$1", [members[0].member])).rows.map(row => row.event_type);
    for (const event of ["enrolled", "cancellation_scheduled", "billing_attention", "billing_recovered", "cancellation_withdrawn", "ended"]) assert.ok(events.includes(event), event);
  });

  await t.test("couples need the second adult's approval and reserve two distinct people under one bill", async () => {
    const payer = await member(80), partner = await member(81), stranger = await member(82);
    const authorization = await repository.createCoupleMembershipAuthorization({ id: id(4000), memberId: payer.member, partnerMemberId: partner.member });
    await assert.rejects(reserve(payer, 4001, { kind: "couple", partnerMemberId: partner.member }), /second adult must accept/);
    await assert.rejects(repository.acceptCoupleMembershipAuthorization({ id: authorization.id, authUserId: stranger.auth }), /second adult's verified account/);
    await repository.acceptCoupleMembershipAuthorization({ id: authorization.id, authUserId: partner.auth });
    assert.equal((await repository.getReadyCoupleMembershipAuthorization(payer.member)).partnerMemberId, partner.member);
    const before = await occupied();
    const quote = await reserve(payer, 4001, { kind: "couple", plan: "annual", partnerMemberId: partner.member, coupleAuthorizationId: authorization.id });
    await repository.bindCommercialMembershipPrice({ reservationId: quote.id, stripePriceId: "price_couple_annual" });
    assert.equal(quote.offerId, "couple_annual");
    assert.equal(quote.participants.length, 2);
    assert.equal(await occupied(), before + 2);
    await assert.rejects(reserve(partner, 4002), /already has/);
    await assert.rejects(repository.createCoupleMembershipAuthorization({ id: id(4003), memberId: payer.member, partnerMemberId: payer.member }), /two different adults/);
    await assert.rejects(repository.activateCommercialMembership({ reservationId: quote.id, stripeSubscriptionId: "sub_unpaid" }), /Verified paid/);
    await db.query(`insert into stripe_subscriptions(id,member_id,stripe_customer_id,stripe_status,latest_invoice_id,last_event_created,price_id)
      values('sub_couple',$1,'cus_couple','active','in_couple',1,'price_couple_annual')`, [payer.member]);
    await db.query(`insert into stripe_invoices(id,member_id,stripe_subscription_id,purpose,stripe_status,amount_paid,currency,last_event_created)
      values('in_couple',$1,'sub_couple','membership','paid',699000,'usd',1)`, [payer.member]);
    await repository.activateCommercialMembership({ reservationId: quote.id, stripeSubscriptionId: "sub_couple" });
    await activate(payer);
    await db.query(`insert into stripe_webhook_events(event_id,event_type,object_id,livemode,stripe_created,status)
      values('evt_couple_paid','invoice.paid','in_couple',false,1,'processing')`);
    await wrap(db).begin(tx => billingModule.exports.updateMemberBillingState(tx, {
      memberId: partner.member, eventCreated: 1, sourceEventId: "evt_couple_paid", state: "active",
    }));
    const partnerLifecycle = (await db.query("select billing_state,administrative_onboarding_state,program_state,standing_state from member_lifecycle where member_id=$1", [partner.member])).rows[0];
    assert.deepEqual(partnerLifecycle, { billing_state: "active", administrative_onboarding_state: "completed", program_state: "onboarding", standing_state: "active" },
      "verified shared payment completes the second adult's already signed/profile-complete onboarding");
    assert.equal(await occupied(), before + 2, "activated participants replace their holds instead of counting twice");
    assert.equal((await repository.getCommercialBillingGroupBySubscription("sub_couple")).participants.length, 2);
    const partnerAccess = async () => accessModule.exports.deriveMemberAccessPolicy(await memberModule.exports.getMemberIdentity(partner.auth));
    assert.equal((await memberModule.exports.getMemberIdentity(partner.auth)).membershipFunding, "couple");
    assert.equal((await partnerAccess()).mode, "onboarding", "the second adult uses their own authenticated account without another subscription");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [partner.auth]);
    assert.equal((await db.query("select private.ruined_current_active_access_member_id() as id")).rows[0].id, partner.member);
    await db.query("update stripe_subscriptions set stripe_status='past_due' where id='sub_couple'");
    assert.equal((await partnerAccess()).mode, "limited", "shared billing attention cannot be bypassed through the partner's stale active billing projection");
    assert.equal((await db.query("select private.ruined_current_active_access_member_id() as id")).rows[0].id, null);
    await db.query("update stripe_subscriptions set stripe_status='active' where id='sub_couple'");
    assert.equal((await partnerAccess()).mode, "onboarding");
    await db.query("update stripe_subscriptions set stripe_status='canceled' where id='sub_couple'");
    assert.ok((await repository.getCommercialEnrollment(partner.member)).endedAt, "shared subscription cancellation ends the second entitlement too");
    assert.equal((await partnerAccess()).mode, "limited");
    assert.equal((await db.query("select private.ruined_current_active_access_member_id() as id")).rows[0].id, null);
    await assert.rejects(db.exec("delete from membership_commercial_events"), /append-only|immutable|cannot|not permitted/i);
    const privileges = (await db.query(`select has_function_privilege('authenticated','private.ruined_reserve_commercial_membership(uuid,uuid,text,text,uuid,uuid,timestamptz)','execute') as reserve,
      has_table_privilege('anon','membership_commercial_reservations','select') as read`)).rows[0];
    assert.deepEqual(privileges, { reserve: false, read: false });
  });

  await t.test("checkout locking revalidates both adults and preserves immutable enrollment evidence", async () => {
    const payer = await member(90), partner = await member(91);
    await repository.createCoupleMembershipAuthorization({ id: id(4100), memberId: payer.member, partnerMemberId: partner.member });
    await repository.acceptCoupleMembershipAuthorization({ id: id(4100), authUserId: partner.auth });
    await db.query(`update person_private_profiles set default_fulfillment_address='{"countryCode":"CA"}' where person_id=$1`, [partner.person]);
    await assert.rejects(reserve(payer, 4101, { kind: "couple", partnerMemberId: partner.member, coupleAuthorizationId: id(4100) }), /United States profile/);
    await db.query(`update person_private_profiles set default_fulfillment_address='{"countryCode":"US"}' where person_id=$1`, [partner.person]);
    const quote = await reserve(payer, 4101, { kind: "couple", partnerMemberId: partner.member, coupleAuthorizationId: id(4100) });
    await db.query("update membership_couple_authorizations set revoked_at=now() where id=$1", [id(4100)]);
    await assert.rejects(wrap(db).begin(tx => repository.lockCommercialMembershipReservation(quote.id, tx)), /second adult must accept/);
    await repository.releaseCommercialMembershipReservation({ reservationId: quote.id, reason: "before_checkout_abandoned" });
    await assert.rejects(db.query("update membership_enrollment_episodes set founding_eligible=false where member_id=$1 and ended_at is null", [members[1].member]), /history is immutable/);
    await assert.rejects(db.query("update membership_enrollment_episodes set ended_at=null where member_id=$1", [members[0].member]), /history is immutable/);
  });
});
