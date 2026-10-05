import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", output)(name => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, loaded, loaded.exports, { env: {} });
  return loaded.exports;
}
const pricing = await load("src/lib/membership/pricing.ts");
const policy = await load("src/lib/stripe/commitment-policy.ts", { "node:crypto": { createHash }, "@/lib/membership/pricing": pricing });
const schedule = await load("src/lib/membership/foundations-schedule.ts");
const prepaid = await load("src/lib/stripe/prepaid-policy.ts", { "node:crypto": { createHash }, "@/lib/membership/pricing": pricing, "@/lib/membership/foundations-schedule": schedule });
const prices = await load("src/lib/stripe/price-policy.ts", { "@/lib/membership/pricing": pricing, "./prepaid-policy": prepaid });

async function fixture({ timeoutAfterCancel = false, raceInvoice = false, invoiceRows = [], pendingRows = [] } = {}) {
  const now = new Date(), startsAt = new Date(Math.ceil(now.getTime()/1000)*1000 + 86400000).toISOString();
  const contract = policy.buildMembershipCommitment({ id: randomUUID(), memberId: randomUUID(), subscriptionId: "sub_member", customerId: "cus_member",
    livemode: false, offerId: "individual_monthly", priceId: "price_member", agreementAcceptanceId: randomUUID(), agreementVersion: "ruined_membership-v2",
    agreementContentSha256: "a".repeat(64), acceptedAt: now.toISOString(), startsAt, billingTermsVersion: "membership-billing-v2" });
  const sub = { id: contract.subscriptionId, customer: contract.customerId, livemode: false, status: "active", cancel_at: null,
    canceled_at: null, cancel_at_period_end: false, billing_cycle_anchor: Date.parse(startsAt)/1000, latest_invoice: null,
    metadata: { billing_terms_version: "membership-billing-v2", ruined_offer_id: contract.offerId, ruined_billing_plan: "monthly", ruined_member_id: contract.memberId,
      ruined_commercial_reservation_id: "reservation", ruined_first_charge_at: startsAt },
    items: { has_more: false, data: [{ id: "si_member", quantity: 1, current_period_end: Date.parse(startsAt)/1000,
      price: { id: contract.priceId, type: "recurring", livemode: false, billing_scheme: "per_unit", tax_behavior: "exclusive", currency: "usd", unit_amount: 49900,
        recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } } }] } };
  const stored = new Map(), calls = []; let cancellation = null;
  const sql = async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ");
    if (query.includes("insert into stripe_membership_cancellation_quotes")) {
      const [id,,,quote,evidence,taxCode,taxEnabled,feeTotal] = values;
      stored.set(id, { id, quote, evidence, taxCode, taxEnabled, feeTotal }); return [];
    }
    if (query.includes("from stripe_membership_cancellation_quotes")) return stored.has(values[0]) ? [stored.get(values[0])] : [];
    if (query.includes("cancellation_lease_token = null")) return [];
    if (query.includes("cancellation_lease_token =")) return [{ id: contract.id }];
    throw Error(query);
  };
  sql.json = value => value; sql.begin = callback => callback(sql);
  const stripe = {
    subscriptions: {
      retrieve: async () => structuredClone(sub),
      cancel: async (id, input, options) => {
        calls.push({ action: "cancel", id, input, options });
        sub.status = "canceled"; sub.canceled_at = Math.floor(Date.now()/1000);
        if (raceInvoice) invoiceRows.push({ id: "in_raced" });
        if (timeoutAfterCancel) { timeoutAfterCancel = false; throw Error("Simulated provider timeout after cancellation"); }
        return structuredClone(sub);
      },
      update: async () => { throw Error("Prestart cancellation must not reschedule billing"); },
    },
    invoices: { list: async () => ({ data: invoiceRows, has_more: false }), create: async () => { throw Error("No cancellation invoice allowed"); } },
    invoiceItems: { list: async () => ({ data: pendingRows, has_more: false }), create: async () => { throw Error("No cancellation item allowed"); } },
  };
  const provider = await load("src/lib/stripe/cancellation-provider.ts", { "node:crypto": { createHash },
    "@/lib/stripe/server": { getStripe: () => stripe, getMembershipPriceConfiguration: () => ({ monthly: "price_member", annual: "price_annual", legacy: null,
      livemode: false, offers: { individual_monthly: "price_member" } }) },
    "@/lib/stripe/price-policy": prices, "@/lib/stripe/prepaid-policy": prepaid, "@/lib/stripe/commitment-policy": policy });
  const repository = {
    getMembershipCancellation: async () => cancellation,
    reserveMembershipCancellation: async (_tx, input) => {
      cancellation = { id: input.requestId, status: "requested", quote: input.quote, providerIdempotencyKey: `cancel:${input.requestId}`, replacementInvoiceId: null };
      return cancellation;
    },
    confirmMembershipBillingStopped: async (_tx, _id, evidence) => {
      assert.equal(evidence.subscriptionStatus, "canceled"); assert.equal(evidence.noInvoices, true);
      assert.equal(evidence.firstChargeAt, contract.startsAt); assert.ok(Date.parse(evidence.canceledAt) < Date.parse(contract.startsAt));
      cancellation.status = "billing_stopped"; return true;
    },
    completeMembershipCancellation: async (_tx, input) => {
      assert.equal(cancellation.status, "billing_stopped"); assert.equal(input.replacementInvoiceId, null);
      cancellation.status = "completed"; return true;
    },
    markMembershipCancellationNeedsReview: async () => { if (cancellation) cancellation.status = "manual_review"; },
  };
  const service = await load("src/lib/stripe/cancellation-service.ts", { "node:crypto": { randomUUID },
    "@/lib/stripe/database": { getBillingDatabase: () => sql }, "@/lib/stripe/commitment-account": { getMemberBillingCommitment: async () => contract },
    "@/lib/stripe/server": { getStripe: () => stripe, isStripeTaxEnabled: () => false },
    "@/lib/stripe/cancellation-provider": provider, "@/lib/stripe/commitment-policy": policy, "@/lib/stripe/commitment-repository": repository });
  return { contract, sub, service, provider, calls, stored, invoiceRows, pendingRows, cancellation: () => cancellation };
}

