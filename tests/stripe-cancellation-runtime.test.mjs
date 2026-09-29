import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}, env = {}) {
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", output)(name => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, loaded, loaded.exports, { env });
  return loaded.exports;
}
const pricing = await load("src/lib/membership/pricing.ts");
const policy = await load("src/lib/stripe/commitment-policy.ts", { "node:crypto": { createHash }, "@/lib/membership/pricing": pricing });
const prices = await load("src/lib/stripe/price-policy.ts", { "@/lib/membership/pricing": pricing });
const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0); start.setUTCMonth(start.getUTCMonth() - 10);
const contract = policy.buildMembershipCommitment({ id: randomUUID(), memberId: randomUUID(), subscriptionId: "sub_member", customerId: "cus_member",
  livemode: false, offerId: "individual_monthly", priceId: "price_member", agreementAcceptanceId: randomUUID(), agreementVersion: "ruined_membership-v2",
  agreementContentSha256: "a".repeat(64), acceptedAt: new Date(start.getTime()-1000).toISOString(), startsAt: start.toISOString(), billingTermsVersion: "membership-billing-v2" });
const dueInvoices = Array.from({ length: 11 }, (_, month) => ({ invoiceId: `in_${month}`, periodStart: policy.membershipCommitmentAnniversary(contract.startsAt, month),
  periodEnd: policy.membershipCommitmentAnniversary(contract.startsAt, month + 1), currency: "usd", priceId: contract.priceId,
  duesBilled: 49900, duesPaid: 49900, duesRefunded: 0, duesCredited: 0, state: "paid", adjustmentState: "none" }));
function subscription() { return { id: contract.subscriptionId, customer: contract.customerId, livemode: false, status: "active", cancel_at: null, cancel_at_period_end: false,
  metadata: { billing_terms_version: "membership-billing-v2", ruined_offer_id: contract.offerId, ruined_billing_plan: "monthly", ruined_member_id: contract.memberId, ruined_commercial_reservation_id: "reservation" },
  items: { has_more: false, data: [{ id: "si_member", quantity: 1, current_period_end: Date.parse(dueInvoices.at(-1).periodEnd) / 1000,
    price: { id: contract.priceId, type: "recurring", livemode: false, billing_scheme: "per_unit", tax_behavior: "exclusive", currency: "usd", unit_amount: 49900,
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } } }] } }; }
const config = { monthly: "price_member", annual: "price_annual", legacy: null, livemode: false, offers: { individual_monthly: "price_member" } };
const iterable = values => ({ async *[Symbol.asyncIterator]() { yield* values; } });

test("early-exit provider uses pre-tax dues and rejects refunded, credited, partial and unrelated invoices", async () => {
  const sub = subscription(), charge = { id: "ch_paid", paid: true, captured: true, status: "succeeded", currency: "usd", customer: contract.customerId,
    amount: 53393, disputed: false, refunded: false, amount_refunded: 0, livemode: false };
  const customer = { id: contract.customerId, livemode: false, balance: 0, invoice_credit_balance: { usd: 0 }, cash_balance: null };
  const invoice = { id: "in_paid", customer: contract.customerId, livemode: false, currency: "usd", status: "paid", amount_remaining: 0,
    total: 53393, amount_paid: 53393, total_excluding_tax: 49900, starting_balance: 0, pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0,
    lines: { has_more: false, data: [{ livemode: false, currency: "usd", quantity: 1, subtotal: 49900, period: { start: Date.parse(contract.startsAt)/1000, end: Date.parse(dueInvoices[0].periodEnd)/1000 },
      pricing: { price_details: { price: contract.priceId } }, parent: { type: "subscription_item_details", subscription_item_details: { subscription: sub.id, subscription_item: "si_member", proration: false } } }] } };
  const stripe = { customers: { retrieve: async () => customer }, subscriptions: { retrieve: async () => sub }, invoices: { list: () => iterable([invoice]) }, creditNotes: { list: async () => ({ data: [] }) },
    invoicePayments: { list: () => iterable([{ status: "paid", livemode: false, invoice: invoice.id, amount_paid: invoice.total, payment: { type: "payment_intent", payment_intent: "pi_paid" } }]) },
    paymentIntents: { retrieve: async () => ({ status: "succeeded", customer: contract.customerId, livemode: false, currency: "usd", amount_received: invoice.total, latest_charge: charge }) },
    refunds: { list: async () => ({ data: [] }) }, invoiceItems: { list: async () => ({ data: [] }) } };
  const provider = await load("src/lib/stripe/cancellation-provider.ts", { "node:crypto": { createHash },
    "@/lib/stripe/server": { getStripe: () => stripe, getMembershipPriceConfiguration: () => config },
    "@/lib/stripe/price-policy": prices, "@/lib/stripe/commitment-policy": policy });
  assert.equal((await provider.readCommitmentProviderEvidence(contract)).invoices[0].duesPaid, 49900);
  for (const [object, field, value] of [[customer,"balance",100], [customer,"balance",-100], [charge,"captured",false], [charge,"customer","cus_other"], [charge,"amount_refunded",1], [charge,"disputed",true], [invoice,"post_payment_credit_notes_amount",100], [invoice,"status","open"], [invoice,"amount_paid",100], [invoice,"customer","cus_other"]]) {
    const original = object[field]; object[field] = value;
    await assert.rejects(provider.readCommitmentProviderEvidence(contract), /review/); object[field] = original;
  }
});

