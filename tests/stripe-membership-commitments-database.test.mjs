import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, deps) {
  const output = ts.transpileModule(await read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => { assert.ok(name in deps, name); return deps[name]; }, loaded, loaded.exports); return loaded.exports;
}
const pricing = await load("src/lib/membership/pricing.ts", {});
const policy = await load("src/lib/stripe/commitment-policy.ts", { "node:crypto": { createHash }, "@/lib/membership/pricing": pricing });
const repo = await load("src/lib/stripe/commitment-repository.ts", { "server-only": {}, "node:crypto": { randomUUID }, "./commitment-policy": policy });
function sqlFor(db) {
  const sql = async (strings, ...values) => (await db.query(strings.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, ""), values.map(v => v instanceof Date ? v.toISOString() : v))).rows;
  sql.json = value => JSON.stringify(value); return sql;
}
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table ruined_members (id uuid primary key);
    create table membership_agreement_acceptances (id uuid primary key, member_id uuid, agreement_content_sha256 text, agreement_key_snapshot text, agreement_version_snapshot integer, accepted_at timestamptz);
    create table stripe_checkout_attempts (id uuid primary key, member_id uuid, agreement_acceptance_id uuid, billing_plan text, stripe_price_id text,
      recurring_payment_accepted_at timestamptz, billing_consent_auth_user_id uuid, recurring_payment_terms jsonb, status text, stripe_subscription_id text, first_charge_at timestamptz);`);
  await db.exec(await read("db/migrations/20260929005000_membership_commitments.sql"));
  const c = policy.buildMembershipCommitment({ id: randomUUID(), memberId: randomUUID(), subscriptionId: "sub_member", customerId: "cus_member", livemode: false,
    offerId: "individual_monthly", priceId: "price_member", agreementAcceptanceId: randomUUID(), agreementVersion: "ruined_membership-v2",
    agreementContentSha256: "a".repeat(64), acceptedAt: "2026-09-01T12:00:00.000Z", startsAt: "2026-09-15T12:00:00.000Z", billingTermsVersion: "membership-billing-v2" });
  const attempt = c.id, now = new Date("2026-09-16T12:00:00.000Z");
  await db.query("insert into ruined_members values($1)", [c.memberId]);
  await db.query("insert into membership_agreement_acceptances values($1,$2,$3,'ruined_membership',2,$4)", [c.agreementAcceptanceId, c.memberId, c.agreementContentSha256, c.acceptedAt]);
  await db.query("insert into stripe_checkout_attempts values($1,$2,$3,'monthly','price_member',$4,$5,$6,'completed','sub_member',null)", [attempt, c.memberId, c.agreementAcceptanceId, c.acceptedAt, randomUUID(), JSON.stringify({ version: c.billingTermsVersion, offerId: c.offerId, amount: c.installmentDues, initialTermAmount: c.totalInitialDues, initialTermMonths: 12, buyoutCap: c.buyoutCap })]);
  const tx = callback => db.transaction(database => callback(sqlFor(database)));
  const invoice = { invoiceId: "in_paid", periodStart: c.startsAt, periodEnd: "2026-10-15T12:00:00.000Z", currency: "usd", priceId: c.priceId,
    duesBilled: 49900, duesPaid: 49900, duesRefunded: 0, duesCredited: 0, state: "paid", adjustmentState: "none" };
  const reconciliation = { id: randomUUID(), contractId: c.id, state: "complete", reconciledAt: now.toISOString(), invoices: [invoice],
    sourceEvidence: { subscriptionId: c.subscriptionId, customerId: c.customerId, livemode: false, allInvoicePages: true, allRefundPages: true, allCreditNotePages: true, principalAllocation: "verified" } };
  return { db, c, attempt, now, tx, invoice, reconciliation };
}

test("accepted contracts are immutable, idempotent and require explicit v2 recurring consent", async t => {
  const { db, c, attempt, tx } = await fixture(t);
  await db.query("update stripe_checkout_attempts set recurring_payment_terms=jsonb_set(recurring_payment_terms,'{version}','\"membership-billing-v1\"')");
  await assert.rejects(tx(sql => repo.createMembershipCommitment(sql, c, attempt)), /consent_mismatch/);
  await db.query("update stripe_checkout_attempts set recurring_payment_terms=jsonb_set(recurring_payment_terms,'{version}','\"membership-billing-v2\"')");
  assert.deepEqual(await tx(sql => repo.createMembershipCommitment(sql, c, attempt)), c);
  assert.deepEqual(await tx(sql => repo.createMembershipCommitment(sql, c, attempt)), c);
  await assert.rejects(tx(sql => repo.createMembershipCommitment(sql, { ...c, totalInitialDues: 100 }, attempt)), /snapshot_mismatch/);
  await assert.rejects(db.query("update stripe_membership_commitments set terms_snapshot=jsonb_set(terms_snapshot,'{buyoutCap}','999999')"), /immutable/);
  assert.equal((await db.query("select count(*) from stripe_membership_commitments")).rows[0].count, 1);
});

test("replacement invoice is fenced after stopping ordinary collection and retains one key across uncertainty", async t => {
  const { db, c, attempt, now, tx, reconciliation } = await fixture(t);
  await tx(sql => repo.createMembershipCommitment(sql, c, attempt));
  const revision = await tx(sql => repo.recordCommitmentReconciliation(sql, reconciliation));
  assert.equal(revision, 1); assert.equal(await tx(sql => repo.recordCommitmentReconciliation(sql, reconciliation)), 1);
  await assert.rejects(tx(sql => repo.recordCommitmentReconciliation(sql, { ...reconciliation, state: "unknown" })), /idempotency_conflict/);
  const record = await tx(sql => repo.getMembershipCommitment(sql, c));
  const quote = policy.quoteMembershipCancellation(c, record.ledger, "early_exit", now), requestId = randomUUID();
  const request = await tx(sql => repo.reserveMembershipCancellation(sql, { requestId, memberId: c.memberId, quote, now }));
  assert.equal(request.quote.buyoutDues, 150000);
  assert.deepEqual(await tx(sql => repo.reserveMembershipCancellation(sql, { requestId, memberId: c.memberId, quote, now })), request);
  assert.equal(await tx(sql => repo.fenceMembershipReplacementInvoice(sql, requestId, now)), null, "cannot bill while normal installments continue");
  const evidence = { subscriptionId: c.subscriptionId, customerId: c.customerId, livemode: false, observedAt: now.toISOString(),
    subscriptionStatus: "active", cancelAt: quote.effectiveAt, openOrdinaryInvoiceIds: [], pendingProrationOrInvoiceItems: false };
  await assert.rejects(tx(sql => repo.confirmMembershipBillingStopped(sql, requestId, { ...evidence, openOrdinaryInvoiceIds: ["in_unpaid"] }, now)), /not_safely_stopped/);
  assert.equal(await tx(sql => repo.confirmMembershipBillingStopped(sql, requestId, evidence, now)), true);
  const first = await tx(sql => repo.fenceMembershipReplacementInvoice(sql, requestId, now));
  const retry = await tx(sql => repo.fenceMembershipReplacementInvoice(sql, requestId, new Date(now.getTime() + 1000)));
  assert.equal(first.retry, false); assert.equal(retry.retry, true); assert.equal(first.providerIdempotencyKey, retry.providerIdempotencyKey);
  assert.equal(await tx(sql => repo.completeMembershipCancellation(sql, { cancellationId: requestId, replacementInvoiceId: "in_replacement", now })), true);
  assert.equal(await tx(sql => repo.completeMembershipCancellation(sql, { cancellationId: requestId, replacementInvoiceId: "in_replacement", now })), true);
  assert.equal(await tx(sql => repo.completeMembershipCancellation(sql, { cancellationId: requestId, replacementInvoiceId: "in_other", now })), false);
  assert.equal((await db.query("select status from stripe_membership_commitments")).rows[0].status, "ended", "invoice collection failure never reinstates ordinary installments");
  assert.equal(await tx(sql => repo.fenceMembershipReplacementInvoice(sql, requestId, now)), null);
});

test("refund invalidates monetary approval but ordinary cancellation remains available without ledger review", async t => {
  const { db, c, attempt, now, tx, reconciliation } = await fixture(t);
  await tx(sql => repo.createMembershipCommitment(sql, c, attempt));
  await tx(sql => repo.recordCommitmentReconciliation(sql, reconciliation));
  const record = await tx(sql => repo.getMembershipCommitment(sql, c));
  const quote = policy.quoteMembershipCancellation(c, record.ledger, "early_exit", now), requestId = randomUUID();
  await tx(sql => repo.reserveMembershipCancellation(sql, { requestId, memberId: c.memberId, quote, now }));
  assert.equal(await tx(sql => repo.invalidateMembershipCommitmentLedger(sql, { ...c, providerEventId: "evt_refund", now })), true);
  assert.equal(await tx(sql => repo.invalidateMembershipCommitmentLedger(sql, { ...c, providerEventId: "evt_refund", now })), false);
  assert.equal((await tx(sql => repo.getMembershipCancellation(sql, requestId))).status, "manual_review");
  assert.equal(await tx(sql => repo.fenceMembershipReplacementInvoice(sql, requestId, now)), null);
  const normalQuote = policy.quoteMembershipRenewalCancellation(c, { subscriptionId: c.subscriptionId, customerId: c.customerId, livemode: false,
    status: "past_due", currentPeriodEnd: "2026-10-15T12:00:00.000Z", observedAt: now.toISOString() }, now);
  const normalId = randomUUID();
  await tx(sql => repo.reserveMembershipCancellation(sql, { requestId: normalId, memberId: c.memberId, quote: normalQuote, now }));
  assert.equal(await tx(sql => repo.confirmMembershipBillingStopped(sql, normalId, { subscriptionId: c.subscriptionId, customerId: c.customerId, livemode: false,
    observedAt: now.toISOString(), subscriptionStatus: "past_due", cancelAt: c.initialTermEndsAt, openOrdinaryInvoiceIds: ["in_unpaid"], pendingProrationOrInvoiceItems: true }, now)), true);
  assert.equal(await tx(sql => repo.completeMembershipCancellation(sql, { cancellationId: normalId, replacementInvoiceId: null, now })), true);
  await assert.rejects(db.query("delete from stripe_membership_commitment_ledgers"), /append only/);
  const rls = (await db.query("select relrowsecurity from pg_class where relname in ('stripe_membership_commitments','stripe_membership_commitment_ledgers','stripe_membership_cancellations')")).rows;
  assert.equal(rls.length, 3); assert.ok(rls.every(row => row.relrowsecurity));
});

test("expired provider idempotency windows require review instead of issuing another invoice", async t => {
  const { c, attempt, now, tx, reconciliation } = await fixture(t);
  await tx(sql => repo.createMembershipCommitment(sql, c, attempt)); await tx(sql => repo.recordCommitmentReconciliation(sql, reconciliation));
  const record = await tx(sql => repo.getMembershipCommitment(sql, c));
  const quote = policy.quoteMembershipCancellation(c, record.ledger, "early_exit", now), id = randomUUID();
  await tx(sql => repo.reserveMembershipCancellation(sql, { requestId: id, memberId: c.memberId, quote, now }));
  await tx(sql => repo.confirmMembershipBillingStopped(sql, id, { subscriptionId: c.subscriptionId, customerId: c.customerId, livemode: false, observedAt: now.toISOString(),
    subscriptionStatus: "active", cancelAt: quote.effectiveAt, openOrdinaryInvoiceIds: [], pendingProrationOrInvoiceItems: false }, now));
  await tx(sql => repo.fenceMembershipReplacementInvoice(sql, id, now));
  assert.equal(await tx(sql => repo.fenceMembershipReplacementInvoice(sql, id, new Date(now.getTime() + 24 * 3600000))), null);
  assert.equal((await tx(sql => repo.getMembershipCancellation(sql, id))).status, "manual_review");
});


test("a stale no-fee renewal request can be superseded without rewriting its evidence", async t => {
  const { c, attempt, now, tx } = await fixture(t);
  await tx(sql => repo.createMembershipCommitment(sql, c, attempt));
  const provider = { subscriptionId: c.subscriptionId, customerId: c.customerId, livemode: false, status: "past_due",
    currentPeriodEnd: "2026-10-15T12:00:00.000Z", observedAt: now.toISOString() };
  const firstQuote = policy.quoteMembershipRenewalCancellation(c, provider, now), firstId = randomUUID();
  await tx(sql => repo.reserveMembershipCancellation(sql, { requestId: firstId, memberId: c.memberId, quote: firstQuote, now }));
  assert.equal(await tx(sql => repo.markMembershipCancellationNeedsReview(sql, firstId, "provider_period_changed")), true);
  const later = new Date(now.getTime() + 1000), secondId = randomUUID();
  const secondQuote = policy.quoteMembershipRenewalCancellation(c, { ...provider, observedAt: later.toISOString() }, later);
  await tx(sql => repo.reserveMembershipCancellation(sql, { requestId: secondId, memberId: c.memberId, quote: secondQuote, now: later }));
  const old = await tx(sql => repo.getMembershipCancellation(sql, firstId));
  assert.equal(old.status, "abandoned"); assert.equal(old.quote.fingerprint, firstQuote.fingerprint);
  assert.equal((await tx(sql => repo.getMembershipCancellation(sql, secondId))).status, "requested");
});

test("scheduled cancellation preserves accepted terms, prevents a second execution, and requires canceled prestart evidence", async t => {
  const { db, c, attempt, tx } = await fixture(t);
  const migration = await read("db/migrations/20261005190000_membership_first_charge.sql");
  await db.exec(migration.slice(migration.indexOf("alter table public.stripe_membership_cancellations drop constraint"), migration.indexOf("revoke all on function")));
  await db.query("update stripe_checkout_attempts set first_charge_at=$1::text::timestamptz,recurring_payment_terms=jsonb_set(recurring_payment_terms,'{firstChargeAt}',to_jsonb($1::text))", [c.startsAt]);
  await tx(sql => repo.createMembershipCommitment(sql, c, attempt));
  const now = new Date(Date.parse(c.startsAt)-60000), requestId = randomUUID();
  const provider = { subscriptionId: c.subscriptionId, customerId: c.customerId, livemode: false, status: "active", firstChargeAt: c.startsAt,
    canceledAt: null, observedAt: now.toISOString(), hasInvoices: false, pendingInvoiceItems: false };
  const quote = policy.quoteMembershipPrestartCancellation(c, provider, now);
  const record = await tx(sql => repo.reserveMembershipCancellation(sql, { requestId, memberId: c.memberId, quote, now }));
  assert.deepEqual(await tx(sql => repo.reserveMembershipCancellation(sql, { requestId, memberId: c.memberId, quote, now })), record);
  await assert.rejects(tx(sql => repo.reserveMembershipCancellation(sql, { requestId: randomUUID(), memberId: c.memberId, quote, now })), /expired_or_changed|already_pending/);
  assert.equal(await tx(sql => repo.fenceMembershipReplacementInvoice(sql, requestId, now)), null);
  const evidence = { subscriptionId: c.subscriptionId, customerId: c.customerId, livemode: false, observedAt: now.toISOString(),
    subscriptionStatus: "canceled", cancelAt: null, canceledAt: now.toISOString(), firstChargeAt: c.startsAt, noInvoices: true,
    openOrdinaryInvoiceIds: [], pendingProrationOrInvoiceItems: false };
  for (const changes of [{ subscriptionStatus: "active" }, { canceledAt: c.startsAt }, { canceledAt: "invalid" },
    { firstChargeAt: now.toISOString() }, { noInvoices: false }, { openOrdinaryInvoiceIds: ["in_unpaid"] }, { pendingProrationOrInvoiceItems: true }]) {
    await assert.rejects(tx(sql => repo.confirmMembershipBillingStopped(sql, requestId, { ...evidence, ...changes }, now)), /not_safely_stopped/);
  }
  assert.equal(await tx(sql => repo.confirmMembershipBillingStopped(sql, requestId, evidence, now)), true);
  assert.equal(await tx(sql => repo.completeMembershipCancellation(sql, { cancellationId: requestId, replacementInvoiceId: null, now })), true);
  assert.equal(await tx(sql => repo.completeMembershipCancellation(sql, { cancellationId: requestId, replacementInvoiceId: null, now })), true);
  const final = await tx(sql => repo.getMembershipCommitment(sql, c));
  assert.equal(final.status, "ended"); assert.deepEqual(final.contract, c); assert.equal(final.ledger.revision, 0);
  assert.equal((await db.query("select count(*) from stripe_membership_cancellations")).rows[0].count, 1);
});

test("a prestart quote cannot be first confirmed at its billing start", async t => {
  const { c, attempt, tx } = await fixture(t);
  await tx(sql => repo.createMembershipCommitment(sql, c, attempt));
  const now = new Date(Date.parse(c.startsAt)-60000);
  const quote = policy.quoteMembershipPrestartCancellation(c, { subscriptionId: c.subscriptionId, customerId: c.customerId, livemode: false,
    status: "active", firstChargeAt: c.startsAt, canceledAt: null, observedAt: now.toISOString(), hasInvoices: false, pendingInvoiceItems: false }, now);
  await assert.rejects(tx(sql => repo.reserveMembershipCancellation(sql, { requestId: randomUUID(), memberId: c.memberId, quote, now: new Date(c.startsAt) })), /expired_or_changed/);
});
