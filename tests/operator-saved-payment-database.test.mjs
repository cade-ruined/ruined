import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
async function load(path, deps = {}) {
  const code=ts.transpileModule(await source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};new Function("require","module","exports",code)(name=>{if(name==="server-only")return{};assert.ok(name in deps,name);return deps[name];},mod,mod.exports);return mod.exports;
}
function wrap(db) {
  const sql=async(strings,...values)=>(await db.query(strings.reduce((s,part,i)=>s+(i?`$${i}`:"")+part,""),values.map(v=>v instanceof Date?v.toISOString():v))).rows;
  sql.json=v=>JSON.stringify(v);sql.begin=cb=>db.transaction(tx=>cb(wrap(tx)));return sql;
}

test("delegated saved payment uses honest authority and settles only with exact provider evidence",async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec("create role anon;create role authenticated;create role service_role;");
  for(const[,path]of(await source("scripts/migrate-platform.mjs")).matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g))await db.exec(await source(path));
  const sql=wrap(db),pricing=await load("src/lib/membership/pricing.ts");
  const commercial=await load("src/lib/membership/commercial-repository.ts",{"@/lib/database/server":{getApplicationDatabase:()=>sql}});
  const billing=await load("src/lib/stripe/billing-repository.ts",{"@/lib/stripe/database":{getBillingDatabase:()=>sql},"@/lib/membership/pricing":pricing,
    "@/lib/membership/commercial-repository":commercial,"@/lib/stripe/membership-state":{normalizeEmail:v=>v.trim().toLowerCase()}});
  const model=await load("src/lib/stripe/operator-membership-model.ts");
  class PlatformAccessDeniedError extends Error {}
  const repository=await load("src/lib/stripe/operator-membership-repository.ts",{
    "@/lib/stripe/billing-repository":billing,"@/lib/stripe/database":{getBillingDatabase:()=>sql},
    "@/lib/platform/config":{getPlatformConfiguration:()=>({minimumAge:18,stripeActivationReady:true,stripeCheckoutReady:true})},
    "@/lib/platform/repository":{PlatformAccessDeniedError},"@/lib/stripe/membership-state":{isUuid:v=>typeof v==="string"&&/^[a-f0-9-]{36}$/.test(v)},
    "@/lib/stripe/operator-membership-model":model,"@/lib/stripe/server":{getPaidMembershipAgreementVersion:()=>"ruined_membership-v3"},
  });
  await db.query("insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,'ruined_membership',3,'Paid membership terms','Published terms only',$2,'published',now())",[id(9000),"a".repeat(64)]);
  async function member(n,{admin=false,verified=true,registered=true}={}) {
    const who={member:id(n),auth:id(n+1000),email:`delegated-${n}@example.test`,name:`Member ${n}`};
    await db.query("insert into ruined_members(id,email,email_normalized) values($1,$2,$2)",[who.member,who.email]);
    who.person=(await db.query("select person_id from ruined_members where id=$1",[who.member])).rows[0].person_id;
    await db.query("insert into member_lifecycle(member_id,account_state) values($1,'active')",[who.member]);
    await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,$4,'active')",[who.auth,who.member,who.person,who.email]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')",[who.auth]);
    if(admin)await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')",[who.auth]);
    await db.query("insert into person_profiles(person_id,display_name) values($1,$2) on conflict(person_id) do update set display_name=excluded.display_name",[who.person,who.name]);
    await db.query("insert into person_private_profiles(person_id,legal_name,birth_date,default_fulfillment_address) values($1,$2,'1990-01-01','{\"countryCode\":\"US\"}') on conflict(person_id) do update set legal_name=excluded.legal_name,birth_date=excluded.birth_date,default_fulfillment_address=excluded.default_fulfillment_address",[who.person,who.name]);
    if(verified)await db.query("update person_email_addresses set verification_state='verified',verified_at=now() where person_id=$1",[who.person]);
    if(registered){
      await db.query("update member_onboardings set profile_completed_at=now() where member_id=$1",[who.member]);
      await db.query("insert into member_registration_access(member_id,requires_initial_payment,payment_setup_account_id,payment_setup_livemode) values($1,true,'acct_test',false)",[who.member]);
      await db.query(`insert into member_consents(member_id,consent_type,policy_version,accepted_at,source,actor_auth_user_id,evidence,dedupe_key)
        values($1,'privacy','registration-v1',now(),'member',$2,$3,$4)`,[who.member,who.auth,JSON.stringify({context:"registration_documents_v1",affirmativeAction:"checkbox_and_submit",membershipTerms:{key:"ruined_registration",sha256:"b".repeat(64)},registrationTermsAccepted:true,paidAgreementAccepted:false,chargeAuthorized:false}),`privacy-${n}`]);
    }
    return who;
  }

  const admin=await member(1,{admin:true}),otherAdmin=await member(2,{admin:true}),geoff=await member(3);
  const payments=await load("src/lib/stripe/operator-saved-payment-repository.ts",{
    "./database":{getBillingDatabase:()=>sql},"./billing-repository":billing,
    "./membership-state":{isUuid:v=>typeof v==="string"&&/^[a-f0-9-]{36}$/.test(v)},
  });
  const schedules=await load("src/lib/membership/foundations-schedule.ts");
  const schedule=schedules.createFoundationsBillingSchedule(new Date(),"monthly");
  const offer=await commercial.reserveCommercialMembership({requestId:id(5000),memberId:geoff.member,kind:"individual",plan:"monthly",expiresAt:new Date(Date.now()+3600000),billingSchedule:schedule});
  await commercial.bindCommercialMembershipPrice({reservationId:offer.id,stripePriceId:"price_saved"});
  const input={authUserId:admin.auth,memberId:geoff.member,reservationId:offer.id,authorityAccepted:true,
    authorityVersion:model.OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION,expectedAgreementVersion:"ruined_membership-v3",expectedAgreementSha256:"a".repeat(64),origin:"https://members.example.test",
    evidence:{source:"operator_recorded_member_authorization",statement:"Geoff instructed the administrator to accept the agreement and charge his saved method for first payment and renewals.",reference:"Operator's recorded conversation"}};
  let acceptance;
  await t.test("new recorded authority cannot impersonate cardholder, member, or a click",async()=>{
    await assert.rejects(repository.acceptOperatorSavedPaymentAgreement({...input,evidence:{...input.evidence,statement:""}}));
    await assert.rejects(repository.acceptOperatorSavedPaymentAgreement({...input,authorityVersion:model.OPERATOR_MEMBERSHIP_AUTHORITY_VERSION}));
    await assert.rejects(repository.acceptOperatorMembershipAgreement(input));
    acceptance=await repository.acceptOperatorSavedPaymentAgreement(input);
    assert.deepEqual(await repository.acceptOperatorSavedPaymentAgreement(input),acceptance);
    await assert.rejects(repository.acceptOperatorSavedPaymentAgreement({...input,evidence:{...input.evidence,statement:"A different instruction cannot replace the original evidence."}}));
    const row=(await db.query("select * from membership_agreement_acceptances where id=$1",[acceptance.acceptanceId])).rows[0];
    assert.equal(row.accepted_by_auth_user_id,admin.auth);assert.equal(row.member_id,geoff.member);
    assert.equal(row.signer_name_snapshot,admin.name);assert.equal(row.affirmative_action,"operator_recorded_authorization");
    assert.deepEqual(row.acceptance_evidence.memberAuthorization,input.evidence);
    const authority=(await db.query("select * from operator_membership_authorizations where id=$1",[offer.id])).rows[0];
    assert.equal(authority.authority_text,model.OPERATOR_SAVED_PAYMENT_AUTHORITY_TEXT);
    assert.deepEqual(authority.authority_evidence,input.evidence);
    await assert.rejects(db.query("update operator_membership_authorizations set authority_evidence='{}' where id=$1",[offer.id]),/append.only|immutable/i);
  });
  const reserve=()=>billing.reserveMembershipCheckout({acceptanceId:acceptance.acceptanceId,attemptId:offer.id,commercialReservationId:offer.id,
    authUserId:admin.auth,email:geoff.email,plan:"monthly",stripePriceId:"price_saved",paidAgreementVersion:"ruined_membership-v3",
    consentSource:"operator_saved_payment",operatorMemberId:geoff.member});
  const actor={authUserId:admin.auth,memberId:geoff.member,attemptId:offer.id};
  const bindingInput={...actor,customerId:"cus_saved",paymentMethodId:"pm_saved",setupIntentId:"seti_saved",mandateId:"mandate_saved",
    stripeAccountId:"acct_test",livemode:false,providerRequestSha256:"d".repeat(64),expectedTotal:34900,automaticTaxEnabled:false};
  await t.test("actual billing consent is immutable, but authorization alone cannot complete payment",async()=>{
    await reserve();
    const row=(await db.query("select * from stripe_checkout_attempts where id=$1",[offer.id])).rows[0];
    assert.equal(row.billing_consent_source,"operator_saved_payment");assert.equal(row.billing_consent_auth_user_id,admin.auth);
    assert.ok(row.recurring_payment_accepted_at);assert.equal(row.stripe_session_id,null);
    assert.equal(row.billing_consent_evidence.source,"operator_saved_payment");
    await assert.rejects(db.query("update stripe_checkout_attempts set stripe_session_id='cs_fake' where id=$1",[offer.id]),/cannot invent|check constraint/i);
    await assert.rejects(db.query("update stripe_checkout_attempts set status='completed' where id=$1",[offer.id]),/settlement/);
    await assert.rejects(payments.prepareOperatorSavedPaymentBinding(bindingInput),/storage|authority/);
    assert.equal((await db.query("select private.ruined_member_paid_reservation($1) paid",[geoff.member])).rows[0].paid,null);
  });
  await db.query("insert into member_payment_method_accounts(member_id,stripe_account_id,livemode,stripe_customer_id) values($1,'acct_test',false,'cus_saved')",[geoff.member]);
  await db.query(`insert into member_payment_method_setup_attempts(id,member_id,stripe_account_id,livemode,consent_auth_user_id,consent_version,consent_text,return_origin,status,expires_at,stripe_setup_intent_id)
    values($1,$2,'acct_test',false,$3,'save-payment-method-v1','Storage only','https://members.example.test','saved',now()+interval '1 hour','seti_saved')`,[id(8000),geoff.member,geoff.auth]);
  await db.query(`update member_payment_method_accounts set consent_attempt_id=$2,stripe_payment_method_id='pm_saved',saved_at=now(),payment_method_display=$3 where member_id=$1`,
    [geoff.member,id(8000),JSON.stringify({type:"link",label:"Link"})]);
  await t.test("current storage plus exact provider binding is required, with one submission winner",async()=>{
    const target=await payments.getOperatorSavedPaymentTarget({authUserId:admin.auth,memberId:geoff.member});
    assert.equal(target.customerId,"cus_saved");assert.equal(target.email,geoff.email);assert.equal(target.memberId,geoff.member);
    await assert.rejects(payments.getOperatorSavedPaymentTarget({authUserId:geoff.auth,memberId:geoff.member}),/Administrator/);
    await assert.rejects(payments.prepareOperatorSavedPaymentBinding({...bindingInput,authUserId:otherAdmin.auth}));
    await assert.rejects(payments.prepareOperatorSavedPaymentBinding({...bindingInput,paymentMethodId:"pm_other"}),/storage|authority/);
    await assert.rejects(payments.prepareOperatorSavedPaymentBinding({...bindingInput,expectedTotal:50000}),/storage|authority/);
    const prepared=await payments.prepareOperatorSavedPaymentBinding(bindingInput);assert.equal(prepared.status,"prepared");assert.equal(prepared.startedAt,null);
    assert.deepEqual(await payments.prepareOperatorSavedPaymentBinding(bindingInput),prepared);
    await assert.rejects(payments.prepareOperatorSavedPaymentBinding({...bindingInput,expectedTotal:50000}));
    await db.query("update member_payment_method_accounts set cleanup_pending=true where member_id=$1",[geoff.member]);
    await assert.rejects(payments.claimOperatorSavedPaymentBinding(actor));
    await db.query("update member_payment_method_accounts set cleanup_pending=false where member_id=$1",[geoff.member]);
    const first=await payments.claimOperatorSavedPaymentBinding(actor),second=await payments.claimOperatorSavedPaymentBinding(actor);
    assert.equal(first.claimed,true);assert.equal(second.claimed,false);assert.ok(first.binding.startedAt);assert.equal(second.binding.status,"submitting");
    await payments.failOperatorSavedPaymentBinding({...actor,status:"review",errorCode:"network_unknown"});
    assert.equal((await payments.claimOperatorSavedPaymentBinding(actor)).claimed,false,"unknown result cannot submit again");
    await assert.rejects(db.query("update stripe_checkout_attempts set status='expired' where id=$1",[offer.id]),/uncertain|abandoned/);
    const recovered=await payments.getMembershipCheckoutReservationForSavedPayment(actor);
    assert.equal(recovered.attemptId,offer.id);assert.equal(recovered.consentSource,"operator_saved_payment");assert.equal(recovered.existingStripeSessionId,null);
    await payments.bindOperatorSavedPaymentSubscription({...actor,subscriptionId:"sub_saved"});
    await assert.rejects(payments.bindOperatorSavedPaymentSubscription({...actor,subscriptionId:"sub_other"}));
    await assert.rejects(sql.begin(tx=>payments.completeOperatorSavedPaymentAttempt(tx,{attemptId:offer.id,subscriptionId:"sub_saved"})),/settled/);
    await assert.rejects(db.query("delete from operator_membership_saved_payments where attempt_id=$1",[offer.id]),/cannot be deleted/);
  });
  await t.test("only the matching settled invoice completes payment without a fabricated Checkout",async()=>{
    await db.query("insert into stripe_subscriptions(id,member_id,stripe_customer_id,stripe_status,price_id,latest_invoice_id,last_event_created) values('sub_saved',$1,'cus_saved','trialing','price_saved','in_saved',1)",[geoff.member]);
    await db.query("update membership_commercial_reservations set stripe_subscription_id='sub_saved' where id=$1",[offer.id]);
    await db.query("insert into stripe_membership_commitments(id,member_id,checkout_attempt_id,agreement_acceptance_id,stripe_subscription_id,stripe_customer_id,livemode,terms_snapshot,terms_sha256) values($1,$2,$1,$3,'sub_saved','cus_saved',false,$4,$5)",[offer.id,geoff.member,acceptance.acceptanceId,JSON.stringify({billingTermsVersion:"membership-billing-v2",currency:"usd",billingPlan:"monthly",billingSchedule:schedule,startsAt:schedule.serviceStartsAt,installmentDues:34900}),"c".repeat(64)]);
    await db.query("insert into stripe_invoices(id,member_id,stripe_customer_id,stripe_subscription_id,purpose,stripe_status,currency,amount_due,amount_paid,paid_at,last_event_created) values('in_saved',$1,'cus_saved','sub_saved','membership','paid','usd',34900,34900,now(),1)",[geoff.member]);
    await db.query(`insert into stripe_membership_prepaid_proofs(reservation_id,contract_id,member_id,stripe_subscription_id,stripe_invoice_id,stripe_payment_intent_id,stripe_charge_id,
      service_starts_at,prepaid_through,dues_amount,amount_paid,currency,livemode,verified_at)
      values($1,$1,$2,'sub_saved','in_saved','pi_saved','ch_saved',$3,$4,34900,34900,'usd',false,now())`,[offer.id,geoff.member,schedule.serviceStartsAt,schedule.prepaidThrough]);
    assert.equal((await db.query("select private.ruined_member_paid_reservation($1) paid",[geoff.member])).rows[0].paid,null,"incomplete projection is not paid yet");
    assert.equal(await sql.begin(tx=>payments.completeOperatorSavedPaymentAttempt(tx,{attemptId:offer.id,subscriptionId:"sub_saved"})),true);
    assert.equal((await db.query("select private.ruined_member_paid_reservation($1) paid",[geoff.member])).rows[0].paid,offer.id);
    assert.equal((await payments.getOperatorSavedPaymentBinding(actor)).status,"succeeded");
    assert.equal((await repository.getOperatorCheckoutMember(admin.auth,geoff.member,{allowIneligible:true})).paid,true);
    assert.equal((await db.query("select count(*)::integer n from stripe_checkout_sessions")).rows[0].n,0);
    for(const [label,sqlChange]of [
      ["invoice amount","update stripe_invoices set amount_paid=100 where id='in_saved'"],
      ["foreign customer","update stripe_subscriptions set stripe_customer_id='cus_foreign' where id='sub_saved'"],
      ["subscription canceled","update stripe_subscriptions set stripe_status='canceled' where id='sub_saved'"],
      ["refund review","update stripe_membership_prepaid_proofs set refund_state='review_required' where reservation_id='"+offer.id+"'"],
    ]){await db.exec("begin");try{await db.exec(sqlChange);assert.equal((await db.query("select private.ruined_member_paid_reservation($1) paid",[geoff.member])).rows[0].paid,null,label);}finally{await db.exec("rollback");}}
    await db.query("update stripe_membership_prepaid_proofs set refund_state='review_required' where reservation_id=$1",[offer.id]);
    assert.equal((await payments.bindOperatorSavedPaymentSubscription({...actor,subscriptionId:"sub_saved"})).subscriptionId,"sub_saved","re-reading historical binding does not rewrite settlement after a refund review");
    for(const role of ["anon","authenticated"])for(const operation of ["SELECT","INSERT","UPDATE","DELETE"])
      assert.equal((await db.query("select has_table_privilege($1,'public.operator_membership_saved_payments',$2) allowed",[role,operation])).rows[0].allowed,false);
  });
});
