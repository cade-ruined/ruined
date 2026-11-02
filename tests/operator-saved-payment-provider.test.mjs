import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { prepaidPolicyFixture as prepaid, foundationsScheduleFixture as schedules } from "./helpers/prepaid-policy-fixture.mjs";

export async function load(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, name); return dependencies[name];
  }, result, result.exports);
  return result.exports;
}
export const pricing = await load("src/lib/membership/pricing.ts");
export const model = await load("src/lib/stripe/operator-membership-model.ts");
const prices = await load("src/lib/stripe/price-policy.ts", { "@/lib/membership/pricing": pricing, "./prepaid-policy": prepaid });
export const provider = await load("src/lib/stripe/operator-saved-payment-provider.ts", { "node:crypto": crypto,
  "./membership-state": { MEMBERSHIP_CONTEXT: "membership", MEMBERSHIP_OFFER: "founding_membership" },
  "@/lib/membership/pricing": pricing, "./prepaid-policy": prepaid, "./price-policy": prices, "./operator-membership-model": model });
export const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export function fixture() {
  const billingSchedule = schedules.foundationsBillingScheduleForMonth("2036-11", "monthly");
  const target = { memberId:uid(1), customerId:"cus_member", paymentMethodId:"pm_saved", setupIntentId:"seti_saved",
    stripeAccountId:"acct_saved", livemode:false, email:"member@example.test" };
  const config = { livemode:false, offers:{founding_individual_monthly:"price_founder"} };
  const price = { id:"price_founder", product:"prod_founder", livemode:false, active:true, type:"recurring", billing_scheme:"per_unit",
    tax_behavior:"exclusive", currency:"usd", unit_amount:34900, recurring:{interval:"month",interval_count:1,usage_type:"licensed"} };
  const customer = { id:target.customerId, livemode:false, email:target.email, metadata:{ruined_member_id:target.memberId}, balance:0,
    address:{line1:"1 Main St",city:"Denver",state:"CO",postal_code:"80202",country:"US"}, tax_exempt:"none" };
  const method = { id:target.paymentMethodId, customer:target.customerId, livemode:false, type:"link", allow_redisplay:"always" };
  const setup = { id:target.setupIntentId, customer:target.customerId, payment_method:target.paymentMethodId, livemode:false,
    status:"succeeded",usage:"off_session",mandate:"mandate_saved",metadata:{ruined_member_id:target.memberId} };
  const mandate = { id:"mandate_saved",type:"multi_use",status:"active",livemode:false,payment_method:target.paymentMethodId };
  const preview = { currency:"usd",total:37692,total_excluding_tax:34900,amount_due:37692,starting_balance:0,
    lines:{has_more:false,data:[{subtotal:34900},{subtotal:0}]},automatic_tax:{status:"complete"} };
  const subscriptions = [], invoices = [], pendingItems = [], calls = [];
  const stripe = { accounts:{retrieve:async()=>({id:target.stripeAccountId})},customers:{retrieve:async()=>customer},
    paymentMethods:{retrieve:async()=>method},setupIntents:{retrieve:async()=>setup},prices:{retrieve:async()=>price},mandates:{retrieve:async()=>mandate},
    subscriptions:{list:async()=>({data:subscriptions,has_more:false})},invoiceItems:{list:async()=>({data:pendingItems,has_more:false})},
    invoices:{list:async()=>({data:invoices,has_more:false}),createPreview:async input=>{calls.push(input);return preview;}} };
  const reservation = { attemptId:uid(2),commercialReservationId:uid(2),memberId:target.memberId,agreementAcceptanceId:uid(3),
    operatorAuthorizationId:uid(2),operatorActorAuthUserId:uid(4),consentSource:"operator_saved_payment",plan:"monthly",
    stripePriceId:price.id,offerId:"founding_individual_monthly",billingSchedule,firstChargeAt:null,existingStripeSessionId:null,
    agreementKey:"ruined_membership",agreementVersion:"ruined_membership-v3",agreementContentSha256:"a".repeat(64),
    agreementAcceptedAt:new Date("2026-11-02T17:00:00Z"),ageAttestedAt:new Date("2026-11-02T17:00:00Z"),
    recurringPaymentAcceptedAt:new Date("2026-11-02T17:00:00Z") };
  const inspect = () => provider.inspectOperatorSavedPayment(stripe,{target,offerId:reservation.offerId,priceId:price.id,schedule:billingSchedule,
    automaticTaxEnabled:true,priceConfiguration:config});
  const subscription = params => ({ id:"sub_saved",livemode:false,customer:target.customerId,default_payment_method:target.paymentMethodId,
    collection_method:"charge_automatically",automatic_tax:{enabled:true},status:"trialing",metadata:params.metadata,
    trial_end:params.trial_end,billing_cycle_anchor:params.trial_end,
    items:{has_more:false,data:[{quantity:1,price}]} });
  return {target,config,price,customer,method,setup,mandate,preview,subscriptions,invoices,pendingItems,calls,stripe,reservation,inspect,subscription};
}

