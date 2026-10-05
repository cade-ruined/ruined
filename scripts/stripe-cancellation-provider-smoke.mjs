// Disposable isolated Stripe sandbox only; no database, customer email or mail provider.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import Stripe from "stripe";
import ts from "typescript";

if (!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "") || process.env.DATABASE_URL ||
  Object.keys(process.env).some(key => /SUPABASE|RESEND/.test(key) && process.env[key])) {
  throw new Error("An isolated sandbox key, no database connection and no mail credentials are required.");
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-08-26.dahlia", timeout: 15000, maxNetworkRetries: 1 });
const run = randomUUID(), price = "price_1UKjCj9rQIwIEzKeoNSBIVEq", checks = [], subscriptions = [];
let clock, logicalNow = Date.now();
class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [logicalNow])); } static now() { return logicalNow; } }
const record = (name, passed) => { assert.ok(passed, name); checks.push(name); console.log(JSON.stringify({ check: name, passed: true })); };
async function load(path, dependencies = {}) {
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "Date", "process", output)(name => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, `Missing dependency ${name}`); return dependencies[name];
  }, loaded, loaded.exports, ClockDate, { env: { STRIPE_MEMBERSHIP_BUYOUT_READY: "true" } });
  return loaded.exports;
}
const pricing = await load("src/lib/membership/pricing.ts");
const policy = await load("src/lib/stripe/commitment-policy.ts", { "node:crypto": { createHash }, "@/lib/membership/pricing": pricing });
const prices = await load("src/lib/stripe/price-policy.ts", { "@/lib/membership/pricing": pricing });
const server = { getStripe: () => stripe, isStripeTaxEnabled: () => false,
  getMembershipPriceConfiguration: () => ({ monthly: price, annual: "price_1UKjCm9rQIwIEzKe8KR9v0eV", legacy: null,
    livemode: false, offers: { founding_individual_monthly: price } }) };
const provider = await load("src/lib/stripe/cancellation-provider.ts", { "node:crypto": { createHash },
  "@/lib/stripe/server": server, "@/lib/stripe/price-policy": prices, "@/lib/stripe/commitment-policy": policy });

