import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
function sqlFor(db) {
  const sql = async (strings, ...values) => (await db.query(strings.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, ""), values.map(v => v instanceof Date ? v.toISOString() : v))).rows;
  sql.json = value => JSON.stringify(value); return sql;
}

test("renewal queue deduplicates concurrent enqueues, leases once, fences sends and reports missed windows", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const match of (await read("scripts/migrate-platform.mjs")).matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)) await db.exec(await read(match[1]));
  const output = ts.transpileModule(await read("src/lib/stripe/renewal-repository.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    if (name === "server-only") return {};
    assert.equal(name, "@/lib/database/server"); return { getApplicationDatabase: () => sqlFor(db) };
  }, loaded, loaded.exports);
  const repo = loaded.exports;
  const now = new Date(), memberId = randomUUID();
  await db.query("insert into ruined_members(id,email,email_normalized,stripe_customer_id) values($1,'member@example.test','member@example.test','cus_member')", [memberId]);
  for (const [id, days, price, canceled] of [["sub_40", 39, "price_annual", false], ["sub_20", 19, "price_annual", false], ["sub_missed", 14, "price_annual", false], ["sub_monthly", 19, "price_monthly", false], ["sub_canceled", 19, "price_annual", true]]) {
    await db.query("insert into stripe_subscriptions(id,member_id,stripe_customer_id,stripe_status,price_id,current_period_end,cancel_at_period_end,last_event_created) values($1,$2,'cus_member','active',$3,$4,$5,1)", [id, memberId, price, new Date(now.getTime() + days * 86400000).toISOString(), canceled]);
  }
  const inserted = await Promise.all([repo.enqueueMembershipRenewalNotices("price_annual", true, now), repo.enqueueMembershipRenewalNotices("price_annual", true, now)]);
  assert.equal(inserted.reduce((a, b) => a + b), 5);
  assert.deepEqual(await repo.getRenewalNoticeHealth(true), { manualReview: 3, remainingDue: 2 });
  const lease1 = randomUUID(), lease2 = randomUUID();
  const [first, second] = await Promise.all([repo.claimRenewalNotice(true, lease1, now), repo.claimRenewalNotice(true, lease2, now)]);
  assert.ok(first); assert.ok(second); assert.notEqual(first.id, second.id);
  assert.equal(await repo.claimRenewalNotice(true, randomUUID(), now), null);
  assert.equal(await repo.claimRenewalNotice(false, randomUUID(), now), null, "test jobs never claim live deliveries");
  const payload = { from: "billing@example.test", to: "member@example.test", replyTo: "connect@theruinedproject.com", subject: "Test", html: "<p>test</p>", text: "test" };
  const preview = { renewalDate: first.renewsAt, currency: "usd", membershipAmount: 100, taxAmount: 0, invoiceTotal: 100, amountDue: 100 };
  assert.equal(await repo.persistRenewalNoticePayload(first.id, lease1, payload, preview, first.email), true);
  assert.equal(await repo.persistRenewalNoticePayload(first.id, lease1, payload, preview, first.email), false, "saved provider payload is immutable");
  assert.equal(await repo.fenceRenewalNoticeSend(first.id, lease2), false, "wrong lease cannot send");
  await db.query("update stripe_subscriptions set cancel_at=current_period_end where id=$1", [first.subscriptionId]);
  assert.equal(await repo.fenceRenewalNoticeSend(first.id, lease1), false, "flexible cancellation after claim blocks the send fence");
  await db.query("update stripe_subscriptions set cancel_at=null where id=$1", [first.subscriptionId]);
  assert.equal(await repo.fenceRenewalNoticeSend(first.id, lease1), true);
  assert.ok((await db.query("select first_send_attempt_at from stripe_membership_renewal_notices where id=$1", [first.id])).rows[0].first_send_attempt_at);
  assert.equal(await repo.finishRenewalNotice(first.id, lease1, "sent", null, "email_sent"), true);
  assert.equal(await repo.finishRenewalNotice(first.id, lease1, "failed", "late_worker"), false);

  // A cancellation before any send may be resumed for the same period; sent or
  // uncertain deliveries must never acquire a fresh key or fresh payload.
  assert.equal(await repo.finishRenewalNotice(second.id, lease2, "cancelled", "renewal_cancelled"), true);
  assert.equal(await repo.enqueueMembershipRenewalNotices("price_annual", true, now), 1);
  const lease3 = randomUUID();
  const resumed = await repo.claimRenewalNotice(true, lease3, now);
  assert.equal(resumed.id, second.id); assert.equal(resumed.attempts, 1); assert.equal(resumed.payload, null);
  await repo.persistRenewalNoticePayload(resumed.id, lease3, payload, { ...preview, renewalDate: resumed.renewsAt }, resumed.email);
  await repo.fenceRenewalNoticeSend(resumed.id, lease3);
  await repo.finishRenewalNotice(resumed.id, lease3, "cancelled", "renewal_cancelled_after_uncertain_attempt");
  assert.equal(await repo.enqueueMembershipRenewalNotices("price_annual", true, now), 0, "uncertainty and successful send history survive reinstatement");
  await db.query("update stripe_subscriptions set cancel_at_period_end=false, cancel_at=current_period_end where id='sub_canceled'");
  assert.equal(await repo.enqueueMembershipRenewalNotices("price_annual", true, now), 0, "canonical flexible cancellation prevents a new notice");
  await db.query("update stripe_subscriptions set cancel_at=current_period_end+interval '1 day' where id='sub_canceled'");
  assert.equal(await repo.enqueueMembershipRenewalNotices("price_annual", true, now), 2, "cancellation after next billing preserves its notice eligibility");
  const policies = (await db.query("select relrowsecurity from pg_class where relname='stripe_membership_renewal_notices'")).rows;
  assert.equal(policies[0].relrowsecurity, true);

  // Real commitment rows are the only authority for a monthly anniversary.
  // One month's current_period_end is intentionally earlier than the term end.
  const personId = (await db.query("select person_id from ruined_members where id=$1", [memberId])).rows[0].person_id;
  const authId = randomUUID(), agreementId = randomUUID(), acceptanceId = randomUUID();
  await db.query("insert into platform_users(auth_user_id,person_id,member_id,email_normalized,status) values($1,$2,$3,'member@example.test','active')", [authId, personId, memberId]);
  await db.query("insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,'ruined_membership',2,'Test paid terms','Test terms',$2,'published',now())", [agreementId, "a".repeat(64)]);
  await db.query(`insert into membership_agreement_acceptances(id,agreement_version_id,person_id,member_id,accepted_by_auth_user_id,signer_name_snapshot,signer_email_snapshot,
    affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
    values($1,$2,$3,$4,$5,'Test Member','member@example.test','checkbox_and_submit',now(),'ruined_membership',2,'Test paid terms',$6,'Test terms','renewal-test-acceptance')`,
  [acceptanceId, agreementId, personId, memberId, authId, "a".repeat(64)]);
  const offers = Object.fromEntries(["individual", "founding_individual", "couple"].flatMap(tier => ["monthly", "annual"].map(plan => [`${tier}_${plan}`, `price_${tier}_${plan}`])));
  for (const [offerId, priceId] of Object.entries(offers)) {
    const monthly = offerId.endsWith("_monthly"), attemptId = randomUUID();
    const periodEnd = new Date(now.getTime() + (monthly ? 9 : 19) * 86400000).toISOString();
    const termEnd = new Date(now.getTime() + (monthly ? 39 : 19) * 86400000).toISOString();
    await db.query(`insert into stripe_subscriptions(id,member_id,stripe_customer_id,stripe_status,price_id,current_period_end,last_event_created)
      values($1,$2,'cus_member','active',$3,$4,1)`, [`sub_${offerId}`, memberId, priceId, periodEnd]);
    await db.query(`insert into stripe_checkout_attempts(id,member_id,email_normalized,status,agreement_version,agreement_accepted_at,age_attested_at,expires_at)
      values($1,$2,'member@example.test','completed','ruined_membership-v2',now(),now(),now()+interval '1 day')`, [attemptId, memberId]);
    await db.query(`insert into stripe_membership_commitments(id,member_id,checkout_attempt_id,agreement_acceptance_id,stripe_subscription_id,stripe_customer_id,livemode,terms_snapshot,terms_sha256)
      values($1,$2,$1,$3,$4,'cus_member',true,$5,$6)`, [attemptId, memberId, acceptanceId, `sub_${offerId}`,
      JSON.stringify({ billingTermsVersion: "membership-billing-v2", currency: "usd", billingPlan: monthly ? "monthly" : "annual",
        offerId, priceId, initialTermEndsAt: termEnd }), "b".repeat(64)]);
  }
  const commercialConfiguration = { annual: "price_annual", monthly: "price_monthly", legacy: null, livemode: true, offers };
  assert.equal(await repo.enqueueMembershipRenewalNotices(commercialConfiguration, true, now), 9);
  const commercialNotices = (await db.query("select * from stripe_membership_renewal_notices where contract_id is not null order by offer_id,lead_days")).rows;
  assert.equal(commercialNotices.length, 9);
  assert.equal(commercialNotices.filter(row => row.notice_kind === "initial_term_end").length, 3);
  for (const row of commercialNotices.filter(row => row.notice_kind === "initial_term_end")) {
    assert.equal(new Date(row.renews_at).getTime(), now.getTime() + 39 * 86400000);
    assert.equal(row.lead_days, 40);
    assert.equal(row.status, "pending");
  }
  assert.equal(await repo.enqueueMembershipRenewalNotices(commercialConfiguration, true, now), 0);
  // Existing one-year commitments queue both 40- and 20-day notices, whereas
  // an unrelated legacy monthly subscription never gains an inferred contract.
  assert.equal((await db.query("select count(*)::integer as count from stripe_membership_renewal_notices where subscription_id='sub_monthly'")).rows[0].count, 0);
  const monthlyNotice = commercialNotices.find(row => row.offer_id === "couple_monthly");
  const commercialLease = randomUUID();
  await db.query("update stripe_membership_renewal_notices set status='processing',locked_by=$2,locked_at=now() where id=$1", [monthlyNotice.id, commercialLease]);
  await repo.persistRenewalNoticePayload(monthlyNotice.id, commercialLease, payload, { ...preview, renewalDate: new Date(monthlyNotice.renews_at).toISOString() }, "member@example.test");
  assert.equal(await repo.fenceRenewalNoticeSend(monthlyNotice.id, commercialLease), true, "monthly notice fences against contract anniversary instead of current_period_end");
  await db.query("update stripe_subscriptions set cancel_at=$2 where id=$1", [monthlyNotice.subscription_id, monthlyNotice.renews_at]);
  assert.equal(await repo.fenceRenewalNoticeSend(monthlyNotice.id, commercialLease), false);
  await db.query("update stripe_subscriptions set cancel_at=null where id=$1", [monthlyNotice.subscription_id]);
  await db.query("update stripe_membership_commitments set status='exit_pending' where id=$1", [monthlyNotice.contract_id]);
  assert.equal(await repo.fenceRenewalNoticeSend(monthlyNotice.id, commercialLease), false, "an accepted early exit suppresses a stale renewal notice");
});