test("saved Link preflight binds identity and tax; create charges once now with the authorized recurring schedule",async()=>{
  const f=fixture(), inspection=await f.inspect();
  assert.equal(inspection.expectedTotal,37692);assert.equal(inspection.tax,2792);assert.equal(inspection.mandateId,"mandate_saved");
  const params=provider.operatorSavedPaymentParameters({reservation:f.reservation,inspection,minimumAge:18});
  assert.equal(params.off_session,true);assert.equal(params.payment_behavior,"error_if_incomplete");
  assert.deepEqual(params.automatic_tax,{enabled:true});assert.equal(params.default_payment_method,f.target.paymentMethodId);
  assert.equal(params.add_invoice_items[0].price_data.unit_amount,34900);assert.equal(params.items[0].price,"price_founder");
  assert.equal(params.trial_end,Date.parse(f.reservation.billingSchedule.prepaidThrough)/1000);
  assert.equal(params.metadata.billing_consent_source,"operator_saved_payment");assert.equal(params.metadata.ruined_checkout_actor_id,uid(4));
  assert.equal(params.metadata.ruined_saved_payment_id,uid(2));assert.equal(params.metadata.billing_consent_at,f.reservation.recurringPaymentAcceptedAt.toISOString());
  assert.equal(provider.matchesOperatorSavedSubscription(f.subscription(params),{reservation:f.reservation,target:f.target,automaticTaxEnabled:true}),true);
  assert.equal("checkout" in params,false);assert.equal("payment_intent_data" in params,false);
});

test("identity, off-session mandate, price, address and tax errors stop before any charge",async()=>{
  for(const mutate of [
    f=>{f.customer.metadata.ruined_member_id=uid(99);},f=>{f.customer.email="other@example.test";},f=>{f.method.customer="cus_other";},
    f=>{f.setup.usage="on_session";},f=>{f.setup.payment_method="pm_other";},f=>{f.mandate.status="inactive";},
    f=>{f.mandate.type="single_use";},f=>{f.setup.mandate=null;},f=>{f.mandate.payment_method="pm_other";},f=>{f.method.livemode=true;},
    f=>{f.price.unit_amount=49900;},f=>{f.customer.address=null;},f=>{f.customer.balance=-34900;},
    f=>{f.customer.discount={id:"di_saved"};},f=>{f.preview.automatic_tax.status="requires_location_inputs";},
    f=>{f.preview.amount_due=34900;},f=>{f.preview.lines.data.push({subtotal:300});},
  ]) {const f=fixture();mutate(f);await assert.rejects(f.inspect());}
});

test("existing active billing, earlier invoices and pending invoice items block a new first payment",async()=>{
  for(const mutate of [f=>f.subscriptions.push({id:"sub_other",status:"trialing"}),f=>f.invoices.push({id:"in_other",status:"paid"}),
    f=>f.invoices.push({id:"in_other",status:"open"}),f=>f.pendingItems.push({id:"ii_other"})]) {
    const f=fixture();mutate(f);await assert.rejects(f.inspect(),/already has billing/);assert.equal(f.calls.length,0);
  }
});

test("provider reconciliation refuses another actor, payment instrument, price, schedule or accepted agreement",async()=>{
  const f=fixture(),inspection=await f.inspect(),params=provider.operatorSavedPaymentParameters({reservation:f.reservation,inspection,minimumAge:18});
  for(const mutate of [s=>{s.customer="cus_other";},s=>{s.default_payment_method="pm_other";},s=>{s.metadata.ruined_checkout_actor_id=uid(99);},
    s=>{s.metadata.billing_consent_source="member";},s=>{s.metadata.agreement_acceptance_id=uid(99);},
    s=>{s.items.data[0].price.id="price_other";},s=>{s.trial_end+=86400;},s=>{s.automatic_tax.enabled=false;}]) {
    const subscription=structuredClone(f.subscription(params));mutate(subscription);
    assert.equal(provider.matchesOperatorSavedSubscription(subscription,{reservation:f.reservation,target:f.target,automaticTaxEnabled:true}),false);
  }
  for(const change of [{consentSource:"stripe_checkout"},{operatorActorAuthUserId:null},{existingStripeSessionId:"cs_fake"}])
    assert.throws(()=>provider.operatorSavedPaymentParameters({reservation:{...f.reservation,...change},inspection,minimumAge:18}));
});

