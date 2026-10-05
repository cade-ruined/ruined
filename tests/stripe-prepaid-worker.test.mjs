import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
async function load(path,deps,env={}){const code=ts.transpileModule(await source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const loaded={exports:{}};new Function('require','module','exports','process',code)(name=>{if(name==='server-only')return{};assert.ok(name in deps,name);return deps[name];},loaded,loaded.exports,{env});return loaded.exports;}
const configured={DATABASE_URL:'in-memory-only',STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_MEMBERSHIP_ACTIVATION_ENABLED:'false',STRIPE_MEMBERSHIP_COMMERCIAL_ENABLED:'false'};
async function worker({pending=[],due=[],fail=null,env=configured,limit=5}={}){
  const calls=[],remaining=[...due];
  const loaded=await load('src/lib/stripe/prepaid-worker.ts',{
    '@/lib/stripe/billing-repository':{listMembershipPrepaymentsDue:async options=>{assert.equal(options.livemode,false);return remaining.slice(0,options.limit);}},
    '@/lib/stripe/server':{getStripeLivemode:()=>false},
    '@/lib/stripe/webhook':{reconcilePrepaidMembershipSubscription:async id=>{calls.push(['reconcile',id]);if(id===fail)throw new Error('Synthetic provider unavailable');const i=remaining.findIndex(row=>row.subscriptionId===id);if(i>=0)remaining.splice(i,1);}},
    '@/lib/stripe/cancellation-service':{listPendingPrepaidMembershipCancellations:async()=>pending,
      reconcilePrepaidMembershipCancellation:async input=>{calls.push(['resume',input.subscriptionId]);return{handled:true,pending:true};},
      refundMissedFoundationsEnrollment:async input=>{calls.push(['invalid-refund',input.subscriptionId]);return{handled:true};}},
  },env);
  return{result:await loaded.processMembershipPrepayments(limit),calls};
}
test('accepted prepaid obligations run with purchase flags off, isolate mode, resume refunds and deduplicate candidates',async()=>{
  const {result,calls}=await worker({pending:[{subscriptionId:'sub_pending',livemode:false},{subscriptionId:'sub_live',livemode:true}],due:[
    {subscriptionId:'sub_pending',refundState:'none'},
    {subscriptionId:'sub_cutoff',refundState:'review_required',reviewReason:'cohort_cutoff_missed'},
    {subscriptionId:'sub_refunded',refundState:'refunded'},
    {subscriptionId:'sub_due',refundState:'none'},
  ]});
  assert.equal(result.ready,true);assert.equal(result.examined,4);assert.equal(result.reconciled,4);assert.equal(result.remainingDue,0);
  assert.deepEqual(calls,[['resume','sub_pending'],['reconcile','sub_pending'],['invalid-refund','sub_cutoff'],['reconcile','sub_cutoff'],['reconcile','sub_refunded'],['reconcile','sub_due']]);
});
test('pending refunds cannot consume every slot when service starts are due',async()=>{
  const {calls}=await worker({limit:4,pending:[1,2,3,4].map(n=>({subscriptionId:`sub_pending_${n}`,livemode:false})),due:[{subscriptionId:'sub_start',refundState:'none'}]});
  assert.ok(calls.some(([action,id])=>action==='reconcile'&&id==='sub_start'));
});
test('unconfigured worker is inert and provider failure never reports a finished activation',async()=>{
  const absent=await worker({env:{}});assert.equal(absent.result.ready,false);assert.deepEqual(absent.calls,[]);
  const original=console.error;console.error=()=>{};
  try{const failed=await worker({due:[{subscriptionId:'sub_bad',refundState:'none'},{subscriptionId:'sub_ok',refundState:'none'}],fail:'sub_bad'});
    assert.equal(failed.result.failed,1);assert.equal(failed.result.reconciled,1);assert.equal(failed.result.remainingDue,1);
  }finally{console.error=original;}
});
test('batch cap leaves explicit remaining work for the next cron',async()=>{
  const {result,calls}=await worker({limit:1,due:[{subscriptionId:'sub_one',refundState:'none'},{subscriptionId:'sub_two',refundState:'none'}]});
  assert.equal(result.examined,1);assert.equal(result.remainingDue,1);assert.deepEqual(calls,[['reconcile','sub_one']]);
});
test('prepaid cron requires the exact bearer secret before invoking work and signals failures',async()=>{
  let calls=0,result={ready:true,failed:0,manualReview:0,remainingDue:0};
  const deps={'node:crypto':{timingSafeEqual},'next/server':{NextResponse:{json:(body,init)=>new Response(JSON.stringify(body),{...init,headers:{'content-type':'application/json',...init?.headers}})}},
    '@/lib/stripe/prepaid-worker':{processMembershipPrepayments:async()=>{calls++;return result;}}};
  const route=await load('app/api/internal/stripe/prepaid/process/route.ts',deps,{CRON_SECRET:'fixture-secret'});
  for(const header of [null,'fixture-secret','Bearer wrong','bearer fixture-secret']){
    const response=await route.GET(new Request('https://example.test/api/internal/stripe/prepaid/process',{headers:header?{authorization:header}:{}}));assert.equal(response.status,401);
  }assert.equal(calls,0);
  const request=()=>new Request('https://example.test/api/internal/stripe/prepaid/process',{headers:{authorization:'Bearer fixture-secret'}});
  assert.equal((await route.GET(request())).status,200);result={...result,remainingDue:1};assert.equal((await route.POST(request())).status,503);
  const empty=await load('app/api/internal/stripe/prepaid/process/route.ts',deps,{});assert.equal((await empty.GET(request())).status,401);
  const config=JSON.parse(await source('vercel.json'));assert.equal(config.crons.filter(cron=>cron.path==='/api/internal/stripe/prepaid/process').length,1);assert.equal(config.crons.find(cron=>cron.path==='/api/internal/stripe/prepaid/process').schedule,'*/5 * * * *');
});