async function serviceFixture({ failAfterCreate = false, finalChanges = {}, completionSucceeds = true } = {}) {
  const sub = subscription(), stored = new Map(), calls = [], invoices = new Map();
  let record = null, ledger = { revision: 0, state: "unknown", reconciledAt: null, invoices: [] }, fingerprint = "settled-evidence";
  const sql = async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ");
    if (query.includes("insert into stripe_membership_cancellation_quotes")) {
      const [id,, ,quote,evidence,taxCode,taxEnabled,feeTotal] = values;
      stored.set(id, { id, quote, evidence, taxCode, taxEnabled, feeTotal }); return [];
    }
    if (query.includes("from stripe_membership_cancellation_quotes")) return stored.has(values[0]) ? [stored.get(values[0])] : [];
    if (query.includes("cancellation_lease_token = null")) return [];
    if (query.includes("cancellation_lease_token =")) return [{ id: contract.id }];
    throw Error(query);
  };
  sql.json = value => value; sql.begin = callback => callback(sql);
  const stripe = { subscriptions: { retrieve: async () => structuredClone(sub), update: async (id, input, options) => {
    calls.push({ action: "stop", id, input, options }); sub.cancel_at = input.cancel_at; return sub;
  } }, invoices: {
    create: async (input, options) => {
      calls.push({ action: "invoice", input, options });
      const value = invoices.get("in_buyout") ?? { id: "in_buyout", metadata: input.metadata };
      invoices.set(value.id, value);
      if (failAfterCreate) { failAfterCreate = false; throw new Error("Simulated timeout after Stripe created invoice"); }
      return value;
    },
    retrieve: async id => invoices.get(id),
    finalizeInvoice: async (id, input, options) => { calls.push({ action: "finalize", input, options }); const value = { id, total: 49900, amount_due: 49900,
      total_excluding_tax: 49900, customer: contract.customerId, currency: "usd", status: "open", starting_balance: 0, ending_balance: 0, auto_advance: false,
      metadata: invoices.get(id).metadata, livemode: false, lines: { data: [{}], has_more: false }, automatic_tax: { status: null },
      hosted_invoice_url: "https://invoice.stripe.com/i/test", ...finalChanges }; invoices.set(id,value); return value; },
    voidInvoice: async (id, input, options) => { calls.push({ action: "void", input, options }); const value = { ...invoices.get(id), status: "void" }; invoices.set(id, value); return value; },
  }, invoiceItems: { create: async (input,options) => { calls.push({ action: "line",input,options }); return { id: "ii_buyout" }; } } };
  const repository = {
    markMembershipCancellationNeedsReview: async () => { if (record) record.status = "manual_review"; },
    recordCommitmentReconciliation: async (_tx,input) => { ledger = { revision: ledger.revision+1, state: input.state, reconciledAt: input.reconciledAt, invoices: input.invoices }; },
    getMembershipCommitment: async () => ({ contract, ledger, status: record?.quote.intent === "early_exit" ? "exit_pending" : "active" }), getMembershipCancellation: async () => record,
    reserveMembershipCancellation: async (_tx,input) => { record = { id: input.requestId, quote: input.quote, status: "requested", providerIdempotencyKey: `cancel:${input.requestId}`, replacementInvoiceId: null }; return record; },
    confirmMembershipBillingStopped: async (_tx,_id,evidence) => { assert.equal(evidence.cancelAt, record.quote.effectiveAt); record.status = "billing_stopped"; return true; },
    fenceMembershipReplacementInvoice: async () => { assert.ok(["billing_stopped", "collection_in_flight"].includes(record.status)); record.status="collection_in_flight"; return { quote: record.quote, providerIdempotencyKey: record.providerIdempotencyKey }; },
    completeMembershipCancellation: async (_tx,input) => { if (!completionSucceeds) return false; record.status="completed"; record.replacementInvoiceId=input.replacementInvoiceId; return true; },
  };
  const service = await load("src/lib/stripe/cancellation-service.ts", { "node:crypto": { randomUUID }, "@/lib/stripe/database": { getBillingDatabase: () => sql },
    "@/lib/stripe/commitment-account": { getMemberBillingCommitment: async () => contract }, "@/lib/stripe/server": { getStripe: () => stripe, isStripeTaxEnabled: () => false },
    "@/lib/stripe/cancellation-provider": { stripeObjectId: value => typeof value === "string" ? value : value?.id,
      verifyCommitmentSubscription: value => value.items.data[0], readCommitmentProviderEvidence: async () => ({ subscription: sub, invoices: dueInvoices, fingerprint }) },
    "@/lib/stripe/commitment-policy": policy, "@/lib/stripe/commitment-repository": repository,
  }, { STRIPE_MEMBERSHIP_BUYOUT_READY: "true" });
  return { service, sub, calls, stored, invoices, record: () => record, changeEvidence: () => { fingerprint = "changed"; }, ledger: () => ledger };
}