test("authentication, declined and uncertain provider outcomes are distinct and never reported paid",()=>{
  assert.equal(provider.savedPaymentFailure({type:"StripeCardError",code:"authentication_required"}).state,"requires_action");
  assert.equal(provider.savedPaymentFailure({type:"StripeCardError",code:"card_declined"}).state,"failed");
  assert.equal(provider.savedPaymentFailure({type:"StripeConnectionError"}).state,"review");
});

async function serviceHarness(options={}) {
  const f=fixture(),actor={authUserId:uid(4),memberId:uid(1)},calls={create:[],accept:[],reconcile:0};
  let binding=null,paid=false,subscription=null;
  const quote={id:uid(2),expiresAt:new Date(Date.now()+3600000).toISOString(),reviewToken:"commercial-review",firstChargeAt:null,
    billingSchedule:f.reservation.billingSchedule,offer:pricing.MEMBERSHIP_OFFERS.founding_individual_monthly,
    agreement:{title:"Membership agreement",version:f.reservation.agreementVersion,bodyText:"Accepted paid membership terms"},memberName:"Geoff",actorName:"Cade"};
  process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID=f.target.stripeAccountId;
  f.stripe.subscriptions.retrieve=async()=>subscription;
  f.stripe.subscriptions.list=async()=>({data:subscription?[subscription]:[],has_more:false});
  f.stripe.subscriptions.create=async(params,request)=>{
    calls.create.push({params,request});
    if(options.createdBeforeError || !options.error) subscription=f.subscription(params);
    if(subscription && options.unpaidStatus) subscription.latest_invoice="in_unpaid";
    if(options.error) throw options.error;
    return subscription;
  };
  f.stripe.invoices.retrieve=async()=>({id:"in_unpaid",customer:f.target.customerId,livemode:false,currency:"usd",total:37692,status:"open",
    parent:{subscription_details:{subscription:"sub_saved"}}});
  f.stripe.invoicePayments={list:async()=>({has_more:false,data:[{invoice:"in_unpaid",payment:{payment_intent:"pi_unpaid"}}]})};
  f.stripe.paymentIntents={retrieve:async()=>({id:"pi_unpaid",customer:f.target.customerId,livemode:false,currency:"usd",amount:37692,status:options.unpaidStatus})};
  const repo={
    getOperatorSavedPaymentTarget:async()=>f.target,
    getOperatorSavedPaymentBinding:async()=>binding,
    getOperatorSavedPaymentReservation:async()=>f.reservation,
    prepareOperatorSavedPaymentBinding:async input=>binding??=( {...input,status:"prepared",startedAt:null,actorAuthUserId:actor.authUserId,
      operatorAuthorizationId:uid(2),createdAt:new Date(),subscriptionId:null,errorCode:null} ),
    claimOperatorSavedPaymentBinding:async()=>{
      if(options.crashBeforeClaim){options.crashBeforeClaim=false;throw Error("Simulated interruption before claim");}
      if(binding.status!=="prepared") return {binding,claimed:false};
      binding.status="submitting";binding.startedAt=new Date();return {binding,claimed:true};
    },
    bindOperatorSavedPaymentSubscription:async input=>{binding.subscriptionId=input.subscriptionId;return binding;},
    failOperatorSavedPaymentBinding:async input=>{binding.status="review";binding.errorCode=input.errorCode;},
  };
  const service=await load("src/lib/stripe/operator-saved-payment-service.ts",{
    "node:crypto":crypto,"@/lib/platform/config":{getPlatformConfiguration:()=>({minimumAge:18})},
    "@/lib/membership/commercial-repository":{getCommercialMembershipReservation:async()=>({id:uid(2),kind:"individual",stripePriceId:"price_founder",offerId:"founding_individual_monthly"})},
    "./billing-repository":{reserveMembershipCheckout:async()=>f.reservation},
    "./operator-membership-repository":{getOperatorCheckoutMember:async()=>({paid}),acceptOperatorSavedPaymentAgreement:async input=>{calls.accept.push(input);return {acceptanceId:uid(3)};}},
    "./operator-membership-service":{quoteOperatorMembership:async()=>({quote}),operatorMembershipStatus:async()=>({eligible:!paid,paid})},
    "./operator-membership-model":model,"./server":{getStripe:()=>f.stripe,getStripeLivemode:()=>false,getMembershipPriceConfiguration:()=>f.config,
      isStripeTaxEnabled:()=>true,validateStripeMembershipOfferPrice:async()=>"price_founder"},
    "./portal":{validateMembershipPortalConfiguration:async()=>{}},"./operator-saved-payment-provider":provider,"./operator-saved-payment-repository":repo,
    "./webhook":{reconcilePrepaidMembershipSubscription:async()=>{calls.reconcile++;if(options.settled!==false){paid=true;binding.status="succeeded";}}},
  });
  const reviewed=await service.quoteOperatorSavedMembership({...actor,requestId:uid(2),plan:"monthly"});
  const input={...actor,reservationId:uid(2),reviewToken:reviewed.quote.reviewToken,authorityAccepted:true,
    authorityVersion:model.OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION,authorizationEvidence:"The member explicitly authorized first payment and recurring renewals.",
    applicationOrigin:"https://members.example.test",userAgent:"test"};
  return {f,service,calls,input,quote,actor,repo,get binding(){return binding;}};
}

