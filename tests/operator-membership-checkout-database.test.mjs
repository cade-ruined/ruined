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

test("delegated membership preserves actual administrator, beneficiary, agreement and billing authority",async t=>{
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
  const admin=await member(1,{admin:true}),otherAdmin=await member(2,{admin:true}),aaron=await member(3),other=await member(4);
  async function quote(who,n){const reserved=await commercial.reserveCommercialMembership({requestId:id(n),memberId:who.member,kind:"individual",plan:"monthly",expiresAt:new Date(Date.now()+3600000)});await commercial.bindCommercialMembershipPrice({reservationId:reserved.id,stripePriceId:"price_operator"});return reserved;}
  const offer=await quote(aaron,5000);
  const input={authUserId:admin.auth,memberId:aaron.member,reservationId:offer.id,authorityAccepted:true,
    authorityVersion:model.OPERATOR_MEMBERSHIP_AUTHORITY_VERSION,expectedAgreementVersion:"ruined_membership-v3",expectedAgreementSha256:"a".repeat(64),origin:"https://members.example.test",userAgent:"operator integration test"};
  let acceptance;
  await t.test("current admin and complete verified intake required before acceptance",async()=>{
    await assert.rejects(repository.getOperatorCheckoutMember(aaron.auth,aaron.member),PlatformAccessDeniedError);
    const status=await repository.getOperatorCheckoutMember(admin.auth,aaron.member);assert.equal(status.name,aaron.name);assert.equal(status.actorName,admin.name);assert.equal(status.paid,false);
    await assert.rejects(repository.getOperatorCheckoutMember(admin.auth,admin.member),/membership billing/);
    assert.equal((await repository.getOperatorCheckoutMember(admin.auth,admin.member,{allowIneligible:true})).paid,false,"complimentary admin status is not payment proof");
    const unverified=await member(5,{verified:false}),incomplete=await member(6,{registered:false});
    for(const who of [unverified,incomplete])await assert.rejects(repository.getOperatorCheckoutMember(admin.auth,who.member),/membership billing/);
    await assert.rejects(repository.acceptOperatorMembershipAgreement({...input,authorityAccepted:false}),e=>e.code==="operator_authority_required");
    await assert.rejects(repository.acceptOperatorMembershipAgreement({...input,expectedAgreementSha256:"c".repeat(64)}),e=>e.code==="membership_agreement_changed");
    await assert.rejects(repository.acceptOperatorMembershipAgreement({...input,memberId:other.member}));
    assert.equal((await db.query("select count(*)::int n from operator_membership_authorizations")).rows[0].n,0);
  });
  await t.test("authority, actual signer and honest operator age verification are immutable and idempotent",async()=>{
    acceptance=await repository.acceptOperatorMembershipAgreement(input);
    assert.deepEqual(await repository.acceptOperatorMembershipAgreement(input),acceptance);
    const row=(await db.query(`select acceptance.*,authority.actor_name_snapshot,authority.member_name_snapshot,authority.authority_text,
      consent.source age_source,consent.actor_auth_user_id age_actor,consent.evidence age_evidence
      from membership_agreement_acceptances acceptance
      join operator_membership_authorizations authority on authority.id=acceptance.operator_authorization_id
      join member_consents consent on consent.id=acceptance.age_attestation_id where acceptance.id=$1`,[acceptance.acceptanceId])).rows[0];
    assert.equal(row.accepted_by_auth_user_id,admin.auth);assert.equal(row.member_id,aaron.member);assert.equal(row.person_id,aaron.person);
    assert.equal(row.signer_name_snapshot,admin.name);assert.equal(row.signer_email_snapshot,admin.email);assert.equal(row.member_name_snapshot,aaron.name);
    assert.equal(row.age_source,"ops");assert.equal(row.age_actor,admin.auth);assert.equal(row.age_evidence.basis,"verified_registration_birth_date");
    assert.equal(row.authority_text,model.OPERATOR_MEMBERSHIP_AUTHORITY_TEXT);
    await assert.rejects(repository.acceptOperatorMembershipAgreement({...input,authUserId:otherAdmin.auth}));
    await assert.rejects(db.query("update operator_membership_authorizations set actor_auth_user_id=$2 where id=$1",[offer.id,otherAdmin.auth]),/append.only|immutable/i);
    await assert.rejects(db.query("delete from operator_membership_authorizations where id=$1",[offer.id]),/append.only|immutable/i);
    assert.equal((await db.query("select count(*)::int n from membership_agreement_acceptances where operator_authorization_id=$1",[offer.id])).rows[0].n,1);
    assert.equal((await db.query("select registered_at,profile_activated_at from member_registration_access where member_id=$1",[aaron.member])).rows[0].registered_at,null,"acceptance is not payment or profile access");
  });
  const checkoutInput=()=>({acceptanceId:acceptance.acceptanceId,attemptId:offer.id,commercialReservationId:offer.id,authUserId:admin.auth,email:aaron.email,
    plan:"monthly",stripePriceId:"price_operator",paidAgreementVersion:"ruined_membership-v3",consentSource:"stripe_checkout",operatorMemberId:aaron.member});
  await t.test("checkout requires the same operator and beneficiary and never invents payment consent",async()=>{
    await assert.rejects(billing.reserveMembershipCheckout({...checkoutInput(),authUserId:otherAdmin.auth}));
    await assert.rejects(billing.reserveMembershipCheckout({...checkoutInput(),operatorMemberId:other.member}));
    await assert.rejects(billing.reserveMembershipCheckout({...checkoutInput(),email:admin.email}));
    await assert.rejects(billing.reserveMembershipCheckout({...checkoutInput(),consentSource:"member"}));
    await assert.rejects(billing.reserveMembershipCheckout({...checkoutInput(),authUserId:aaron.auth,operatorMemberId:undefined}));
    const reserved=await billing.reserveMembershipCheckout(checkoutInput());
    assert.equal(reserved.memberId,aaron.member);assert.equal(reserved.operatorAuthorizationId,offer.id);assert.equal(reserved.operatorActorAuthUserId,admin.auth);
    assert.equal(reserved.recurringPaymentAcceptedAt,null);assert.equal(reserved.existingStripeSessionId,null);
    const stored=(await db.query("select * from stripe_checkout_attempts where id=$1",[offer.id])).rows[0];
    assert.equal(stored.billing_consent_auth_user_id,admin.auth);assert.equal(stored.email_normalized,aaron.email);assert.equal(stored.operator_authorization_id,offer.id);
    assert.equal(stored.recurring_payment_accepted_at,null);assert.equal(stored.billing_consent_evidence,null);
    await db.query("update stripe_checkout_attempts set stripe_session_id='cs_operator',status='open' where id=$1",[offer.id]);
    assert.equal((await billing.reserveMembershipCheckout(checkoutInput())).existingStripeSessionId,"cs_operator");
    await assert.rejects(db.query("update stripe_checkout_attempts set operator_authorization_id=null where id=$1",[offer.id]),/immutable/);
    await assert.rejects(db.query("update stripe_checkout_attempts set billing_consent_auth_user_id=$2 where id=$1",[offer.id,otherAdmin.auth]),/immutable/);
    await db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='ops_admin'",[admin.auth]);
    await assert.rejects(billing.reserveMembershipCheckout(checkoutInput()),/Administrator/);
    await assert.rejects(repository.acceptOperatorMembershipAgreement(input),PlatformAccessDeniedError);
    await db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1 and role_slug='ops_admin'",[admin.auth]);
  });
  await t.test("the database retains self identity checks and blocks direct forged delegated acceptances",async()=>{
    const row=(await db.query("select * from membership_agreement_acceptances where id=$1",[acceptance.acceptanceId])).rows[0];
    const clone=async(overrides={})=>{
      const values={...row,id:id(7777),dedupe_key:"forged-acceptance",...overrides};
      const keys=Object.keys(values);return db.query(`insert into membership_agreement_acceptances(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>typeof values[k]==="object"&&values[k]!==null&&!(values[k] instanceof Date)?JSON.stringify(values[k]):values[k]));
    };
    await assert.rejects(clone({operator_authorization_id:null}),/does not belong/);
    await assert.rejects(clone({accepted_by_auth_user_id:otherAdmin.auth}),/does not match/);
    await assert.rejects(clone({member_id:other.member,person_id:other.person}),/does not match/);
    await assert.rejects(clone({signer_name_snapshot:aaron.name}),/does not match/);
    assert.equal((await db.query("select relrowsecurity from pg_class where relname='operator_membership_authorizations'")).rows[0].relrowsecurity,true);
    for(const role of ['anon','authenticated'])for(const operation of ['SELECT','INSERT','UPDATE','DELETE'])
      assert.equal((await db.query("select has_table_privilege($1,'public.operator_membership_authorizations',$2) allowed",[role,operation])).rows[0].allowed,false);
    assert.equal((await db.query("select has_table_privilege('service_role','public.operator_membership_authorizations','SELECT,INSERT') allowed")).rows[0].allowed,true);
  });
  await t.test("self-service native checkout keeps its original signer and has no delegated authority",async()=>{
    const selfOffer=await quote(other,5001);
    const age=(await db.query("insert into member_consents(member_id,consent_type,policy_version,accepted_at,source,actor_auth_user_id,dedupe_key) values($1,'age_attestation','minimum-age-18',now(),'member',$2,'self-age') returning id",[other.member,other.auth])).rows[0].id;
    await db.query(`insert into membership_agreement_acceptances(id,agreement_version_id,person_id,member_id,accepted_by_auth_user_id,age_attestation_id,
      signer_name_snapshot,signer_email_snapshot,affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,
      agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
      values($1,$2,$3,$4,$5,$6,$7,$8,'checkbox_and_submit',now(),'ruined_membership',3,'Paid membership terms',$9,'Published terms only','self-agreement')`,
      [id(8000),id(9000),other.person,other.member,other.auth,age,other.name,other.email,"a".repeat(64)]);
    const result=await billing.reserveMembershipCheckout({acceptanceId:id(8000),attemptId:selfOffer.id,commercialReservationId:selfOffer.id,
      authUserId:other.auth,email:other.email,plan:"monthly",stripePriceId:"price_operator",paidAgreementVersion:"ruined_membership-v3",consentSource:"stripe_checkout"});
    assert.equal(result.operatorAuthorizationId,null);assert.equal(result.operatorActorAuthUserId,null);assert.equal(result.memberId,other.member);
    const attempt=(await db.query("select billing_consent_auth_user_id,operator_authorization_id from stripe_checkout_attempts where id=$1",[selfOffer.id])).rows[0];
    assert.equal(attempt.billing_consent_auth_user_id,other.auth);assert.equal(attempt.operator_authorization_id,null);
    await assert.rejects(repository.acceptOperatorMembershipAgreement({...input,memberId:other.member,reservationId:selfOffer.id}));
  });
  await t.test("operator Checkout pins the beneficiary Stripe customer without saving a card or impersonating the member",async()=>{
    const paymentModel=await load("src/lib/stripe/payment-method-model.ts");
    const paymentRepository=await load("src/lib/stripe/payment-method-repository.ts",{"@/lib/stripe/payment-method-model":paymentModel});
    const originalAccount=process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID;
    process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID="acct_test";
    t.after(()=>{if(originalAccount===undefined)delete process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID;else process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID=originalAccount;});
    let providerAccount="acct_test",mode=false,failAfterCustomerCreate=false;
    const customers=new Map(),methods=new Map(),idempotency=new Map(),calls=[];
    const stripe={accounts:{retrieve:async()=>{calls.push({kind:"account"});return{id:providerAccount};}},
      customers:{
        create:async(params,options)=>{
          calls.push({kind:"create",params:structuredClone(params),key:options.idempotencyKey});
          let previous=idempotency.get(options.idempotencyKey);
          if(previous)assert.deepEqual(params,previous.params,"customer creation retries must preserve the original beneficiary identity");
          else{const customer={id:`cus_operator${customers.size+1}`,livemode:mode,...structuredClone(params)};customers.set(customer.id,customer);
            previous={params:structuredClone(params),customer};idempotency.set(options.idempotencyKey,previous);}
          if(failAfterCustomerCreate){failAfterCustomerCreate=false;throw new Error("customer create reply timed out");}
          return structuredClone(previous.customer);
        },
        retrieve:async customerId=>{calls.push({kind:"retrieve",customerId});const customer=customers.get(customerId);assert.ok(customer);return structuredClone(customer);},
      },
      paymentMethods:{retrieve:async methodId=>{calls.push({kind:"method",methodId});return structuredClone(methods.get(methodId));}},
    };
    const payments=await load("src/lib/stripe/payment-method-service.ts",{
      "@/lib/membership/registration-repository":{reconcileMemberRegistration:()=>assert.fail("Pinning a customer cannot complete registration")},
      "@/lib/stripe/database":{getBillingDatabase:()=>sql},"@/lib/platform/config":{getPlatformConfiguration:()=>({mode:"connected",minimumAge:18,stripePaymentSetupReady:true})},
      "@/lib/stripe/server":{getStripe:()=>stripe,getStripeLivemode:()=>mode},"@/lib/stripe/membership-state":{isUuid:v=>typeof v==="string"&&/^[a-f0-9-]{36}$/.test(v)},
      "@/lib/stripe/payment-method-model":paymentModel,"@/lib/stripe/payment-method-repository":paymentRepository,
    });
    const prepare=async(n,requestId)=>{
      const who=await member(n),reserved=await quote(who,requestId);
      const agreed=await repository.acceptOperatorMembershipAgreement({...input,memberId:who.member,reservationId:reserved.id});
      await billing.reserveMembershipCheckout({...checkoutInput(),memberId:undefined,operatorMemberId:who.member,email:who.email,
        acceptanceId:agreed.acceptanceId,attemptId:reserved.id,commercialReservationId:reserved.id});
      return{who,reserved};
    };
    const fresh=await prepare(7,5002),pin=()=>payments.getSavedPaymentMethodForCheckout(fresh.who.member,fresh.reserved.id,admin.auth);
    await assert.rejects(payments.getSavedPaymentMethodForCheckout(fresh.who.member,fresh.reserved.id,otherAdmin.auth),/administrator.*match/i);
    await assert.rejects(payments.getSavedPaymentMethodForCheckout(fresh.who.member,fresh.reserved.id,fresh.who.auth),/Administrator/);
    assert.equal(calls.length,0,"bad actors cannot query Stripe");
    mode=true;await assert.rejects(pin(),/configuration|registration/i);mode=false;
    process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID="acct_other";providerAccount="acct_other";
    await assert.rejects(pin(),/configuration|registration/i);
    process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID="acct_test";providerAccount="acct_test";
    assert.equal(calls.filter(call=>call.kind==="create").length,0,"account or mode drift since registration is rejected before creating any customer");
    failAfterCustomerCreate=true;await assert.rejects(pin(),/timed out/);
    assert.equal(customers.size,1);
    let attempt=(await db.query("select * from stripe_checkout_attempts where id=$1",[fresh.reserved.id])).rows[0];
    assert.equal(attempt.payment_setup_customer_checked,false,"provider response timeout rolls back only the local pin");
    await db.query("update person_private_profiles set legal_name='Changed since review' where person_id=$1",[fresh.who.person]);
    const pinned=await pin();assert.equal(pinned.customerId,"cus_operator1");assert.equal(customers.size,1);
    const created=calls.find(call=>call.kind==="create");assert.equal(created.params.email,fresh.who.email);assert.equal(created.params.name,fresh.who.name);
    assert.notEqual(created.params.email,admin.email);assert.equal(created.params.metadata.ruined_member_id,fresh.who.member);
    assert.deepEqual(await pin(),pinned);assert.equal(calls.filter(call=>call.kind==="create").length,2,"subsequent retry reads the pinned customer");
    attempt=(await db.query("select * from stripe_checkout_attempts where id=$1",[fresh.reserved.id])).rows[0];
    assert.equal(attempt.payment_setup_customer_id,pinned.customerId);assert.equal(attempt.payment_setup_account_id,"acct_test");assert.equal(attempt.payment_setup_livemode,false);
    assert.equal(attempt.recurring_payment_accepted_at,null);assert.equal(attempt.stripe_session_id,null);
    assert.equal((await db.query("select count(*)::int n from member_payment_method_accounts where member_id=$1",[fresh.who.member])).rows[0].n,0,"customer pin does not invent saved-card consent");
    assert.equal((await db.query("select registered_at from member_registration_access where member_id=$1",[fresh.who.member])).rows[0].registered_at,null);
    mode=true;await assert.rejects(pin(),/different payment configuration/);mode=false;
    providerAccount="acct_other";await assert.rejects(pin(),/temporarily unavailable/);providerAccount="acct_test";
    customers.get(pinned.customerId).email=admin.email;await assert.rejects(pin(),/unavailable/);customers.get(pinned.customerId).email=fresh.who.email;
    customers.get(pinned.customerId).livemode=true;await assert.rejects(pin(),/unavailable/);customers.get(pinned.customerId).livemode=false;

    const saved=await prepare(8,5003),savedCustomer={id:"cus_savedidentity",livemode:false,email:admin.email,name:saved.who.name};
    customers.set(savedCustomer.id,savedCustomer);methods.set("pm_savedidentity",{id:"pm_savedidentity",livemode:false,customer:savedCustomer.id,
      type:"card",allow_redisplay:"always",card:{brand:"visa",last4:"4242",exp_month:12,exp_year:2035}});
    await db.query("insert into member_payment_method_accounts(member_id,stripe_account_id,livemode,stripe_customer_id) values($1,'acct_test',false,$2)",[saved.who.member,savedCustomer.id]);
    await db.query(`insert into member_payment_method_setup_attempts(id,member_id,stripe_account_id,livemode,consent_auth_user_id,consent_version,consent_text,return_origin,status,expires_at)
      values($1,$2,'acct_test',false,$3,'save-payment-method-v1',$4,'https://members.example.test','saved',now()+interval '1 hour')`,
      [id(8800),saved.who.member,saved.who.auth,paymentModel.PAYMENT_SETUP_CONSENTS["save-payment-method-v1"]]);
    await db.query("update member_payment_method_accounts set consent_attempt_id=$2,stripe_payment_method_id='pm_savedidentity',payment_method_display=$3,saved_at=now() where member_id=$1",
      [saved.who.member,id(8800),JSON.stringify({type:"card",label:"Visa ending in 4242",brand:"visa",last4:"4242"})]);
    const savedPin=()=>payments.getSavedPaymentMethodForCheckout(saved.who.member,saved.reserved.id,admin.auth);
    const createCount=calls.filter(call=>call.kind==="create").length;
    await assert.rejects(savedPin(),/billing identity.*verified/);
    assert.equal((await db.query("select payment_setup_customer_checked from stripe_checkout_attempts where id=$1",[saved.reserved.id])).rows[0].payment_setup_customer_checked,false);
    savedCustomer.email=saved.who.email;
    assert.deepEqual(await savedPin(),{customerId:savedCustomer.id});
    assert.equal(calls.filter(call=>call.kind==="create").length,createCount,"matching saved customer is reused without creating another identity");
  });
  await t.test("paid status requires settlement and cannot mistake a return, subscription, refund or review for payment",async()=>{
    const status=()=>repository.getOperatorCheckoutMember(admin.auth,aaron.member,{allowIneligible:true});
    assert.equal((await status()).paid,false);
    const verifiedAt=new Date().toISOString();
    await db.query(`update stripe_checkout_attempts set status='completed',stripe_subscription_id='sub_operator',recurring_payment_accepted_at=$2,
      billing_consent_evidence=$3 where id=$1`,[offer.id,verifiedAt,JSON.stringify({source:"stripe_checkout",termsOfService:"accepted",sessionId:"cs_operator",
      subscriptionId:"sub_operator",memberId:aaron.member,attemptId:offer.id,verifiedAt})]);
    assert.equal((await status()).paid,false,"browser/checkout completion alone is not paid");
    await db.query("insert into stripe_subscriptions(id,member_id,stripe_customer_id,stripe_status,price_id,latest_invoice_id,last_event_created) values('sub_operator',$1,'cus_operator','active','price_operator','in_operator',1)",[aaron.member]);
    await db.query("insert into stripe_checkout_sessions(id,member_id,stripe_customer_id,stripe_subscription_id,session_status,payment_status,livemode,last_event_created) values('cs_operator',$1,'cus_operator','sub_operator','complete','paid',false,1)",[aaron.member]);
    await db.query("insert into stripe_membership_commitments(id,member_id,checkout_attempt_id,agreement_acceptance_id,stripe_subscription_id,stripe_customer_id,livemode,terms_snapshot,terms_sha256) values($1,$2,$1,$3,'sub_operator','cus_operator',false,$4,$5)",[offer.id,aaron.member,acceptance.acceptanceId,JSON.stringify({billingTermsVersion:"membership-billing-v2",currency:"usd",billingPlan:"monthly"}),"c".repeat(64)]);
    assert.equal((await status()).paid,false,"subscription and accepted contract are not paid");
    await db.query("insert into stripe_invoices(id,member_id,stripe_customer_id,stripe_subscription_id,purpose,stripe_status,currency,amount_due,amount_paid,paid_at,last_event_created) values('in_operator',$1,'cus_operator','sub_operator','membership','paid','usd',34900,34900,now(),1)",[aaron.member]);
    await commercial.activateCommercialMembership({reservationId:offer.id,stripeSubscriptionId:"sub_operator"});
    assert.equal((await status()).paid,false,"invoice must have processed provider evidence");
    await db.query("insert into stripe_webhook_events(event_id,event_type,object_id,livemode,stripe_created,status) values('evt_operator','invoice.paid','in_operator',false,1,'processed')");
    assert.equal((await status()).paid,true);assert.equal((await status()).eligible,false);
    await db.query("update stripe_invoices set amount_paid=100 where id='in_operator'");assert.equal((await status()).paid,false);
    await db.query("update stripe_invoices set amount_paid=34900 where id='in_operator'");
    await db.query("update stripe_subscriptions set stripe_customer_id='cus_foreign' where id='sub_operator'");assert.equal((await status()).paid,false);
    await db.query("update stripe_subscriptions set stripe_customer_id='cus_operator' where id='sub_operator'");
    await db.query("insert into stripe_membership_commitment_ledgers(id,contract_id,revision,state,reconciled_at,invoices,source_evidence) values($1,$2,1,'review_required',now(),'[]','{}')",[id(8500),offer.id]);
    await db.query("update stripe_membership_commitments set ledger_revision=1 where id=$1",[offer.id]);assert.equal((await status()).paid,false);
    await db.query("insert into stripe_membership_commitment_ledgers(id,contract_id,revision,state,reconciled_at,invoices,source_evidence) values($1,$2,2,'complete',now(),$3,'{}')",[id(8501),offer.id,JSON.stringify([{invoiceId:"in_operator",duesRefunded:34900,adjustmentState:"none"}])]);
    await db.query("update stripe_membership_commitments set ledger_revision=2 where id=$1",[offer.id]);assert.equal((await status()).paid,false,"known refunded payment is not settled");
    await db.query("update stripe_subscriptions set stripe_status='canceled' where id='sub_operator'");assert.equal((await status()).paid,false);
  });

});
