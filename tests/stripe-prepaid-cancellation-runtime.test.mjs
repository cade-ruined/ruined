import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}, clock = Date) {
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", "Date", output)(name => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, loaded, loaded.exports, { env: {} }, clock);
  return loaded.exports;
}
const pricing = await load("src/lib/membership/pricing.ts");
const schedule = await load("src/lib/membership/foundations-schedule.ts");
const prepaid = await load("src/lib/stripe/prepaid-policy.ts", { "node:crypto": { createHash }, "@/lib/membership/pricing": pricing, "@/lib/membership/foundations-schedule": schedule });
const policy = await load("src/lib/stripe/commitment-policy.ts", { "node:crypto": { createHash }, "@/lib/membership/pricing": pricing });

async function fixture({ refundStatus = "succeeded", timeoutAfterCancel = false, timeoutAfterRefund = false, missedCutoff = false } = {}) {
  const now = new Date(), billingSchedule = schedule.createFoundationsBillingSchedule(now, "monthly");
  const contract = policy.buildMembershipCommitment({ id: randomUUID(), memberId: randomUUID(), subscriptionId: "sub_member", customerId: "cus_member",
    livemode: false, offerId: "individual_monthly", priceId: "price_member", agreementAcceptanceId: randomUUID(), agreementVersion: "ruined_membership-v3",
    agreementContentSha256: "a".repeat(64), acceptedAt: now.toISOString(), startsAt: billingSchedule.serviceStartsAt,
    billingTermsVersion: "membership-billing-v2", billingSchedule });
  const clockNow = missedCutoff ? Date.parse(contract.startsAt) + 86400000 : null;
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clockNow ?? Date.now()])); } static now() { return clockNow ?? Date.now(); } }
  const sub = { id: contract.subscriptionId, customer: contract.customerId, livemode: false, status: "trialing", cancel_at: null,
    canceled_at: null, cancel_at_period_end: false, trial_end: Date.parse(billingSchedule.prepaidThrough) / 1000,
    billing_cycle_anchor: Date.parse(billingSchedule.prepaidThrough) / 1000, latest_invoice: "in_first",
    metadata: { billing_terms_version: "membership-billing-v2", ruined_member_id: contract.memberId,
      ruined_billing_plan: "monthly", ...prepaid.prepaidBillingMetadata(billingSchedule) },
    items: { data: [{ id: "si_member", current_period_end: Date.parse(billingSchedule.prepaidThrough) / 1000, price: { id: contract.priceId } }] } };
  const payment = { invoiceId: "in_first", paymentIntentId: "pi_first", chargeId: "ch_first", amount: 52993, currency: "usd",
    periodStart: contract.startsAt, periodEnd: billingSchedule.prepaidThrough, refund: null,
    invoice: { status_transitions: { paid_at: missedCutoff ? Date.parse(billingSchedule.cutoffAt)/1000 + 60 : Math.floor(now.getTime()/1000) } } };
  const proof = { contractId: contract.id, subscriptionId: contract.subscriptionId, invoiceId: payment.invoiceId, paymentIntentId: payment.paymentIntentId,
    chargeId: payment.chargeId, reviewReason: missedCutoff ? "cohort_cutoff_missed" : null, refundState: missedCutoff ? "review_required" : "none", activatedAt: null };
  const stored = new Map(), calls = [], proofs = [], refundLockOrders = []; let cancellation = null, heldLocks = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ");
    if (query.includes("pg_advisory_xact_lock")) { heldLocks.push("commercial"); return []; }
    if (query.includes("insert into stripe_membership_cancellation_quotes")) {
      const [id,,,quote,evidence,taxCode,taxEnabled,feeTotal] = values;
      stored.set(id, { id, quote, evidence, taxCode, taxEnabled, feeTotal }); return [];
    }
    if (query.includes("select contract.terms_snapshot as contract")) return proof.reviewReason === "cohort_cutoff_missed"
      && proof.refundState === "review_required" && proof.activatedAt === null && cancellation?.status !== "completed" ? [{ contract }] : [];
    if (query.includes("from stripe_membership_cancellation_quotes")) return stored.has(values[0]) ? [stored.get(values[0])] : [];
    if (query.includes("from stripe_membership_cancellations cancellation")) return cancellation && cancellation.status !== "completed"
      ? [{ cancellationId: cancellation.id, memberId: contract.memberId, status: cancellation.status,
        subscriptionId: contract.subscriptionId, livemode: contract.livemode }] : [];
    if (query.includes("cancellation_lease_token = null")) return [];
    if (query.includes("cancellation_lease_token =")) return [{ id: contract.id }];
    throw Error(query);
  };
  sql.json = value => value; sql.begin = async callback => {
    const previous = heldLocks; heldLocks = [];
    try { return await callback(sql); } finally { heldLocks = previous; }
  };
  const stripe = {
    subscriptions: { retrieve: async () => structuredClone(sub), cancel: async (id, input, options) => {
      calls.push({ action: "cancel", id, input, options }); sub.status = "canceled"; sub.canceled_at = Math.floor(ClockDate.now()/1000);
      if (timeoutAfterCancel) { timeoutAfterCancel = false; throw Error("Timeout after provider stop"); }
      return structuredClone(sub);
    } },
    invoiceItems: { list: async () => ({ data: [], has_more: false }) },
    refunds: { create: async (input, options) => {
      assert.equal(sub.status, "canceled", "no refund may leave renewals running");
      assert.equal(cancellation.status, "collection_in_flight", "refund intent must be durable first");
      calls.push({ action: "refund", input, options });
      payment.refund = { id: "re_first", status: refundStatus, amount: input.amount, metadata: input.metadata };
      if (timeoutAfterRefund) { timeoutAfterRefund = false; throw Error("Timeout after provider refund"); }
      return structuredClone(payment.refund);
    } },
  };
  const provider = await load("src/lib/stripe/cancellation-provider.ts", {
    "node:crypto": { createHash }, "@/lib/stripe/server": { getStripe: () => stripe, getMembershipPriceConfiguration: () => ({}) },
    "@/lib/stripe/price-policy": { recognizesMembershipSubscription: () => true }, "@/lib/stripe/prepaid-policy": prepaid, "@/lib/stripe/commitment-policy": policy,
    "@/lib/stripe/database": { getBillingDatabase: () => sql },
    "@/lib/stripe/billing-repository": { getMembershipPrepayment: async () => proof },
    "@/lib/stripe/prepaid-provider": { inspectPrepaidMembershipInvoice: async (_stripe, _contract, options) => {
      if (payment.refund && !options.allowRefund) throw new policy.MembershipCommitmentError("prepaid_refund_requires_review");
      return structuredClone(payment);
    } },
  }, ClockDate);
  const repository = {
    getMembershipCancellation: async () => cancellation,
    reserveMembershipCancellation: async (_tx, input) => {
      cancellation = { id: input.requestId, status: "requested", quote: input.quote, providerIdempotencyKey: `cancel:${input.requestId}`, replacementInvoiceId: null };
      return cancellation;
    },
    confirmMembershipBillingStopped: async (_tx, _id, evidence) => {
      assert.equal(evidence.subscriptionStatus, "canceled"); assert.equal(evidence.prepaidInvoiceId, "in_first");
      cancellation.status = "billing_stopped"; cancellation.billingStopEvidence = evidence; return true;
    },
    fenceMembershipPrepaidRefund: async () => { cancellation.status = "collection_in_flight"; return { providerIdempotencyKey: cancellation.providerIdempotencyKey }; },
    recordMembershipPrepaidRefundEvidence: async (_tx, _id, evidence) => {
      assert.deepEqual(heldLocks, ["commercial", "proof"], "refund must follow webhook lock order before taking the contract lock");
      heldLocks.push("contract"); refundLockOrders.push([...heldLocks]);
      assert.equal(cancellation.status, "collection_in_flight"); cancellation.billingStopEvidence.refund = evidence; return true;
    },
    completeMembershipCancellation: async (_tx, input) => {
      assert.equal(input.replacementInvoiceId, null); assert.equal(cancellation.billingStopEvidence.refund.status, "succeeded");
      cancellation.status = "completed"; return true;
    },
    markMembershipCancellationNeedsReview: async () => { if (cancellation) cancellation.status = "manual_review"; },
  };
  const service = await load("src/lib/stripe/cancellation-service.ts", {
    "node:crypto": { randomUUID }, "@/lib/stripe/database": { getBillingDatabase: () => sql },
    "@/lib/stripe/commitment-account": { getMemberBillingCommitment: async () => contract },
    "@/lib/stripe/server": { getStripe: () => stripe, isStripeTaxEnabled: () => false },
    "@/lib/stripe/cancellation-provider": provider, "@/lib/stripe/commitment-policy": policy,
    "@/lib/stripe/commitment-repository": repository,
    "@/lib/stripe/billing-repository": {
      getMembershipPrepayment: async () => { heldLocks.push("proof"); return proof; },
      recordPrepaidMembershipRefund: async (_tx, evidence) => {
        proofs.push(evidence); proof.refundState = evidence.status === "succeeded" ? "refunded" : evidence.status === "pending" ? "pending" : "review_required";
      },
    },
  }, ClockDate);
  return { contract, sub, payment, proof, provider, service, stored, calls, proofs, refundLockOrders, cancellation: () => cancellation };
}