test("turning off renewal succeeds without invoice reconciliation or fee collection", async () => {
  const f = await serviceFixture(); f.sub.status = "past_due";
  const quote = await f.service.createMemberCancellationQuote(contract.memberId,"disable_renewal");
  assert.equal(quote.feeTotal,0); assert.equal(quote.effectiveAt,contract.initialTermEndsAt); assert.equal(f.ledger().revision,0);
  const result = await f.service.confirmMemberCancellation(contract.memberId,quote.id);
  assert.equal(result.invoiceUrl,null); assert.deepEqual(f.calls.map(call => call.action),["stop"]);
  assert.equal(f.calls[0].input.proration_behavior,"none");
  assert.deepEqual(await f.service.confirmMemberCancellation(contract.memberId,quote.id),result);
  assert.equal(f.calls.length,1,"retry never changes the cancellation or collects money");
});

test("early exit quotes remaining balance below cap, stops installments first, and creates exactly one manually paid invoice", async () => {
  const f = await serviceFixture();
  const quote = await f.service.createMemberCancellationQuote(contract.memberId,"early_exit");
  assert.equal(quote.feeTotal,49900); assert.equal(quote.remainingInitialDues,49900); assert.equal(quote.effectiveAt,dueInvoices.at(-1).periodEnd);
  const result = await f.service.confirmMemberCancellation(contract.memberId,quote.id);
  assert.equal(result.invoiceUrl,"https://invoice.stripe.com/i/test");
  assert.deepEqual(f.calls.map(call => call.action),["stop","invoice","line","finalize"]);
  assert.equal(f.calls[1].input.auto_advance,false); assert.equal(f.calls[1].input.pending_invoice_items_behavior,"exclude");
  assert.equal(f.calls[2].input.amount,49900); assert.equal(f.calls[3].input.auto_advance,false);
  assert.equal(new Set(f.calls.map(call => call.options.idempotencyKey)).size,4);
  assert.deepEqual(await f.service.confirmMemberCancellation(contract.memberId,quote.id),result);
  assert.equal(f.calls.length,4,"retry returns existing invoice without another collection");
});

test("changed payment evidence or expired consent cannot change billing or issue a fee", async () => {
  for (const expired of [false,true]) {
    const f = await serviceFixture(), quote = await f.service.createMemberCancellationQuote(contract.memberId,"early_exit");
    if (expired) f.stored.get(quote.id).quote.expiresAt = new Date(0).toISOString(); else f.changeEvidence();
    await assert.rejects(f.service.confirmMemberCancellation(contract.memberId,quote.id), /expired_or_changed/);
    assert.equal(f.calls.length,0);
  }
});


test("a pending early execution cannot be invalidated by requesting another quote; ordinary renewal remains available", async () => {
  const f = await serviceFixture({ failAfterCreate: true });
  const quote = await f.service.createMemberCancellationQuote(contract.memberId, "early_exit");
  await assert.rejects(f.service.confirmMemberCancellation(contract.memberId, quote.id), /Simulated timeout/);
  const revision = f.ledger().revision;
  await assert.rejects(f.service.createMemberCancellationQuote(contract.memberId, "early_exit"), /cancellation_in_progress/);
  assert.equal(f.ledger().revision, revision);
  assert.equal((await f.service.createMemberCancellationQuote(contract.memberId, "disable_renewal")).feeTotal, 0);
  const resumed = await f.service.confirmMemberCancellation(contract.memberId, quote.id);
  assert.equal(resumed.invoiceUrl, "https://invoice.stripe.com/i/test"); assert.equal(f.invoices.size, 1);
  const creates = f.calls.filter(call => call.action === "invoice");
  assert.equal(creates.length, 2); assert.equal(creates[0].options.idempotencyKey, creates[1].options.idempotencyKey);
  assert.equal(f.calls.filter(call => call.action === "stop").length, 1, "retry preserves the stopped installments");
});

test("customer debits, wrong invoice ownership and concurrent invalidation never expose an unapproved payable amount", async () => {
  for (const options of [{ finalChanges: { amount_due: 59900, starting_balance: 10000 } },
    { finalChanges: { customer: "cus_other" } }, { completionSucceeds: false }]) {
    const f = await serviceFixture(options), quote = await f.service.createMemberCancellationQuote(contract.memberId, "early_exit");
    await assert.rejects(f.service.confirmMemberCancellation(contract.memberId, quote.id), /early_exit_requires_review/);
    assert.equal(f.invoices.get("in_buyout").status, "void");
    assert.equal(f.record().status, "manual_review");
    assert.equal(f.calls.filter(call => call.action === "stop").length, 1);
  }
  const f = await serviceFixture({ finalChanges: { status: "void" } }), quote = await f.service.createMemberCancellationQuote(contract.memberId, "early_exit");
  await assert.rejects(f.service.confirmMemberCancellation(contract.memberId, quote.id), /early_exit_requires_review/);
  assert.equal(f.calls.filter(call => call.action === "void").length, 0, "already void invoice is not presented or re-voided");
});
