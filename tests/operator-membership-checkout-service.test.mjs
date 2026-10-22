import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { prepaidFixtureDependencies } from './helpers/prepaid-policy-fixture.mjs';
async function load(path, dependencies={}) {
  const code=ts.transpileModule(await readFile(new URL(`../${path}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const compiled={exports:{}};
  new Function('require','module','exports',code)(name=>{assert.ok(name in dependencies,`Unexpected ${name}`);return dependencies[name];},compiled,compiled.exports);
  return compiled.exports;
}
const pricing=await load('src/lib/membership/pricing.ts');
const model=await load('src/lib/stripe/operator-membership-model.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const auth=id(1), memberId=id(2), requestId=id(3), acceptance=id(4);
const now=new Date();
function quote(plan='monthly') {return {id:requestId,memberId,kind:'individual',status:'reserved',plan,offerId:`founding_individual_${plan}`,stripePriceId:'price_founder',expiresAt:new Date(now.getTime()+3600000),firstChargeAt:null,billingSchedule:null};}
async function harness(options={}) {
  const calls={accepted:[],reserved:[],created:[],opened:[],released:[]};
  let current=options.current??null;
  const person={memberId,personId:id(5),name:'Aaron Lee',email:'aaron@example.test',actorName:'Cade',actorEmail:'cade@example.test',eligible:true,paid:false,reason:null};
  const deps={...prepaidFixtureDependencies,'server-only':{},'node:crypto':await import('node:crypto'),
    '@/lib/platform/config':{getPlatformConfiguration:()=>({stripeCheckoutReady:true,minimumAge:18}),getStripePublishableKey:()=> 'pk_test_preview'},
    '@/lib/membership/published-agreement':{getPublishedMembershipAgreement:async()=>({title:'Agreement',body:options.changed?'changed':'agreed terms',version:3})},
    '@/lib/membership/paid-launch':{getMembershipFirstChargeAt:()=>null},
    '@/lib/membership/cohort-prepayment':{isMembershipCohortPrepaymentEnabled:()=>false},
    '@/lib/membership/pricing':pricing,
    '@/lib/membership/commercial-repository':{
      getCurrentCommercialMembershipReservation:async()=>current,
      getCommercialMembershipReservation:async()=>current,
      reserveCommercialMembership:async input=>{assert.equal(input.memberId,memberId);current=quote(input.plan);return current;},
      bindCommercialMembershipPrice:async()=>{},releaseCommercialMembershipReservation:async input=>calls.released.push(input),
    },
    '@/lib/stripe/operator-membership-repository':{
      getOperatorCheckoutMember:async(a,m)=>{assert.equal(a,auth);assert.equal(m,memberId);if(options.forbidden)throw Error('Administrator access required');return person;},
      acceptOperatorMembershipAgreement:async input=>{calls.accepted.push(input);return {acceptanceId:acceptance};},
    },
    '@/lib/stripe/billing-repository':{
      getMembershipCheckoutForReservation:async()=>options.attempt??null,
      reserveMembershipCheckout:async input=>{calls.reserved.push(input);return {...current,memberId,attemptId:requestId,agreementAcceptanceId:acceptance,agreementVersion:'ruined_membership-v3',stripePriceId:'price_founder',operatorAuthorizationId:id(6),operatorActorAuthUserId:auth,checkoutPreparedAt:now,existingStripeSessionId:options.existing?'cs_existing':null};},
      openMembershipCheckoutAttempt:async input=>calls.opened.push(input),expireMembershipCheckoutAttempt:async()=>{},
    },
    '@/lib/stripe/checkout-session':{createEmbeddedMembershipSession:async input=>{calls.created.push(input);return {id:'cs_new',client_secret:'secret',expires_at:Math.floor(Date.now()/1000)+3600};}},
    '@/lib/stripe/portal':{validateMembershipPortalConfiguration:async()=>{}},
    '@/lib/stripe/server':{getPaidMembershipAgreementVersion:()=> 'ruined_membership-v3',getStripeLivemode:()=>false,validateStripeMembershipOfferPrice:async()=> 'price_founder',getStripe:()=>({checkout:{sessions:{retrieve:async()=>options.session}}})},
    '@/lib/stripe/operator-membership-model':model,
  };
  const service=await load('src/lib/stripe/operator-membership-service.ts',deps);
  const getQuote=()=>service.quoteOperatorMembership({authUserId:auth,memberId,requestId,plan:'monthly'});
  const pay=async(input={})=>{const {quote:q}=await getQuote();return service.startOperatorMembershipCheckout({authUserId:auth,memberId,reservationId:q.id,reviewToken:q.reviewToken,authorityAccepted:true,authorityVersion:model.OPERATOR_MEMBERSHIP_AUTHORITY_VERSION,applicationOrigin:'https://members.example.test',userAgent:'test',...input});};
  return {service,calls,getQuote,pay,options};
}
test('quote uses beneficiary founding eligibility without accepting terms or starting payment',async()=>{
  const h=await harness();const {quote:q}=await h.getQuote();assert.equal(q.offer.amount,34900);assert.equal(q.memberName,'Aaron Lee');assert.equal(q.actorName,'Cade');assert.equal(q.reviewToken.length,64);assert.equal(h.calls.accepted.length,0);assert.equal(h.calls.created.length,0);
});
test('authorized checkout retains beneficiary and real signer then opens one embedded payment',async()=>{
  const h=await harness();assert.equal((await h.pay()).clientSecret,'secret');
  assert.equal(h.calls.accepted[0].authUserId,auth);assert.equal(h.calls.accepted[0].memberId,memberId);assert.equal(h.calls.accepted[0].expectedAgreementSha256.length,64);
  assert.equal(h.calls.reserved[0].operatorMemberId,memberId);assert.equal(h.calls.reserved[0].email,'aaron@example.test');assert.equal(h.calls.reserved[0].authUserId,auth);assert.equal(h.calls.reserved[0].consentSource,'stripe_checkout');
  assert.equal(h.calls.created[0].operatorAuthUserId,auth);assert.match(h.calls.created[0].termsMessage,/on behalf/);assert.equal(h.calls.opened.length,1);
});
test('no authority, stale review or wrong authority version cannot accept or charge',async()=>{
  for(const change of [{authorityAccepted:false},{authorityVersion:'old'},{reviewToken:'0'.repeat(64)}]){
    const h=await harness();await assert.rejects(h.pay(change));assert.equal(h.calls.accepted.length,0);assert.equal(h.calls.created.length,0);
  }
});
test('non-admin cannot prepare any offer or acceptance',async()=>{const h=await harness({forbidden:true});await assert.rejects(h.getQuote());assert.equal(h.calls.accepted.length,0);assert.equal(h.calls.created.length,0);});
test('changed agreement after review fails before acceptance',async()=>{
  const h=await harness();const {quote:q}=await h.getQuote();h.options.changed=true;
  await assert.rejects(h.pay({reviewToken:q.reviewToken}),/terms or offer changed/);assert.equal(h.calls.accepted.length,0);
});
test('completed or actor-mismatched Stripe checkout cannot create a second payment',async()=>{
  for(const session of [{status:'complete'},{status:'open',mode:'subscription',ui_mode:'embedded_page',livemode:false,client_reference_id:memberId,metadata:{ruined_checkout_actor_id:id(9)}}]){
    const h=await harness({existing:true,session});await assert.rejects(h.pay());assert.equal(h.calls.created.length,0);
  }
});
test('unresolved expired offers keep their payment hold',async()=>{
  const h=await harness({current:{...quote(),expiresAt:new Date(Date.now()-1000)},attempt:{id:requestId,status:'creating',stripeSessionId:null}});
  await assert.rejects(h.getQuote(),/earlier payment/);assert.equal(h.calls.released.length,0);assert.equal(h.calls.created.length,0);
});

test('a same-operator open Checkout extends quote review through its persisted payment expiry',async()=>{
  const expiresAt=new Date(Date.now()+20*60_000);
  const h=await harness({current:{...quote(),expiresAt:new Date(Date.now()-1000)},attempt:{id:requestId,status:'open',stripeSessionId:'cs_existing',
    actorAuthUserId:auth,operatorAuthorizationId:requestId,expiresAt},session:{status:'open'}});
  const {quote:q}=await h.getQuote();
  assert.equal(q.id,requestId);assert.equal(q.expiresAt,expiresAt.toISOString());assert.equal(q.offer.amount,34900);
  assert.equal(h.calls.released.length,0);assert.equal(h.calls.created.length,0);assert.equal(h.calls.accepted.length,0);
  const {quote:repeat}=await h.getQuote();assert.equal(repeat.reviewToken,q.reviewToken);
});

test('another actor or a member checkout cannot extend an expired delegated quote',async()=>{
  for(const change of [{actorAuthUserId:id(90)},{operatorAuthorizationId:null}]){
    const h=await harness({current:{...quote(),expiresAt:new Date(Date.now()-1000)},attempt:{id:requestId,status:'open',stripeSessionId:'cs_existing',
      actorAuthUserId:auth,operatorAuthorizationId:requestId,expiresAt:new Date(Date.now()+20*60_000),...change},session:{status:'open'}});
    await assert.rejects(h.getQuote(),/earlier payment/);assert.equal(h.calls.released.length,0);assert.equal(h.calls.created.length,0);
  }
});
