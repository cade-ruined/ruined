// Disposable Stripe sandbox verification using the shipped rollover implementation.
// This script cannot access the member database or use live credentials.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Stripe from 'stripe';
import ts from 'typescript';
if (!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '') || process.env.DATABASE_URL ||
  Object.keys(process.env).some(key => /SUPABASE|RESEND/.test(key) && process.env[key])) throw new Error('Isolated sandbox key required.');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {apiVersion:'2026-08-26.dahlia',timeout:20000,maxNetworkRetries:1});
assert.equal((await stripe.accounts.retrieve()).id,'acct_1U6AS79rQIwIEzKe');
const clocks=[],run=randomUUID();
async function load(path,deps={}) {
 const source=await readFile(new URL('../'+path,import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};new Function('require','module','exports',js)(name=>{if(name==='server-only')return {};assert.ok(name in deps,`Missing ${name}`);return deps[name];},m,m.exports);return m.exports;
}
const pricing=await load('src/lib/membership/pricing.ts'),schedule=await load('src/lib/membership/foundations-schedule.ts');
const catalog=await load('src/lib/stripe/membership-catalog.ts');
const policy=await load('src/lib/stripe/prepaid-policy.ts',{'node:crypto':{createHash},'@/lib/membership/pricing':pricing,'@/lib/membership/foundations-schedule':schedule});
const commitment=await load('src/lib/stripe/commitment-policy.ts',{'node:crypto':{createHash},'@/lib/membership/pricing':pricing});
const pricePolicy=await load('src/lib/stripe/price-policy.ts',{'@/lib/membership/pricing':pricing,'./prepaid-policy':policy});
const config={livemode:false,offers:catalog.SANDBOX_MEMBERSHIP_PRICE_IDS};
const provider=await load('src/lib/stripe/prepaid-provider.ts',{'@/lib/stripe/commitment-policy':commitment,'@/lib/stripe/prepaid-policy':policy,'@/lib/stripe/price-policy':pricePolicy,'@/lib/stripe/server':{getMembershipPriceConfiguration:()=>config}});
const rollover=await load('src/lib/stripe/cohort-rollover.ts',{'@/lib/membership/foundations-schedule':schedule,'./database':{getBillingDatabase:()=>{throw new Error('Database access forbidden');}},'./server':{getStripe:()=>stripe},'./commitment-policy':commitment,'./prepaid-provider':provider,'./prepaid-policy':policy});
async function waitClock(clock) {
 for(let i=0;i<80;i++) {const current=await stripe.testHelpers.testClocks.retrieve(clock);if(current.status==='ready')return;assert.notEqual(current.status,'internal_failure');await new Promise(r=>setTimeout(r,500));}
 throw new Error('Test clock timeout');
}
try {
 for(const plan of ['monthly','annual']) {
  const accepted=schedule.foundationsBillingScheduleForMonth('2026-11',plan);
  const paidTime=new Date(Date.parse(accepted.cutoffAt)+60000),target=schedule.resolveFoundationsEnrollmentSchedule(accepted,paidTime,plan);
  const clock=await stripe.testHelpers.testClocks.create({frozen_time:paidTime.getTime()/1000,name:'Rollover '+run+' '+plan});clocks.push(clock.id);
  const customer=await stripe.customers.create({name:'TEST ONLY cutoff carry-forward',test_clock:clock.id,address:{country:'US',postal_code:'80202'},metadata:{test_run:run}});
  const method=await stripe.paymentMethods.attach('pm_card_visa',{customer:customer.id});await stripe.customers.update(customer.id,{invoice_settings:{default_payment_method:method.id}});
  const offerId='founding_individual_'+plan,price=await stripe.prices.retrieve(config.offers[offerId]);
  const contractId=randomUUID(),memberId=randomUUID(),acceptanceId=randomUUID();
  const metadata={...policy.prepaidBillingMetadata(accepted),ruined_member_id:memberId,ruined_checkout_attempt_id:contractId,ruined_commercial_reservation_id:contractId,agreement_acceptance_id:acceptanceId,ruined_offer_id:offerId,ruined_billing_plan:plan,billing_terms_version:'membership-billing-v2',test_run:run};
  const subscription=await stripe.subscriptions.create({customer:customer.id,items:[{price:price.id}],add_invoice_items:[{price_data:{product:typeof price.product==='string'?price.product:price.product.id,currency:'usd',unit_amount:price.unit_amount,tax_behavior:'exclusive'},quantity:1}],billing_mode:{type:'flexible'},trial_end:Date.parse(accepted.prepaidThrough)/1000,metadata});
  assert.equal(subscription.livemode,false);
  const contract=commitment.buildMembershipCommitment({id:contractId,memberId,subscriptionId:subscription.id,customerId:customer.id,livemode:false,offerId,priceId:price.id,agreementAcceptanceId:acceptanceId,agreementVersion:'ruined_membership-v4',agreementContentSha256:'a'.repeat(64),acceptedAt:new Date(Date.parse(accepted.cutoffAt)-60000).toISOString(),startsAt:accepted.serviceStartsAt,billingTermsVersion:'membership-billing-v2',billingSchedule:accepted});
  const proof=await rollover.reconcileCohortRolloverProvider(stripe,contract,target,paidTime);
  const replay=await rollover.reconcileCohortRolloverProvider(stripe,contract,target,paidTime);
  assert.equal(proof.invoiceId,replay.invoiceId);assert.equal(proof.adjustmentInvoiceId,replay.adjustmentInvoiceId);
  assert.equal(proof.noAdditionalCharges,true);assert.equal(proof.trialEnd,target.prepaidThrough);assert.equal(proof.billingCycleAnchor,target.nextChargeAt);
  const after=await stripe.subscriptions.retrieve(subscription.id);assert.deepEqual(policy.acceptedPrepaidScheduleFromSubscription(after),accepted);assert.deepEqual(policy.prepaidScheduleFromSubscription(after),target);
  const invoices=(await stripe.invoices.list({subscription:subscription.id,limit:10})).data;
  assert.equal(invoices.filter(i=>i.amount_paid>0).length,1);assert.equal(invoices.find(i=>i.amount_paid>0).amount_paid,price.unit_amount);
  // Service begins with prepaid coverage and does not generate another charge.
  await stripe.testHelpers.testClocks.advance(clock.id,{frozen_time:Date.parse(target.serviceStartsAt)/1000});await waitClock(clock.id);
  const atStart=(await stripe.invoices.list({subscription:subscription.id,limit:10})).data;
  assert.equal(atStart.filter(i=>i.amount_paid>0).length,1);
  console.log(JSON.stringify({plan,passed:true,cohort:target.cohortMonth,renewalAt:target.nextChargeAt,originalPaymentRetained:true,noAdditionalChargeAtRolloverOrServiceStart:true,replaySafe:true,acceptedOfferPreserved:true}));
 }
} finally {
 for(const clock of clocks){await waitClock(clock);await stripe.testHelpers.testClocks.del(clock);}
 console.log(JSON.stringify({sandboxFixturesDeleted:true}));
}
