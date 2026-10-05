// Opt-in disposable sandbox verification. No live accounts, database or emails.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Stripe from 'stripe';
import ts from 'typescript';
if (!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '') || process.env.DATABASE_URL ||
  Object.keys(process.env).some(key => /SUPABASE|RESEND/.test(key) && process.env[key])) throw new Error('Isolated sandbox key required.');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {apiVersion:'2026-08-26.dahlia',timeout:20000,maxNetworkRetries:1});
const account = await stripe.accounts.retrieve(); assert.equal(account.id,'acct_1U6AS79rQIwIEzKe');
const run = randomUUID(), clocks=[], subscriptions=[], checks=[];
const check=(label,condition)=>{assert.ok(condition,label);checks.push(label);console.log(JSON.stringify({check:label,passed:true}));};
async function load(path,deps={}) {
 const out=ts.transpileModule(await readFile(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};new Function('require','module','exports',out)(name=>{if(name==='server-only')return {};assert.ok(name in deps,`Missing ${name}`);return deps[name];},m,m.exports);return m.exports;
}
const pricing=await load('src/lib/membership/pricing.ts'), schedule=await load('src/lib/membership/foundations-schedule.ts');
const policy=await load('src/lib/stripe/prepaid-policy.ts',{'node:crypto':{createHash},'@/lib/membership/pricing':pricing,'@/lib/membership/foundations-schedule':schedule});
const commitment=await load('src/lib/stripe/commitment-policy.ts',{'node:crypto':{createHash},'@/lib/membership/pricing':pricing});
const pricePolicy=await load('src/lib/stripe/price-policy.ts',{'@/lib/membership/pricing':pricing,'./prepaid-policy':policy});
const prices={};for await(const p of stripe.prices.list({active:true,limit:100})) {
 if(p.currency==='usd'&&p.tax_behavior==='exclusive'&&p.unit_amount===34900&&p.recurring?.interval==='month')prices.monthly=p;
 if(p.currency==='usd'&&p.tax_behavior==='exclusive'&&p.unit_amount===349000&&p.recurring?.interval==='year')prices.annual=p;
}
assert.ok(prices.monthly&&prices.annual);
const provider=await load('src/lib/stripe/prepaid-provider.ts',{'@/lib/stripe/commitment-policy':commitment,'@/lib/stripe/prepaid-policy':policy,'@/lib/stripe/price-policy':pricePolicy,'@/lib/stripe/server':{getMembershipPriceConfiguration:()=>({livemode:false,monthly:prices.monthly.id,annual:prices.annual.id,offers:{founding_individual_monthly:prices.monthly.id,founding_individual_annual:prices.annual.id}})}});
async function wait(clock){for(let i=0;i<80;i++){const c=await stripe.testHelpers.testClocks.retrieve(clock.id);if(c.status==='ready')return;assert.notEqual(c.status,'internal_failure');await new Promise(r=>setTimeout(r,750));}throw new Error('Clock timeout');}
async function advance(clock,at){await stripe.testHelpers.testClocks.advance(clock.id,{frozen_time:Math.floor(Date.parse(at)/1000)});await wait(clock);}
async function create(plan,label){
 const now=new Date('2026-11-15T19:00:00Z'),s=schedule.createFoundationsBillingSchedule(now,plan),price=prices[plan],offerId=`founding_individual_${plan}`;
 const clock=await stripe.testHelpers.testClocks.create({frozen_time:now.getTime()/1000,name:`Prepay test ${run}`});clocks.push(clock);
 const c=await stripe.customers.create({name:`TEST ONLY ${label}`,test_clock:clock.id,address:{country:'US',postal_code:'80202'},metadata:{test_run:run}});
 const pm=await stripe.paymentMethods.attach('pm_card_visa',{customer:c.id});await stripe.customers.update(c.id,{invoice_settings:{default_payment_method:pm.id}});
 const cid=randomUUID(),mid=randomUUID(),acceptance=randomUUID();
 const sub=await stripe.subscriptions.create({customer:c.id,items:[{price:price.id}],add_invoice_items:[{price_data:{product:typeof price.product==='string'?price.product:price.product.id,currency:'usd',unit_amount:price.unit_amount,tax_behavior:'exclusive'},quantity:1}],billing_mode:{type:'flexible'},trial_end:Date.parse(s.prepaidThrough)/1000,trial_settings:{end_behavior:{missing_payment_method:'cancel'}},metadata:{...policy.prepaidBillingMetadata(s),ruined_context:'membership',ruined_member_id:mid,ruined_checkout_attempt_id:cid,ruined_commercial_reservation_id:cid,agreement_acceptance_id:acceptance,ruined_offer_id:offerId,ruined_billing_plan:plan,billing_terms_version:'membership-billing-v2',test_run:run}});subscriptions.push(sub.id);
 const contract=commitment.buildMembershipCommitment({id:cid,memberId:mid,subscriptionId:sub.id,customerId:c.id,livemode:false,offerId,priceId:price.id,agreementAcceptanceId:acceptance,agreementVersion:'ruined_membership-v3',agreementContentSha256:'a'.repeat(64),acceptedAt:now.toISOString(),startsAt:s.serviceStartsAt,billingTermsVersion:'membership-billing-v2',billingSchedule:s});
 const evidence=await provider.inspectPrepaidMembershipInvoice(stripe,contract,{requireOnlyInitialInvoice:true});
 check(`${plan}: first full period paid immediately and renewal deferred`,evidence.amount===price.unit_amount&&sub.status==='trialing'&&sub.billing_cycle_anchor===Date.parse(s.prepaidThrough)/1000);
 return{clock,sub,contract,s,evidence,price};
}
try {
 for(const plan of ['monthly','annual']) {
  const f=await create(plan,`${plan} renewal`);
  await advance(f.clock,f.s.serviceStartsAt);
  let invoices=(await stripe.invoices.list({subscription:f.sub.id,limit:100})).data;
  check(`${plan}: service start does not charge twice`,invoices.length===1&&invoices[0].amount_paid===f.price.unit_amount);
  await advance(f.clock,new Date(Date.parse(f.s.prepaidThrough)+4*3600000).toISOString());
  invoices=(await stripe.invoices.list({subscription:f.sub.id,limit:100})).data;
  if(invoices.some(i=>i.status!=='paid')){await advance(f.clock,new Date(Date.parse(f.s.prepaidThrough)+8*3600000).toISOString());invoices=(await stripe.invoices.list({subscription:f.sub.id,limit:100})).data;}
  const current=await stripe.subscriptions.retrieve(f.sub.id);
  check(`${plan}: next full payment occurs at accepted anniversary`,invoices.length===2&&invoices.every(i=>i.status==='paid'&&i.amount_paid===f.price.unit_amount)&&pricePolicy.matchesMembershipInvoice(invoices.find(i=>i.billing_reason==='subscription_cycle'),current,{livemode:false,offers:{[f.contract.offerId]:f.price.id}}));
  const verified=await provider.inspectPrepaidMembershipInvoice(stripe,f.contract);
  check(`${plan}: first payment retains service-period allocation after renewal`,verified.periodStart===f.s.serviceStartsAt&&verified.periodEnd===f.s.prepaidThrough);
  await stripe.subscriptions.cancel(f.sub.id,{invoice_now:false,prorate:false});
 }
 const f=await create('monthly','prestart refund');
 await stripe.subscriptions.cancel(f.sub.id,{invoice_now:false,prorate:false});
 const params={payment_intent:f.evidence.paymentIntentId,amount:f.evidence.amount,metadata:{test_run:run}};
 const refund=await stripe.refunds.create(params,{idempotencyKey:`prepaid-test-refund-${run}`});
 const retried=await stripe.refunds.create(params,{idempotencyKey:`prepaid-test-refund-${run}`});
 const refunded=await provider.inspectPrepaidMembershipInvoice(stripe,f.contract,{allowRefund:true,requireOnlyInitialInvoice:true});
 check('Prestart cancellation fully refunds exactly once',refund.id===retried.id&&refunded.refund?.id===refund.id&&refunded.refund.status==='succeeded');
 await assert.rejects(()=>provider.inspectPrepaidMembershipInvoice(stripe,f.contract));
 check('Refunded prepayment cannot authorize service',true);
 console.log(JSON.stringify({success:true,checks:checks.length}));
} finally {
 for(const sub of subscriptions){const current=await stripe.subscriptions.retrieve(sub).catch(()=>null);if(current&&current.status!=='canceled')await stripe.subscriptions.cancel(sub,{invoice_now:false,prorate:false});}
 for(const clock of clocks){await wait(clock);await stripe.testHelpers.testClocks.del(clock.id);}
 console.log(JSON.stringify({sandboxFixturesDeleted:true}));
}