async function waitClock() {
  for (let i = 0; i < 60; i++) {
    const current = await stripe.testHelpers.testClocks.retrieve(clock.id);
    if (current.status === "ready") return;
    assert.notEqual(current.status, "internal_failure");
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error("Sandbox clock did not finish.");
}
async function advance(second) {
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: second });
  await waitClock(); logicalNow = second * 1000;
}
async function settled(subscriptionId, count) {
  let invoices = (await stripe.invoices.list({ subscription: subscriptionId, limit: 100 })).data;
  if (invoices.filter(invoice => invoice.status === "paid").length !== count) {
    await advance(Math.floor(logicalNow/1000)+14400);
    invoices = (await stripe.invoices.list({ subscription: subscriptionId, limit: 100 })).data;
  }
  assert.equal(invoices.length, count, "Expected installment count");
  assert.ok(invoices.every(invoice => invoice.status === "paid" && invoice.amount_paid === 34900));
}
async function customerSubscription(label) {
  const memberId = randomUUID(), commitmentId = randomUUID();
  const customer = await stripe.customers.create({ name: `[TEST ONLY] ${label}`, test_clock: clock.id, metadata: { ruined_test_run: run } });
  const method = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: method.id } });
  const subscription = await stripe.subscriptions.create({ customer: customer.id, items: [{ price }], billing_mode: { type: "flexible" },
    collection_method: "charge_automatically", metadata: { ruined_test_run: run, ruined_context: "membership", ruined_member_id: memberId,
      billing_terms_version: "membership-billing-v2", ruined_offer_id: "founding_individual_monthly", ruined_billing_plan: "monthly",
      ruined_commercial_reservation_id: commitmentId } });
  subscriptions.push(subscription.id);
  const startsAt = new Date(subscription.start_date*1000).toISOString();
  const contract = policy.buildMembershipCommitment({ id: commitmentId, memberId, subscriptionId: subscription.id, customerId: customer.id,
    livemode: false, offerId: "founding_individual_monthly", priceId: price, agreementAcceptanceId: randomUUID(),
    agreementVersion: "ruined_membership-v2", agreementContentSha256: "a".repeat(64),
    acceptedAt: new Date(subscription.start_date*1000-1000).toISOString(), startsAt, billingTermsVersion: "membership-billing-v2" });
  return { subscription, customer, contract };
}
async function applicationCancellation(contract, expectedFee) {
  const stored = new Map(); let cancellation = null, ledger = { revision: 0, state: "unknown", reconciledAt: null, invoices: [] };
  const sql = async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ");
    if (query.includes("insert into stripe_membership_cancellation_quotes")) {
      const [id,,,quote,evidence,taxCode,taxEnabled,feeTotal] = values; stored.set(id,{id,quote,evidence,taxCode,taxEnabled,feeTotal}); return [];
    }
    if (query.includes("from stripe_membership_cancellation_quotes")) return [stored.get(values[0])];
    if (query.includes("cancellation_lease_token = null")) return [];
    if (query.includes("cancellation_lease_token =")) return [{id:contract.id}];
    throw Error("Unexpected in-memory billing statement");
  };
  sql.json = value => value; sql.begin = fn => fn(sql);
  const repository = {
    getMembershipCommitment: async () => ({ contract, ledger, status: cancellation ? "exit_pending" : "active" }),
    recordCommitmentReconciliation: async (_tx, input) => { ledger = { revision: ledger.revision+1, state: input.state, reconciledAt: input.reconciledAt, invoices: input.invoices }; },
    getMembershipCancellation: async () => cancellation,
    reserveMembershipCancellation: async (_tx,input) => { cancellation = {id:input.requestId,quote:input.quote,status:"requested",providerIdempotencyKey:`ruined-smoke:${run}:${input.requestId}`,replacementInvoiceId:null}; return cancellation; },
    confirmMembershipBillingStopped: async (_tx,_id,evidence) => {
      assert.equal(evidence.cancelAt,cancellation.quote.effectiveAt); cancellation.status="billing_stopped"; return true;
    },
    fenceMembershipReplacementInvoice: async () => { assert.equal(cancellation.status,"billing_stopped"); cancellation.status="collection_in_flight"; return {quote:cancellation.quote,providerIdempotencyKey:cancellation.providerIdempotencyKey}; },
    completeMembershipCancellation: async (_tx,input) => { assert.equal(cancellation.status,"collection_in_flight"); cancellation.status="completed"; cancellation.replacementInvoiceId=input.replacementInvoiceId; return true; },
    markMembershipCancellationNeedsReview: async () => { if(cancellation) cancellation.status="manual_review"; },
  };
  const service = await load("src/lib/stripe/cancellation-service.ts", { "node:crypto": { randomUUID }, "@/lib/stripe/database": { getBillingDatabase:()=>sql },
    "@/lib/stripe/commitment-account": { getMemberBillingCommitment:async()=>contract }, "@/lib/stripe/server":server,
    "@/lib/stripe/cancellation-provider":provider,"@/lib/stripe/commitment-policy":policy,"@/lib/stripe/commitment-repository":repository });
  const quote = await service.createMemberCancellationQuote(contract.memberId,"early_exit");
  record(`Application quote calculates ${expectedFee} cents before tax`,quote.feeDues===expectedFee&&quote.feeTotal===expectedFee);
  const result = await service.confirmMemberCancellation(contract.memberId,quote.id);
  const invoice = await stripe.invoices.retrieve(cancellation.replacementInvoiceId);
  record(`Hosted replacement invoice for ${expectedFee} cents is open and never automatically collected`,invoice.status==="open"&&invoice.amount_due===expectedFee&&invoice.total_excluding_tax===expectedFee&&invoice.auto_advance===false&&invoice.amount_paid===0&&Boolean(result.invoiceUrl));
  const sub = await stripe.subscriptions.retrieve(contract.subscriptionId);
  record("Provider schedules cancellation at the fully paid period end",sub.cancel_at===Date.parse(quote.effectiveAt)/1000&&sub.cancel_at===sub.items.data[0].current_period_end);
  const retry = await service.confirmMemberCancellation(contract.memberId,quote.id);
  assert.equal(retry.effectiveAt,result.effectiveAt); assert.ok(retry.invoiceUrl);
  const matches=(await stripe.invoices.list({customer:contract.customerId,limit:100})).data.filter(item=>item.metadata?.ruined_cancellation_id===quote.id);
  record("Repeated confirmation retains exactly one replacement invoice",matches.length===1&&matches[0].id===invoice.id);
  return { invoiceId:invoice.id,end:sub.cancel_at,subscriptionId:sub.id,customerId:contract.customerId };
}
try {
  const account = await stripe.accounts.retrieve();
  record("Expected isolated Ruined sandbox account", account.id === "acct_1U6AS79rQIwIEzKe");
  const start = Math.floor(Date.now()/1000); logicalNow=start*1000;
  clock = await stripe.testHelpers.testClocks.create({ frozen_time:start,name:`Ruined cancellation ${run}` });
  const capped = await customerSubscription("Capped early exit"), remaining = await customerSubscription("Final installment exit");
  await settled(capped.subscription.id,1); await settled(remaining.subscription.id,1);
  const first = await applicationCancellation(capped.contract,150000);
  for (let count=2;count<=11;count++) {
    const current=await stripe.subscriptions.retrieve(remaining.subscription.id);
    await advance(current.items.data[0].current_period_end+14400); await settled(current.id,count);
    console.log(JSON.stringify({paidInstallments:count}));
  }
  record("Canceled capped subscription never renews again",(await stripe.subscriptions.retrieve(capped.subscription.id)).status==="canceled"&&(await stripe.invoices.list({subscription:capped.subscription.id,limit:100})).data.length===1);
  record("Unpaid capped fee remains open without recurring installments",(await stripe.invoices.retrieve(first.invoiceId)).status==="open"&&(await stripe.invoices.retrieve(first.invoiceId)).amount_paid===0);
  const final = await applicationCancellation(remaining.contract,34900);
  await advance(final.end+14400);
  record("Below-cap exit stops the twelfth ordinary installment",(await stripe.subscriptions.retrieve(final.subscriptionId)).status==="canceled"&&(await stripe.invoices.list({subscription:final.subscriptionId,limit:100})).data.length===11);
  record("Below-cap fee remains one unpaid hosted invoice",(await stripe.invoices.retrieve(final.invoiceId)).status==="open"&&(await stripe.invoices.retrieve(final.invoiceId)).amount_paid===0);
  console.log(JSON.stringify({ok:true,mode:"isolated-sandbox",checks,scope:"Actual application cancellation policy, provider reconciliation and service with in-memory persistence; real Stripe sandbox invoices/subscriptions and Test Clock. Database durability and signed webhook delivery are verified separately. No emails or live payments."},null,2));
} catch(error) {
  console.log(JSON.stringify({ok:false,checks,type:error.type||error.name,code:error.code,parameter:error.param,status:error.statusCode,
    assertion:error instanceof assert.AssertionError?error.message:undefined},null,2)); process.exitCode=1;
} finally {
  for(const id of subscriptions) await stripe.subscriptions.cancel(id,{invoice_now:false,prorate:false}).catch(()=>{});
  if(clock) { await waitClock().catch(()=>{}); await stripe.testHelpers.testClocks.del(clock.id).then(()=>console.log(JSON.stringify({sandboxFixturesDeleted:true}))).catch(()=>{console.log("Sandbox cleanup requires review.");process.exitCode=1;}); }
}