test("delegated collection records actual authority and makes one durable idempotent provider submission",async()=>{
  const h=await serviceHarness();assert.equal((await h.service.startOperatorSavedMembership(h.input)).state,"paid");
  assert.equal(h.calls.create.length,1);assert.equal(h.calls.create[0].request.maxNetworkRetries,0);
  assert.match(h.calls.create[0].request.idempotencyKey,new RegExp(uid(2)));
  assert.equal(h.calls.accept[0].evidence.source,"operator_recorded_member_authorization");
  assert.equal(h.calls.accept[0].evidence.statement,h.input.authorizationEvidence);
  assert.equal(h.calls.accept[0].authorityVersion,"operator-saved-payment-authority-v2");
  assert.equal(h.binding.providerRequestSha256,provider.savedPaymentFingerprint(h.calls.create[0].params));
  assert.equal(h.binding.expectedTotal,37692);
  assert.equal((await h.service.startOperatorSavedMembership(h.input)).state,"paid");assert.equal(h.calls.create.length,1);
});

test("changed review or missing delegated authority cannot record agreement or collect funds",async()=>{
  for(const change of [{authorityAccepted:false},{authorityVersion:model.OPERATOR_MEMBERSHIP_AUTHORITY_VERSION},
    {authorizationEvidence:"yes"},{reviewToken:"stale"}]) {
    const h=await serviceHarness();await assert.rejects(h.service.startOperatorSavedMembership({...h.input,...change}));
    assert.equal(h.calls.create.length,0);assert.equal(h.calls.accept.length,0);
  }
  const h=await serviceHarness();h.f.preview.total++;h.f.preview.amount_due++;
  await assert.rejects(h.service.startOperatorSavedMembership(h.input),/changed/);assert.equal(h.calls.create.length,0);
});

test("concurrent submissions can contact Stripe only once",async()=>{
  const h=await serviceHarness();await Promise.allSettled([h.service.startOperatorSavedMembership(h.input),h.service.startOperatorSavedMembership(h.input)]);
  assert.equal(h.calls.create.length,1);assert.equal(h.binding.status,"succeeded");
});

test("an interruption before the durable submission claim can safely resume the same reviewed attempt",async()=>{
  const h=await serviceHarness({crashBeforeClaim:true});
  await assert.rejects(h.service.startOperatorSavedMembership(h.input),/before claim/);
  assert.equal(h.binding.status,"prepared");assert.equal(h.calls.create.length,0);
  assert.equal((await h.service.startOperatorSavedMembership(h.input)).state,"paid");assert.equal(h.calls.create.length,1);
});

test("lost create responses reconcile the original subscription; unknown outcomes never resubmit",async()=>{
  for(const createdBeforeError of [true,false]) {
    const h=await serviceHarness({createdBeforeError,error:{type:"StripeConnectionError"}});
    assert.equal((await h.service.startOperatorSavedMembership(h.input)).state,createdBeforeError?"paid":"review");
    await h.service.startOperatorSavedMembership(h.input);
    await h.service.statusOperatorSavedMembership(h.actor.authUserId,h.actor.memberId);
    assert.equal(h.calls.create.length,1);
  }
});

test("decline and authentication errors retain the hold and do not fabricate paid membership",async()=>{
  for(const [code,state] of [["authentication_required","requires_action"],["card_declined","failed"]]) {
    const h=await serviceHarness({error:{type:"StripeCardError",code}});
    assert.equal((await h.service.startOperatorSavedMembership(h.input)).state,state);
    assert.equal((await h.service.startOperatorSavedMembership(h.input)).state,state);
    assert.equal(h.calls.create.length,1);assert.equal(h.binding.status,"review");
  }
  const h=await serviceHarness({settled:false});
  assert.equal((await h.service.startOperatorSavedMembership(h.input)).state,"pending");assert.equal(h.binding.status,"submitting");
});

