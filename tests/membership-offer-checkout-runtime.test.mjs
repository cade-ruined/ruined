import { prepaidFixtureDependencies } from "./helpers/prepaid-policy-fixture.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}) {
  dependencies = { ...prepaidFixtureDependencies, ...dependencies };
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", output)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, result, result.exports);
  return result.exports;
}
const pricing = await load("src/lib/membership/pricing.ts");
const policy = await load("src/lib/stripe/price-policy.ts", { "@/lib/membership/pricing": pricing });
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12,"0")}`;
const response = { NextResponse: { json: (value, options) => Response.json(value, options) } };
const isUuid = value => typeof value === "string" && /^[0-9a-f-]{36}$/.test(value);
class Denied extends Error {}
class OfferError extends Error { constructor(status,message,code) { super(message); this.status=status; this.code=code; } }

async function offerHarness({ signedIn = true, trusted = true, enabled = true, country = "US", funding = "self", readyPair = null, current = null, releaseError = false, pending = false, firstChargeAt = null, activationEnabled = false, oldAttempt = null, oldSession = null } = {}) {
  const calls = { reserved:[], bound:[], released:[], prices:[] };
  const route = await load("app/api/stripe/membership-offer/route.ts", {
    "next/server": response,
    "@/lib/stripe/billing-repository": { getMembershipCheckoutForReservation:async()=>oldAttempt,expireMembershipCheckoutAttempt:async()=>{} },
    "@/lib/membership/paid-launch": { getMembershipFirstChargeAt: () => firstChargeAt },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => signedIn ? {authUserId:id(2)} : null },
    "@/lib/membership/repository": { getMemberOnboarding: async () => ({requiredFieldsComplete:true,membershipFunding:funding,profile:{fulfillmentAddress:{countryCode:country}}}) },
    "@/lib/membership/published-agreement": { getPublishedMembershipAgreement: async () => ({version:2}) },
    "@/lib/membership/commercial-repository": {
      CommercialMembershipError: OfferError,
      getReadyCoupleMembershipAuthorization: async () => readyPair,
      getCurrentCommercialMembershipReservation: async () => current,
      reserveCommercialMembership: async input => { if(pending) throw new OfferError(409,"A founding place is temporarily reserved in another checkout. Please try again shortly.","founding_place_pending"); calls.reserved.push(input); return {id:input.requestId,offerId:`${input.kind === "couple" ? "couple" : "founding_individual"}_${input.plan}`,expiresAt:input.expiresAt,firstChargeAt:input.firstChargeAt,participants:[{memberId:id(1),name:"Member"}]}; },
      bindCommercialMembershipPrice: async input => calls.bound.push(input),
      releaseCommercialMembershipReservation: async input => { if(releaseError) throw Error("Checkout is unresolved"); calls.released.push(input); },
    },
    "@/lib/membership/pricing": pricing,
    "@/lib/platform/config": {getPlatformConfiguration:()=>({stripeCheckoutReady:enabled,stripeActivationReady:activationEnabled})},
    "@/lib/platform/repository": {PlatformAccessDeniedError:Denied,requireActivePlatformMemberLink:async()=>({memberId:id(1)})},
    "@/lib/stripe/membership-state": {isUuid},
    "@/lib/stripe/server": {getStripe:()=>({checkout:{sessions:{retrieve:async()=>oldSession}}}),getStripeLivemode:()=>false,isTrustedCheckoutOrigin:()=>trusted,getPaidMembershipAgreementVersion:()=>"ruined_membership-v2",validateStripeMembershipOfferPrice:async offerId=>{calls.prices.push(offerId);return `price_${offerId}`;}},
  });
  return {calls,post:body=>route.POST(new Request("https://members.example.test/api/stripe/membership-offer",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}))};
}
const choice = {requestId:id(3),kind:"individual",plan:"monthly"};
test("offer endpoint chooses founding price on the server and binds the quote before any payment consent", async()=>{
  const f=await offerHarness(); const result=await f.post(choice); const body=await result.json();
  assert.equal(result.status,200); assert.equal(result.headers.get("cache-control"),"no-store");
  assert.equal(body.quote.offer.id,"founding_individual_monthly"); assert.equal(body.quote.offer.amount,34900);
  assert.equal(body.quote.offer.initialTermAmount,418800); assert.equal(body.quote.buyoutCap,150000);
  assert.ok(f.calls.reserved[0].expiresAt.getTime() <= Date.now()+60*60_000);
  assert.ok(f.calls.reserved[0].expiresAt.getTime() >= Date.now()+59*60_000);
  assert.equal(body.quote.billingTermsVersion,"membership-billing-v2"); assert.equal(body.quote.id,choice.requestId);
  assert.equal(f.calls.reserved[0].memberId,id(1)); assert.deepEqual(f.calls.bound,[{reservationId:choice.requestId,stripePriceId:"price_founding_individual_monthly"}]);
});
test("offer route rejects anonymous, cross-origin, prelaunch, non-US, complimentary and injected prices without reserving",async()=>{
  for(const [config,status] of [[{signedIn:false},401],[{trusted:false},403],[{enabled:false},503],[{country:"CA"},409],[{funding:"complimentary"},409]]){
    const f=await offerHarness(config);assert.equal((await f.post(choice)).status,status);assert.equal(f.calls.reserved.length,0);
  }
  for(const extra of [{tier:"founding_individual"},{amount:1},{priceId:"price_cheap"},{memberId:id(9)}]){
    const f=await offerHarness();assert.equal((await f.post({...choice,...extra})).status,400);assert.equal(f.calls.prices.length,0);
  }
});
test("a couples quote requires a durable approved partner and never accepts partner identity from the body",async()=>{
  const missing=await offerHarness();assert.equal((await missing.post({...choice,kind:"couple"})).status,409);assert.equal(missing.calls.reserved.length,0);
  const readyPair={id:id(8),partnerMemberId:id(7)};
  const f=await offerHarness({readyPair});const result=await f.post({...choice,kind:"couple",plan:"annual"});
  assert.equal(result.status,200);assert.equal((await result.json()).quote.offer.amount,699000);
  assert.equal(f.calls.reserved[0].partnerMemberId,id(7));assert.equal(f.calls.reserved[0].coupleAuthorizationId,id(8));
  assert.equal((await f.post({...choice,kind:"couple",partnerMemberId:id(9)})).status,400);
});
test("only the current member's unused quote can be released; unresolved Checkout remains locked",async()=>{
  const foreign=await offerHarness({current:{id:id(4)}});assert.equal((await foreign.post({action:"release",reservationId:id(3)})).status,409);assert.equal(foreign.calls.released.length,0);
  const unused=await offerHarness({current:{id:id(3)}});assert.equal((await unused.post({action:"release",reservationId:id(3)})).status,200);
  const inFlight=await offerHarness({current:{id:id(3)},releaseError:true});assert.equal((await inFlight.post({action:"release",reservationId:id(3)})).status,409);assert.equal(inFlight.calls.released.length,0);
});
test("all six v2 offers require exact unique prices, exclusive tax, billing mode and matching metadata",()=>{
  const offers=Object.fromEntries(Object.keys(pricing.MEMBERSHIP_OFFERS).map(key=>[key,`price_${key}`]));
  const config={monthly:"price_old_month",annual:"price_old_year",legacy:"price_legacy",livemode:false,offers};
  for(const offer of Object.values(pricing.MEMBERSHIP_OFFERS)){
    const price={id:offers[offer.id],active:true,livemode:false,type:"recurring",billing_scheme:"per_unit",currency:"usd",unit_amount:offer.amount,tax_behavior:"exclusive",recurring:{interval:offer.interval,interval_count:1,usage_type:"licensed"}};
    const subscription={livemode:false,metadata:{billing_terms_version:"membership-billing-v2",ruined_offer_id:offer.id,ruined_billing_plan:offer.plan,ruined_commercial_reservation_id:id(3)},items:{has_more:false,data:[{quantity:1,price}]}};
    assert.equal(policy.matchesMembershipOfferPrice(price,offer.id,config,true),true);
    assert.equal(policy.recognizesMembershipSubscription(subscription,config),true);
    for(const patch of [{unit_amount:1},{tax_behavior:"inclusive"},{livemode:true},{active:false}]) assert.equal(policy.matchesMembershipOfferPrice({...price,...patch},offer.id,config,true),false);
    assert.equal(policy.recognizesMembershipSubscription({...subscription,metadata:{...subscription.metadata,ruined_offer_id:"individual_cheap"}},config),false);
    assert.equal(policy.recognizesMembershipSubscription({...subscription,metadata:{...subscription.metadata,ruined_commercial_reservation_id:""}},config),false);
  }
});

async function coupleHarness({memberId=id(1),signedIn=true,trusted=true,enabled=true,authorization={id:id(3),memberId:id(1),partnerMemberId:id(2),acceptedAt:null,revokedAt:null,expiresAt:new Date(Date.now()+3600000)}}={}) {
  const calls={created:[],accepted:[],reads:0};
  const sql=async strings=>{calls.reads++;const query=strings.join('?');
    if(query.includes('count(*)'))return[{total:0}];if(query.includes('profile.member_tag'))return[{id:id(2)}];
    if(query.includes(' as name'))return[{name:'Payer name'}];return[{id:memberId}];};sql.begin=work=>work(sql);
  class CommercialError extends Error {constructor(status,message){super(message);this.status=status;}}
  const route=await load('app/api/stripe/couple-authorization/route.ts',{
    'next/server':response,'@/lib/auth/session':{getCurrentPlatformViewer:async()=>signedIn?{authUserId:id(9)}:null},
    '@/lib/database/server':{getApplicationDatabase:()=>sql},
    '@/lib/membership/commercial-repository':{CommercialMembershipError:CommercialError,getCoupleMembershipAuthorization:async()=>authorization,
      createCoupleMembershipAuthorization:async input=>{calls.created.push(input);return{id:input.id};},
      acceptCoupleMembershipAuthorization:async input=>{calls.accepted.push(input);return{acceptedAt:new Date()};}},
    '@/lib/platform/config':{getPlatformConfiguration:()=>({stripeCheckoutReady:enabled})},
    '@/lib/platform/repository':{PlatformAccessDeniedError:Denied,requireActivePlatformMemberLink:async()=>({memberId})},
    '@/lib/stripe/membership-state':{isUuid},
    '@/lib/stripe/server':{isTrustedCheckoutOrigin:()=>trusted,getApplicationOrigin:()=> 'https://members.example.test'},
  });
  return {calls,get:()=>route.GET(new Request(`https://members.example.test/api/stripe/couple-authorization?id=${id(3)}`)),post:body=>route.POST(new Request('https://members.example.test/api/stripe/couple-authorization',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))};
}
test('couple authorization creation derives payer from session, targets exact registered tag and returns only a manual share link',async()=>{
  const f=await coupleHarness();const result=await f.post({action:'request',requestId:id(3),partnerTag:'partner_tag'});
  assert.equal(result.status,200);assert.deepEqual(f.calls.created,[{id:id(3),memberId:id(1),partnerMemberId:id(2)}]);
  assert.deepEqual(await result.json(),{authorizationId:id(3),approvalUrl:`https://members.example.test/my/couple?authorization=${id(3)}`});
  assert.equal((await f.post({action:'request',requestId:id(3),partnerTag:'partner_tag',memberId:id(6)})).status,400);
  assert.equal(f.calls.created.length,1);
});
test('couple approval refuses anonymous and foreign reads without exposing private member data',async()=>{
  const anonymous=await coupleHarness({signedIn:false});assert.equal((await anonymous.get()).status,401);
  const stranger=await coupleHarness({memberId:id(7)});assert.equal((await stranger.get()).status,404);assert.equal(stranger.calls.reads,0);
  const partner=await coupleHarness({memberId:id(2)});const result=await partner.get();assert.equal(result.status,200);
  const payload=await result.json();assert.equal(payload.authorization.role,'partner');assert.equal(payload.authorization.payerName,'Payer name');assert.equal(payload.authorization.partnerMemberId,undefined);
});
test('couple approval is explicit and bound to the accepting auth identity with no payment or email',async()=>{
  const f=await coupleHarness({memberId:id(2)});
  assert.equal((await f.post({action:'accept',authorizationId:id(3),approved:false})).status,400);
  assert.equal((await f.post({action:'accept',authorizationId:id(3),approved:true,authUserId:id(1)})).status,400);
  assert.equal((await f.post({action:'accept',authorizationId:id(3),approved:true})).status,200);
  assert.deepEqual(f.calls.accepted,[{id:id(3),authUserId:id(9)}]);
  const disabled=await coupleHarness({enabled:false});assert.equal((await disabled.post({action:'accept',authorizationId:id(3),approved:true})).status,503);assert.equal(disabled.calls.accepted.length,0);
  const crossOrigin=await coupleHarness({trusted:false});assert.equal((await crossOrigin.post({action:'accept',authorizationId:id(3),approved:true})).status,403);assert.equal(crossOrigin.calls.accepted.length,0);
});