test("prepaid prestart cancellation stops billing and refunds the exact initial payment including tax once", async () => {
  const f = await fixture(), quote = await f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start");
  assert.equal(quote.refundAmount, 52993); assert.equal(quote.feeTotal, 0);
  const result = await f.service.confirmMemberCancellation(f.contract.memberId, quote.id);
  assert.equal(result.refundStatus, "succeeded"); assert.equal(result.refundAmount, 52993);
  assert.deepEqual(f.calls.map(call => call.action), ["cancel", "refund"]);
  assert.deepEqual(f.calls[0].input, { invoice_now: false, prorate: false });
  assert.equal(f.calls[1].input.payment_intent, "pi_first");
  assert.equal(f.proofs[0].status, "succeeded");
  assert.deepEqual(f.refundLockOrders, [["commercial", "proof", "contract"]]);
  assert.deepEqual(await f.service.confirmMemberCancellation(f.contract.memberId, quote.id), result);
  assert.equal(f.calls.length, 2);
});

test("pending refunds retain the commercial hold and retry the same refund through successful readback", async () => {
  const f = await fixture({ refundStatus: "pending" }), quote = await f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start");
  const pending = await f.service.confirmMemberCancellation(f.contract.memberId, quote.id);
  assert.equal(pending.refundStatus, "pending"); assert.equal(f.cancellation().status, "collection_in_flight");
  assert.equal((await f.service.confirmMemberCancellation(f.contract.memberId, quote.id)).refundStatus, "pending");
  f.payment.refund.status = "succeeded";
  assert.equal((await f.service.confirmMemberCancellation(f.contract.memberId, quote.id)).refundStatus, "succeeded");
  assert.equal(f.calls.length, 2); assert.equal(f.cancellation().status, "completed");
});

