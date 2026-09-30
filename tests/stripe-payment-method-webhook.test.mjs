import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(path, dependencies = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = {exports:{}};
  new Function('require','module','exports',code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, m, m.exports);
  return m.exports;
}
const forbidden = () => { throw new Error('Payment-method storage must not call paid membership logic'); };
async function harness({duplicate = false, failure = false} = {}) {
  const handled=[], completed=[], failed=[];
  const state = await load('src/lib/stripe/membership-state.ts');
  const processor = await load('src/lib/stripe/webhook.ts', {
    '@/lib/membership/badge-repository': {reconcileMemberBadgesForStripeEvent: forbidden},
    'server-only': {}, '@/lib/membership/pricing': {}, '@/lib/stripe/membership-state': state,
    '@/lib/stripe/price-policy': {}, '@/lib/stripe/server': {getStripe: forbidden},
    '@/lib/stripe/database': {getBillingDatabase: () => ({begin: async fn => fn({})})},
    '@/lib/stripe/billing-repository': {
      claimWebhookEvent: async () => duplicate ? 'duplicate' : 'claimed',
      completeWebhookEvent: async (_tx,id) => completed.push(id),
      recordWebhookFailure: async (event) => failed.push(event.id),
      ensureBillingMember: forbidden, updateMemberBillingState: forbidden,
      upsertSubscription: forbidden, upsertCheckoutSession: forbidden,
    },
    '@/lib/stripe/payment-method-service': {handlePaymentMethodSetupEvent: async (_tx,event) => {
      handled.push(event.type); if (failure) throw new Error('Retry storage projection'); return true;
    }},
  });
  const route = await load('app/api/stripe/webhook/route.ts', {
    'next/server': {NextResponse: {json: Response.json}, after: () => assert.fail('No registration email worker for this fixture')},
    '@/lib/membership/registration-message-delivery': { getRegistrationMessageConfiguration: () => ({ ready: false }), processRegistrationMessageBatch: forbidden },
    '@/lib/stripe/server': {STRIPE_API_VERSION:'fixture',getStripeLivemode:()=>false,getStripeWebhookSecret:()=> 'fixture',getStripe:()=>({webhooks:{constructEvent: raw=>JSON.parse(raw)}})},
    '@/lib/stripe/webhook': processor,
    '@/lib/workflows/worker': {processWorkflowBatch: forbidden},
  });
  const event=(type)=>({id:'evt_storage',api_version:'fixture',livemode:false,type,data:{object:{mode:'setup',metadata:{ruined_context:'membership'}}}});
  return {handled,completed,failed, post: type=>route.POST(new Request('https://example.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':'fixture'},body:JSON.stringify(event(type))}))};
}
for (const type of ['checkout.session.completed','checkout.session.expired','setup_intent.succeeded','payment_method.detached']) {
  test(`${type} storage events never enter billing fulfillment or membership workflows`,async()=>{
    const f=await harness(); const r=await f.post(type);
    assert.equal(r.status,200);assert.equal((await r.json()).runMembershipWork,false);
    assert.deepEqual(f.handled,[type]);assert.deepEqual(f.completed,['evt_storage']);
  });
}
test('duplicate storage delivery is idempotent and failure remains retryable',async()=>{
  const duplicate=await harness({duplicate:true});assert.equal((await duplicate.post('checkout.session.completed')).status,200);assert.equal(duplicate.handled.length,0);
  const failure=await harness({failure:true});assert.equal((await failure.post('checkout.session.completed')).status,500);assert.deepEqual(failure.failed,['evt_storage']);assert.equal(failure.completed.length,0);
});