test('temporary founding capacity returns a retryable decision without a standard-price quote or provider call',async()=>{
 const f=await offerHarness({pending:true});const result=await f.post(choice);const payload=await result.json();
 assert.equal(result.status,409);assert.equal(payload.code,'founding_place_pending');assert.equal(payload.retryable,true);
 assert.match(payload.error,/try again shortly/);assert.equal(payload.quote,undefined);assert.equal(f.calls.prices.length,0);assert.equal(f.calls.bound.length,0);
});

test("scheduled offers disclose and persist the server date while public paid signup remains closed", async () => {
  const firstChargeAt = new Date(Date.now()+7*86400000);
  const h = await offerHarness({enabled:false,activationEnabled:true,firstChargeAt});
  const response = await h.post(choice);
  assert.equal(response.status,200);
  assert.equal((await response.json()).quote.firstChargeAt,firstChargeAt.toISOString());
  assert.equal(h.calls.reserved[0].firstChargeAt,firstChargeAt);
  for (const date of [new Date(Date.now()+30*60000),new Date(Date.now()+40*86400000)]) {
    const invalid = await offerHarness({firstChargeAt:date});
    assert.equal((await invalid.post(choice)).status,409);
    assert.equal(invalid.calls.reserved.length,0);
  }
});

test("after the scheduled date only confirmed terminated Checkout releases the old offer",async()=>{
  const current={id:id(8),firstChargeAt:new Date(Date.now()-60000),kind:"individual",plan:"monthly"};
  const oldAttempt={id:id(8),status:"open",stripeSessionId:"cs_old"};
  const oldSession={status:"expired",livemode:false,metadata:{ruined_commercial_reservation_id:id(8),ruined_member_id:id(1)}};
  const h=await offerHarness({current,oldAttempt,oldSession});
  const response=await h.post(choice);
  assert.equal(response.status,200);assert.equal((await response.json()).quote.firstChargeAt,null);
  assert.deepEqual(h.calls.released,[{reservationId:id(8),reason:"checkout_expired"}]);
  for(const status of ["open","complete"]){
    const pending=await offerHarness({current,oldAttempt,oldSession:{...oldSession,status}});
    assert.equal((await pending.post(choice)).status,409);assert.equal(pending.calls.released.length,0);assert.equal(pending.calls.reserved.length,0);
  }
});