test("post-commit reconciliation resumes only a recorded execution, never a quote alone", async () => {
  const f = await fixture({ refundStatus: "pending" }), input = { subscriptionId: f.contract.subscriptionId, livemode: false };
  assert.deepEqual(await f.service.reconcilePrepaidMembershipCancellation(input), { handled: false });
  const quote = await f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start");
  assert.deepEqual(await f.service.reconcilePrepaidMembershipCancellation(input), { handled: false }); assert.equal(f.calls.length, 0);
  await f.service.confirmMemberCancellation(f.contract.memberId, quote.id);
  f.payment.refund.status = "succeeded";
  const result = await f.service.reconcilePrepaidMembershipCancellation(input);
  assert.equal(result.handled, true); assert.equal(result.cancellation.refundStatus, "succeeded"); assert.equal(f.calls.length, 2);
  assert.deepEqual(await f.service.reconcilePrepaidMembershipCancellation(input), { handled: false });
});

test("missed-cutoff restitution survives an outage past the first call without expanding normal cancellation", async () => {
  const f = await fixture({ missedCutoff: true });
  await assert.rejects(f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start"), /requires_review/);
  const result = await f.service.refundMissedFoundationsEnrollment({ subscriptionId: f.contract.subscriptionId, livemode: false });
  assert.equal(result.handled, true); assert.equal(result.cancellation.refundStatus, "succeeded");
  assert.ok(f.sub.canceled_at >= Date.parse(f.contract.startsAt)/1000);
  assert.equal(f.cancellation().quote.invalidEnrollmentReason, "cohort_cutoff_missed");
  assert.equal(f.cancellation().quote.buyoutDues, 0); assert.equal(f.proofs[0].amount, f.payment.amount);
  assert.deepEqual(f.calls.map(call => call.action), ["cancel", "refund"]);
  assert.deepEqual(await f.service.refundMissedFoundationsEnrollment({ subscriptionId: f.contract.subscriptionId, livemode: false }), { handled: false });
  assert.equal(f.stored.size, 1); assert.equal(f.calls.length, 2);
});

test("repeated cutoff-worker runs resume the same durable cancellation through provider timeouts and pending refunds", async () => {
  for (const options of [{ timeoutAfterCancel: true }, { timeoutAfterRefund: true }, { refundStatus: "pending" }]) {
    const f = await fixture({ missedCutoff: true, ...options }), input = { subscriptionId: f.contract.subscriptionId, livemode: false };
    if (options.refundStatus) assert.equal((await f.service.refundMissedFoundationsEnrollment(input)).cancellation.refundStatus, "pending");
    else await assert.rejects(f.service.refundMissedFoundationsEnrollment(input), /Timeout after provider/);
    if (f.payment.refund) f.payment.refund.status = "succeeded";
    assert.equal((await f.service.refundMissedFoundationsEnrollment(input)).cancellation.refundStatus, "succeeded");
    assert.deepEqual(await f.service.refundMissedFoundationsEnrollment(input), { handled: false });
    assert.equal(f.stored.size, 1); assert.deepEqual(f.calls.map(call => call.action), ["cancel", "refund"]);
  }
});

test("missed-cutoff exception rejects an activated enrollment, another review reason, or payment before cutoff", async () => {
  for (const change of [f => { f.proof.activatedAt = new Date(f.contract.startsAt); },
    f => { f.proof.reviewReason = "disputed_payment"; },
    f => { f.payment.invoice.status_transitions.paid_at = Date.parse(f.contract.billingSchedule.cutoffAt)/1000 - 1; }]) {
    const f = await fixture({ missedCutoff: true }); change(f);
    await assert.rejects(f.provider.readPrepaidCancellationEvidence(f.contract, { invalidEnrollmentReason: "cohort_cutoff_missed" }), /requires_review/);
    assert.equal(f.calls.length, 0);
  }
});

test("network uncertainty after cancellation or refund recovers by readback without another mutation", async () => {
  for (const options of [{ timeoutAfterCancel: true }, { timeoutAfterRefund: true }]) {
    const f = await fixture(options), quote = await f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start");
    await assert.rejects(f.service.confirmMemberCancellation(f.contract.memberId, quote.id), /Timeout after provider/);
    assert.notEqual(f.cancellation().status, "manual_review");
    assert.equal((await f.service.confirmMemberCancellation(f.contract.memberId, quote.id)).refundStatus, "succeeded");
    assert.deepEqual(f.calls.map(call => call.action), ["cancel", "refund"]);
  }
});

test("changed amount, foreign refund, failed refund and cancellation after service start never report success", async () => {
  for (const mutate of [f => { f.payment.amount++; }, f => { f.payment.refund = { id: "re_foreign", amount: f.payment.amount, status: "succeeded", metadata: {} }; },
    f => { f.sub.status = "canceled"; f.sub.canceled_at = Date.parse(f.contract.startsAt)/1000; }]) {
    const f = await fixture(), quote = await f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start");
    mutate(f); await assert.rejects(f.service.confirmMemberCancellation(f.contract.memberId, quote.id), /requires_review/);
    assert.equal(f.cancellation().status, "manual_review"); assert.equal(f.calls.length, 0);
  }
  const f = await fixture({ refundStatus: "failed" }), quote = await f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start");
  await assert.rejects(f.service.confirmMemberCancellation(f.contract.memberId, quote.id), /requires_review/);
  assert.equal(f.proofs[0].status, "failed"); assert.equal(f.cancellation().status, "manual_review");
});

test("trialing is accepted only for exact prepaid contract metadata and paid coverage counts the first of twelve installments", async () => {
  const f = await fixture();
  assert.doesNotThrow(() => f.provider.verifyCommitmentSubscription(f.sub, f.contract));
  assert.throws(() => f.provider.verifyCommitmentSubscription(f.sub, { ...f.contract, billingSchedule: undefined }), /requires_review/);
  assert.throws(() => f.provider.verifyCommitmentSubscription({ ...f.sub, trial_end: f.sub.trial_end + 1 }, f.contract), /requires_review/);
  const now = new Date(Date.parse(f.contract.startsAt) + 86400000);
  const ledger = { revision: 1, reconciledAt: now.toISOString(), state: "complete", invoices: [{ invoiceId: "in_first",
    periodStart: f.contract.startsAt, periodEnd: f.contract.billingSchedule.prepaidThrough, currency: "usd", priceId: f.contract.priceId,
    duesBilled: f.contract.installmentDues, duesPaid: f.contract.installmentDues, duesRefunded: 0, duesCredited: 0, state: "paid", adjustmentState: "none" }] };
  const quote = policy.quoteMembershipCancellation(f.contract, ledger, "early_exit", now);
  assert.equal(quote.remainingInitialDues, f.contract.installmentDues * 11);
  assert.equal(quote.accessThrough, f.contract.billingSchedule.prepaidThrough);
  const renewal = policy.quoteMembershipRenewalCancellation(f.contract, { subscriptionId: f.contract.subscriptionId, customerId: f.contract.customerId,
    livemode: false, status: "trialing", observedAt: now.toISOString(), currentPeriodEnd: f.contract.billingSchedule.prepaidThrough }, now);
  assert.equal(renewal.effectiveAt, f.contract.initialTermEndsAt);
});

test("prepaid refund quote covers every exact offer and stops at the service boundary", () => {
  const now = new Date("2026-10-05T20:00:00.000Z");
  for (const offer of Object.values(pricing.MEMBERSHIP_OFFERS)) {
    const billingSchedule = schedule.createFoundationsBillingSchedule(now, offer.plan);
    const contract = policy.buildMembershipCommitment({ id: randomUUID(), memberId: randomUUID(), subscriptionId: "sub_member", customerId: "cus_member",
      livemode: false, offerId: offer.id, priceId: "price_member", agreementAcceptanceId: randomUUID(), agreementVersion: "ruined_membership-v3",
      agreementContentSha256: "a".repeat(64), acceptedAt: now.toISOString(), startsAt: billingSchedule.serviceStartsAt,
      billingTermsVersion: "membership-billing-v2", billingSchedule });
    const snapshot = { subscriptionId: contract.subscriptionId, customerId: contract.customerId, livemode: false, status: "trialing",
      serviceStartsAt: contract.startsAt, prepaidThrough: billingSchedule.prepaidThrough, canceledAt: null, observedAt: now.toISOString(),
      invoiceId: "in_prepaid", paymentIntentId: "pi_prepaid", chargeId: "ch_prepaid", amount: offer.amount, currency: "usd", pendingInvoiceItems: false };
    assert.equal(policy.quoteMembershipPrepaidCancellation(contract, snapshot, now).refundAmount, offer.amount);
    const boundary = new Date(contract.startsAt);
    assert.throws(() => policy.quoteMembershipPrepaidCancellation(contract, { ...snapshot, observedAt: boundary.toISOString() }, boundary), /requires_review/);
    assert.throws(() => policy.quoteMembershipPrepaidCancellation(contract, { ...snapshot, amount: offer.amount - 1 }, now), /requires_review/);
  }
});

test("prepaid account summary resumes the same pending cancellation and requires confirmed refund before another enrollment", async () => {
  const f = await fixture();
  let row = { terms: f.contract, contractStatus: "active", subscriptionStatus: "trialing", prestartCanceled: false,
    prestartReview: false, paid: true, cancellationQuoteId: null };
  let proof = { refundState: "none", amountPaid: f.payment.amount, activatedAt: null };
  const sql = async () => [row]; sql.begin = callback => callback(sql);
  const account = await load("src/lib/stripe/commitment-account.ts", {
    "@/lib/stripe/database": { getBillingDatabase: () => sql }, "@/lib/stripe/server": { getStripeLivemode: () => false },
    "@/lib/stripe/billing-repository": { getMembershipPrepayment: async () => proof },
  });
  const read = now => account.getMemberBillingCommitmentSummary(f.contract.memberId, now);
  assert.equal((await read()).status, "scheduled"); assert.equal((await read()).canCancelBeforeStart, true);
  proof = null; assert.equal((await read()).status, "pending_payment");
  proof = { refundState: "pending", amountPaid: f.payment.amount, activatedAt: null };
  row = { ...row, contractStatus: "exit_pending", subscriptionStatus: "canceled", cancellationQuoteId: "quote_pending" };
  assert.equal((await read()).status, "refund_pending"); assert.equal((await read()).cancellationQuoteId, "quote_pending");
  assert.equal((await read()).canceledBeforeStart, false);
  proof.refundState = "refunded";
  assert.equal((await read()).status, "refund_pending", "refund proof alone must not skip durable cancellation completion");
  row = { ...row, prestartCanceled: true, cancellationQuoteId: null, contractStatus: "ended" };
  assert.equal((await read()).status, "canceled"); assert.equal((await read()).refundStatus, "succeeded");
  assert.equal((await read()).canceledBeforeStart, true);
  row.prestartCanceled = false; proof.refundState = "none";
  assert.equal((await read()).status, "review_required", "external cancellation cannot imply money was returned");
});