test("scheduled cancellation has zero fee, immediately stops Stripe, and duplicate confirmation never bills", async () => {
  const f = await fixture(), quote = await f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start");
  assert.equal(quote.feeTotal, 0); assert.equal(quote.remainingInitialDues, 0);
  const result = await f.service.confirmMemberCancellation(f.contract.memberId, quote.id);
  assert.equal(result.invoiceUrl, null); assert.equal(f.cancellation().status, "completed");
  assert.deepEqual(f.calls[0].input, { invoice_now: false, prorate: false });
  assert.deepEqual(await f.service.confirmMemberCancellation(f.contract.memberId, quote.id), result);
  assert.equal(f.calls.length, 1);
});

test("provider timeout is recovered by canceled-object readback without another provider mutation", async () => {
  const f = await fixture({ timeoutAfterCancel: true }), quote = await f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start");
  await assert.rejects(f.service.confirmMemberCancellation(f.contract.memberId, quote.id), /Simulated provider timeout/);
  assert.equal(f.cancellation().status, "requested");
  assert.equal((await f.service.confirmMemberCancellation(f.contract.memberId, quote.id)).invoiceUrl, null);
  assert.equal(f.calls.length, 1); assert.equal(f.cancellation().status, "completed");
});

test("invoices, pending items, altered anchors and changed subscription ownership prevent a free cancellation claim", async () => {
  for (const options of [{ invoiceRows: [{ id: "in_any" }] }, { pendingRows: [{ id: "ii_pending" }] }]) {
    const f = await fixture(options);
    await assert.rejects(f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start"), /prestart_invoice_requires_review/);
    assert.equal(f.calls.length, 0);
  }
  for (const change of [{ customer: "cus_other" }, { billing_cycle_anchor: 0 }, { latest_invoice: "in_unknown" }, { pending_update: {} }]) {
    const f = await fixture(); Object.assign(f.sub, change);
    await assert.rejects(f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start"), /requires_review/);
    assert.equal(f.calls.length, 0);
  }
});

test("an invoice appearing between quote and confirmation blocks cancellation before the provider mutation", async () => {
  const f = await fixture(), quote = await f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start");
  f.invoiceRows.push({ id: "in_unexpected" });
  await assert.rejects(f.service.confirmMemberCancellation(f.contract.memberId, quote.id), /prestart_invoice_requires_review/);
  assert.equal(f.calls.length, 0); assert.equal(f.cancellation().status, "manual_review");
});

test("an invoice racing the stop requires review and cannot be reported as a completed no-charge cancellation", async () => {
  const f = await fixture({ raceInvoice: true }), quote = await f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start");
  await assert.rejects(f.service.confirmMemberCancellation(f.contract.memberId, quote.id), /prestart_invoice_requires_review/);
  assert.equal(f.calls.length, 1); assert.equal(f.sub.status, "canceled"); assert.equal(f.cancellation().status, "manual_review");
});

test("expired consent and provider cancellation at or after the start never authorize the prestart flow", async () => {
  const f = await fixture(), quote = await f.service.createMemberCancellationQuote(f.contract.memberId, "cancel_before_start");
  f.stored.get(quote.id).quote.expiresAt = new Date(0).toISOString();
  await assert.rejects(f.service.confirmMemberCancellation(f.contract.memberId, quote.id), /expired_or_changed/); assert.equal(f.calls.length, 0);
  f.sub.status = "canceled"; f.sub.canceled_at = Date.parse(f.contract.startsAt)/1000;
  await assert.rejects(f.provider.readPrestartCancellationEvidence(f.contract), /requires_review/);
});

test("account summaries show durable cancellation before the webhook and never infer paid access from the date", async () => {
  const f = await fixture();
  let row = { terms: f.contract, contractStatus: "active", subscriptionStatus: "active", prestartCanceled: false, prestartReview: false, paid: false };
  const account = await load("src/lib/stripe/commitment-account.ts", {
    "@/lib/stripe/database": { getBillingDatabase: () => async () => [row] }, "@/lib/stripe/server": { getStripeLivemode: () => false },
  });
  const read = now => account.getMemberBillingCommitmentSummary(f.contract.memberId, now);
  assert.equal((await read()).status, "scheduled"); assert.equal((await read()).canCancelBeforeStart, true);
  assert.equal((await read(new Date(f.contract.startsAt))).status, "pending_payment");
  row.paid = true; assert.equal((await read(new Date(f.contract.startsAt))).status, "active");
  row = { ...row, paid: false, contractStatus: "exit_pending" };
  assert.equal((await read()).canCancelBeforeStart, false);
  row = { ...row, contractStatus: "ended", prestartCanceled: true };
  assert.equal((await read()).status, "canceled"); assert.equal((await read()).canCancelBeforeStart, false);
  assert.equal((await read()).canceledBeforeStart, true);
  row = { ...row, subscriptionStatus: "canceled", prestartCanceled: false };
  assert.equal((await read()).canceledBeforeStart, false, "ordinary cancellation does not prove absence of charges");
  row = { ...row, subscriptionStatus: "canceled", prestartCanceled: false, prestartReview: true };
  assert.equal((await read()).status, "review_required", "raced invoices must not be described as an uncomplicated cancellation");
});