test("a retained trial subscription with unpaid first invoice reports bank action or decline, never paid",async()=>{
  for(const [unpaidStatus,state] of [["requires_action","requires_action"],["requires_payment_method","failed"],["processing","pending"]]) {
    const h=await serviceHarness({settled:false,unpaidStatus});
    assert.equal((await h.service.startOperatorSavedMembership(h.input)).state,state);
    assert.equal((await h.service.startOperatorSavedMembership(h.input)).state,state);
    assert.equal(h.calls.create.length,1);
  }
});

async function consentHarness({bound=false}={}) {
  const f=fixture(),inspection=await f.inspect(),params=provider.operatorSavedPaymentParameters({reservation:f.reservation,inspection,minimumAge:18});
  const subscription=f.subscription(params),r=f.reservation;
  const binding={...f.target,attemptId:r.attemptId,actorAuthUserId:r.operatorActorAuthUserId,operatorAuthorizationId:r.operatorAuthorizationId,
    status:bound?"succeeded":"submitting",startedAt:new Date(),subscriptionId:bound?subscription.id:null,automaticTaxEnabled:true};
  const attempt={id:r.attemptId,member_id:r.memberId,commercial_reservation_id:r.attemptId,billing_plan:r.plan,offer_id:r.offerId,stripe_price_id:r.stripePriceId,
    agreement_acceptance_id:r.agreementAcceptanceId,agreement_version:r.agreementVersion,billing_consent_source:r.consentSource,
    recurring_payment_accepted_at:r.recurringPaymentAcceptedAt,stripe_session_id:null,stripe_subscription_id:bound?subscription.id:null,
    operator_authorization_id:r.operatorAuthorizationId,billing_consent_auth_user_id:r.operatorActorAuthUserId,billing_schedule:r.billingSchedule,first_charge_at:null,
    agreement_content_sha256:r.agreementContentSha256,agreement_accepted_at:r.agreementAcceptedAt,authority_version:model.OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION,
    acceptance_actor:r.operatorActorAuthUserId,authority_actor:r.operatorActorAuthUserId,affirmative_action:"operator_recorded_authorization"};
  const statements=[];
  const tx=async parts=>{const sql=parts.join("?");statements.push(sql);return sql.includes("join membership_agreement_acceptances")?[attempt]:[];};
  const consent=await load("src/lib/stripe/operator-saved-payment-consent.ts",{
    "./membership-state":{isUuid:value=>/^[0-9a-f-]{36}$/.test(value)},
    "./operator-saved-payment-repository":{readOperatorSavedPaymentBinding:async()=>{assert.match(statements[0],/ruined_members/);return binding;}},
    "./operator-membership-model":model,"./prepaid-policy":prepaid,
  });
  return {subscription,attempt,binding,statements,run:()=>consent.reconcileOperatorSavedPaymentConsent(tx,subscription)};
}

test("invoice-first delegated consent pins genuine subscription without fabricating a Checkout session",async()=>{
  const h=await consentHarness();assert.equal(await h.run(),true);
  assert.equal(h.statements.filter(sql=>sql.startsWith("update ")).length,2);
  assert.ok(h.statements.every(sql=>!sql.includes("stripe_checkout_sessions")));
});

test("webhook consent rejects mismatched authority before any payment projection",async()=>{
  for(const mutate of [h=>{h.attempt.authority_version=model.OPERATOR_MEMBERSHIP_AUTHORITY_VERSION;},
    h=>{h.attempt.acceptance_actor=uid(99);},h=>{h.binding.startedAt=null;},h=>{h.subscription.default_payment_method="pm_other";},
    h=>{h.subscription.metadata.ruined_operator_authorization_id=uid(99);},h=>{h.subscription.trial_end++;},
    h=>{h.subscription.customer="cus_other";}]) {
    const h=await consentHarness();mutate(h);await assert.rejects(h.run(),/authorization/);
    assert.equal(h.statements.filter(sql=>sql.startsWith("update ")).length,0);
  }
});

test("already-bound consent permits later card changes and performs no succeeded-proof rewrite",async()=>{
  const h=await consentHarness({bound:true});h.subscription.default_payment_method="pm_replacement";
  assert.equal(await h.run(),true);assert.equal(h.statements.filter(sql=>sql.startsWith("update ")).length,0);
});
